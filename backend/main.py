
from pathlib import Path
from uuid import uuid4
from datetime import datetime, timezone
import os
import sqlite3
import re

from fastapi import FastAPI, HTTPException, UploadFile, File, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr, Field
from passlib.context import CryptContext


# --------------------------------------------------
# APP SETTINGS
# --------------------------------------------------

app = FastAPI(title="PDF Manager API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------
# PROJECT FOLDERS
# --------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent

# In Docker, PDF_DATA_DIR=/data.
# Locally, use the backend folder by default.
DATA_DIR = Path(os.environ.get("PDF_DATA_DIR", str(BASE_DIR)))

UPLOAD_DIR = DATA_DIR / "uploads"
DB_PATH = DATA_DIR / "app.db"

# Support both Docker and local development.
FRONTEND_CANDIDATES = [
    BASE_DIR / "my-project" / "dist",
    BASE_DIR.parent / "my-project" / "dist",
]

FRONTEND_DIST = next(
    (
        path
        for path in FRONTEND_CANDIDATES
        if (path / "index.html").is_file()
    ),
    FRONTEND_CANDIDATES[0],
)

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
DATA_DIR.mkdir(parents=True, exist_ok=True)


# --------------------------------------------------
# PASSWORD HASHING AND LOGIN TOKENS
# --------------------------------------------------

pwd_context = CryptContext(
    schemes=["bcrypt"],
    deprecated="auto",
)

# Tokens are kept in memory.
# Users and PDF records are stored in SQLite.
active_tokens = {}


# --------------------------------------------------
# SQLITE DATABASE
# --------------------------------------------------

def get_db():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_db():
    with get_db() as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                full_name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL
            )
        """)

        db.execute("""
            CREATE TABLE IF NOT EXISTS pdf_uploads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                filename TEXT NOT NULL,
                stored_name TEXT NOT NULL UNIQUE,
                uploaded_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        """)


init_db()


# --------------------------------------------------
# REQUEST MODELS
# --------------------------------------------------

class UserRegister(BaseModel):
    fullName: str = Field(min_length=1, max_length=100)
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)


class UserLogin(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=72)


# --------------------------------------------------
# AUTHENTICATION HELPERS
# --------------------------------------------------

def get_user_by_email(email):
    with get_db() as db:
        return db.execute(
            "SELECT * FROM users WHERE email = ?",
            (email.strip().lower(),),
        ).fetchone()


def get_authenticated_user(authorization):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Please log in first.",
        )

    token = authorization.split(" ", 1)[1].strip()
    user_id = active_tokens.get(token)

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired token. Please log in again.",
        )

    with get_db() as db:
        user = db.execute(
            "SELECT id, full_name, email FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()

    if not user:
        active_tokens.pop(token, None)
        raise HTTPException(
            status_code=401,
            detail="User not found.",
        )

    return user


# --------------------------------------------------
# SERVE REACT FRONTEND
# --------------------------------------------------

@app.get("/")
def home():
    index_file = FRONTEND_DIST / "index.html"

    if not index_file.is_file():
        raise HTTPException(
            status_code=500,
            detail=(
                "Frontend build not found. Expected index.html at "
                f"{index_file}. Build the React app using npm run build."
            ),
        )

    return FileResponse(index_file)


# Serve Vite-generated JavaScript and CSS.
ASSETS_DIR = FRONTEND_DIST / "assets"

if ASSETS_DIR.is_dir():
    app.mount(
        "/assets",
        StaticFiles(directory=str(ASSETS_DIR)),
        name="frontend-assets",
    )


# Serve files generated at the root of the Vite build.
@app.get("/favicon.svg")
def favicon():
    file_path = FRONTEND_DIST / "favicon.svg"

    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="Favicon not found.")

    return FileResponse(file_path)


@app.get("/icons.svg")
def icons():
    file_path = FRONTEND_DIST / "icons.svg"

    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="Icons not found.")

    return FileResponse(file_path)


# --------------------------------------------------
# REGISTER
# --------------------------------------------------

@app.post("/api/register", status_code=201)
def register(user: UserRegister):
    email = user.email.strip().lower()
    full_name = user.fullName.strip()

    if not full_name:
        raise HTTPException(
            status_code=422,
            detail="Full name cannot be empty.",
        )

    password_hash = pwd_context.hash(user.password)

    try:
        with get_db() as db:
            db.execute(
                """
                INSERT INTO users (full_name, email, password_hash)
                VALUES (?, ?, ?)
                """,
                (full_name, email, password_hash),
            )
    except sqlite3.IntegrityError:
        raise HTTPException(
            status_code=409,
            detail="This email is already registered.",
        )

    return {"message": "Registration successful!"}


# --------------------------------------------------
# LOGIN
# --------------------------------------------------

@app.post("/api/login")
def login(user: UserLogin):
    email = user.email.strip().lower()
    existing_user = get_user_by_email(email)

    if (
        not existing_user
        or not pwd_context.verify(
            user.password,
            existing_user["password_hash"],
        )
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password.",
        )

    token = uuid4().hex
    active_tokens[token] = existing_user["id"]

    return {
        "message": "Login successful!",
        "token": token,
        "user": {
            "fullName": existing_user["full_name"],
            "email": existing_user["email"],
        },
    }


# --------------------------------------------------
# LOGOUT
# --------------------------------------------------

@app.post("/api/logout")
def logout(authorization: str | None = Header(default=None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
        active_tokens.pop(token, None)

    return {"message": "Logout successful!"}


# --------------------------------------------------
# UPLOAD PDF
# --------------------------------------------------

@app.post("/api/upload-pdf")
async def upload_pdf(
    file: UploadFile = File(...),
    authorization: str | None = Header(default=None),
):
    user = get_authenticated_user(authorization)

    original_name = Path(file.filename or "").name

    if not original_name.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail="Only PDF files are allowed.",
        )

    safe_name = re.sub(
        r"[^A-Za-z0-9._-]",
        "_",
        original_name,
    ).strip("._")

    if not safe_name or safe_name.lower() == "pdf":
        raise HTTPException(
            status_code=400,
            detail="Invalid PDF filename.",
        )

    try:
        content = await file.read(10 * 1024 * 1024 + 1)
    finally:
        await file.close()

    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail="PDF must be 10 MB or smaller.",
        )

    if not content.startswith(b"%PDF-"):
        raise HTTPException(
            status_code=400,
            detail="The selected file is not a valid PDF.",
        )

    stored_name = f"{uuid4().hex}--{safe_name}"
    destination = UPLOAD_DIR / stored_name

    try:
        destination.write_bytes(content)

        uploaded_at = datetime.now(timezone.utc).isoformat()

        with get_db() as db:
            db.execute(
                """
                INSERT INTO pdf_uploads
                    (user_id, filename, stored_name, uploaded_at)
                VALUES (?, ?, ?, ?)
                """,
                (
                    user["id"],
                    original_name,
                    stored_name,
                    uploaded_at,
                ),
            )

    except Exception:
        destination.unlink(missing_ok=True)
        raise HTTPException(
            status_code=500,
            detail="Could not save the PDF upload record.",
        )

    return {
        "message": "PDF uploaded successfully!",
        "filename": original_name,
        "uploadedBy": user["full_name"],
        "uploadedEmail": user["email"],
        "uploadedAt": uploaded_at,
    }


# --------------------------------------------------
# LIST PDF UPLOADS WITH UPLOADER INFORMATION
# --------------------------------------------------

@app.get("/api/pdfs")
def list_pdfs(
    authorization: str | None = Header(default=None),
):
    # Any logged-in user can see the shared upload list.
    get_authenticated_user(authorization)

    with get_db() as db:
        rows = db.execute(
            """
            SELECT
                pdf_uploads.id,
                pdf_uploads.filename,
                pdf_uploads.stored_name,
                pdf_uploads.uploaded_at,
                users.full_name AS uploaded_by,
                users.email AS uploaded_email
            FROM pdf_uploads
            JOIN users ON users.id = pdf_uploads.user_id
            ORDER BY pdf_uploads.id DESC
            """
        ).fetchall()

    return {
        "pdfs": [
            {
                "id": row["id"],
                "filename": row["filename"],
                "url": f"/api/pdfs/{row['stored_name']}",
                "uploadedBy": row["uploaded_by"],
                "uploadedEmail": row["uploaded_email"],
                "uploadedAt": row["uploaded_at"],
            }
            for row in rows
        ]
    }


# --------------------------------------------------
# OPEN PDF
# --------------------------------------------------

@app.get("/api/pdfs/{stored_name}")
def open_pdf(
    stored_name: str,
    authorization: str | None = Header(default=None),
):
    get_authenticated_user(authorization)

    # Prevent path traversal.
    if Path(stored_name).name != stored_name:
        raise HTTPException(
            status_code=400,
            detail="Invalid filename.",
        )

    with get_db() as db:
        record = db.execute(
            "SELECT id FROM pdf_uploads WHERE stored_name = ?",
            (stored_name,),
        ).fetchone()

    if not record:
        raise HTTPException(
            status_code=404,
            detail="PDF not found.",
        )

    pdf_path = UPLOAD_DIR / stored_name

    if not pdf_path.is_file():
        raise HTTPException(
            status_code=404,
            detail="PDF file is missing.",
        )

    return FileResponse(
        path=pdf_path,
        media_type="application/pdf",
        filename=stored_name,
        content_disposition_type="inline",
    )
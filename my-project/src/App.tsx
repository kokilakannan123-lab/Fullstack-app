
import { useCallback, useEffect, useState } from "react";
import "./App.css";

// Use the same host for the frontend and FastAPI backend.
const API_URL = "";

type User = {
  fullName: string;
  email: string;
};

type UploadedPdf = {
  id: number;
  filename: string;
  url: string;
  uploadedBy: string;
  uploadedEmail: string;
  uploadedAt: string;
};

function App() {
  const [isRegistering, setIsRegistering] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loggedInUser, setLoggedInUser] = useState<User | null>(null);
  const [token, setToken] = useState("");
  const [selectedPdf, setSelectedPdf] = useState<File | null>(null);
  const [uploadedPdfs, setUploadedPdfs] = useState<UploadedPdf[]>([]);

  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error">(
    "success"
  );
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  const showMessage = (
    text: string,
    type: "success" | "error" = "success"
  ) => {
    setMessage(text);
    setMessageType(type);
  };

  const loadPdfs = useCallback(async (loginToken: string) => {
    try {
      const response = await fetch(`${API_URL}/api/pdfs`, {
        headers: {
          Authorization: `Bearer ${loginToken}`,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Could not load PDF files.");
      }

      setUploadedPdfs(data.pdfs ?? []);
    } catch (error) {
      showMessage(
        error instanceof Error ? error.message : "Could not load PDF files.",
        "error"
      );
    }
  }, []);

  useEffect(() => {
    if (token) {
      void loadPdfs(token);
    }
  }, [token, loadPdfs]);

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const endpoint = isRegistering
        ? "/api/register"
        : "/api/login";

      const body = isRegistering
        ? { fullName: fullName.trim(), email: email.trim(), password }
        : { email: email.trim(), password };

      const response = await fetch(`${API_URL}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Something went wrong.");
      }

      if (isRegistering) {
        showMessage("Registration successful! Please log in.", "success");
        setIsRegistering(false);
        setPassword("");
      } else {
        setLoggedInUser(data.user);
        setToken(data.token);
        setPassword("");
        showMessage("Login successful!", "success");
      }
    } catch (error) {
      showMessage(
        error instanceof Error ? error.message : "Request failed.",
        "error"
      );
    } finally {
      setLoading(false);
    }
  };

  const handlePdfUpload = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    if (!token) {
      showMessage("Please log in before uploading a PDF.", "error");
      return;
    }

    if (!selectedPdf) {
      showMessage("Please choose a PDF file first.", "error");
      return;
    }

    if (!selectedPdf.name.toLowerCase().endsWith(".pdf")) {
      showMessage("Only PDF files are allowed.", "error");
      return;
    }

    if (selectedPdf.size > 10 * 1024 * 1024) {
      showMessage("The PDF must be 10 MB or smaller.", "error");
      return;
    }

    setUploading(true);
    setMessage("");

    try {
      const formData = new FormData();
      formData.append("file", selectedPdf);

      const response = await fetch(`${API_URL}/api/upload-pdf`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "PDF upload failed.");
      }

      setSelectedPdf(null);

      const fileInput = document.getElementById(
        "pdf-file"
      ) as HTMLInputElement | null;

      if (fileInput) {
        fileInput.value = "";
      }

      showMessage("PDF uploaded successfully!", "success");
      await loadPdfs(token);
    } catch (error) {
      showMessage(
        error instanceof Error ? error.message : "PDF upload failed.",
        "error"
      );
    } finally {
      setUploading(false);
    }
  };

  const handleOpenPdf = async (pdf: UploadedPdf) => {
    if (!token) {
      showMessage("Please log in again.", "error");
      return;
    }

    // Open the tab immediately to reduce popup-blocker issues.
    const newTab = window.open("about:blank", "_blank");

    try {
      const response = await fetch(`${API_URL}${pdf.url}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || "Could not open the PDF.");
      }

      const pdfBlob = await response.blob();
      const pdfUrl = URL.createObjectURL(pdfBlob);

      if (newTab) {
        newTab.location.href = pdfUrl;
      } else {
        window.location.href = pdfUrl;
      }

      // Keep the Blob URL available while the PDF is being viewed.
      window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 10 * 60 * 1000);
    } catch (error) {
      newTab?.close();

      showMessage(
        error instanceof Error ? error.message : "Could not open the PDF.",
        "error"
      );
    }
  };

  const handleLogout = async () => {
    try {
      if (token) {
        await fetch(`${API_URL}/api/logout`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
      }
    } catch {
      // Clear the local session even if the logout request fails.
    }

    setToken("");
    setLoggedInUser(null);
    setUploadedPdfs([]);
    setSelectedPdf(null);
    setFullName("");
    setEmail("");
    setPassword("");
    setMessage("");
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);

    if (Number.isNaN(date.getTime())) {
      return dateString;
    }

    return date.toLocaleString();
  };

  if (!loggedInUser) {
    return (
      <main className="app-container">
        <section className="auth-card">
          <div className="brand-icon">PDF</div>

          <h1>PDF Manager</h1>

          <p className="auth-description">
            {isRegistering
              ? "Create an account to upload and manage PDF files."
              : "Log in to upload and view PDF files."}
          </p>

          {message && (
            <div className={`message ${messageType}`} role="alert">
              {message}
            </div>
          )}

          <form className="auth-form" onSubmit={handleSubmit}>
            {isRegistering && (
              <div className="form-group">
                <label htmlFor="fullName">Full name</label>
                <input
                  id="fullName"
                  type="text"
                  placeholder="Enter your full name"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  required
                  maxLength={100}
                />
              </div>
            )}

            <div className="form-group">
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                placeholder={
                  isRegistering
                    ? "Create a password (minimum 8 characters)"
                    : "Enter your password"
                }
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={isRegistering ? 8 : 1}
                maxLength={72}
              />
            </div>

            <button
              className="primary-button"
              type="submit"
              disabled={loading}
            >
              {loading
                ? "Please wait..."
                : isRegistering
                  ? "Create Account"
                  : "Login"}
            </button>
          </form>

          <div className="auth-switch">
            {isRegistering
              ? "Already have an account?"
              : "Don't have an account?"}

            <button
              className="text-button"
              type="button"
              onClick={() => {
                setIsRegistering(!isRegistering);
                setPassword("");
                setMessage("");
              }}
            >
              {isRegistering ? "Login" : "Register"}
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-container dashboard-container">
      <header className="dashboard-header">
        <div className="header-brand">
          <div className="brand-icon small">PDF</div>
          <div>
            <h1>PDF Manager</h1>
            <p>Upload, view, and track your documents</p>
          </div>
        </div>

        <div className="user-section">
          <div className="user-avatar">
            {loggedInUser.fullName.charAt(0).toUpperCase()}
          </div>

          <div className="user-info">
            <strong>{loggedInUser.fullName}</strong>
            <span>{loggedInUser.email}</span>
          </div>

          <button
            className="logout-button"
            type="button"
            onClick={handleLogout}
          >
            Logout
          </button>
        </div>
      </header>

      {message && (
        <div className={`message dashboard-message ${messageType}`} role="alert">
          {message}
          <button
            type="button"
            className="message-close"
            aria-label="Dismiss message"
            onClick={() => setMessage("")}
          >
            ×
          </button>
        </div>
      )}

      <section className="welcome-section">
        <h2>Welcome, {loggedInUser.fullName}!</h2>
        <p>Manage your PDF documents in one place.</p>
      </section>

      <section className="upload-card">
        <div className="section-heading">
          <div className="section-icon upload-icon">↑</div>
          <div>
            <h2>Upload a PDF</h2>
            <p>Select a PDF document from your computer.</p>
          </div>
        </div>

        <form className="upload-form" onSubmit={handlePdfUpload}>
          <label className="file-picker" htmlFor="pdf-file">
            <span className="file-picker-icon">＋</span>
            <span>
              <strong>
                {selectedPdf ? selectedPdf.name : "Choose a PDF file"}
              </strong>
              <span className="file-hint">
                PDF format only · Maximum size 10 MB
              </span>
            </span>
          </label>

          <input
            id="pdf-file"
            className="file-input"
            type="file"
            accept=".pdf,application/pdf"
            onChange={(event) => {
              setSelectedPdf(event.target.files?.[0] ?? null);
              setMessage("");
            }}
          />

          <button
            className="primary-button upload-button"
            type="submit"
            disabled={uploading || !selectedPdf}
          >
            {uploading ? "Uploading..." : "Upload PDF"}
          </button>
        </form>
      </section>

      <section className="files-card">
        <div className="files-heading">
          <div>
            <h2>Uploaded PDF Documents</h2>
            <p>See each document's uploader and upload date.</p>
          </div>

          <div className="file-count">
            {uploadedPdfs.length}{" "}
            {uploadedPdfs.length === 1 ? "file" : "files"}
          </div>
        </div>

        {uploadedPdfs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">PDF</div>
            <h3>No PDFs uploaded yet</h3>
            <p>Choose a PDF above to upload your first document.</p>
          </div>
        ) : (
          <div className="pdf-list">
            {uploadedPdfs.map((pdf) => (
              <article className="pdf-item" key={pdf.id}>
                <div className="pdf-file-icon">PDF</div>

                <div className="pdf-main">
                  <h3 className="pdf-filename">{pdf.filename}</h3>

                  <div className="pdf-details">
                    <div className="detail-row">
                      <span className="detail-label">Uploaded by</span>
                      <strong>{pdf.uploadedBy}</strong>
                    </div>

                    <div className="detail-row">
                      <span className="detail-label">Email</span>
                      <span className="detail-value">
                        {pdf.uploadedEmail}
                      </span>
                    </div>

                    <div className="detail-row">
                      <span className="detail-label">Upload date</span>
                      <span className="detail-value">
                        {formatDate(pdf.uploadedAt)}
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  className="open-button"
                  type="button"
                  onClick={() => void handleOpenPdf(pdf)}
                >
                  Open PDF
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <footer className="dashboard-footer">
        PDF Manager · Upload records stored in SQLite
      </footer>
    </main>
  );
}

export default App;

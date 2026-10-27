
# Build React frontend
FROM node:22-alpine AS frontend-build

WORKDIR /frontend

COPY my-project/package*.json ./
RUN npm install

COPY my-project/ ./
RUN npm run build

# Run FastAPI backend
FROM python:3.11-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1
ENV PDF_DATA_DIR=/data

# Install backend dependencies
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend application
COPY backend/main.py ./main.py

# Copy built React frontend
COPY --from=frontend-build /frontend/dist ./my-project/dist

# Create persistent data directory
RUN mkdir -p /data/uploads

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

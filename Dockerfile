FROM node:22-alpine AS frontend-build

WORKDIR /frontend

COPY my-project/package*.json ./
RUN npm install

COPY my-project/ ./
RUN npm run build

FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir fastapi "uvicorn[standard]"

COPY backend/main.py ./main.py
COPY --from=frontend-build /frontend/dist ./static

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

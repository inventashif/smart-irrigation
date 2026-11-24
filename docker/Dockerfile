# Smart Irrigation — backend + hardware simulator image.
# Build context is the project root (smart-irrigation/).
FROM python:3.12-slim

WORKDIR /app

# Backend dependencies first (better layer caching)
COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt

# Application code
COPY backend/app.py ./backend/
COPY frontend/ ./frontend/
COPY hardware_sim/ ./hardware_sim/
COPY simulator/ ./simulator/
COPY tests/ ./tests/

ENV PYTHONPATH=/app \
    DB_PATH=/data/smart_irrigation.db

VOLUME /data
EXPOSE 8000

# Default: run the integration backend.
CMD ["python", "-m", "uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8000"]

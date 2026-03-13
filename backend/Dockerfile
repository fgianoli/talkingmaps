FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc libgdal-dev gdal-bin \
    liblaszip-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Create non-root user and set ownership
RUN useradd -r -s /bin/false appuser \
    && mkdir -p /var/www/uploads/stories /var/www/uploads/media /var/www/uploads/layers /var/www/uploads/3d /var/www/uploads/avatars \
    && chown -R appuser:appuser /var/www/uploads /app

USER appuser

EXPOSE 8000

# No --reload in production (use docker-compose override for dev)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

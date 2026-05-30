# syntax=docker/dockerfile:1.4
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --timeout=100 -r requirements.txt

COPY . .

EXPOSE 5000
CMD ["python", "app.py"]

# Stage 1: Builder Stage - Install dependencies
# Use a specific, stable Python version as the base image for building
FROM python:3.11-slim

# Set the working directory inside this builder container
WORKDIR /app

# Copy only the requirements file first.
# This step's cache will only be invalidated if requirements.txt changes.
COPY requirements.txt .
RUN pip install --no-cache-dir --timeout=100 -r requirements.txt
# Install dependencies.
# --no-cache-dir prevents pip from storing its cache within this layer, reducing size.
# The '&& rm -rf ~/.cache/pip' cleans up any residual pip cache files after installation.
RUN pip install --no-cache-dir -r requirements.txt \
    && rm -rf ~/.cache/pip

# Stage 2: Runtime Stage - Copy only what's needed for the final application
# Use a fresh, clean base image for the final, smaller runtime image.
# It's good practice to use the same base or an even smaller one like 'python:3.11-slim-buster'
# if 'slim' is too large, bu
# Use an official Python runtime as a parent image
FROM python:3.11-slim

# Install curl for health checks + ocrmypdf system deps for tier-2 OCR
# (tesseract, ghostscript, qpdf are required by ocrmypdf for the small-PDF
# inline OCR path; pngquant is optional but improves output PDF size).
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
        tesseract-ocr \
        ghostscript \
        qpdf \
        pngquant \
        unpaper \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory in the container
WORKDIR /app

# Copy and install requirements
COPY requirements.txt .
RUN pip install --no-cache-dir --timeout=100 -r requirements.txt

# Copy the rest of the application source code
COPY . .

# Expose the port the app runs on
EXPOSE 5000

# --- NEW COMMAND ---
# Run the app directly using the python interpreter
CMD ["python", "app.py"] 


# nirs4all Studio — Docker image for server/HPC deployment
# No Electron — web frontend served by FastAPI at http://localhost:8000
#
# Build:
#   docker build -t nirs4all-studio .
#   docker build --build-arg INSTALL_GPU=true --build-arg BASE_IMAGE=nvidia/cuda:12.4.1-runtime-ubuntu22.04 -t nirs4all-studio:gpu-cuda .
#
# Run:
#   docker run -p 8000:8000 -v /path/to/workspaces:/workspaces nirs4all-studio
#   docker run --gpus all -p 8000:8000 nirs4all-studio:gpu-cuda

# ── Build arguments ──
ARG BASE_IMAGE=python:3.11-slim
ARG INSTALL_GPU=false

# ══════════════════════════════════════════════════════════════════════
# Stage 1: Frontend builder
# ══════════════════════════════════════════════════════════════════════
FROM node:22-slim AS frontend

WORKDIR /build

# Install dependencies first (layer caching)
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Build frontend
COPY vite.config.ts tsconfig*.json index.html ./
COPY public/ public/
COPY src/ src/
RUN npm run build

# ══════════════════════════════════════════════════════════════════════
# Stage 2: Runtime
# ══════════════════════════════════════════════════════════════════════
FROM ${BASE_IMAGE} AS runtime

ARG INSTALL_GPU=false

# System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Ensure Python is available (the nvidia/cuda base image doesn't include it)
RUN if ! command -v python3 &> /dev/null; then \
        apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-pip python3-venv \
        && rm -rf /var/lib/apt/lists/* \
        && ln -sf /usr/bin/python3 /usr/bin/python; \
    fi

WORKDIR /app

# Install Python dependencies
COPY requirements-cpu.txt requirements-gpu.txt ./
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements-cpu.txt && \
    if [ "$INSTALL_GPU" = "true" ]; then \
        pip install --no-cache-dir -r requirements-gpu.txt; \
    fi

# Install nirs4all
RUN pip install --no-cache-dir nirs4all

# Copy backend source
COPY main.py ./
COPY api/ api/
COPY websocket/ websocket/
COPY recommended-config.json ./

# Copy frontend build from stage 1
COPY --from=frontend /build/dist ./dist
COPY public/ public/

# Write build info
RUN python -c "import json, datetime; json.dump({ \
    'build_date': datetime.datetime.utcnow().isoformat() + 'Z', \
    'mode': 'docker', \
    'gpu': '${INSTALL_GPU}' \
    }, open('build_info.json', 'w'))"

# Runtime configuration
ENV NIRS4ALL_DOCKER=true
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

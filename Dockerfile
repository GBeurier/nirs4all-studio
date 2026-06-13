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
ARG NIRS4ALL_VERSION=0.10.0
ARG PYTHON_VERSION=3.11.13
ARG PYTHON_STANDALONE_TAG=20250828

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
ARG NIRS4ALL_VERSION=0.10.0
ARG PYTHON_VERSION=3.11.13
ARG PYTHON_STANDALONE_TAG=20250828
ENV PATH="/opt/python-build-standalone/python/bin:${PATH}"

# Apt retry config (mitigates transient mirror hash-sum mismatches in CI)
RUN echo 'Acquire::Retries "3";' > /etc/apt/apt.conf.d/80-retries

# System dependencies
# hadolint ignore=DL3008
RUN rm -rf /var/lib/apt/lists/* \
    && apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    tar \
    && rm -rf /var/lib/apt/lists/*

# Ensure Python 3.11+ is available. CUDA Ubuntu 22.04 images ship Python 3.10,
# which is too old for nirs4all 0.10.0.
# hadolint ignore=DL3013
RUN set -eux; \
    if command -v python3 >/dev/null 2>&1 && python3 -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)"; then \
        ln -sf "$(command -v python3)" /usr/local/bin/python; \
    else \
        archive="cpython-${PYTHON_VERSION}+${PYTHON_STANDALONE_TAG}-x86_64-unknown-linux-gnu-install_only.tar.gz"; \
        url="https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_STANDALONE_TAG}/${archive}"; \
        mkdir -p /opt/python-build-standalone; \
        curl -fsSL "$url" -o /tmp/python-build-standalone.tar.gz; \
        tar -xzf /tmp/python-build-standalone.tar.gz -C /opt/python-build-standalone; \
        rm /tmp/python-build-standalone.tar.gz; \
        ln -sf /opt/python-build-standalone/python/bin/python3 /usr/local/bin/python3; \
        ln -sf /opt/python-build-standalone/python/bin/python3 /usr/local/bin/python; \
    fi; \
    python -m ensurepip --upgrade; \
    python -m pip install --no-cache-dir --upgrade pip; \
    python --version; \
    python -m pip --version

WORKDIR /app

# Install Python dependencies
COPY requirements-cpu.txt requirements-gpu.txt ./
RUN python -m pip install --no-cache-dir -r requirements-cpu.txt && \
    if [ "$INSTALL_GPU" = "true" ]; then \
        python -m pip install --no-cache-dir -r requirements-gpu.txt; \
    fi

# Install nirs4all
RUN python -m pip install --no-cache-dir "https://github.com/GBeurier/nirs4all/archive/refs/tags/${NIRS4ALL_VERSION}.tar.gz" && \
    python -c "import nirs4all; assert nirs4all.__version__ == '${NIRS4ALL_VERSION}', nirs4all.__version__"

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

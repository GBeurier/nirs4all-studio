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
ARG NIRS4ALL_VERSION=1.1.2
ARG PYTHON_VERSION=3.11.13
ARG PYTHON_STANDALONE_TAG=20250828

# ══════════════════════════════════════════════════════════════════════
# Stage 1: Frontend builder
# ══════════════════════════════════════════════════════════════════════
FROM node:24-slim AS frontend

WORKDIR /build

# Install dependencies first (layer caching)
COPY package.json package-lock.json ./
COPY vendor/npm/ vendor/npm/
RUN npm ci --ignore-scripts

# Build frontend
COPY vite.config.ts tsconfig*.json index.html ./
COPY tailwind.config.ts postcss.config.js ./
COPY public/ public/
COPY src/ src/
RUN npm run build

# ══════════════════════════════════════════════════════════════════════
# Stage 2: Runtime
# ══════════════════════════════════════════════════════════════════════
FROM ${BASE_IMAGE} AS runtime

ARG INSTALL_GPU=false
ARG NIRS4ALL_VERSION=1.1.2
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
# which is too old for the recovery library.
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
# Every platform consumes the exact same canonical library wheel.
COPY vendor/python/ /app/python-wheels/
ENV NIRS4ALL_RECOVERY_WHEEL=/app/python-wheels/nirs4all-1.1.2-py3-none-any.whl
RUN python -m pip install --no-cache-dir -r requirements-cpu.txt "$NIRS4ALL_RECOVERY_WHEEL" && \
    if [ "$INSTALL_GPU" = "true" ]; then \
        python -m pip install --no-cache-dir -r requirements-gpu.txt; \
    fi

RUN python -c "import hashlib, importlib.metadata, json, os; from pathlib import Path; import nirs4all; assert nirs4all.__version__ == '${NIRS4ALL_VERSION}', nirs4all.__version__; receipt = json.loads(importlib.metadata.distribution('nirs4all').read_text('direct_url.json')); assert receipt['archive_info']['hashes']['sha256'] == hashlib.sha256(Path(os.environ['NIRS4ALL_RECOVERY_WHEEL']).read_bytes()).hexdigest()"

# Copy backend source
COPY main.py ./
COPY api/ api/
COPY src/data/nodes/ src/data/nodes/
COPY websocket/ websocket/
COPY updater/ updater/
COPY recommended-config.json package.json ./

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
ENV N4A_ENGINE=legacy
ENV PYTHONUNBUFFERED=1
# Match desktop: TabPFN fingerprint features must survive interpreter restarts.
ENV PYTHONHASHSEED=0
ENV NIRS4ALL_CONFIG=/data/config
ENV XDG_DATA_HOME=/data

VOLUME ["/data", "/workspaces"]
WORKDIR /workspaces

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

CMD ["python", "-m", "uvicorn", "main:app", "--app-dir", "/app", "--host", "0.0.0.0", "--port", "8000"]

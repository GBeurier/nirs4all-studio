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
ARG NIRS4ALL_SOURCE_URL=https://github.com/GBeurier/nirs4all/archive/refs/heads/rc/v1-full-refactor-python.tar.gz
ARG DAG_ML_SOURCE_URL=https://github.com/GBeurier/dag-ml/archive/refs/heads/rc/v1-full-refactor.tar.gz
ARG DAG_ML_DATA_SOURCE_URL=https://github.com/GBeurier/dag-ml-data/archive/refs/heads/rc/v1-full-refactor.tar.gz
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
ARG NIRS4ALL_SOURCE_URL=https://github.com/GBeurier/nirs4all/archive/refs/heads/rc/v1-full-refactor-python.tar.gz
ARG DAG_ML_SOURCE_URL=https://github.com/GBeurier/dag-ml/archive/refs/heads/rc/v1-full-refactor.tar.gz
ARG DAG_ML_DATA_SOURCE_URL=https://github.com/GBeurier/dag-ml-data/archive/refs/heads/rc/v1-full-refactor.tar.gz
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
    build-essential \
    tar \
    && rm -rf /var/lib/apt/lists/*

# Ensure Python 3.11+ is available. CUDA Ubuntu 22.04 images ship Python 3.10,
# which is too old for the nirs4all V1 RC runtime.
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

# Install dag-ml runtimes before nirs4all so the Docker image uses the same
# backend stack as the release-candidate archives.
RUN set -eux; \
    curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable; \
    export PATH="/root/.cargo/bin:${PATH}"; \
    rustc --version; \
    cargo --version; \
    python -m pip install --no-cache-dir \
        "dag-ml-data @ ${DAG_ML_DATA_SOURCE_URL}#subdirectory=crates/dag-ml-data-py" \
        "dag-ml @ ${DAG_ML_SOURCE_URL}#subdirectory=crates/dag-ml-py"; \
    python -m pip install --no-cache-dir "${NIRS4ALL_SOURCE_URL}" && \
    python -c "import dag_ml, dag_ml_data, nirs4all; print('runtime ok', nirs4all.__version__)"; \
    apt-get purge -y --auto-remove build-essential; \
    rm -rf /root/.cargo /root/.rustup /root/.cache/pip /var/lib/apt/lists/*

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

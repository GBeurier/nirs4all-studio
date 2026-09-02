# syntax=docker/dockerfile:1.7
# nirs4all Studio native container: static renderer + Rust product backend.
# nginx owns the public socket. The Rust sidecar remains loopback-only and is
# the sole HTTP/control backend; Python is never installed in this image.

ARG NODE_IMAGE=node:24-bookworm-slim
# The locked ICU graph requires Rust 1.88 even though the sidecar sources retain
# their lower language-level rust-version declaration.
ARG RUST_IMAGE=rust:1.88-bookworm
ARG NGINX_IMAGE=nginx:1.27.5-bookworm

FROM ${NODE_IMAGE} AS frontend
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY vite.config.ts tsconfig*.json index.html ./
COPY public/ public/
COPY src/ src/
RUN npm run build

FROM ${RUST_IMAGE} AS sidecar
WORKDIR /build
COPY sidecar/ sidecar/
RUN cargo build --locked --release --manifest-path sidecar/Cargo.toml \
    && strip sidecar/target/release/studio-sidecar \
    && sidecar/target/release/studio-sidecar --smoke-readiness >/dev/null

FROM ${NGINX_IMAGE} AS runtime
ARG STUDIO_VERSION=0.9.1
ARG STUDIO_REVISION=unknown

# tini forwards termination to nginx and its loopback sidecar process group;
# curl is used for startup/readiness checks only. No Python runtime is present.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl tini \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/lib/nirs4all-studio/config /workspaces /var/cache/nginx /var/run/nginx \
    && chown -R nginx:nginx /var/lib/nirs4all-studio /workspaces /var/cache/nginx /var/run/nginx /var/log/nginx

COPY --from=frontend --chown=nginx:nginx /build/dist/ /usr/share/nginx/html/
COPY --from=sidecar --chown=nginx:nginx /build/sidecar/target/release/studio-sidecar /usr/local/bin/studio-sidecar
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/studio-entrypoint

RUN printf '%s\n' \
      '{' \
      '  "flavor": "native-container",' \
      '  "gpu_enabled": false,' \
      '  "backend": "rust-sidecar",' \
      "  \"version\": \"${STUDIO_VERSION}\"," \
      "  \"revision\": \"${STUDIO_REVISION}\"" \
      '}' > /usr/share/nginx/html/build_info.json \
    && cp /usr/share/nginx/html/build_info.json /etc/nirs4all-studio-build-info.json \
    && ldd /usr/local/bin/studio-sidecar \
    && ! ldd /usr/local/bin/studio-sidecar | grep -q 'not found' \
    && ! command -v python \
    && ! command -v python3

ENV NIRS4ALL_RUNTIME_MODE=container \
    NIRS4ALL_RUNTIME_KIND=native-sidecar \
    NIRS4ALL_APP_VERSION=${STUDIO_VERSION} \
    NIRS4ALL_BUILD_INFO_PATH=/etc/nirs4all-studio-build-info.json \
    NIRS4ALL_CONFIG=/var/lib/nirs4all-studio/config \
    NIRS4ALL_BACKEND_DATA_DIR=/var/lib/nirs4all-studio \
    NIRS4ALL_DOCKER=true

VOLUME ["/var/lib/nirs4all-studio", "/workspaces"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl --fail --silent --show-error http://127.0.0.1:8000/api/health >/dev/null || exit 1

USER nginx
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/usr/local/bin/studio-entrypoint"]

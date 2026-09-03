# syntax=docker/dockerfile:1.7
# nirs4all Studio native container: static renderer + Rust product backend.
# nginx owns the public socket. The Rust sidecar remains loopback-only and is
# the sole HTTP/control backend; CPython is a bounded stdio library/plugin host.

ARG NODE_IMAGE=node:24-bookworm-slim
# The locked ICU graph requires Rust 1.88 even though the sidecar sources retain
# their lower language-level rust-version declaration.
ARG RUST_IMAGE=rust:1.88-bookworm
ARG NGINX_IMAGE=nginx:1.27.5-bookworm

FROM ${NODE_IMAGE} AS frontend
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY vite.config.ts postcss.config.js tailwind.config.ts tsconfig*.json index.html ./
COPY public/ public/
COPY src/ src/
RUN npm run build

FROM ${RUST_IMAGE} AS sidecar
WORKDIR /build
COPY sidecar/ sidecar/
RUN cargo build --locked --release --manifest-path sidecar/Cargo.toml \
    && strip sidecar/target/release/studio-sidecar \
    && sidecar/target/release/studio-sidecar --smoke-readiness >/dev/null

FROM ${NODE_IMAGE} AS python-plugin-runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY recommended-config.json ./
COPY scripts/setup-python-env.cjs scripts/python-runtime-config.cjs scripts/bake-python-plugin-runtime.cjs scripts/
RUN --mount=type=cache,target=/python-cache \
    node scripts/bake-python-plugin-runtime.cjs \
      --backend-root /product/backend \
      --cache-dir /python-cache

FROM ${NODE_IMAGE} AS native-runtime-contract
ARG NIRS4ALL_METHODS_SHA256
WORKDIR /product
RUN test -n "${NIRS4ALL_METHODS_SHA256}" \
    && mkdir -p backend/native /contract-scripts
COPY --from=python-plugin-runtime /product/backend/ backend/
COPY --from=sidecar /build/sidecar/target/release/studio-sidecar backend/native/studio-sidecar
COPY --from=methods-runtime /libn4m.so.2.5.0 backend/native/libn4m.so
COPY scripts/native-runtime-contract.cjs scripts/bake-python-plugin-runtime.cjs /contract-scripts/
RUN test "$(sha256sum backend/native/libn4m.so | cut -d' ' -f1)" = "${NIRS4ALL_METHODS_SHA256}" \
    && chmod 0755 backend/native/studio-sidecar \
    && node -e 'const c=require("/contract-scripts/native-runtime-contract.cjs"); c.writeRuntimeContract({backendRoot:"/product/backend",platform:"linux",arch:"x64",methodsLibraryPath:"/product/backend/native/libn4m.so"}); c.verifyRuntimeContract({backendRoot:"/product/backend",artifactBoundaryRoot:"/product/backend",platform:"linux",arch:"x64",requireBundledPythonPlugin:true,requireBundledMethods:true})'

FROM ${NGINX_IMAGE} AS runtime
ARG STUDIO_VERSION=0.11.0
ARG STUDIO_REVISION=unknown

# tini forwards termination to nginx and its loopback sidecar process group;
# curl is used for startup/readiness checks only. CPython has no public socket.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl libstdc++6 tini \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/lib/nirs4all-studio/config /workspaces /var/cache/nginx /var/run/nginx \
    && chown -R nginx:nginx /var/lib/nirs4all-studio /workspaces /var/cache/nginx /var/run/nginx /var/log/nginx

COPY --from=frontend --chown=nginx:nginx /build/dist/ /usr/share/nginx/html/
COPY --from=native-runtime-contract --chown=nginx:nginx /product/backend/ /opt/nirs4all/backend/
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
    && ldd /opt/nirs4all/backend/native/studio-sidecar \
    && ! ldd /opt/nirs4all/backend/native/studio-sidecar | grep -q 'not found' \
    && ldd /opt/nirs4all/backend/native/libn4m.so \
    && ! ldd /opt/nirs4all/backend/native/libn4m.so | grep -q 'not found' \
    && ldd /opt/nirs4all/backend/python-runtime/python/bin/python3 \
    && ! ldd /opt/nirs4all/backend/python-runtime/python/bin/python3 | grep -q 'not found' \
    && find /opt/nirs4all/backend/python-runtime/python -type f \( -name '*.so' -o -name '*.so.*' \) \
      -exec sh -eu -c 'for object do dependencies=$(ldd "$object" 2>&1) || { echo "ELF dependency scan failed: $object" >&2; echo "$dependencies" >&2; exit 1; }; case "$dependencies" in *"not found"*) echo "ELF dependency missing: $object" >&2; echo "$dependencies" >&2; exit 1;; esac; done' sh {} + \
    && ! command -v python \
    && ! command -v python3

ENV NIRS4ALL_RUNTIME_MODE=container \
    NIRS4ALL_RUNTIME_KIND=native-sidecar \
    NIRS4ALL_APP_VERSION=${STUDIO_VERSION} \
    NIRS4ALL_BUILD_INFO_PATH=/etc/nirs4all-studio-build-info.json \
    NIRS4ALL_CONFIG=/var/lib/nirs4all-studio/config \
    NIRS4ALL_BACKEND_DATA_DIR=/var/lib/nirs4all-studio \
    NIRS4ALL_PYTHON_PLUGIN_HOST=/opt/nirs4all/backend/python-runtime/python/bin/python3 \
    NIRS4ALL_PYTHON_PLUGIN_HOST_BUNDLED=true \
    NIRS4ALL_PYTHON_PLUGIN_CLOSURE=/opt/nirs4all/backend/python-runtime/PYTHON_PLUGIN_CLOSURE.json \
    NIRS4ALL_PYTHON_PLUGIN_RUNTIME_ROOT=/opt/nirs4all/backend/python-runtime/python \
    NIRS4ALL_PYTHON_PLUGIN_SITE_PACKAGES=/opt/nirs4all/backend/python-runtime/python/lib/python3.11/site-packages \
    NIRS4ALL_SCIENTIFIC_EXECUTOR=cpython-stdio-v1 \
    NIRS4ALL_DOCKER=true

VOLUME ["/var/lib/nirs4all-studio", "/workspaces"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
    CMD curl --fail --silent --show-error http://127.0.0.1:8000/api/health >/dev/null || exit 1

USER nginx
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/usr/local/bin/studio-entrypoint"]

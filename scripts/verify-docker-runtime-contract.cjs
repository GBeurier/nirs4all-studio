#!/usr/bin/env node
/** Fail closed if the product Docker image drifts back to a Python HTTP backend. */

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const dockerfile = read("Dockerfile");
const nginx = read("docker/nginx.conf");
const entrypoint = read("docker/entrypoint.sh");
const dockerignore = read(".dockerignore");
const ciWorkflow = read(".github/workflows/ci.yml");
const releaseWorkflow = read(".github/workflows/release-unified.yml");
const errors = [];

function requireText(source, needle, label) {
  if (!source.includes(needle)) errors.push(`missing ${label}: ${needle}`);
}

function forbid(source, pattern, label) {
  if (pattern.test(source)) errors.push(`forbidden ${label}: ${pattern}`);
}

requireText(dockerfile, "FROM ${NODE_IMAGE} AS frontend", "frontend build stage");
requireText(dockerfile, "FROM ${RUST_IMAGE} AS sidecar", "Rust sidecar build stage");
requireText(dockerfile, "FROM ${NGINX_IMAGE} AS runtime", "minimal web runtime stage");
requireText(dockerfile, "cargo build --locked --release", "locked Rust build");
requireText(dockerfile, "COPY --from=methods-runtime /libn4m.so.2.3.0", "native Methods named context");
requireText(dockerfile, "NIRS4ALL_METHODS_SHA256", "native Methods content identity");
requireText(dockerfile, "c.verifyRuntimeContract", "packaged runtime contract verification");
requireText(dockerfile, "requireBundledMethods:true", "mandatory Methods policy");
requireText(dockerfile, "COPY --from=native-runtime-contract", "closed native backend copy");
requireText(dockerfile, "USER nginx", "unprivileged runtime user");
requireText(dockerfile, "! command -v python", "runtime Python absence assertion");
requireText(dockerfile, "! command -v python3", "runtime Python 3 absence assertion");
requireText(dockerfile, "http://127.0.0.1:8000/api/health", "public native healthcheck");
requireText(dockerfile, 'ENTRYPOINT ["/usr/bin/tini"', "process-group supervisor");

forbid(dockerfile, /^FROM\s+python(?:\s|:)/im, "Python runtime base");
forbid(dockerfile, /(?:pip|uv)\s+install/im, "Python package installation");
forbid(dockerfile, /COPY\s+(?:main\.py|api\/|websocket\/|requirements)/im, "Python HTTP source copy");
forbid(dockerfile, /uvicorn|gunicorn|fastapi/im, "Python HTTP server");
forbid(dockerfile, /NIRS4ALL_ENABLE_PYTHON_HTTP_DIAGNOSTIC/im, "Python HTTP diagnostic owner");
forbid(dockerfile, /INSTALL_GPU|SOURCE_URL/im, "legacy Python/GPU build argument");

requireText(nginx, "server 127.0.0.1:8001;", "loopback sidecar upstream");
requireText(nginx, "listen 8000;", "single public listener");
requireText(nginx, "location /api/", "API proxy");
requireText(nginx, "location /ws", "WebSocket proxy");
requireText(nginx, "proxy_set_header Upgrade $http_upgrade;", "WebSocket upgrade forwarding");
requireText(nginx, "try_files $uri $uri/ /index.html;", "SPA fallback");
forbid(nginx, /proxy_pass\s+http:\/\/(?!studio_sidecar)/, "non-sidecar backend proxy");

requireText(entrypoint, "readonly sidecar_host=127.0.0.1", "fixed loopback bind");
requireText(entrypoint, "readonly sidecar_port=8001", "private sidecar port");
requireText(entrypoint, '/opt/nirs4all/backend/native/studio-sidecar --host "${sidecar_host}" --port "${sidecar_port}"', "sidecar launch");
requireText(entrypoint, "/sidecar/v1/readiness", "sidecar startup readiness gate");
requireText(entrypoint, "exec nginx -g 'daemon off;'", "foreground static server");
forbid(entrypoint, /python|uvicorn|main\.py|scheduler|fallback/im, "non-sidecar backend path");

for (const excluded of ["api/", "websocket/", "main.py", "requirements*.txt", "backend.spec"]) {
  requireText(dockerignore, excluded, "Python backend context exclusion");
}

requireText(ciWorkflow, "npm run test:docker-runtime-contract", "CI static Docker contract gate");
requireText(ciWorkflow, "scripts/smoke-docker-native-runtime.sh", "CI live Docker smoke");
requireText(ciWorkflow, "--build-context methods-runtime=", "CI Methods build context");
requireText(releaseWorkflow, "STUDIO_VERSION=${{ needs.prepare.outputs.version }}", "release image version");
requireText(releaseWorkflow, "STUDIO_REVISION=${{ github.sha }}", "release image revision");
requireText(releaseWorkflow, "scripts/smoke-docker-native-runtime.sh", "release live Docker smoke");
requireText(releaseWorkflow, "methods-runtime=${{ env.NIRS4ALL_BUILD_METHODS_DIRECTORY }}", "release Methods build context");
forbid(releaseWorkflow, /variant:\s*gpu-cuda|tag_suffix:\s*['"]?-gpu-cuda/im, "legacy GPU/Python image variant");

if (errors.length > 0) {
  console.error("Docker native-runtime contract failed:\n");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log("Docker native-runtime contract passed: nginx -> loopback Rust sidecar; no Python HTTP runtime");

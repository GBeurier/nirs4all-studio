#!/usr/bin/env node
/** Fail closed if the product Docker image drifts back to a Python HTTP backend. */

const fs = require("fs");
const path = require("path");
const {
  MANIFEST: adapterManifest,
  SOURCE_FILES: adapterSourceFiles,
} = require("./studio-document-adapters.cjs");

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
requireText(dockerfile, "FROM ${NODE_IMAGE} AS python-plugin-runtime", "bounded CPython plugin build stage");
requireText(dockerfile, "FROM ${NGINX_IMAGE} AS runtime", "minimal web runtime stage");
requireText(dockerfile, "FROM scratch AS studio-document-adapter-sources", "closed document adapter source stage");
requireText(
  dockerfile,
  "COPY --from=studio-document-adapter-sources / /build/",
  "document adapter sources in plugin builder",
);
requireText(
  dockerfile,
  "COPY --from=studio-document-adapter-sources / /",
  "document adapter sources in native contract verifier",
);
requireText(
  dockerfile,
  "COPY scripts/setup-python-env.cjs scripts/python-runtime-config.cjs scripts/python-http-runtime-config.cjs scripts/studio-document-adapters.cjs scripts/bake-python-plugin-runtime.cjs scripts/",
  "complete plugin builder module graph",
);
requireText(
  dockerfile,
  "COPY build/constraints/plugin-runtime-cpython311.txt build/constraints/plugin-runtime-cpython311.txt",
  "mandatory CPython constraints in plugin builder project root",
);
requireText(
  dockerfile,
  "COPY --from=studio-document-adapter-sources /api/synthetic_datasets.json api/synthetic_datasets.json",
  "Rust synthesis catalogue compile source",
);
requireText(
  dockerfile,
  "COPY --from=studio-document-adapter-sources /api/presets/ api/presets/",
  "Rust pipeline preset compile sources",
);
requireText(
  dockerfile,
  "COPY recommended-config.json recommended-config.json",
  "Rust recommended profile compile source",
);
requireText(
  dockerfile,
  "COPY scripts/native-runtime-contract.cjs scripts/studio-document-adapters.cjs scripts/bake-python-plugin-runtime.cjs /contract-scripts/",
  "complete native contract verifier module graph",
);
requireText(
  dockerfile,
  "COPY build/constraints/plugin-runtime-cpython311.txt /build/constraints/plugin-runtime-cpython311.txt",
  "mandatory CPython constraints for native runtime verification",
);
requireText(
  dockerfile,
  "COPY vite.config.ts postcss.config.js tailwind.config.ts tsconfig*.json index.html ./",
  "frontend CSS build configuration",
);
requireText(
  dockerfile,
  "COPY vendor/npm/nirs4all-ui-0.1.13.tgz vendor/npm/",
  "pinned nirs4all-ui package before npm ci",
);
requireText(dockerfile, "cargo build --locked --release", "locked Rust build");
requireText(dockerfile, "COPY --from=methods-runtime /libn4m.so.2.5.0", "native Methods named context");
requireText(dockerfile, "NIRS4ALL_METHODS_SHA256", "native Methods content identity");
requireText(dockerfile, "c.verifyRuntimeContract", "packaged runtime contract verification");
requireText(dockerfile, "requireBundledPythonPlugin:true", "mandatory CPython plugin policy");
requireText(dockerfile, "requireBundledMethods:true", "mandatory Methods policy");
requireText(dockerfile, "COPY --from=native-runtime-contract", "closed native backend copy");
requireText(dockerfile, "USER nginx", "unprivileged runtime user");
requireText(dockerfile, "NIRS4ALL_PYTHON_PLUGIN_HOST=/opt/nirs4all/backend/python-runtime/python/bin/python3", "bounded CPython host path");
requireText(dockerfile, "NIRS4ALL_PYTHON_PLUGIN_HOST_BUNDLED=true", "bundled CPython identity");
requireText(dockerfile, "NIRS4ALL_SCIENTIFIC_EXECUTOR=cpython-stdio-v1", "stdio scientific executor selection");
requireText(dockerfile, "! command -v python", "no ambient Python command");
requireText(dockerfile, "! command -v python3", "no ambient Python 3 command");
requireText(dockerfile, "find /opt/nirs4all/backend/python-runtime/python -type f", "complete CPython ELF dependency scan");
requireText(dockerfile, 'LD_LIBRARY_PATH="${object_dir}${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}" ldd "$object"', "wheel-local ELF dependency resolution");
requireText(dockerfile, "ELF dependency missing", "fail-closed CPython ELF dependency result");
requireText(dockerfile, "import scipy.linalg", "native SciPy import smoke");
requireText(dockerfile, "http://127.0.0.1:8000/_studio_health", "loopback nginx/native healthcheck");
requireText(dockerfile, "--start-period=180s", "bounded CPython startup health grace");
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
requireText(nginx, "include /var/run/nginx/studio-access.conf;", "server-wide authentication policy");
requireText(nginx, "proxy_set_header Host $http_host;", "external authority preservation");
requireText(nginx, 'proxy_set_header Authorization "";', "proxy credential stripping");
requireText(nginx, "location = /_studio_health", "private health route");
requireText(nginx, "deny all;", "health route network restriction");
requireText(nginx, "client_max_body_size 32m;", "wide spectra transport budget");
forbid(nginx, /proxy_pass\s+http:\/\/(?!studio_sidecar)/, "non-sidecar backend proxy");

requireText(entrypoint, "readonly sidecar_host=127.0.0.1", "fixed loopback bind");
requireText(entrypoint, "readonly sidecar_port=8001", "private sidecar port");
requireText(entrypoint, '/opt/nirs4all/backend/native/studio-sidecar --host "${sidecar_host}" --port "${sidecar_port}"', "sidecar launch");
requireText(entrypoint, "/sidecar/v1/readiness", "sidecar startup readiness gate");
requireText(entrypoint, "readonly readiness_attempt_limit=600", "attested runtime startup allowance");
requireText(entrypoint, "sleep 0.25", "bounded readiness polling interval");
requireText(entrypoint, "exec nginx -g 'daemon off;'", "foreground static server");
requireText(entrypoint, '/run/secrets/studio.htpasswd', "mounted proxy credential file");
requireText(entrypoint, '${NIRS4ALL_STUDIO_TRUSTED_LOCAL_ONLY:-}', "explicit local-only opt-in");
requireText(entrypoint, 'nginx -t', "proxy startup configuration validation");
forbid(entrypoint, /python|uvicorn|main\.py|scheduler|fallback/im, "non-sidecar backend path");

for (const excluded of ["api/", "websocket/", "main.py", "requirements*.txt", "backend.spec"]) {
  requireText(dockerignore, excluded, "Python backend context exclusion");
}
for (const adapterSource of adapterSourceFiles) {
  requireText(dockerfile, `"${adapterSource}"`, "document adapter staged source inventory");
  requireText(dockerignore, `!${adapterSource}`, "document adapter context allowlist");
}
requireText(dockerfile, '"src/data/nodes/definitions/"', "document adapter node definitions inventory");
requireText(dockerfile, '"src/data/nodes/generated/canonical-registry.json"', "canonical node registry inventory");
requireText(dockerfile, `"${adapterManifest}"`, "document adapter manifest inventory");
requireText(dockerignore, "!recommended-config.json", "plugin build configuration inclusion");
for (const compileSource of [
  "api/synthetic_datasets.json",
  "api/presets/complex_pls.yaml",
  "api/presets/complex_trees.yaml",
  "api/presets/deep_nonlinear_exploration.yaml",
  "api/presets/fast_result.yaml",
  "api/presets/nonlinear_exploration.yaml",
  "api/presets/simple_pls.yaml",
  "api/presets/simple_trees_boosting.yaml",
  "api/presets/ultra_pls.yaml",
  "api/presets/ultra_slow.yaml",
  "api/presets/ultra_trees.yaml",
]) {
  requireText(dockerfile, `"${compileSource}"`, "Rust sidecar compile-source inventory");
  requireText(dockerignore, `!${compileSource}`, "Rust sidecar compile-source allowlist");
}
requireText(dockerignore, "!build/", "constraints parent context allowlist");
requireText(dockerignore, "!build/constraints/", "constraints directory context allowlist");
requireText(
  dockerignore,
  "!build/constraints/plugin-runtime-cpython311.txt",
  "mandatory CPython constraints context allowlist",
);
forbid(dockerignore, /^(?:postcss\.config\.js|tailwind\.config\.ts)\/?$/m, "frontend CSS build configuration exclusion");

requireText(ciWorkflow, "scripts/smoke-docker-native-runtime.sh", "CI live Docker smoke");
requireText(ciWorkflow, "scripts/test-docker-access.cjs", "CI live Docker authentication gate");
requireText(releaseWorkflow, "scripts/test-docker-access.cjs", "release live Docker authentication gate");
const dockerSmoke = read("scripts/smoke-docker-native-runtime.sh");
requireText(dockerSmoke, "--env NIRS4ALL_STUDIO_TRUSTED_LOCAL_ONLY=1", "explicit local smoke trust boundary");
requireText(dockerSmoke, "seq 1 360", "bounded live startup allowance");
requireText(dockerSmoke, 'trap \'report_error "${LINENO}" "${BASH_COMMAND}"\' ERR', "actionable live smoke diagnostics");
requireText(dockerSmoke, "root_page=$(curl --fail --silent", "complete SPA response capture");
forbid(dockerSmoke, /curl[^\n]*\|\s*grep\s+-q/, "pipefail-sensitive early-closing curl pipeline");
requireText(dockerSmoke, "pythonCapabilities.nirs4all !== true", "nirs4all capability import assertion");
requireText(dockerSmoke, "scientific_execution !== false", "fresh unconfigured scientific capability assertion");
requireText(dockerSmoke, "schema_version\":2", "minimal V2 dataset catalogue seed");
requireText(dockerSmoke, "scientific_execution !== true", "configured scientific capability assertion");
requireText(dockerSmoke, "implicit_python_http_fallback !== false", "transition fallback refusal assertion");
requireText(dockerSmoke, 'message.type !== "connected"', "live WebSocket connected-envelope assertion");
requireText(dockerSmoke, 'message.data?.client_id !== "docker-smoke"', "live WebSocket client identity assertion");
requireText(dockerSmoke, 'public_socket && !inherited_port_80_socket', "actual public listener boundary assertion");
requireText(dockerSmoke, '!Object.hasOwn(exposedPorts, "8000/tcp")', "public Docker port metadata assertion");
requireText(dockerSmoke, 'Object.hasOwn(exposedPorts, "8001/tcp")', "sidecar Docker port metadata exclusion");

requireText(ciWorkflow, "npm run test:docker-runtime-contract", "CI static Docker contract gate");
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

console.log("Docker native-runtime contract passed: nginx -> loopback Rust sidecar + bounded CPython stdio plugin");

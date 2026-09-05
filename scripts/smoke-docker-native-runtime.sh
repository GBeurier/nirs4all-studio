#!/usr/bin/env bash
set -Eeuo pipefail

image="${1:-nirs4all-studio:native-smoke}"
container="nirs4all-studio-native-smoke-${RANDOM}-$$"
capability_error_file=""

report_error() {
  local status="$?"
  local line="$1"
  local command="$2"
  trap - ERR
  echo "Docker native runtime smoke failed at line ${line}: ${command} (exit ${status})" >&2
  if docker inspect "${container}" >/dev/null 2>&1; then
    echo "--- container logs ---" >&2
    docker logs "${container}" >&2 || true
  fi
  exit "${status}"
}

trap 'report_error "${LINENO}" "${BASH_COMMAND}"' ERR

cleanup() {
  docker rm -f "${container}" >/dev/null 2>&1 || true
  if [[ -n "${capability_error_file}" ]]; then
    rm -f "${capability_error_file}"
  fi
}
trap cleanup EXIT

docker run --detach --name "${container}" --publish 127.0.0.1::8000 \
  --env NIRS4ALL_STUDIO_TRUSTED_LOCAL_ONLY=1 "${image}" >/dev/null

port=""
for _ in $(seq 1 360); do
  port=$(docker port "${container}" 8000/tcp 2>/dev/null | sed -n 's/.*://p' | head -n1)
  if [[ -n "${port}" ]] && curl --fail --silent "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

test -n "${port}"
root_page=$(curl --fail --silent "http://127.0.0.1:${port}/")
grep -q '<div id="root">' <<< "${root_page}"
health=$(curl --fail --silent "http://127.0.0.1:${port}/api/health")
capability_error_file=$(mktemp)
capability_status=$(curl --silent --output "${capability_error_file}" --write-out '%{http_code}' \
  "http://127.0.0.1:${port}/api/system/capabilities")
capability_response=$(cat "${capability_error_file}")
capabilities=$(docker exec "${container}" curl --fail --silent \
  http://127.0.0.1:8001/sidecar/v1/capabilities)
node -e '
  const health = JSON.parse(process.argv[1]);
  const capabilityStatus = process.argv[2];
  const capabilityResponse = JSON.parse(process.argv[3]);
  const capabilities = JSON.parse(process.argv[4]);
  if (health.status !== "ok" && health.status !== "healthy") throw new Error("unexpected native health response");
  if (capabilityStatus !== "200") throw new Error("bounded Python plugin host is unavailable");
  const pythonCapabilities = capabilityResponse?.capabilities;
  const expectedPythonCapabilities = ["autogluon", "jax", "nirs4all", "shap", "tensorflow", "torch", "umap"];
  if (!pythonCapabilities || typeof pythonCapabilities !== "object" || Array.isArray(pythonCapabilities)) {
    throw new Error("unexpected Python capability response");
  }
  if (JSON.stringify(Object.keys(pythonCapabilities).sort()) !== JSON.stringify(expectedPythonCapabilities)) {
    throw new Error("unexpected Python capability keys");
  }
  if (Object.values(pythonCapabilities).some((available) => typeof available !== "boolean")) {
    throw new Error("Python capabilities must be booleans");
  }
  if (pythonCapabilities.nirs4all !== true) throw new Error("nirs4all plugin import is unavailable");
  if (capabilities.features?.implicit_python_http_fallback !== false) throw new Error("Python HTTP fallback is not disabled");
  if (capabilities.python_plugin_host !== "configured") throw new Error("bounded Python host is not configured");
  if (capabilities.features?.scientific_execution !== false) throw new Error("fresh runtime unexpectedly selected scientific execution without a dataset catalogue");
  if (capabilities.features?.python_plugin_execution !== false) throw new Error("fresh runtime unexpectedly selected Python execution without a dataset catalogue");
  if (capabilities.features?.native_archive_v2_prediction !== true) throw new Error("native Methods archive replay is unavailable");
' "${health}" "${capability_status}" "${capability_response}" "${capabilities}"

# Scientific execution is selected dynamically only after the Rust-owned
# resolver has a valid catalogue. Seed the smallest valid V2 document in the
# fresh state volume and prove the capability transition without restarting or
# replacing the Rust HTTP owner.
docker exec "${container}" sh -eu -c '
  test ! -e "${NIRS4ALL_CONFIG}/dataset_links.json"
  printf "%s\n" '\''{"version":"1.0","schema_version":2,"datasets":[],"groups":[]}'\'' \
    > "${NIRS4ALL_CONFIG}/dataset_links.json"
'
configured_capabilities=$(docker exec "${container}" curl --fail --silent \
  http://127.0.0.1:8001/sidecar/v1/capabilities)
node -e '
  const capabilities = JSON.parse(process.argv[1]);
  if (capabilities.features?.scientific_execution !== true) throw new Error("valid catalogue did not select CPython stdio scientific execution");
  if (capabilities.features?.python_plugin_execution !== true) throw new Error("valid catalogue did not select Python plugin execution");
  if (capabilities.features?.implicit_python_http_fallback !== false) throw new Error("Python HTTP fallback changed during capability transition");
' "${configured_capabilities}"

node --input-type=module -e '
  const socket = new WebSocket(process.argv[1]);
  const fail = (message) => {
    clearTimeout(timeout);
    console.error(`Docker WebSocket smoke failed: ${message}`);
    socket.close();
    process.exit(1);
  };
  const timeout = setTimeout(() => fail("connected envelope timed out"), 5000);
  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      fail(`invalid JSON: ${error.message}`);
      return;
    }
    if (message.type !== "connected" || message.data?.client_id !== "docker-smoke") {
      fail("unexpected connected envelope");
      return;
    }
    clearTimeout(timeout);
    socket.close();
    process.exit(0);
  });
  socket.addEventListener("close", () => fail("connection closed before connected envelope"));
  socket.addEventListener("error", () => fail("connection error"));
' "ws://127.0.0.1:${port}/ws?client_id=docker-smoke"

docker exec "${container}" sh -eu -c '
  test -x /opt/nirs4all/backend/native/studio-sidecar
  test -f /opt/nirs4all/backend/native/libn4m.so
  test -f /opt/nirs4all/backend/native/STUDIO_RUNTIME_CONTRACT.json
  test -x /opt/nirs4all/backend/python-runtime/python/bin/python3
  test -f /opt/nirs4all/backend/python-runtime/PLUGIN_RUNTIME_READY.json
  test -f /opt/nirs4all/backend/python-runtime/PYTHON_PLUGIN_CLOSURE.json
  ! command -v python
  ! command -v python3
  test ! -e /app/main.py
  test ! -d /app/api
  test ! -d /app/websocket
  awk '\''$2 == "0100007F:1F41" && $4 == "0A" { sidecar_loopback = 1 }
       $2 == "00000000:1F41" && $4 == "0A" { sidecar_wildcard = 1 }
       $2 == "00000000:1F40" && $4 == "0A" { public_socket = 1 }
       $2 ~ /:0050$/ && $4 == "0A" { inherited_port_80_socket = 1 }
       END { exit !(sidecar_loopback && !sidecar_wildcard && public_socket && !inherited_port_80_socket) }'\'' \
    /proc/net/tcp /proc/net/tcp6
'

exposed_ports=$(docker inspect --format '{{json .Config.ExposedPorts}}' "${container}")
node -e '
  const exposedPorts = JSON.parse(process.argv[1]);
  if (!Object.hasOwn(exposedPorts, "8000/tcp")) throw new Error("public port 8000 is not exposed");
  if (Object.hasOwn(exposedPorts, "8001/tcp")) throw new Error("loopback sidecar port 8001 must not be exposed");
' "${exposed_ports}"
echo "Docker native runtime smoke passed on http://127.0.0.1:${port}"

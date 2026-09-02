#!/usr/bin/env bash
set -euo pipefail

image="${1:-nirs4all-studio:native-smoke}"
container="nirs4all-studio-native-smoke-${RANDOM}-$$"
capability_error_file=""

cleanup() {
  docker rm -f "${container}" >/dev/null 2>&1 || true
  if [[ -n "${capability_error_file}" ]]; then
    rm -f "${capability_error_file}"
  fi
}
trap cleanup EXIT

docker run --detach --name "${container}" --publish 127.0.0.1::8000 "${image}" >/dev/null

port=""
for _ in $(seq 1 60); do
  port=$(docker port "${container}" 8000/tcp 2>/dev/null | sed -n 's/.*://p' | head -n1)
  if [[ -n "${port}" ]] && curl --fail --silent "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

test -n "${port}"
curl --fail --silent "http://127.0.0.1:${port}/" | grep -q '<div id="root">'
health=$(curl --fail --silent "http://127.0.0.1:${port}/api/health")
capability_error_file=$(mktemp)
capability_status=$(curl --silent --output "${capability_error_file}" --write-out '%{http_code}' \
  "http://127.0.0.1:${port}/api/system/capabilities")
capability_error=$(cat "${capability_error_file}")
capabilities=$(docker exec "${container}" curl --fail --silent \
  http://127.0.0.1:8001/sidecar/v1/capabilities)
node -e '
  const health = JSON.parse(process.argv[1]);
  const capabilityStatus = process.argv[2];
  const capabilityError = JSON.parse(process.argv[3]);
  const capabilities = JSON.parse(process.argv[4]);
  if (health.status !== "ok" && health.status !== "healthy") throw new Error("unexpected native health response");
  if (capabilityStatus !== "503") throw new Error("absent Python host did not fail closed");
  if (capabilityError.error?.code !== "python_plugin_unavailable") throw new Error("unexpected Python host refusal");
  if (capabilities.features?.implicit_python_http_fallback !== false) throw new Error("Python HTTP fallback is not disabled");
  if (capabilities.python_plugin_host !== "unconfigured") throw new Error("default image unexpectedly configured a Python host");
  if (capabilities.features?.native_archive_v2_prediction !== true) throw new Error("native Methods archive replay is unavailable");
' "${health}" "${capability_status}" "${capability_error}" "${capabilities}"

node --input-type=module -e '
  const socket = new WebSocket(process.argv[1]);
  const timeout = setTimeout(() => { socket.close(); process.exit(1); }, 5000);
  socket.addEventListener("open", () => { clearTimeout(timeout); socket.close(); });
  socket.addEventListener("close", () => process.exit(0));
  socket.addEventListener("error", () => { clearTimeout(timeout); process.exit(1); });
' "ws://127.0.0.1:${port}/ws?client_id=docker-smoke"

docker exec "${container}" sh -eu -c '
  test -x /opt/nirs4all/backend/native/studio-sidecar
  test -f /opt/nirs4all/backend/native/libn4m.so
  test -f /opt/nirs4all/backend/native/STUDIO_RUNTIME_CONTRACT.json
  ! command -v python
  ! command -v python3
  test ! -e /app/main.py
  test ! -d /app/api
  test ! -d /app/websocket
  awk '\''$2 == "0100007F:1F41" && $4 == "0A" { loopback = 1 }
       $2 == "00000000:1F41" && $4 == "0A" { wildcard = 1 }
       END { exit !(loopback && !wildcard) }'\'' /proc/net/tcp
'

test "$(docker inspect --format '{{json .Config.ExposedPorts}}' "${container}")" = '{"8000/tcp":{}}'
echo "Docker native runtime smoke passed on http://127.0.0.1:${port}"

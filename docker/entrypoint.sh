#!/bin/sh
set -eu

readonly sidecar_host=127.0.0.1
readonly sidecar_port=8001
readonly readiness_url="http://${sidecar_host}:${sidecar_port}/sidecar/v1/readiness"

/usr/local/bin/studio-sidecar --host "${sidecar_host}" --port "${sidecar_port}" &
sidecar_pid=$!

attempt=0
while ! curl --fail --silent --show-error "${readiness_url}" >/dev/null; do
    if ! kill -0 "${sidecar_pid}" 2>/dev/null; then
        wait "${sidecar_pid}"
        exit $?
    fi
    attempt=$((attempt + 1))
    if [ "${attempt}" -ge 50 ]; then
        echo "studio-entrypoint: Rust sidecar readiness timed out" >&2
        kill "${sidecar_pid}" 2>/dev/null || true
        wait "${sidecar_pid}" 2>/dev/null || true
        exit 1
    fi
    sleep 0.1
done

exec nginx -g 'daemon off;'

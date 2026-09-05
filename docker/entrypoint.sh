#!/bin/sh
set -eu

readonly sidecar_host=127.0.0.1
readonly sidecar_port=8001
readonly readiness_url="http://${sidecar_host}:${sidecar_port}/sidecar/v1/readiness"
readonly readiness_attempt_limit=600

# Authentication is enforced by nginx for the entire SPA, HTTP API and WS.
# Fixed paths/directives avoid interpolating user input into nginx syntax.
if [ -n "${NIRS4ALL_STUDIO_SESSION_TOKEN:-}" ]; then
    echo "studio-entrypoint: Docker uses /run/secrets/studio.htpasswd, not the desktop session-token option" >&2
    exit 1
fi
if [ -r /run/secrets/studio.htpasswd ] && [ -s /run/secrets/studio.htpasswd ]; then
    printf '%s\n' 'auth_basic "nirs4all Studio";' \
        'auth_basic_user_file /run/secrets/studio.htpasswd;' \
        > /var/run/nginx/studio-access.conf
elif [ "${NIRS4ALL_STUDIO_TRUSTED_LOCAL_ONLY:-}" = 1 ]; then
    echo "studio-entrypoint: trusted local-only mode; publish only on 127.0.0.1, never a shared network" >&2
    printf '%s\n' 'auth_basic off;' > /var/run/nginx/studio-access.conf
else
    echo "studio-entrypoint: mount a non-empty readable /run/secrets/studio.htpasswd, or explicitly set NIRS4ALL_STUDIO_TRUSTED_LOCAL_ONLY=1 with a loopback-only port mapping" >&2
    exit 1
fi
nginx -t

/opt/nirs4all/backend/native/studio-sidecar --host "${sidecar_host}" --port "${sidecar_port}" &
sidecar_pid=$!

attempt=0
while ! curl --fail --silent --show-error "${readiness_url}" >/dev/null; do
    if ! kill -0 "${sidecar_pid}" 2>/dev/null; then
        wait "${sidecar_pid}"
        exit $?
    fi
    attempt=$((attempt + 1))
    if [ "${attempt}" -ge "${readiness_attempt_limit}" ]; then
        echo "studio-entrypoint: Rust sidecar readiness timed out" >&2
        kill "${sidecar_pid}" 2>/dev/null || true
        wait "${sidecar_pid}" 2>/dev/null || true
        exit 1
    fi
    sleep 0.25
done

exec nginx -g 'daemon off;'

# Native HTTP access boundary

The Rust product backend binds only to a loopback IP. It validates HTTP and
WebSocket handshakes before reading request bodies: a valid Host is required,
foreign browser origins are refused, and non-empty request bodies require JSON.
Duplicate security/framing headers are rejected. Accepted browser origins get
an exact CORS response, never a wildcard.

## Desktop

Electron generates a fresh 256-bit session credential for each sidecar process.
Every HTTP request and WebSocket handshake requires `X-Nirs4all-Session`.
The credential stays in the main process and child environment; it is not
returned by the runtime-info IPC or put into renderer storage or URLs.
The main process injects it only for the actual Studio document and exact
running sidecar authority. Navigation to other documents and new windows is
blocked. Packaged Chromium's `null` (fetch) and `file://` (WebSocket) origins
are accepted only with this credential.

This protects against unrelated websites/documents, not a compromised local
account, main process, or code executing inside the trusted Studio document.

## Direct development and reverse proxies

Without a session credential, direct loopback mode trusts local clients and
loopback browser origins, including the Vite development server. It is not a
multi-user service. To require a credential for non-Electron clients, set
`NIRS4ALL_STUDIO_SESSION_TOKEN` to 32–256 random ASCII letters/digits before
startup and supply the header on every request, including readiness and WS.

`NIRS4ALL_STUDIO_ALLOWED_ORIGINS` is an optional comma-separated list of exact
HTTP(S) origins (scheme, host, port), for a separately authenticated reverse
proxy. The proxy must preserve the external Host. This setting is an origin
allowlist, **not authentication**. Do not expose a native endpoint to an
untrusted network without an authenticated TLS reverse proxy.

## Docker

The default container refuses startup unless `/run/secrets/studio.htpasswd` is
mounted, readable by the nginx user and non-empty. nginx HTTP Basic
authentication protects the complete SPA, API and WebSocket handshake; the
password header is not forwarded to Rust. All authenticated users share the
same workspace privileges: this is not per-user authorization or isolation.

Create the file interactively with `htpasswd -cB studio.htpasswd alice` (bcrypt),
store it outside the repository, and mount it read-only. For remote access, use
a TLS terminator in front of nginx; never send Basic credentials over an
untrusted cleartext connection. Configure the exact public origin, preserve
Host at the TLS proxy, and keep the container port on host loopback:

```sh
docker run --rm -p 127.0.0.1:8000:8000 \
  --mount type=bind,src=/secure/studio.htpasswd,dst=/run/secrets/studio.htpasswd,readonly \
  -e NIRS4ALL_STUDIO_ALLOWED_ORIGINS=https://studio.example \
  -v studio-state:/var/lib/nirs4all-studio \
  -v /path/to/workspaces:/workspaces nirs4all-studio:{version}
```

Local single-user development can explicitly set
`NIRS4ALL_STUDIO_TRUSTED_LOCAL_ONLY=1` instead of providing a password file.
This mode must use `-p 127.0.0.1:8000:8000`; the container cannot verify Docker's
host port mapping. It is not safe for a shared LAN. A mounted password file
takes precedence over local-only mode. Desktop session-token configuration is
rejected in Docker; nginx is the public authentication boundary there.

The internal nginx health exception is restricted by client IP to loopback,
not by a spoofable forwarding header. It is not public. See nginx's
[authentication module](https://nginx.org/en/docs/http/ngx_http_auth_basic_module.html)
for supported password formats.

## Verification

`cargo test --manifest-path sidecar/Cargo.toml http_access` includes real TCP
requests, rejected mutations, duplicate headers, early credential rejection,
WebSocket refusal, and successful authenticated CORS requests.
`npm run test:native-sidecar` includes credential-lifecycle and document tests.
For the real Electron acceptance probe, build the sidecar and run:

```sh
cargo build --locked --manifest-path sidecar/Cargo.toml --bin studio-sidecar
NIRS4ALL_NATIVE_SIDECAR_PATH="$PWD/sidecar/target/debug/studio-sidecar" \
  xvfb-run -a npm run test:native-session-auth
```

The headless probe alone disables Chromium sandboxing for CI; the product does
not. It exercises actual renderer GET/JSON POST/CORS/WS, and verifies refusal
of both a credential-free native client and an unrelated local document.

`node scripts/test-docker-access.cjs IMAGE --browser` checks the built product container:
default startup refusal, explicit local-only mode, authenticated SPA/API/WS,
wrong/missing credentials, cross-origin mutations, and the restricted health
exception, plus actual Chromium navigation/fetch/JSON mutation/WebSocket with
HTTP credentials. Install npm dependencies and `npx playwright install chromium`
first. CI and release workflows run it before container publication.
The optional `--sidecar /absolute/path/studio-sidecar` mode with image
`nginx:1.27.5-bookworm` mounts a fresh binary and the production nginx/entrypoint
to qualify transport separately; it does not qualify the packaged science host.

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
allowlist, **not authentication**. Do not expose the current Docker/native
endpoint to an untrusted network without an authenticated TLS reverse proxy.
Local Docker port mappings must bind explicitly to `127.0.0.1`.

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

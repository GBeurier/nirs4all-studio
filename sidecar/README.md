# Studio native sidecar (R1)

`sidecar/` owns Studio's future native executable.  It is intentionally a
separate Cargo package, not a Tauri application and not an Electron switch.
The only executable is `studio-sidecar`.

## Status and boundary

R1 provides a small local HTTP control surface only:

- `GET /sidecar/v1/health`
- `GET /sidecar/v1/readiness`
- `GET /sidecar/v1/capabilities`
- `GET /sidecar/v1/python/preflight` (only checks a configured local Python
  host can `import nirs4all`; it does not run a scientific job)
- `POST /sidecar/v1/jobs` (creates a non-scientific, in-memory control record)
- `GET /sidecar/v1/jobs/{job_id}`
- `POST /sidecar/v1/jobs/{job_id}/cancel`
- `GET /sidecar/v1/ws` (only a valid WebSocket Upgrade request receives the
  explicit unavailable `426`; ordinary HTTP requests receive `400`)
- `GET /api/health` and `GET /api/system/readiness` (the frozen
  post-lifespan bootstrap responses only)
- `GET /api/system/capabilities` (an explicit Rust-owned route which invokes
  the configured Python plugin host only to inspect optional imports)
- `GET /api/system/info` (the same bounded host bridge for the Settings system
  inventory; it does not create or run a job)
- `GET /api/system/env-coherence` (Rust-owned Settings runtime alignment; the
  configured Python is only the explicit library/plugin host, never an HTTP
  backend)
- `GET` / `PUT /api/app/settings` (Rust-owned app preferences)
- `GET` / `POST` / `DELETE /api/app/favorites` (Rust-owned favorite pipeline
  identifiers)
- `GET` / `POST` / `DELETE /api/app/config-path` (Rust-owned configuration
  directory selection; changes explicitly require restart)

It does **not** launch Python/CPython as an HTTP backend, Uvicorn, or FastAPI;
it has no fallback launcher. An explicitly configured CPython may run only as a
bounded library/plugin host for the routes above. The sidecar contains no
scientific calculation, dataset/workspace persistence,
arbitrary file-I/O API, or reimplementation of nirs4all stores. It persists
only its own app-level preferences and favorite identifiers. All other UI
routes remain served by the legacy FastAPI process.

`docs/contracts/studio-v1/` remains the frozen legacy FastAPI baseline. R1
references that snapshot in tests to prevent an accidental parity claim. The
sidecar exposes only the frozen post-lifespan health and readiness responses
under `/api/*`; it does not expose `/ws` or assert replacement compatibility.

## Build and future Electron launch contract

From this directory:

```sh
cargo build --release
./target/release/studio-sidecar --host 127.0.0.1 --port 0
```

Electron launches the packaged binary from its resource location, passes a
loopback host and an explicit or ephemeral port, and waits for the single stdout
line beginning `STUDIO_SIDECAR_READY `. The JSON on that line has
`protocol_version`, `host`, and the bound `port`. For a development binary,
set `NIRS4ALL_NATIVE_SIDECAR_PATH`. The legacy backend remains responsible for
every route not explicitly listed above.

The binary accepts only `127.0.0.1` or `::1` for `--host`. This is a local
desktop control process, not a network service.

For a no-server CLI readiness check:

```sh
cargo run --quiet -- --smoke-readiness
```

## R1 protocol

Protocol version: `studio-sidecar-r1`.

`GET /sidecar/v1/readiness` includes `sidecar_ready`, `protocol_version`,
`legacy_contract_baseline`, `legacy_route_parity`, `scientific_execution`,
`job_execution`, and `uptime_ms`. `legacy_route_parity` is `bootstrap`: only
health and readiness match their frozen post-lifespan responses.
`scientific_execution` and `job_execution` are always `unavailable` in R1.
`GET /sidecar/v1/capabilities` therefore reports
`api_route_coverage: "bootstrap_system_and_app_state"`,
`legacy_api_routes: false`, and
`unmigrated_api_routes_require_legacy_backend: true`. These fields make the
partial migration machine-readable: a caller must not treat the sidecar as
full API parity or silently redirect an unmigrated product route to Python.
The Python bridge actions are available only when `NIRS4ALL_PYTHON_PLUGIN_HOST`
is set. `GET /sidecar/v1/python/preflight` launches that product-owned
interpreter with `-I`, bounds it to three seconds, and checks `import nirs4all`.
`GET /api/system/capabilities` and `GET /api/system/info` use the same bridge
with a bounded 15-second optional-import probe. `GET /api/system/env-coherence`
uses a bounded three-second import/runtime probe and reports `python_plugin_host`
as the runtime kind. All three return their legacy response shapes without
launching a scientific job. All bridge routes are capability evidence, never
transparent Python fallback.

App settings are stored in `app_settings.json` using the same precedence as the
legacy application: `NIRS4ALL_CONFIG`, portable-root configuration, the
portable executable's `.nirs4all/config`, a valid redirect file, then the
platform configuration directory. The store has a versioned default shape;
preference updates deep-merge `ui_preferences`, favorite operations are
idempotent, and writes use a synced temporary file followed by rename. The
sidecar owns the compatible `config_redirect.txt` selector: a custom target
must already exist, the redirect is stored at the platform-default path, and
the response always declares `requires_restart: true`. The sidecar never reads
or writes workspace or dataset state.

All-in-one packaging builds the sidecar as
`resources/backend/native/studio-sidecar` next to the embedded
`resources/backend/python-runtime/`. Packaged Electron starts the sidecar and
passes the matching embedded Python as its explicit plugin host. Neither choice
selects Python as an HTTP fallback.

All errors use:

```json
{"error":{"code":"route_not_found","message":"...","retryable":false,"details":{"path":"..."}}}
```

Defined codes are `invalid_request` (false), `route_not_found` (false),
`method_not_allowed` (false), `job_not_found` (false), `job_capacity_exceeded`
(false), `request_timeout` (false), and `websocket_upgrade_required` (false).
`details` is an object reserved for machine-readable context. Known routes
return `405` with an `Allow` header when the method is wrong.

Job IDs are opaque `job-r1-*` identifiers. R1 records are control-plane
placeholders only, with statuses `pending` and `cancelled`. Cancellation is
idempotent: cancelling a known job always returns 200 and leaves a cancelled
job cancelled. It never force-kills or controls a legacy Python job.

Control records are bounded to 64 entries and expire after five minutes.
Expired records are removed first; when full, the oldest cancelled record is
removed; a full set of pending records is refused with `429`. The GET response
always preserves `cancellation_idempotent: true` as a protocol invariant.

The planned WS envelope is explicit even though R1 does not accept upgrades:

```json
{"protocol_version":"studio-sidecar-r1","channel":"job:<opaque-id>","sequence":1,"timestamp":"RFC3339 UTC","type":"job.cancelled","data":{}}
```

`channel`, monotonically increasing per-channel `sequence`, and RFC3339 UTC
`timestamp` are required. `WsFrame::new` fixes the protocol version,
restricts channels to `job:<opaque-id>` and job lifecycle events, and accepts
only bounded JSON-object data. This is a scaffold, not a claim of legacy
WebSocket parity or a live subscription service.

## Coverage and rollback

Covered: local liveness/readiness, frozen bootstrap health/readiness,
capabilities, versioned error envelopes, opaque control-job records and
idempotent cancellation, bounded Python plugin-host preflight, the first three
Rust-owned legacy-compatible system routes, native app preferences/favorites
and config-path selection,
all-in-one binary packaging, and Electron's explicit loopback-only lifecycle
management. Missing: every other legacy `/api/*` route, all scientific
execution, workspace/dataset persistence, uploads, authentication, live
WebSocket upgrades, job execution, and parity mapping/diffing for the full
frozen surface.

Rollback is exclusion of the sidecar binary/resource and routing the listed
routes back to the legacy backend. `app_settings.json` has the legacy-compatible
shape, so the legacy application can continue to read it; rollback leaves
workspace and dataset state untouched.

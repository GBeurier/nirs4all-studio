# Studio native sidecar (R1)

`sidecar/` owns Studio's packaged native control-plane executable. It is intentionally a
separate Cargo package, not a Tauri application and not an Electron switch.
The only executable is `studio-sidecar`.

## Status and boundary

R1 provides a small local HTTP control surface, a bounded native WebSocket
transport, and registered read/cancel aliases for native jobs:

- `GET /sidecar/v1/health`
- `GET /sidecar/v1/readiness`
- `GET /sidecar/v1/capabilities`
- `GET /sidecar/v1/python/preflight` (only checks a configured local Python
  host can `import nirs4all`; it does not run a scientific job)
- `GET /sidecar/v1/workspaces/:id/run-detail-preselection` (read-only Store-v5
  eligibility proof; it cannot select the unregistered run-detail target)
- `POST /sidecar/v1/jobs` (creates a non-scientific, in-memory control record)
- `GET /sidecar/v1/jobs/{job_id}`
- `POST /sidecar/v1/jobs/{job_id}/cancel`
- `GET /sidecar/v1/ws` (only a valid WebSocket Upgrade request receives the
  explicit unavailable `426`; ordinary HTTP requests receive `400`)
- `GET /ws`, `GET /ws/job/:job_id`, and `GET /ws/training/:job_id` accept
  bounded RFC 6455 upgrades on the sidecar port. Electron does not select them
  yet; the two job-specific aliases auto-subscribe to `job:<job_id>`.
- `GET /api/training/:job_id`, `GET /api/automl/:job_id`, and
  `GET /api/updates/webapp/download-status/:job_id` read authoritative native
  job state in the frozen legacy response shapes.
- `POST /api/training/:job_id/stop`, `POST /api/automl/:job_id/stop`,
  `POST /api/runs/execution-job-records/:job_id/cancel`,
  `POST /api/runs/:run_id/stop`, and
  `POST /api/updates/webapp/download-cancel/:job_id` share the same native
  cooperative-cancellation state and event stream.
- `GET /api/runs/execution-job-records/:job_id` and
  `GET /api/runs/:run_id/execution-job-record` read the active workspace's
  bounded immutable `execution_job_record.json` snapshot and enrich known runs
  only through Store v5. They never query the in-memory job registry.
- `POST /api/runs/run-groups` is a closed, bounded Rust submission transport.
  The product default refuses with `503` before parsing the body or reading a
  workspace because no scientific executor is selected. An explicitly
  injected executor is preflighted only after strict payload and active
  workspace validation; Rust then owns the job registry, the single initial
  `job_started` publication, cooperative cancellation, and atomic
  `execution_job_record.json` persistence. This route never selects a Python
  HTTP server or retry fallback.
- `POST /api/training/native-archive-v2` is the bounded native researcher
  workflow. Rust resolves one persisted IO dataset and selected dense source,
  then composes IO -> DAG-ML -> Methods -> Core to train the exact
  `SNV(ddof=0) -> Savitzky-Golay(mode=interp) -> PLS` profile, persist Archive
  V2, and register it in Store v5. It supports named multi-target regression;
  fusion, N-D payloads, HPO, CPython, and fallback are refused.
- `GET /api/health` and `GET /api/system/readiness` (the frozen
  post-lifespan bootstrap responses only)
- `GET /api/system/capabilities` (an explicit Rust-owned route which invokes
  the configured Python plugin host only to inspect optional imports)
- `GET /api/system/info` (the same bounded host bridge for the Settings system
  inventory; it does not create or run a job)
- `GET /api/system/build` (Rust-owned build metadata plus a bounded optional
  `torch` probe in the configured Python library host; it does not create or
  run a job)
- `GET /api/system/network` (Rust-owned offline preference state; it reads the
  established bounded `update_settings.yaml` preference file and never probes
  a host or invokes Python)
- `GET /api/system/status` (Rust-owned active linked-workspace catalogue state;
  it does not scan a workspace or load dataset/store contents)
- `GET /api/updates/version` (Rust-owned version inventory; Electron provides
  the application version and the bounded Python library host reports only the
  installed `nirs4all` version and interpreter facts)
- `GET /api/updates/runtime/status` (Rust-owned runtime diagnostics; it reads
  runtime metadata and measures the runtime locally while a bounded Python host
  reports only its installed distributions)
- `GET` / `PUT /api/updates/settings` (Rust-owned update preferences; it
  preserves the legacy YAML file and PATCH-compatible update shape)
- `GET /api/system/env-coherence` (Rust-owned Settings runtime alignment; the
  configured Python is only the explicit library/plugin host, never an HTTP
  backend)
- `GET` / `PUT /api/app/settings` (Rust-owned app preferences)
- `GET` / `POST` / `DELETE /api/app/favorites` (Rust-owned favorite pipeline
  identifiers)
- `GET` / `POST` / `DELETE /api/app/config-path` (Rust-owned configuration
  directory selection; changes explicitly require restart)
- `GET /api/workspaces`, `POST /api/workspaces/:id/activate`, and
  `DELETE /api/workspaces/:id` (Rust-owned linked-workspace catalogue,
  activation and unlinking; no filesystem scan, dataset read, or scientific
  execution)
- `GET /api/workspace/transition-status` performs the bounded legacy marker
  diagnosis in Rust. It never opens a Python route or deeply parses a legacy
  artifact; unsafe/unreadable stores are reported as requiring preflight
  rather than being called compatible.
- `POST /api/workspace/legacy-convert` validates the renderer request in Rust,
  then invokes exactly `nirs4all_tools legacy migrate` through the configured
  CPython library host as one isolated, bounded stdio process. Only a requested
  `--verify` conversion returning code `0` may be linked and activated. Code
  `10` is exposed as best-effort preserved output and is never activated; code
  `20` is an explicit unsupported-input refusal. Rust rejects any output path
  overlapping the source, and dry runs never write or link.
  The previous workspace stays linked, so rollback means reactivating it—not a
  destructive reverse conversion.
- `GET /api/workspaces/:id/runs` for a linked workspace with the published
  `WorkspaceStore` v5 `store.sqlite` projection. The reader is strict,
  immutable, and read-only; it refuses active SQLite journals, other schema
  versions, and incomplete projections.
- `GET /api/workspaces/:id/runs/enriched` provides the historical dataset/model
  summaries from the owner-published `workspace_store_run_history_v1` contract.
  Optional `project_id`, `limit` (1–500, default 100), and `offset` are validated;
  duplicate or unknown parameters are rejected. Filtering precedes pagination,
  and `total` counts all matching runs. Only selected runs' chains are loaded;
  historical score comparisons use owner SQL aggregates over other stored runs.
  No prediction arrays or artifact files are deserialized. A real train-only
  REFIT remains visible without synthesizing validation or test measurements.
- `GET /api/runs` combines active-workspace Store-v5 history with actual native
  training jobs, without duplicating completed parent jobs and their stored
  child runs. Status filters apply before the history page is selected.
  `GET /api/runs/stats` reads complete stored counts independently of that page;
  neither route acquires a writable store. These reads run outside the global
  HTTP state lock and retain the immutable/journal-refusal policy.

The sidecar also consumes the published `studio_run_detail_v1` Store-owned
projection internally, with an exact owner golden and the same immutable
fail-closed rules. It intentionally does not register or select
`GET /api/workspaces/:id/runs/:run_id`. The byte-identical owner
`studio_run_detail_http_v1` contract (SHA-256
`8230963eeb317ccacf5fa83a29fec730a830ebbb81ead9d16629251a1993ab1e`)
keeps route selection outside the Python owner. Its owner oracle
publishes both splitter metadata and the optional pipeline runtime values with
column provenance before the consumer boundary. The Studio-owned
`studio_run_detail_composition_v1` contract (SHA-256
`9090e2e0c68b3bf1dcc9ce0fcb99eb8ee69ab26f845c68cce56d8518aa4210f0`)
freezes splitter presentation, runtime aggregation/propagation,
linked-dataset mapping, and `rerun_ready`;
Rust and FastAPI consume one differential golden without re-parsing
`expanded_config`. The Store-v5 composition fixture and FastAPI differential
are therefore proven. The versioned `studio_run_detail_preselection_v1`
contract (SHA-256
`7532847cd58a5b19788abc1b26118421d0c1d31abcb13035e616732a20b3e5f4`)
now also resolves each linked workspace ID through the native
catalogue and verifies the exact Store v5 schema, projection columns,
immutable read, and journal policy once per request without caching. Missing
stores and old schemas reject with typed 501 in the default Rust-only session;
busy, unreadable, or incomplete v5 stores reject without a target request. An
explicit process-wide Python HTTP diagnostic session is selected before this
probe and therefore never acts as a per-store fallback.

Exact Store v5 now selects the native run-detail target only when the explicit
CPython library host is configured and preflights the exact owner callable.
The route surface is always registered but remains fail-closed; static
capabilities distinguish that surface from host configuration and never claim
scientific Python execution. Each preflight and target uses a fresh isolated
(`-I`) process, strict JSON stdin, a 15 second deadline, 8 KiB input, 4 MiB stdout, and 64 KiB stderr
bounds. Rust validates the exact seven-field owner envelope, composes the HTTP
response, and never exposes stderr or the resolved workspace path. Missing or
old stores reject before the target HTTP request in the default session; an
explicit diagnostic session owns all renderer routes before probing. A native
selection never falls back. Splitters remain owner-produced:
the Rust consumer neither parses nor receives permission to interpret
`expanded_config`.

The in-memory native job adapter remains deliberately separate from general
durable run-record reads. `GET /api/runs/execution-job-records/:job_id` and
`GET /api/runs/:run_id/execution-job-record` use the dedicated
`studio_execution_job_record_v1` bounded reader plus Store v5 run identity.
The tested mapping table in `job_http.rs` prevents those reads from being
confused with the three polling and five cancellation aliases. Jobs accepted
through the explicit run-group transport are the narrow exception: the same
Rust runtime persists their state transitions through the dedicated writer,
and the reader remains the authoritative bounded projection.

It does **not** launch Python/CPython as an HTTP backend, Uvicorn, or FastAPI;
it has no fallback launcher. An explicitly configured CPython may run only as a
bounded library/plugin host for the routes above. The sidecar contains no
scientific calculation, arbitrary file-I/O API, or reimplementation of
nirs4all stores. Apart from the published, bounded `WorkspaceStore` v5
projection readers and the shallow legacy-marker transition preflight, it does
not inspect dataset/workspace contents. It persists app-level preferences,
favorite identifiers, repaired linked-workspace record IDs, and (through its
Rust library boundary only) self-validating Core/DAG-ML conformal presentation
artifacts. The native training route is the only typed HTTP producer of a new
Archive V2 artifact; it is not a generic artifact-ingestion endpoint. All other UI routes fail closed before
fetch in the default product session. The transitional FastAPI process can own
the whole renderer session only after the visible diagnostic opt-in; it is
never an implicit fallback.

`docs/contracts/studio-v1/` remains the frozen legacy FastAPI baseline. R1
references that snapshot in tests to prevent an accidental parity claim. The
sidecar exposes only the frozen post-lifespan health and readiness responses
under `/api/*`; Electron routes the UI health check to that native health
contract. It does not route the renderer to `/ws` or assert full replacement
compatibility. The native job aliases may be selected only for already-native
jobs. Product scientific execution stays forbidden until a Core or bounded
CPython library executor is configured. The submission route itself is
registered and fail-closed; renderer WebSocket selection remains a separate
gate.

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
set `NIRS4ALL_NATIVE_SIDECAR_PATH`. Every route not explicitly listed above
returns a typed refusal in the default product session.

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
`scientific_execution` and `job_execution` are `available` only when the
explicit bounded executor, exact callable, native IO adapter, Unix process-tree
termination, and saved-input resolver all preflight successfully; otherwise
they remain `unavailable`.
`GET /sidecar/v1/capabilities` therefore reports
`api_route_coverage: "bootstrap_system_and_app_catalog"`,
`legacy_api_routes: false`, and
`renderer_rust_only_default: true`,
`unmigrated_renderer_routes_fail_closed: true`, and
`implicit_python_http_fallback: false`. The retained compatibility backend is
not required or selected by the normal renderer (`unmigrated_api_routes_require_legacy_backend`
is `false`). These fields make the partial migration machine-readable: a
caller must not treat the sidecar as full API parity or silently redirect an
unmigrated product route to Python.
The capability object separately advertises
`native_job_status_routes: true`, `native_job_cancellation_routes: true`,
`native_scientific_submission_routes: true`,
`scientific_submission_transport: true`, a dynamic `scientific_execution`, and
`durable_execution_job_record_reads: true`.
Renderer preselection validates `scientific_execution` as a boolean but does not
require it to be false: `true` means the Rust-owned executor has selected its
bounded library host, never that CPython owns an HTTP or WebSocket route.
The Python bridge actions are available only when `NIRS4ALL_PYTHON_PLUGIN_HOST`
is set. Every product-owned CPython launch uses `-B` plus
`PYTHONDONTWRITEBYTECODE=1`, so probing cannot add bytecode to the attested
runtime closure. Startup acquisition of the scientific host bounds its one-time
cold import and RECORD verification to 45 seconds (inside the 75-second
all-in-one smoke budget). `GET /sidecar/v1/python/preflight` separately uses
`-I`, bounds `import nirs4all` to 60 seconds, and never selects execution.
`GET /api/system/capabilities` and `GET /api/system/info` use the same bridge
with a bounded 15-second optional-import probe. `GET /api/system/env-coherence`
uses a bounded 15-second import/runtime probe and reports `python_plugin_host`
as the runtime kind. `GET /api/system/build` assembles the product-selected
build metadata in Rust and uses the same bounded host only to inspect optional
`torch` GPU availability. `GET /api/updates/version` combines the
Electron-supplied application version with a bounded `nirs4all` distribution
inspection. `GET /api/updates/runtime/status` obtains runtime metadata and size
in Rust, then accepts a bounded (256 KiB) distribution inventory from the
configured host. `GET` / `PUT /api/updates/settings` are fully native: Rust
reads and atomically writes the legacy-compatible YAML file, with no network
probe or Python process. These seven return their legacy response shapes
without launching a scientific job. `GET /api/system/network` is fully native:
it reads only the established offline preference and the `NIRS4ALL_OFFLINE`
process override, matching the legacy route without a network probe. All bridge
routes are capability evidence, never transparent Python fallback.

Legacy conversion uses the same configured interpreter solely as a
`nirs4all-tools` module host. Rust retains HTTP ownership, permits one converter
at a time, enforces a 30-minute deadline and 256 KiB bounds on each output
stream, and classifies the stable Tools codes `0/10/20/30/40/70`. The converter
  itself owns output freshness, source immutability, capacity, checksums, and
  verification rules. The checked-in closed contract is
`contracts/studio_legacy_workspace_conversion_v1.json`.

This converter is a bounded migration aid, not a transactional snapshot of a
live legacy tree. The qualified interpreter is re-attested in the child, but
the OS still spawns it by its verified path, and the legacy workspace is passed
to Tools by path; concurrent replacement or source writes are outside the
supported contract. Users should stop writers and retain the linked source.
Given the narrow migration audience, these are accepted residual risks rather
than claims of immutable source/executable handles.

Electron explicitly selects the bounded scientific-host acquisition candidate
with `NIRS4ALL_SCIENTIFIC_EXECUTOR=cpython-stdio-v1` only when it also supplies
the bundled marker plus host, closure manifest, runtime root, and unique
site-packages paths obtained from the verified packaged contract. The sidecar
rejects user/managed venv and PATH discovery. It fingerprints that executable with
SHA-256 and runs one fresh, isolated JSON-stdio preflight under a five-second,
8 KiB stdout, and 64 KiB stderr budget. It also fingerprints the exact source
file behind `nirs4all.studio_scientific_job_v1`; both identities are sticky and
reverified before execution, including a child-side callable check. The full
packaged closure is hashed once at acquisition, then guarded around every child
by path/inode/size/mtime/ctime snapshots with full re-hashing on drift. The
optimization is enabled only where the platform exposes a trustworthy inode
change marker; other targets keep full re-hashing at each boundary. The
response must identify CPython 3.11 or newer with `-I -S -B` isolation active and
pass a real negative bind self-test. A Python audit hook rejects `socket.bind`,
including `http.server` listener creation, and rejects subprocess, system,
posix-spawn, fork/forkpty, exec, and pty-spawn audit events (covering
`os.spawnv` and multiprocessing's platform process paths). This host cannot become the
HTTP/WS product backend. The closed contract is
`contracts/studio_scientific_cpython_host_v1.json`.

The fresh-process execution bridge accepts only the callable's already-resolved
path-free matrix request (64 KiB stdin), validates its exact PLS/KFold shape in
Rust, and validates the exact 8 KiB result. Stderr is bounded to 64 KiB and the
worker is killed on cancellation or the 120-second deadline. Its terminal
callback returns only complete/fail/cancel acknowledgement to the Rust runtime,
which owns registry transitions, WebSocket events, and durable records.

The selected resolver reads `dataset_links.json` schema v2 and the exact saved
pipeline under the active workspace through confined, bounded handles. Dataset
sources are capped during the role-tagged read at 1 MiB per file, 2 MiB total,
128 KiB per decoded record, 64 KiB per decoded field, 128 data rows, 256
columns, and 16,384 cells. Its
first slice accepts one train-only, single-source numeric regression dataset
and exactly an explicit `KFold` plus `PLSRegression` pipeline. It delegates
tabular assembly to the selected `nirs4all-io` role-tagged facade, then sends
only bounded inline `X`/`y`, PLS, and KFold values to the fresh worker. Grouping,
test partitions, branches, generators/HPO, categorical targets, multiple
datasets/sources/pipelines, folds, and aggregation fail during preflight before
registry, event, or durable mutation. The durable record retains the original
Studio request rather than the resolved matrices. Windows remains unavailable
until reliable process-tree termination is qualified. Missing, changed,
timed-out, malformed, or oversized hosts likewise fail closed. There is no
legacy or FastAPI fallback.

Studio retains a complete immutable source snapshot of the published IO 0.1.18
commit `493feb3b9dc5b856c4837afda14292358a8a3184`, including every crate,
test, fixture, binding, script, document, asset, and upstream licence and notice
file under `sidecar/vendor/nirs4all-io-493feb3/`. Run
`sidecar/scripts/verify-vendored-io.sh` to reject missing, added, or changed
files, and `sidecar/scripts/test-vendored-io.sh` for the locked offline Rust gate.
The runtime uses the exact published crates rather than sibling or vendored path
dependencies.

The release evidence also retains the complete Core 0.3.30 source at commit
`57fee01ca5477856d5ede53cac56cc21b361cb31` under
`sidecar/vendor/nirs4all-core-57fee01/`, the published DagML 0.3.25 package
payloads from commit `233d4ecdae14d2a810f9b01b4ce7c15bdedc9d27` under
`sidecar/vendor/dag-ml-233d4ec/`, the complete dag-ml-data 0.2.11 source at
commit `ffe533704a1a0b0c7bb7d97a997caade3f4ba36e` under
`sidecar/vendor/dag-ml-data-ffe5337/`, and the published n4m 0.1.4 payload from
Methods commit `48ad1e5a50844f68c2b99e93b02ad6a3b491c07b` under
`sidecar/vendor/n4m-48ad1e5/`. The vendored-source verification scripts reject
inventory drift and check exact repository trees, crate trees, package versions,
and registry checksums. These directories are immutable release evidence only;
Cargo resolves the published train (DagML 0.3.25, Data 0.2.11, IO 0.1.18,
Methods/n4m 0.1.4, and Core 0.3.30) from the registry.
Run the Core gate against the qualified ABI 2.5 Methods library:

```sh
N4M_LIBRARY_PATH=/absolute/path/to/libn4m sidecar/scripts/test-vendored-core.sh
```

Both source-test scripts use an ephemeral Cargo target directory and leave no
generated build tree in the repo.

App settings are stored in `app_settings.json` using the same precedence as the
legacy application: `NIRS4ALL_CONFIG`, portable-root configuration, the
portable executable's `.nirs4all/config`, a valid redirect file, then the
platform configuration directory. The store has a versioned default shape;
preference updates deep-merge `ui_preferences`, favorite operations are
idempotent, and writes use a synced temporary file followed by rename. The
sidecar owns the compatible `config_redirect.txt` selector: a custom target
must already exist, the redirect is stored at the platform-default path, and
the response always declares `requires_restart: true`. The sidecar never reads
or writes workspace or dataset contents.

Update preferences remain in the legacy `update_settings.yaml` location. Until
the network update routes are native, the legacy update manager detects the
sidecar's atomic replacement of that file and invalidates its cached GitHub
release when the prerelease setting changed; no restart or Python HTTP fallback
is required for a native settings update to take effect.

`GET /api/workspaces` reads the linked-workspace records already stored in
`app_settings.json`. It repairs only absent or duplicate record IDs to retain
stable UI keys, and returns the legacy list shape. Activation and unlinking are
also native, atomically updating only that catalogue and never deleting
workspace files. Linking, pruning, scanning, and all workspace contents remain
legacy routes until their scanner/store contracts are native.

The native `GET /api/workspaces/:id/runs` and bare
`GET /api/workspaces/:id/results` readers are available for a Store v5
workspace only. They use the published contract's `store.sqlite` location and
exact run- and pipeline-summary SQL projections through SQLite immutable
read-only mode;
it does not open a writer, create WAL/SHM files, read arrays or artifacts, or
fall back to CPython. A missing, live, or incompatible store returns an
explicit native compatibility error. The bundled SQLite reader supports local
volumes; Windows UNC/device paths are rejected until the packaging build and a
real share test prove URI-authority support. Electron routes only the bounded
run-summary query shapes (bare or with the contract-allowlisted `source` and
`refresh` values) and filter-free pipeline-summary requests to this reader, and
does not retry a native incompatibility through FastAPI. Scan mutations,
filtered pipeline-result requests, enriched Runs, legacy-manifest discovery,
and the full chain/results repository surface remain unmigrated and fail
closed by default until their public contracts reach parity. They are
available only when the whole renderer was explicitly assigned to the
diagnostic FastAPI owner before dispatch.

`GET /api/system/status` derives `workspace_loaded` and its workspace summary
from that same active catalogue record. It does not inspect the linked path:
the summary is catalogue state, not scan evidence. Its historical
`nirs4all_available` field reports only that an explicit Python plugin host was
configured; it neither imports nor executes Python.

`ConformalPresentationStore` retains validated scalar
`nirs4all::dag_ml::ConformalPresentationV1` and named multi-target
`ConformalPresentationV2` payloads, keyed by their immutable
`presentation_fingerprint`, below their `conformal-presentations-v1/` or
`conformal-presentations-v2/` directory in the product-selected configuration
directory. It validates every input and every
read through the selected Core/DAG-ML contract; it neither computes nor
alters intervals. This is a native persistence primitive, not an execution or
HTTP API claim.

All-in-one packaging builds the sidecar as
`resources/backend/native/studio-sidecar` next to the embedded
`resources/backend/python-runtime/`. Packaged Electron starts the sidecar and
passes the matching embedded Python as its explicit plugin host. Neither choice
selects Python as an HTTP fallback.

Sidecar control routes use:

```json
{"error":{"code":"route_not_found","message":"...","retryable":false,"details":{"path":"..."}}}
```

Defined codes are `invalid_request` (false), `route_not_found` (false),
`method_not_allowed` (false), `job_not_found` (false), `job_capacity_exceeded`
(false), `request_timeout` (false), and `websocket_upgrade_required` (false).
`details` is an object reserved for machine-readable context. Known routes
return `405` with an `Allow` header when the method is wrong.
The eight frozen `/api/*` job aliases retain the legacy FastAPI `detail`
error shape so existing renderer error handling does not change.

Job IDs are opaque `job-r1-*` identifiers. R1 records are control-plane
placeholders only, with statuses `pending` and `cancelled`. Cancellation is
idempotent: cancelling a known job always returns 200 and leaves a cancelled
job cancelled. It never force-kills or controls a legacy Python job.

Control records are bounded to 64 entries and expire after five minutes.
Expired records are removed first; when full, the oldest cancelled record is
removed; a full set of pending records is refused with `429`. The GET response
always preserves `cancellation_idempotent: true` as a protocol invariant.

The internal WS envelope remains explicit and unexposed:

```json
{"protocol_version":"studio-sidecar-r1","channel":"job:<opaque-id>","sequence":1,"timestamp":"RFC3339 UTC","type":"job.cancelled","data":{}}
```

`channel`, monotonically increasing per-channel `sequence`, and RFC3339 UTC
`timestamp` are required. `WsFrame::new` fixes the protocol version,
restricts channels to `job:<opaque-id>` and job lifecycle events, and accepts
only bounded JSON-object data. The live renderer-facing transport deliberately
removes those internal `protocol_version` and `sequence` fields and emits the
exact four-key Studio V1 envelope: `type`, `channel`, `data`, `timestamp`.
It accepts JSON `ping`, emits `pong`, preserves the frozen refusal of dynamic
`subscribe`/`unsubscribe`, and auto-subscribes the two job aliases. Each slow
connection has a 64-message queue and is dropped on saturation; no replay is
promised; reconnect recovery reads one of the three authoritative native HTTP
job-state aliases.

`contracts/studio_job_lifecycle_v1.json` freezes the selective R2 cutover. It
separates the sequenced native internal
stream from the renderer-facing Studio V1 envelope, records the five-state job
lifecycle and cooperative cancellation semantics, and anchors emitted event
shapes to `docs/contracts/studio-v1/fixtures/websocket.snapshot.json`. In
particular, the legacy manager publishes cancellation as `job_failed` with
`"Job was cancelled"`; the declared `job_cancelled` enum member remains
unreachable unless a reviewed compatibility exception changes the frozen
contract. The bounded registry, HTTP state/cancellation adapters, and real RFC
6455 connection manager share one Rust runtime. Pending cancellation becomes
terminal immediately and emits one `job_failed`; running cancellation stays
cooperative until the selected worker acknowledges it. Scientific submission
transport remains fail-closed until an executor is selected. Product renderer
transport selection is mandatory and Rust-owned. Once one of these eight
requests is selected native, neither Uvicorn nor FastAPI may be retried.

## Coverage and rollback

Covered: local liveness/readiness, frozen bootstrap health/readiness,
capabilities, versioned error envelopes, opaque control-job records and
idempotent cancellation, bounded Python plugin-host preflight, four
Rust-owned Python-bridge system routes plus native network state, native app preferences/favorites
and config-path selection, native system-status catalogue state, plus the linked-workspace catalogue and its native
activation/unlink mutations,
all-in-one binary packaging, and Electron's explicit loopback-only lifecycle
management, plus bounded RFC 6455 upgrades, three native job-state reads, five
cancellation aliases, and two immutable durable execution-record reads on the
sidecar port. Missing: every other legacy `/api/*` route, all
scientific execution, workspace/dataset persistence, uploads, authentication,
scientific executor selection, the dynamic `/ws` subscription surface, and
parity mapping/diffing for the full frozen surface. Missing renderer routes are
typed refusals in the default product, not implicit Python acquisitions.

The transitional R2 diagnostic rollback is an explicit whole-session launch
with `--enable-python-http-diagnostic`; it is never selected per route. A
future release rollback may exclude the sidecar binary/resource only through a
separately governed product profile. `app_settings.json` retains the
legacy-compatible shape, and rollback leaves workspace and dataset state
untouched.

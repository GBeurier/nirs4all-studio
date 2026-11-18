# Studio native sidecar (R1)

`sidecar/` owns Studio's packaged native control-plane executable. It is intentionally a
separate Cargo package, not a Tauri application and not an Electron switch.
The only executable is `studio-sidecar`.

## Public backend owner cohort (2026-11-18)

`contracts/studio_native_source_cohort_v2.json` selects Core 0.5.1, DAG 0.4.3,
DMD 0.2.17, IO 0.3.6, Formats 0.2.17 and Rust n4m 0.4.2 from crates.io.
`Cargo.toml` depends on the owner crates at minor granularity (`nirs4all =
"0.5"`, `nirs4all-io = "0.3"`), and `Cargo.lock` selects the exact cohort shared
with Core, so one Rust IO version resolves. Use the ordinary registry lock
without candidate source overrides. The Python
environment follows `recommended-config.json` (`required`) and may carry newer
owner releases than this Rust graph: the Rust crates move only with a Core
crate release that pins them. Browser npm and
owner-built browser artifacts have separate provenance and are not this graph.

Packaged Methods has two explicit identity paths at ABI 2.23. The default
`public-wheel` profile accepts only the Linux x64 nirs4all-methods 1.3.18
artifact declared in `scripts/methods-public-wheel-profile.json`: its exact
installed library size/hash, wheel reference and unknown source. It does not
infer a source commit from the package version, ABI, public tag or Rust crate.
The existing producer writes `methods_library.artifact` with kind `public-wheel`
and `source: null`; Electron and Rust validate that same selected profile.

The separate source-built path retains `methods_library.source`. The
existing source-checked Methods builder exports `source-build` through
`NIRS4ALL_BUILD_METHODS_IDENTITY_PROFILE`; its clean commit/tree/header checks
remain mandatory. Manual source packaging, including Docker's
`NIRS4ALL_METHODS_IDENTITY_PROFILE`, must explicitly select that profile after
those checks. The contract writer records that caller assertion; it does not
prove binary-to-source correspondence. The unrelated native eccbe5 artifact
must never be relabelled as either selected artifact.

Normal startup discovers the contract beside the executable, validates identity
and acquires Core preflight before advertising native prediction/training.
The retained injected HTTP test alone does not qualify that startup path.
The ignored `public_methods_wheel_startup` integration test launches the real
binary and replays the same owner-produced fixture, then checks typed refusal
for absent, incompatible or altered selections without acquiring Python.
SDK 1.4.18 is public on PyPI; `build/runtime-cohort.json` records its wheel
hash and source commit. Studio host installation and current-closure
qualification remain separate; historical SDK shipping receipts do not qualify
that closure. The retained SDK host-cohort status is owned by that integration
lane and is not a claim that the SDK is absent from the public registry.

After resolving the final registry lock, qualify the existing backend tests and
`node scripts/test-native-archive-v2.cjs` with one attested Methods library.
The latter generates one owner-produced raw PLS2 fixture and reuses it for the
Rust/runtime/HTTP checks. Retain its output, exact library identity and command
results. Do not substitute the frozen physical Archive V2 witness for that
current fixture, or rebuild historical vendored owners for current qualification.

## Fold-local target score projection

The SDK persists its opaque evaluation context in
`runs.summary.dagml_target_domain_summaries` (schema version 1, entries by exact
chain ID). A macro entry carries `cv_summary_fold_id: "macro"` and the exact
`target_domain_context` string supplied by its owner. Chain scores and the real
fold count come from the native report. Studio does not average prediction rows
or reconstruct a fitted target transform for this mode.

Ranked chain and results-summary reads validate these contexts before sorting or
pagination. Mixed protocols/domains, macro plus pooled rows, and older macro
results with missing provenance are refused explicitly. Individual prediction
pages remain available. The legacy prediction-row dashboard refuses this mode;
its averages cannot represent chain macro scores.

## Size bounds: host memory only

Studio imposes no content-size or entry-count ceiling of its own: request
bodies, Python worker requests and responses, workspace documents and
catalogues, uploads, run histories and model catalogues are bounded only by
`host_memory::allowance()`, a quarter of the memory the operating system reports
as available when the operation runs (cgroup-aware on Linux, installed memory
on macOS). A refusal tells the user the operation needs more memory than the
computer can spare. Kept fixed bounds are protocol frames of fixed shape (HTTP
headers, WebSocket control messages, the admission probe and fixed receipts),
the frozen native Archive V2 prediction/training contract, and bounds owned by
the libraries (IO decoding defaults, the SDK model-catalogue maximum). The
Playground worker raises the SDK's fixed 8/32 MiB Playground transport ceilings,
which the host bounds by memory instead.

## Status and boundary

R1 provides a small local HTTP control surface, a bounded native WebSocket
transport, and registered read/cancel aliases for native jobs:

- `GET /sidecar/v1/health`
- `GET /sidecar/v1/readiness`
- `GET /sidecar/v1/capabilities`
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
- `GET /api/training/:job_id` and `GET /api/automl/:job_id` read
  authoritative native job state in the frozen legacy response shapes.
- `POST /api/training/:job_id/stop`, `POST /api/automl/:job_id/stop`,
  `POST /api/runs/execution-job-records/:job_id/cancel`, and
  `POST /api/runs/:run_id/stop` share the same native cooperative-cancellation
  state and event stream. Studio creates no update download job, so the frozen
  `download-status` and `download-cancel` paths are not served.
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
- `GET /api/system/capabilities` (an explicit Rust-owned route; the configured
  Python host reports which optional packages are installed from module specs
  and distribution metadata, without importing torch, tensorflow, jax, shap,
  umap or autogluon)
- `GET /api/system/info` (the same bounded host bridge for the Settings system
  inventory; it does not create or run a job)
- `GET /api/system/build` (Rust-owned build metadata; it never invokes Python)
- `GET /api/config/detect-gpu` (the only route that imports `torch`: an
  explicit, on-demand, bounded probe of the selected environment, never run at
  application startup)
- `GET /api/system/network` (Rust-owned offline preference state; it reads the
  established bounded `update_settings.yaml` preference file and never probes
  a host or invokes Python)
- `GET /api/system/status` (Rust-owned active linked-workspace catalogue state;
  it does not scan a workspace or load dataset/store contents)
- `GET /api/updates/version` (Rust-owned version inventory; Electron provides
  the application version and the bounded Python library host reports only the
  installed `nirs4all` version and interpreter facts)
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
- `GET /api/workspace/format-status` reports whether the active workspace is
  an unconverted `DuckDB` workspace (`store.duckdb` without `store.sqlite`) so the
  renderer can point the user once to the separate `nirs4all-tools` converter.
  Studio itself neither reads nor converts such workspaces.
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
(`-I`) process, strict JSON stdin, a 15 second deadline, 8 KiB input, stdout bounded by the memory
the host can spare, and 64 KiB stderr bounds. Rust validates the exact seven-field owner envelope, composes the HTTP
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
confused with the two polling and four cancellation aliases. Jobs accepted
through the explicit run-group transport are the narrow exception: the same
Rust runtime persists their state transitions through the dedicated writer,
and the reader remains the authoritative bounded projection.

It does **not** launch Python/CPython as an HTTP backend, Uvicorn, or FastAPI;
it has no fallback launcher. An explicitly configured CPython may run only as a
bounded library/plugin host for the routes above. The sidecar contains no
scientific calculation, arbitrary file-I/O API, or reimplementation of
nirs4all stores. Apart from the published, bounded `WorkspaceStore` v5
projection readers and the `store.duckdb` marker check above, it does
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
`PYTHONDONTWRITEBYTECODE=1`. `GET /api/system/capabilities`,
`GET /api/system/info` and `GET /api/updates/version` read module specs and
distribution metadata within a bounded 45-second probe and import no package.
`GET /api/system/env-coherence` uses a bounded 60-second probe that imports
`nirs4all` and reports the running interpreter. `GET /api/system/build` is
assembled in Rust without Python. `GET /api/config/detect-gpu` is the single
on-demand probe that imports `torch`. `GET` / `PUT /api/updates/settings` are
fully native: Rust reads and atomically writes the legacy-compatible YAML file,
with no network probe or Python process. `GET /api/system/network` is fully
native: it reads only the established offline preference and the
`NIRS4ALL_OFFLINE` process override. All bridge routes are capability evidence,
never transparent Python fallback. Probe results are cached until the selected
interpreter or its installed packages change.

### Python environment hand-off

The application shell (Electron) owns environment selection, package
installation and updates. The sidecar only uses the interpreter it is given:

| Variable | Meaning |
| --- | --- |
| `NIRS4ALL_PYTHON_PLUGIN_HOST` | Interpreter of the selected environment (a venv link is used as given, never resolved). |
| `NIRS4ALL_PYTHON_PLUGIN_SITE_PACKAGES` | That environment's site-packages directory. |
| `NIRS4ALL_STUDIO_ADAPTERS_DIR` | Application directory that contains the `studio_document_adapters/` package. |
| `NIRS4ALL_SCIENTIFIC_EXECUTOR` | `cpython-stdio-v1` selects the bounded scientific host. |

Acquisition runs once, after the sidecar reports ready (readiness shows
`ml_loading`), within one 180-second budget; a timeout is retried on the next
readiness poll. The adapters are the application's own files: they are verified
against the compiled `contracts/studio_document_adapters_v1.json` manifest once
at acquisition and are imported from that directory, ahead of the environment's
site-packages. The admission probe then requires, in this order:

1. CPython 3.11 or newer, with `-I -S -B` isolation active and a real negative
   bind self-test;
2. exactly one `nirs4all` distribution visible on the worker's `sys.path`,
   whose metadata version is within the range of the embedded
   `recommended-config.json` (`required` entry `nirs4all`, field `range`);
3. `import nirs4all` from under that distribution's location, so the admitted
   metadata describes the code that runs -- an editable install
   (`direct_url.json` with `dir_info.editable`) may live elsewhere and is
   admitted like a wheel;
4. its Studio callables (`studio_scientific_job_v1`,
   `studio_scientific_job_v2`).

The probe process becomes the first interactive worker. Later workers receive
the admitted version as an argument and refuse to start if the installed
distribution metadata no longer matches it. Nothing is hashed or walked on a
readiness poll or around a request. Refusals are typed
(`python_host_unavailable`, `studio_adapters_unavailable`,
`python_host_not_cpython`, `python_host_version_unsupported`,
`scientific_distribution_missing`, `scientific_distribution_inconsistent`,
`scientific_distribution_version_unsupported`,
`scientific_library_import_failed`, `scientific_callable_unavailable`, ...) and
logged once per acquisition on stderr. A Python audit hook rejects
`socket.bind`, including `http.server` listener creation, and rejects
subprocess, system, posix-spawn, fork/forkpty, exec, and pty-spawn audit events
(covering `os.spawnv` and multiprocessing's platform process paths). This host
cannot become the HTTP/WS product backend.

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

Studio retains Main's exact historical SDK 1.4.15 Cargo package payloads,
verified against `contracts/studio_native_source_cohort_v1.json`. These are
immutable provenance, not the current v2 registry lock or build inputs:
Core 0.4.7 (`nirs4all`, commit `1dffd9f4472551cc09ad9d99ed9d40814bd003cc`) under
`sidecar/vendor/nirs4all-core-1dffd9f/`, IO 0.2.14 (`nirs4all-io`,
`nirs4all-io-core`, `nirs4all-io-dagml`, commit
`172a7acfcc029742f45fbcf477f55f46dc7fbafe`) under
`sidecar/vendor/nirs4all-io-172a7ac/`, DAG-ML 0.3.44 (`dag-ml`, `dag-ml-core`,
`dag-ml-results`, commit `01226120552529aad45e5ba60d3f6327894adc67`) under
`sidecar/vendor/dag-ml-0122612/`, dag-ml-data 0.2.16 (`dag-ml-data`,
`dag-ml-data-core`, `dag-ml-data-provider`, commit
`eb2ad7835ca85feebf6f626d9f43f61575a1c9a9`) under
`sidecar/vendor/dag-ml-data-eb2ad78/`, and n4m 0.4.1 (Methods commit
`b246b5029cc62cf0cc369df2611069498f2da183`) under `sidecar/vendor/n4m-b246b50/`.
Each directory has a `PROVENANCE.json` (upstream commit and tree, crate trees,
package checksums) and an `INVENTORY.sha256`. `npm run test:vendored-native-sources`
rejects missing, added, or changed files and checks the commits, trees,
versions, and every payload checksum against that historical cohort receipt. The
runtime uses the published crates, never these directories as path
dependencies. The payloads are evidence, not a build input: their unit tests
reference upstream workspace fixtures that a package does not ship, so they run
in the owner repositories' CI.

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

Update preferences are stored in `update_settings.yaml`. The native update
routes read them on every call and drop the cached GitHub release when the
repository or the prerelease setting changed; no restart is required for a
settings update to take effect.

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

Packaging builds the sidecar as `resources/backend/native/studio-sidecar`.
Electron starts it and passes the selected environment and the application's
adapters directory as described under "Python environment hand-off". No choice
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
The six frozen `/api/*` job aliases retain the legacy FastAPI `detail`
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
transport selection is mandatory and Rust-owned. Once one of these six
requests is selected native, neither Uvicorn nor FastAPI may be retried.

## Coverage and rollback

Covered: local liveness/readiness, frozen bootstrap health/readiness,
capabilities, versioned error envelopes, opaque control-job records and
idempotent cancellation, bounded Python plugin-host admission, the
Rust-owned Python-bridge system routes plus native network state, native app preferences/favorites
and config-path selection, native system-status catalogue state, plus the linked-workspace catalogue and its native
activation/unlink mutations,
installer packaging of the sidecar binary, and Electron's explicit loopback-only lifecycle
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

# Changelog

All notable changes to nirs4all Studio are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

---

## [0.17.4] — 2026-11-19

### Changed

- The Playground loads faster: the Python host encodes its answer in one pass
  with the C JSON encoder instead of a pure-Python incremental loop (identical
  bytes; the answer is still bounded only by the memory Studio can spare).
- A Playground target switch takes about a second instead of about five
  (898 x 1557 dataset): nirs4all 1.4.21 keeps the loaded dataset in the warm
  Python host until its files or configuration change, and spectra that no
  step changed are sent once (`processed_is_original`) instead of twice. The
  first load is about 40 % faster and the answer half as large.
- Python environment: Studio installs nirs4all 1.4.21; nirs4all-methods and
  pls4all 1.3.19, nirs4all-core 0.5.1, dag-ml 0.4.3, dag-ml-data 0.2.17 and
  nirs4all-io 0.3.6 are unchanged. An existing environment is kept as long as
  its nirs4all is at least 1.4.21 (below 1.5); an older one is offered the
  update.

### Removed

- The unused `/api/playground/pca` and `/api/playground/repetitions` routes,
  which ran a full Playground execution to keep one chart, and their unused
  renderer functions; the execution answer carries every chart. The unused
  MessagePack client dependency goes with them.

## [0.17.3] — 2026-11-18

### Fixed

- The SHAP tab works on Windows again: the Python host gets a private home
  directory, so libraries that resolve the user's home no longer fail with
  "Could not determine home directory".
- A finished run no longer stays "running" in the floating runs widget, and
  the widget no longer reappears on New experiment with stale entries: only
  live executions are tracked, workspace history rows stay in the run list.
- Windows paths of linked workspaces, datasets and Python environments are
  shown in their ordinary form (`D:\...`, `\\server\share\...`) instead of
  the extended-length `\\?\` form.
- A run whose workspace the Python environment cannot write to (Windows
  Controlled Folder Access or antivirus software) is refused before any model
  is fitted, with a message naming the Python interpreter to allow, instead of
  failing after every cross-validation fit (nirs4all 1.4.20).

### Changed

- Python environment: Studio installs nirs4all 1.4.20 and nirs4all-methods
  1.3.19 (libn4m ABI 2.23 unchanged), and now pins pls4all 1.3.19 in lockstep
  with nirs4all-methods instead of taking the newest release; nirs4all-core
  0.5.1, dag-ml 0.4.3, dag-ml-data 0.2.17 and nirs4all-io 0.3.6 are
  unchanged. An existing
  environment is kept as long as its nirs4all is at least 1.4.20 (below 1.5);
  an older one is offered the update, so the fixes above reach existing
  environments.
- The native backend uses the Methods 1.3.19 library (ABI 2.23).

## [0.17.2] — 2026-11-18

### Fixed

- Datasets with missing values or several target columns work again: runs on
  them start and complete. The settings chosen at import are kept (target
  columns, default target, missing-value tokens) and the dataset name edited
  in the dataset dialog is saved.
- With several target columns, the experiment review step asks which target
  the run models (the dataset's default target first) and shows how many
  samples have no value for it. Samples without a value for that target can
  be removed for this run only; spectra, target and metadata stay aligned.
- Missing values in spectra no longer prevent loading: the dataset loads as
  is and records how many values are missing in how many samples. When a run
  uses such a dataset, the review step asks whether to remove the affected
  samples, replace the values (constant, previous or next wavelength) or
  leave them to the pipeline. Saved datasets are never rewritten.
- A refused run names the dataset, the setting and the file at fault instead
  of a generic error, and no longer speaks of "preflight".
- The Playground renders datasets whose target has missing values; those
  samples stay in spectra and projections in a neutral colour, and PCA/UMAP
  projections use the complete samples and say how many were left out.
- The Playground offers its target selector whatever opened it (the dataset
  picker, a dataset's page or a stored session), opens on the dataset's
  default target and lists every target with its count of missing values.
- Large datasets no longer fail in the Playground or elsewhere because of a
  fixed size ceiling (for example 898 spectra by 1,557 wavelengths, refused
  at 32 MiB before). Studio imposes no content-size or entry-count ceiling of
  its own: a payload is refused only when it exceeds a quarter of the memory
  available at that moment, and the message says so. The Playground charts
  and analyses use the full spectral resolution, and the prediction model
  catalogue lists every captured model.

### Changed

- Python environment: Studio installs nirs4all 1.4.19 with nirs4all-core
  0.5.1, dag-ml 0.4.3, dag-ml-data 0.2.17, nirs4all-io 0.3.6 and
  nirs4all-methods 1.3.18 (libn4m ABI 2.23). An existing environment is kept
  as long as its nirs4all is at least 1.4.19 (below 1.5); an older one is
  offered the update to the required packages, so the fixes above reach
  existing environments.
- The native backend uses the published nirs4all 0.5.1 crate with nirs4all-io
  0.3.6, dag-ml 0.4.3, dag-ml-data 0.2.17, nirs4all-formats 0.2.17 and n4m
  0.4.2.
- Studio depends on the ecosystem libraries at minor-version granularity
  (for example nirs4all-io `>=0.3,<0.4`); exact versions are recorded only
  in lockfiles and the installed package set.

## [0.17.1] — 2026-11-17

### Changed

- XGBoost is no longer installed when Studio creates its Python environment.
  The first setup is faster and the environment smaller: on Linux, XGBoost and
  the NVIDIA library its wheel depends on were a download of about 590 MB and
  0.8 GB on disk, and creating the default environment from the package index
  took 57 s instead of 2 min 6 s on the same connection (1.2 GB on disk instead
  of 2.0 GB). Install XGBoost in Settings > Python to use the XGBoost models;
  until then the pipeline editor marks them as unavailable.
- The offline installers (Windows and Linux) still carry XGBoost: on a machine
  without network access it is installed on request from the installer's own
  files, like PyTorch.

## [0.17.0] — 2026-11-16

### Changed

- PyTorch is no longer installed when Studio creates its Python environment.
  The first setup is much shorter and the environment much smaller: on a
  machine with an NVIDIA GPU, PyTorch alone was a download of about 2.5 GB
  and 4.5 GB on disk. Studio offers to install PyTorch when you select a
  neural-network model; you can also add it at any time in Settings > Python.
- The offline installers (Windows and Linux) still carry PyTorch (CPU build):
  on a machine without network access it is installed on request from the
  installer's own files, like the default packages.
- On macOS, Studio installs the packages it requires from the package index.
  The first launch needs an internet connection, as before; the separate
  wheel archive that accompanied the macOS release no longer exists.
- `nirs4all-formats` is no longer installed as a required package. Nothing in
  Studio used that Python package: files are read exactly as before.
- An application update is always the installer of the newer version, which
  the Updates tab offers to download. The backend routes that downloaded and
  applied all-in-one archives in place, unused since installers became the
  only product, are removed.

### Removed

- Build and qualification lanes that could no longer work with installers
  that ship no Python runtime: the all-in-one archive build and its
  self-update smoke, the update and promotion workflows of past releases, and
  the local qualification policy that ran them.

## [0.16.0] — 2026-11-16

### Changed

- The installer is much lighter and application updates are faster. Studio
  ships without a Python runtime: an update replaces the application only and
  leaves your Python environment in place.
- Studio uses one Python environment, chosen by you. On first launch a single
  page lists the environments found on your machine with what each one lacks;
  pick one, or let Studio create a new one. The same page is available at any
  time in Settings, under the new Python tab, to switch environment or add
  packages.
- The packages Studio needs (`nirs4all` and its companion packages) are
  installed automatically and kept up to date at each launch. Recommended
  packages are yours to choose, one by one; when some are older than
  recommended, Studio shows a short notice at startup and a dot on Settings.
  Development (editable) installs are never modified.
- After this update, if you used the Python runtime included with earlier
  versions, Studio asks you once to choose or create a Python environment.
  Your workspaces and settings are kept.
- macOS is supported on Apple Silicon only; there is no Intel Mac installer.
  On macOS the first launch needs an internet connection: Studio downloads the
  Python runtime and the packages it requires. When macOS blocks the first
  opening of the application, allow it in System Settings > Privacy &
  Security > Open Anyway.

### Added

- An offline installer for Windows and Linux (file name ending in `-offline`)
  for machines without network access. It carries the Python runtime and the
  default package set, so Studio creates its environment without downloading
  anything. In-app updates always use the standard installer.

## [0.15.11] — 2026-11-10

### Fixed

- SHAP analysis now recovers progress, completed results and failures when job
  WebSocket events are missed. Reopening an interrupted submission no longer
  leaves the analysis stuck on "Starting" without a job identifier.

### Changed

- Ship the exact public nirs4all 1.4.16 wheel with Core 0.5.0, DAG-ML 0.4.0,
  IO 0.3.1, Formats 0.2.16 and Methods 1.3.15 (ABI 2.22). Release builds use
  the same verified wheel and runtime cohort as the packaged backend.

## [0.15.10] — 2026-11-03

### Fixed

- Results, result cards and "Show all trained models" now read a workspace
  whose store is nested in a `workspace/` folder of the linked project, instead
  of showing empty lists.

## [0.15.9] — 2026-11-03

### Changed

- Package nirs4all 1.4.15 in the included runtime, with its qualified native
  cohort: nirs4all-core 0.4.7, dag-ml 0.3.44, dag-ml-data 0.2.16,
  nirs4all-io 0.2.14, nirs4all-formats 0.2.14 and nirs4all-methods/pls4all
  1.3.13 (ABI 2.20). The Studio service uses the same Core 0.4.7 and IO 0.2.14
  crates. Custom and managed environments now need `nirs4all>=1.4.15,<1.5`,
  `nirs4all-io>=0.2.14,<0.3` and `nirs4all-methods>=1.3.13,<2`.
- Training excludes samples whose selected target is missing, then predicts
  them; nirs4all 1.4.15 does this natively. Imports, previews and analyses
  keep every row unless the user asks to remove it.
- New Experiment asks what to do with samples missing their target: exclude
  them from training and predict them (default), or remove them for this run.
  A dataset saved to remove those samples keeps that answer preselected.
- Results, Predictions and Runs list these samples as "Predicted (no target)"
  rows: they are filterable and exported, and never scored or used in metrics,
  residuals or observed-versus-predicted charts.
- Use nirs4all-ui 0.2.x shared components and pipeline preset catalogue.
- Vendor the exact published Cargo package payloads of the native cohort as
  release evidence, each checked against its `Cargo.lock` checksum.

### Fixed

- Long training campaigns are no longer stopped after one hour: the Complex PLS
  preset runs for several hours. Training stays cancellable and reports its
  progress; its time budget is now 24 hours.
- "Show all trained models" in a run's dataset panel and the all-models lists of
  result cards load in the desktop app again (they always reported "No models
  found"): the dataset chain listings are now served by the Studio service.
- AOM-PLS and POP-PLS presets and nodes use the native parameter names
  (`max_components`, `center_x`, `scale_x`): the 12-component presets no longer
  silently run with 3 components, and the ultra-slow search tunes
  `max_components`. LWPLS, KMeansSplitter, CARS, MetaModel and chain
  estimator nodes expose their real keywords.
- State the `CECILL-2.1 OR AGPL-3.0-or-later` dual licence in the README.

### Removed

- Studio's own missing-target exclusion for single-target runs, superseded by
  the library behaviour above.

---

## [0.15.8] — 2026-11-02

### Changed

- Accept custom and managed Python environments whose packages fall within the
  nirs4all release ranges (`nirs4all>=1.4.14,<1.5`, `nirs4all-io>=0.2.11,<0.3`,
  `nirs4all-methods>=1.3.9,<2`) and match the native Methods ABI. Exact package
  identity and file verification remain required for the included runtime.
- Start the Studio service before the Python check completes, cache a verified
  included runtime between launches, allow a longer first launch after an update,
  and retry a timed-out Python check without restarting.
- Show actual cross-validation progress: variant, fold, model and fit counts,
  including pipelines with several models, with a heartbeat during long fits.
- Package nirs4all 1.4.14 in the included runtime.

### Fixed

- Fall back to the included runtime, with a persistent explanation and repair
  actions, when the selected environment is missing or incompatible, instead of
  starting without a Python host. Keep the included-runtime choice valid when the
  installation folder changes.
- Show the actual reason when the Python environment, capability check or
  scientific job preflight fails, instead of a generic message.
- Keep the per-file NA policy when a run is launched, so a target column no
  longer inherits the global `abort` rule. Edited datasets refresh their shape.
- Exclude samples whose target is missing only when training a single target,
  instead of failing on NaN targets. Imports, previews and other analyses keep
  those samples unless the user asks to remove them.
- Preserve incoming metadata named `row_id`; rows stay positional and ID
  alignment is never forced.
- Expand model parameter sweeps before repetition and repetition-fusion runs.
- Open run tracking at launch, allow stopping a run before its first fit, show
  cancelled runs as cancelled, and clear finished runs from the floating widget.
- Never leave a job running forever when its result is large or a cancellation
  is refused; later runs are no longer blocked.
- Advertise the native run-management routes requested by the renderer.

### Removed

- DuckDB and the legacy workspace conversion. Studio opens current SQLite
  workspaces only; a DuckDB workspace shows a one-time notice pointing to the
  dedicated `nirs4all-tools` converter. DuckDB and nirs4all-tools are no longer
  installed in the included runtime nor required in selected environments.

---

## [0.15.7] — 2026-10-30

### Changed

- Use the shared Studio pipeline preset cards and catalogue consistency checks.

### Fixed

- Remove recursive Python installation hashing from Electron startup and Rust
  readiness checks. Keep exhaustive installation verification in build
  qualification and bounded checks of the selected runtime entry points.
- Check Python package versions on first launch, after a Studio update, or
  after selecting an environment. Reuse the result on ordinary restarts and
  offer an explicit update of an incompatible selected environment.
- Keep Playground usable when PCA cannot process missing values. Display the
  PCA error instead of reading coordinates that are absent from the response.

### Runtime

- Retain the qualified scientific runtime from 0.15.4: nirs4all 1.4.13,
  DAG-ML 0.3.43, DAG-ML Data 0.2.13, Core 0.4.6, IO 0.2.11, Formats 0.2.13,
  and Methods/PLS4all 1.3.9. The upstream audit found no prerequisite
  scientific-library release for these Studio fixes.

---

## [0.15.6] — Not released

- Superseded by 0.15.7 after Clippy 1.99 rejected an assertion style in a
  regression test. No installer was published.

---

## [0.15.5] — Not released

- Superseded after the release gate detected inconsistent application
  version metadata. No installer was published.

---

## [0.14.0] — 2026-09-27

### Changed

- Ship `nirs4all 1.3.0` in the bounded CPython plugin closure, with
  `nirs4all-methods 1.2.1`, `pls4all 1.2.1`, `nirs4all-core 0.4.0`,
  `dag-ml 0.3.30`, `dag-ml-data 0.2.12` and `nirs4all-io 0.2.0`. Pipelines of
  n4m role steps now run on DAG-ML's callback-free Methods lane, and
  `exclude(..., keep_in_oof=True)` fits its filters inside each fold's train
  rows, so validation targets no longer shape a fold's training set. The
  recommended profiles require `nirs4all >= 1.3.0`.
- Build the Rust sidecar against `nirs4all-core 0.4.0` and `dag-ml 0.3.30`
  (single `n4m 0.3.0` binding). The embedded native Methods library moves to
  `nirs4all-methods 1.2.1` (ABI 2.14: native role pipeline, input-view
  validation, shared label contract); the Archive V2 executor identity
  becomes `nirs4all-core@0.4.0+libn4m-abi-2.14:<sha256>`. Historical Archive
  V2 models remain predictable.
- Regenerate the n4m node registry from the ABI 2.14 manifest: seeds are
  optional (no default of 0), and the operator registries record
  nirs4all 1.3.0.

---

## [0.13.5] — 2026-09-27

### Fixed

- Installer qualification compares the preserved Windows workspace by its
  plain path (verbatim prefix and case ignored) before falling back to file
  identity, and reports both paths when they differ.

### Release note

- Supersedes the 0.13.4 tag, whose installers were never published. Contents
  are otherwise those of 0.13.4 and earlier 0.13 entries below.

---

## [0.13.4] — 2026-09-27 (unpublished tag)

### Fixed

- Regenerated the document-adapter source attestation for the 0.13.3 adapter
  change; the 0.13.3 release stopped before building installers.

### Release note

- Supersedes the 0.13.3 tag, which was never published. Contents are
  otherwise those of 0.13.3 and earlier 0.13 entries below.

---

## [0.13.3] — 2026-09-27 (unpublished tag)

### Fixed

- Windows: results and predictions of a workspace selected through the native
  sidecar failed with `invalid uri authority: %3F`. The sidecar reports
  canonical paths in verbatim form (`\\?\D:\...`, also persisted by 0.12.0),
  and read-only SQLite URIs built from them got `?` as authority. The library
  adapters now receive the plain path.

### Release note

- Supersedes the 0.13.2 tag, whose installers were never published. Contents
  are otherwise those of 0.13.2, 0.13.1 and 0.13.0 below.

---

## [0.13.2] — 2026-09-27 (unpublished tag)

### Fixed

- Installer qualification compares the preserved workspace by directory
  identity: on Windows the native sidecar reports verbatim canonical paths
  (`\\?\D:\...`), which failed the 0.13.1 Windows upgrade check although it
  was the same directory.

### Release note

- Supersedes the 0.13.1 tag, whose installers were never published. Contents
  are otherwise those of 0.13.1 and 0.13.0 below.

---

## [0.13.1] — 2026-09-27 (unpublished tag)

### Fixed

- Installer qualification opens the baseline's scientific Store v5 through its
  own runtime for native baselines too (0.12.0 is the first native baseline);
  the 0.13.0 release stopped at "Baseline workspace has no real store".

### Release note

- Supersedes the 0.13.0 tag, whose installers were never published. Contents
  are otherwise those of 0.13.0 below.

---

## [0.13.0] — 2026-09-27 (unpublished tag)

### Added

- Native n4m nodes in the pipeline editor. `npm run generate:n4m-registry`
  projects the nirs4all-methods manifest (Methods 1.1.1, ABI 2.13) through
  `nirs4all-ui` into typed preprocessing, model, filter, splitting and
  augmentation nodes. They carry an `(n4m)` name suffix, appear in Extended
  mode, and `npm run check:n4m-registry` fails on manifest or registry drift.
- Portable n4m tokens. An n4m node serializes as `n4m:<method_id>` and
  re-imports unchanged, so the same pipeline step is understood by the Python,
  R and WASM runtimes that implement the generic Methods roles.

### Changed

- Ship the scientific runtime that executes `n4m:<method_id>` tokens:
  `nirs4all 1.2.1` with `nirs4all-methods 1.1.1`, `pls4all 1.1.1`,
  `nirs4all-core 0.3.36`, `dag-ml 0.3.28`, `dag-ml-data 0.2.12` and
  `nirs4all-io 0.2.0` in the bounded CPython plugin closure. The recommended
  profiles now require `nirs4all >= 1.2.1`.
- Build the Rust sidecar against `nirs4all-core 0.3.36` and `dag-ml 0.3.28`,
  which share a single `n4m 0.2.0` binding. The embedded native Methods
  library moves to `nirs4all-methods 1.1.1` (ABI 2.13), the ABI that Core
  0.3.36 requires; the Archive V2 executor identity becomes
  `nirs4all-core@0.3.36+libn4m-abi-2.13:<sha256>`. Historical Archive V2
  models remain predictable.
- Vendor `nirs4all-ui 0.1.14`, which provides the n4m manifest projection.

### Fixed

- Remove needless borrows reported by clippy 1.98 in the Windows sidecar build.
- Make the release publication and scientific-journey checks tolerate runner
  latency and delayed draft-release visibility.

---

## [0.12.0] — 2026-09-24

### Changed

- Restore the Rust sidecar as the default product backend after the public
  Python recovery releases. Scientific execution uses `nirs4all 1.1.5`,
  `nirs4all-core 0.3.31`, `dag-ml 0.3.27`, `dag-ml-data 0.2.12`, and
  `nirs4all-io 0.2.0`. Python remains a bounded library and document plugin
  host; its HTTP backend is available only through the explicit diagnostic mode.
- Keep the native Methods library at ABI 2.5 (`nirs4all-methods 1.0.18`) as
  required by Core 0.3.31. The Python plugin can use Methods 1.0.21; native ABI
  2.6 will require a compatible Core release.

### Fixed

- Carry the recovery UI fixes into the native line: multioutput predictions,
  honest training-only scores, result refresh, PCA axes, pipeline selection,
  operator availability, and scikit-learn 1.9 parameter defaults.
- Make unique pipelines retained in Store v5 run history selectable and runnable
  in the experiment wizard. Keep the explicit Python diagnostic route aligned.
- Refresh the pipeline catalogue after imports and edits so the run wizard sees
  changes immediately.
- Drain, bound, redact, and expose installation logs during setup.

### Distribution

- Version 0.12.0 succeeds the public 0.11.11 installers. Stable release
  qualification uses each platform's latest public installer as its populated
  upgrade baseline before publishing replacement installers.

---

## [0.11.7] — 2026-09-17

Version 0.11.6 was an unpublished candidate, blocked by its Linux qualification.

### Fixed

- Allow package checks and dataset/document operations the same bounded cold
  Python import time as startup verification, instead of rejecting a valid
  runtime after 15 seconds.
- Show the server's runtime verification and setup completion errors in the
  installation screen, including after an unsuccessful manual retry.
- Keep scientific capability discovery and settings responsive while Python
  runtime attestation is running.
- Use compatible pinned NumPy, Numba and llvmlite wheels on Intel macOS.

### Tests

- Accept absolute ELF dependency paths containing spaces during Linux CPU
  closure checks, while still rejecting scientific libraries outside the bundle.
- Stop packaged first-launch qualification promptly when setup displays an error,
  and preserve bounded, redacted HTTP diagnostics.
- Preserve Linux CPU closure evidence and verify the packaged scientific runtime
  without relying on optional TBB/OpenMP libraries installed on the build machine.
- Require installed-product setup and real update migration on Linux, Apple
  Silicon and Intel macOS before publishing a stable release. Select the previous
  public update archive separately for each platform.

---

## [0.11.1] — 2026-09-05

### Fixed

- **Published scientific runtime:** pin the bounded CPython host to the immutable
  `nirs4all 1.0.1` PyPI wheel and verify its complete RECORD-derived manifest
  before exposing training, Playground, synthesis, or document operations.
- **Windows scientific execution:** contain CPython workers in a Job Object,
  qualify the platform bootstrap, and use Core 0.3.30 for durable Archive V1/V2
  publication on Windows.
- **Playground confinement:** keep inline execution data-only and resolve stored
  datasets exclusively through Rust-owned confined workspace paths.
- **Prediction export:** preserve exact sample alignment and conformal bounds in
  CSV output while neutralizing spreadsheet formula injection in string cells.
- **Release completeness:** refresh native source provenance, Docker inventory,
  offline update status, and packaging/runtime diagnostics without restoring a
  Python HTTP product backend.
- **Portable desktop updates:** restore the historical download, checksum,
  staging, apply, rollback, relaunch, status, cancellation, cleanup, and result
  flow for owned all-in-one archives, with authenticated local routes and
  atomic full-tree replacement.

---

## [0.11.0] — 2026-09-03

### Added

- **Native persisted-dataset training:** Rust now owns
  `POST /api/training/native-archive-v2`, job lifecycle, cancellation and Store
  registration. The bounded route selects one dense IO source and delegates
  the exact `SNV(ddof=0) -> Savitzky-Golay(mode=interp) -> PLS` training path
  to DAG-ML/Methods/Core, producing Archive V2 without CPython or fallback.
- **Multi-target conformal presentation:** Native Archive V2 replay and
  persistence now carry DAG-ML's identity-bound `ConformalPresentationV2` for
  named targets without recalculating calibration in Studio.

### Changed

- **Product ownership:** Packaged Studio is a Rust-only HTTP/WebSocket control
  plane. Embedded CPython is limited to fresh bounded stdio calls for explicit
  library/plugin operations; it never owns product routing or persistence.
- **Legacy conversion contract:** verified code `0` output may activate, code
  `10` remains preserved but inactive, and code `20` is an explicit refusal.
  The source remains linked for rollback. Concurrent source mutation and the
  path-based interpreter spawn are accepted limits of this low-volume migration
  aid, not transactional immutability guarantees.

### Fixed

- **Release reconciliation:** preserve the public 0.10.1 runtime-smoke budgets,
  bound non-blocking self-update checks, and enforce coherent 0.11.0 release
  manifests without reintroducing a Python HTTP backend or runtime selector.

## [0.8.2] — 2026-06-13

### Fixed

- **Updates**: Point the built-in GitHub release checker and remote recommended-config refresh at `GBeurier/nirs4all-studio`.
- **Runtime alignment**: Skip optional packages whose declared Python compatibility does not match the current runtime, preventing known `autogluon==1.2.0` failures on Python 3.13.
- **Sentry noise**: Downgrade user-visible pip install failures and transient workspace restore retries from error-level backend events.

---

## [0.8.1] — 2026-06-13

### Changed

- **nirs4all dependency**: Raised the managed runtime requirement and recommendation to **nirs4all 0.10.0** across all compute profiles.
- **Node registries**: Regenerated canonical and extended node registries against nirs4all 0.10.0.
- **Release packaging**: Build all-in-one archives and Docker images from the tagged `GBeurier/nirs4all@0.10.0` source while PyPI has not published that version yet.
- **Docker GPU image**: Install a Python 3.11 standalone runtime when the CUDA base image only provides Python 3.10.

---

## [0.8.0] — 2026-06-11

### Added

- **CPU-Lite edition** — a new `cpu-lite` build flavor / setup profile: a pure-scikit-learn install with no PyTorch / TensorFlow / JAX / AutoGluon / TabPFN / SHAP / umap-learn. Deep-learning pipeline-editor nodes and the SHAP ("Shapley") Lab tab are hidden via backend capability detection (`/system/capabilities`). Shrinks the all-in-one archive from ~885 MB to ~345 MB.

### Changed

- Requires **nirs4all >= 0.9.4** (slim core). Full profiles install `shap` + `matplotlib` explicitly so SHAP keeps working; `cpu-lite` excludes the heavy optionals and renames `xgboost` → `xgboost-cpu` (no CUDA/nvidia wheels). Enforced both at build time and in the interactive installer (`/config/align` + wizard preselection).
- Smaller archives: bundled wheel `tests/` are pruned from the baked runtime, Vite-bundled renderer node_modules are dropped from the Electron asar, and Chromium locales are limited to en/fr.

### Hidden

- **Transfer Analysis** Lab tab temporarily hidden pending an algorithm revisit (`TRANSFER_ENABLED` flag in `src/lib/featureFlags.ts`).

---

## [0.6.3] — 2026-04-18

### Added

- **Setup Wizard overhaul**: Reworked `SetupWizard` and `PythonEnvPicker` with optional-package handling, recommended install metadata, and a new `PythonEnvInspectionCard` for inspecting detected interpreters.
- **Runtime summary API**: Extended `api/system.py` and `api/updates.py` with a detailed runtime summary response and preflight/coherence tests; `recommended_config` now exposes default install metadata for optional packages.
- **Prediction distribution histogram**: New `PredictionHistogramChart` in the `PredictionViewer` with configurable series, layout, Y-axis type, bin count, bar opacity, and error bars; supports CSV export and is wired into `AllModelsPanel`, `AggregatedResults`, and `Predictions`.
- **Predict error UX**: The `Predict` page now captures input context and surfaces prediction failure messages inline; `PredictResponse` gained optional partition labels.
- **Sentry event filter**: New `api/shared/sentry.py` filter for dropping non-actionable events plus logging tests for the updates flow.
- **Dependency version helper**: New `dependencyVersionState` utility (with tests) to centralize version parsing in `DependenciesManager`.

### Changed

- **Environment manager**: Large refactor of `electron/env-manager.ts` and `backend-manager.ts` for clearer profile handling, with expanded test coverage (`env-manager.test.ts`, `PythonEnvPicker.test.tsx`).
- **Confusion matrix**: Raised the ordered-label cap from 24 to 30 for richer classification views.
- **GPU detection**: Tightened caching behavior with new tests in `api/shared/gpu_detection.py`.
- **Workspace manager startup**: Improved startup diagnostics and test coverage.
- **Cross-shell scripts**: Added a cross-shell guard to `.cmd`/`.bat` entry points (`launcher.cmd`, `ci-local.cmd`, `pre-publish.cmd`, `docs/user-guide/make.bat`) for better compatibility.

### Docs

- **Python environment architecture**: New `docs/_internals/python-environment-refactor-plan-2026-04-17.md` and `docs/python-environment-review-2026-04-17.md`; updated environment architecture, support runbook, packaging, release checklist, update system, and missing-packages troubleshooting pages.

---

## [0.6.2] — 2026-04-17

### Added

- **Variable Importance session state**: Selections, job status, and SHAP results persist across navigation via a dedicated session cache.
- **Prediction coloration**: New color legend and configurable point coloration (by metadata, partition, or residual magnitude) in scatter and residual charts.
- **Enriched run details**: `RunDetailSheet` split into dedicated Overview, Pipelines, and Logs panels backed by store-adapter enrichment and new backend endpoints.
- **Renderable step parameters**: `StepConfigPanel` now uses `getRenderableStepParams` for consistent parameter rendering, with unit coverage.

### Changed

- **ModelSelector (Predictions)**: Reworked with advanced filtering, sorting, and a refreshed UI for faster model discovery.
- **Aggregated predictions API**: Extended response metadata and pipeline canonical handling for richer cross-run views.
- **Score adapters**: Tightened handling of refit/repetition-aware metrics.
- **nirs4all dependency**: Raised the minimum supported nirs4all version to 0.9.1 across all managed compute profiles.
- **README**: Refreshed nirs4all offerings, installation options, and feature descriptions for clarity.

### Licensing

- **CeCILL-2.1**: Added full `LICENSES/` folder with CeCILL-2.1 plus third-party notices (NumPy, Pandas, SciPy, PyTorch, Keras, JAX, SHAP, joblib, PyWavelets, jsonschema) and updated `LICENSE` / `CONTRIBUTING.md`.

---

## [0.6.1] — 2026-04-16

### Fixed

- **Linux standalone packaging**: Switched Linux all-in-one release to tarball format with symlink dereferencing, fixed torch packaging, archive resolution, and smoke test executable detection.
- **macOS build process**: Enhanced notarization checks, spawn command handling, and model class path resolution.
- **Update extraction**: Improved nested app root resolution and extraction logic for standalone bundles.
- **Runtime environment**: Updated Python runtime structure, paths in packaging scripts, and build process handling.

### Changed

- **Release workflows**: Removed dedicated Linux release repair workflow in favor of consolidated build fixes. Added archive size reporting for Linux releases.

---

## [0.6.0] — 2026-04-16

### Added

- **All-in-one standalone bundle**: Added bundled standalone release packaging with dedicated build scripts, embedded runtime support, and smoke tests for archive extraction and executable permissions.
- **Unified prediction detail viewer**: Added richer prediction detail panels with `ChartTile`, `HeroMetrics`, configurable prediction charts, export support, and improved cross-page viewer integration.
- **Operator availability awareness**: Added node-registry loading and operator-availability invalidation so the Pipeline Editor and Settings react when installed capabilities change.

### Changed

- **Pipeline presets**: Refreshed preset loading, variant handling, and preset catalog complexity tiers for experiments and template selection.
- **Runtime modes**: Refined runtime mode detection and surfaced clearer writable vs. read-only UI feedback across environment, dependency, and update flows.
- **Predictions and results UX**: Improved dataset filtering, responsive result cards, and shared detail-sheet behavior across Results, Aggregated Results, and Predictions.
- **nirs4all dependency**: Raised the minimum supported nirs4all version to 0.9.0 across all managed compute profiles and runtime setup flows.
- **Release metadata**: Bumped nirs4all Studio to version 0.6.0 for the next published release.

---

## [0.5.1] — 2026-04-15

### Added

- **Confusion matrix export**: Classification prediction views can now export confusion matrix data directly from the prediction viewer.

### Improved

- **Prediction detail views**: Refined tab handling, model detail displays, and dataset result cards for prediction-focused workflows.
- **Validation and error messaging**: Improved API client and dataset validation feedback, with clearer localized workspace loading messages.
- **Runs redesign coverage**: Expanded visibility checks in end-to-end coverage for the redesigned runs experience.

---

## [0.5.0] — 2026-04-15

### Added

- **Runtime grouping and repetitions**: Added repetition-aware Playground and API support, grouping metadata in spectral/run responses, and new repetition-focused charts and validation.
- **Refit-aware metrics and scores**: Added refit chain lineage handling plus richer metric selection across Runs, Results, Aggregated Results, and Predictions.
- **Function model support**: Extended canonical pipeline import/export and model handling to cover function models and richer pipeline metadata.
- **Webapp node metadata**: Added `_webapp_meta` and `_webapp_split` fields so node definitions can express webapp-only curation and runtime grouping behavior.

### Changed

- **Managed dependencies**: `torch` is now handled through compute profiles rather than exposed as a normal optional dependency.
- **Aggregated views**: Aggregated results and prediction summaries now preserve repetition-aware and refit-aware metadata more consistently.

### Improved

- **Coverage**: Added backend and frontend coverage for runtime grouping, recommended config profile management, score adapters, node registry metadata, and Playground pipeline flows.

---

## [0.4.2] — 2026-04-14

### Added

- **Prediction deletion actions**: Model action menus can now delete predictions at chain or group scope with confirmation dialogs and cache invalidation.
- **Estimation fallback coverage**: Added tests for pipeline variant estimation fallback and enriched run/store adapter responses.

### Improved

- **Pipeline variant estimation**: Improved error handling and fallback behavior when estimating run variants.
- **Inspector and importance visuals**: Refined spectral importance charts, variable-importance controls, histograms, and related score card interactions.

---

## [0.4.1] — 2026-04-13

### Added

- **Canonical pipeline round-tripping**: Added broader canonical pipeline conversion and round-trip handling for presets, imports, and editor execution previews.
- **Preset authoring and editor flows**: Expanded preset loading/generation, pipeline conversion utilities, branch/generator renderers, and execution preview support in the Pipeline Editor.
- **Run progress and readiness feedback**: Added stronger run progress presentation and ML readiness state handling across the app.

### Changed

- **nirs4all dependency**: Updated managed configuration and tests to nirs4all 0.8.9.

### Improved

- **Runs and prediction detail panels**: Refined Run Detail and Model Detail flows, with additional integration coverage for dataset group memberships and presets.

---

## [0.4.0] — 2026-04-08

### Added

- **Shared Query Hooks**: New `useDatasetsQuery` and `useLinkedWorkspacesQuery` hooks centralize dataset and workspace fetching with shared TanStack Query cache, eliminating duplicate API calls across `NewExperiment`, `Predictions`, `Results`, `Runs`, and `Settings` pages.
- **Backend Startup Banner**: New `BackendStartupBanner` component surfaces backend readiness state during app launch.
- **Selected-Only Visualizations**: `SpectraChartV2` and histogram components now support a selected-only view with tooltip toggles. `HistogramClassification` renders stacked bar segments for selection, partition, and metadata modes.
- **Test Coverage**: Added test suites for dataset queries, playground partition selector, color configuration, target histograms, and store integration. New `conftest.py` fixtures isolate user settings during tests.

### Improved

- **Dataset & Workspace Types**: Extended dataset types with groups and score entry structures for richer API responses.
- **Playground**: Enhanced color legend, partition selector, reference mode controls, and histogram data filtering based on sample selection.
- **Settings Page**: Workspace list now uses the shared query hook with a change callback for live updates.
- **Auto Display Mode**: `SpectraChartV2` automatically switches display mode when no samples are selected.

### Fixed

- Dataset top chains deduplication and metadata loading behavior.

---

## [0.3.7] — 2026-04-08

*(Release notes pending)*

---

## [0.3.2] — 2026-04-03

*(Release notes pending)*

---

## [0.3.1] — 2026-04-02

### Added

- **Portable Mode**: Full portable deployment support — the app can run entirely from a USB drive or self-contained folder with no system-wide installation. Includes automatic migration of legacy data layouts.
- **GPU Detection**: New shared GPU hardware detection module (`gpu_detection.py`) with nvidia-smi, Windows WMI, and PyTorch runtime probes. The `/system` endpoint now returns richer GPU diagnostics (driver version, detection source).
- **Runtime Paths**: Centralized runtime path resolution (`runtime_paths.py`) for consistent directory handling across installed and portable modes.
- **Build Versioning**: Release build scripts now embed version info from `package.json` automatically.
- **Smoke Test Script**: PowerShell script (`smoke-portable-isolation.ps1`) for validating portable-mode isolation.

### Improved

- **Environment Manager**: Refactored Electron env-manager to support portable backend directories and improved logging/error handling for package management.
- **Update System**: Updater now prefers runtime-detected version over cached data; portable-aware backend directory resolution.
- **Dependencies Manager UI**: Updated to reflect base version management.
- **Recommended Config**: Refactored configuration endpoint with improved GPU info response fields.

---

## [0.3.0] — 2026-04-01

### Changed

- **nirs4all dependency**: Updated to nirs4all 0.8.6 (from 0.7.1). All compute profiles (CPU, GPU-CUDA, GPU-MPS) now require >=0.8.6.

### Added

- **Predictions**: New prediction feature with model selection and data input.
- **Dependencies Manager**: Enhanced with version status indicators and revert actions.
- **Playground**: New augmentation methods and updated category configurations.
- **Results & Runs**: Metric selection, best_params display, and improved UI.
- **Dataset Wizard**: Refactored to support effective parsing parameters and improved data handling.
- **Preprocessing**: Enhanced operators with comprehensive operator definitions.
- **Chain Summaries**: New endpoint for retrieving all chain summaries for a dataset.
- **Translations**: Added Chinese (Simplified) translations.

### Improved

- **Storage**: Migrated from DuckDB to SQLite for hybrid storage.
- **Environment Management**: Refactored Python environment setup, improved wizard and app readiness checks.
- **Crash Reporting**: Integrated Sentry across all layers (frontend, backend, Electron).
- **Update System**: Refactored and improved update process and test coverage.
- **App Settings**: Atomic JSON writes for reliability.

---

## [0.2.0] — 2026-02-24

Intermediate releases (0.2.1–0.2.5) are folded into 0.3.0 above.

---

## [0.1.0] — 2026-02-24

Initial release.

### Added

- **Datasets**: Import and manage NIRS datasets from CSV, Excel, Parquet, MATLAB, NumPy, and HDF5 files. Multi-step import wizard with auto-detection. Dataset groups for organization. Drag-and-drop import. Batch folder scanning.
- **Dataset Detail**: View spectra charts, target distributions, raw data tables, and dataset metadata.
- **Pipelines**: Visual drag-and-drop Pipeline Editor with step palette. Built-in preset library. Pipeline import/export as JSON. Support for branching, merging, and generators (`_or_`, `_range_`, `_log_range_`, `_cartesian_`).
- **Experiments**: Multi-step experiment wizard. Real-time progress monitoring with WebSocket updates. Live log streaming. Fold and variant tracking.
- **Results**: Dataset-grouped performance scores. Aggregated results across chains. Prediction storage and export.
- **Playground**: Interactive preprocessing and visualization. Real-time spectral chart updates. PCA/UMAP projections. Step comparison mode. Reference dataset overlay.
- **Inspector**: Model performance analysis with scatter, heatmap, histogram, candlestick, residuals, confusion matrix, and rankings views.
- **Lab — Spectra Synthesis**: Generate synthetic NIRS datasets with 111 spectral components. Configurable complexity, noise, and scattering.
- **Lab — Transfer Analysis**: Evaluate dataset similarity with centroid distance, manifold alignment, and KNN metrics.
- **Lab — Variable Importance**: SHAP-based feature importance with spectral, beeswarm, bar, and per-sample visualizations.
- **Settings**: Light/Dark/System themes. Compact/Comfortable/Spacious display density. UI zoom (75%–150%). Three languages (English, French, German). Workspace management. Data loading defaults. Developer mode.
- **Desktop app**: Electron-based with native window management, file dialogs, and auto-updates.
- **Cross-platform**: Windows, macOS, and Linux support. GPU acceleration (CUDA/Metal) for deep learning models.

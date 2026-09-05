# Synthetic dataset presets

`GET /api/datasets/synthetic-presets` is a native, read-only route. It accepts
no query parameters and does not require a Python host or an active workspace.
Its response is the six-entry Studio 0.9.1 catalogue in authored order.

The catalogue has one checked-in JSON source, `api/synthetic_datasets.json`.
Both the Rust product backend and the explicit FastAPI diagnostic backend embed
or parse that document. A source-level digest test protects the historical
labels, descriptions, task types, sizes, complexity values, icons, and order.

Dataset generation is a separate, conditional scientific capability. The
renderer may call `POST /api/datasets/generate-synthetic` only when the Rust
sidecar advertises `dataset_synthetic_generation_routes` and a qualified Python
host is available. Rust validates the closed request, allocates a staging
directory below the active workspace, and calls the attested
`nirs4all.api.general_synthesis:studio_synthetic_dataset_job_v1` owner. It does
not reproduce the synthesis algorithm.

The owner emits exactly `Xcal.csv`, `Ycal.csv`, `Xval.csv`, and `Yval.csv`, plus
their sizes and SHA-256 digests. Rust verifies the closed result schema, every
digest, and the absence of links or extra files before atomically publishing the
dataset. It then links the canonical four-file dataset config into the active
workspace. A link failure is reported explicitly and never deletes an already
verified generated dataset.

The accepted request fields are `task_type`, `n_samples`, `complexity`,
`train_ratio`, `wavelength_range`, `name`, and `random_state`, with
`target_range` for regression or `n_classes` for classification. Historical
controls that the owner cannot honor are intentionally absent from the UI and
rejected by the route instead of being silently ignored.

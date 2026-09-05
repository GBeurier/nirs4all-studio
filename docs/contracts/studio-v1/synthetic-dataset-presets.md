# Synthetic dataset presets

`GET /api/datasets/synthetic-presets` is a native, read-only route. It accepts
no query parameters and does not require a Python host or an active workspace.
Its response is the six-entry Studio 0.9.1 catalogue in authored order.

The catalogue has one checked-in JSON source, `api/synthetic_datasets.json`.
Both the Rust product backend and the explicit FastAPI diagnostic backend embed
or parse that document. A source-level digest test protects the historical
labels, descriptions, task types, sizes, complexity values, icons, and order.

This capability covers catalogue browsing only. Dataset generation remains a
separate scientific capability: the renderer must reject
`POST /api/datasets/generate-synthetic` unless the Rust sidecar advertises its
own qualified generation route backed by the attested `nirs4all` library host.
Rust must not reproduce the synthesis algorithm.

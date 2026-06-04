**Findings**
- [src/api/client.ts:838](/home/delete/nirs4all/nirs4all-studio/src/api/client.ts:838): `listPredictions()` still calls `api.get("/predictions")`, which is now the deleted JSON-file CRUD collection route under `/api/predictions`. It appears unreferenced today, but it is an exported dangling client helper that will 404 if used.

No other real dangling references found in `api/`, `main.py`, `src/`, `tests/`, `e2e/`, `scripts/`, or `electron/`. NodeRegistry `.v2` collapse is content-identical and imports are clean. `predict_single`/`batch`/`dataset` remain present, `_resolve_model_path` still uses `resolve_within`, and the removed `save_results` persistence did not leave undefined variables or broken responses.

Validation notes: `git diff --check` passed; Python AST parse passed. `pytest` could not start because the sandbox has no writable temp directory; `tsc` could not run because `node` is not installed.
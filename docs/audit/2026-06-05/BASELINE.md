# T0.0 — Green-gate baseline on `main` @ `eba503f` (recorded 2026-06-05)

Every remediation PR is judged against this baseline: **a PR may not add a single new failure.**

Environment: WSL2 Ubuntu-22.04 · node v22.21.1 (`~/.nvm/versions/node/v22.21.1/bin`) · backend python `../nirs4all/.venv/bin/python` (3.11).
Note: the npm scripts `lint:py-syntax` and `test:backend` invoke bare `python`, which is not on a clean WSL PATH (exit 127) — both were run directly with the venv interpreter for this baseline.

## `npm run lint:parallel`

| Gate | Result | Detail |
|---|---|---|
| eslint | ❌ **2 errors**, 221 warnings | see below |
| tsc | ✅ 0 errors | |
| nodes (validate-node-registry) | ✅ | |
| ruff | ✅ | |
| py-syntax | ✅ | run as `../nirs4all/.venv/bin/python scripts/check-py-syntax.py` |

Pre-existing eslint **errors** (the 221 warnings are dominated by `react-refresh/only-export-components` and are not itemized):

1. `.venv/lib/python3.13/site-packages/PyQt6/Qt6/qml/QtTest/testlogger.js:5:1` — `Parsing error: Unexpected token .` → eslint is linting the studio-local `.venv/` site-packages (ignore-config gap).
2. `src/components/pipeline-editor/__tests__/StepConfigPanel.metadata.test.tsx:23:75` — `@typescript-eslint/no-explicit-any`.

## `npm run test:parallel`

| Gate | Result | Detail |
|---|---|---|
| vitest | ❌ **1 failed** / 1448 passed / 1 skipped (84 files) | `electron/setup-python-env.test.ts > adds --no-compile when building bundled standalone pip installs` — pip-args array mismatch (8 vs 7 elements) |
| pytest | ✅ 891 passed, 53 skipped (59.8s, `-n auto`) | run as `../nirs4all/.venv/bin/python -m pytest tests/ --timeout=120 -n auto` |

## Baseline failure set (the only tolerated failures)

- eslint: the 2 errors above.
- vitest: `electron/setup-python-env.test.ts` × 1.

Raw logs from the baseline run were captured at `/tmp/baseline_lint.log`, `/tmp/baseline_test.log`, `/tmp/baseline_pytest.log` (not committed).

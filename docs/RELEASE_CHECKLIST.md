# Release Checklist — Environment Management

Pre-release verification steps for the Python environment management system.

## Automated (CI)

- [ ] Backend tests pass (`pytest tests/ -v`)
- [ ] Coherence smoke test passes (CI step)
- [ ] Frontend tests pass (`npm run test -- --run`)
- [ ] Electron build test succeeds (dry-run)
- [ ] Lint passes: `ruff check .` (backend), `npm run lint` (frontend)

## Manual — Environment Coherence

- [ ] **Fresh install**: wizard shows, managed env created, backend starts, dependencies page shows installed packages
- [ ] **Existing local venv**: select it in the wizard or Settings, inspect it first, then restart into it; `/api/system/env-coherence` reports `configured_matches_running: true`
- [ ] **Conda env**: detected or browsed, inspected before switch, backend restarts into it
- [ ] **Missing core packages / refuse install**: inspect existing Python, refuse install, runtime does not switch
- [ ] **Missing core packages / accept install**: inspect existing Python, install core packages explicitly, runtime switches successfully after restart
- [ ] **Mismatch state**: Python Runtime card shows distinct configured and running paths when Electron is configured for a different interpreter than the running backend
- [ ] **Preflight mismatch**: `POST /api/runs/preflight` reports `env_mismatch` when configured and running Python differ
- [ ] **Optional-package gap**: runtime can still run supported pipelines even when unrelated optional packages are missing
- [ ] **Bundled default runtime**: bundled build starts on embedded runtime and shows the embedded-runtime warning
- [ ] **Bundled to external switch**: bundled build can switch to external Python; backend restarts under that interpreter and package actions target the external runtime
- [ ] **Switch back to managed runtime**: create a managed runtime from Settings and confirm it becomes the configured backend runtime again

## Manual — Portable Mode

- [ ] **First launch**: wizard shows, env created relative to executable location
- [ ] **Relocated .exe**: move portable exe to new directory, re-launch, wizard re-shows (path drift detected)
- [ ] **"Don't ask again"**: respected on next launch from same location
- [ ] **Version update**: wizard always shows after version change regardless of skip preference

## Manual — Electron-Specific

- [ ] `env-settings.json` persists only `pythonPath`, wizard metadata, and portable skip state
- [ ] macOS: quarantine attribute removed from python-build-standalone binary

## Manual — Cross-Platform

- [ ] **Windows**: paths with spaces, case differences, and mixed separators work correctly
- [ ] **macOS Intel**: Homebrew `/usr/local/bin` Python detected
- [ ] **macOS ARM**: Homebrew `/opt/homebrew/bin` Python detected
- [ ] **Linux**: symlinked Python paths resolve correctly

## Manual — Docker

- [ ] Docker build starts without wizard or env setup
- [ ] GET `/api/system/env-coherence` returns `coherent: true`
- [ ] Dependencies endpoint works and reports container packages

## Release Artifact Checks

- [ ] `env-settings.json` is NOT included in any release artifact
- [ ] Backend source files are properly copied (verify `backend-dist/main.py` exists)

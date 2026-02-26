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
- [ ] **Custom Python path**: select via wizard, backend restarts, coherence reports `coherent: true`
- [ ] **Custom venv path**: set via Settings > Advanced, `requires_restart: true` reported, restart makes it active
- [ ] **Reset to default**: POST `/api/updates/venv/reset` clears custom path, coherence reports match
- [ ] **Mismatch banner**: shows amber "Environment mismatch detected" when VenvManager targets a different env
- [ ] **Mismatch actions**: "Reset to Current Environment" and "Restart Backend" buttons work
- [ ] **Standalone mode**: install/uninstall buttons disabled, "Package management not available" banner shown

## Manual — Portable Mode

- [ ] **First launch**: wizard shows, env created relative to executable location
- [ ] **Relocated .exe**: move portable exe to new directory, re-launch, wizard re-shows (path drift detected)
- [ ] **"Don't ask again"**: respected on next launch from same location
- [ ] **Version update**: wizard always shows after version change regardless of skip preference

## Manual — Electron-Specific

- [ ] `clearBackendVenvSettings()` runs on production startup (check console/log output)
- [ ] Environment change in wizard clears `venv_settings.json`
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

- [ ] `venv_settings.json` is NOT included in any release artifact
- [ ] `env-settings.json` is NOT included in any release artifact
- [ ] Backend source files are properly copied (verify `backend-dist/main.py` exists)

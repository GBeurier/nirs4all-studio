# Release Checklist — Phase 2 Candidate

This checklist describes the unpublished Rust-only desktop candidate. It does
not authorize publication. GitHub release `0.10.1` is the historical
rollback/support release and must not be presented as the Phase 2 candidate.
There is currently no candidate installer, archive, Docker image, or update
channel to download.

## Candidate identity and documentation

- [ ] A version newer than historical `0.10.1` is frozen by the final release
      lock with exact source SHAs, checksums, SBOM, and signatures.
- [ ] Candidate pages expose downloads only after those exact artifacts exist
      and have passed the release gate.
- [ ] Historical `0.10.1` links are labelled as rollback/support artifacts and
      never used as evidence for the candidate architecture.
- [ ] Installer, archive, Docker, update, and platform claims match the final
      lock and installation evidence.

## Candidate product boundary

- [ ] Electron starts the verified Rust sidecar as the sole HTTP, WebSocket,
      job, scheduler/control, store, and UI-adapter owner.
- [ ] Unmigrated product routes fail closed before fetch or process acquisition;
      no Python or FastAPI fallback is available.
- [ ] Embedded CPython is accepted only as the content-addressed, bounded stdio
      library/plugin host and owns no listener, scheduler, store, or product
      lifecycle.
- [ ] Missing or altered CPython disables only the relevant plugin capability;
      Rust remains the active product backend.
- [ ] Installers and archives contain no FastAPI, Uvicorn, `main.py`, `api/`,
      `websocket/`, PyInstaller backend, or backend requirements.

## Installation qualification (`INST-001`)

- [ ] Install, update, uninstall, and crash recovery pass on each promised
      Linux architecture.
- [ ] Install, update, uninstall, notarization/signature, and crash recovery
      pass on each promised macOS architecture.
- [ ] Install, update, uninstall, signature, and crash recovery pass on each
      promised Windows architecture, including the required manual smoke.
- [ ] Published platform wording is restricted to the exact matrix that passed.

Until every applicable item above has a release receipt, the candidate remains
NO-GO and its downloads remain unavailable.

## Historical diagnostic-development checklist

The checks below preserve the old FastAPI/Python environment surface for
browser development, explicit whole-session diagnostics, and support of
historical releases. They are not candidate installer acceptance criteria and
cannot select a Python product backend.

### Automated diagnostic checks

- [ ] Diagnostic backend tests pass (`pytest tests/ -v`).
- [ ] Environment-coherence smoke passes in diagnostic mode.
- [ ] Frontend tests pass (`npm run test:frontend`).
- [ ] Lint passes (`npm run lint:parallel`).

### Manual Python environment diagnostics

- [ ] A local venv or Conda interpreter is inspected before an explicit
      diagnostic-session switch.
- [ ] Missing packages are reported without silently changing the runtime.
- [ ] Configured and running interpreter mismatches are visible through the
      diagnostic environment-coherence endpoint.
- [ ] Package installation and managed-environment mutation stay confined to
      the explicit diagnostic surface.
- [ ] Changing a diagnostic interpreter never restarts or replaces the Rust
      sidecar used by the candidate product.

### Historical portable and platform checks

- [ ] Historical portable-mode state remains relative to the executable and
      detects relocation/version drift.
- [ ] Historical Windows paths with spaces and mixed separators remain
      diagnosable.
- [ ] Historical macOS Homebrew and Linux symlinked interpreters remain
      diagnosable.
- [ ] Diagnostic Docker startup and environment-coherence endpoints remain
      supportable without being described as the candidate product path.

### Historical artifact checks

- [ ] `env-settings.json` is absent from historical compatibility artifacts.
- [ ] Legacy `backend-dist/main.py` checks apply only to explicitly historical
      PyInstaller/diagnostic builds and never to a Phase 2 candidate artifact.

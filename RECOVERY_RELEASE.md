# Studio 0.11.8 — Python recovery

This recovery release uses the Python backend from Studio 0.10.1, with nirs4all 0.11.0 and the legacy execution engine. It is isolated from development dependency manifests and independent library upgrades.

## Recover an existing 0.11.7 installation

Download and run the installer for your OS. The updater in 0.11.7 only discovers all-in-one archives, so it cannot perform this recovery automatically. Future updates use the installer channel.

Keep your configuration when prompted. Workspaces, datasets, preferences and environments are retained. The Windows installer temporarily preserves application data before invoking the old uninstaller, which could otherwise delete it. The managed Python environment is aligned to the qualified library version; a shared custom environment is never silently changed.

New installations start with the lightweight scikit-learn profile. Additional frameworks are optional. The default workspace uses the actual OS Documents folder, including redirected or localized Windows folders.

## Distribution and qualification

Only NSIS (Windows), DEB (Linux), DMG (macOS architectures) and Docker are built. No portable or all-in-one archive is published.

The recovery workflow builds candidates and qualification reports only; it does not publish a release. Publication requires passing actual installer runs, populated 0.11.7 migration, first-run setup, real dataset preview/import, SNV computation, PLS training, nonempty Predictions, restart persistence, and Docker readiness. Reports record elapsed times and distinguish locally unpacked application tests from actual installer qualification.

Source work in progress on the native architecture is preserved separately.

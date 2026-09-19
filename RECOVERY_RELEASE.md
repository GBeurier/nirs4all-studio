# Studio 0.11.8 — Python recovery

This recovery release restores the Python backend from Studio 0.10.1 and explicitly uses the historical Python execution engine for training and prediction. It includes the corrected nirs4all 1.0.2 library to retain access to existing schema-5 workspaces from Studio 0.11.7. The older 0.11.0 library cannot read those workspaces and is therefore not used. Development dependency manifests and independent library upgrades cannot replace the qualified runtime.

## Recover an existing 0.11.7 installation

Download and run the installer for your OS. The updater in 0.11.7 only discovers all-in-one archives, so it cannot perform this recovery automatically. Future updates use the installer channel.

Keep your configuration when prompted. Workspaces, datasets, preferences and environments are retained. The Windows installer temporarily preserves application data before invoking the old uninstaller, which could otherwise delete it. The managed Python environment is aligned to the qualified library version; a shared custom environment is never silently changed.

New installations start with the lightweight scikit-learn profile. Additional frameworks are optional. The default workspace uses the actual OS Documents folder, including redirected or localized Windows folders.

## Distribution and qualification

Only NSIS (Windows), DEB (Linux), DMG (macOS architectures) and Docker are built. No portable or all-in-one archive is published.

Publication requires passing actual installer runs, populated 0.11.7 migration, first-run setup, real dataset preview/import, SNV computation, PLS training, nonempty Predictions, restart persistence, and a real Docker scientific calculation. The release uses those exact qualified installers and Docker image, without rebuilding them. Reports record elapsed times and distinguish locally unpacked application tests from actual installer qualification.

Source work in progress on the native architecture is preserved separately.

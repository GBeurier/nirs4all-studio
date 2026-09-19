# Studio 0.11.9 — Results and installation fixes

This patch continues the Python backend and explicit legacy execution engine from Studio 0.11.8, with the corrected nirs4all 1.0.3 library. Existing schema-5 workspaces remain supported.

## Changes

- Sequential models now retain distinct identities and appear in Results, including runs without cross-validation. Training-only scores are labelled as training scores; absent validation, test and refit scores remain absent. Model exports replay the intended estimator.
- Results refresh also reloads an already-expanded model history. PCA rendering, pipeline catalog availability and experiment selection are corrected.
- Installation logs can be expanded and copied in setup and Settings. Output is bounded and secrets are redacted; package processes drain both output streams and enforce timeouts independently of output reads.
- Optional package installation checks compatible dependencies, including the scikit-learn requirement of TabPFN 2.0.x. Dependency scanning no longer blocks the application event loop.

## Installation

Use the installer for your OS or the installer update channel introduced in 0.11.8. Workspaces and preferences are retained; shared custom Python environments are not silently modified. Users still on 0.11.7 must run the installer directly because that version's updater only discovers the retired all-in-one format.

Distribution remains Windows NSIS, Linux DEB, macOS DMG for Intel and Apple Silicon, and Docker. No portable or all-in-one archives are published. The Windows and macOS installers are unsigned; macOS builds are not notarized. The automated smoke test does not qualify browser-download SmartScreen or Gatekeeper trust handling.

## Qualification scope

This patch reuses the installer and two-phase build/promotion process qualified for 0.11.8. It does not repeat the populated-profile installation/update migration campaign. Qualification reports explicitly mark migration as not requested; 0.11.8 remains the previously qualified installer/update baseline.

The release gate runs targeted regressions for the corrected behavior and the existing installed-application smoke on each supported OS/CPU: first-run setup, dataset preview/import, SNV computation, PLS training, nonempty Predictions, saved-model replay, preferences and restart persistence. Docker runs its existing scientific smoke. Promotion publishes those exact qualified installers and image without rebuilding them.

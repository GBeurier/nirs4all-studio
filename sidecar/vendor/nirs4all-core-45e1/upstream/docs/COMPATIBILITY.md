# Host Compatibility

## Python

Expose sklearn-compatible estimators and transformers only for components whose
upstream execution path is present. Accept NumPy arrays and pandas data frames at
API boundaries. Keep optional dependencies optional.

## R

The current R package publishes the aggregate registry and the portable methods
subset. Future R controllers should support data frames and formula-style entry
points where an upstream runtime binding exists, while preserving provenance in
returned S3/S4 objects.

## MATLAB/Octave

The current MATLAB/Octave package publishes the aggregate registry and the
portable methods subset through `+n4m`. Future MATLAB/Octave controllers
should use matrices, tables, and options structs. Avoid MATLAB-only APIs in
shared functions unless a fallback or clear error is provided for Octave.

## JavaScript/WASM

Expose typed ESM APIs, browser-safe WASM loading, and serializable pipeline
descriptors. `nirs4all-web` should depend on these APIs rather than embedding
core logic.

## Rust

Expose typed wrappers and traits over upstream crates only where the dependency
or dynamic runtime is present. Use explicit errors for missing optional
components.

# Rationale

## Why Separate From `dag-ml`

Data compatibility changes faster than graph execution. New modalities, axes,
containers and adapters should not require changes to the ML execution core.

The separation also limits leakage risk: `dag-ml` can enforce fold and OOF rules
without inspecting raw features.

## Why Semantic Axes

A dimension is not just a number. A model input depends on whether an axis is a
sample, wavelength, channel, time, token or graph node axis. Semantic axes make
representation compatibility explicit and testable.

## Why Deterministic Fingerprints

Predict/replay needs to know whether a new dataset schema is compatible with the
schema used at fit time. Fingerprints provide a stable comparison key for bundle
loading and cross-language conformance.

## Non-Goals

- no execution graph;
- no cross-validation or OOF logic;
- no model fitting;
- no domain-specific defaults in the core;
- no assumption that every payload is a dense matrix.

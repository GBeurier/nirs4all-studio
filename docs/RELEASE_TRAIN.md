# Studio runtime release train

## R2 — Studio 0.10.2

R2 is the bounded compatibility release built from the last functional
pre-strict native-engine candidate and explicitly reconciled with public Studio
0.10.1. DAG-ML is the fresh-install default and fallback is disabled by
default. The runtime selector exposes Legacy and DAG-ML only when the active
nirs4all runtime reports explicit-engine support.

Selecting DAG-ML and then checking **Fallback to legacy** is the only action
that authorizes automatic fallback. The FastAPI orchestration backend remains
packaged in R2 so a structured DAG-ML refusal can be retried through the real
legacy engine. Direct Legacy selection is also explicit. Missing capabilities
disable the selector rather than silently changing engines.

This Python HTTP backend is transitional and belongs only to R2. R3 merges the
strict reconciled product, removes the backend and selector, restores the Rust
sidecar as sole HTTP/control-plane owner, and forces fallback off.

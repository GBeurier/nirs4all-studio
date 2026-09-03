# Studio runtime release train

## R1 — Studio 0.10.1 native qualifier

R1 is the native-sidecar qualification seed at
`ca6e84bf7b8a27fb25f9eb8c390efefe139a8c65`. Its qualified artifact is only
the `studio-sidecar` Rust control-plane scaffold: it never launches Python,
CPython, FastAPI, or Uvicorn and it has no fallback launcher.

This does not claim that the complete 0.10.1 desktop application is native.
Electron remains unchanged on the public Python/FastAPI product path, and the
R1 sidecar explicitly reports scientific execution and legacy route parity as
unavailable. The native-results integration fixture selects `engine="dag-ml"`
explicitly; it does not rely on the public library default, and an unavailable
DAG-ML backend is reported as a skipped qualification rather than a native
success.

R1 therefore provides a reproducible native-only boundary test without hiding
the limits of the public 0.10.1 application. R2 owns the visible compatibility
selector; R3 owns the strict native product path.

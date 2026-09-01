# Release Plan

Release artifacts should be built from the same upstream lock:

- Rust crate: `nirs4all`
- Python wheel/sdist: `nirs4all-core`
- npm package: `nirs4all`
- R source package: `nirs4all`
- MATLAB/Octave archive: `nirs4all-matlab-octave`
- WASM bundle consumed by `nirs4all-web`

The Rust, JavaScript/WASM, R, and MATLAB/Octave artifacts published as
`nirs4all` are target-language releases of this `nirs4all-core` aggregate, not
separate host-language reimplementations. They stay delegating consumers of the
shared upstream packages and `nirs4all-methods`.

Before release:

1. Pin upstream versions or SHAs in `compat/upstreams.toml`.
2. Build each binding from the same lock.
3. Run upstream binding parity gates.
4. Run aggregate cross-language parity gates.
5. Run equivalent-pipeline checks against full Python `nirs4all`.
6. Verify external operator capability levels: metadata-only operators must not
   be marketed as executable, and executable operators must have parity fixtures.
7. Verify the Python release topology manifest: the current distribution is
   `nirs4all-core`, `nirs4all_core` is the canonical import, `n4a` is the only
   additive Python facade, and execution exports are delegated to upstream
   projects.
8. Publish artifacts and record provenance in the release notes.

`nirs4all_core.release_topology_manifest()` is the aggregate-side consumer
contract for ecosystem release manifests (schema
`nirs4all-core.release-topology.v2`). It records the current `nirs4all-core`
Python distribution, per-registry aggregate artifact rows, explicit V1
Python/R/JavaScript-WASM surface gates, Python facade namespaces, optional
upstream policy (notably external `nirs4all-datasets`), and
license/SBOM/`nirs4all-methods` C ABI pointers. Central release tooling should
consume these fields instead of re-deriving topology from prose.

Local artifact commands:

```bash
make test-v1-surfaces
make test
make build-python
make build-npm
make build-r
make build-matlab
cargo package -p nirs4all
```

`make test-v1-surfaces` runs Python unittest, the WASM npm test suite, and
the R V1 surface scripts only when `R`/`Rscript` are available locally. `R CMD
build/check`, Octave smoke tests, and CRAN/R-universe validation require
R/Octave toolchains. They are part of CI because they may not be available on
every development workstation.

Every CI run uploads the build outputs as artifacts (`rust-crate`, `python-*`,
`npm-wasm`, `r-source`, and `matlab-octave`).

Tagged releases are cut by six dedicated workflows — `release-python.yml`,
`release-npm.yml`, `release-crates.yml`, `release-r.yml`, `release-matlab.yml`,
`release-source.yml`. On a non-pre-release tag `vX.Y.Z` they publish PyPI
`nirs4all-core` (OIDC Trusted Publishing, environment `pypi`), npm `nirs4all`
(`NPM_TOKEN`), crates.io `nirs4all` (`CARGO_REGISTRY_TOKEN`), and attach the R
tarball, the MATLAB/Octave zip, and the source + SBOM bundle to the Release.
Pre-release tags build/attach but publish to no registry; `workflow_dispatch`
runs every workflow in dry-run mode. The version source of truth is the Rust
crate manifest, propagated by `scripts/bump_version.sh`. See
[`PUBLISHING.md`](PUBLISHING.md).

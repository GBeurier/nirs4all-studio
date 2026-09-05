<!-- SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later -->
# Development — Release Process

How each binding of `nirs4all-io` is versioned, gated, and published. The
Python wheels + sdist, the Rust crates, the npm package, the source/provenance
bundle, and the MATLAB/Octave zip publish from CI; the R (R-universe / Release)
leg attaches a tarball but its R-universe registration and the CRAN follow-up
are documented below.

The authoritative Python/C-ABI build workflow is
[`.github/workflows/release.yml`](../../.github/workflows/release.yml); the
per-surface workflows are `release-crates.yml`, `release-npm.yml`,
`release-r.yml`, `release-matlab.yml`, and `release-source.yml`.

> **No macOS deferral.** Unlike `nirs4all-formats` (which links the system
> HDF5), io's Rust core is **pure-Rust** (`glob`/`flate2`/`zip`/`csv`/`regex`/
> `serde`/`sha2`, no C system library). So io ships **macOS binary wheels** and
> macOS C-ABI archives alongside Linux + Windows with no special handling.

## Single source of truth

The canonical version is the **`[workspace.package] version` in the root
`Cargo.toml`** (Cargo SemVer, currently `0.1.14`).
`scripts/bump_version.sh` propagates it to every binding manifest, translating
the spelling each ecosystem requires:

| Spelling | Example (`0.1.0-alpha.1`) | Manifests |
|---|---|---|
| Cargo SemVer (verbatim) | `0.1.0-alpha.1` | root `Cargo.toml` `[workspace.dependencies]` internal-crate `version`, workspace-member crates via `version.workspace = true`, `bindings/python/Cargo.toml`, `bindings/wasm/Cargo.toml`, and the vendored workspace template in `bindings/r/configure` |
| PEP 440 | `0.1.0a1` (`alpha.N→aN`, `beta.N→bN`, `rc.N→rcN`; plain `X.Y.Z`→itself) | `src/nirs4all_io/_version.py` |
| R | `0.1.0.9000` (plain `X.Y.Z` for a final; `X.Y.Z.9000` "in development toward X.Y.Z" for ANY pre-release, since CRAN rejects SemVer pre-release suffixes) | `bindings/r/DESCRIPTION` |

> `bindings/python/pyproject.toml` is **dynamic-from-Cargo**
> (`dynamic = ["version"]`; maturin reads the version from
> `bindings/python/Cargo.toml` `[package] version`), so it is **not** a sync
> target. The root `pyproject.toml` reads its version from
> `src/nirs4all_io/_version.py` (hatchling), which **is** a sync target. The npm
> `bindings/wasm/pkg/package.json` is a **gitignored wasm-pack build artifact**
> (not in version control), so it is **not** a sync target either —
> `release-npm.yml` injects the SoT version into the generated
> `pkg-node/package.json` at build time.

```bash
scripts/bump_version.sh --check          # exit 1 on any drift (CI gate)
scripts/bump_version.sh --bump X.Y.Z     # rewrite the SoT, then sync
scripts/bump_version.sh                   # sync every manifest to the SoT
```

The C ABI version (`N4IO_ABI_VERSION` in `crates/nirs4all-io-capi/src/lib.rs`,
runtime `n4io_abi_version()`) bumps **independently** from the Rust semver, and
the `n4io_` exported-symbol surface is diffed by `.github/workflows/abi-check.yml`.

## Binding → registry → automation

| Binding | Package | Registry | Automation | Trigger |
|---------|---------|----------|------------|---------|
| Python | `nirs4all-io` | PyPI | **Automated** — `release.yml` (`python-wheels` maturin matrix all-3-OS + `python-sdist`) publishes via Trusted Publishing | push tag `v*` (non-pre-release) → PyPI |
| R | `nirs4allio` | **R-universe / GitHub Release** (CRAN deferred) | **Build CI-automated** — `release-r.yml` installs + smokes across the matrix, then builds a self-contained vendored source tarball. **R-universe is a one-time registry entry; CRAN is a deferred manual web-form step** (see *R → CRAN*). | tag push attaches the tarball |
| JS / WASM | `@nirs4all/io-wasm` | npm | **Automated** — `release-npm.yml` (wasm-pack nodejs build, raw + idiomatic smokes, authored types, licenses, scoped name + provenance) publishes via `npm publish` and retains the exact `.tgz` | push tag `v*` (non-pre-release) + `NPM_TOKEN` |
| MATLAB / Octave | `nirs4all-io-matlab-octave-<version>.zip` | GitHub Release | **Automated** — `release-matlab.yml` (`scripts/build_matlab_archive.sh`, commit-timestamped and byte-reproducible in a pinned tool environment) | push tag `v*` (non-pre-release) |
| Rust crates | `nirs4all-io-core`, `nirs4all-io`, `nirs4all-io-capi`, `nirs4all-io-cli` | crates.io | **Automated** — `release-crates.yml` publishes leaf-first | push tag `v*` (non-pre-release) + `CARGO_REGISTRY_TOKEN` |
| Source + provenance | — | GitHub Release | **Automated** — `release-source.yml` (reproducible git-archive tar.gz + zip, pinned Syft action, canonical CycloneDX SBOM, `SHA256SUMS`, keyless Sigstore provenance) | push tag `v*` (non-pre-release) |

## Exact release artifacts — what each binding ships, and where to upload it

Every artifact below is also attached to the **GitHub Release** for the tag, so
they are downloadable from one place.

| Binding | Registry | Exact file(s) | Upload |
|---|---|---|---|
| Python `nirs4all-io` | PyPI | `nirs4all_io-<version>-*.whl` (maturin abi3 wheels: Linux + macOS + Windows) + `nirs4all_io-<version>.tar.gz` (maturin sdist) | **Automated** — Trusted Publishing, *no manual upload* |
| Rust crates | crates.io | the 4 workspace crates (`nirs4all-io-core` / `nirs4all-io` / `nirs4all-io-capi` / `nirs4all-io-cli`) | **Automated** — `cargo publish`, leaf-first |
| R `nirs4allio` | R-universe / Release | **`nirs4allio_<version>.tar.gz`** (source tarball) | **Automated to the Release** (R-universe builds from Git). The release tarball is self-contained for CRAN; submission remains manual — see *R → CRAN*. |
| JS / WASM `@nirs4all/io-wasm` | npm | `nirs4all-io-wasm-<version>.tgz` containing raw WASM/JS, the idiomatic ESM wrapper, detailed types, and the license inventory | **Automated** — `release-npm.yml` (needs `NPM_TOKEN` + the `@nirs4all` scope) |
| MATLAB / Octave | GitHub Release | `nirs4all-io-matlab-octave-<version>.zip` (binding sources plus project license/notice inventory) | **Automated** — `release-matlab.yml` |
| C-ABI archive | GitHub Release | `nirs4all-io-capi-<target-triple>.tar.gz` (lib + `nirs4all_io.h` + target/source metadata + project license/provenance inventory), pinned Linux x86_64 / macOS arm64 / Windows x86_64 targets; built and canonicalized by `scripts/build_capi_archive.py` | **Automated** — `release.yml` |
| Source + provenance | GitHub Release | `nirs4all-io-<version>-src.tar.gz` · `…-src.zip` · `nirs4all-io-<version>.cdx.json` (SBOM) · `SHA256SUMS` | **Automated** — `release-source.yml` |

## Pre-release gates (release blockers)

Run these before tagging or publishing anything:

1. **Version sync** — `scripts/bump_version.sh --check`. The canonical version
   lives in the root `Cargo.toml` `[workspace.package] version`; the script
   syncs it into every tracked binding manifest (the root
   `[workspace.dependencies]` internal-crate versions used for crates.io,
   the two binding Cargo manifests, the vendored Rust workspace template in
   `bindings/r/configure`, the PEP 440 `_version.py`, and the R `DESCRIPTION`).
   **Bump with** `bump_version.sh --bump X.Y.Z[-pre]`.
   Enforced in CI by `version-sync.yml`.
2. **Green gate** — `cargo fmt --check`, `cargo clippy -D warnings`,
   `cargo test --workspace`, `scripts/audit_rust_locks.sh` (root plus the
   independently resolved Python, WASM, and R lockfiles), and the Python / R /
   WASM / MATLAB binding smokes.
3. **C ABI sanity** — the committed `crates/nirs4all-io-capi/include/nirs4all_io.h`
   matches the current surface; the `n4io_` exported-symbol set matches
   `crates/nirs4all-io-capi/abi/expected_symbols_*.txt` (`abi-check.yml`). Bump
   `N4IO_ABI_VERSION` only on an ABI change.

After assembling a local candidate directory, generate its canonical receipt with
`python scripts/write_release_receipt.py <release-dir>`. The writer refuses a dirty
checkout, stale commit/tree evidence, missing required package surfaces, failed
cross-binding or reproducibility evidence, and concurrent source/artifact changes.
`local_linux` can become `GO` from the locally available Rust/Python/WASM/C legs;
`global_release` remains `NO-GO` until the six-surface CI matrix and independently
verified attestations are present as `release-matrix.json` and `attestations.json`.

Rust/Cargo package identity is sensitive to the absolute workspace root even when
`--remap-path-prefix` removes host paths from the resulting binaries. Therefore an
A/B comparison for compiled Python or WASM packages must use the same logical build
root, operating-system image, and pinned toolchain on both runs. The two inputs may
come from independent clean clones (and their source archives are compared
separately), but each is staged at that common build root before compilation. The
GitHub-hosted release jobs provide this stable per-platform checkout location; the
path-leak scanner independently proves that the retained artifact exposes no runner
or staging path.

## Tag-to-release flow

1. `scripts/bump_version.sh --bump X.Y.Z` (rewrites the SoT + syncs every
   manifest), then run `scripts/bump_version.sh --check` to confirm.
2. Verify the green gate locally.
3. Commit, then tag: `git tag vX.Y.Z && git push --tags`.
4. CI builds wheels + sdist + C-ABI archives + crates + npm package + R tarball
   + MATLAB zip + source/SBOM bundle, then — **for a non-pre-release tag** —
   publishes to PyPI / crates.io / npm and cuts the GitHub Release.

**Pre-release tags** (anything containing `-`, e.g. `v0.1.0-alpha.0`) are
**excluded from publishing**: every publish job gates on
`!contains(github.ref_name, '-')`, so a pre-release never reaches a registry or
cuts a public Release. To publish the current alpha to PyPI, tag it with the
PEP 440 spelling (`v0.1.0a0`) — `publish-pypi` validates that the tag minus `v`
equals the built wheel/sdist version, but the production-only check additionally
requires a plain `vX.Y.Z` for auto-publish.

`workflow_dispatch` runs build/dry-run jobs by default; the PyPI publish also gates on
`github.event_name != 'workflow_dispatch'`. The crates workflow defaults to a dry
run and honors `dry_run=false` only when dispatching the exact
`v<workspace-version>` tag. npm follows the same identity rule for `publish=true`;
a branch dispatch can never publish.

---

## Gated / maintainer one-time setup

### Python → PyPI (Trusted Publisher)

`release.yml`'s `publish-pypi` uses PyPI Trusted Publishing (OIDC,
`id-token: write`) — no API token. One-time maintainer setup at
<https://pypi.org/manage/account/publishing/>:

| Field | Value |
|---|---|
| PyPI Project Name | `nirs4all-io` |
| Owner | `GBeurier` |
| Repository name | `nirs4all-io` |
| Workflow filename | `release.yml` |
| Environment | **`pypi`** |

> The `publish-pypi` job runs in the GitHub `pypi` environment, so the OIDC
> token carries an `environment: pypi` claim — the Trusted Publisher MUST be
> created with **Environment = `pypi`**. A publisher whose Environment field
> differs (blank or anything else) fails with `invalid-publisher`. Existing
> project publishers must still use **Environment = `pypi`**.

### Rust → crates.io

`release-crates.yml` publishes the four workspace crates leaf-first
(`nirs4all-io-core → nirs4all-io → nirs4all-io-capi → nirs4all-io-cli`). The four
names are verified **free** on crates.io. The internal crates carry an explicit
`version` in the root `[workspace.dependencies]` (alongside `path`) so each
published crate resolves its in-tree dependency from crates.io; the workflow's
`sleep 30` lets the sparse index catch up between crates. A downstream crate's
`cargo publish --dry-run` only fully verifies once its dependency is actually on
crates.io — so the dispatch dry-run reports the leaf crate cleanly and the
downstream crates show "no matching package … on crates.io index" until the real
leaf-first publish lands them. One-time: generate a crates.io API
token with publish-new + publish-update scope and add it as the GitHub Actions
secret `CARGO_REGISTRY_TOKEN`. Validate first with the `workflow_dispatch`
dry-run (`dry_run = true` runs `cargo publish --dry-run` for every crate). The
real publish fires only on a non-pre-release `vX.Y.Z` tag; crates.io is
immutable, so a bad version can only be **yanked**, never replaced.

### JS → npm (`@nirs4all/io-wasm`)

`release-npm.yml` builds the wasm-pack `nodejs` target, pins the scoped name +
provenance in `pkg-node/package.json`, stages the authored idiomatic wrapper,
detailed types and legal inventory, runs both committed Node smokes, retains
the exact `.tgz`, and publishes via `npm publish`.

One-time: own the `@nirs4all` scope on [npmjs.com](https://www.npmjs.com)
(*Add Organization* → create the free org `nirs4all`), generate a granular
**Automation** token with read+write on the `@nirs4all/io-wasm` package, and add
it as the GitHub Actions secret `NPM_TOKEN`. Provenance
(`publishConfig.provenance = true`) needs `id-token: write` (already set) and a
public repo.

### R → R-universe (registration)

R-universe builds binaries (Windows/macOS/Linux) straight from Git — no review,
no submission. Users then
`install.packages("nirs4allio", repos = "https://gbeurier.r-universe.dev")`.

- **Registry repo**: public `GBeurier/GBeurier.r-universe.dev` with a
  `packages.json` entry:
  ```json
  { "package": "nirs4allio", "url": "https://github.com/GBeurier/nirs4all-io", "subdir": "bindings/r" }
  ```
  No `branch` field → it tracks the default branch.
- **GitHub App** (one manual browser step): install
  <https://github.com/apps/r-universe> on the `GBeurier` account.
- **Verify**: watch <https://gbeurier.r-universe.dev> (it *shows* the
  `R CMD check` result but, unlike CRAN, does not block on a NOTE/WARNING).

> **Caveat:** R-universe builds from Git by running the same vendoring prepare
> step as `release-r.yml`. Its published binary can lag the current tag until
> that from-Git rebuild catches up.

### R → CRAN (submission) — deferred maintainer step

`release-r.yml` and `bindings/r/.prepare` create a self-contained source tarball:
`N4IO_R_VENDOR=1 ./configure` copies the workspace crates into
`src/rust/vendored/`, vendors the crates.io closure into `vendor.tar.xz`, and
builds the C ABI static library offline from `src/Makevars(.win)`. Do not submit
a plain checkout tarball that has not run this vendoring step.

CRAN submission is still a **manual web form** with human review. Get the
self-contained source tarball from the release workflow, then upload **only**
`nirs4allio_<version>.tar.gz` at <https://cran.r-project.org/submit.html>:

| Field | Value |
|---|---|
| Your name | `Gregory Beurier` |
| Your email | **`gregory.beurier@cirad.fr`** — must match the `Maintainer` (`cre`) in `DESCRIPTION` **exactly** |
| Upload | `nirs4allio_<version>.tar.gz` (the R source tarball only — never a binary, the repo zip, or the Python sdist) |
| Optional comment to CRAN | **paste the block below** |

**Paste-ready CRAN submission comment** (kept in sync with
`bindings/r/cran-comments.md`):

```text
This is a new submission.

nirs4allio is a thin R binding for the Rust-first nirs4all-io dataset-assembly
bridge for the nirs4all NIRS / spectroscopy ecosystem. It exposes the stable
n4io_* C ABI to R: normalize arbitrary inputs into a canonical DatasetSpec,
infer a DatasetPlan, and validate a DatasetSpec; the JSON surface crosses the
C ABI and results are canonical JSON strings. License: CeCILL-2.1 | AGPL-3.

Self-contained source tarball: the package vendors the nirs4all-io Rust core and
its crates.io transitive dependencies and compiles them OFFLINE at install time
via src/Makevars(.win) (no network, no external monorepo crates/). The Cargo /
rustc toolchain is declared in SystemRequirements.

Test environments: local Ubuntu/WSL2 R release (offline standalone install ->
installs, loads, native path active); CI matrix (release-r.yml) on Ubuntu 22.04
(R release + devel), macOS 14 (R release, arm64), Windows Server 2022 (R
release); win-builder + R-hub v2 run manually before submission.

R CMD check --as-cran: 0 ERRORs. Any WARNING/NOTE comes from the bundled
third-party Rust sources or the local toolchain, not from the package's own R or
build logic. The package does no network access during install/examples/tests
and imports only base R.

Maintainer: Grégory Beurier (CIRAD), gregory.beurier@cirad.fr.
```

> **Historical CRAN version note:** CRAN rejects SemVer pre-release suffixes
> (`0.1.0-alpha.0`). During the pre-`0.1.0` phase the R spelling was the
> development version `0.1.0.9000`, which was **R-universe / dev only and was NOT
> submitted to CRAN**. Current non-pre-release cuts use the plain `X.Y.Z`
> spelling generated by `scripts/bump_version.sh`.

---

## Rollback / yank

PyPI wheels and crates.io crates are immutable. **Yank** a bad release (the PyPI
web UI / `cargo yank --version X.Y.Z <crate>`) so it is unavailable to new
installs without breaking existing pins. For npm, `npm deprecate`. For the
GitHub Release, `gh release delete vX.Y.Z` and re-run `release-source.yml` for a
corrected tag.

## Operational notes (lessons from the 0.1.0 first release)

- **crates.io requires a valid SPDX license id.** `CeCILL-2.1` is rejected with
  `400 — unknown or invalid license expression`; the correct identifier is
  **`CECILL-2.1`** (all caps). Set it in `[workspace.package].license`.
- **crates.io rate-limits NEW crates** (burst ~5, then throttled). Publishing many
  new crate names at once fails with `429 — too many new crates`; wait for the
  stated reset and re-run `release-crates` (already-uploaded crates skip via the
  tolerance; only the pending leaf re-publishes).
- **Verify crates.io with a `User-Agent` header** — the API returns nothing without
  one, so a *successful* publish can look "absent". The `cargo publish` log line
  `Published <crate> at registry crates-io` is the source of truth.
- **Pre-release versions don't auto-publish.** `0.1.0-alpha.0` (a `-` tag) is gated
  out of every publish job — bump to a plain `vX.Y.Z` (`bump_version.sh --bump
  0.1.0`, then refresh `Cargo.lock`) to release.
- **Rust staticlib in the R package on Windows** needs the **GNU ABI**: build the
  capi with `--target x86_64-pc-windows-gnu` (the MSVC host toolchain produces an
  MSVC `.lib` Rtools' mingw `ld` can't link — MSVC-mangled `type_info`,
  CRT-mismatched `__imp_WSAGetLastError`). Build **staticlib-only** (Rtools45 ships
  no `libgcc_eh.a`, so a cdylib emit fails on `-lgcc_eh`) and link
  `-lkernel32 -lntdll -luserenv -lws2_32 -ldbghelp -lgcc` (the `--print
  native-static-libs` set; `-lgcc` carries EH/unwind/`__chkstk`).
- **npm**: same Automation-token + `@nirs4all` org-write requirement as the other
  repos; the `release-npm` dispatch `publish` input defaults to a dry run.

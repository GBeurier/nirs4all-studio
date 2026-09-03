# cran-comments.md

## Submission summary

* This is a **new submission**.
* `nirs4all` (the R binding of the `nirs4all-core` aggregate) is a **pure-R**
  package: `NeedsCompilation: no`. It carries **no compiled code** — no C, C++,
  Fortran, or Rust — so none of the "Using Rust" / `~/.cargo` / `abort` /
  `Makevars` / vendored-sources considerations that apply to the project's
  compiled siblings apply here. There is nothing to build at install time beyond
  byte-compiling the R sources.
* It is an **umbrella / aggregate**: it exposes the ecosystem's NIRS file
  readers, dataset assembly, datasets catalog, numerical methods, and the
  'dag-ml' / 'dag-ml-data' coordinators behind one R surface, and **delegates**
  all parsing, numerical, and pipeline work to those upstream packages — it
  reimplements none of it.
* `Imports`: `jsonlite`, `yaml` only (the lightweight definition-envelope
  parsing the package itself performs). The package is otherwise a leaf in the
  CRAN dependency graph.
* License: `CeCILL-2.1 | AGPL (>= 3)`, matching the aggregate source license
  expression `CeCILL-2.1 OR AGPL-3.0-or-later`.
* The same aggregate surface is shipped to the project's Python (PyPI, as
  `nirs4all-core`), JavaScript / WebAssembly (npm) and Rust (crates.io) targets.

## Suggested ecosystem packages and the distribution channel

The aggregated upstream R bindings —

* `nirs4allformats` (NIRS / spectroscopy file readers),
* `nirs4allio` (dataset assembly),
* `nirs4alldatasets` (DOI-pinned dataset catalog),
* `n4m` (portable PLS / NIRS numerical engine),
* `dagml` (process-local DAG-ML loss and metric functions),
* `dagmldata` (sample-aligned data contracts)

— are listed under **`Suggests`**, not `Imports`. They are used **conditionally,
behind `requireNamespace()`**: the package loads and all of its own
documentation / tests run without any of them installed, and each upstream is
only reached if the user has installed it. In particular **`nirs4alldatasets`
(the datasets catalog) is intentionally optional** so the aggregate never pulls
a heavy dataset dependency by default.

These upstreams are currently published on **R-universe**
(`https://gbeurier.r-universe.dev`), not yet on mainstream CRAN, so they are
declared via `Additional_repositories:`. Because of that, the natural release
channel for this package today is **R-universe**, where the whole ecosystem
resolves together. This `cran-comments.md` is written CRAN-submittable-style so
that, once the suggested upstreams are themselves on CRAN, this package can be
submitted unchanged: the only CRAN-incoming item that would then clear by itself
is the "Suggests or Enhances not in mainstream repositories" line.

When checking without the suggested upstreams installed (e.g. on a machine that
only mirrors CRAN), set `_R_CHECK_FORCE_SUGGESTS_=false`; the optional code paths
are guarded by `requireNamespace()` and degrade to a clear, actionable error
that names the missing upstream.

## Test environments

* Local development: Ubuntu / WSL2, R 4.6.0 — `R CMD build` + `R CMD check
  --as-cran` against the built source tarball.
* Submission-grade checks run on **current R (release)** across OSes before
  upload via GitHub Actions (`.github/workflows/release-r.yml`):
  - Ubuntu 22.04 (R release)
  - macOS 14 (R release, arm64)
  - Windows Server 2022 (R release)
* win-builder and R-hub v2 are run manually before each CRAN submission.

## R CMD check --as-cran status

`R CMD check --as-cran` finishes with **0 ERRORs, 0 WARNINGs**. The only NOTE is
the expected CRAN-incoming one for a first upload with R-universe upstreams:

1. **CRAN incoming feasibility — "New submission".** Always present for a first
   upload.
2. **"Suggests or Enhances not in mainstream repositories".** The five ecosystem
   upstreams above resolve through the declared `Additional_repositories`
   (R-universe). This clears once those upstreams are on CRAN.
3. **"Title field should be in title case".** The title contains the project
   name **`nirs4all`**, which is a lowercase brand name and is deliberately not
   capitalised; this is the same convention used by the project's sibling CRAN
   packages.

There is **no compiled-code NOTE/WARNING** (the package has no native code), and
no writes outside `tempdir()` during examples or tests.

## CRAN version note

CRAN rejects SemVer pre-release suffixes (e.g. `0.3.11-rc.1`). The submitted R
version is therefore the plain release version from `DESCRIPTION`, currently
`0.3.11`. A `.9000` development version (the R-universe / development spelling
produced from a pre-release Cargo version by `scripts/bump_version.sh`) is
**not** submitted to CRAN.

## Anti-patterns avoided

* No compiled code, hence no compiler flags, no `~/.cargo` / `~/.rustup` writes,
  no vendored sources, no network access at install.
* No internet access during examples or tests.
* No filesystem writes outside the `tempdir()` tree.
* No `:::` calls to private functions of other packages; upstream access is via
  documented entry points behind `requireNamespace()`.
* Only `jsonlite` and `yaml` are imported; every aggregated engine is a
  `Suggests`, so the package stays light.

## Reviewer-facing notes

* The package adds no independent numerical, parsing, or pipeline logic — the
  upstream engines remain the single source of truth and are delegated to at
  run time.
* Version is kept in sync across the project's bindings by
  `scripts/bump_version.sh` (the Rust crate version is the source of truth).
* Maintainer correspondence: `gregory.beurier@cirad.fr` (CIRAD).

Thank you for the review!

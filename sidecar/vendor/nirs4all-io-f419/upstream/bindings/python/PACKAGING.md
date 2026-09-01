<!-- SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later -->
# Python wheel packaging — `nirs4all-formats` reuse (story 11.0)

**Decision.** The Python wheel does **not** bundle a second native NIRS-format
reader. There is exactly **one** reader copy in the ecosystem.

- The pyo3 binding links the `nirs4all-io` **facade crate** (a Cargo path dep).
  The facade reaches `nirs4all-formats` *lazily*, only when a vendor file is
  actually read (OPUS/JCAMP/SPC/ASD/…). The contract corpus and the common
  CSV/Parquet path do **not** touch `nirs4all-formats` at all.
- Therefore the default wheel is built **without** the vendor-reader feature: it
  ships the dataset-assembly logic (resolve/infer/configure/materialize over
  tabular inputs) and has no `nirs4all-formats` code. Vendor-format support is an
  **opt-in extra** that, when enabled, depends on the **published
  `nirs4all-formats` wheel** (its own maturin build) rather than statically
  vendoring the Rust readers into this wheel — so the reader exists once, is
  versioned once, and is not duplicated across two wheels.
- Rationale: bundling the readers twice (once here, once in `nirs4all-formats`)
  would double binary size, split bug-fix surfaces, and risk format-version skew.
  The facade's lazy boundary (D-R4: io never re-parses vendor bytes) makes the
  split clean.

**Build.** `maturin build` from this directory produces an abi3 wheel
(`abi3-py311`) linking the facade. `cibuildwheel` matrix (EPIC 12.6) covers
linux/macos/windows × cpython. The wheel's import name is `nirs4all_io`; the
crate is `nirs4all-io-py` (distinct from the pure-Python MVP package, which is
relegated once the binding ships — no-dead-code, story 12.7).

**nirs4all touch-point.** The only place the binding may import `nirs4all` is the
lazy `load(..., target="spectrodataset")` adapter, imported at call time. The
import-boundary test (`tests/test_import_boundary.py`) asserts that
`import nirs4all_io` leaks no `nirs4all*` module.

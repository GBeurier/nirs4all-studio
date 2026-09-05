<!-- SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later -->
# R binding (EPIC 11.2)

R package `nirs4allio` over the nirs4all-io C ABI (`libnirs4all_io_capi`, the
`n4io_*` JSON surface). The C glue (`src/n4io.c`) drives each call via `.Call`;
on a non-OK status the context error is raised as an R error and owned result
strings are copied into R and freed with `n4io_string_free`.

```r
library(nirs4allio)

# Idiomatic layer: native R inputs in, typed S3 objects out.
spec <- nio_to_spec("/data/run")     # n4io_spec (parsed canonical DatasetSpec)
plan <- nio_infer("/data/run")       # n4io_plan (parsed scored DatasetPlan)
summary <- nio_load(spec)            # assembled structural summary
nio_validate(spec)                   # invisible TRUE; informative error otherwise
print(plan)                          # readable summary of scored decisions
as.data.frame(plan)                  # one row per scored decision (value/score/...)
nio_resolved_spec(plan)              # the editable n4io_spec inside the plan

# Low-level JSON surface (the stable C ABI contract) is still exported:
n4io_to_spec('"/data/run"')          # canonical DatasetSpec (JSON string)
n4io_infer('"/data/run"')            # scored DatasetPlan (JSON string)
n4io_load_summary(specJson)          # assembled summary (JSON string)
n4io_validate(specJson)              # errors if invalid; returns invisible(NULL)
n4io_abi_version()                   # C ABI version string
```

## Idiomatic functions (`nio_*`)

Native R inputs (a path, a vector of files, or a config `list`) are JSON-encoded
internally with `jsonlite` and the result is parsed back into a typed S3 object.

| Function | Signature | Returns |
|---|---|---|
| `nio_to_spec` | `nio_to_spec(input, conventions = NULL)` | an `n4io_spec` (parsed canonical `DatasetSpec`) |
| `nio_infer` | `nio_infer(input, conventions = NULL)` | an `n4io_plan` (parsed scored `DatasetPlan`) |
| `nio_load` | `nio_load(input, conventions = NULL)` | the parsed assembled structural summary as a list |
| `nio_validate` | `nio_validate(spec)` | invisibly `TRUE`; informative error if invalid. Accepts an `n4io_spec`, a `list`, or a JSON string |
| `nio_resolved_spec` | `nio_resolved_spec(plan)` | the editable `n4io_spec` carried in `plan$resolved_spec` |

S3 methods: `print` / `format` for `n4io_plan` and `n4io_spec`,
`as.data.frame(plan)` (scored decisions: `decision`, `value`, `score`,
`ambiguous`, `n_alternatives`), and `as.list` for both classes. `conventions` is
a character vector of convention names.

## Low-level functions (`n4io_*`)

| Function | Signature | Returns |
|---|---|---|
| `n4io_to_spec` | `n4io_to_spec(input_json, conventions_json = NULL)` | canonical `DatasetSpec` as a JSON string |
| `n4io_infer` | `n4io_infer(input_json, conventions_json = NULL)` | scored `DatasetPlan` as a JSON string |
| `n4io_load_summary` | `n4io_load_summary(input_json, conventions_json = NULL)` | assembled structural summary as a JSON string |
| `n4io_validate` | `n4io_validate(spec_json)` | `invisible(NULL)`; raises an R error if the spec is invalid |
| `n4io_abi_version` | `n4io_abi_version()` | the C ABI version string |

`conventions_json`, when supplied, is a JSON array of convention names.

## Low-level inputs cross as JSON values

Identical to the C ABI / other bindings: a path is a quoted string
(e.g. `'"/data/run"'`), a file list is a JSON array
(e.g. `'["a.csv","b.csv"]'`), and a spec is a JSON object. Results are canonical
JSON strings; the JSON⇄list layer (e.g. `jsonlite`) is the user's. The idiomatic
`nio_*` layer does this marshalling for you.

## Build & install

The package is **CRAN self-contained**: it vendors the `nirs4all-io` Rust core
and compiles it into a static library OFFLINE at install time (no prebuilt
`libnirs4all_io_capi`, no `N4IO_CAPI_DIR`). `bindings/r/configure`
(`N4IO_R_VENDOR=1`) copies the workspace crates into `src/rust/vendored/`, copies
the committed C ABI header to `src/nirs4all_io.h`, and `cargo vendor`s every
crates.io transitive dep into `src/rust/vendor.tar.xz`; `src/Makevars(.win)` then
extract that and build the `nirs4all-io-capi` staticlib offline, linking it into
`nirs4allio.{so,dll}`.

```bash
bash bindings/r/build_and_test.sh    # vendor + offline install + smoke test
```

To produce a CRAN-style source tarball and check it as-cran:

```bash
( cd bindings/r && N4IO_R_VENDOR=1 ./configure )   # needs the repo crates/ + network (once)
R CMD build bindings/r                              # -> nirs4allio_<version>.tar.gz (self-contained)
R CMD check --as-cran nirs4allio_*.tar.gz           # offline staticlib build from the bundle
```

R-universe builds straight from Git via the `bindings/r/.prepare` hook, which
runs the same `N4IO_R_VENDOR=1 ./configure` before `R CMD build`. The `Cargo` /
`rustc` toolchain is declared in `SystemRequirements`.

The binding is a thin wrapper: it only marshals JSON strings across the ABI and
runs the single shared Rust core — no NIRS/dataset logic lives here.

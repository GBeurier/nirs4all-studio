# External Operator Binding Contract

`nirs4all-core` may expose external operators beyond metadata only when the
execution layer can actually use them. When such adapters are added, they should
be idiomatic for the host language; until then they are future/gated work, not a
current availability claim. The aggregate must never pretend to execute an
operator by reimplementing numerical behavior locally.

## Gate

An external operator can be exposed as executable only when all of these are
true:

1. The owning upstream project declares the operator contract and version.
2. The relevant executor can plan or call the operator (`dag-ml`,
   `nirs4all-methods`, or the full Python `nirs4all` parity harness).
3. The binding can translate host-native inputs and outputs without lossy
   schema changes.
4. A parity fixture exists against the owning upstream implementation.

If any item is missing, the binding may expose metadata, but execution must fail
with a clear "capability unavailable" diagnostic.

## Capability Levels

Bindings should classify each external operator with one of these states:

- `metadata`: listed in catalogs only; cannot be planned or executed.
- `plan`: can appear in a DAG/execution descriptor, but not run in this binding.
- `execute-local`: can run in the current process through an upstream binding.
- `execute-remote`: can run through an upstream remote/controller boundary.
- `parity-validated`: has cross-runtime fixtures against the owning upstream and,
  when applicable, the full Python `nirs4all` pipeline.

Releases should not market an operator as available unless it is at least
`execute-local` or `execute-remote`.

The per-language capability level of the portable operator subset is recorded,
honestly and machine-readably, in [`compat/capabilities.toml`](../compat/capabilities.toml)
and summarized in [`CAPABILITIES.md`](CAPABILITIES.md). Those claims are enforced
against the binding sources and parity gate files by
`bindings/python/tests/test_capability_matrix.py`, which parses this ladder as
its vocabulary — so a binding cannot claim `execute-local` (or better) without a
real run symbol, nor `parity-validated` without a real parity gate.

## Language Idioms

These are target shapes for future/gated operator adapters. They do not imply
that every language currently has controllers for every upstream domain.

Python:

- sklearn-style estimators/transformers with `fit`, `transform`, `predict`,
  `get_params`, and `set_params` where applicable.
- NumPy arrays and pandas data frames as first-class inputs.
- Optional extras for framework-specific integrations.

R:

- Formula/data-frame entry points where natural.
- S3 methods for `fit`, `predict`, `transform`, `print`, and `summary` where the
  operator has model-like state.
- Compatibility hooks for the R ecosystem should be wrappers over upstream
  behavior, not new algorithms.

Rust:

- Traits and typed builders, returning `Result`.
- Feature-gated upstream integrations when the dependency is optional.
- Explicit ownership for FFI handles and buffers.

JavaScript/WASM:

- Typed ESM exports with browser-safe async initialization.
- `TypedArray`-first numerical inputs; no DOM dependency in the package.
- Promise-returning execution when WASM or remote execution must initialize.

MATLAB/Octave:

- Matrix/table entry points plus explicit options structs.
- Function handles or small classes for stateful operators.
- Octave-safe public APIs unless the function is clearly marked MATLAB-only.

## Parity

Operator parity must compare the host idiom against the owning upstream
implementation. For pipeline operators, fixtures should also compare equivalent
pipelines against the full Python `nirs4all` library before `nirs4all-core` is
used as a replacement core.

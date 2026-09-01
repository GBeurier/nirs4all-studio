# Naming & aggregate facade (LOCK-GOV)

This page records the governed naming of the portable aggregate and the
**additive** import facade introduced by the `LOCK-GOV` slice. It is the
Python-facing companion to the ecosystem governance decisions (`GOV-003`
per-language source-of-truth names, `GOV-004` alias/token policy).

## Aggregate package names (current, RC V1)

The aggregate is published under the bare `nirs4all` name in every host language
**except Python**, where the full `nirs4all` modelling library already owns that
import root. To avoid colliding with it, the Python aggregate ships as
`nirs4all-core` (canonical import `nirs4all_core`).

| Target | Distribution / external name | Import / module name |
| --- | --- | --- |
| Python | `nirs4all-core` | `nirs4all_core` |
| Rust | `nirs4all` | `nirs4all` |
| JavaScript/WASM | `nirs4all` | `nirs4all` |
| R | `nirs4all` | `library(nirs4all)` |
| MATLAB/Octave | `nirs4all` | `+nirs4all` namespace |

For Rust, JavaScript/WASM, R, and MATLAB/Octave, `nirs4all` is the package or
namespace name. It does not imply that every upstream domain has an executable
runtime binding in that host language; unavailable domains remain aggregate
metadata until their owning upstream publishes the corresponding binding.

## Applied Core Naming

The governance direction promotes the aggregate as **`nirs4all-core`** in
Python packaging while Rust/npm/R/MATLAB use the bare `nirs4all` name. This is
an ecosystem-specific packaging rule, not a separate implementation per
language.

- The Python distribution is **`nirs4all-core`**.
- The canonical Python import root is **`nirs4all_core`**.
- The package exposes the full aggregate surface, including runtime helpers that
  delegate to upstream projects.
- GitHub, Read the Docs, and release automation use `nirs4all-core`.
- No public legacy alias release is part of the RC target.

```python
import nirs4all_core

assert "run_portable_pipeline" in nirs4all_core.__all__
```

## The `n4a` facade (additive brand root)

`n4a` is a short, brand-aligned Python import root (`n4a` = "nirs4all") that
re-exports the full public surface of the aggregate. It adds no behavior; it is
a facade over `nirs4all_core`.

```python
import n4a

n4a.upstream_status()
plan = n4a.parse_execution_plan(config)
```

The facade is **additive and non-shadowing**: it does not define a top-level
`nirs4all` Python module, so the full `nirs4all` library and the aggregate can
continue to coexist during the production cutover.

The package exposes `release_topology_manifest()` as a machine-checkable summary
of this contract (schema `nirs4all-core.release-topology.v2`). It records that
the current Python distribution is `nirs4all-core`, that `nirs4all_core` is the
canonical import, and that `n4a` is an additive brand facade.

## `n4a` token disambiguation (GOV-004)

The `n4a` stem is used in three different layers of the ecosystem. They are
intentionally consistent (`n4a` = "nirs4all") but must not be conflated:

| Token | Layer | Meaning |
| --- | --- | --- |
| `n4a` | Python import | The aggregate **import facade** documented here (`import n4a`). |
| `.n4a` | File extension | The pipeline/bundle **file format** produced by the full `nirs4all` library. |
| `n4a-datasets` | Console script | The **CLI** shipped by `nirs4all-datasets`. |

A `.n4a` file is data, `n4a-datasets` is an executable, and `n4a` is an import
root. None is an alias of another.

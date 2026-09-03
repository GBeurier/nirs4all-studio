# dag-ml-core

Portable Rust contracts and execution planning primitives for DAG-ML. The core
validates graph topology, phases, folds, OOF joins, selection, lineage, and
deterministic control decisions; feature buffers and fitted operators remain
host-owned.

Run the package-local test gate from the repository root:

```bash
scripts/test_core_package_extract.sh
```

License: `CeCILL-2.1 OR AGPL-3.0-or-later`. This package includes the AGPL-3.0
text in `LICENSE`; the CeCILL-2.1 alternative and licensing explanation are
available in the source repository's `LICENSES/` and `LICENSING.md`.

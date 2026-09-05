# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""nirs4all-io: assemble arbitrary user inputs into a pipeline dataset.

Pipeline: **Resolve -> Infer -> Configure -> Materialize**.

- ``DatasetSpec``  -- the canonical, serializable configuration IR (Appendix E).
- ``DatasetPlan``  -- a confidence-scored recommendation produced by ``infer``.
- ``infer(input)`` -- inspect any input and propose a ``DatasetPlan``.
- ``load(input)``  -- materialize a spec/plan/input into a target (default: SpectroDataset).
- ``to_dataset_package(input)`` -- materialize into the v3 target-agnostic package.

This package is **self-contained**: it has no runtime dependency on ``nirs4all``.
The only touch-point is a lazy import of the ``SpectroDataset`` class at
materialization time (see ``nirs4all_io.materialize``). ``nirs4all`` may be used
**dev/test-only** as a read-only parity oracle.
"""

from ._version import __version__
from .api import describe_dataset_package, load, to_dataset_package, to_spec
from .infer import DatasetPlan, describe, infer
from .materialize.assemble import AssembledDataset
from .materialize.package import DatasetPackage
from .spec import DatasetSpec, SpecError

__all__ = [
    "__version__",
    "load",
    "infer",
    "to_spec",
    "to_dataset_package",
    "describe_dataset_package",
    "describe",
    "DatasetSpec",
    "DatasetPlan",
    "AssembledDataset",
    "DatasetPackage",
    "SpecError",
]

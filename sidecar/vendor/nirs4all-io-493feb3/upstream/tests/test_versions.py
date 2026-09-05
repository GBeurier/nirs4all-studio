# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Asserts the Python versioned-contract constants match docs/VERSIONING.md (7.5).

Cross-checks the spec schema version against the documented value so the Python
and Rust sides (`crates/nirs4all-io-core/tests/versions.rs`) cannot drift.
"""

from __future__ import annotations

from nirs4all_io.materialize.assemble import ASSEMBLED_DATASET_VERSION
from nirs4all_io.spec.dataset_spec import SCHEMA_VERSION


def test_dataset_spec_schema_version() -> None:
    # Must equal DATASET_SPEC_SCHEMA_VERSION in nirs4all-io-core and the value
    # tabulated in docs/VERSIONING.md.
    assert SCHEMA_VERSION == 1


def test_assembled_dataset_wire_version() -> None:
    """The versioned v2 summary/full wire replaced the unversioned v1 artifact."""
    assert ASSEMBLED_DATASET_VERSION == 2

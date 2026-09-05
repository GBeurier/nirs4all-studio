# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Version gate for native ``AssembledDataset`` JSON exports."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

# Must match nirs4all-io-core's ASSEMBLED_DATASET_VERSION. This is intentionally
# strict: version 1 was unversioned and lacked scientific identity, source ids,
# and stable fold provenance.
ASSEMBLED_DATASET_VERSION = 2


def require_assembled_dataset_v2(full: Mapping[str, Any]) -> None:
    """Reject any native full/summary export other than the v2 wire."""
    version = full.get("assembled_schema_version")
    if type(version) is not int or version != ASSEMBLED_DATASET_VERSION:
        raise ValueError(
            "unsupported AssembledDataset wire: expected "
            f"assembled_schema_version={ASSEMBLED_DATASET_VERSION}"
        )

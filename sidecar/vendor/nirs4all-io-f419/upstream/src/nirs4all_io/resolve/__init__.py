# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Input resolution: any input -> a stable, ordered InputSet (Epic 3.1)."""

from .resolver import InputItem, InputSet, resolve

__all__ = ["resolve", "InputSet", "InputItem"]

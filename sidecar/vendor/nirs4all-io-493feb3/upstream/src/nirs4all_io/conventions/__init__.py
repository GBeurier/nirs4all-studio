# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Declarative convention profiles + the filename-matching engine (Epic 2.3)."""

from .engine import (
    Assignment,
    ConventionResult,
    VendorCorpusResult,
    get_stem,
    has_supported_extension,
    match_items,
    pattern_matches,
)
from .profiles import (
    DEFAULT_EXTENSIONS,
    ROLE_KEY_MAP,
    MatchConfig,
    Profile,
    builtin_profiles,
    load_profile,
    resolve_profiles,
)

__all__ = [
    "Profile",
    "MatchConfig",
    "load_profile",
    "resolve_profiles",
    "builtin_profiles",
    "ROLE_KEY_MAP",
    "DEFAULT_EXTENSIONS",
    "match_items",
    "pattern_matches",
    "get_stem",
    "has_supported_extension",
    "Assignment",
    "ConventionResult",
    "VendorCorpusResult",
]

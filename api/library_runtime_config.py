"""Read-only package configuration projections for the attested runtime host.

Rust supplies its bundled configuration and owns setup state. This module
reports the selected interpreter's distributions; it never invokes pip,
fetches remote configuration, imports HTTP routers or changes environments.
"""

from __future__ import annotations

import importlib.metadata
import sys
from datetime import UTC, datetime
from typing import Any

from packaging.specifiers import SpecifierSet
from packaging.utils import canonicalize_name


def compare_configuration(document: dict[str, Any]) -> dict[str, Any]:
    """Compare installed versions against minimum requirements using PEP 440."""
    if set(document) - {"config", "profile", "include_optional", "include_latest"}:
        raise ValueError("Unexpected runtime configuration fields")
    config = document["config"]
    profile_id = document.get("profile") or "cpu"
    profile = config.get("profiles", {}).get(profile_id)
    if not isinstance(profile, dict) or (profile.get("platforms") and sys.platform not in profile["platforms"]):
        raise ValueError(f"Unknown or incompatible profile: {profile_id}")
    installed = {canonicalize_name(dist.metadata["Name"]): dist.version for dist in importlib.metadata.distributions()
                 if "Name" in dist.metadata and dist.metadata["Name"]}
    # Lite distribution names provide the same capabilities under different
    # published package identities; profile renames remain explicit.
    renames = profile.get("package_renames", {})
    optional = config.get("optional", {})
    visible_managed = {canonicalize_name(name) for name, spec in optional.items() if spec.get("show_when_profile_managed")}
    required = {name: raw for name, raw in profile.get("packages", {}).items() if canonicalize_name(name) not in visible_managed}
    entries = [(name, raw, True) for name, raw in required.items()]
    required_names = {canonicalize_name(name) for name in required}
    if document.get("include_optional", False):
        entries.extend((name, spec, False) for name, spec in optional.items()
                       if canonicalize_name(name) not in required_names
                       and canonicalize_name(renames.get(name, name)) in installed)
    differences = []
    for name, raw, is_required in entries:
        spec = raw if isinstance(raw, dict) else {"min": str(raw)}
        minimum = spec.get("min", spec.get("version", ""))
        if not isinstance(minimum, str):
            raise ValueError(f"Invalid version requirement for {name}")
        recommended = spec.get("recommended")
        actual = installed.get(canonicalize_name(renames.get(name, name)))
        aligned = actual is not None and SpecifierSet(minimum).contains(actual, prereleases=True)
        status = "missing" if actual is None else "aligned" if aligned else "outdated"
        description = (f"{name}=={recommended}" if recommended else f"{name}{minimum}") if is_required else minimum or actual
        differences.append({"name": name, "installed_version": actual, "recommended_version": description,
                            "latest_version": None, "status": status,
                            "action": {"missing": "install", "outdated": "upgrade", "aligned": "none"}[status]})
    counts = {status: sum(row["status"] == status for row in differences) for status in ("aligned", "outdated", "missing")}
    return {"profile": profile_id, "profile_label": profile.get("label", profile_id), "packages": differences,
            "aligned_count": counts["aligned"], "misaligned_count": counts["outdated"], "missing_count": counts["missing"],
            "is_aligned": not counts["outdated"] and not counts["missing"], "checked_at": datetime.now(UTC).isoformat(),
            "version_source": "installed_runtime_and_bundled_requirements", "latest_lookup_performed": False}

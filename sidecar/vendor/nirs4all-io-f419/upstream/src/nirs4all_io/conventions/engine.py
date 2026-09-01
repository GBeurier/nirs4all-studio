# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Convention matching engine (Epic 2.3).

Generalizes ``nirs4all`` ``FolderParser`` (COPY_PROVENANCE #4): the word-boundary
pattern matcher, compound-extension stem logic, multi-source detection and the
bare-stem second pass are reproduced, then lifted onto declarative
:class:`~nirs4all_io.conventions.profiles.Profile` objects with a
formats-registry-driven extension set and a vendor-corpus path.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

from ..spec.enums import Partition, Role
from .profiles import DEFAULT_EXTENSIONS, FOLDS_ROLE_KEY, ROLE_KEY_MAP, Profile

_DELIMITERS = (".", "_", "-", " ")


def pattern_matches(filename: str, pattern: str, *, word_boundary: bool = True) -> bool:
    """Word-boundary-aware match (verbatim from FolderParser._pattern_matches).

    Short patterns (<=2 chars) require a delimiter boundary to avoid false
    positives; longer patterns use substring matching. Inputs are lowercase.
    """
    if word_boundary and len(pattern) <= 2:
        if filename.startswith(pattern):
            if len(filename) == len(pattern) or filename[len(pattern)] in _DELIMITERS:
                return True
        for delim in _DELIMITERS:
            idx = filename.find(delim + pattern)
            if idx >= 0:
                end = idx + len(delim) + len(pattern)
                if end >= len(filename) or filename[end] in _DELIMITERS:
                    return True
        return False
    return pattern in filename


def get_stem(filename: str) -> str:
    """Filename stem without extension, handling compound .csv.gz/.csv.zip."""
    low = filename.lower()
    if low.endswith(".csv.gz"):
        return filename[: -len(".csv.gz")]
    if low.endswith(".csv.zip"):
        return filename[: -len(".csv.zip")]
    idx = filename.rfind(".")
    return filename[:idx] if idx > 0 else filename


def has_supported_extension(name: str, extensions: set[str]) -> bool:
    low = name.lower()
    if low.endswith((".tar.gz", ".tgz", ".tar.bz2", ".tar.xz", ".tar")):
        return False
    if low.endswith(".csv.gz") or low.endswith(".csv.zip"):
        return ".csv.gz" in extensions or ".csv.zip" in extensions or ".gz" in extensions or ".zip" in extensions
    idx = low.rfind(".")
    suffix = low[idx:] if idx >= 0 else ""
    return suffix in extensions


@dataclass
class Assignment:
    name: str
    role: Role
    partition: Partition | None
    source_index: int
    matched_pattern: str
    profile: str


@dataclass
class VendorCorpusResult:
    spectra: list[str] = field(default_factory=list)
    reference: list[str] = field(default_factory=list)
    join: dict = field(default_factory=dict)


@dataclass
class ConventionResult:
    assignments: list[Assignment] = field(default_factory=list)
    fold_files: list[str] = field(default_factory=list)
    unmatched: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    vendor: VendorCorpusResult | None = None


def _effective_extensions(profiles: list[Profile], supported_exts: set[str] | None) -> set[str]:
    for prof in profiles:
        exts = prof.match.extensions
        if exts and exts != ["from-formats-registry"]:
            return {e if e.startswith(".") else f".{e}" for e in exts}
    return supported_exts or set(DEFAULT_EXTENSIONS)


def _merge_roles(profiles: list[Profile]) -> tuple[dict[str, list[str]], dict[str, list[str]], bool]:
    roles: dict[str, list[str]] = {}
    bare: dict[str, list[str]] = {}
    word_boundary = True
    for prof in profiles:
        word_boundary = word_boundary and prof.match.short_pattern_word_boundary
        for key, patterns in prof.roles.items():
            roles.setdefault(key, [])
            for p in patterns:
                if p not in roles[key]:
                    roles[key].append(p)
        for key, stems in prof.bare.items():
            bare.setdefault(key, [])
            for s in stems:
                if s not in bare[key]:
                    bare[key].append(s)
    return roles, bare, word_boundary


def match_items(
    names: list[str],
    profiles: list[Profile],
    *,
    supported_exts: set[str] | None = None,
    is_spectrum: Callable[[str], bool] | None = None,
) -> ConventionResult:
    """Match filenames to roles/partitions using the given profiles.

    ``names`` are file names (basenames or relative paths). ``supported_exts`` is
    the formats-registry extension set (falls back to a CSV family).
    ``is_spectrum`` decides vendor-corpus spectra (typically format sniffing).
    """
    result = ConventionResult()
    if not profiles:
        result.unmatched = list(names)
        return result

    if any(p.is_vendor_corpus for p in profiles):
        vendor_profile = next(p for p in profiles if p.is_vendor_corpus)
        result.vendor = _match_vendor_corpus(names, vendor_profile, is_spectrum)

    role_profiles = [p for p in profiles if not p.is_vendor_corpus]
    if not role_profiles:
        matched_vendor = set((result.vendor.spectra if result.vendor else []) + (result.vendor.reference if result.vendor else []))
        result.unmatched = [n for n in names if n not in matched_vendor]
        return result

    exts = _effective_extensions(role_profiles, supported_exts)
    roles, bare, word_boundary = _merge_roles(role_profiles)
    profile_name = "+".join(p.name for p in role_profiles)
    candidates = sorted([n for n in names if has_supported_extension(n, exts)], key=lambda n: n.lower())
    assigned: set[str] = set()

    # Pass 1: pattern matching per role bucket (multi-match => multi-source).
    for role_key, patterns in roles.items():
        matched: list[str] = []
        for pattern in patterns:
            pat = pattern.lower()
            for name in candidates:
                if pattern_matches(name.lower(), pat, word_boundary=word_boundary) and name not in matched:
                    matched.append(name)
        if not matched:
            continue
        if role_key == FOLDS_ROLE_KEY:
            result.fold_files.extend(matched)
            assigned.update(matched)
            continue
        mapped = ROLE_KEY_MAP.get(role_key)
        if mapped is None:
            continue
        role, partition = mapped
        if len(matched) > 1:
            result.warnings.append(f"{role_key}: {len(matched)} files matched -> multi-source")
        for idx, name in enumerate(matched):
            result.assignments.append(Assignment(name, role, partition, idx, role_key, profile_name))
            assigned.add(name)

    # Pass 2: bare stems (X/Y/M) -> train partition, only for roles still empty.
    bare_role = {"x": Role.FEATURES, "y": Role.TARGETS, "meta": Role.METADATA}
    filled = {(a.role, a.partition) for a in result.assignments}
    for bare_key, stems in bare.items():
        b_role = bare_role.get(bare_key)
        if b_role is None or (b_role, Partition.TRAIN) in filled:
            continue
        for name in candidates:
            if name in assigned:
                continue
            if get_stem(name).lower() in stems:
                result.assignments.append(Assignment(name, b_role, Partition.TRAIN, 0, f"bare:{bare_key}", profile_name))
                assigned.add(name)
                filled.add((b_role, Partition.TRAIN))
                break

    result.unmatched = [n for n in names if n not in assigned and (result.vendor is None or n not in set(result.vendor.spectra + result.vendor.reference))]
    return result


def _match_vendor_corpus(names: list[str], profile: Profile, is_spectrum: Callable[[str], bool] | None) -> VendorCorpusResult:
    spectra_formats = {f.lower().lstrip(".") for f in (profile.spectra or {}).get("formats", [])}
    reference_names = [n.lower() for n in (profile.reference or {}).get("names", [])]

    def _looks_like_spectrum(name: str) -> bool:
        if is_spectrum is not None:
            return is_spectrum(name)
        ext = name.lower().rsplit(".", 1)[-1] if "." in name else ""
        return ext in spectra_formats

    spectra = sorted([n for n in names if _looks_like_spectrum(n)], key=lambda n: n.lower())
    reference = sorted([n for n in names if n not in spectra and any(pattern_matches(get_stem(n).lower(), rn, word_boundary=True) for rn in reference_names)], key=lambda n: n.lower())
    return VendorCorpusResult(spectra=spectra, reference=reference, join=dict(profile.join or {}))

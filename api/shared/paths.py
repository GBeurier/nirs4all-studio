"""
Filesystem path-containment helpers for nirs4all Studio API.

These small utilities harden endpoints that turn user-supplied identifiers or
archive members into filesystem paths. They guard against directory traversal
(``..``), absolute-path injection, and Zip-Slip by confining resolved targets
to a trusted base directory.

The webapp legitimately operates on absolute, file-picker-chosen workspace
paths, so these helpers are applied only where an *untrusted* identifier is
combined with a *trusted* base directory (model IDs, prediction IDs, dataset
delete paths, archive members, base64-decoded workspace IDs).
"""

from __future__ import annotations

import os
from pathlib import Path


def is_within_directory(base: os.PathLike[str] | str, target: os.PathLike[str] | str) -> bool:
    """Return True if ``target`` resolves inside (or equals) ``base``.

    Uses ``os.path.realpath`` so that symlinks and ``..`` segments cannot be
    used to escape ``base``.

    Args:
        base: The trusted base directory.
        target: The path to test for containment.

    Returns:
        True if ``target`` is the same as or nested under ``base``.
    """
    base_real = os.path.realpath(base)
    target_real = os.path.realpath(target)
    if target_real == base_real:
        return True
    return target_real.startswith(base_real + os.sep)


def reject_absolute_or_traversal(identifier: str) -> str:
    """Validate that an identifier is a plain relative name, not a path escape.

    Rejects absolute paths (``/etc/passwd``, ``C:\\...``), drive-letter paths,
    and any identifier containing a ``..`` traversal segment.

    Args:
        identifier: The untrusted identifier to validate.

    Returns:
        The unchanged identifier when it is safe.

    Raises:
        ValueError: If the identifier is empty, absolute, or contains ``..``.
    """
    if not identifier or not identifier.strip():
        raise ValueError("Identifier must not be empty")

    # Normalize separators so '..\\' is caught on POSIX as well as Windows.
    normalized = identifier.replace("\\", "/")

    if _is_absolute(normalized) or Path(identifier).is_absolute():
        raise ValueError(f"Absolute paths are not allowed: {identifier!r}")

    parts = [p for p in normalized.split("/") if p not in ("", ".")]
    if any(p == ".." for p in parts):
        raise ValueError(f"Path traversal is not allowed: {identifier!r}")

    return identifier


def _is_absolute(normalized: str) -> bool:
    """Return True for POSIX-absolute or Windows drive/UNC-prefixed paths.

    Args:
        normalized: An identifier with backslashes already converted to ``/``.

    Returns:
        True if the (normalized) identifier denotes an absolute location.
    """
    if normalized.startswith("/"):
        return True
    # Windows drive letter, e.g. "C:/Windows".
    if len(normalized) >= 2 and normalized[1] == ":" and normalized[0].isalpha():
        return True
    return False


def resolve_within(base: os.PathLike[str] | str, *parts: str) -> Path:
    """Join ``parts`` onto ``base`` and confirm the result stays inside ``base``.

    Each part is first checked with :func:`reject_absolute_or_traversal`, then
    the joined path is verified with :func:`is_within_directory`.

    Args:
        base: The trusted base directory the result must stay within.
        *parts: Untrusted path components to append to ``base``.

    Returns:
        The resolved :class:`~pathlib.Path` under ``base``.

    Raises:
        ValueError: If any part is absolute / traversing, or the joined path
            escapes ``base``.
    """
    for part in parts:
        reject_absolute_or_traversal(part)

    target = Path(base).joinpath(*parts)
    if not is_within_directory(base, target):
        raise ValueError(f"Resolved path escapes base directory: {target!s}")

    return target

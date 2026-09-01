# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Canonical JSON (story 7.3) — the cross-language wire contract.

The single biggest correctness risk in the Rust rewrite is that Python ``json``
and Rust ``serde_json`` disagree byte-for-byte. We pin one canonical form here
and mirror it in ``nirs4all-io-core`` (``canonical_json.rs``); a parity gate on
both sides compares against the same blessed expected files.

Canonical form:

- **Encoding:** UTF-8, no BOM; non-ASCII verbatim (``ensure_ascii=False``), to
  match ``serde_json`` which does not ``\\uXXXX``-escape non-ASCII.
- **Key order:** lexicographic by Unicode code point (``sort_keys=True``);
  matches ``serde_json``'s default ``BTreeMap`` object map.
- **Indent:** two spaces, ``": "`` after keys, one element per line — identical
  layout to ``serde_json::to_string_pretty``.
- **Line endings:** ``\\n`` with a single trailing ``\\n``.
- **Floats:** finite only (``allow_nan=False`` raises on NaN/Inf). The contract
  domain is finite decimals in **normal range** — scores rounded to 3 decimals
  and wavelengths (``|x|`` in roughly ``[1e-3, 25000]``). Values requiring
  exponent notation (``|x| >= 1e16`` or ``0 < |x| < 1e-4``) are the only known
  point where Python ``repr`` and Rust Ryū can disagree; the IR never emits
  them. The ``contract_domain_floats`` parity case pins this range.
"""

from __future__ import annotations

import json
from typing import Any


def canonical_json(value: Any) -> str:
    """Serialize ``value`` to the canonical JSON form (see module docstring)."""
    return (
        json.dumps(
            value,
            indent=2,
            sort_keys=True,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ": "),
        )
        + "\n"
    )

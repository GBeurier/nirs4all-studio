#!/usr/bin/env python3
"""Check Rust public-item documentation coverage with a ratchetable floor."""

from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from pathlib import Path


PUBLIC_ITEM = re.compile(
    r"^\s*pub(?:\([^)]*\))?\s+"
    r"(?:async\s+)?(?:unsafe\s+)?(?:extern\s+\"[^\"]+\"\s+)?"
    r"(?:fn|struct|enum|trait|type|const|static|mod)\b"
)


@dataclass(frozen=True)
class PublicItem:
    path: Path
    line_number: int
    line: str
    documented: bool


def has_doc_comment(lines: list[str], item_index: int) -> bool:
    cursor = item_index - 1
    while cursor >= 0:
        stripped = lines[cursor].strip()
        if not stripped:
            return False
        if stripped.startswith("#[doc"):
            return True
        if stripped.startswith("#["):
            cursor -= 1
            continue
        return stripped.startswith("///") or stripped.startswith("/**")
    return False


def scan_file(path: Path, repo: Path) -> list[PublicItem]:
    lines = path.read_text(encoding="utf-8").splitlines()
    items: list[PublicItem] = []
    for index, line in enumerate(lines):
        if PUBLIC_ITEM.match(line):
            items.append(
                PublicItem(
                    path=path.relative_to(repo),
                    line_number=index + 1,
                    line=line.strip(),
                    documented=has_doc_comment(lines, index),
                )
            )
    return items


def scan_repo(repo: Path) -> list[PublicItem]:
    items: list[PublicItem] = []
    for path in sorted((repo / "crates").glob("*/src/**/*.rs")):
        items.extend(scan_file(path, repo))
    return items


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--min-percent",
        type=float,
        default=33.0,
        help="minimum documented public-item percentage (ratchet floor: raise "
        "toward the current measured value as coverage improves)",
    )
    parser.add_argument(
        "--show-missing",
        type=int,
        default=20,
        help="number of undocumented public items to print on failure",
    )
    args = parser.parse_args()

    repo = Path(__file__).resolve().parents[1]
    items = scan_repo(repo)
    if not items:
        raise SystemExit("no public Rust items found")

    documented = [item for item in items if item.documented]
    coverage = len(documented) * 100.0 / len(items)
    print(
        f"public Rust docs: {len(documented)}/{len(items)} "
        f"({coverage:.1f}%, floor {args.min_percent:.1f}%)"
    )
    if coverage + 1e-9 < args.min_percent:
        missing = [item for item in items if not item.documented]
        for item in missing[: args.show_missing]:
            print(f"missing {item.path}:{item.line_number}: {item.line}")
        raise SystemExit("public Rust documentation coverage is below the ratchet floor")


if __name__ == "__main__":
    main()

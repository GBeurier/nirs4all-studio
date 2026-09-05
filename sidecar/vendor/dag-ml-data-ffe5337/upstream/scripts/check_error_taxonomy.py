#!/usr/bin/env python3
"""Validate the ADR-11 error taxonomy implementation."""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ERROR_RS = ROOT / "crates" / "dag-ml-data-core" / "src" / "error.rs"
PY_BINDING = ROOT / "crates" / "dag-ml-data-py" / "src" / "lib.rs"
WASM_BINDING = ROOT / "crates" / "dag-ml-data-wasm" / "src" / "lib.rs"
C_API = ROOT / "crates" / "dag-ml-data-capi" / "src" / "lib.rs"


def fail(message: str) -> None:
    raise SystemExit(message)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def enum_variants(source: str, enum_name: str) -> list[str]:
    variants: list[str] = []
    inside = False
    for line in source.splitlines():
        stripped = line.strip()
        if stripped == f"pub enum {enum_name} {{":
            inside = True
            continue
        if inside and stripped == "}":
            break
        if not inside or not stripped or stripped.startswith("#"):
            continue
        token = stripped.split("(", 1)[0].split("{", 1)[0].split(",", 1)[0].strip()
        if token and token[0].isupper():
            variants.append(token)
    return variants


def section(source: str, start: str, end: str) -> str:
    start_index = source.find(start)
    require(start_index >= 0, f"missing section start: {start}")
    end_index = source.find(end, start_index + len(start))
    require(end_index >= 0, f"missing section end after {start}: {end}")
    return source[start_index:end_index]


def strip_rust_comments(text: str) -> str:
    """Drop `//` line comments and `/* */` block comments so a variant named only
    in a comment cannot satisfy the coverage check (commented-out match arms do
    not count as coverage)."""
    import re

    without_block = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    return re.sub(r"//[^\n]*", "", without_block)


def require_variant_coverage(source: str, variants: list[str], section_name: str) -> None:
    body = strip_rust_comments(section(source, section_name, "\n    }\n"))
    for variant in variants:
        require(
            f"Self::{variant}" in body,
            f"{section_name} does not cover DataError::{variant}",
        )


def main() -> None:
    error_source = ERROR_RS.read_text(encoding="utf-8")
    variants = enum_variants(error_source, "DataError")
    require(variants, "DataError must declare variants")

    for field in [
        "category",
        "code",
        "severity",
        "message",
        "remediation_hint",
        "context",
    ]:
        require(f"pub {field}:" in error_source, f"DataErrorDescriptor misses {field}")

    require("pub fn descriptor(&self)" in error_source, "DataError must expose descriptor()")
    require(
        "pub fn descriptor_json(&self)" in error_source,
        "DataError must expose descriptor_json()",
    )
    require(
        "pub fn error_code(&self)" in error_source,
        "DataError must expose the ADR-11 numeric error_code()",
    )
    require_variant_coverage(error_source, variants, "fn taxonomy_parts(&self)")
    require_variant_coverage(error_source, variants, "pub fn remediation_hint(&self)")
    require_variant_coverage(error_source, variants, "pub fn context(&self)")
    require_variant_coverage(error_source, variants, "fn numeric_taxonomy(&self)")

    py_source = PY_BINDING.read_text(encoding="utf-8")
    wasm_source = WASM_BINDING.read_text(encoding="utf-8")
    c_api_source = C_API.read_text(encoding="utf-8")
    for label, source in [("Python", py_source), ("WASM", wasm_source)]:
        require(
            "structured_error_descriptors" in source,
            f"{label} manifest must advertise structured_error_descriptors",
        )
        require("descriptor_json" in source, f"{label} binding must emit descriptor JSON")
    require("set_display_error" in c_api_source, "C ABI must emit structured data errors")
    require(
        "descriptor_json" in c_api_source,
        "C ABI must emit the real per-variant DataError descriptor (descriptor_json)",
    )
    # ADR-11(c): thread-local last-error accessors over the C ABI.
    for symbol in ["dagmldata_last_error_json", "dagmldata_last_error_code"]:
        require(
            f"pub extern \"C\" fn {symbol}" in c_api_source
            or f"pub unsafe extern \"C\" fn {symbol}" in c_api_source,
            f"C ABI must expose ADR-11 accessor {symbol}",
        )

    # ADR-11(a): per-category Python exception subclasses, mapped from category.
    for subclass in [
        "DagMlDataValidationError",
        "DagMlDataContractError",
        "DagMlDataCompatibilityError",
    ]:
        require(
            f"create_exception!(_dag_ml_data, {subclass}, DagMlDataError)" in py_source,
            f"Python binding must declare ADR-11 subclass {subclass}",
        )
    require(
        "data_error_type_for_category" in py_source,
        "Python binding must map each error category to its exception subclass",
    )

    print(f"validated ADR-11 taxonomy for {len(variants)} DataError variants")


if __name__ == "__main__":
    main()

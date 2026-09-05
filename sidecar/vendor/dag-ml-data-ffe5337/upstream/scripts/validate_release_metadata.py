#!/usr/bin/env python3
"""Validate release metadata across Cargo, Python, R and CI files."""

from __future__ import annotations

import re
import tomllib
from pathlib import Path
from typing import Any


EXPECTED_CLAP_VERSION = "=4.5.53"
EXPECTED_CARGO_AUDIT_VERSION = "0.22.1"
EXPECTED_INDEXMAP_VERSION = "=2.13.1"
EXPECTED_RUST_VERSION = "1.85"
EXPECTED_RUST_TOOLCHAIN = f"{EXPECTED_RUST_VERSION}.0"
EXPECTED_PYO3_VERSION = "=0.29.2"
# Cargo manifests carry the canonical SPDX expression; pyproject/PEP 639 metadata
# uses the CeCILL project's own casing of the identifier.
EXPECTED_CARGO_LICENSE = "CECILL-2.1 OR AGPL-3.0-or-later"
EXPECTED_PYPROJECT_LICENSE = "CeCILL-2.1 OR AGPL-3.0-or-later"


def load_toml(path: Path) -> dict[str, Any]:
    with path.open("rb") as handle:
        return tomllib.load(handle)


def load_description(path: Path) -> dict[str, str]:
    fields: dict[str, str] = {}
    current_key: str | None = None
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            current_key = None
            continue
        if line[:1].isspace():
            if current_key is not None:
                fields[current_key] = f"{fields[current_key]}\n{line.strip()}"
            continue
        key, separator, value = line.partition(":")
        require(bool(separator), f"{path}: invalid DESCRIPTION line: {line}")
        current_key = key.strip()
        fields[current_key] = value.strip()
    return fields


def fail(message: str) -> None:
    raise SystemExit(message)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def semver_to_pep440(version: str) -> str:
    match = re.fullmatch(
        r"(?P<major>0|[1-9]\d*)\.(?P<minor>0|[1-9]\d*)\.(?P<patch>0|[1-9]\d*)"
        r"(?:-(?P<pre>[A-Za-z]+)\.(?P<pre_n>0|[1-9]\d*))?",
        version,
    )
    if match is None:
        fail(f"unsupported SemVer shape: {version}")
    base = f"{match['major']}.{match['minor']}.{match['patch']}"
    pre = match["pre"]
    if pre is None:
        return base
    pre_map = {"alpha": "a", "beta": "b", "rc": "rc"}
    pep_prefix = pre_map.get(pre)
    if pep_prefix is None:
        fail(f"unsupported SemVer prerelease label for Python package: {pre}")
    return f"{base}{pep_prefix}{match['pre_n']}"


def table_has_workspace_true(table: dict[str, Any], key: str) -> bool:
    value = table.get(key)
    return isinstance(value, dict) and value.get("workspace") is True


def validate_workspace(repo: Path) -> tuple[str, str, list[str]]:
    root = load_toml(repo / "Cargo.toml")
    workspace = root["workspace"]
    package = workspace["package"]
    version = package["version"]
    require(package["edition"] == "2021", "workspace edition must remain 2021")
    require(
        package["rust-version"] == EXPECTED_RUST_VERSION,
        f"workspace MSRV must remain {EXPECTED_RUST_VERSION}",
    )
    require(
        package["license"] == EXPECTED_CARGO_LICENSE,
        f"workspace license must remain {EXPECTED_CARGO_LICENSE}",
    )
    require(package["readme"] == "README.md", "workspace readme must be README.md")
    members = workspace["members"]
    require(members, "workspace must declare members")
    workspace_deps = workspace["dependencies"]
    clap = workspace_deps.get("clap")
    require(
        isinstance(clap, dict) and clap.get("version") == EXPECTED_CLAP_VERSION,
        f"workspace clap must stay pinned to {EXPECTED_CLAP_VERSION}",
    )
    require(
        workspace_deps.get("pyo3") == EXPECTED_PYO3_VERSION,
        f"workspace pyo3 must stay pinned to {EXPECTED_PYO3_VERSION}",
    )
    require(
        "serde_yml" not in workspace_deps,
        "workspace must not depend on serde_yml due RustSec RUSTSEC-2025-0068",
    )
    if "yaml_serde" in workspace_deps:
        require(
            workspace_deps.get("indexmap") == EXPECTED_INDEXMAP_VERSION,
            f"workspace indexmap must stay pinned to {EXPECTED_INDEXMAP_VERSION}",
        )

    for member in members:
        manifest_path = repo / member / "Cargo.toml"
        manifest = load_toml(manifest_path)
        crate_package = manifest["package"]
        for key in [
            "version",
            "edition",
            "rust-version",
            "license",
            "authors",
            "repository",
            "homepage",
        ]:
            require(
                table_has_workspace_true(crate_package, key),
                f"{manifest_path}: package.{key} must inherit from workspace",
            )
        if member.endswith("-wasm"):
            require(
                table_has_workspace_true(manifest["dependencies"], "wasm-bindgen"),
                f"{manifest_path}: wasm-bindgen must inherit from workspace",
            )

    for dep_name, dep in workspace_deps.items():
        if not isinstance(dep, dict) or "path" not in dep:
            continue
        require(
            dep.get("version") == version,
            f"workspace dependency {dep_name} must pin version {version}",
        )
        require(
            (repo / dep["path"] / "Cargo.toml").is_file(),
            f"workspace dependency {dep_name} path does not point to a crate",
        )
    return package["repository"].removesuffix("/").split("/")[-1], version, members


def validate_python(repo: Path, repo_name: str, version: str) -> None:
    py_crate = repo / "crates" / f"{repo_name}-py"

    # The PyO3 crate is excluded from the workspace (its abi3-py311 floor would
    # force a Python>=3.11 host for `cargo test --workspace`/`cargo llvm-cov`),
    # so it carries literal metadata + pinned deps instead of inheriting from
    # the workspace. Validate them here so they cannot drift out of sync — the
    # native module embeds CARGO_PKG_VERSION, so the Cargo version must track
    # the workspace version.
    cargo_path = py_crate / "Cargo.toml"
    require(cargo_path.is_file(), f"missing Python crate manifest: {cargo_path}")
    cargo = load_toml(cargo_path)
    cargo_package = cargo["package"]
    require(
        cargo_package.get("version") == version,
        f"{cargo_path}: package.version must match workspace version {version}",
    )
    require(
        cargo_package.get("rust-version") == EXPECTED_RUST_VERSION,
        f"{cargo_path}: package.rust-version must be {EXPECTED_RUST_VERSION}",
    )
    require(cargo_package.get("edition") == "2021", f"{cargo_path}: package.edition must be 2021")
    require(
        cargo_package.get("license") == EXPECTED_CARGO_LICENSE,
        f"{cargo_path}: package.license must be {EXPECTED_CARGO_LICENSE}",
    )
    require(
        cargo_package.get("publish") is False,
        f"{cargo_path}: excluded wheel crate must set publish = false",
    )
    cargo_deps = cargo["dependencies"]
    pyo3 = cargo_deps.get("pyo3")
    require(isinstance(pyo3, dict), f"{cargo_path}: pyo3 dependency must be a table")
    require(
        pyo3.get("version") == EXPECTED_PYO3_VERSION,
        f"{cargo_path}: pyo3 must stay pinned to {EXPECTED_PYO3_VERSION}",
    )
    require(
        "abi3-py311" in pyo3.get("features", []),
        f"{cargo_path}: Python extension must use abi3-py311",
    )
    core_dep = cargo_deps.get(f"{repo_name}-core")
    require(isinstance(core_dep, dict), f"{cargo_path}: {repo_name}-core dependency must be a table")
    require(
        core_dep.get("version") == version,
        f"{cargo_path}: {repo_name}-core dependency must pin version {version}",
    )
    require(
        core_dep.get("path") == f"../{repo_name}-core",
        f"{cargo_path}: {repo_name}-core dependency must use path ../{repo_name}-core",
    )

    lock_path = py_crate / "Cargo.lock"
    require(lock_path.is_file(), f"missing tracked Python Cargo lock: {lock_path}")
    lock = load_toml(lock_path)
    locked = {(package["name"], package["version"]): package for package in lock["package"]}
    require(
        (f"{repo_name}-py", version) in locked,
        f"{lock_path}: Python crate version must match {version}",
    )
    require(
        (f"{repo_name}-core", version) in locked,
        f"{lock_path}: core crate version must match {version}",
    )
    require(
        ("pyo3", EXPECTED_PYO3_VERSION.removeprefix("=")) in locked,
        f"{lock_path}: pyo3 must be locked to {EXPECTED_PYO3_VERSION}",
    )

    pyproject_path = py_crate / "pyproject.toml"
    require(pyproject_path.is_file(), f"missing Python pyproject: {pyproject_path}")
    pyproject = load_toml(pyproject_path)
    project = pyproject["project"]
    pep440_version = semver_to_pep440(version)
    require(project["name"] == repo_name, f"{pyproject_path}: project.name mismatch")
    require(
        project["version"] == pep440_version,
        f"{pyproject_path}: project.version must be {pep440_version}",
    )
    require(project["requires-python"] == ">=3.11", "Python package must require >=3.11")
    require(
        "maturin>=1.13,<2" in pyproject["build-system"]["requires"],
        "pyproject build-system must pin maturin>=1.13,<2",
    )
    require(
        project["license"] == EXPECTED_PYPROJECT_LICENSE,
        f"Python package license must remain {EXPECTED_PYPROJECT_LICENSE}",
    )
    require(project["license-files"] == ["LICENSE"], "Python package must include LICENSE")
    maturin = pyproject["tool"]["maturin"]
    module_prefix = repo_name.replace("-", "_")
    module_suffix = f"_{module_prefix}"
    require(
        maturin["module-name"] == f"{module_prefix}.{module_suffix}",
        "maturin module-name mismatch",
    )
    require(maturin["python-source"] == "python", "maturin python-source must be python")
    require(
        "extension-module" in maturin["features"],
        "maturin features must include extension-module",
    )
    require((py_crate / "python" / module_prefix / "py.typed").is_file(), "missing py.typed")
    require((py_crate / "python" / module_prefix / "__init__.pyi").is_file(), "missing stub file")


def validate_r(repo: Path, repo_name: str, version: str) -> None:
    r_crate = repo / "crates" / f"{repo_name}-r"

    description_path = r_crate / "DESCRIPTION"
    require(description_path.is_file(), f"missing R DESCRIPTION: {description_path}")
    description = load_description(description_path)
    require(
        description.get("Package") == repo_name.replace("-", ""),
        f"{description_path}: Package mismatch",
    )
    require(
        description.get("Version") == version,
        f"{description_path}: Version must match workspace version {version}",
    )

    cargo_path = r_crate / "src" / "rust" / "Cargo.toml"
    require(cargo_path.is_file(), f"missing R Rust manifest: {cargo_path}")
    cargo = load_toml(cargo_path)
    cargo_package = cargo["package"]
    require(
        cargo_package.get("version") == version,
        f"{cargo_path}: package.version must match workspace version {version}",
    )


def validate_ci(repo: Path) -> None:
    workflow = (repo / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    require(
        f'CARGO_AUDIT_VERSION: "{EXPECTED_CARGO_AUDIT_VERSION}"' in workflow,
        "CI must pin CARGO_AUDIT_VERSION",
    )
    require('MATURIN_VERSION: "1.13.3"' in workflow, "CI must pin MATURIN_VERSION")
    require(
        f'RUST_MSRV: "{EXPECTED_RUST_TOOLCHAIN}"' in workflow,
        "CI must pin RUST_MSRV",
    )
    require('WASM_PACK_VERSION: "0.15.0"' in workflow, "CI must pin WASM_PACK_VERSION")
    require(
        "toolchain: ${{ env.RUST_MSRV }}" in workflow,
        "CI must install the pinned MSRV toolchain",
    )
    require(
        "cargo check --workspace --all-targets" in workflow,
        "CI must run cargo check on the pinned MSRV",
    )
    require(
        "scripts/smoke_python_wheel_metadata.py" in workflow,
        "CI must validate Python wheel metadata",
    )
    require(
        "scripts/smoke_wasm_tarball_metadata.mjs" in workflow,
        "CI must validate npm tarball metadata",
    )
    require(
        "scripts/smoke_wasm_provider_bindings.cjs" in workflow,
        "CI must execute the opt-in WASM provider bindings",
    )
    require(
        "--features provider" in workflow,
        "CI must build the WASM provider feature",
    )
    require(
        "scripts/validate_abi_snapshot.py" in workflow,
        "CI must validate the public ABI snapshot",
    )
    require(
        "scripts/check_deprecations.py" in workflow,
        "CI must enforce ADR-14 managed-debt rules",
    )
    require(
        "scripts/check_public_docs.py" in workflow,
        "CI must enforce the public Rust documentation ratchet",
    )
    require(
        "scripts/check_error_taxonomy.py" in workflow,
        "CI must enforce ADR-11 error taxonomy metadata",
    )
    require(
        'cargo install cargo-audit --version "$CARGO_AUDIT_VERSION" --locked' in workflow,
        "CI must install the pinned cargo-audit",
    )
    require(
        "cargo audit --deny warnings" in workflow,
        "CI must run cargo audit with warnings denied",
    )
    require(
        "cargo audit --file crates/dag-ml-data-py/Cargo.lock --deny warnings" in workflow,
        "CI must audit the standalone Python binding lock",
    )
    require(
        "python -m maturin build --locked" in workflow,
        "CI must build the Python wheel from its tracked Cargo lock",
    )
    require(
        "cargo check --locked --manifest-path crates/dag-ml-data-py/Cargo.toml --all-targets"
        in workflow,
        "CI must check the Python binding on the declared MSRV",
    )
    require(
        "cargo clippy --locked --manifest-path crates/dag-ml-data-py/Cargo.toml --all-targets -- -D warnings"
        in workflow,
        "CI must lint the standalone Python binding",
    )
    require(
        "cargo test --locked --manifest-path crates/dag-ml-data-py/Cargo.toml" in workflow,
        "CI must test the standalone Python binding",
    )
    require("cargo package --workspace --no-verify" in workflow, "CI must package Cargo crates")
    require(
        "scripts/release/check_publish_plan.py --dry-run" in workflow,
        "CI must dry-run publishable Cargo root crates",
    )
    require('RUSTDOCFLAGS="-D warnings" cargo doc --workspace --no-deps' in workflow, "CI must gate rustdoc warnings")
    require("wasm-pack pack --pkg-dir pkg-web ." in workflow, "CI must pack web WASM packages")
    require('RUSTFLAGS: "-Zsanitizer=address"' in workflow, "CI must run a C ABI AddressSanitizer lane")
    require(
        "cargo test -p dag-ml-data-capi --lib -Zbuild-std --target x86_64-unknown-linux-gnu" in workflow,
        "CI must exercise dag-ml-data-capi unit tests under AddressSanitizer",
    )


def validate_governance(repo: Path, repo_name: str) -> None:
    required_files = [
        "CHANGELOG.md",
        "CODEOWNERS",
        "CODE_OF_CONDUCT.md",
        "CONTRIBUTING.md",
        "SECURITY.md",
        ".github/PULL_REQUEST_TEMPLATE.md",
        ".github/dependabot.yml",
        ".github/ISSUE_TEMPLATE/bug_report.yml",
        ".github/ISSUE_TEMPLATE/contract_change.yml",
        "examples/README.md",
        "scripts/check_deprecations.py",
        "scripts/check_error_taxonomy.py",
        "scripts/check_public_docs.py",
        "scripts/release/check_publish_plan.py",
    ]
    for relative_path in required_files:
        require((repo / relative_path).is_file(), f"missing governance file: {relative_path}")

    codeowners = (repo / "CODEOWNERS").read_text(encoding="utf-8")
    require("* @GBeurier" in codeowners, "CODEOWNERS must assign default ownership")
    require(
        "/docs/contracts/ @GBeurier" in codeowners,
        "CODEOWNERS must cover shared contract artifacts",
    )
    require(
        "/.github/workflows/ @GBeurier" in codeowners,
        "CODEOWNERS must cover CI workflows",
    )

    dependabot = (repo / ".github" / "dependabot.yml").read_text(encoding="utf-8")
    for ecosystem in ['"cargo"', '"github-actions"', '"pip"']:
        require(
            f'package-ecosystem: {ecosystem}' in dependabot,
            f"dependabot must cover {ecosystem}",
        )
    require(
        f'directory: "/crates/{repo_name}-py"' in dependabot,
        "dependabot must cover the Python binding crate",
    )

    pull_request_template = (repo / ".github" / "PULL_REQUEST_TEMPLATE.md").read_text(
        encoding="utf-8"
    )
    for command in [
        "cargo clippy --workspace --all-targets -- -D warnings",
        "scripts/validate_contracts.py",
        "scripts/check_error_taxonomy.py",
        "scripts/check_deprecations.py",
        "scripts/check_public_docs.py",
        "scripts/release/check_publish_plan.py",
        "scripts/validate_release_metadata.py",
        "scripts/validate_abi_snapshot.py",
    ]:
        require(
            command in pull_request_template,
            f"PR template must require {command}",
        )
    require(
        "CHANGELOG.md" in pull_request_template,
        "PR template must require changelog review",
    )

    examples_readme = (repo / "examples" / "README.md").read_text(encoding="utf-8")
    require(
        "Audience" in examples_readme and "Purpose" in examples_readme,
        "examples/README.md must include an audience matrix",
    )


def validate_docs_site(repo: Path, repo_name: str) -> None:
    required_files = [
        "docs/conf.py",
        "docs/index.md",
        "docs/installation.md",
        "docs/requirements.txt",
    ]
    for relative_path in required_files:
        require((repo / relative_path).is_file(), f"missing docs site file: {relative_path}")

    requirements = (repo / "docs" / "requirements.txt").read_text(encoding="utf-8")
    for package in ["sphinx", "myst-parser", "sphinx-copybutton", "sphinx-design"]:
        require(package in requirements, f"docs requirements must include {package}")

    conf = (repo / "docs" / "conf.py").read_text(encoding="utf-8")
    for extension in ["myst_parser", "sphinx_copybutton", "sphinx_design"]:
        require(extension in conf, f"Sphinx config must enable {extension}")
    require('html_theme = "alabaster"' in conf, "Sphinx config must set a stable theme")

    index = (repo / "docs" / "index.md").read_text(encoding="utf-8")
    rustdoc_crate = f"{repo_name}-core"
    require(
        f"https://docs.rs/{rustdoc_crate}/latest/" in index,
        "docs landing page must link to the Rust core API reference",
    )
    require(
        "contracts/README" in index and "adr/README" in index,
        "docs landing page must include contracts and ADR navigation",
    )

    workflow = (repo / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    require("name: Documentation site" in workflow, "CI must include a docs-site job")
    require(
        "python -m pip install -r docs/requirements.txt" in workflow,
        "CI must install docs dependencies from docs/requirements.txt",
    )
    require(
        "sphinx-build -W --keep-going -b html docs docs/_build/html" in workflow,
        "CI must build the Sphinx docs with warnings denied",
    )


def main() -> None:
    repo = Path(__file__).resolve().parents[1]
    repo_name, version, _members = validate_workspace(repo)
    validate_python(repo, repo_name, version)
    validate_r(repo, repo_name, version)
    validate_ci(repo)
    validate_governance(repo, repo_name)
    validate_docs_site(repo, repo_name)
    print(f"validated release metadata for {repo_name} {version}")


if __name__ == "__main__":
    main()

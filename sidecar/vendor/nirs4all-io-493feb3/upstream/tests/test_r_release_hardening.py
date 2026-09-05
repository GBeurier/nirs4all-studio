# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
from __future__ import annotations

import importlib.util
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _checker_module():
    path = ROOT / "scripts/check_r_reduced_workspace.py"
    spec = importlib.util.spec_from_file_location("check_r_reduced_workspace", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_r_reduced_workspace_matches_root_manifest_and_lock() -> None:
    assert _checker_module().check_repository(ROOT) == []


def _copy_workspace_contract(tmp_path: Path) -> Path:
    for relative in (
        "Cargo.toml",
        "Cargo.lock",
        "bindings/r/configure",
        "bindings/r/Cargo.lock.rust",
    ):
        destination = tmp_path / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / relative, destination)
    for crate in _checker_module().R_CRATES:
        destination = tmp_path / "crates" / crate / "Cargo.toml"
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / "crates" / crate / "Cargo.toml", destination)
    return tmp_path


def test_r_reduced_workspace_detects_feature_drift(tmp_path: Path) -> None:
    checkout = _copy_workspace_contract(tmp_path)
    configure = checkout / "bindings/r/configure"
    text = configure.read_text(encoding="utf-8")
    text = text.replace(
        'serde = { version = "1.0", features = ["derive"] }',
        'serde = { version = "1.0", features = [] }',
        1,
    )
    configure.write_text(text, encoding="utf-8")

    errors = _checker_module().check_repository(checkout)
    assert any("dependency 'serde' version/features differ" in error for error in errors)


def test_r_reduced_workspace_detects_lock_pin_drift(tmp_path: Path) -> None:
    checkout = _copy_workspace_contract(tmp_path)
    lock = checkout / "bindings/r/Cargo.lock.rust"
    text = lock.read_text(encoding="utf-8")
    text = text.replace(
        'name = "adler2"\nversion = "2.0.1"',
        'name = "adler2"\nversion = "2.0.0"',
        1,
    )
    lock.write_text(text, encoding="utf-8")

    errors = _checker_module().check_repository(checkout)
    assert any("package pin is absent" in error and "adler2" in error for error in errors)


def test_r_makevars_isolate_windows_scratch_and_remap_build_paths() -> None:
    makevars = (ROOT / "bindings/r/src/Makevars").read_text(encoding="utf-8")
    windows = (ROOT / "bindings/r/src/Makevars.win").read_text(encoding="utf-8")

    assert "mktemp -d /tmp/n4io-XXXXXXXX" in windows
    assert "TARGET_DIR = $(SHORT_TMP)/n4io" not in windows
    assert 'rm -Rf "$(N4IO_BUILD_DIR)"' in windows
    for content in (makevars, windows):
        assert "--remap-path-prefix=$(CURDIR)=/nirs4allio-src" in content
        assert "--remap-path-prefix=$(CARGOTMP)=/cargo-home" in content

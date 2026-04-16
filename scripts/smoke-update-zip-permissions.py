"""Smoke-test update ZIP extraction on POSIX targets.

This validates the real updater staging path against a packaged standalone ZIP:
- extract through ``api.update_downloader.UpdateDownloader``
- locate the staged app executable and bundled Python runtime
- assert they remain executable after staging
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
import tempfile
from pathlib import Path

# Allow `python scripts/...py` to resolve repo-local packages in CI and local runs.
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import api.update_downloader as update_downloader

APP_NAME = "nirs4all Studio"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Smoke-test ZIP update extraction permissions")
    parser.add_argument("--archive", required=True, help="Path to the packaged ZIP archive")
    parser.add_argument(
        "--platform",
        choices=("linux", "darwin"),
        default=sys.platform,
        help="Target platform layout to validate",
    )
    parser.add_argument("--app-name", default=APP_NAME, help="Expected packaged app name")
    return parser.parse_args()


def get_expected_executable_name(platform_name: str, app_name: str) -> str:
    if platform_name == "win32":
        return f"{app_name}.exe"
    if platform_name == "darwin":
        return app_name
    return update_downloader.get_executable_name()


def resolve_paths(content_dir: Path, platform_name: str, app_name: str) -> tuple[Path, Path, Path]:
    if platform_name == "darwin":
        app_bundle = content_dir if content_dir.suffix == ".app" else next(content_dir.glob("*.app"), None)
        if app_bundle is None:
            raise FileNotFoundError(f"No .app bundle found in {content_dir}")
        resources_dir = app_bundle / "Contents" / "Resources"
        executable_path = app_bundle / "Contents" / "MacOS" / app_name
        runtime_root = resources_dir / "backend" / "python-runtime"
        python_candidates = [
            runtime_root / "python" / "bin" / "python3",
            runtime_root / "python" / "bin" / "python",
            runtime_root / "venv" / "bin" / "python",
        ]
        runtime_ready = runtime_root / "RUNTIME_READY.json"
        python_path = next((candidate for candidate in python_candidates if candidate.exists()), python_candidates[0])
        return executable_path, python_path, runtime_ready

    executable_path = content_dir / get_expected_executable_name(platform_name, app_name)
    runtime_root = content_dir / "resources" / "backend" / "python-runtime"
    python_candidates = [
        runtime_root / "python" / "bin" / "python3",
        runtime_root / "python" / "bin" / "python",
        runtime_root / "venv" / "bin" / "python",
    ]
    python_path = next((candidate for candidate in python_candidates if candidate.exists()), python_candidates[0])
    runtime_ready = runtime_root / "RUNTIME_READY.json"
    return executable_path, python_path, runtime_ready


def assert_executable(target: Path, label: str) -> None:
    if not target.exists():
        raise FileNotFoundError(f"{label} not found: {target}")
    if not os.access(target, os.X_OK):
        raise PermissionError(f"{label} is not executable after staging: {target}")


def main() -> int:
    if os.name == "nt":
        raise SystemExit("This smoke test only applies to POSIX ZIP permission handling")

    args = parse_args()
    archive_path = Path(args.archive).resolve()
    if not archive_path.exists():
        raise FileNotFoundError(f"Archive not found: {archive_path}")

    with tempfile.TemporaryDirectory(prefix="n4a-update-zip-smoke-") as temp_dir:
        staging_dir = Path(temp_dir) / "staging"
        update_downloader.get_staging_dir = lambda: staging_dir  # type: ignore[assignment]
        downloader = update_downloader.UpdateDownloader(
            download_url="https://example.invalid/standalone.zip",
            expected_size=archive_path.stat().st_size,
        )
        success, message, content_dir = asyncio.run(downloader.extract(archive_path))
        if not success or content_dir is None:
            raise RuntimeError(f"Archive extraction failed: {message}")

        executable_path, python_path, runtime_ready = resolve_paths(content_dir, args.platform, args.app_name)
        if not runtime_ready.exists():
            raise FileNotFoundError(f"Bundled runtime marker not found: {runtime_ready}")
        assert_executable(executable_path, "App executable")
        assert_executable(python_path, "Bundled Python")

        print(f"Update ZIP smoke passed for {archive_path.name}")
        print(f"  executable: {executable_path}")
        print(f"  python:     {python_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

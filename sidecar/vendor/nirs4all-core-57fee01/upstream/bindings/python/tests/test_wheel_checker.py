"""Tests for the release wheel inventory checker."""

from __future__ import annotations

import subprocess
import stat
import sys
import tempfile
import unittest
import warnings
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
CHECKER = ROOT / "scripts" / "check_python_wheel.py"
VERSION = "0.3.28"


class WheelCheckerTests(unittest.TestCase):
    def _wheel(
        self,
        directory: Path,
        extra_names: tuple[str, ...] = (),
        *,
        init_newline: str = "\n",
    ) -> Path:
        wheel = directory / f"nirs4all_core-{VERSION}-cp311-abi3-linux_x86_64.whl"
        with zipfile.ZipFile(wheel, "w") as archive:
            archive.writestr(
                f"nirs4all_core-{VERSION}.dist-info/METADATA",
                f"Metadata-Version: 2.4\nName: nirs4all-core\nVersion: {VERSION}\n"
                "License-Expression: CECILL-2.1 OR AGPL-3.0-or-later\n",
            )
            archive.writestr(
                "nirs4all_core/__init__.py",
                f'__version__ = "{VERSION}"{init_newline}',
            )
            archive.writestr("n4a/__init__.py", "from nirs4all_core import *\n")
            archive.writestr(
                f"nirs4all_core-{VERSION}.dist-info/licenses/LICENSE",
                (ROOT / "LICENSE").read_bytes(),
            )
            for license_path in sorted((ROOT / "LICENSES").iterdir()):
                archive.writestr(
                    f"nirs4all_core-{VERSION}.dist-info/licenses/LICENSES/{license_path.name}",
                    license_path.read_bytes(),
                )
            archive.writestr(
                f"nirs4all_core-{VERSION}.dist-info/licenses/LICENSING.md",
                (ROOT / "LICENSING.md").read_bytes(),
            )
            archive.writestr(
                f"nirs4all_core-{VERSION}.dist-info/licenses/THIRD_PARTY_NOTICES.md",
                (ROOT / "THIRD_PARTY_NOTICES.md").read_bytes(),
            )
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                for name in extra_names:
                    archive.writestr(name, b"unsafe")
        return wheel

    def _check(self, wheel: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(CHECKER), str(wheel)],
            check=False,
            capture_output=True,
            text=True,
        )

    def test_accepts_closed_public_inventory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            result = self._check(self._wheel(Path(directory)))
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_accepts_windows_crlf_version_source(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            wheel = self._wheel(Path(directory), init_newline="\r\n")
            result = self._check(wheel)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_refuses_cache_duplicate_and_traversal_entries(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            wheel = self._wheel(
                Path(directory),
                (
                    "n4a/__init__.py",
                    "n4a/__pycache__/bad.pyc",
                    "../outside.py",
                    "C:/outside.py",
                    "evilpkg/payload.py",
                    "n4a\\windows.py",
                ),
            )
            with zipfile.ZipFile(wheel, "a") as archive:
                symlink = zipfile.ZipInfo("n4a/link")
                symlink.create_system = 3
                symlink.external_attr = (stat.S_IFLNK | 0o777) << 16
                archive.writestr(symlink, "../nirs4all_core/__init__.py")
            result = self._check(wheel)
        self.assertEqual(result.returncode, 1)
        self.assertIn("duplicate ZIP entries", result.stderr)
        self.assertIn("Python cache entries", result.stderr)
        self.assertIn("unsafe ZIP paths", result.stderr)
        self.assertIn("special ZIP entries", result.stderr)
        self.assertIn("unexpected wheel roots", result.stderr)


if __name__ == "__main__":
    unittest.main()

"""Tests for the packaged general-workflow target layout."""

import unittest
from pathlib import Path, PurePosixPath

from general_workflow_platform import packaged_python_layout


class PackagedPythonLayoutTests(unittest.TestCase):
    def test_windows_uses_embedded_python_and_lib_site_packages(self) -> None:
        host, site_packages = packaged_python_layout(Path("runtime"), "nt")
        self.assertEqual(PurePosixPath(host.as_posix()), PurePosixPath("runtime/python/python.exe"))
        self.assertEqual(
            PurePosixPath(site_packages.as_posix()),
            PurePosixPath("runtime/python/Lib/site-packages"),
        )

    def test_unix_uses_embedded_bin_and_versioned_site_packages(self) -> None:
        host, site_packages = packaged_python_layout(Path("runtime"), "posix")
        self.assertEqual(PurePosixPath(host.as_posix()), PurePosixPath("runtime/python/bin/python3"))
        self.assertEqual(
            PurePosixPath(site_packages.as_posix()),
            PurePosixPath("runtime/python/lib/python3.11/site-packages"),
        )


if __name__ == "__main__":
    unittest.main()

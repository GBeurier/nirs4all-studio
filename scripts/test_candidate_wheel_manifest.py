"""Integrity checks for the candidate wheel manifest pin."""

from __future__ import annotations

import base64
import csv
import hashlib
import io
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

from candidate_wheel_manifest import manifest_sha256


class CandidateWheelManifestTest(unittest.TestCase):
    def test_manifest_matches_wheel_record_and_rejects_tampering(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            wheel_path = Path(directory) / "candidate.whl"
            files = {
                "nirs4all/__init__.py": b"__version__ = '1.3.1.dev0'\n",
                "nirs4all-1.3.1.dev0.dist-info/WHEEL": b"Wheel-Version: 1.0\n",
            }
            record = "nirs4all-1.3.1.dev0.dist-info/RECORD"
            rows = []
            for name, payload in files.items():
                digest = base64.urlsafe_b64encode(hashlib.sha256(payload).digest()).decode("ascii").rstrip("=")
                rows.append((name, f"sha256={digest}", str(len(payload))))
            rows.append((record, "", ""))

            def write_wheel(*, tamper: bool = False, duplicate: bool = False) -> None:
                data = io.StringIO()
                csv.writer(data, lineterminator="\n").writerows(rows)
                with ZipFile(wheel_path, "w") as wheel:
                    for name, payload in files.items():
                        wheel.writestr(name, payload + (b"tampered" if tamper and name.startswith("nirs4all/") else b""))
                    wheel.writestr(record, data.getvalue())
                    if duplicate:
                        wheel.writestr("nirs4all/__init__.py", files["nirs4all/__init__.py"])

            write_wheel()
            self.assertEqual(len(manifest_sha256(wheel_path)), 64)
            write_wheel(tamper=True)
            with self.assertRaisesRegex(ValueError, "integrity mismatch"):
                manifest_sha256(wheel_path)
            write_wheel(duplicate=True)
            with self.assertRaisesRegex(ValueError, "duplicate member"):
                manifest_sha256(wheel_path)


if __name__ == "__main__":
    unittest.main()

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

from candidate_wheel_manifest import candidate_attestation, manifest_sha256


class CandidateWheelManifestTest(unittest.TestCase):
    def test_candidate_requires_current_payload_and_keeps_publication_pending(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            callable_path = source / "nirs4all/api/studio_scientific.py"
            callable_path.parent.mkdir(parents=True)
            callable_path.write_bytes(b"def studio_scientific_job_v1(request): return request\n")
            payloads = {
                "nirs4all/api/studio_scientific.py": callable_path.read_bytes(),
                "nirs4all-1.4.1.dist-info/METADATA": b"Name: nirs4all\nVersion: 1.4.1\n",
            }
            record = "nirs4all-1.4.1.dist-info/RECORD"
            rows = []
            for name, payload in payloads.items():
                digest = base64.urlsafe_b64encode(hashlib.sha256(payload).digest()).decode("ascii").rstrip("=")
                rows.append((name, f"sha256={digest}", str(len(payload))))
            rows.append((record, "", ""))
            output = io.StringIO()
            csv.writer(output, lineterminator="\n").writerows(rows)
            wheel_path = root / "nirs4all-1.4.1-py3-none-any.whl"
            with ZipFile(wheel_path, "w") as wheel:
                for name, payload in payloads.items():
                    wheel.writestr(name, payload)
                wheel.writestr(record, output.getvalue())
            attestation = candidate_attestation(wheel_path, source, "1.4.1")
            self.assertEqual(attestation["publication_status"], "pending")
            self.assertFalse(attestation["public_registry_verified"])
            self.assertEqual(attestation["wheel_sha256"], hashlib.sha256(wheel_path.read_bytes()).hexdigest())
            self.assertEqual(attestation["callable_sha256"], hashlib.sha256(callable_path.read_bytes()).hexdigest())
            callable_path.write_bytes(b"new source payload\n")
            with self.assertRaisesRegex(ValueError, "source payload differs"):
                candidate_attestation(wheel_path, source, "1.4.1")
            callable_path.write_bytes(payloads["nirs4all/api/studio_scientific.py"])
            (source / "nirs4all/new_module.py").write_bytes(b"missing from wheel\n")
            with self.assertRaisesRegex(ValueError, "member inventory differs"):
                candidate_attestation(wheel_path, source, "1.4.1")

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

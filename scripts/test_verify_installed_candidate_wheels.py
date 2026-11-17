"""An environment qualifies only when it holds every file of the candidate wheel, byte for byte."""

from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

SCRIPT = Path(__file__).with_name("verify-installed-candidate-wheels.py")
SPEC = importlib.util.spec_from_file_location("verify_installed_candidate_wheels", SCRIPT)
assert SPEC and SPEC.loader
verifier = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(verifier)


class InstalledCandidateTests(unittest.TestCase):
    def test_environment_must_hold_the_exact_wheel_members(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            site = root / "venv/lib/python3.11/site-packages"
            members = {
                "candidate/module.py": b"VALUE = 1\n",
                "candidate/native.so": b"\x7fELF candidate",
                "candidate-0.1.dist-info/METADATA": b"Name: candidate\n",
            }
            wheel = root / "candidate-0.1-py3-none-any.whl"
            with ZipFile(wheel, "w") as archive:
                for name, payload in members.items():
                    archive.writestr(name, payload)
                    (site / name).parent.mkdir(parents=True, exist_ok=True)
                    (site / name).write_bytes(payload)
                archive.writestr("candidate-0.1.dist-info/RECORD", b"written by the build")
            # The installer rewrites RECORD: it is the only member that may differ.
            (site / "candidate-0.1.dist-info/RECORD").write_bytes(b"rewritten by the installer")
            self.assertEqual(verifier.verify_wheel(site, wheel), (wheel.name, 3))

            # Another build of the same version, as a package index would serve it.
            (site / "candidate/native.so").write_bytes(b"\x7fELF published")
            with self.assertRaisesRegex(ValueError, "differs from wheel"):
                verifier.verify_wheel(site, wheel)
            (site / "candidate/native.so").unlink()
            with self.assertRaisesRegex(ValueError, "missing from the environment"):
                verifier.verify_wheel(site, wheel)
            with self.assertRaisesRegex(ValueError, "Candidate wheel is missing"):
                verifier.verify_wheel(site, root / "absent-0.1-py3-none-any.whl")


if __name__ == "__main__":
    unittest.main()

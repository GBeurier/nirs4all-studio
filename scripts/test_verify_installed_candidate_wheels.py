"""Attested macOS signing must preserve the exact candidate wheel provenance."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile

SCRIPT = Path(__file__).with_name("verify-installed-candidate-wheels.py")
SPEC = importlib.util.spec_from_file_location("verify_installed_candidate_wheels", SCRIPT)
assert SPEC and SPEC.loader
verifier = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(verifier)


def digest(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


class SigningAttestationTests(unittest.TestCase):
    def test_signed_macho_is_bound_to_original_wheel_and_packaged_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            backend = root / "backend"
            site = backend / "python-runtime/python/lib/python3.11/site-packages"
            site.mkdir(parents=True)
            original = bytes.fromhex("feedfacf") + b"wheel-binary"
            signed = original + b"-signed"
            member = site / "candidate/native.so"
            member.parent.mkdir()
            member.write_bytes(signed)
            (site / "candidate/module.py").write_bytes(b"VALUE = 1\n")
            wheel = root / "candidate-0.1-py3-none-any.whl"
            with ZipFile(wheel, "w") as archive:
                archive.writestr("candidate/native.so", original)
                archive.writestr("candidate/module.py", b"VALUE = 1\n")
                archive.writestr("candidate-0.1.dist-info/RECORD", b"")
            attestation = backend / "native/macos-signing-attestation.json"
            attestation.parent.mkdir()
            relative = member.relative_to(backend).as_posix()
            attestation.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "members": [
                            {
                                "path": relative,
                                "pre_sign_sha256": digest(original),
                                "post_sign_sha256": digest(signed),
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            proof = verifier.load_signing_attestation(attestation)
            with patch.object(verifier.subprocess, "run") as codesign:
                self.assertEqual(verifier.verify_wheel(site, wheel, proof), (wheel.name, 2))
                codesign.assert_called_once()
            proof[1][relative]["pre_sign_sha256"] = digest(b"wrong wheel")
            with self.assertRaisesRegex(ValueError, "attested transformation"):
                verifier.verify_wheel(site, wheel, proof)
            proof[1][relative]["pre_sign_sha256"] = digest(original)
            member.write_bytes(signed + b"-tampered")
            with self.assertRaisesRegex(ValueError, "attested transformation"):
                verifier.verify_wheel(site, wheel, proof)


if __name__ == "__main__":
    unittest.main()

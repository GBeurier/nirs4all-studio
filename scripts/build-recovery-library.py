"""Build one pinned, workspace-compatible wheel for every recovery installer."""

import email.parser
import hashlib
import json
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path


def main():
    if sys.version_info < (3, 11):  # noqa: UP036 - invoked before the application environment exists
        raise RuntimeError("Building the recovery library requires Python 3.11 or newer")
    root = Path(__file__).resolve().parents[1]
    pin = json.loads((root / "build/recovery-library.json").read_text())
    output = root / "vendor/python"
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="studio-recovery-library-") as temporary:
        source = Path(temporary) / "source.tar.gz"
        with urllib.request.urlopen(pin["source_url"], timeout=60) as response:
            source.write_bytes(response.read())
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        if digest != pin["source_sha256"]:
            raise ValueError(f"Recovery library source checksum mismatch: {digest}")
        subprocess.run([
            sys.executable, "-m", "pip", "wheel", "--no-deps",
            "--wheel-dir", str(output), str(source),
        ], check=True)
    wheel = output / f"nirs4all-{pin['version']}-py3-none-any.whl"
    if set(output.glob("*.whl")) != {wheel}:
        raise ValueError("Recovery payload must contain exactly the pinned universal library wheel")
    with zipfile.ZipFile(wheel) as archive:
        metadata = email.parser.Parser().parsestr(archive.read(
            f"nirs4all-{pin['version']}.dist-info/METADATA"
        ).decode())
    if metadata["Name"] != "nirs4all" or metadata["Version"] != pin["version"]:
        raise ValueError("Recovery wheel metadata does not match the source pin")
    proof = {**pin, "wheel": wheel.name, "wheel_sha256": hashlib.sha256(wheel.read_bytes()).hexdigest()}
    (output / "provenance.json").write_text(json.dumps(proof, indent=2) + "\n")
    print(json.dumps(proof, indent=2))


if __name__ == "__main__":
    main()

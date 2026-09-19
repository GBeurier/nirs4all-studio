"""Build one pinned, workspace-compatible wheel for every recovery installer."""

import email.parser
import hashlib
import json
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile
from pathlib import Path

OWNER_IMPORT_TEST = "tests/integration/api/test_concurrent_imports.py"


def extract_owner_import_test(source: Path, destination: Path) -> dict[str, str]:
    """Copy the owner's standalone gate from the same verified source archive."""
    with tarfile.open(source, "r:gz") as archive:
        matches = [member for member in archive.getmembers()
                   if member.name.endswith("/" + OWNER_IMPORT_TEST)]
        if len(matches) != 1 or not matches[0].isfile():
            raise ValueError("Pinned library source must contain its standalone concurrent-import gate")
        stream = archive.extractfile(matches[0])
        if stream is None:
            raise ValueError("Cannot read the owner's concurrent-import gate")
        content = stream.read()
    destination.mkdir(parents=True, exist_ok=True)
    # Never extract paths supplied by an archive; write only this fixed filename.
    (destination / "test_concurrent_imports.py").write_bytes(content)
    return {"source_path": OWNER_IMPORT_TEST, "sha256": hashlib.sha256(content).hexdigest()}


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
        owner_test = extract_owner_import_test(source, root / "build/recovery-library-tests")
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
    proof = {**pin, "wheel": wheel.name, "wheel_sha256": hashlib.sha256(wheel.read_bytes()).hexdigest(),
             "owner_import_test": owner_test}
    (output / "provenance.json").write_text(json.dumps(proof, indent=2) + "\n")
    print(json.dumps(proof, indent=2))


if __name__ == "__main__":
    main()

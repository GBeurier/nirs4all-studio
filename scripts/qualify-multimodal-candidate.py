#!/usr/bin/env python3
"""Exercise local multimodal wheels in a copy of Studio's Python runtime.

This is a development qualification, not a product-runtime attestation. The
candidate wheels may share published version numbers, so they are extracted to
an isolated overlay under the copied interpreter prefix rather than installed
into the signed Studio payload.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

EXTRACT = r"""
import base64, csv, hashlib, io, pathlib, sys, zipfile
destination = pathlib.Path(sys.argv[1])
seen = set()
for wheel_name in sys.argv[2:]:
    with zipfile.ZipFile(wheel_name) as wheel:
        names = set(wheel.namelist())
        records = [name for name in names if name.endswith('.dist-info/RECORD')]
        if len(records) != 1:
            raise ValueError('candidate wheel must contain exactly one RECORD')
        rows = list(csv.reader(io.StringIO(wheel.read(records[0]).decode('utf-8'))))
        if {row[0] for row in rows} != names or len(rows) != len(names):
            raise ValueError('candidate wheel RECORD does not cover its members exactly')
        for name, encoded, size in rows:
            if name == records[0]:
                if encoded or size:
                    raise ValueError('wheel RECORD self-entry must be unhashed')
                continue
            if not encoded.startswith('sha256=') or not size.isdigit():
                raise ValueError('candidate wheel member lacks SHA-256 and size')
            payload = wheel.read(name)
            digest = base64.urlsafe_b64encode(hashlib.sha256(payload).digest()).decode('ascii').rstrip('=')
            if digest != encoded[7:] or len(payload) != int(size):
                raise ValueError('candidate wheel member differs from RECORD')
        for member in wheel.infolist():
            parts = pathlib.PurePosixPath(member.filename).parts
            if not parts or any(part in {'.', '..'} for part in parts) or member.filename.startswith('/') or '\\' in member.filename:
                raise ValueError('wheel contains an unsafe member path')
            if member.filename in seen:
                raise ValueError('candidate wheels contain a duplicate member')
            seen.add(member.filename)
        wheel.extractall(destination)
"""

RUN = r"""
import json, pathlib, sys, zipfile
overlay, site_packages = sys.argv[1:3]
sys.path[:0] = [overlay, site_packages]
import nirs4all
import nirs4all_io
from nirs4all_io import MultimodalDataset
for module in (nirs4all, nirs4all_io):
    if not pathlib.Path(module.__file__).resolve().is_relative_to(pathlib.Path(overlay).resolve()):
        raise RuntimeError('candidate module was not imported from the overlay')
request = json.load(sys.stdin)
if request.get('schema') != 'nirs4all.studio-scientific-job.v2' or request.get('operation') != 'run':
    raise ValueError('expected a Studio V2 run request')
descriptor = request.get('dataset')
if not isinstance(descriptor, dict) or descriptor.get('schema') != 'nirs4all.studio-multimodal-dataset.v1':
    raise ValueError('expected a typed multimodal dataset descriptor')
cohort = MultimodalDataset.from_dict(descriptor['cohort'])
result = nirs4all.studio_scientific_job_v2(request)['result']
archive = pathlib.Path(result['archive_path'])
if not archive.is_file() or archive.parent.name != 'exports':
    raise RuntimeError('Studio run did not export a cataloguable archive')
with zipfile.ZipFile(archive) as bundle:
    manifest = json.loads(bundle.read('manifest.json'))
if manifest['multimodal_host']['source_presence']['source_names'] != list(cohort.sources):
    raise RuntimeError('archive source contract differs from the input cohort')
replay = nirs4all.predict(archive, cohort)
if len(replay.y_pred) != len(cohort.sample_ids) or replay.metadata['training_performed'] is not False:
    raise RuntimeError('archive replay did not preserve the cohort without fitting')
print(json.dumps({'archive': str(archive), 'sample_count': len(cohort.sample_ids),
                  'sources': list(cohort.sources), 'prediction_count': len(replay.y_pred),
                  'training_performed': replay.metadata['training_performed'],
                  'validation_score': result['validation_score']}, allow_nan=False, sort_keys=True))
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime-copy", required=True, type=Path, help="Copied Studio python-runtime/python directory")
    parser.add_argument("--nirs-wheel", required=True, type=Path)
    parser.add_argument("--io-wheel", required=True, type=Path)
    parser.add_argument("--request", required=True, type=Path, help="Existing typed Studio V2 run request JSON")
    args = parser.parse_args()

    studio_root = Path(__file__).resolve().parent.parent
    runtime = args.runtime_copy.resolve(strict=True)
    if runtime.is_relative_to(studio_root):
        parser.error("runtime copy must be outside the Studio checkout and release payload")
    interpreter = runtime / "bin" / "python3"
    site_packages = runtime / "lib" / "python3.11" / "site-packages"
    if not interpreter.is_file() or not site_packages.is_dir():
        parser.error("expected a copied Linux CPython 3.11 Studio runtime")
    wheels = (args.nirs_wheel.resolve(strict=True), args.io_wheel.resolve(strict=True))
    if not wheels[0].name.startswith("nirs4all-") or not wheels[1].name.startswith("nirs4all_io-") or any(wheel.suffix != ".whl" for wheel in wheels):
        parser.error("expected nirs4all and nirs4all_io wheel files")
    request = json.loads(args.request.read_text(encoding="utf-8"))
    if not isinstance(request, dict):
        parser.error("request must be a JSON object")
    wheel_hashes = {wheel.name: hashlib.sha256(wheel.read_bytes()).hexdigest() for wheel in wheels}
    env = {key: value for key, value in os.environ.items() if not key.startswith(("N4A_", "N4M_")) and key not in {"PYTHONPATH", "LD_LIBRARY_PATH"}}

    with tempfile.TemporaryDirectory(prefix="candidate-overlay-", dir=runtime) as overlay:
        extracted = subprocess.run([str(interpreter), "-I", "-S", "-B", "-c", EXTRACT, overlay, *(str(wheel) for wheel in wheels)], text=True, capture_output=True, env=env, check=False)
        if extracted.returncode != 0:
            raise RuntimeError(f"wheel extraction failed: {extracted.stderr.strip()}")
        qualified = subprocess.run([str(interpreter), "-I", "-S", "-B", "-c", RUN, overlay, str(site_packages)], input=json.dumps(request, allow_nan=False), text=True, capture_output=True, env=env, check=False)
        if qualified.returncode != 0:
            raise RuntimeError(f"candidate run/replay failed: {qualified.stderr.strip()}")
    result = json.loads(qualified.stdout)
    print(json.dumps({"scope": "local-python-runtime-copy-only", "wheels_sha256": wheel_hashes, "result": result}, allow_nan=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())

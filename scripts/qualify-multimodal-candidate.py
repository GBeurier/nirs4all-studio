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
overlay, site_packages, check_dag_ml = sys.argv[1:4]
sys.path[:0] = [overlay, site_packages]
import nirs4all
import nirs4all_io
from nirs4all_io import MultimodalDataset
for module in (nirs4all, nirs4all_io):
    if not pathlib.Path(module.__file__).resolve().is_relative_to(pathlib.Path(overlay).resolve()):
        raise RuntimeError('candidate module was not imported from the overlay')
if check_dag_ml == '1':
    import dag_ml
    if not pathlib.Path(dag_ml.__file__).resolve().is_relative_to(pathlib.Path(overlay).resolve()):
        raise RuntimeError('candidate dag_ml was not imported from the overlay')
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
host = manifest['multimodal_host']
if set(host['input_schema']) != set(cohort.sources):
    raise RuntimeError('archive input schema differs from the input cohort')
presence = host.get('source_presence')
if presence is not None and presence['source_names'] != list(cohort.sources):
    raise RuntimeError('archive source-presence contract differs from the input cohort')
replay = nirs4all.predict(archive, cohort)
if len(replay.y_pred) != len(cohort.sample_ids) or replay.metadata['training_performed'] is not False:
    raise RuntimeError('archive replay did not preserve the cohort without fitting')
print(json.dumps({'archive': str(archive), 'sample_count': len(cohort.sample_ids),
                  'sources': list(cohort.sources), 'prediction_count': len(replay.y_pred),
                  'training_performed': replay.metadata['training_performed'],
                  'validation_score': result['validation_score'],
                  'dag_ml_version': dag_ml.version() if check_dag_ml == '1' else None}, allow_nan=False, sort_keys=True))
"""

PROVIDER_RUN = r"""
import pathlib, runpy, sys
overlay, site_packages, smoke_path = sys.argv[1:4]
sys.path[:0] = [overlay, site_packages]
import dag_ml, nirs4all, nirs4all_io
for module in (dag_ml, nirs4all, nirs4all_io):
    if not pathlib.Path(module.__file__).resolve().is_relative_to(pathlib.Path(overlay).resolve()):
        raise RuntimeError(f'candidate {module.__name__} was not imported from the overlay')
runpy.run_path(smoke_path, run_name='__main__')
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime-copy", required=True, type=Path, help="Copied Studio python-runtime/python directory")
    parser.add_argument("--nirs-wheel", required=True, type=Path)
    parser.add_argument("--io-wheel", required=True, type=Path)
    parser.add_argument("--dag-wheel", type=Path, help="Optional DAG-ML Python candidate wheel to test in the same overlay")
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--request", type=Path, help="Existing typed Studio V2 run request JSON")
    action.add_argument("--provider-smoke", type=Path, help="Installed provider smoke script to execute with candidate wheels")
    parser.add_argument("--provider-mode", choices=("worker", "inprocess"), default="worker")
    parser.add_argument("--smoke-root", type=Path, help="Separate output directory for the provider smoke")
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
    if args.dag_wheel is not None:
        wheels += (args.dag_wheel.resolve(strict=True),)
    expected_names = ("nirs4all-", "nirs4all_io-") + (("dag_ml-",) if args.dag_wheel is not None else ())
    if any(not wheel.name.startswith(prefix) or wheel.suffix != ".whl" for wheel, prefix in zip(wheels, expected_names, strict=True)):
        parser.error("expected nirs4all, nirs4all_io and optional dag_ml wheel files")
    request = None
    if args.request is not None:
        request = json.loads(args.request.read_text(encoding="utf-8"))
        if not isinstance(request, dict):
            parser.error("request must be a JSON object")
    elif args.dag_wheel is None or args.smoke_root is None:
        parser.error("provider smoke requires --dag-wheel and --smoke-root")
    wheel_hashes = {wheel.name: hashlib.sha256(wheel.read_bytes()).hexdigest() for wheel in wheels}
    env = {key: value for key, value in os.environ.items() if not key.startswith(("N4A_", "N4M_")) and key not in {"PYTHONPATH", "LD_LIBRARY_PATH"}}

    with tempfile.TemporaryDirectory(prefix="candidate-overlay-", dir=runtime) as overlay:
        extracted = subprocess.run([str(interpreter), "-I", "-S", "-B", "-c", EXTRACT, overlay, *(str(wheel) for wheel in wheels)], text=True, capture_output=True, env=env, check=False)
        if extracted.returncode != 0:
            raise RuntimeError(f"wheel extraction failed: {extracted.stderr.strip()}")
        if request is not None:
            qualified = subprocess.run([str(interpreter), "-I", "-S", "-B", "-c", RUN, overlay, str(site_packages), "1" if args.dag_wheel is not None else "0"], input=json.dumps(request, allow_nan=False), text=True, capture_output=True, env=env, check=False)
        else:
            env["N4A_DAGML_INPROCESS"] = "0" if args.provider_mode == "worker" else "1"
            env["ENABLE_HPO_SUBPROCESS"] = "1"
            env["N4A_SMOKE_ROOT"] = str(args.smoke_root.resolve())
            qualified = subprocess.run([str(interpreter), "-I", "-S", "-B", "-c", PROVIDER_RUN, overlay, str(site_packages), str(args.provider_smoke.resolve(strict=True))], text=True, capture_output=True, env=env, check=False)
        if qualified.returncode != 0:
            raise RuntimeError(f"candidate run/replay failed: {qualified.stderr.strip()}")
    if request is not None:
        result = json.loads(qualified.stdout)
    else:
        checks = qualified.stdout.splitlines()
        required = ("INSTALLED_XY_ASSEMBLY_OK", "INSTALLED_CV_ARCHIVE_OK", "INSTALLED_HPO_ARCHIVE_OK", "INSTALLED_PROGRESS_RESUME_OK")
        if any(not any(line.startswith(marker) for line in checks) for marker in required):
            raise RuntimeError(f"provider smoke omitted a required check: {checks}")
        result = {"provider_mode": args.provider_mode, "checks": checks}
    print(json.dumps({"scope": "local-python-runtime-copy-only", "wheels_sha256": wheel_hashes, "result": result}, allow_nan=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())

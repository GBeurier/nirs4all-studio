"""Measure real Rust/Python interactions in an isolated temporary workspace.

Run the same command against the before/after sidecar binaries. This does not
mock the scientific worker, and never writes to the user's workspace/profile.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import secrets
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", required=True, type=Path)
    parser.add_argument("--python", required=True, type=Path)
    parser.add_argument("--site-packages", required=True, type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--iterations", type=int, default=3)
    parser.add_argument("--datasets", action="store_true", help="Also measure linking, preview and dataset-backed Playground")
    parser.add_argument("--skip-inline", action="store_true", help="Measure dataset routes only (older binaries limited inline matrices to 64 KiB)")
    args = parser.parse_args()
    records = []
    with tempfile.TemporaryDirectory(prefix="studio-interactions-") as temporary:
        root = Path(temporary)
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        token = secrets.token_hex(32)
        env = {key: value for key, value in os.environ.items() if not key.startswith(("PYTHON", "NIRS4ALL_"))}
        env.update(
            NIRS4ALL_CONFIG=str(root / "config"),
            NIRS4ALL_PYTHON_PLUGIN_HOST=str(args.python.absolute()),
            NIRS4ALL_PYTHON_PLUGIN_SITE_PACKAGES=str(args.site_packages.resolve()),
            NIRS4ALL_SCIENTIFIC_EXECUTOR="cpython-stdio-v1",
            NIRS4ALL_RUNTIME_KIND="custom",
            NIRS4ALL_STUDIO_SESSION_TOKEN=token,
            NIRS4ALL_STUDIO_PERF="1",
        )

        def call(label: str, route: str, payload=None):
            encoded = None if payload is None else json.dumps(payload).encode()
            request = urllib.request.Request(f"http://127.0.0.1:{port}{route}", data=encoded,
                                             headers={"Content-Type": "application/json", "X-Nirs4all-Session": token})
            started = time.perf_counter()
            try:
                with urllib.request.urlopen(request, timeout=120) as response:
                    body = response.read()
                    value = json.loads(body)
            except urllib.error.HTTPError as error:
                raise RuntimeError(f"{label}: HTTP {error.code}: {error.read().decode()}") from error
            record = {"interaction": label, "milliseconds": round((time.perf_counter() - started) * 1000, 2), "response_bytes": len(body)}
            if "processed" in value:
                record["cache_used"] = value.get("cache", {}).get("used", False)
                evidence = {section: value.get(section) for section in ("original", "processed")}
                record["scientific_data_sha256"] = hashlib.sha256(json.dumps(evidence, sort_keys=True).encode()).hexdigest()
            records.append(record)
            print(json.dumps(record), flush=True)
            return value

        with (root / "sidecar.log").open("w+") as log:
            started = time.perf_counter()
            process = subprocess.Popen([str(args.binary.resolve()), "--port", str(port)], env=env, stdout=log, stderr=log)
            try:
                while True:
                    if process.poll() is not None or time.perf_counter() - started > 120:
                        log.seek(0)
                        raise RuntimeError(f"Sidecar failed to start: {log.read()}")
                    try:
                        with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                            break
                    except OSError:
                        time.sleep(0.05)
                records.append({"interaction": "startup", "milliseconds": round((time.perf_counter() - started) * 1000, 2)})
                call("capabilities.cold", "/api/playground/capabilities")
                rows = [[round(math.sin(row * 0.3 + column * 0.01) + row * 0.01, 8) for column in range(700)] for row in range(60)]
                raw = {"data": {"x": rows, "y": [row / 3 for row in range(60)],
                                "wavelengths": list(range(1000, 1700)), "sample_ids": [f"sample-{row}" for row in range(60)]},
                       "steps": [], "sampling": {"method": "all", "n_samples": 60, "seed": 42},
                       "options": {"compute_pca": True, "compute_statistics": True, "compute_repetitions": False}}
                smooth = {**raw, "steps": [{"id": "smooth", "type": "preprocessing", "name": "SavitzkyGolay",
                                            "params": {"window_length": 11, "polyorder": 2}, "enabled": True,
                                            "operator": {"class": "nirs4all.operators.transforms.nirs.SavitzkyGolay",
                                                         "params": {"window_length": 11, "polyorder": 2}}}]}
                for iteration in range(0 if args.skip_inline else args.iterations):
                    for label, payload in [("raw", raw), ("savgol", smooth)]:
                        result = call(f"inline.{label}.{iteration}", "/api/playground/execute", payload)
                        if result.get("success") is not True:
                            raise RuntimeError(f"Scientific preview failed: {result}")
                if args.datasets:
                    call("workspace.create", "/api/workspace/create", {"path": str(root / "workspace"), "name": "Performance measurement"})
                    call("workspace.select", "/api/workspace/select", {"path": str(root / "workspace")})
                    dataset = root / "dataset"
                    dataset.mkdir()
                    (dataset / "Xcal.csv").write_text(";".join(map(str, raw["data"]["wavelengths"])) + "\n"
                                                    + "".join(";".join(map(str, row)) + "\n" for row in rows))
                    (dataset / "Ycal.csv").write_text("target\n" + "".join(f"{row / 3}\n" for row in range(60)))
                    linked = call("dataset.link", "/api/datasets/link", {"path": str(dataset), "config": {}})["dataset"]
                    dataset_id = linked["id"]
                    for iteration in range(args.iterations):
                        call(f"dataset.preview.{iteration}", f"/api/datasets/{dataset_id}/preview")
                        for label, payload in [("raw", raw), ("savgol", smooth)]:
                            call(f"dataset.{label}.{iteration}", "/api/playground/execute-dataset",
                                 {"dataset_id": dataset_id, "steps": payload["steps"], "sampling": payload["sampling"],
                                  "options": payload["options"]})
            finally:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
                log.seek(0)
                diagnostics = [line.rstrip() for line in log if line.startswith("Studio ")]
        proof = {"schema": "nirs4all.studio.interaction-measurements.v1", "binary": str(args.binary.resolve()),
                 "samples": 60, "features": 700, "timings": records, "worker_timings": diagnostics}
        if args.output:
            args.output.write_text(json.dumps(proof, indent=2) + "\n")


if __name__ == "__main__":
    main()

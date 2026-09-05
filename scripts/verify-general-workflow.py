"""Qualify the packaged Rust/CPython general workflow over real HTTP."""

import argparse
import json
import os
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--binary", type=Path, required=True)
parser.add_argument("--backend-root", type=Path, required=True)
parser.add_argument("--artifact-root", type=Path, required=True)
parser.add_argument("--methods-library", type=Path, required=True)
parser.add_argument("--wizard-csv", action="store_true")
parser.add_argument("--prediction", action="store_true", help="Also replay a captured model over real HTTP")
args = parser.parse_args()
RUNTIME = args.backend_root.resolve() / "python-runtime"
PYTHON = RUNTIME / "python"
BINARY = args.binary.resolve(strict=True)
args.artifact_root.mkdir(parents=True, exist_ok=True)
ROOT = Path(tempfile.mkdtemp(prefix="studio-http-general-", dir=args.artifact_root.resolve()))
DELIMITER = "," if args.wizard_csv else ";"
TRACE = []
DATASET = ROOT / "dataset"
DATASET.mkdir()
(DATASET / "Xcal.csv").write_text(DELIMITER.join(str(1000 + i) for i in range(300)) + "\n" + "".join(DELIMITER.join(str((r * 3 + c) / 10) for c in range(300)) + "\n" for r in range(150)))
(DATASET / "Ycal.csv").write_text("protein\n" + "".join(str(r * 0.2 + 1.1) + "\n" for r in range(150)))
with socket.socket() as listener:
    listener.bind(("127.0.0.1", 0))
    PORT = listener.getsockname()[1]
ENV = {k: v for k, v in os.environ.items() if not k.startswith(("PYTHON", "NIRS4ALL_"))}
ENV.update(
    NIRS4ALL_CONFIG=str(ROOT / "config"),
    NIRS4ALL_PYTHON_PLUGIN_HOST=str(PYTHON / "bin/python3"),
    NIRS4ALL_PYTHON_PLUGIN_HOST_BUNDLED="true",
    NIRS4ALL_PYTHON_PLUGIN_CLOSURE=str(RUNTIME / "PYTHON_PLUGIN_CLOSURE.json"),
    NIRS4ALL_PYTHON_PLUGIN_RUNTIME_ROOT=str(PYTHON),
    NIRS4ALL_PYTHON_PLUGIN_SITE_PACKAGES=str(PYTHON / "lib/python3.11/site-packages"),
    NIRS4ALL_SCIENTIFIC_EXECUTOR="cpython-stdio-v1",
    NIRS4ALL_RUNTIME_MODE="private-qualification",
    N4M_LIBRARY_PATH=str(args.methods_library.resolve(strict=True)),
)


def call(path, payload=None, *, headers=None):
    started = time.monotonic()
    data = payload if isinstance(payload, bytes) else None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request(f"http://127.0.0.1:{PORT}{path}", data=data, headers=headers or ({} if payload is None else {"Content-Type": "application/json"}))
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            value = json.load(response)
            elapsed = round(time.monotonic() - started, 3)
            TRACE.append({"path": path, "status": response.status, "seconds": elapsed, "response": value})
            print(path, response.status, elapsed, json.dumps(value)[:1600], flush=True)
            return value
    except urllib.error.HTTPError as error:
        raise AssertionError((path, error.code, error.read().decode())) from error


with (ROOT / "sidecar.log").open("w") as log:
    process = subprocess.Popen([str(BINARY), "--port", str(PORT)], env=ENV, stdout=log, stderr=log)
    try:
        for _ in range(120):
            try:
                with socket.create_connection(("127.0.0.1", PORT), timeout=0.2):
                    break
            except OSError:
                assert process.poll() is None, (ROOT / "sidecar.log").read_text()
                time.sleep(0.5)
        call("/sidecar/v1/capabilities")
        call("/api/workspace/create", {"path": str(ROOT / "workspace"), "name": "Packaged General Witness"})
        call("/api/workspace/select", {"path": str(ROOT / "workspace")})
        config = {"delimiter": ",", "has_header": True, "files": [{"path": "Xcal.csv", "type": "X", "split": "train"}, {"path": "Ycal.csv", "type": "Y", "split": "train"}]} if args.wizard_csv else {}
        dataset = call("/api/datasets/link", {"path": str(DATASET), "config": config})["dataset"]["id"]
        canonical = {
            "name": "General Ridge",
            "pipeline": [{"class": "sklearn.preprocessing.StandardScaler"}, {"class": "sklearn.model_selection.KFold", "params": {"n_splits": 3}}, {"class": "sklearn.linear_model.Ridge", "params": {"alpha": 0.1}}],
        }
        imported = call("/api/pipelines/import-preview", {"payload": canonical})
        assert len(imported["steps"]) == 3
        pipeline = call("/api/pipelines/import", {"payload": canonical})["pipeline"]["id"]
        name = "Packaged General Witness"
        pair = f"{dataset}::{pipeline}"
        payload = {
            "legacyConfig": {"name": name, "dataset_ids": [dataset], "pipeline_ids": [pipeline], "execution_backend": "local-python", "engine": "dag-ml", "allow_fallback": False},
            "manifest": {
                "version": "studio.native-launch-payload.v1",
                "legacyExperimentName": name,
                "legacyDatasetCount": 1,
                "legacyPipelineCount": 1,
                "strictCampaignCount": 1,
                "skippedRunCount": 0,
                "sourceRunIds": [pair],
                "skippedRunIds": [],
            },
            "strictCampaignSpecs": {
                "splitSpecs": [
                    {
                        "id": "single-pair:" + pair,
                        "sourceRunId": pair,
                        "sourceDatasetId": dataset,
                        "sourcePipelineId": pipeline,
                        "campaign": {
                            "name": name,
                            "mode": "paired_by_index",
                            "executionBackend": "local-python",
                            "datasets": [{"id": dataset, "name": "dataset", "splitGroupBy": None}],
                            "pipelines": [{"id": pipeline, "name": "General Ridge", "source": "saved"}],
                            "runMatrix": [{"id": pair, "datasetId": dataset, "pipelineId": pipeline, "datasetIndex": 0, "pipelineIndex": 0, "splitGroupBy": None}],
                        },
                    }
                ],
                "skippedRunIds": [],
            },
        }
        with ThreadPoolExecutor(max_workers=1) as executor:
            pending = executor.submit(call, "/api/runs/run-groups", payload)
            time.sleep(0.5)
            health_started = time.monotonic()
            assert call("/sidecar/v1/health")["sidecar_ready"] is True
            assert time.monotonic() - health_started < 1.0, "Admission blocked health"
            receipt = pending.result(timeout=120)
        job = receipt.get("job_id") or receipt.get("run_id")
        assert job, receipt
        for _ in range(90):
            status = call("/api/training/" + job)
            if status.get("status") in {"completed", "failed", "error", "cancelled"}:
                break
            time.sleep(2)
        assert status.get("status") == "completed", status
        record = call("/api/runs/execution-job-records/" + job)
        workspace_id = call("/api/workspaces")["active_workspace_id"]
        runs = call("/api/workspaces/" + workspace_id + "/runs")
        summary = call("/api/workspaces/" + workspace_id + "/results/summary")
        assert len(runs["runs"]) == 1, runs
        assert runs["runs"][0]["summary"]["native_score_set_available"] is True
        assert runs["runs"][0]["summary"]["num_predictions"] >= 3
        assert len(summary["datasets"]) == 1, summary
        chains = summary["datasets"][0]["top_chains"]
        assert chains, summary
        assert any(chain.get("avg_val_score") is not None for chain in chains), summary
        assert any(chain.get("model_name") == "Ridge" and chain.get("fold_count") == 3 for chain in chains), summary
        if args.prediction:
            catalogue = call("/api/models/available")
            model = next((model for model in catalogue["models"] if model["source"] == "chain" and model.get("has_refit")), None)
            assert model is not None, catalogue
            spectra = [[(row * 3 + column) / 10 for column in range(300)] for row in range(150)]
            predictions = call("/api/predict", {"model_id": model["id"], "model_source": "chain", "data_source": "array", "spectra": spectra, "engine": "dag-ml", "allow_fallback": False})
            assert predictions["num_samples"] == 150
            assert len(predictions["sample_ids"]) == 150
            assert predictions["runtime"]["engine"] == "dag-ml"
            assert len(predictions["prediction_matrix"]) == 150
            assert max(abs(value - (row * 0.2 + 1.1)) for row, value in enumerate(predictions["predictions"])) < 0.01
            csv_data = (DATASET / "Xcal.csv").read_bytes()
            for has_header in [True, False]:
                fields = {"model_id": model["id"], "model_source": "chain", "engine": "dag-ml", "allow_fallback": "false", "has_header": str(has_header).lower()}
                body = b"".join(f'--studio-proof\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode() for key, value in fields.items())
                body += b'--studio-proof\r\nContent-Disposition: form-data; name="file"; filename="spectra.csv"\r\nContent-Type: text/csv\r\n\r\n'
                body += (csv_data if has_header else csv_data.split(b"\n", 1)[1]) + b"\r\n--studio-proof--\r\n"
                uploaded = call("/api/predict/file", body, headers={"Content-Type": "multipart/form-data; boundary=studio-proof"})
                assert uploaded["num_samples"] == 150, uploaded
                assert uploaded["runtime"]["engine"] == "dag-ml", uploaded
                assert len(uploaded["sample_ids"]) == 150
                assert uploaded["prediction_matrix"] == predictions["prediction_matrix"], "Upload changed rows or scientific predictions"
                assert uploaded["actual_values"] is None, "Unlabeled inference invented targets"
            call("/api/workspaces/" + workspace_id + "/results/summary")
        call("/api/workspace")
        print("PASS", ROOT, flush=True)
    finally:
        (ROOT / "workflow-proof.json").write_text(json.dumps(TRACE, indent=2), encoding="utf-8")
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()

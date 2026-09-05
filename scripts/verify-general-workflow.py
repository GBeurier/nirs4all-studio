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

from general_workflow_platform import packaged_python_layout

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--binary", type=Path, required=True)
parser.add_argument("--backend-root", type=Path, required=True)
parser.add_argument("--artifact-root", type=Path, required=True)
parser.add_argument("--methods-library", type=Path, required=True)
parser.add_argument("--wizard-csv", action="store_true")
parser.add_argument("--prediction", action="store_true", help="Also replay a captured model over real HTTP")
parser.add_argument("--presets", action="store_true", help="Import and reload every historical pipeline preset variant")
parser.add_argument("--dataset-upload", action="store_true", help="Preview and persist uploaded CSV files, then run the imported dataset")
parser.add_argument("--synthetic", action="store_true", help="Generate, verify and auto-link one owner-produced synthetic dataset")
parser.add_argument("--playground", action="store_true", help="Exercise the attested Playground facade over real HTTP")
args = parser.parse_args()
RUNTIME = args.backend_root.resolve() / "python-runtime"
PYTHON = RUNTIME / "python"
PYTHON_HOST, SITE_PACKAGES = packaged_python_layout(RUNTIME)
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
    NIRS4ALL_PYTHON_PLUGIN_HOST=str(PYTHON_HOST),
    NIRS4ALL_PYTHON_PLUGIN_HOST_BUNDLED="true",
    NIRS4ALL_PYTHON_PLUGIN_CLOSURE=str(RUNTIME / "PYTHON_PLUGIN_CLOSURE.json"),
    NIRS4ALL_PYTHON_PLUGIN_RUNTIME_ROOT=str(PYTHON),
    NIRS4ALL_PYTHON_PLUGIN_SITE_PACKAGES=str(SITE_PACKAGES),
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


def call_refusal(path, payload, expected_status):
    started = time.monotonic()
    request = urllib.request.Request(
        f"http://127.0.0.1:{PORT}{path}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        urllib.request.urlopen(request, timeout=120)
    except urllib.error.HTTPError as error:
        body = json.loads(error.read().decode())
        elapsed = round(time.monotonic() - started, 3)
        TRACE.append({"path": path, "status": error.code, "seconds": elapsed, "response": body})
        print(path, error.code, elapsed, json.dumps(body)[:1600], flush=True)
        assert error.code == expected_status, (path, error.code, body)
        return body
    raise AssertionError((path, "unexpected success"))


def upload_dataset(path, metadata):
    body = f'--dataset-proof\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n{json.dumps(metadata)}\r\n'.encode()
    for filename in ["Xcal.csv", "Ycal.csv"]:
        body += f'--dataset-proof\r\nContent-Disposition: form-data; name="files"; filename="{filename}"\r\nContent-Type: text/csv\r\n\r\n'.encode()
        body += (DATASET / filename).read_bytes() + b"\r\n"
    return call(path, body + b"--dataset-proof--\r\n", headers={"Content-Type": "multipart/form-data; boundary=dataset-proof"})


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
        if args.synthetic:
            synthetic = call("/api/datasets/generate-synthetic", {
                "task_type": "regression", "n_samples": 50, "complexity": "simple",
                "target_range": [10, 20], "train_ratio": 0.8,
                "wavelength_range": [1000, 1010], "name": "http-synthetic", "auto_link": True,
            })
            assert synthetic["success"] and synthetic["linked"] and synthetic["dataset_id"], synthetic
            assert synthetic["summary"]["n_samples"] == 50 and synthetic["summary"]["num_features"] == 6, synthetic
            generated = Path(synthetic["path"])
            assert generated.parent == ROOT / "workspace" / "datasets" / "synthetic", generated
            assert {path.name for path in generated.iterdir()} == {"Xcal.csv", "Ycal.csv", "Xval.csv", "Yval.csv"}, generated
            catalogue = call("/api/datasets")
            assert any(row["id"] == synthetic["dataset_id"] and Path(row["path"]) == generated for row in catalogue["datasets"]), catalogue
        if args.presets:
            import sys

            # The oracle is loaded only in this diagnostic parent. The product
            # child remains the isolated, attested library-only runtime.
            sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
            from pipeline_preset_witness import verify_pipeline_presets

            verify_pipeline_presets(call)
        config = {"delimiter": ",", "has_header": True, "files": [{"path": "Xcal.csv", "type": "X", "split": "train"}, {"path": "Ycal.csv", "type": "Y", "split": "train"}]} if args.wizard_csv else {}
        linked = call("/api/datasets/link", {"path": str(DATASET), "config": config})["dataset"]
        assert linked["num_samples"] == 150 and linked["num_features"] == 300, linked
        dataset = linked["id"]
        if args.playground:
            capabilities = call("/api/playground/capabilities")
            assert capabilities["nirs4all_available"] is True, capabilities
            assert capabilities["stateless"] is True and capabilities["cache"] is False, capabilities
            rows = [[float(row * 5 + column + 1) for column in range(5)] for row in range(12)]
            sample_ids = [f"playground-{row}" for row in range(12)]
            preview = call("/api/playground/execute", {
                "data": {
                    "x": rows,
                    "y": [float(row) for row in range(12)],
                    "wavelengths": [1000, 1001, 1002, 1003, 1004],
                    "sample_ids": sample_ids,
                },
                "steps": [{
                    "id": "snv",
                    "type": "preprocessing",
                    "name": "StandardNormalVariate",
                    "params": {},
                    "enabled": True,
                    "operator": {
                        "class": "nirs4all.operators.transforms.StandardNormalVariate",
                        "params": {},
                    },
                }],
                "sampling": {"method": "all", "n_samples": 12, "seed": 42},
                "options": {"compute_repetitions": False},
            })
            assert preview["success"] is True, preview
            assert preview["processed"]["shape"] == [12, 5], preview
            assert preview["processed"]["sample_ids"] == sample_ids, preview
            assert preview["cache"] == {"used": False, "scope": "stateless_callable"}, preview
            for forbidden in [
                {"dataset": {"config": {"path": str(DATASET / "Xcal.csv")}}, "steps": []},
                {"data": {"x": [[1.0]]}, "selection": {"partition": "all"}},
                {"data": {"x": [[1.0]]}, "path": str(DATASET / "Xcal.csv")},
                {"data": {"x": [[1.0]]}, "unknown": True},
            ]:
                refusal = call_refusal("/api/playground/execute", forbidden, 400)
                assert refusal.get("detail"), refusal
        if args.dataset_upload:
            assert args.wizard_csv, "Upload witness requires explicit CSV parsing"
            preview = upload_dataset("/api/datasets/preview-upload", {"files": config["files"], "parsing": {"delimiter": ",", "has_header": True}, "max_samples": 5})
            assert preview["success"] and preview["summary"]["num_samples"] == 150 and preview["summary"]["num_features"] == 300, preview
            assert "test" not in (preview.get("target_distribution_by_partition") or {}), "Train-only preview invented test targets"
            imported_dataset = upload_dataset("/api/datasets/upload", {"config": config})["dataset"]
            assert imported_dataset["num_samples"] == 150 and imported_dataset["num_features"] == 300, imported_dataset
            for file in imported_dataset["config"]["files"]:
                assert Path(file["path"]).read_bytes() == (DATASET / Path(file["path"]).name).read_bytes()
            dataset = imported_dataset["id"]
            refreshed = call(f"/api/datasets/{dataset}/refresh", {})["dataset"]
            assert refreshed["num_samples"] == 150 and refreshed["num_features"] == 300, refreshed
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
        compact = call("/api/workspaces/" + workspace_id + "/results/dataset-scores")
        assert len(compact["datasets"]) == 1 and compact["datasets"][0]["score_kind"] == "cv", compact
        assert compact["datasets"][0]["metric"] == "rmse" and compact["datasets"][0]["best_score"] is not None, compact
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
        history = call("/api/workspaces/" + workspace_id + "/runs/enriched?limit=100&offset=0")
        assert history["total"] == 1 and len(history["runs"]) == 1, history
        assert history["runs"][0]["datasets"][0]["top_5"], history
        listing = call("/api/runs")
        assert listing["total"] == 1 and len(listing["runs"]) == 1, listing
        assert listing["runs"][0]["status"] == "completed", listing
        active = call("/api/runs?status=running,queued")
        assert active["total"] == 0 and active["runs"] == [], active
        counters = call("/api/runs/stats")
        assert counters["completed"] == 1 and counters["running"] == 0, counters
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

"""Real Rust HTTP / Python catalogue parity; no scientific runtime is required.

Run after building the sidecar with STUDIO_SIDECAR_BINARY pointing at the binary.
The opt-in executable keeps ordinary Python unit runs independent of Cargo.
"""
from __future__ import annotations

import json
import os
import queue
import subprocess
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest


@pytest.fixture
def native_workspace(tmp_path, monkeypatch):
    binary = os.environ.get("STUDIO_SIDECAR_BINARY")
    if not binary:
        pytest.skip("Set STUDIO_SIDECAR_BINARY to run real Rust HTTP parity")
    config = tmp_path / "native-config"
    config.mkdir()
    env = {key: value for key, value in os.environ.items()
           if not key.startswith("NIRS4ALL_SCIENTIFIC") and key != "NIRS4ALL_STUDIO_SESSION_TOKEN"}
    env["NIRS4ALL_CONFIG"] = str(config)
    process = subprocess.Popen([binary, "--port", "0"], stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, text=True, env=env)
    lines = queue.Queue()
    threading.Thread(target=lambda: lines.put(process.stdout.readline()), daemon=True).start()
    try:
        line = lines.get(timeout=15)
        assert line.startswith("STUDIO_SIDECAR_READY "), line
        address = json.loads(line.split(" ", 1)[1])
        base = f"http://127.0.0.1:{address['port']}"

        def request(method, path, body=None):
            data = None if body is None else json.dumps(body).encode()
            req = urllib.request.Request(base + "/api" + path, data=data, method=method,
                                         headers={"Content-Type": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=5) as response:
                    return response.status, json.load(response)
            except urllib.error.HTTPError as error:
                return error.code, json.load(error)

        yield request, config
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
        process.stdout.close()
        process.stderr.close()


def test_group_lifecycle_matches_real_python_oracle(native_workspace, tmp_path, monkeypatch):
    from api.app_config import AppConfigManager

    request, config = native_workspace
    oracle_config = tmp_path / "oracle-config"
    monkeypatch.setenv("NIRS4ALL_CONFIG", str(oracle_config))
    oracle = AppConfigManager()
    initial = {"schema_version": 2, "extension": {"retained": True}, "datasets": [
        {"id": "dataset1", "name": "First", "path": str(tmp_path), "group_ids": []},
        {"id": "dataset2", "name": "Second", "path": str(tmp_path), "group_ids": []}], "groups": []}
    (config / "dataset_links.json").write_text(json.dumps(initial))
    (oracle_config / "dataset_links.json").write_text(json.dumps(initial))
    status, created = request("POST", "/workspace/groups", {"name": "Training"})
    assert status == 200, created
    group_id = created["group"]["id"]
    # IDs/timestamps are generated independently. Seed the returned identity into
    # the oracle; all following read/mutation operations execute real Python.
    initial["groups"].append(created["group"])
    (oracle_config / "dataset_links.json").write_text(json.dumps(initial))

    def assert_same_groups():
        status, actual = request("GET", "/workspace/groups")
        assert status == 200
        assert actual == {"groups": [group.to_dict() for group in oracle.get_dataset_groups()]}

    assert_same_groups()
    for dataset_id in ("dataset1", "dataset2", "dataset1"):
        assert request("POST", f"/workspace/groups/{group_id}/datasets", {"dataset_id": dataset_id}) == (200, {"success": True})
        assert oracle.add_dataset_to_group(dataset_id, group_id)
        actual = request("GET", "/workspace/groups")[1]["groups"][0]
        expected = oracle.get_dataset_groups()[0].to_dict()
        assert {**actual, "dataset_ids": sorted(actual["dataset_ids"])} == {**expected, "dataset_ids": sorted(expected["dataset_ids"])}
    assert request("PUT", f"/workspace/groups/{group_id}", {"name": "Validation"}) == (200, {"success": True})
    assert oracle.rename_dataset_group(group_id, "Validation")
    assert request("DELETE", f"/workspace/groups/{group_id}/datasets/dataset1") == (200, {"success": True})
    assert oracle.remove_dataset_from_group("dataset1", group_id)
    assert_same_groups()
    assert request("DELETE", f"/workspace/groups/{group_id}") == (200, {"success": True})
    assert oracle.delete_dataset_group(group_id)
    assert_same_groups()
    assert json.loads((config / "dataset_links.json").read_text())["extension"] == {"retained": True}


def test_preferences_and_recent_are_live_http_documents(native_workspace, tmp_path):
    request, config = native_workspace
    workspace = tmp_path / "workspace"
    assert request("POST", "/workspace/create", {"path": str(workspace), "name": "HTTP workspace"})[0] == 200
    assert request("POST", "/workspace/select", {"path": str(workspace)})[0] == 200
    assert request("PUT", "/workspace/settings", {"general": {"language": "fr"}, "extension": [1, 2]})[0] == 200
    status, response = request("PUT", "/workspace/data-defaults", {"delimiter": ","})
    assert status == 200
    assert response["defaults"]["delimiter"] == ","
    assert request("GET", "/workspace/settings")[1]["extension"] == [1, 2]
    status, recent = request("GET", "/workspace/recent?limit=1")
    assert status == 200
    assert recent["total"] == 1
    assert recent["workspaces"][0]["path"] == str(workspace.resolve())
    assert recent["workspaces"][0]["num_datasets"] == 0
    assert request("GET", "/workspace/recent?limit=1&limit=2")[0] == 400
    assert request("POST", "/workspace/groups", {"name": "HTTP group"})[0] == 200
    assert not (workspace / "store.sqlite").exists()

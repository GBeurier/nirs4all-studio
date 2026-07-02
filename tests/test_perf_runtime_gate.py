"""Tests for the lightweight Studio runtime performance gate."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path


def _load_perf_module():
    script = Path(__file__).resolve().parents[1] / "scripts" / "perf_runtime_gate.py"
    spec = importlib.util.spec_from_file_location("perf_runtime_gate", script)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_perf_runtime_gate_compares_legacy_and_dagml_and_writes_reports(tmp_path):
    perf = _load_perf_module()

    report = perf.run_perf_gate(
        iterations=8,
        warmup=1,
        max_overhead_ms=50.0,
        workspace_path=tmp_path / "workspace",
    )

    assert report["passed"] is True
    assert report["scope"] == "Studio runtime wrapper only; no backend server, no Web dependency, no full parity"
    assert [case["id"] for case in report["cases"]] == ["without-dagml", "with-dagml"]

    cases = {case["engine_requested"]: case for case in report["cases"]}
    assert cases["legacy"]["engine_record"]["engine"] == "legacy"
    assert cases["dag-ml"]["engine_record"]["engine"] == "dag-ml"
    assert cases["dag-ml"]["engine_record"]["fallback_policy"]["allow_fallback"] is False
    assert cases["dag-ml"]["studio_overhead_ms"] <= cases["dag-ml"]["max_overhead_ms"]

    json_path = tmp_path / "runtime-gate.json"
    markdown_path = tmp_path / "runtime-gate.md"
    perf.write_reports(report, output=json_path, markdown=markdown_path)

    loaded = json.loads(json_path.read_text(encoding="utf-8"))
    markdown = markdown_path.read_text(encoding="utf-8")
    assert loaded["name"] == "nirs4all-studio-runtime-perf-gate"
    assert "| without-dagml | `legacy` |" in markdown
    assert "| with-dagml | `dag-ml` |" in markdown

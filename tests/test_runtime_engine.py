"""Tests for api.runtime_engine — engine resolution + outcome recording (W8).

Covers B-017 V1 / B-018: thread the ML engine selector and record which engine
actually ran (incl. the transparent dag-ml->legacy fallback) plus RtError
diagnostics, without depending on W7's RtResult envelope being present.
"""

from __future__ import annotations

import warnings
from types import SimpleNamespace

from api import runtime_engine
from api.runtime_errors import RtError


def test_resolve_engine_defaults_to_legacy():
    assert runtime_engine.resolve_engine(None) == "legacy"
    assert runtime_engine.resolve_engine("") == "legacy"


def test_resolve_engine_passes_through_explicit():
    assert runtime_engine.resolve_engine("dag-ml") == "dag-ml"
    assert runtime_engine.resolve_engine("legacy") == "legacy"


def test_engine_run_kwargs_only_when_requested():
    assert runtime_engine.engine_run_kwargs(None) == {}
    assert runtime_engine.engine_run_kwargs("") == {}
    assert runtime_engine.engine_run_kwargs("   ") == {}
    assert runtime_engine.engine_run_kwargs("dag-ml") == {"engine": "dag-ml"}


def test_observe_engine_no_fallback_records_resolved_engine():
    with runtime_engine.observe_engine("dag-ml") as observation:
        pass
    record = observation.finalize(result=None)
    assert record["engine"] == "dag-ml"
    assert record["engine_requested"] == "dag-ml"
    assert record["engine_diagnostics"] is None


def test_observe_engine_records_default_engine_for_none_request():
    with runtime_engine.observe_engine(None) as observation:
        pass
    record = observation.finalize(result=None)
    assert record["engine"] == "legacy"
    assert record["engine_requested"] is None
    assert record["engine_diagnostics"] is None


def test_observe_engine_detects_unsupported_shape_fallback():
    with runtime_engine.observe_engine("dag-ml") as observation:
        warnings.warn(
            "engine='dag-ml' does not support this pipeline shape (x); "
            "falling back to the legacy engine"
        )
    record = observation.finalize(result=None)
    assert record["engine"] == "legacy"
    assert record["engine_requested"] == "dag-ml"
    diagnostics = record["engine_diagnostics"]
    assert diagnostics is not None and len(diagnostics) == 1
    assert diagnostics[0]["cause"] == "unsupported_shape"
    assert diagnostics[0]["verb"] == "run"
    assert "mitigation" in diagnostics[0]


def test_observe_engine_detects_unavailable_backend_fallback():
    with runtime_engine.observe_engine("dag-ml") as observation:
        warnings.warn(
            "the dag-ml backend is not available (y); falling back to the legacy engine"
        )
    record = observation.finalize(result=None)
    assert record["engine"] == "legacy"
    assert record["engine_diagnostics"][0]["cause"] == "unavailable_backend"


def test_observe_engine_ignores_unrelated_warnings():
    with runtime_engine.observe_engine("dag-ml") as observation:
        warnings.warn("some unrelated deprecation notice")
    record = observation.finalize(result=None)
    assert record["engine"] == "dag-ml"
    assert record["engine_diagnostics"] is None


def test_observe_engine_does_not_suppress_warnings():
    """The hook must forward to the original handler (non-suppressing)."""
    seen: list[str] = []
    original = warnings.showwarning

    def _capture(message, *args, **kwargs):  # noqa: ANN001, ANN002, ANN003
        seen.append(str(message))

    warnings.showwarning = _capture
    try:
        with runtime_engine.observe_engine("dag-ml"):
            warnings.warn("falling back to the legacy engine")
        restored = warnings.showwarning
    finally:
        warnings.showwarning = original

    assert any("falling back to the legacy engine" in message for message in seen)
    # showwarning restored to the handler installed before observe_engine.
    assert restored is _capture


def test_finalize_prefers_w7_rt_result_when_present():
    """Forward-compat: when RunResult.to_rt_result() exists, read engine from it."""

    class _Manifest:
        engine = "dag-ml"

    class _RtResult:
        manifest = {"engine": "dag-ml"}
        diagnostics = [RtError(verb="run", cause="unsupported_shape", message="m")]

    class _Result:
        def to_rt_result(self):  # noqa: ANN201
            return _RtResult()

    # Even though a fallback warning is present, the structured envelope wins.
    with runtime_engine.observe_engine("dag-ml") as observation:
        warnings.warn("the dag-ml backend is not available; falling back to the legacy engine")
    record = observation.finalize(result=_Result())
    assert record["engine"] == "dag-ml"
    assert record["engine_diagnostics"] is not None
    assert record["engine_diagnostics"][0]["cause"] == "unsupported_shape"


def test_finalize_reads_mapping_rt_result_contract():
    """Studio accepts the JSON/native RtResult shape, not only Python objects."""

    diagnostic = {
        "verb": "run",
        "cause": "unavailable_backend",
        "message": "dag-ml unavailable; ran legacy",
    }

    class _Result:
        def to_rt_result(self):  # noqa: ANN201
            return {
                "manifest": {
                    "engine": "legacy",
                    "fingerprints": {"score_set_hash": "sha256:test"},
                },
                "diagnostics": [diagnostic],
            }

    with runtime_engine.observe_engine("dag-ml") as observation:
        warnings.warn("the dag-ml backend is not available; falling back to the legacy engine")
    record = observation.finalize(result=_Result())

    assert record["engine"] == "legacy"
    assert record["engine_requested"] == "dag-ml"
    assert record["engine_diagnostics"] == [diagnostic]


def test_finalize_preserves_rt_manifest_policy_and_native_refs(tmp_path):
    run_dir = tmp_path / "nirs4all_results" / "native-run"
    artifact = {
        "artifact_id": "artifact:model:compat.1:nirs4all:refit:variant:base",
        "uri": "artifacts/model.joblib",
        "backend": "joblib",
        "kind": "model",
        "content_fingerprint": "sha256:model",
    }
    manifest = {
        "engine": "dag-ml",
        "fingerprints": {"score_set_hash": "sha256:score"},
        "files": {"score_set": "score_set.json", "predictions": "predictions.parquet"},
    }
    fallback_policy = runtime_engine.fallback_policy_record("dag-ml", True)

    class _Result:
        _dagml_results_dir = run_dir

        def to_rt_result(self):  # noqa: ANN201
            return SimpleNamespace(manifest=manifest, diagnostics=[], artifacts=[artifact])

    with runtime_engine.observe_engine("dag-ml") as observation:
        pass

    record = observation.finalize(_Result(), fallback_policy=fallback_policy)

    assert record["runtime_source"] == "rt_result"
    assert record["runtime_manifest"] == manifest
    assert record["fallback_policy"] == fallback_policy
    assert record["native_result_refs"][0]["path"] == str(run_dir)
    assert record["native_result_refs"][0]["manifest_path"] == str(run_dir / "manifest.json")
    assert record["native_result_refs"][1]["artifact_id"] == artifact["artifact_id"]
    assert record["native_result_refs"][1]["uri"] == "artifacts/model.joblib"


def test_finalize_handles_broken_rt_result_gracefully():
    class _Result:
        def to_rt_result(self):  # noqa: ANN201
            raise RuntimeError("boom")

    with runtime_engine.observe_engine("dag-ml") as observation:
        pass
    record = observation.finalize(result=_Result())
    assert record["engine"] == "dag-ml"

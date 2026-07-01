"""B-011 Studio-bypass parity: prove the run route threads the ML engine.

W14 closes the Studio half of B-011. These tests assert three properties of the
Studio run path end-to-end, at the altitude each property lives:

1. **Pass the requested engine.** ``POST /runs`` body → ``Run.engine`` →
   ``_execute_run_job`` → ``_execute_pipeline_training`` → ``nirs4all.run(engine=...)``.
   A default (``None``) request omits the kwarg entirely (byte-identical to the
   pre-engine call so the library default applies).
2. **Persist the actual engine + fallback diagnostics.** The engine that actually
   ran — including nirs4all's transparent ``dag-ml`` → ``legacy`` fallback — and
   any ``RtError`` diagnostics are recorded on the ``PipelineRun`` and round-trip
   through the run manifest. The requested engine persists even when training
   hard-fails.
3. **Do not silently bypass the runtime route.** When an engine is requested,
   ``nirs4all.run`` is actually invoked with it (exactly once); a fallback is
   recorded, never hidden.

The deep-compute push-down (B-017) is out of scope here (that is W15).
"""

from __future__ import annotations

# ruff: noqa: I001

from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import nirs4all

# Import api.runs first: it initialises the api package (lazy_imports) cleanly.
# Importing api.nirs4all_adapter before it triggers a circular import.
import api.runs as runs_api
import api.aggregated_predictions as aggregated_api
import api.spectra as spectra_api
import api.nirs4all_adapter as adapter_api


class _Frame:
    def __init__(self, rows):
        self._rows = rows
        self.columns = list(rows[0].keys()) if rows else []

    def __len__(self):
        return len(self._rows)

    def row(self, index, named=False):
        row = self._rows[index]
        return dict(row) if named else tuple(row.values())

    def iter_rows(self, named=False):
        for row in self._rows:
            yield dict(row) if named else tuple(row.values())


# ---------------------------------------------------------------------------
# Group A — _execute_pipeline_training (real function) passes + records + no bypass
# ---------------------------------------------------------------------------

@pytest.fixture
def stub_training_deps(monkeypatch):
    """Stub the data/pipeline-prep seams of ``_execute_pipeline_training``.

    Everything except the engine wiring and ``nirs4all.run`` is replaced with a
    trivial in-memory stub so the test exercises the *real* engine threading
    (engine kwargs + observe_engine + finalize) without a workspace/dataset.

    Returns a ``calls`` dict the test fills with ``run`` (the fake
    ``nirs4all.run``); the fixture installs it on the real ``nirs4all`` module so
    the library's own ``resolve_engine`` is still used.
    """
    # A clean engine env so resolve_engine(None) -> the library default "legacy".
    monkeypatch.delenv("N4A_ENGINE", raising=False)

    monkeypatch.setattr(adapter_api, "build_dataset_config", lambda dataset_id: {"path": dataset_id})
    monkeypatch.setattr(spectra_api, "_load_dataset", lambda dataset_id: SimpleNamespace(name=dataset_id))
    monkeypatch.setattr(
        runs_api,
        "prepare_pipeline_steps_with_runtime_grouping",
        lambda steps, dataset, group_by: SimpleNamespace(warnings=[], steps=[{"op": "noop"}]),
    )
    monkeypatch.setattr(runs_api, "editor_steps_to_runtime_canonical", lambda steps: [{"op": "noop"}])
    monkeypatch.setattr(runs_api, "count_runtime_variants", lambda steps: 1)
    monkeypatch.setattr(runs_api, "contains_generators", lambda steps: False)
    monkeypatch.setattr(adapter_api, "extract_best_metrics", lambda result: {})

    calls: dict = {"captured": None, "count": 0}

    def install(run_impl):
        def fake_run(**kwargs):
            calls["captured"] = kwargs
            calls["count"] += 1
            return run_impl(**kwargs)

        monkeypatch.setattr(nirs4all, "run", fake_run)

    calls["install"] = install
    return calls


def _pipeline() -> runs_api.PipelineRun:
    return runs_api.PipelineRun(
        id="run-1-dataset-a-pipe-a",
        pipeline_id="pipe-a",
        pipeline_name="Pipeline A",
        model="PLS",
        preprocessing="SNV",
        split_strategy="KFold(5)",
        status="running",
        config={"name": "Pipeline A", "steps": [{"class": "PLS"}]},
    )


def test_execute_pipeline_training_passes_requested_engine_to_run(stub_training_deps):
    """engine='dag-ml' is forwarded to nirs4all.run and recorded (no fallback)."""
    stub_training_deps["install"](lambda **kwargs: SimpleNamespace())

    result = runs_api._execute_pipeline_training(
        _pipeline(), "dataset-a", None, "run-1", engine="dag-ml",
    )

    # Property 1: the requested engine reaches the runner.
    assert stub_training_deps["captured"]["engine"] == "dag-ml"
    # Property 3: the runner was actually invoked (no silent bypass).
    assert stub_training_deps["count"] == 1
    # Property 2: the actual engine + requested engine are recorded.
    assert result["engine"] == "dag-ml"
    assert result["engine_requested"] == "dag-ml"
    assert result["engine_diagnostics"] is None
    assert result["fallback_policy"]["allow_fallback"] is False
    assert result["fallback_policy"]["mode"] == "refuse_fallback"


def test_execute_pipeline_training_records_library_default_for_default_engine(stub_training_deps):
    """engine=None omits the kwarg and records the library-selected default."""
    stub_training_deps["install"](lambda **kwargs: SimpleNamespace())

    result = runs_api._execute_pipeline_training(
        _pipeline(), "dataset-a", None, "run-1", engine=None,
    )

    # No engine kwarg => nirs4all applies its own default, unchanged.
    assert "engine" not in stub_training_deps["captured"]
    assert stub_training_deps["count"] == 1
    # The engine that actually ran (the library default) is still recorded.
    assert result["engine"] == "dag-ml"
    assert result["engine_requested"] is None
    assert result["engine_diagnostics"] is None


@pytest.mark.parametrize(
    ("warning_text", "expected_cause"),
    [
        ("the dag-ml backend is not available (boom); falling back to the legacy engine", "unavailable_backend"),
        (
            "engine='dag-ml' does not support this pipeline shape (branch); falling back to the legacy engine",
            "unsupported_shape",
        ),
    ],
)
def test_execute_pipeline_training_records_transparent_fallback(
    stub_training_deps, warning_text, expected_cause,
):
    """A transparent dag-ml->legacy fallback is captured, classified, recorded."""
    import warnings

    def run_with_fallback(**kwargs):
        warnings.warn(warning_text)
        return SimpleNamespace()

    stub_training_deps["install"](run_with_fallback)

    result = runs_api._execute_pipeline_training(
        _pipeline(), "dataset-a", None, "run-1", engine="dag-ml",
    )

    # No bypass: dag-ml was actually attempted before the library fell back.
    assert stub_training_deps["captured"]["engine"] == "dag-ml"
    # The engine that actually ran is the legacy fallback, not the request.
    assert result["engine"] == "legacy"
    assert result["engine_requested"] == "dag-ml"
    diagnostics = result["engine_diagnostics"]
    assert diagnostics is not None and len(diagnostics) == 1
    assert diagnostics[0]["cause"] == expected_cause
    assert diagnostics[0]["verb"] == "run"
    assert warning_text in diagnostics[0]["message"]


def test_execute_pipeline_training_handles_structured_rt_error_fallback(
    stub_training_deps,
    tmp_path,
):
    """Studio reruns legacy from structured RtError, not warning-string parsing."""
    diagnostic = {
        "verb": "run",
        "cause": "unsupported_shape",
        "message": "engine='dag-ml' does not support this pipeline shape",
        "mitigation": "run this shape on engine='legacy'",
    }
    calls: list[dict] = []

    class StructuredRtError(Exception):
        def to_dict(self):
            return diagnostic

    def run_with_structured_fallback(**kwargs):
        calls.append(dict(kwargs))
        if kwargs.get("engine") == "dag-ml":
            raise StructuredRtError("structured refusal")
        return SimpleNamespace()

    stub_training_deps["install"](run_with_structured_fallback)

    result = runs_api._execute_pipeline_training(
        _pipeline(),
        "dataset-a",
        str(tmp_path),
        "run-1",
        engine="dag-ml",
        allow_fallback=True,
    )

    assert len(calls) == 2
    assert calls[0]["engine"] == "dag-ml"
    assert calls[0]["allow_fallback"] is False
    assert calls[0]["results_path"] == str(tmp_path / "nirs4all_results")
    assert "workspace_path" not in calls[0]
    assert calls[1]["engine"] == "legacy"
    assert calls[1]["workspace_path"] == str(tmp_path)
    assert result["engine"] == "legacy"
    assert result["engine_requested"] == "dag-ml"
    assert result["engine_diagnostics"] == [diagnostic]
    assert result["fallback_policy"]["allow_fallback"] is True
    assert result["fallback_policy"]["mode"] == "allow_fallback"


def test_execute_pipeline_training_refuses_structured_rt_error_fallback_by_default(
    stub_training_deps,
    tmp_path,
):
    """Structured dag-ml refusal does not silently rerun legacy without opt-in."""
    diagnostic = {
        "verb": "run",
        "cause": "unsupported_shape",
        "message": "engine='dag-ml' does not support this pipeline shape",
        "mitigation": "run this shape on engine='legacy'",
    }
    calls: list[dict] = []

    class StructuredRtError(Exception):
        def to_dict(self):
            return diagnostic

    def refuse_dagml(**kwargs):
        calls.append(dict(kwargs))
        raise StructuredRtError("structured refusal")

    stub_training_deps["install"](refuse_dagml)

    with pytest.raises(StructuredRtError):
        runs_api._execute_pipeline_training(
            _pipeline(),
            "dataset-a",
            str(tmp_path),
            "run-1",
            engine="dag-ml",
        )

    assert len(calls) == 1
    assert calls[0]["engine"] == "dag-ml"
    assert calls[0]["allow_fallback"] is False
    assert calls[0]["results_path"] == str(tmp_path / "nirs4all_results")
    assert "workspace_path" not in calls[0]


# ---------------------------------------------------------------------------
# Group B — route / constructor thread the engine onto the Run
# ---------------------------------------------------------------------------

def test_run_request_models_default_to_refuse_fallback():
    """Experiment and QuickRun requests require explicit fallback opt-in."""
    config = runs_api.ExperimentConfig(
        name="strict experiment",
        dataset_ids=["dataset-a"],
        pipeline_ids=["pipe-a"],
        engine="dag-ml",
    )
    quick = runs_api.QuickRunRequest(
        pipeline_id="pipe-a",
        dataset_id="dataset-a",
        engine="dag-ml",
    )

    assert config.allow_fallback is False
    assert quick.allow_fallback is False


def test_run_request_models_preserve_explicit_fallback_opt_in():
    config = runs_api.ExperimentConfig(
        name="compat experiment",
        dataset_ids=["dataset-a"],
        pipeline_ids=["pipe-a"],
        engine="dag-ml",
        allow_fallback=True,
    )
    quick = runs_api.QuickRunRequest(
        pipeline_id="pipe-a",
        dataset_id="dataset-a",
        engine="dag-ml",
        allow_fallback=True,
    )

    assert config.allow_fallback is True
    assert quick.allow_fallback is True


def test_create_run_from_config_threads_requested_engine(tmp_path):
    run = runs_api._create_run_from_config(
        runs_api.ExperimentConfig(
            name="dag-ml experiment",
            dataset_ids=["dataset-a"],
            pipeline_ids=["pipe-a"],
            engine="dag-ml",
        ),
        dataset_infos={"dataset-a": {"name": "Dataset A", "id": "dataset-a"}},
        pipeline_configs={"pipe-a": {"name": "Pipeline A", "steps": []}},
        workspace_path=str(tmp_path),
    )

    assert run.engine == "dag-ml"
    assert run.allow_fallback is False


def test_create_run_from_config_defaults_engine_to_none(tmp_path):
    """No engine selected => Run.engine is None so the library default applies."""
    run = runs_api._create_run_from_config(
        runs_api.ExperimentConfig(
            name="default experiment",
            dataset_ids=["dataset-a"],
            pipeline_ids=["pipe-a"],
        ),
        dataset_infos={"dataset-a": {"name": "Dataset A", "id": "dataset-a"}},
        pipeline_configs={"pipe-a": {"name": "Pipeline A", "steps": []}},
        workspace_path=str(tmp_path),
    )

    assert run.engine is None
    assert run.allow_fallback is False


def test_create_run_from_config_preserves_explicit_fallback_opt_in(tmp_path):
    run = runs_api._create_run_from_config(
        runs_api.ExperimentConfig(
            name="compat experiment",
            dataset_ids=["dataset-a"],
            pipeline_ids=["pipe-a"],
            engine="dag-ml",
            allow_fallback=True,
        ),
        dataset_infos={"dataset-a": {"name": "Dataset A", "id": "dataset-a"}},
        pipeline_configs={"pipe-a": {"name": "Pipeline A", "steps": []}},
        workspace_path=str(tmp_path),
    )

    assert run.engine == "dag-ml"
    assert run.allow_fallback is True


def test_quick_run_threads_requested_engine(monkeypatch):
    monkeypatch.setattr(runs_api.workspace_manager, "get_current_workspace", lambda: None)

    run = runs_api._create_quick_run(
        runs_api.QuickRunRequest(pipeline_id="pipe-a", dataset_id="dataset-a", engine="dag-ml"),
        pipeline_config={"name": "Pipeline A", "steps": []},
        dataset_info={"name": "Dataset A", "id": "dataset-a"},
    )

    assert run.engine == "dag-ml"
    assert run.allow_fallback is False


def test_quick_run_preserves_explicit_fallback_opt_in(monkeypatch):
    monkeypatch.setattr(runs_api.workspace_manager, "get_current_workspace", lambda: None)

    run = runs_api._create_quick_run(
        runs_api.QuickRunRequest(
            pipeline_id="pipe-a",
            dataset_id="dataset-a",
            engine="dag-ml",
            allow_fallback=True,
        ),
        pipeline_config={"name": "Pipeline A", "steps": []},
        dataset_info={"name": "Dataset A", "id": "dataset-a"},
    )

    assert run.engine == "dag-ml"
    assert run.allow_fallback is True


def test_create_run_route_threads_engine_to_started_run(monkeypatch, tmp_path):
    """POST /runs body engine -> Run.engine on the run handed to the job runner."""
    started_runs: list = []

    monkeypatch.setattr(runs_api, "_ensure_runs_loaded", lambda: None)
    monkeypatch.setattr(runs_api, "_runs", {})
    monkeypatch.setattr(runs_api, "_save_run_manifest", lambda run: True)
    monkeypatch.setattr(runs_api, "_start_run_job", lambda run: started_runs.append(run))
    monkeypatch.setattr(
        runs_api.workspace_manager,
        "get_current_workspace",
        lambda: SimpleNamespace(path=str(tmp_path)),
    )
    monkeypatch.setattr(runs_api, "_load_dataset", lambda dataset_id: SimpleNamespace(name=dataset_id), raising=False)
    monkeypatch.setattr(spectra_api, "_load_dataset", lambda dataset_id: SimpleNamespace(name=dataset_id))
    monkeypatch.setattr(
        runs_api,
        "prepare_pipeline_steps_with_runtime_grouping",
        lambda steps, dataset, group_by: SimpleNamespace(warnings=[], steps=steps),
    )

    import api.pipelines as pipelines_api

    monkeypatch.setattr(pipelines_api, "_load_pipeline", lambda pid: {"name": "Pipeline A", "steps": []})

    app = FastAPI()
    app.include_router(runs_api.router, prefix="/api")
    with TestClient(app) as client:
        response = client.post(
            "/api/runs",
            json={
                "config": {
                    "name": "dag-ml run",
                    "dataset_ids": ["dataset-a"],
                    "pipeline_ids": ["pipe-a"],
                    "engine": "dag-ml",
                    "cv_folds": 2,
                }
            },
        )

    assert response.status_code == 200, response.text
    assert response.json()["engine"] == "dag-ml"
    assert response.json()["allow_fallback"] is False
    assert len(started_runs) == 1
    assert started_runs[0].engine == "dag-ml"
    assert started_runs[0].allow_fallback is False


@pytest.mark.parametrize("engine", ["dag-ml", None])
def test_retry_run_preserves_requested_engine(monkeypatch, tmp_path, engine):
    """Retrying a failed run re-runs on the originally requested engine.

    Regression (B-017/B-018): ``retry_run`` built the retried ``Run`` without
    threading ``engine``, so a ``dag-ml`` experiment was silently downgraded to
    the library default engine on re-run. The requested engine must survive the
    retry exactly as the other run-creation routes preserve it.
    """
    started_runs: list = []

    failed_pipeline = runs_api.PipelineRun(
        id="run-old-dataset-a-pipe-a",
        pipeline_id="pipe-a",
        pipeline_name="Pipeline A",
        model="PLS",
        preprocessing="SNV",
        split_strategy="KFold(5)",
        status="failed",
    )
    old_run = runs_api.Run(
        id="run-old",
        name="Engine run",
        engine=engine,
        datasets=[
            runs_api.DatasetRun(
                dataset_id="dataset-a", dataset_name="Dataset A", pipelines=[failed_pipeline]
            )
        ],
        status="failed",
        created_at="2026-07-01T10:00:00",
        total_pipelines=1,
        completed_pipelines=0,
        workspace_path=str(tmp_path),
    )

    monkeypatch.setattr(runs_api, "_ensure_runs_loaded", lambda: None)
    monkeypatch.setattr(runs_api, "_runs", {"run-old": old_run})
    monkeypatch.setattr(runs_api, "_start_run_job", lambda run: started_runs.append(run))

    app = FastAPI()
    app.include_router(runs_api.router, prefix="/api")
    with TestClient(app) as client:
        response = client.post("/api/runs/run-old/retry")

    assert response.status_code == 200, response.text
    # The retried run carries the original experiment's requested engine.
    assert response.json()["engine"] == engine
    assert len(started_runs) == 1
    assert started_runs[0].engine == engine


# ---------------------------------------------------------------------------
# Group C — job loop records the engine outcome + persists the request on failure
# ---------------------------------------------------------------------------

def _single_pipeline_run(engine: str | None, tmp_path) -> runs_api.Run:
    pipeline = runs_api.PipelineRun(
        id="run-1-dataset-a-pipe-a",
        pipeline_id="pipe-a",
        pipeline_name="Pipeline A",
        model="PLS",
        preprocessing="SNV",
        split_strategy="KFold(5)",
        status="queued",
    )
    return runs_api.Run(
        id="run-1",
        name="Engine run",
        engine=engine,
        datasets=[
            runs_api.DatasetRun(dataset_id="dataset-a", dataset_name="Dataset A", pipelines=[pipeline])
        ],
        status="queued",
        created_at="2026-07-01T10:00:00",
        total_pipelines=1,
        completed_pipelines=0,
        workspace_path=str(tmp_path),
    )


def test_execute_run_job_records_engine_outcome_on_pipeline(monkeypatch, tmp_path):
    """The per-pipeline engine record (actual + requested + diagnostics) is applied."""
    run = _single_pipeline_run("dag-ml", tmp_path)
    diagnostics = [{"verb": "run", "cause": "unavailable_backend", "message": "x"}]
    seen_engine: dict = {}

    def fake_training(pipeline, dataset_id, workspace_path, run_id, split_group_by=None, *, store_run_id=None, engine=None, allow_fallback=True, should_stop=None):
        seen_engine["engine"] = engine
        return {
            "metrics": {},
            "model_path": None,
            "logs": [],
            "variants_tested": 1,
            "engine": "legacy",
            "engine_requested": "dag-ml",
            "engine_diagnostics": diagnostics,
        }

    monkeypatch.setattr(runs_api, "_runs", {"run-1": run})
    monkeypatch.setattr(runs_api, "_save_run_manifest", lambda run: None)
    monkeypatch.setattr(runs_api, "_open_run_store_repository", lambda ws: None)
    monkeypatch.setattr(runs_api, "_execute_pipeline_training", fake_training)

    result = runs_api._execute_run_job(
        "run-1", SimpleNamespace(id="job-1", cancellation_requested=False), lambda progress, message: None,
    )

    assert result["status"] == "completed"
    # The job loop forwarded the requested engine to the executor.
    assert seen_engine["engine"] == "dag-ml"
    pipeline = run.datasets[0].pipelines[0]
    assert pipeline.engine == "legacy"
    assert pipeline.engine_requested == "dag-ml"
    assert pipeline.engine_diagnostics == diagnostics


def test_execute_run_job_persists_engine_requested_on_training_failure(monkeypatch, tmp_path):
    """A hard training failure still persists the requested engine (B-011 fix)."""
    run = _single_pipeline_run("dag-ml", tmp_path)

    def boom(pipeline, dataset_id, workspace_path, run_id, split_group_by=None, *, store_run_id=None, engine=None, allow_fallback=True, should_stop=None):
        raise RuntimeError("engine exploded")

    monkeypatch.setattr(runs_api, "_runs", {"run-1": run})
    monkeypatch.setattr(runs_api, "_save_run_manifest", lambda run: None)
    monkeypatch.setattr(runs_api, "_open_run_store_repository", lambda ws: None)
    monkeypatch.setattr(runs_api, "_execute_pipeline_training", boom)

    result = runs_api._execute_run_job(
        "run-1", SimpleNamespace(id="job-1", cancellation_requested=False), lambda progress, message: None,
    )

    assert result["status"] == "failed"
    pipeline = run.datasets[0].pipelines[0]
    assert pipeline.status == "failed"
    assert "engine exploded" in (pipeline.error_message or "")
    # The request is not silently lost just because the run crashed.
    assert pipeline.engine_requested == "dag-ml"


def test_execute_run_job_persists_structured_refusal_policy(monkeypatch, tmp_path):
    """Strict runtime refusal stores RtError diagnostics and the refuse policy."""
    run = _single_pipeline_run("dag-ml", tmp_path)
    assert run.allow_fallback is False
    diagnostic = {
        "verb": "run",
        "cause": "unsupported_shape",
        "message": "engine='dag-ml' does not support this pipeline shape",
    }

    class StructuredRtError(Exception):
        def to_dict(self):
            return diagnostic

    def refuse(pipeline, dataset_id, workspace_path, run_id, split_group_by=None, *, store_run_id=None, engine=None, allow_fallback=True, should_stop=None):
        assert allow_fallback is False
        raise StructuredRtError("structured refusal")

    monkeypatch.setattr(runs_api, "_runs", {"run-1": run})
    monkeypatch.setattr(runs_api, "_save_run_manifest", lambda run: None)
    monkeypatch.setattr(runs_api, "_open_run_store_repository", lambda ws: None)
    monkeypatch.setattr(runs_api, "_execute_pipeline_training", refuse)

    result = runs_api._execute_run_job(
        "run-1", SimpleNamespace(id="job-1", cancellation_requested=False), lambda progress, message: None,
    )

    assert result["status"] == "failed"
    pipeline = run.datasets[0].pipelines[0]
    assert pipeline.status == "failed"
    assert pipeline.engine_requested == "dag-ml"
    assert pipeline.engine_diagnostics == [diagnostic]
    assert pipeline.runtime_source == "rt_error"
    assert pipeline.fallback_policy == {
        "source": "nirs4all.run.allow_fallback",
        "engine_requested": "dag-ml",
        "allow_fallback": False,
        "mode": "refuse_fallback",
    }


# ---------------------------------------------------------------------------
# Group D — engine record round-trips through the persisted run manifest
# ---------------------------------------------------------------------------

def test_engine_record_round_trips_through_run_manifest(tmp_path):
    """Saved manifest re-reads the engine, requested engine and diagnostics."""
    import json

    diagnostics = [{"verb": "run", "cause": "unsupported_shape", "message": "branch unsupported"}]
    fallback_policy = {
        "source": "nirs4all.run.allow_fallback",
        "engine_requested": "dag-ml",
        "allow_fallback": True,
        "mode": "allow_fallback",
    }
    runtime_manifest = {
        "engine": "legacy",
        "fingerprints": {"score_set_hash": None},
        "files": {},
    }
    native_result_refs = [
        {
            "source": "native_results",
            "role": "run_dir",
            "artifact_type": "native_results_dir",
            "run_id": "native-run",
            "path": str(tmp_path / "nirs4all_results" / "native-run"),
        }
    ]
    pipeline = runs_api.PipelineRun(
        id="run-1-dataset-a-pipe-a",
        pipeline_id="pipe-a",
        pipeline_name="Pipeline A",
        model="PLS",
        preprocessing="SNV",
        split_strategy="KFold(5)",
        status="completed",
        engine="legacy",
        engine_requested="dag-ml",
        engine_diagnostics=diagnostics,
        runtime_source="rt_result",
        runtime_manifest=runtime_manifest,
        fallback_policy=fallback_policy,
        native_result_refs=native_result_refs,
    )
    run = runs_api.Run(
        id="run-1",
        name="Engine run",
        engine="dag-ml",
        datasets=[
            runs_api.DatasetRun(dataset_id="dataset-a", dataset_name="Dataset A", pipelines=[pipeline])
        ],
        status="completed",
        created_at="2026-07-01T10:00:00",
        total_pipelines=1,
        completed_pipelines=1,
        workspace_path=str(tmp_path),
    )

    assert runs_api._save_run_manifest(run) is True

    manifest_path = tmp_path / "runs" / "run-1" / "manifest.json"
    with open(manifest_path, encoding="utf-8") as fh:
        data = json.load(fh)

    reloaded = runs_api.Run(**data)
    assert reloaded.engine == "dag-ml"
    reloaded_pipeline = reloaded.datasets[0].pipelines[0]
    assert reloaded_pipeline.engine == "legacy"
    assert reloaded_pipeline.engine_requested == "dag-ml"
    assert reloaded_pipeline.engine_diagnostics == diagnostics
    assert reloaded_pipeline.runtime_source == "rt_result"
    assert reloaded_pipeline.runtime_manifest == runtime_manifest
    assert reloaded_pipeline.fallback_policy == fallback_policy
    assert reloaded_pipeline.native_result_refs == native_result_refs


# ---------------------------------------------------------------------------
# Group E — HTTP run/read + result retrieval stay aligned with RtResult
# ---------------------------------------------------------------------------

def test_quick_run_route_and_chain_detail_keep_runtime_envelope_semantics(
    monkeypatch,
    tmp_path,
    stub_training_deps,
):
    """Route-level parity gate for engine, fallback diagnostics and result views."""
    rt_diagnostic = {
        "verb": "run",
        "cause": "unsupported_shape",
        "message": "engine='dag-ml' does not support this pipeline shape; ran legacy",
        "mitigation": "Run on engine='legacy', or adjust the pipeline so dag-ml supports it.",
    }
    rt_manifest = {
        "engine": "legacy",
        "fingerprints": {"score_set_hash": "sha256:score"},
        "capabilities": {},
        "portable_level": None,
        "files": {"score_set": "score_set.json"},
    }
    observed: dict[str, object] = {}

    class RuntimeEnvelopeResult:
        def to_rt_result(self):  # noqa: ANN201
            return SimpleNamespace(manifest=rt_manifest, diagnostics=[rt_diagnostic])

        def export(self, model_path):
            Path(model_path).parent.mkdir(parents=True, exist_ok=True)
            Path(model_path).write_text("fake n4a model bundle", encoding="utf-8")

    def run_from_runtime(**kwargs):
        observed["run_kwargs"] = kwargs
        return RuntimeEnvelopeResult()

    def sync_start_run(run):
        runs_api._execute_run_job(
            run.id,
            SimpleNamespace(id=run.id, cancellation_requested=False),
            lambda _progress, _message: None,
        )
        return SimpleNamespace(id=run.id)

    def ensure_models_dir(workspace_path):
        models_dir = Path(workspace_path) / "models"
        models_dir.mkdir(parents=True, exist_ok=True)
        return models_dir

    monkeypatch.setattr(runs_api, "_ensure_runs_loaded", lambda: None)
    monkeypatch.setattr(runs_api, "_runs", {})
    monkeypatch.setattr(runs_api.workspace_manager, "get_current_workspace", lambda: SimpleNamespace(path=str(tmp_path)))
    monkeypatch.setattr(aggregated_api.workspace_manager, "get_current_workspace", lambda: SimpleNamespace(path=str(tmp_path)))
    monkeypatch.setattr(runs_api, "_start_run_job", sync_start_run)
    monkeypatch.setattr(runs_api, "_open_run_store_repository", lambda _workspace_path: None)
    monkeypatch.setattr(adapter_api, "ensure_models_dir", ensure_models_dir)
    stub_training_deps["install"](run_from_runtime)

    app = FastAPI()
    app.include_router(runs_api.router, prefix="/api")
    app.include_router(aggregated_api.router, prefix="/api")

    with TestClient(app) as client:
        created = client.post(
            "/api/runs/quick",
            json={
                "pipeline_id": "pipe-a",
                "dataset_id": "dataset-a",
                "name": "RtResult route parity",
                "engine": "dag-ml",
                "cv_folds": 2,
                "inline_pipeline": {
                    "name": "Pipeline A",
                    "steps": [{"class": "PLSRegression"}],
                },
            },
        )

        assert created.status_code == 200, created.text
        run_id = created.json()["id"]

        runtime_metadata = {
            "source": "rt_result",
            "run_id": run_id,
            "engine": "legacy",
            "engine_requested": "dag-ml",
            "engine_diagnostics": [rt_diagnostic],
            "manifest": rt_manifest,
        }

        class RuntimeResultsRepository:
            def query_chain_summaries(self, **filters):
                assert filters.get("chain_id") == "chain-runtime"
                return _Frame([
                    {
                        "run_id": run_id,
                        "pipeline_id": "pipe-a",
                        "chain_id": "chain-runtime",
                        "model_name": "PLSRegression",
                        "model_class": "PLSRegression",
                        "preprocessings": "SNV",
                        "model_step_idx": 0,
                        "metric": "r2",
                        "task_type": "regression",
                        "dataset_name": "dataset-a",
                        "cv_val_score": 0.91,
                        "cv_fold_count": 1,
                        "best_params": {},
                        "variant_params": {"result_metadata": runtime_metadata},
                    }
                ])

            def get_chain_predictions(self, chain_id, partition=None, fold_id=None):
                assert chain_id == "chain-runtime"
                assert partition is None
                assert fold_id is None
                return _Frame([
                    {
                        "prediction_id": "pred-runtime",
                        "run_id": run_id,
                        "pipeline_id": "pipe-a",
                        "chain_id": chain_id,
                        "dataset_name": "dataset-a",
                        "model_name": "PLSRegression",
                        "model_class": "PLSRegression",
                        "fold_id": "fold-0",
                        "partition": "test",
                        "metric": "r2",
                        "task_type": "regression",
                        "n_samples": 2,
                        "scores": {"r2": 0.91},
                        "result_metadata": runtime_metadata,
                    }
                ])

            def get_pipeline(self, pipeline_id):
                return {"pipeline_id": pipeline_id, "name": "Pipeline A", "dataset_name": "dataset-a"}

            def _fetch_pl(self, _sql, _params=None):
                return _Frame([])

            def close(self):
                observed["repository_closed"] = True

        monkeypatch.setattr(
            aggregated_api,
            "resolve_results_repository",
            lambda _workspace_path, *, workspace_store_factory: RuntimeResultsRepository(),
        )

        run_response = client.get(f"/api/runs/{run_id}")
        detail_response = client.get("/api/aggregated-predictions/chain/chain-runtime")

    assert observed["run_kwargs"]["engine"] == "dag-ml"
    assert observed["run_kwargs"]["allow_fallback"] is False

    assert run_response.status_code == 200, run_response.text
    pipeline_payload = run_response.json()["datasets"][0]["pipelines"][0]
    assert pipeline_payload["engine"] == "legacy"
    assert pipeline_payload["engine_requested"] == "dag-ml"
    assert pipeline_payload["engine_diagnostics"] == [rt_diagnostic]
    assert pipeline_payload["fallback_policy"] == {
        "source": "nirs4all.run.allow_fallback",
        "engine_requested": "dag-ml",
        "allow_fallback": False,
        "mode": "refuse_fallback",
    }

    assert detail_response.status_code == 200, detail_response.text
    detail_payload = detail_response.json()
    assert detail_payload["summary"]["variant_params"]["result_metadata"] == runtime_metadata
    assert detail_payload["predictions"][0]["result_metadata"] == runtime_metadata
    assert observed["repository_closed"] is True

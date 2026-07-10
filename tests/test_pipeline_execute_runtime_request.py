"""Pipeline execute endpoint runtime selector request contract."""

from api.pipelines import PipelineRunRequest


def test_pipeline_run_request_defaults_to_library_engine_without_fallback():
    request = PipelineRunRequest(dataset_id="dataset-a")

    assert request.engine is None
    assert request.allow_fallback is False


def test_pipeline_run_request_preserves_explicit_engine_and_fallback():
    request = PipelineRunRequest(dataset_id="dataset-a", engine="dag-ml", allow_fallback=True)

    assert request.engine == "dag-ml"
    assert request.allow_fallback is True

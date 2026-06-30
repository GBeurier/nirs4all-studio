from __future__ import annotations

from types import SimpleNamespace

from api.run_execution_plan import build_campaign_run_group_execution_plan, build_retry_run_execution_plan


def test_campaign_run_group_execution_plan_preserves_explicit_split_order():
    pipeline_configs = {
        "pipe-a": {"name": "Pipeline A", "steps": [{"id": "model-a"}]},
        "pipe-b": {"name": "Pipeline B", "steps": [{"id": "model-b"}]},
    }

    def extract_pipeline_info(pipeline_config):
        return pipeline_config["name"], "SNV", "KFold(5)"

    def estimate_pipeline_variants(pipeline_config, *, cv_folds=None):
        return SimpleNamespace(
            estimated_variants=1,
            has_generators=False,
            fold_count=cv_folds or 1,
            branch_count=1,
            total_model_count=cv_folds or 1,
            model_count_breakdown=f"{cv_folds or 1} folds",
        )

    plan = build_campaign_run_group_execution_plan(
        run_id="run-1",
        split_specs=[
            {
                "id": "single-pair:dataset-a::pipe-b",
                "sourceRunId": "source-campaign",
                "campaign": {
                    "mode": "paired_by_index",
                    "datasets": [{"id": "dataset-a", "name": "Dataset A", "splitGroupBy": "subject"}],
                    "pipelines": [{"id": "pipe-b", "name": "Pipeline B", "source": "saved"}],
                    "runMatrix": [{
                        "id": "dataset-a::pipe-b",
                        "datasetId": "dataset-a",
                        "pipelineId": "pipe-b",
                        "splitGroupBy": "subject",
                    }],
                },
            },
            {
                "id": "single-pair:dataset-a::pipe-a",
                "sourceRunId": "source-campaign",
                "campaign": {
                    "mode": "paired_by_index",
                    "datasets": [{"id": "dataset-a", "name": "Dataset A", "splitGroupBy": "batch"}],
                    "pipelines": [{"id": "pipe-a", "name": "Pipeline A", "source": "saved"}],
                    "runMatrix": [{
                        "id": "dataset-a::pipe-a",
                        "datasetId": "dataset-a",
                        "pipelineId": "pipe-a",
                        "splitGroupBy": "batch",
                    }],
                },
            },
        ],
        dataset_infos={"dataset-a": {"name": "Dataset A", "id": "dataset-a"}},
        pipeline_configs=pipeline_configs,
        cv_folds=7,
        expand_variants=True,
        extract_pipeline_info=extract_pipeline_info,
        estimate_pipeline_variants=estimate_pipeline_variants,
        expand_pipeline_variants=lambda steps: [],
    )

    assert plan.total_pipeline_runs == 2
    assert [dataset.dataset_id for dataset in plan.datasets] == ["dataset-a", "dataset-a"]
    assert [dataset.split_group_by for dataset in plan.datasets] == ["subject", "batch"]
    assert [dataset.pipelines[0].pipeline_id for dataset in plan.datasets] == ["pipe-b", "pipe-a"]
    assert [dataset.pipelines[0].pipeline_run_id for dataset in plan.datasets] == [
        "run-1-single-pair-dataset-a-pipe-b",
        "run-1-single-pair-dataset-a-pipe-a",
    ]
    assert len({dataset.pipelines[0].pipeline_run_id for dataset in plan.datasets}) == 2
    assert [dataset.pipelines[0].split_strategy for dataset in plan.datasets] == ["KFold(7)", "KFold(7)"]


def test_retry_run_execution_plan_resets_runtime_state_and_preserves_inputs():
    old_run = SimpleNamespace(
        name="Original Run",
        description="Retry me",
        execution_backend="cluster",
        cv_folds=7,
        total_pipelines=2,
        completed_pipelines=1,
        workspace_path="/tmp/workspace",
        project_id="project-1",
        datasets=[
            SimpleNamespace(
                dataset_id="dataset-a",
                dataset_name="Dataset A",
                split_group_by="subject",
                pipelines=[
                    SimpleNamespace(
                        pipeline_id="pipe-a",
                        pipeline_name="Pipeline A",
                        model="PLS",
                        preprocessing="SNV",
                        split_strategy="KFold(7)",
                        status="failed",
                        progress=88,
                        metrics={"r2": 0.91},
                        config={"steps": [{"id": "model"}]},
                        logs=["old log"],
                        started_at="2026-06-30T10:00:00",
                        completed_at="2026-06-30T10:05:00",
                        error_message="old failure",
                        model_path="/tmp/model.pkl",
                        variant_index=2,
                        variant_description="alpha",
                        variant_choices={"n_components": 8},
                        is_expanded_variant=True,
                        estimated_variants=4,
                        tested_variants=3,
                        has_generators=True,
                        fold_count=7,
                        branch_count=2,
                        total_model_count=56,
                        model_count_breakdown="7 folds x 2 branches x 4 variants = 56 models",
                    )
                ],
            )
        ],
    )

    plan = build_retry_run_execution_plan(
        old_run=old_run,
        new_run_id="retry-run",
        created_at="2026-06-30T12:00:00",
    )

    assert plan.run_id == "retry-run"
    assert plan.name == "Original Run (retry)"
    assert plan.description == "Retry me"
    assert plan.execution_backend == "cluster"
    assert plan.status == "queued"
    assert plan.created_at == "2026-06-30T12:00:00"
    assert plan.cv_folds == 7
    assert plan.total_pipelines == 2
    assert plan.completed_pipelines == 0
    assert plan.workspace_path == "/tmp/workspace"
    assert plan.project_id == "project-1"

    dataset = plan.datasets[0]
    assert dataset.dataset_id == "dataset-a"
    assert dataset.dataset_name == "Dataset A"
    assert dataset.split_group_by == "subject"

    pipeline = dataset.pipelines[0]
    assert pipeline.pipeline_run_id == "retry-run-pipe-a"
    assert pipeline.pipeline_id == "pipe-a"
    assert pipeline.pipeline_name == "Pipeline A"
    assert pipeline.status == "queued"
    assert pipeline.progress == 0
    assert pipeline.pipeline_config == {"steps": [{"id": "model"}]}
    assert pipeline.variant_index == 2
    assert pipeline.variant_description == "alpha"
    assert pipeline.variant_choices == {"n_components": 8}
    assert pipeline.is_expanded_variant is True
    assert pipeline.estimated_variants == 4
    assert pipeline.has_generators is True
    assert pipeline.fold_count == 7
    assert pipeline.branch_count == 2
    assert pipeline.total_model_count == 56
    assert pipeline.model_count_breakdown == "7 folds x 2 branches x 4 variants = 56 models"
    assert not hasattr(pipeline, "metrics")
    assert not hasattr(pipeline, "logs")
    assert not hasattr(pipeline, "started_at")
    assert not hasattr(pipeline, "completed_at")
    assert not hasattr(pipeline, "error_message")
    assert not hasattr(pipeline, "model_path")

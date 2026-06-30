"""Helpers for building explicit run execution plans."""

from __future__ import annotations

import re
from copy import deepcopy
from dataclasses import dataclass
from typing import Any, Mapping, Protocol, Sequence


class PipelineVariantEstimate(Protocol):
    """Execution estimate shape produced by api.runs."""

    estimated_variants: int
    has_generators: bool
    fold_count: int
    branch_count: int
    total_model_count: int
    model_count_breakdown: str


class PipelineVariant(Protocol):
    """Expanded variant shape produced by nirs4all_adapter."""

    index: int
    description: str
    model_name: str
    preprocessing_names: list[str]
    choices: dict[str, Any]


class PipelineInfoExtractor(Protocol):
    def __call__(self, pipeline_config: dict[str, Any]) -> tuple[str, str, str]: ...


class PipelineVariantEstimator(Protocol):
    def __call__(self, pipeline_config: dict[str, Any], *, cv_folds: int | None = None) -> PipelineVariantEstimate: ...


class PipelineVariantExpander(Protocol):
    def __call__(self, steps: list[dict[str, Any]]) -> Sequence[PipelineVariant]: ...


class RetryPipelineSource(Protocol):
    """PipelineRun-like shape used to build retry plans without importing api.runs."""

    pipeline_id: str
    pipeline_name: str
    model: str
    preprocessing: str
    split_strategy: str
    config: dict | None
    variant_index: int | None
    variant_description: str | None
    variant_choices: dict | None
    is_expanded_variant: bool | None
    estimated_variants: int | None
    has_generators: bool | None
    fold_count: int | None
    branch_count: int | None
    total_model_count: int | None
    model_count_breakdown: str | None


class RetryDatasetSource(Protocol):
    """DatasetRun-like shape used to build retry plans without importing api.runs."""

    dataset_id: str
    dataset_name: str
    split_group_by: str | None
    pipelines: Sequence[RetryPipelineSource]


class RetryRunSource(Protocol):
    """Run-like shape used to build retry plans without importing api.runs."""

    name: str
    description: str | None
    execution_backend: str
    datasets: Sequence[RetryDatasetSource]
    cv_folds: int | None
    total_pipelines: int | None
    workspace_path: str | None
    project_id: str | None


@dataclass(frozen=True)
class PipelineRunPlanEntry:
    """Explicit plan entry for one PipelineRun to create."""

    dataset_id: str
    pipeline_id: str
    pipeline_run_id: str
    pipeline_name: str
    model: str
    preprocessing: str
    split_strategy: str
    pipeline_config: dict[str, Any]
    variant_index: int | None = None
    variant_description: str | None = None
    variant_choices: dict[str, Any] | None = None
    is_expanded_variant: bool = False
    estimated_variants: int | None = 1
    has_generators: bool | None = False
    fold_count: int | None = None
    branch_count: int | None = None
    total_model_count: int | None = None
    model_count_breakdown: str | None = None


@dataclass(frozen=True)
class DatasetRunPlan:
    """Explicit plan entries for one dataset."""

    dataset_id: str
    dataset_name: str
    dataset_info: Mapping[str, str]
    split_group_by: str | None
    pipelines: tuple[PipelineRunPlanEntry, ...]


@dataclass(frozen=True)
class RunExecutionPlan:
    """Explicit execution plan for a legacy Run."""

    datasets: tuple[DatasetRunPlan, ...]
    total_pipeline_runs: int


def _slugify_plan_id_component(value: object) -> str:
    text = str(value or "").strip()
    slug = re.sub(r"[^A-Za-z0-9_.-]+", "-", text).strip("-")
    return slug or "run"


@dataclass(frozen=True)
class RetryPipelineRunPlanEntry:
    """Explicit plan entry for one retried PipelineRun."""

    pipeline_id: str
    pipeline_run_id: str
    pipeline_name: str
    model: str
    preprocessing: str
    split_strategy: str
    status: str = "queued"
    progress: int = 0
    pipeline_config: dict | None = None
    variant_index: int | None = None
    variant_description: str | None = None
    variant_choices: dict | None = None
    is_expanded_variant: bool | None = False
    estimated_variants: int | None = 1
    has_generators: bool | None = False
    fold_count: int | None = None
    branch_count: int | None = None
    total_model_count: int | None = None
    model_count_breakdown: str | None = None

    @property
    def config(self) -> dict | None:
        """Compatibility alias for consumers that still expect PipelineRun.config."""
        return self.pipeline_config


@dataclass(frozen=True)
class RetryDatasetRunPlan:
    """Explicit plan entries for one retried dataset."""

    dataset_id: str
    dataset_name: str
    split_group_by: str | None
    pipelines: tuple[RetryPipelineRunPlanEntry, ...]


@dataclass(frozen=True)
class RetryRunExecutionPlan:
    """Explicit plan for constructing a retried Run."""

    run_id: str
    name: str
    description: str | None
    execution_backend: str
    datasets: tuple[RetryDatasetRunPlan, ...]
    status: str
    created_at: str
    cv_folds: int | None
    total_pipelines: int | None
    completed_pipelines: int
    workspace_path: str | None
    project_id: str | None


def build_legacy_run_execution_plan(
    *,
    run_id: str,
    dataset_ids: Sequence[str],
    effective_pipeline_ids: Sequence[str],
    dataset_infos: Mapping[str, Mapping[str, str]],
    pipeline_configs: Mapping[str, dict[str, Any]],
    split_group_by_by_dataset: Mapping[str, str | None],
    cv_folds: int | None,
    expand_variants: bool,
    extract_pipeline_info: PipelineInfoExtractor,
    estimate_pipeline_variants: PipelineVariantEstimator,
    expand_pipeline_variants: PipelineVariantExpander,
) -> RunExecutionPlan:
    """Build the legacy dataset x pipeline run plan without creating pydantic models."""
    datasets: list[DatasetRunPlan] = []
    total_pipeline_runs = 0

    for dataset_id in dataset_ids:
        dataset_info = dataset_infos.get(dataset_id, {"name": dataset_id, "id": dataset_id})
        pipelines: list[PipelineRunPlanEntry] = []

        for pipeline_id in effective_pipeline_ids:
            pipeline_config = pipeline_configs.get(pipeline_id, {})
            pipeline_steps = pipeline_config.get("steps", [])
            base_model, base_preprocessing, split_strategy = extract_pipeline_info(pipeline_config)
            resolved_split_strategy = f"KFold({cv_folds})" if split_strategy == "KFold(5)" else split_strategy

            estimate = estimate_pipeline_variants(pipeline_config, cv_folds=cv_folds)

            if expand_variants and estimate.has_generators and estimate.estimated_variants > 1:
                variants = expand_pipeline_variants(pipeline_steps)

                for variant in variants:
                    variant_name = f"{pipeline_config.get('name', pipeline_id)}"
                    if variant.description:
                        variant_name = f"{variant_name} [{variant.description}]"

                    model_name = variant.model_name if variant.model_name != "Unknown" else base_model
                    preprocessing = " \u2192 ".join(variant.preprocessing_names) if variant.preprocessing_names else base_preprocessing

                    pipelines.append(
                        PipelineRunPlanEntry(
                            dataset_id=dataset_id,
                            pipeline_id=pipeline_id,
                            pipeline_run_id=f"{run_id}-{dataset_id}-{pipeline_id}-v{variant.index}",
                            pipeline_name=variant_name,
                            model=model_name,
                            preprocessing=preprocessing,
                            split_strategy=resolved_split_strategy,
                            pipeline_config=pipeline_config,
                            variant_index=variant.index,
                            variant_description=variant.description,
                            variant_choices=variant.choices,
                            is_expanded_variant=True,
                            estimated_variants=1,
                            has_generators=False,
                            fold_count=estimate.fold_count,
                            branch_count=1,
                            total_model_count=estimate.fold_count,
                            model_count_breakdown=f"{estimate.fold_count} folds" if estimate.fold_count > 1 else "1 model",
                        )
                    )
                    total_pipeline_runs += 1
            else:
                pipelines.append(
                    PipelineRunPlanEntry(
                        dataset_id=dataset_id,
                        pipeline_id=pipeline_id,
                        pipeline_run_id=f"{run_id}-{dataset_id}-{pipeline_id}",
                        pipeline_name=pipeline_config.get("name", pipeline_id),
                        model=base_model,
                        preprocessing=base_preprocessing,
                        split_strategy=resolved_split_strategy,
                        pipeline_config=pipeline_config,
                        estimated_variants=estimate.estimated_variants,
                        has_generators=estimate.has_generators,
                        fold_count=estimate.fold_count,
                        branch_count=estimate.branch_count,
                        total_model_count=estimate.total_model_count,
                        model_count_breakdown=estimate.model_count_breakdown,
                    )
                )
                total_pipeline_runs += 1

        datasets.append(
            DatasetRunPlan(
                dataset_id=dataset_id,
                dataset_name=dataset_info.get("name", dataset_id),
                dataset_info=dataset_info,
                split_group_by=split_group_by_by_dataset.get(dataset_id),
                pipelines=tuple(pipelines),
            )
        )

    return RunExecutionPlan(datasets=tuple(datasets), total_pipeline_runs=total_pipeline_runs)


def build_campaign_run_group_execution_plan(
    *,
    run_id: str,
    split_specs: Sequence[Mapping[str, Any]],
    dataset_infos: Mapping[str, Mapping[str, str]],
    pipeline_configs: Mapping[str, dict[str, Any]],
    cv_folds: int | None,
    expand_variants: bool,
    extract_pipeline_info: PipelineInfoExtractor,
    estimate_pipeline_variants: PipelineVariantEstimator,
    expand_pipeline_variants: PipelineVariantExpander,
) -> RunExecutionPlan:
    """Build an explicit campaign run-group plan without cartesian expansion."""
    datasets: list[DatasetRunPlan] = []
    total_pipeline_runs = 0

    for spec_index, split_spec in enumerate(split_specs):
        campaign = split_spec.get("campaign")
        if not isinstance(campaign, Mapping):
            continue
        campaign_datasets = campaign.get("datasets")
        campaign_pipelines = campaign.get("pipelines")
        run_matrix = campaign.get("runMatrix")
        if not isinstance(campaign_datasets, Sequence) or not campaign_datasets:
            continue
        if not isinstance(campaign_pipelines, Sequence) or not campaign_pipelines:
            continue
        if not isinstance(run_matrix, Sequence) or not run_matrix:
            continue

        run_entry = run_matrix[0]
        dataset_ref = campaign_datasets[0]
        pipeline_ref = campaign_pipelines[0]
        if not isinstance(run_entry, Mapping) or not isinstance(dataset_ref, Mapping) or not isinstance(pipeline_ref, Mapping):
            continue

        dataset_id = str(run_entry.get("datasetId") or dataset_ref.get("id") or "")
        pipeline_id = str(run_entry.get("pipelineId") or pipeline_ref.get("id") or "")
        if not dataset_id or not pipeline_id:
            continue

        dataset_info = dataset_infos.get(dataset_id, {"name": str(dataset_ref.get("name") or dataset_id), "id": dataset_id})
        source = pipeline_ref.get("source")
        if source in {"inline", "inline-pruned"}:
            pipeline_config = {
                "name": str(pipeline_ref.get("name") or pipeline_id),
                "steps": deepcopy(pipeline_ref.get("steps") or []),
            }
        else:
            pipeline_config = pipeline_configs.get(pipeline_id, {})
        pipeline_steps = pipeline_config.get("steps", [])
        base_model, base_preprocessing, split_strategy = extract_pipeline_info(pipeline_config)
        resolved_split_strategy = f"KFold({cv_folds})" if split_strategy == "KFold(5)" else split_strategy
        source_run_id = split_spec.get("sourceRunId") or run_entry.get("id") or f"{dataset_id}-{pipeline_id}-{spec_index}"
        split_spec_id = split_spec.get("id") or f"{source_run_id}-{dataset_id}-{pipeline_id}-{spec_index}"
        pipeline_run_id_base = f"{run_id}-{_slugify_plan_id_component(split_spec_id)}"
        split_group_by = run_entry.get("splitGroupBy")
        if split_group_by is None:
            split_group_by = dataset_ref.get("splitGroupBy")
        if split_group_by is not None:
            split_group_by = str(split_group_by)

        estimate = estimate_pipeline_variants(pipeline_config, cv_folds=cv_folds)
        pipelines: list[PipelineRunPlanEntry] = []

        if expand_variants and estimate.has_generators and estimate.estimated_variants > 1:
            variants = expand_pipeline_variants(pipeline_steps)

            for variant in variants:
                variant_name = f"{pipeline_config.get('name', pipeline_id)}"
                if variant.description:
                    variant_name = f"{variant_name} [{variant.description}]"

                model_name = variant.model_name if variant.model_name != "Unknown" else base_model
                preprocessing = " \u2192 ".join(variant.preprocessing_names) if variant.preprocessing_names else base_preprocessing
                pipelines.append(
                    PipelineRunPlanEntry(
                        dataset_id=dataset_id,
                        pipeline_id=pipeline_id,
                        pipeline_run_id=f"{pipeline_run_id_base}-v{variant.index}",
                        pipeline_name=variant_name,
                        model=model_name,
                        preprocessing=preprocessing,
                        split_strategy=resolved_split_strategy,
                        pipeline_config=pipeline_config,
                        variant_index=variant.index,
                        variant_description=variant.description,
                        variant_choices=variant.choices,
                        is_expanded_variant=True,
                        estimated_variants=1,
                        has_generators=False,
                        fold_count=estimate.fold_count,
                        branch_count=1,
                        total_model_count=estimate.fold_count,
                        model_count_breakdown=f"{estimate.fold_count} folds" if estimate.fold_count > 1 else "1 model",
                    )
                )
                total_pipeline_runs += 1
        else:
            pipelines.append(
                PipelineRunPlanEntry(
                    dataset_id=dataset_id,
                    pipeline_id=pipeline_id,
                    pipeline_run_id=pipeline_run_id_base,
                    pipeline_name=pipeline_config.get("name", pipeline_id),
                    model=base_model,
                    preprocessing=base_preprocessing,
                    split_strategy=resolved_split_strategy,
                    pipeline_config=pipeline_config,
                    estimated_variants=estimate.estimated_variants,
                    has_generators=estimate.has_generators,
                    fold_count=estimate.fold_count,
                    branch_count=estimate.branch_count,
                    total_model_count=estimate.total_model_count,
                    model_count_breakdown=estimate.model_count_breakdown,
                )
            )
            total_pipeline_runs += 1

        datasets.append(
            DatasetRunPlan(
                dataset_id=dataset_id,
                dataset_name=dataset_info.get("name", dataset_id),
                dataset_info=dataset_info,
                split_group_by=split_group_by,
                pipelines=tuple(pipelines),
            )
        )

    return RunExecutionPlan(datasets=tuple(datasets), total_pipeline_runs=total_pipeline_runs)


def build_retry_run_execution_plan(
    old_run: RetryRunSource,
    *,
    new_run_id: str,
    created_at: str,
) -> RetryRunExecutionPlan:
    """Build the retried-run plan without creating pydantic route models."""
    datasets: list[RetryDatasetRunPlan] = []

    for dataset in old_run.datasets:
        pipelines: list[RetryPipelineRunPlanEntry] = []
        for pipeline in dataset.pipelines:
            pipelines.append(
                RetryPipelineRunPlanEntry(
                    pipeline_id=pipeline.pipeline_id,
                    pipeline_run_id=f"{new_run_id}-{pipeline.pipeline_id}",
                    pipeline_name=pipeline.pipeline_name,
                    model=pipeline.model,
                    preprocessing=pipeline.preprocessing,
                    split_strategy=pipeline.split_strategy,
                    pipeline_config=getattr(pipeline, "config", None),
                    variant_index=getattr(pipeline, "variant_index", None),
                    variant_description=getattr(pipeline, "variant_description", None),
                    variant_choices=getattr(pipeline, "variant_choices", None),
                    is_expanded_variant=getattr(pipeline, "is_expanded_variant", False),
                    estimated_variants=getattr(pipeline, "estimated_variants", 1),
                    has_generators=getattr(pipeline, "has_generators", False),
                    fold_count=getattr(pipeline, "fold_count", None),
                    branch_count=getattr(pipeline, "branch_count", None),
                    total_model_count=getattr(pipeline, "total_model_count", None),
                    model_count_breakdown=getattr(pipeline, "model_count_breakdown", None),
                )
            )

        datasets.append(
            RetryDatasetRunPlan(
                dataset_id=dataset.dataset_id,
                dataset_name=dataset.dataset_name,
                split_group_by=dataset.split_group_by,
                pipelines=tuple(pipelines),
            )
        )

    return RetryRunExecutionPlan(
        run_id=new_run_id,
        name=f"{old_run.name} (retry)",
        description=old_run.description,
        execution_backend=old_run.execution_backend,
        datasets=tuple(datasets),
        status="queued",
        created_at=created_at,
        cv_folds=old_run.cv_folds,
        total_pipelines=old_run.total_pipelines,
        completed_pipelines=0,
        workspace_path=old_run.workspace_path,
        project_id=old_run.project_id,
    )

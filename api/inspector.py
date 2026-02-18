"""Inspector API endpoints — Prediction Explorer & Model Performance Analyzer.

Phases 1–5 endpoints:
- /inspector/data — Load chain summaries with metadata for sidebar/grouping
- /inspector/scatter — Get y_true/y_pred arrays for scatter visualization
- /inspector/histogram — Score distribution histogram bins
- /inspector/rankings — Sorted chain summaries with ranking
- /inspector/heatmap — Performance heatmap (score at intersection of 2 variables)
- /inspector/candlestick — Box-plot statistics per category
- /inspector/branch-comparison — Branch comparison with CI (Phase 3)
- /inspector/branch-topology — Pipeline topology DAG (Phase 3)
- /inspector/fold-stability — Per-fold score stability (Phase 3)
- /inspector/confusion — Confusion matrix (Phase 4)
- /inspector/robustness — Robustness radar (Phase 4)
- /inspector/correlation — Metric correlation (Phase 4)
- /inspector/preprocessing-impact — Preprocessing step impact analysis (Phase 5)
- /inspector/hyperparameter — Hyperparameter sensitivity scatter (Phase 5)
- /inspector/bias-variance — Bias-variance decomposition (Phase 5)
- /inspector/learning-curve — Learning curve by training size (Phase 5)

All data is read from the workspace's DuckDB store via WorkspaceStore.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from .workspace_manager import workspace_manager

# WorkspaceStore is optional (nirs4all may not be installed)
try:
    from nirs4all.pipeline.storage import WorkspaceStore

    STORE_AVAILABLE = True
except ImportError:
    WorkspaceStore = None  # type: ignore[assignment, misc]
    STORE_AVAILABLE = False


router = APIRouter(prefix="/inspector", tags=["inspector"])


# ============================================================================
# Pydantic models
# ============================================================================


class InspectorChainSummary(BaseModel):
    """Chain summary row for Inspector."""

    chain_id: str
    run_id: str
    pipeline_id: str
    model_class: str
    model_name: Optional[str] = None
    preprocessings: Optional[str] = None
    branch_path: Optional[Any] = None
    source_index: Optional[int] = None
    metric: Optional[str] = None
    task_type: Optional[str] = None
    dataset_name: Optional[str] = None
    best_params: Optional[Any] = None
    cv_val_score: Optional[float] = None
    cv_test_score: Optional[float] = None
    cv_train_score: Optional[float] = None
    cv_fold_count: int = 0
    final_test_score: Optional[float] = None
    final_train_score: Optional[float] = None
    pipeline_status: Optional[str] = None


class InspectorDataResponse(BaseModel):
    """Response for /inspector/data."""

    chains: List[Dict[str, Any]]
    total: int
    available_metrics: List[str]
    available_models: List[str]
    available_datasets: List[str]
    available_runs: List[str]
    generated_at: str


class ScatterRequest(BaseModel):
    """Request body for /inspector/scatter."""

    chain_ids: List[str]
    partition: str = "val"


class ScatterPoint(BaseModel):
    """A single chain's scatter data."""

    chain_id: str
    model_class: str
    model_name: Optional[str] = None
    preprocessings: Optional[str] = None
    y_true: List[float]
    y_pred: List[float]
    sample_indices: Optional[List[int]] = None
    fold_id: Optional[str] = None
    score: Optional[float] = None


class ScatterResponse(BaseModel):
    """Response for /inspector/scatter."""

    points: List[ScatterPoint]
    partition: str
    total_samples: int


class HistogramBin(BaseModel):
    """A single histogram bin."""

    bin_start: float
    bin_end: float
    count: int
    chain_ids: List[str]


class HistogramResponse(BaseModel):
    """Response for /inspector/histogram."""

    bins: List[HistogramBin]
    score_column: str
    total_chains: int
    min_score: Optional[float] = None
    max_score: Optional[float] = None
    mean_score: Optional[float] = None


class RankingRow(BaseModel):
    """A single ranking row."""

    rank: int
    chain_id: str
    model_class: str
    model_name: Optional[str] = None
    preprocessings: Optional[str] = None
    cv_val_score: Optional[float] = None
    cv_test_score: Optional[float] = None
    cv_train_score: Optional[float] = None
    final_test_score: Optional[float] = None
    final_train_score: Optional[float] = None
    cv_fold_count: int = 0
    dataset_name: Optional[str] = None
    best_params: Optional[Any] = None


class RankingsResponse(BaseModel):
    """Response for /inspector/rankings."""

    rankings: List[Dict[str, Any]]
    total: int
    score_column: str
    sort_ascending: bool


# ============================================================================
# Phase 2: Heatmap models
# ============================================================================


class HeatmapRequest(BaseModel):
    """Request body for /inspector/heatmap."""

    run_id: Optional[str] = None
    dataset_name: Optional[str] = None
    x_variable: str = "model_class"
    y_variable: str = "preprocessings"
    score_column: str = "cv_val_score"
    aggregate: str = "best"


class HeatmapCell(BaseModel):
    """A single heatmap cell."""

    x_label: str
    y_label: str
    value: Optional[float] = None
    count: int
    chain_ids: List[str]


class HeatmapResponse(BaseModel):
    """Response for /inspector/heatmap."""

    cells: List[Dict[str, Any]]
    x_labels: List[str]
    y_labels: List[str]
    x_variable: str
    y_variable: str
    score_column: str
    min_value: Optional[float] = None
    max_value: Optional[float] = None


# ============================================================================
# Phase 2: Candlestick / box-plot models
# ============================================================================


class CandlestickRequest(BaseModel):
    """Request body for /inspector/candlestick."""

    run_id: Optional[str] = None
    dataset_name: Optional[str] = None
    category_variable: str = "model_class"
    score_column: str = "cv_val_score"


class CandlestickCategory(BaseModel):
    """Box-plot statistics for a single category."""

    label: str
    min: float
    q25: float
    median: float
    q75: float
    max: float
    mean: float
    count: int
    outlier_values: List[float]
    chain_ids: List[str]


class CandlestickResponse(BaseModel):
    """Response for /inspector/candlestick."""

    categories: List[Dict[str, Any]]
    category_variable: str
    score_column: str


# ============================================================================
# Helpers
# ============================================================================


def _sanitize_float(value: Any) -> Any:
    """Convert NaN / Inf to None for JSON serialization."""
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    return value


def _sanitize_dict(d: dict) -> dict:
    """Recursively sanitize float values."""
    out = {}
    for k, v in d.items():
        if isinstance(v, dict):
            out[k] = _sanitize_dict(v)
        elif isinstance(v, (float, int)):
            out[k] = _sanitize_float(v)
        elif isinstance(v, list):
            out[k] = [
                _sanitize_dict(item)
                if isinstance(item, dict)
                else _sanitize_float(item)
                if isinstance(item, (float, int))
                else item
                for item in v
            ]
        else:
            out[k] = v
    return out


def _get_store() -> "WorkspaceStore":
    """Get a WorkspaceStore for the current workspace."""
    if not STORE_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="nirs4all library is required for DuckDB store access",
        )

    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    workspace_path = Path(workspace.path)
    db_path = workspace_path / "store.duckdb"
    if not db_path.exists():
        raise HTTPException(
            status_code=404,
            detail="No DuckDB store found in workspace. Run a pipeline first.",
        )

    return WorkspaceStore(workspace_path)


_LOWER_BETTER_METRICS = {"rmse", "mse", "mae", "rmsecv", "rmsep", "secv", "sep", "bias"}


def _is_lower_better(metric: Optional[str]) -> bool:
    """Auto-detect if lower score is better for this metric."""
    if not metric:
        return True
    return metric.lower().replace("_", "").replace("-", "") in _LOWER_BETTER_METRICS


# ============================================================================
# Endpoints
# ============================================================================


@router.get("/data")
async def get_inspector_data(
    run_id: Optional[str] = Query(None, description="Filter by run ID"),
    dataset_name: Optional[str] = Query(None, description="Filter by dataset name"),
    model_class: Optional[str] = Query(None, description="Filter by model class"),
):
    """Load chain summaries and metadata for the Inspector.

    Returns all matching chains plus lists of unique values for
    populating sidebar dropdowns (metrics, models, datasets, runs).
    """
    store = _get_store()
    try:
        df = store.query_chain_summaries(
            run_id=run_id,
            dataset_name=dataset_name,
            model_class=model_class,
        )
        records = [_sanitize_dict(dict(row)) for row in df.iter_rows(named=True)]

        # Extract unique values for sidebar dropdowns
        metrics = sorted({r.get("metric") for r in records if r.get("metric")})
        models = sorted({r.get("model_class") for r in records if r.get("model_class")})
        datasets = sorted({r.get("dataset_name") for r in records if r.get("dataset_name")})
        runs = sorted({r.get("run_id") for r in records if r.get("run_id")})

        return InspectorDataResponse(
            chains=records,
            total=len(records),
            available_metrics=metrics,
            available_models=models,
            available_datasets=datasets,
            available_runs=runs,
            generated_at=datetime.now(timezone.utc).isoformat(),
        )
    finally:
        store.close()


@router.post("/scatter")
async def get_scatter_data(request: ScatterRequest):
    """Get y_true/y_pred arrays for scatter visualization.

    For each chain_id, loads the fold-level predictions matching the
    requested partition and concatenates the arrays.
    """
    if not request.chain_ids:
        return ScatterResponse(points=[], partition=request.partition, total_samples=0)

    store = _get_store()
    try:
        points: list[dict] = []
        total_samples = 0

        for chain_id in request.chain_ids:
            pred_df = store.get_chain_predictions(
                chain_id=chain_id,
                partition=request.partition,
            )
            if len(pred_df) == 0:
                continue

            # Get chain metadata from first prediction
            first_row = dict(pred_df.row(0, named=True))

            # Collect arrays across all folds for this partition
            all_y_true: list[float] = []
            all_y_pred: list[float] = []
            all_indices: list[int] = []
            score = _sanitize_float(first_row.get("val_score") if request.partition == "val" else first_row.get("test_score"))

            for row in pred_df.iter_rows(named=True):
                row_dict = dict(row)
                prediction_id = row_dict.get("prediction_id")
                if not prediction_id:
                    continue

                arrays = store.get_prediction_arrays(prediction_id)
                if arrays is None:
                    continue

                y_true = arrays.get("y_true")
                y_pred = arrays.get("y_pred")
                if y_true is not None and isinstance(y_true, np.ndarray):
                    all_y_true.extend(y_true.tolist())
                if y_pred is not None and isinstance(y_pred, np.ndarray):
                    all_y_pred.extend(y_pred.tolist())

                sample_indices = arrays.get("sample_indices")
                if sample_indices is not None and isinstance(sample_indices, np.ndarray):
                    all_indices.extend(sample_indices.tolist())

            if all_y_true and all_y_pred:
                total_samples += len(all_y_true)
                points.append(ScatterPoint(
                    chain_id=chain_id,
                    model_class=first_row.get("model_class", ""),
                    model_name=first_row.get("model_name"),
                    preprocessings=first_row.get("preprocessings"),
                    y_true=all_y_true,
                    y_pred=all_y_pred,
                    sample_indices=all_indices if all_indices else None,
                    fold_id=None,
                    score=score,
                ).model_dump())

        return ScatterResponse(
            points=points,
            partition=request.partition,
            total_samples=total_samples,
        )
    finally:
        store.close()


@router.get("/histogram")
async def get_histogram_data(
    run_id: Optional[str] = Query(None),
    dataset_name: Optional[str] = Query(None),
    score_column: str = Query("cv_val_score", description="Score column for histogram"),
    n_bins: int = Query(20, ge=5, le=100, description="Number of bins"),
):
    """Score distribution histogram.

    Computes histogram bins from chain summary scores and includes
    chain_ids per bin for click-to-select functionality.
    """
    store = _get_store()
    try:
        df = store.query_chain_summaries(
            run_id=run_id,
            dataset_name=dataset_name,
        )
        records = [_sanitize_dict(dict(row)) for row in df.iter_rows(named=True)]

        # Extract scores and chain_ids
        scores: list[float] = []
        chain_ids_for_scores: list[str] = []
        for r in records:
            val = r.get(score_column)
            if val is not None and isinstance(val, (int, float)):
                scores.append(float(val))
                chain_ids_for_scores.append(r["chain_id"])

        if not scores:
            return HistogramResponse(
                bins=[],
                score_column=score_column,
                total_chains=0,
            )

        scores_arr = np.array(scores)
        counts, bin_edges = np.histogram(scores_arr, bins=n_bins)

        # Build bins with chain_ids
        bins: list[dict] = []
        for i in range(len(counts)):
            bin_start = float(bin_edges[i])
            bin_end = float(bin_edges[i + 1])
            # Find chain_ids in this bin
            bin_chain_ids = [
                cid
                for cid, s in zip(chain_ids_for_scores, scores)
                if bin_start <= s < bin_end or (i == len(counts) - 1 and s == bin_end)
            ]
            bins.append(HistogramBin(
                bin_start=round(bin_start, 6),
                bin_end=round(bin_end, 6),
                count=int(counts[i]),
                chain_ids=bin_chain_ids,
            ).model_dump())

        return HistogramResponse(
            bins=bins,
            score_column=score_column,
            total_chains=len(scores),
            min_score=round(float(scores_arr.min()), 6),
            max_score=round(float(scores_arr.max()), 6),
            mean_score=round(float(scores_arr.mean()), 6),
        )
    finally:
        store.close()


@router.get("/rankings")
async def get_rankings_data(
    run_id: Optional[str] = Query(None),
    dataset_name: Optional[str] = Query(None),
    score_column: str = Query("cv_val_score", description="Score column to sort by"),
    sort_ascending: Optional[bool] = Query(None, description="Sort direction (auto-detected if None)"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """Ranked chain summaries.

    Returns chains sorted by the chosen score column, with rank numbers.
    Sort direction is auto-detected from the metric (lower-better for RMSE, etc.).
    """
    store = _get_store()
    try:
        df = store.query_chain_summaries(
            run_id=run_id,
            dataset_name=dataset_name,
        )
        records = [_sanitize_dict(dict(row)) for row in df.iter_rows(named=True)]

        # Auto-detect sort direction from metric if not specified
        if sort_ascending is None:
            # Check the first chain's metric to determine direction
            first_metric = next((r.get("metric") for r in records if r.get("metric")), None)
            sort_ascending = _is_lower_better(first_metric)

        # Sort by score column
        def sort_key(r: dict) -> float:
            val = r.get(score_column)
            if val is None:
                return float("inf") if sort_ascending else float("-inf")
            return float(val)

        records.sort(key=sort_key, reverse=not sort_ascending)

        # Apply offset/limit and add rank
        total = len(records)
        records = records[offset:offset + limit]

        rankings: list[dict] = []
        for i, r in enumerate(records):
            rankings.append({
                "rank": offset + i + 1,
                "chain_id": r.get("chain_id", ""),
                "model_class": r.get("model_class", ""),
                "model_name": r.get("model_name"),
                "preprocessings": r.get("preprocessings"),
                "cv_val_score": r.get("cv_val_score"),
                "cv_test_score": r.get("cv_test_score"),
                "cv_train_score": r.get("cv_train_score"),
                "final_test_score": r.get("final_test_score"),
                "final_train_score": r.get("final_train_score"),
                "cv_fold_count": r.get("cv_fold_count", 0),
                "dataset_name": r.get("dataset_name"),
                "best_params": r.get("best_params"),
            })

        return RankingsResponse(
            rankings=rankings,
            total=total,
            score_column=score_column,
            sort_ascending=sort_ascending,
        )
    finally:
        store.close()


# ============================================================================
# Phase 2: Heatmap & Candlestick endpoints
# ============================================================================


@router.post("/heatmap")
async def get_heatmap_data(request: HeatmapRequest):
    """Performance heatmap: aggregated score at intersection of two variables.

    Groups chains by (x_variable, y_variable) and aggregates score_column
    using the requested aggregation method (best/mean/median/worst).
    """
    store = _get_store()
    try:
        df = store.query_chain_summaries(
            run_id=request.run_id,
            dataset_name=request.dataset_name,
        )
        records = [_sanitize_dict(dict(row)) for row in df.iter_rows(named=True)]

        # Group by (x_variable, y_variable)
        grid: dict[tuple[str, str], list[dict]] = {}
        for r in records:
            x_val = str(r.get(request.x_variable) or "(empty)")
            y_val = str(r.get(request.y_variable) or "(empty)")
            grid.setdefault((x_val, y_val), []).append(r)

        cells: list[dict] = []
        all_values: list[float] = []
        x_labels_set: set[str] = set()
        y_labels_set: set[str] = set()

        for (x_label, y_label), chains_in_cell in grid.items():
            x_labels_set.add(x_label)
            y_labels_set.add(y_label)

            scores = [
                float(c[request.score_column])
                for c in chains_in_cell
                if c.get(request.score_column) is not None
            ]
            chain_ids = [c["chain_id"] for c in chains_in_cell]

            if scores:
                first_metric = next(
                    (c.get("metric") for c in chains_in_cell if c.get("metric")),
                    None,
                )
                lower_better = _is_lower_better(first_metric)

                if request.aggregate == "best":
                    value = min(scores) if lower_better else max(scores)
                elif request.aggregate == "worst":
                    value = max(scores) if lower_better else min(scores)
                elif request.aggregate == "median":
                    value = float(np.median(scores))
                else:
                    value = float(np.mean(scores))

                all_values.append(value)
            else:
                value = None

            cells.append(
                HeatmapCell(
                    x_label=x_label,
                    y_label=y_label,
                    value=round(value, 6) if value is not None else None,
                    count=len(chains_in_cell),
                    chain_ids=chain_ids,
                ).model_dump()
            )

        return HeatmapResponse(
            cells=cells,
            x_labels=sorted(x_labels_set),
            y_labels=sorted(y_labels_set),
            x_variable=request.x_variable,
            y_variable=request.y_variable,
            score_column=request.score_column,
            min_value=round(min(all_values), 6) if all_values else None,
            max_value=round(max(all_values), 6) if all_values else None,
        )
    finally:
        store.close()


@router.post("/candlestick")
async def get_candlestick_data(request: CandlestickRequest):
    """Box-plot statistics per category.

    Groups chains by category_variable and computes min, Q25, median,
    Q75, max, mean, and IQR-based outliers for the chosen score column.
    """
    store = _get_store()
    try:
        df = store.query_chain_summaries(
            run_id=request.run_id,
            dataset_name=request.dataset_name,
        )
        records = [_sanitize_dict(dict(row)) for row in df.iter_rows(named=True)]

        # Group by category_variable
        buckets: dict[str, list[dict]] = {}
        for r in records:
            label = str(r.get(request.category_variable) or "(empty)")
            buckets.setdefault(label, []).append(r)

        categories: list[dict] = []
        for label, chains_in_cat in buckets.items():
            scores = [
                float(c[request.score_column])
                for c in chains_in_cat
                if c.get(request.score_column) is not None
            ]
            chain_ids = [c["chain_id"] for c in chains_in_cat]

            if not scores:
                continue

            arr = np.array(scores)
            q25 = float(np.percentile(arr, 25))
            q75 = float(np.percentile(arr, 75))
            iqr = q75 - q25
            lower_fence = q25 - 1.5 * iqr
            upper_fence = q75 + 1.5 * iqr

            outlier_values = [float(s) for s in scores if s < lower_fence or s > upper_fence]

            categories.append(
                CandlestickCategory(
                    label=label,
                    min=round(float(arr.min()), 6),
                    q25=round(q25, 6),
                    median=round(float(np.median(arr)), 6),
                    q75=round(q75, 6),
                    max=round(float(arr.max()), 6),
                    mean=round(float(arr.mean()), 6),
                    count=len(scores),
                    outlier_values=[round(v, 6) for v in outlier_values],
                    chain_ids=chain_ids,
                ).model_dump()
            )

        # Sort by median descending
        categories.sort(key=lambda c: c.get("median", 0), reverse=True)

        return CandlestickResponse(
            categories=categories,
            category_variable=request.category_variable,
            score_column=request.score_column,
        )
    finally:
        store.close()


# ============================================================================
# Phase 3: Branch Comparison, Branch Topology, Fold Stability
# ============================================================================


class BranchComparisonRequest(BaseModel):
    """Request body for /inspector/branch-comparison."""

    run_id: Optional[str] = None
    dataset_name: Optional[str] = None
    score_column: str = "cv_val_score"


class BranchComparisonEntry(BaseModel):
    """A single branch comparison entry."""

    branch_path: str
    label: str
    mean: float
    std: float
    min: float
    max: float
    ci_lower: float
    ci_upper: float
    count: int
    chain_ids: List[str]


class BranchComparisonResponse(BaseModel):
    """Response for /inspector/branch-comparison."""

    branches: List[Dict[str, Any]]
    score_column: str
    total_chains: int


class TopologyNode(BaseModel):
    """A single node in the pipeline topology DAG."""

    id: str
    label: str
    type: str
    depth: int
    branch_path: List[int]
    metrics: Optional[Dict[str, Any]] = None
    children: Optional[List[Dict[str, Any]]] = None
    chain_ids: Optional[List[str]] = None


class BranchTopologyResponse(BaseModel):
    """Response for /inspector/branch-topology."""

    nodes: List[Dict[str, Any]]
    pipeline_id: str
    pipeline_name: str
    has_stacking: bool
    has_branches: bool
    max_depth: int


class FoldScoreEntry(BaseModel):
    """A single fold score entry."""

    chain_id: str
    model_class: str
    preprocessings: Optional[str] = None
    fold_id: str
    fold_index: int
    score: float


class FoldStabilityRequest(BaseModel):
    """Request body for /inspector/fold-stability."""

    chain_ids: List[str]
    score_column: str = "cv_val_score"
    partition: str = "val"


class FoldStabilityResponse(BaseModel):
    """Response for /inspector/fold-stability."""

    entries: List[Dict[str, Any]]
    fold_ids: List[str]
    score_column: str
    total_chains: int


def _stringify_branch_path(branch_path: Any) -> str:
    """Convert a branch_path to a human-readable string for grouping."""
    if branch_path is None:
        return "(no branch)"
    if isinstance(branch_path, (list, tuple)):
        if len(branch_path) == 0:
            return "(no branch)"
        return " > ".join(str(p) for p in branch_path)
    return str(branch_path)


@router.post("/branch-comparison")
async def get_branch_comparison(request: BranchComparisonRequest):
    """Branch comparison: mean score with CI per branch.

    Groups chains by branch_path and computes descriptive statistics
    including 95% confidence intervals for each branch.
    """
    store = _get_store()
    try:
        df = store.query_chain_summaries(
            run_id=request.run_id,
            dataset_name=request.dataset_name,
        )
        records = [_sanitize_dict(dict(row)) for row in df.iter_rows(named=True)]

        # Group by branch_path
        buckets: dict[str, list[dict]] = {}
        for r in records:
            key = _stringify_branch_path(r.get("branch_path"))
            buckets.setdefault(key, []).append(r)

        branches: list[dict] = []
        total_chains = 0

        for branch_label, chains_in_branch in buckets.items():
            scores = [
                float(c[request.score_column])
                for c in chains_in_branch
                if c.get(request.score_column) is not None
            ]
            chain_ids = [c["chain_id"] for c in chains_in_branch]

            if not scores:
                continue

            arr = np.array(scores)
            count = len(scores)
            mean_val = float(arr.mean())
            std_val = float(arr.std(ddof=1)) if count > 1 else 0.0
            # 95% CI: mean ± 1.96 * std / sqrt(n)
            ci_half = 1.96 * std_val / math.sqrt(count) if count > 1 else 0.0

            total_chains += count
            branches.append(
                BranchComparisonEntry(
                    branch_path=branch_label,
                    label=branch_label,
                    mean=round(mean_val, 6),
                    std=round(std_val, 6),
                    min=round(float(arr.min()), 6),
                    max=round(float(arr.max()), 6),
                    ci_lower=round(mean_val - ci_half, 6),
                    ci_upper=round(mean_val + ci_half, 6),
                    count=count,
                    chain_ids=chain_ids,
                ).model_dump()
            )

        # Sort by mean (ascending if lower-better)
        first_metric = next(
            (r.get("metric") for r in records if r.get("metric")), None
        )
        lower_better = _is_lower_better(first_metric)
        branches.sort(key=lambda b: b.get("mean", 0), reverse=not lower_better)

        return BranchComparisonResponse(
            branches=branches,
            score_column=request.score_column,
            total_chains=total_chains,
        )
    finally:
        store.close()


@router.get("/branch-topology")
async def get_branch_topology(
    pipeline_id: str = Query(..., description="Pipeline ID to analyze"),
    score_column: str = Query("cv_val_score", description="Score column for metrics"),
):
    """Pipeline topology: DAG structure with metrics overlay.

    Uses nirs4all.pipeline.analysis.topology.analyze_topology() to parse
    the expanded pipeline config into a tree of nodes.
    """
    store = _get_store()
    try:
        pipeline = store.get_pipeline(pipeline_id)
        if not pipeline:
            raise HTTPException(status_code=404, detail=f"Pipeline {pipeline_id} not found")

        expanded_config = pipeline.get("expanded_config")
        pipeline_name = pipeline.get("name") or pipeline_id

        # Try to use nirs4all topology analysis
        has_branches = False
        has_stacking = False
        max_depth = 0
        nodes: list[dict] = []

        if expanded_config and isinstance(expanded_config, list):
            try:
                from nirs4all.pipeline.analysis.topology import analyze_topology

                topology = analyze_topology(expanded_config)
                has_branches = len(topology.model_nodes) > 1
                has_stacking = topology.has_stacking
                max_depth = topology.max_stacking_depth

                # Get chain summaries for metrics lookup
                df = store.query_chain_summaries(pipeline_id=pipeline_id)
                chain_records = [_sanitize_dict(dict(row)) for row in df.iter_rows(named=True)]

                # Build flat node list from model_nodes
                for i, mn in enumerate(topology.model_nodes):
                    bp = list(mn.branch_path) if mn.branch_path else []
                    bp_str = _stringify_branch_path(bp)

                    # Find chains matching this branch path
                    matching_chains = [
                        c for c in chain_records
                        if _stringify_branch_path(c.get("branch_path")) == bp_str
                    ]
                    matching_scores = [
                        float(c[score_column])
                        for c in matching_chains
                        if c.get(score_column) is not None
                    ]
                    mean_score = round(float(np.mean(matching_scores)), 6) if matching_scores else None

                    nodes.append(
                        TopologyNode(
                            id=f"model_{i}",
                            label=mn.model_class,
                            type="model",
                            depth=mn.branch_depth,
                            branch_path=bp,
                            metrics={
                                "mean_score": mean_score,
                                "chain_count": len(matching_chains),
                            },
                            chain_ids=[c["chain_id"] for c in matching_chains],
                        ).model_dump()
                    )
            except ImportError:
                # nirs4all topology analysis not available, build minimal nodes
                pass

        # Fallback: if no topology analysis, build minimal from chain summaries
        if not nodes:
            df = store.query_chain_summaries(pipeline_id=pipeline_id)
            chain_records = [_sanitize_dict(dict(row)) for row in df.iter_rows(named=True)]

            # Group by model_class to create simple nodes
            model_groups: dict[str, list[dict]] = {}
            for r in chain_records:
                mc = r.get("model_class", "unknown")
                model_groups.setdefault(mc, []).append(r)

            for i, (mc, chains_for_model) in enumerate(model_groups.items()):
                scores = [
                    float(c[score_column])
                    for c in chains_for_model
                    if c.get(score_column) is not None
                ]
                nodes.append(
                    TopologyNode(
                        id=f"model_{i}",
                        label=mc,
                        type="model",
                        depth=0,
                        branch_path=[],
                        metrics={
                            "mean_score": round(float(np.mean(scores)), 6) if scores else None,
                            "chain_count": len(chains_for_model),
                        },
                        chain_ids=[c["chain_id"] for c in chains_for_model],
                    ).model_dump()
                )

        return BranchTopologyResponse(
            nodes=nodes,
            pipeline_id=pipeline_id,
            pipeline_name=pipeline_name,
            has_stacking=has_stacking,
            has_branches=has_branches,
            max_depth=max_depth,
        )
    finally:
        store.close()


@router.post("/fold-stability")
async def get_fold_stability(request: FoldStabilityRequest):
    """Per-fold score stability for selected chains.

    For each chain, retrieves fold-level predictions and extracts
    the score for the requested partition.
    """
    if not request.chain_ids:
        return FoldStabilityResponse(
            entries=[], fold_ids=[], score_column=request.score_column, total_chains=0
        )

    store = _get_store()
    try:
        entries: list[dict] = []
        all_fold_ids: set[str] = set()

        # Map partition to score field
        score_field_map = {
            "val": "val_score",
            "test": "test_score",
            "train": "train_score",
        }
        score_field = score_field_map.get(request.partition, "val_score")

        for chain_id in request.chain_ids:
            pred_df = store.get_chain_predictions(
                chain_id=chain_id,
                partition=request.partition,
            )
            if len(pred_df) == 0:
                continue

            first_row = dict(pred_df.row(0, named=True))
            model_class = first_row.get("model_class", "")
            preprocessings = first_row.get("preprocessings")

            for fold_idx, row in enumerate(pred_df.iter_rows(named=True)):
                row_dict = dict(row)
                fold_id = str(row_dict.get("fold_id", fold_idx))
                score = row_dict.get(score_field)

                if score is None:
                    continue

                score = _sanitize_float(float(score))
                if score is None:
                    continue

                all_fold_ids.add(fold_id)
                entries.append(
                    FoldScoreEntry(
                        chain_id=chain_id,
                        model_class=model_class,
                        preprocessings=preprocessings,
                        fold_id=fold_id,
                        fold_index=fold_idx,
                        score=round(score, 6),
                    ).model_dump()
                )

        # Sort entries by (chain_id, fold_index)
        entries.sort(key=lambda e: (e.get("chain_id", ""), e.get("fold_index", 0)))

        return FoldStabilityResponse(
            entries=entries,
            fold_ids=sorted(all_fold_ids),
            score_column=request.score_column,
            total_chains=len(set(e.get("chain_id") for e in entries)),
        )
    finally:
        store.close()


# ============================================================================
# Phase 4: Confusion Matrix, Robustness Radar, Metric Correlation
# ============================================================================


class ConfusionMatrixRequest(BaseModel):
    """Request body for /inspector/confusion."""

    chain_ids: List[str]
    partition: str = "val"
    normalize: str = "none"  # none, row, column, all


class ConfusionMatrixCell(BaseModel):
    """A single cell in the confusion matrix."""

    true_label: str
    pred_label: str
    count: int
    normalized: Optional[float] = None


class ConfusionMatrixResponse(BaseModel):
    """Response for /inspector/confusion."""

    cells: List[Dict[str, Any]]
    labels: List[str]
    total_samples: int
    partition: str
    normalize: str


class RobustnessRequest(BaseModel):
    """Request body for /inspector/robustness."""

    chain_ids: List[str]
    score_column: str = "cv_val_score"
    partition: str = "val"


class RobustnessAxis(BaseModel):
    """A single robustness dimension."""

    name: str
    label: str
    value: float  # Normalized 0-1 (higher = more robust)
    raw_value: float
    description: str


class RobustnessEntry(BaseModel):
    """Robustness profile for a single chain."""

    chain_id: str
    model_class: str
    preprocessings: Optional[str] = None
    axes: List[Dict[str, Any]]


class RobustnessResponse(BaseModel):
    """Response for /inspector/robustness."""

    entries: List[Dict[str, Any]]
    axis_names: List[str]
    score_column: str


class MetricCorrelationRequest(BaseModel):
    """Request body for /inspector/correlation."""

    run_id: Optional[str] = None
    dataset_name: Optional[str] = None
    metrics: Optional[List[str]] = None
    method: str = "spearman"  # pearson, spearman


class CorrelationCell(BaseModel):
    """A single cell in the correlation matrix."""

    metric_x: str
    metric_y: str
    coefficient: Optional[float] = None
    count: int


class MetricCorrelationResponse(BaseModel):
    """Response for /inspector/correlation."""

    cells: List[Dict[str, Any]]
    metrics: List[str]
    method: str
    total_chains: int


@router.post("/confusion")
async def get_confusion_matrix(request: ConfusionMatrixRequest):
    """Confusion matrix for classification chains.

    Aggregates y_true/y_pred from fold-level predictions across the
    selected chains and computes the confusion matrix with optional
    normalization (by row=recall, column=precision, or all).
    """
    if not request.chain_ids:
        return ConfusionMatrixResponse(
            cells=[], labels=[], total_samples=0,
            partition=request.partition, normalize=request.normalize,
        )

    store = _get_store()
    try:
        all_y_true: list[Any] = []
        all_y_pred: list[Any] = []

        for chain_id in request.chain_ids:
            pred_df = store.get_chain_predictions(
                chain_id=chain_id,
                partition=request.partition,
            )
            if len(pred_df) == 0:
                continue

            for row in pred_df.iter_rows(named=True):
                row_dict = dict(row)
                prediction_id = row_dict.get("prediction_id")
                if not prediction_id:
                    continue

                arrays = store.get_prediction_arrays(prediction_id)
                if arrays is None:
                    continue

                y_true = arrays.get("y_true")
                y_pred = arrays.get("y_pred")
                if y_true is not None and isinstance(y_true, np.ndarray):
                    all_y_true.extend(y_true.tolist())
                if y_pred is not None and isinstance(y_pred, np.ndarray):
                    all_y_pred.extend(y_pred.tolist())

        if not all_y_true or not all_y_pred:
            return ConfusionMatrixResponse(
                cells=[], labels=[], total_samples=0,
                partition=request.partition, normalize=request.normalize,
            )

        # Convert to strings for classification labels
        y_true_labels = [str(v) for v in all_y_true]
        y_pred_labels = [str(v) for v in all_y_pred]

        # Get unique sorted labels
        labels = sorted(set(y_true_labels) | set(y_pred_labels))

        # Build raw counts matrix
        counts: dict[tuple[str, str], int] = {}
        for yt, yp in zip(y_true_labels, y_pred_labels):
            counts[(yt, yp)] = counts.get((yt, yp), 0) + 1

        total_samples = len(y_true_labels)

        # Compute row/column sums for normalization
        row_sums: dict[str, int] = {}
        col_sums: dict[str, int] = {}
        for tl in labels:
            row_sums[tl] = sum(counts.get((tl, pl), 0) for pl in labels)
            col_sums[tl] = sum(counts.get((tl2, tl), 0) for tl2 in labels)

        # Build cells
        cells: list[dict] = []
        for tl in labels:
            for pl in labels:
                count = counts.get((tl, pl), 0)

                normalized: float | None = None
                if request.normalize == "row" and row_sums[tl] > 0:
                    normalized = round(count / row_sums[tl], 4)
                elif request.normalize == "column" and col_sums[pl] > 0:
                    normalized = round(count / col_sums[pl], 4)
                elif request.normalize == "all" and total_samples > 0:
                    normalized = round(count / total_samples, 4)

                cells.append(ConfusionMatrixCell(
                    true_label=tl,
                    pred_label=pl,
                    count=count,
                    normalized=normalized,
                ).model_dump())

        return ConfusionMatrixResponse(
            cells=cells,
            labels=labels,
            total_samples=total_samples,
            partition=request.partition,
            normalize=request.normalize,
        )
    finally:
        store.close()


@router.post("/robustness")
async def get_robustness_data(request: RobustnessRequest):
    """Multi-dimensional robustness profile per chain.

    Computes normalized axes for each chain:
    - cv_stability: 1 - normalized std of fold scores (lower std = better)
    - train_test_gap: 1 - normalized |train_score - val_score| gap
    - score_absolute: normalized absolute score
    - fold_count_ratio: ratio of actual folds vs max folds

    Each axis is normalized 0–1 across all requested chains (higher = more robust).
    """
    if not request.chain_ids:
        return RobustnessResponse(
            entries=[], axis_names=[], score_column=request.score_column,
        )

    store = _get_store()
    try:
        # Get chain summaries
        df = store.query_chain_summaries()
        all_records = [_sanitize_dict(dict(row)) for row in df.iter_rows(named=True)]
        chain_map = {r["chain_id"]: r for r in all_records}

        # Score field mapping
        score_field_map = {
            "val": "val_score",
            "test": "test_score",
            "train": "train_score",
        }
        score_field = score_field_map.get(request.partition, "val_score")

        # Collect per-chain raw values
        raw_data: list[dict] = []

        for chain_id in request.chain_ids:
            chain = chain_map.get(chain_id)
            if not chain:
                continue

            # Get fold-level scores for CV stability
            pred_df = store.get_chain_predictions(
                chain_id=chain_id,
                partition=request.partition,
            )
            fold_scores: list[float] = []
            if len(pred_df) > 0:
                for row in pred_df.iter_rows(named=True):
                    row_dict = dict(row)
                    score = row_dict.get(score_field)
                    if score is not None:
                        s = _sanitize_float(float(score))
                        if s is not None:
                            fold_scores.append(s)

            val_score = chain.get("cv_val_score")
            train_score = chain.get("cv_train_score")
            main_score = chain.get(request.score_column)

            # CV stability: std of fold scores (lower = more stable)
            cv_std = float(np.std(fold_scores, ddof=1)) if len(fold_scores) > 1 else 0.0

            # Train-test gap
            gap = abs(train_score - val_score) if train_score is not None and val_score is not None else 0.0

            # Absolute score
            abs_score = float(main_score) if main_score is not None else 0.0

            # Fold count ratio
            fold_count = chain.get("cv_fold_count", 0)

            raw_data.append({
                "chain_id": chain_id,
                "model_class": chain.get("model_class", ""),
                "preprocessings": chain.get("preprocessings"),
                "cv_std": cv_std,
                "gap": gap,
                "abs_score": abs_score,
                "fold_count": fold_count,
            })

        if not raw_data:
            return RobustnessResponse(
                entries=[], axis_names=[], score_column=request.score_column,
            )

        # Compute normalization ranges
        all_stds = [d["cv_std"] for d in raw_data]
        all_gaps = [d["gap"] for d in raw_data]
        all_scores = [d["abs_score"] for d in raw_data]
        all_folds = [d["fold_count"] for d in raw_data]

        max_std = max(all_stds) if all_stds else 1.0
        max_gap = max(all_gaps) if all_gaps else 1.0
        max_folds = max(all_folds) if all_folds else 1

        lower_better = _is_lower_better(
            next((chain_map[d["chain_id"]].get("metric") for d in raw_data if d["chain_id"] in chain_map), None)
        )

        # Score normalization
        score_min = min(all_scores) if all_scores else 0
        score_max = max(all_scores) if all_scores else 1
        score_range = score_max - score_min if score_max != score_min else 1.0

        axis_names = ["cv_stability", "train_test_gap", "score_absolute", "fold_count_ratio"]

        entries: list[dict] = []
        for d in raw_data:
            # cv_stability: 1 - std/max_std (higher = more stable)
            cv_stability = 1.0 - (d["cv_std"] / max_std if max_std > 0 else 0.0)

            # train_test_gap: 1 - gap/max_gap (higher = smaller gap)
            train_test_gap = 1.0 - (d["gap"] / max_gap if max_gap > 0 else 0.0)

            # score_absolute: normalize to 0-1, flip if lower-better
            norm_score = (d["abs_score"] - score_min) / score_range
            if lower_better:
                norm_score = 1.0 - norm_score

            # fold_count_ratio
            fold_ratio = d["fold_count"] / max_folds if max_folds > 0 else 0.0

            axes = [
                RobustnessAxis(
                    name="cv_stability", label="CV Stability",
                    value=round(cv_stability, 4), raw_value=round(d["cv_std"], 6),
                    description="Cross-validation stability (1 - normalized std)",
                ).model_dump(),
                RobustnessAxis(
                    name="train_test_gap", label="Train-Test Gap",
                    value=round(train_test_gap, 4), raw_value=round(d["gap"], 6),
                    description="Small train-val gap (1 - normalized gap)",
                ).model_dump(),
                RobustnessAxis(
                    name="score_absolute", label="Score",
                    value=round(norm_score, 4), raw_value=round(d["abs_score"], 6),
                    description="Normalized absolute performance score",
                ).model_dump(),
                RobustnessAxis(
                    name="fold_count_ratio", label="Fold Coverage",
                    value=round(fold_ratio, 4), raw_value=float(d["fold_count"]),
                    description="Proportion of folds with results",
                ).model_dump(),
            ]

            entries.append(RobustnessEntry(
                chain_id=d["chain_id"],
                model_class=d["model_class"],
                preprocessings=d["preprocessings"],
                axes=axes,
            ).model_dump())

        return RobustnessResponse(
            entries=entries,
            axis_names=axis_names,
            score_column=request.score_column,
        )
    finally:
        store.close()


@router.post("/correlation")
async def get_metric_correlation(request: MetricCorrelationRequest):
    """Correlation matrix between score metrics.

    Computes Pearson or Spearman correlation between all available
    score columns (cv_val, cv_test, cv_train, final_test, final_train)
    across chains.
    """
    store = _get_store()
    try:
        df = store.query_chain_summaries(
            run_id=request.run_id,
            dataset_name=request.dataset_name,
        )
        records = [_sanitize_dict(dict(row)) for row in df.iter_rows(named=True)]

        if not records:
            return MetricCorrelationResponse(
                cells=[], metrics=[], method=request.method, total_chains=0,
            )

        # Available score columns
        all_score_cols = [
            "cv_val_score", "cv_test_score", "cv_train_score",
            "final_test_score", "final_train_score",
        ]

        # Filter to requested metrics or those with data
        if request.metrics:
            metric_cols = [m for m in request.metrics if m in all_score_cols]
        else:
            metric_cols = []
            for col in all_score_cols:
                vals = [r.get(col) for r in records if r.get(col) is not None]
                if len(vals) >= 3:
                    metric_cols.append(col)

        if len(metric_cols) < 2:
            return MetricCorrelationResponse(
                cells=[], metrics=metric_cols, method=request.method,
                total_chains=len(records),
            )

        # Build arrays for each metric
        arrays: dict[str, list[float]] = {col: [] for col in metric_cols}
        valid_indices: list[int] = []

        for i, r in enumerate(records):
            all_present = all(
                r.get(col) is not None and isinstance(r.get(col), (int, float))
                for col in metric_cols
            )
            if all_present:
                valid_indices.append(i)
                for col in metric_cols:
                    arrays[col].append(float(r[col]))

        if len(valid_indices) < 3:
            return MetricCorrelationResponse(
                cells=[], metrics=metric_cols, method=request.method,
                total_chains=len(records),
            )

        # Compute correlation matrix
        from scipy import stats as scipy_stats

        cells: list[dict] = []
        for mx in metric_cols:
            for my in metric_cols:
                arr_x = np.array(arrays[mx])
                arr_y = np.array(arrays[my])

                if request.method == "spearman":
                    coef, _ = scipy_stats.spearmanr(arr_x, arr_y)
                else:
                    coef, _ = scipy_stats.pearsonr(arr_x, arr_y)

                coef_val = _sanitize_float(round(float(coef), 4)) if not (math.isnan(coef) or math.isinf(coef)) else None

                cells.append(CorrelationCell(
                    metric_x=mx,
                    metric_y=my,
                    coefficient=coef_val,
                    count=len(valid_indices),
                ).model_dump())

        return MetricCorrelationResponse(
            cells=cells,
            metrics=metric_cols,
            method=request.method,
            total_chains=len(records),
        )
    finally:
        store.close()


# ============================================================================
# Phase 5 — Expert Analysis models
# ============================================================================


class PreprocessingImpactRequest(BaseModel):
    """Request body for /inspector/preprocessing-impact."""

    run_id: Optional[str] = None
    dataset_name: Optional[str] = None
    score_column: str = "cv_val_score"


class PreprocessingImpactEntry(BaseModel):
    """One preprocessing step's impact on score."""

    step_name: str
    impact: Optional[float] = None
    mean_with: Optional[float] = None
    mean_without: Optional[float] = None
    count_with: int = 0
    count_without: int = 0


class PreprocessingImpactResponse(BaseModel):
    """Response for /inspector/preprocessing-impact."""

    entries: List[Dict[str, Any]]
    score_column: str
    total_chains: int


class HyperparameterRequest(BaseModel):
    """Request body for /inspector/hyperparameter."""

    run_id: Optional[str] = None
    dataset_name: Optional[str] = None
    param_name: str
    score_column: str = "cv_val_score"


class HyperparameterPoint(BaseModel):
    """One chain's hyperparameter value + score."""

    chain_id: str
    param_value: float
    score: float
    model_class: str


class HyperparameterResponse(BaseModel):
    """Response for /inspector/hyperparameter."""

    points: List[Dict[str, Any]]
    param_name: str
    score_column: str
    available_params: List[str]


class BiasVarianceRequest(BaseModel):
    """Request body for /inspector/bias-variance."""

    chain_ids: List[str]
    score_column: str = "cv_val_score"
    group_by: str = "model_class"


class BiasVarianceEntry(BaseModel):
    """One group's bias-variance decomposition."""

    group_label: str
    bias_squared: Optional[float] = None
    variance: Optional[float] = None
    total_error: Optional[float] = None
    n_chains: int = 0
    n_folds: int = 0
    n_samples: int = 0
    chain_ids: List[str] = []


class BiasVarianceResponse(BaseModel):
    """Response for /inspector/bias-variance."""

    entries: List[Dict[str, Any]]
    score_column: str
    group_by: str


class LearningCurveRequest(BaseModel):
    """Request body for /inspector/learning-curve."""

    run_id: Optional[str] = None
    dataset_name: Optional[str] = None
    score_column: str = "cv_val_score"
    model_class: Optional[str] = None


class LearningCurvePoint(BaseModel):
    """One training-size data point."""

    train_size: int
    train_mean: Optional[float] = None
    train_std: Optional[float] = None
    val_mean: Optional[float] = None
    val_std: Optional[float] = None
    count: int = 0


class LearningCurveResponse(BaseModel):
    """Response for /inspector/learning-curve."""

    points: List[Dict[str, Any]]
    score_column: str
    has_multiple_sizes: bool


# ============================================================================
# Phase 5 — Expert Analysis endpoints
# ============================================================================


@router.post("/preprocessing-impact")
async def get_preprocessing_impact(request: PreprocessingImpactRequest):
    """Analyse the impact of each preprocessing step on the score.

    For each unique preprocessing step found across chains, computes
    the mean score of chains with vs without that step, and the impact
    (difference). Sign is flipped for lower-is-better metrics.
    """
    store = _get_store()
    try:
        df = store.query_chain_summaries(
            run_id=request.run_id,
            dataset_name=request.dataset_name,
        )
        records = [_sanitize_dict(dict(row)) for row in df.iter_rows(named=True)]

        if not records:
            return PreprocessingImpactResponse(
                entries=[], score_column=request.score_column, total_chains=0,
            )

        # Extract unique preprocessing step names
        step_chains: dict[str, list[int]] = {}  # step_name → list of record indices
        for i, r in enumerate(records):
            preps = r.get("preprocessings")
            if not preps:
                continue
            # Split by " | " (pipeline separator) and ", " (within-step separator)
            for segment in str(preps).split(" | "):
                step = segment.strip()
                if step:
                    step_chains.setdefault(step, []).append(i)

        # Detect metric direction
        first_metric = next((r.get("metric") for r in records if r.get("metric")), None)
        lower_better = _is_lower_better(first_metric)

        entries: list[dict] = []
        all_indices = set(range(len(records)))

        for step_name, indices_with in step_chains.items():
            with_set = set(indices_with)
            without_set = all_indices - with_set

            scores_with = [
                float(records[i][request.score_column])
                for i in with_set
                if records[i].get(request.score_column) is not None
            ]
            scores_without = [
                float(records[i][request.score_column])
                for i in without_set
                if records[i].get(request.score_column) is not None
            ]

            if not scores_with or not scores_without:
                continue

            mean_w = float(np.mean(scores_with))
            mean_wo = float(np.mean(scores_without))
            impact = mean_w - mean_wo
            if lower_better:
                impact = -impact  # Flip so positive = beneficial

            entries.append(PreprocessingImpactEntry(
                step_name=step_name,
                impact=_sanitize_float(round(impact, 6)),
                mean_with=_sanitize_float(round(mean_w, 6)),
                mean_without=_sanitize_float(round(mean_wo, 6)),
                count_with=len(scores_with),
                count_without=len(scores_without),
            ).model_dump())

        # Sort by absolute impact descending
        entries.sort(key=lambda e: abs(e.get("impact") or 0), reverse=True)

        return PreprocessingImpactResponse(
            entries=entries,
            score_column=request.score_column,
            total_chains=len(records),
        )
    finally:
        store.close()


@router.post("/hyperparameter")
async def get_hyperparameter_data(request: HyperparameterRequest):
    """Get hyperparameter value vs score scatter data.

    Extracts numeric values of the requested param_name from each chain's
    best_params, paired with the chain's score.
    """
    store = _get_store()
    try:
        df = store.query_chain_summaries(
            run_id=request.run_id,
            dataset_name=request.dataset_name,
        )
        records = [_sanitize_dict(dict(row)) for row in df.iter_rows(named=True)]

        if not records:
            return HyperparameterResponse(
                points=[], param_name=request.param_name,
                score_column=request.score_column, available_params=[],
            )

        # Discover all numeric parameter names across chains
        param_counts: dict[str, int] = {}
        for r in records:
            bp = r.get("best_params")
            if not isinstance(bp, dict):
                continue
            for k, v in bp.items():
                if isinstance(v, (int, float)) and not (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
                    param_counts[k] = param_counts.get(k, 0) + 1

        available_params = sorted(k for k, c in param_counts.items() if c >= 2)

        # Build scatter points for the requested param
        points: list[dict] = []
        for r in records:
            bp = r.get("best_params")
            if not isinstance(bp, dict):
                continue
            val = bp.get(request.param_name)
            score = r.get(request.score_column)
            if (
                val is not None
                and isinstance(val, (int, float))
                and not (isinstance(val, float) and (math.isnan(val) or math.isinf(val)))
                and score is not None
            ):
                points.append(HyperparameterPoint(
                    chain_id=r["chain_id"],
                    param_value=float(val),
                    score=float(score),
                    model_class=r.get("model_class", "Unknown"),
                ).model_dump())

        return HyperparameterResponse(
            points=points,
            param_name=request.param_name,
            score_column=request.score_column,
            available_params=available_params,
        )
    finally:
        store.close()


@router.post("/bias-variance")
async def get_bias_variance(request: BiasVarianceRequest):
    """Bias-variance decomposition grouped by a chain field.

    For each group, collects fold-level predictions across chains.
    Per sample appearing in 2+ folds:
      bias² = (mean_pred - y_true)²
      variance = Var(y_pred across folds)
    Aggregated per group: mean_bias², mean_variance, total_error.
    """
    if not request.chain_ids:
        return BiasVarianceResponse(
            entries=[], score_column=request.score_column, group_by=request.group_by,
        )

    store = _get_store()
    try:
        # Get chain summaries for grouping
        df = store.query_chain_summaries()
        records = {
            dict(row)["chain_id"]: _sanitize_dict(dict(row))
            for row in df.iter_rows(named=True)
        }

        # Group chains by the requested field
        groups: dict[str, list[str]] = {}
        for cid in request.chain_ids:
            r = records.get(cid)
            if not r:
                continue
            label = str(r.get(request.group_by, "Unknown") or "Unknown")
            groups.setdefault(label, []).append(cid)

        entries: list[dict] = []

        for label, chain_ids in groups.items():
            # Collect fold-level predictions: sample_idx → list of (y_true, y_pred)
            sample_preds: dict[int, list[tuple[float, float]]] = {}
            total_folds = 0

            for cid in chain_ids:
                pred_df = store.get_chain_predictions(chain_id=cid, partition="val")
                if len(pred_df) == 0:
                    continue

                for row in pred_df.iter_rows(named=True):
                    row_dict = dict(row)
                    pid = row_dict.get("prediction_id")
                    if not pid:
                        continue
                    total_folds += 1

                    arrays = store.get_prediction_arrays(pid)
                    if arrays is None:
                        continue
                    y_true = arrays.get("y_true")
                    y_pred = arrays.get("y_pred")
                    if y_true is None or y_pred is None:
                        continue

                    y_true_arr = np.asarray(y_true, dtype=float)
                    y_pred_arr = np.asarray(y_pred, dtype=float)

                    indices = arrays.get("sample_indices")
                    if indices is not None:
                        idx_arr = list(np.asarray(indices, dtype=int))
                    else:
                        idx_arr = list(range(len(y_true_arr)))

                    for j, idx in enumerate(idx_arr):
                        if j < len(y_true_arr) and j < len(y_pred_arr):
                            yt = float(y_true_arr[j])
                            yp = float(y_pred_arr[j])
                            if not (math.isnan(yt) or math.isnan(yp)):
                                sample_preds.setdefault(int(idx), []).append((yt, yp))

            # Compute bias² and variance per sample with 2+ predictions
            biases_sq: list[float] = []
            variances: list[float] = []
            for idx, pairs in sample_preds.items():
                if len(pairs) < 2:
                    continue
                y_true_val = pairs[0][0]  # All should be the same y_true
                preds = [p[1] for p in pairs]
                mean_pred = float(np.mean(preds))
                bias_sq = (mean_pred - y_true_val) ** 2
                var = float(np.var(preds))
                biases_sq.append(bias_sq)
                variances.append(var)

            if biases_sq:
                mean_bias_sq = float(np.mean(biases_sq))
                mean_var = float(np.mean(variances))
                entries.append(BiasVarianceEntry(
                    group_label=label,
                    bias_squared=_sanitize_float(round(mean_bias_sq, 6)),
                    variance=_sanitize_float(round(mean_var, 6)),
                    total_error=_sanitize_float(round(mean_bias_sq + mean_var, 6)),
                    n_chains=len(chain_ids),
                    n_folds=total_folds,
                    n_samples=len(biases_sq),
                    chain_ids=chain_ids,
                ).model_dump())

        # Sort by total_error descending
        entries.sort(key=lambda e: e.get("total_error") or 0, reverse=True)

        return BiasVarianceResponse(
            entries=entries,
            score_column=request.score_column,
            group_by=request.group_by,
        )
    finally:
        store.close()


@router.post("/learning-curve")
async def get_learning_curve(request: LearningCurveRequest):
    """Learning curve: train/val scores grouped by training set size.

    Groups chains by the number of training samples (inferred from
    prediction array lengths), computing mean/std of train and val scores.
    """
    store = _get_store()
    try:
        df = store.query_chain_summaries(
            run_id=request.run_id,
            dataset_name=request.dataset_name,
        )
        records = [_sanitize_dict(dict(row)) for row in df.iter_rows(named=True)]

        if request.model_class:
            records = [r for r in records if r.get("model_class") == request.model_class]

        if not records:
            return LearningCurveResponse(
                points=[], score_column=request.score_column, has_multiple_sizes=False,
            )

        # Determine training set size per chain from predictions
        size_scores: dict[int, list[dict]] = {}  # train_size → list of {train, val}

        for r in records:
            cid = r["chain_id"]
            train_score = r.get("cv_train_score")
            val_score = r.get(request.score_column)

            if train_score is None and val_score is None:
                continue

            # Infer training size from fold predictions
            train_size = 0
            try:
                pred_df = store.get_chain_predictions(chain_id=cid, partition="train")
                if len(pred_df) > 0:
                    first_row = dict(pred_df.row(0, named=True))
                    pid = first_row.get("prediction_id")
                    if pid:
                        arrays = store.get_prediction_arrays(pid)
                        if arrays and arrays.get("y_true") is not None:
                            train_size = len(np.asarray(arrays["y_true"]))
            except Exception:
                pass

            if train_size == 0:
                # Fallback: try val partition to estimate total, then approximate
                try:
                    pred_df = store.get_chain_predictions(chain_id=cid, partition="val")
                    if len(pred_df) > 0:
                        first_row = dict(pred_df.row(0, named=True))
                        pid = first_row.get("prediction_id")
                        if pid:
                            arrays = store.get_prediction_arrays(pid)
                            if arrays and arrays.get("y_true") is not None:
                                val_size = len(np.asarray(arrays["y_true"]))
                                fold_count = r.get("cv_fold_count", 5) or 5
                                # Approximate: train_size ≈ total - val_size
                                total_approx = int(val_size * fold_count / max(1, fold_count - 1))
                                train_size = total_approx - val_size
                except Exception:
                    pass

            if train_size <= 0:
                continue

            size_scores.setdefault(train_size, []).append({
                "train": train_score,
                "val": val_score,
            })

        # Build learning curve points
        points: list[dict] = []
        for size in sorted(size_scores.keys()):
            entries = size_scores[size]
            train_vals = [e["train"] for e in entries if e["train"] is not None]
            val_vals = [e["val"] for e in entries if e["val"] is not None]

            points.append(LearningCurvePoint(
                train_size=size,
                train_mean=_sanitize_float(round(float(np.mean(train_vals)), 6)) if train_vals else None,
                train_std=_sanitize_float(round(float(np.std(train_vals)), 6)) if len(train_vals) > 1 else None,
                val_mean=_sanitize_float(round(float(np.mean(val_vals)), 6)) if val_vals else None,
                val_std=_sanitize_float(round(float(np.std(val_vals)), 6)) if len(val_vals) > 1 else None,
                count=len(entries),
            ).model_dump())

        has_multiple = len(points) > 1

        return LearningCurveResponse(
            points=points,
            score_column=request.score_column,
            has_multiple_sizes=has_multiple,
        )
    finally:
        store.close()

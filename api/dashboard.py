"""
Dashboard API routes for nirs4all webapp.

This module provides FastAPI routes for dashboard statistics and recent activity.
"""

from fastapi import APIRouter
from typing import Dict, Any, List, Optional
from pydantic import BaseModel
from pathlib import Path

from .workspace_manager import workspace_manager, WorkspaceScanner

router = APIRouter()


class TrendData(BaseModel):
    """Trend information for a statistic."""
    value: float
    direction: str  # "up", "down", or "neutral"


class DashboardStats(BaseModel):
    """Dashboard statistics model."""
    datasets: int
    pipelines: int
    runs: int
    avgMetric: float
    trends: Dict[str, TrendData]


class RecentRun(BaseModel):
    """Recent run/experiment model."""
    id: str
    name: str
    dataset_name: str
    pipeline_name: str
    status: str  # "completed", "running", "failed", "pending"
    metric_name: Optional[str] = None
    metric_value: Optional[float] = None
    created_at: str
    completed_at: Optional[str] = None


class DashboardData(BaseModel):
    """Complete dashboard data model."""
    stats: DashboardStats
    recent_runs: List[RecentRun]


def _count_pipelines() -> int:
    """Count pipelines in the current workspace."""
    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        return 0

    pipelines_path = workspace_manager.get_pipelines_path()
    if not pipelines_path or not Path(pipelines_path).exists():
        return 0

    # Count .json and .yaml pipeline files
    count = 0
    pipelines_dir = Path(pipelines_path)
    count += len(list(pipelines_dir.glob("*.json")))
    count += len(list(pipelines_dir.glob("*.yaml")))
    count += len(list(pipelines_dir.glob("*.yml")))

    return count


def _get_workspace_scanner() -> Optional[WorkspaceScanner]:
    """Get a WorkspaceScanner for the active workspace."""
    ws_path = workspace_manager.get_active_workspace_path()
    if not ws_path:
        return None
    return WorkspaceScanner(Path(ws_path))


def _count_runs() -> int:
    """Count completed runs in the current workspace using WorkspaceScanner."""
    scanner = _get_workspace_scanner()
    if not scanner:
        return 0

    runs = scanner.discover_runs()
    return len(runs)


def _get_avg_metric() -> float:
    """Calculate average R² or other primary metric from recent runs using WorkspaceScanner."""
    scanner = _get_workspace_scanner()
    if not scanner:
        return 0.0

    runs = scanner.discover_runs()
    if not runs:
        return 0.0

    metrics = []
    for run in runs:
        # Extract metrics from run summary or best_result
        summary = run.get("summary", {})
        best_result = run.get("best_result", {}) or summary.get("best_result", {})

        # Try to get R² or accuracy from best_result
        if best_result:
            for key in ["r2", "R2", "r2_score", "best_r2"]:
                if key in best_result:
                    try:
                        metrics.append(float(best_result[key]))
                    except (ValueError, TypeError):
                        pass
                    break
            else:
                # Check for accuracy
                for key in ["accuracy", "Accuracy", "best_accuracy"]:
                    if key in best_result:
                        try:
                            metrics.append(float(best_result[key]))
                        except (ValueError, TypeError):
                            pass
                        break

    if not metrics:
        return 0.0

    return sum(metrics) / len(metrics)


def _get_recent_runs(limit: int = 6) -> List[Dict[str, Any]]:
    """Get recent runs from the workspace using WorkspaceScanner."""
    scanner = _get_workspace_scanner()
    if not scanner:
        return []

    discovered_runs = scanner.discover_runs()
    if not discovered_runs:
        return []

    runs = []
    for run in discovered_runs:
        # Extract metric info from summary/best_result
        summary = run.get("summary", {})
        best_result = run.get("best_result", {}) or summary.get("best_result", {})

        metric_name = None
        metric_value = None
        if best_result:
            for key in ["r2", "R2", "r2_score", "best_r2"]:
                if key in best_result:
                    metric_name = "R²"
                    try:
                        metric_value = float(best_result[key])
                    except (ValueError, TypeError):
                        pass
                    break
            if not metric_name:
                for key in ["accuracy", "Accuracy", "best_accuracy"]:
                    if key in best_result:
                        metric_name = "Accuracy"
                        try:
                            metric_value = float(best_result[key])
                        except (ValueError, TypeError):
                            pass
                        break

        # Determine dataset name (new format has list, legacy has single string)
        datasets = run.get("datasets", [])
        if isinstance(datasets, list) and datasets:
            dataset_name = datasets[0].get("name", "Unknown") if isinstance(datasets[0], dict) else str(datasets[0])
        else:
            dataset_name = run.get("dataset", "Unknown")

        # Determine pipeline name from templates or name
        templates = run.get("templates", [])
        if templates and isinstance(templates[0], dict):
            pipeline_name = templates[0].get("name", run.get("name", "Unknown"))
        else:
            pipeline_name = run.get("name", "Unknown")

        run_info = {
            "id": run.get("id", ""),
            "name": run.get("name", ""),
            "dataset_name": dataset_name,
            "pipeline_name": pipeline_name,
            "status": run.get("status", "completed"),
            "metric_name": metric_name,
            "metric_value": metric_value,
            "created_at": run.get("created_at", ""),
            "completed_at": run.get("completed_at", run.get("created_at", "")),
        }
        runs.append(run_info)

    # Sort by created_at descending
    runs.sort(key=lambda x: x["created_at"], reverse=True)

    return runs[:limit]


def _calculate_trends() -> Dict[str, Dict[str, Any]]:
    """Calculate trends for statistics (placeholder - could be based on historical data)."""
    # For now, return neutral trends since we don't track historical data yet
    return {
        "datasets": {"value": 0, "direction": "neutral"},
        "pipelines": {"value": 0, "direction": "neutral"},
        "runs": {"value": 0, "direction": "neutral"},
        "avgMetric": {"value": 0, "direction": "neutral"},
    }


@router.get("/dashboard")
async def get_dashboard() -> Dict[str, Any]:
    """
    Get complete dashboard data including stats and recent runs.

    Returns:
        Dashboard statistics and recent activity.
    """
    workspace = workspace_manager.get_current_workspace()

    if not workspace:
        # Return empty/default data if no workspace
        return {
            "stats": {
                "datasets": 0,
                "pipelines": 0,
                "runs": 0,
                "avgMetric": 0.0,
                "trends": _calculate_trends(),
            },
            "recent_runs": [],
        }

    datasets_count = len(workspace.datasets)
    pipelines_count = _count_pipelines()
    runs_count = _count_runs()
    avg_metric = _get_avg_metric()

    return {
        "stats": {
            "datasets": datasets_count,
            "pipelines": pipelines_count,
            "runs": runs_count,
            "avgMetric": round(avg_metric, 2),
            "trends": _calculate_trends(),
        },
        "recent_runs": _get_recent_runs(limit=6),
    }


@router.get("/dashboard/stats")
async def get_dashboard_stats() -> Dict[str, Any]:
    """
    Get dashboard statistics only.

    Returns:
        Dashboard statistics with trends.
    """
    workspace = workspace_manager.get_current_workspace()

    if not workspace:
        return {
            "stats": {
                "datasets": 0,
                "pipelines": 0,
                "runs": 0,
                "avgMetric": 0.0,
                "trends": _calculate_trends(),
            }
        }

    datasets_count = len(workspace.datasets)
    pipelines_count = _count_pipelines()
    runs_count = _count_runs()
    avg_metric = _get_avg_metric()

    return {
        "stats": {
            "datasets": datasets_count,
            "pipelines": pipelines_count,
            "runs": runs_count,
            "avgMetric": round(avg_metric, 2),
            "trends": _calculate_trends(),
        }
    }


@router.get("/dashboard/recent-runs")
async def get_recent_runs(limit: int = 6) -> Dict[str, Any]:
    """
    Get recent runs/experiments.

    Args:
        limit: Maximum number of runs to return (default: 6)

    Returns:
        List of recent runs with metadata and metrics.
    """
    return {
        "runs": _get_recent_runs(limit=limit),
    }

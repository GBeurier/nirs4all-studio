"""
Dashboard API routes for nirs4all webapp.

This module provides FastAPI routes for dashboard statistics and recent activity.
"""

from fastapi import APIRouter
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
from pydantic import BaseModel
import json
from pathlib import Path

from .workspace_manager import workspace_manager

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


def _count_runs() -> int:
    """Count completed runs in the current workspace."""
    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        return 0

    results_path = workspace_manager.get_results_path()
    if not results_path or not Path(results_path).exists():
        return 0

    # Count result directories or files
    results_dir = Path(results_path)
    count = 0

    # Count subdirectories (each run typically creates a folder)
    for item in results_dir.iterdir():
        if item.is_dir():
            count += 1

    return count


def _get_avg_metric() -> float:
    """Calculate average R² or other primary metric from recent runs."""
    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        return 0.0

    results_path = workspace_manager.get_results_path()
    if not results_path or not Path(results_path).exists():
        return 0.0

    results_dir = Path(results_path)
    metrics = []

    # Try to load metrics from result files
    for result_dir in results_dir.iterdir():
        if result_dir.is_dir():
            metrics_file = result_dir / "metrics.json"
            if metrics_file.exists():
                try:
                    with open(metrics_file, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        # Look for R² or similar metric
                        for key in ["r2", "R2", "r2_score", "R2_score", "accuracy", "Accuracy"]:
                            if key in data:
                                metrics.append(float(data[key]))
                                break
                except Exception:
                    pass

    if not metrics:
        return 0.0

    return sum(metrics) / len(metrics)


def _get_recent_runs(limit: int = 6) -> List[Dict[str, Any]]:
    """Get recent runs from the workspace."""
    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        return []

    results_path = workspace_manager.get_results_path()
    if not results_path or not Path(results_path).exists():
        return []

    results_dir = Path(results_path)
    runs = []

    for result_dir in results_dir.iterdir():
        if result_dir.is_dir():
            run_info = {
                "id": result_dir.name,
                "name": result_dir.name.replace("_", " ").title(),
                "dataset_name": "Unknown",
                "pipeline_name": "Unknown",
                "status": "completed",
                "metric_name": None,
                "metric_value": None,
                "created_at": datetime.fromtimestamp(result_dir.stat().st_ctime).isoformat(),
                "completed_at": datetime.fromtimestamp(result_dir.stat().st_mtime).isoformat(),
            }

            # Try to load run metadata
            run_file = result_dir / "run.json"
            if run_file.exists():
                try:
                    with open(run_file, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        run_info["name"] = data.get("name", run_info["name"])
                        run_info["dataset_name"] = data.get("dataset_name", "Unknown")
                        run_info["pipeline_name"] = data.get("pipeline_name", "Unknown")
                        run_info["status"] = data.get("status", "completed")
                        run_info["created_at"] = data.get("created_at", run_info["created_at"])
                        run_info["completed_at"] = data.get("completed_at", run_info["completed_at"])
                except Exception:
                    pass

            # Try to load metrics
            metrics_file = result_dir / "metrics.json"
            if metrics_file.exists():
                try:
                    with open(metrics_file, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        # Look for primary metric
                        for key in ["r2", "R2", "r2_score", "R2_score"]:
                            if key in data:
                                run_info["metric_name"] = "R²"
                                run_info["metric_value"] = float(data[key])
                                break
                        if not run_info["metric_name"]:
                            for key in ["accuracy", "Accuracy"]:
                                if key in data:
                                    run_info["metric_name"] = "Accuracy"
                                    run_info["metric_value"] = float(data[key])
                                    break
                except Exception:
                    pass

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

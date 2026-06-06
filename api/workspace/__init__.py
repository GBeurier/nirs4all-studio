"""Workspace API package.

Aggregates the per-domain workspace routers into a single ``router`` that
``main.py`` includes once. The sub-routers are included in an order that
preserves FastAPI route matching identical to the pre-split single module:
the catch-all ``/workspace/{workspace_id}`` routes (in ``router_workspaces``)
must be registered after every literal ``/workspace/...`` route owned by the
datasets, custom-nodes, and maintenance routers.
"""

from fastapi import APIRouter

from . import (
    router_custom_nodes,
    router_datasets,
    router_discovery,
    router_maintenance,
    router_settings,
    router_workspaces,
)

router = APIRouter()

# Order matters: literal /workspace/* routes first, then the by-id catch-all.
router.include_router(router_datasets.router)
router.include_router(router_custom_nodes.router)
router.include_router(router_maintenance.router)
router.include_router(router_workspaces.router)
router.include_router(router_discovery.router)
router.include_router(router_settings.router)

__all__ = ["router"]

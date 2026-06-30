import sys
from collections import defaultdict

from fastapi.routing import APIRoute

PUBLIC_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE"}


def _fresh_app():
    """Return a freshly imported app so this registry test is not order-sensitive."""
    for module_name in [
        name
        for name in tuple(sys.modules)
        if name == "main" or name == "api.workspace" or name.startswith("api.workspace.")
    ]:
        sys.modules.pop(module_name, None)

    import main

    return main.app


def test_public_api_routes_do_not_duplicate_method_and_path():
    routes_by_key: dict[tuple[str, str], list[str]] = defaultdict(list)

    for route in _fresh_app().routes:
        if not isinstance(route, APIRoute):
            continue
        for method in sorted((route.methods or set()) & PUBLIC_METHODS):
            routes_by_key[(method, route.path)].append(route.name)

    duplicates = {
        f"{method} {path}": names
        for (method, path), names in sorted(routes_by_key.items())
        if len(names) > 1
    }

    assert duplicates == {}


def test_dataset_route_ownership_stays_partitioned():
    routes_by_key: dict[tuple[str, str], APIRoute] = {}

    for route in _fresh_app().routes:
        if not isinstance(route, APIRoute):
            continue
        for method in sorted((route.methods or set()) & PUBLIC_METHODS):
            routes_by_key[(method, route.path)] = route

    expected_owners = {
        ("GET", "/api/datasets"): "api.workspace.router_datasets",
        ("POST", "/api/datasets/link"): "api.workspace.router_datasets",
        ("DELETE", "/api/datasets/{dataset_id}"): "api.workspace.router_datasets",
        ("POST", "/api/datasets/{dataset_id}/refresh"): "api.workspace.router_datasets",
        ("POST", "/api/datasets/preview"): "api.datasets",
        ("POST", "/api/datasets/preview-upload"): "api.datasets",
        ("GET", "/api/datasets/{dataset_id}/preview"): "api.datasets",
        ("GET", "/api/datasets/{dataset_id}"): "api.datasets",
        ("PUT", "/api/datasets/{dataset_id}"): "api.datasets",
        ("POST", "/api/datasets/{dataset_id}/load"): "api.datasets",
        ("GET", "/api/datasets/{dataset_id}/stats"): "api.datasets",
        ("POST", "/api/datasets/{dataset_id}/verify"): "api.datasets",
    }

    actual_owners = {
        f"{method} {path}": routes_by_key[(method, path)].endpoint.__module__
        for method, path in expected_owners
    }
    expected_by_label = {
        f"{method} {path}": owner
        for (method, path), owner in expected_owners.items()
    }

    assert actual_owners == expected_by_label

import sys
from collections import defaultdict
from collections.abc import Iterable, Iterator

from fastapi.routing import APIRoute

PUBLIC_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE"}


def _fresh_app():
    """Return a freshly imported app so this registry test is not order-sensitive."""
    _clear_route_modules()

    import main

    return main.app


def _clear_route_modules():
    for module_name in [
        name
        for name in tuple(sys.modules)
        if name in {"main", "api.datasets", "api.workspace"} or name.startswith("api.workspace.")
    ]:
        sys.modules.pop(module_name, None)

    api_package = sys.modules.get("api")
    if api_package is not None:
        for attr_name in ("datasets", "workspace"):
            if hasattr(api_package, attr_name):
                delattr(api_package, attr_name)


def _iter_public_routes(routes: Iterable[object], prefix: str = "") -> Iterator[tuple[str, APIRoute]]:
    for route in routes:
        if isinstance(route, APIRoute):
            yield f"{prefix}{route.path}", route
            continue

        original_router = getattr(route, "original_router", None)
        include_context = getattr(route, "include_context", None)
        if original_router is None or include_context is None:
            continue

        nested_prefix = f"{prefix}{getattr(include_context, 'prefix', '') or ''}"
        yield from _iter_public_routes(getattr(original_router, "routes", ()), nested_prefix)


def test_public_api_routes_do_not_duplicate_method_and_path():
    routes_by_key: dict[tuple[str, str], list[str]] = defaultdict(list)

    for path, route in _iter_public_routes(_fresh_app().routes):
        for method in sorted((route.methods or set()) & PUBLIC_METHODS):
            routes_by_key[(method, path)].append(route.name)

    duplicates = {
        f"{method} {path}": names
        for (method, path), names in sorted(routes_by_key.items())
        if len(names) > 1
    }

    assert duplicates == {}


def test_dataset_route_ownership_stays_partitioned():
    routes_by_key: dict[tuple[str, str], APIRoute] = {}

    for path, route in _iter_public_routes(_fresh_app().routes):
        for method in sorted((route.methods or set()) & PUBLIC_METHODS):
            routes_by_key[(method, path)] = route

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

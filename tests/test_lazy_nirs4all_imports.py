from __future__ import annotations

import builtins
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

# Match Studio startup order so the pre-existing ``lazy_imports`` / ``shared``
# package cycle is initialized before this focused unit test imports the former.
import api.shared  # noqa: F401, E402
from api import lazy_imports  # noqa: E402


def test_public_nirs4all_submodule_import_is_single_flight(monkeypatch):
    """A request cannot race the background loader through importlib locks."""
    root_module = SimpleNamespace()
    robustness_module = SimpleNamespace()
    import_started = threading.Event()
    allow_import_to_finish = threading.Event()
    root_import_calls = 0
    submodule_import_calls = 0
    original_import = builtins.__import__

    def controlled_import(name, globals=None, locals=None, fromlist=(), level=0):
        nonlocal root_import_calls
        if name == "nirs4all":
            root_import_calls += 1
            import_started.set()
            assert allow_import_to_finish.wait(timeout=2)
            return root_module
        return original_import(name, globals, locals, fromlist, level)

    def controlled_import_module(name):
        nonlocal submodule_import_calls
        assert name == "nirs4all.api.robustness"
        submodule_import_calls += 1
        return robustness_module

    monkeypatch.setattr(lazy_imports, "_cache", {})
    monkeypatch.setattr(builtins, "__import__", controlled_import)
    monkeypatch.setattr(lazy_imports.importlib, "import_module", controlled_import_module)

    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(
            lazy_imports.get_nirs4all_module,
            "nirs4all.api.robustness",
        )
        assert import_started.wait(timeout=2)

        second = executor.submit(
            lazy_imports.get_nirs4all_module,
            "nirs4all.api.robustness",
        )
        time.sleep(0.05)
        assert not second.done()

        allow_import_to_finish.set()
        assert first.result(timeout=2) is robustness_module
        assert second.result(timeout=2) is robustness_module

    assert root_import_calls == 1
    assert submodule_import_calls == 1

"""Blocking scientific/config work must leave the HTTP event loop responsive."""
import asyncio
import importlib
import threading

import pytest


@pytest.mark.asyncio
@pytest.mark.parametrize("module_name,route,helper,kwargs", [
    ("api.datasets", "preview_dataset", "_preview_dataset_sync", {"request": object()}),
    ("api.recommended_config", "compare_config", "_compare_config_sync", {}),
])
async def test_blocking_preview_and_package_scan_leave_event_loop_responsive(monkeypatch, module_name, route, helper, kwargs):
    module = importlib.import_module(module_name)
    entered, release = threading.Event(), threading.Event()
    loop_thread = threading.get_ident()
    worker_threads = []

    def work(**_):
        worker_threads.append(threading.get_ident())
        entered.set()
        assert release.wait(2), "event loop could not release the blocking worker"
        return {"success": True}

    monkeypatch.setattr(module, helper, work)
    task = asyncio.create_task(getattr(module, route)(**kwargs))
    try:
        for _ in range(100):
            if entered.is_set():
                break
            await asyncio.sleep(0.001)
        assert entered.is_set()
        assert not task.done()
        assert worker_threads == [worker_threads[0]] and worker_threads[0] != loop_thread
    finally:
        release.set()
    assert await task == {"success": True}

"""A slow pip scan must not stop the API event loop."""
import asyncio
import threading

import pytest

from api.updates import dependencies


@pytest.mark.asyncio
async def test_slow_dependency_scan_does_not_block_other_requests(monkeypatch):
    main_thread = threading.get_ident()
    released = threading.Event()
    started = asyncio.Event()
    loop = asyncio.get_running_loop()
    response = object()

    def scan(force_refresh):
        assert threading.get_ident() != main_thread
        assert force_refresh is True
        loop.call_soon_threadsafe(started.set)
        assert released.wait(2), "event loop could not release the scan"
        return response

    monkeypatch.setattr(dependencies, "_get_dependencies_sync", scan)
    task = asyncio.create_task(dependencies.get_dependencies(force_refresh=True))
    try:
        await asyncio.wait_for(started.wait(), timeout=1)
        # This coroutine continues while the real worker remains occupied.
        assert not task.done()
    finally:
        released.set()
    assert await task is response

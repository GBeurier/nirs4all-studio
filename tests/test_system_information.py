"""OS display regressions shared by native and diagnostic system probes."""

from types import SimpleNamespace

import pytest

from api.shared import system_info


@pytest.mark.parametrize(
    "build,product_type,expected",
    [(19045, 1, "10"), (22000, 1, "11"), (26100, 1, "11"), (26100, 3, "10")],
)
def test_windows_release_uses_workstation_build(monkeypatch, build, product_type, expected):
    monkeypatch.setattr(system_info.sys, "platform", "win32")
    monkeypatch.setattr(system_info.sys, "getwindowsversion", lambda: SimpleNamespace(
        platform_version=(10, 0, build), product_type=product_type,
    ), raising=False)
    monkeypatch.setattr(system_info.platform, "release", lambda: "10")
    monkeypatch.setattr(system_info.platform, "system", lambda: "Windows")
    monkeypatch.setattr(system_info.platform, "machine", lambda: "AMD64")
    monkeypatch.setattr(system_info.platform, "processor", lambda: "test cpu")
    assert system_info.system_information() == {
        "os": "Windows", "release": expected, "machine": "AMD64", "processor": "test cpu",
    }


def test_non_windows_release_is_preserved(monkeypatch):
    monkeypatch.setattr(system_info.sys, "platform", "linux")
    monkeypatch.setattr(system_info.platform, "release", lambda: "6.18")
    assert system_info.system_information()["release"] == "6.18"

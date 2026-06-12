import builtins


def test_detect_gpu_hardware_reuses_cached_result(monkeypatch):
    from api.shared import gpu_detection as gd

    calls = {"torch": 0, "nvidia": 0}
    timestamps = iter([100.0, 101.0])

    def fake_torch():
        calls["torch"] += 1
        return {
            "torch_cuda_available": False,
            "torch_version": "2.6.0+cpu",
            "cuda_version": None,
            "gpu_name": None,
            "has_metal": False,
        }

    def fake_nvidia():
        calls["nvidia"] += 1
        return {
            "gpu_name": "NVIDIA GeForce RTX 4090",
            "driver_version": "591.86",
        }

    monkeypatch.setattr(gd, "_gpu_detection_cache", None)
    monkeypatch.setattr(gd.time, "monotonic", lambda: next(timestamps))
    monkeypatch.setattr(gd, "_detect_with_torch", fake_torch)
    monkeypatch.setattr(gd, "_detect_with_nvidia_smi", fake_nvidia)
    monkeypatch.setattr(gd, "_detect_with_windows_wmi", lambda: None)

    first = gd.detect_gpu_hardware()
    second = gd.detect_gpu_hardware()

    assert first.gpu_name == "NVIDIA GeForce RTX 4090"
    assert second.gpu_name == "NVIDIA GeForce RTX 4090"
    assert calls == {"torch": 1, "nvidia": 1}


def test_detect_gpu_hardware_refreshes_cache_after_ttl(monkeypatch):
    from api.shared import gpu_detection as gd

    calls = {"torch": 0}
    timestamps = iter([100.0, 116.0])

    def fake_torch():
        calls["torch"] += 1
        return {
            "torch_cuda_available": False,
            "torch_version": "2.6.0+cpu",
            "cuda_version": None,
            "gpu_name": None,
            "has_metal": False,
        }

    monkeypatch.setattr(gd, "_gpu_detection_cache", None)
    monkeypatch.setattr(gd.time, "monotonic", lambda: next(timestamps))
    monkeypatch.setattr(gd, "_detect_with_torch", fake_torch)
    monkeypatch.setattr(gd, "_detect_with_nvidia_smi", lambda: None)
    monkeypatch.setattr(gd, "_detect_with_windows_wmi", lambda: None)

    gd.detect_gpu_hardware()
    gd.detect_gpu_hardware()

    assert calls["torch"] == 2


def test_detect_with_torch_treats_runtime_import_failure_as_unavailable(monkeypatch):
    from api.shared import gpu_detection as gd

    original_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "torch":
            raise OSError("[WinError 193] %1 is not a valid Win32 application")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)

    result = gd._detect_with_torch()

    assert result == {
        "torch_cuda_available": False,
        "torch_version": None,
        "cuda_version": None,
        "gpu_name": None,
        "has_metal": False,
    }

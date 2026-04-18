"""Shared GPU detection helpers for setup and diagnostics."""

from __future__ import annotations

import json
import platform
import shutil
import subprocess
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

WINDOWS_NVIDIA_SMI_CANDIDATES = (
    Path(r"C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe"),
    Path(r"C:\Windows\System32\nvidia-smi.exe"),
)
GPU_DETECTION_CACHE_TTL_SECONDS = 15.0


@dataclass
class GPUHardwareInfo:
    """Hardware and runtime GPU detection state."""

    has_cuda: bool = False
    has_metal: bool = False
    cuda_version: str | None = None
    gpu_name: str | None = None
    driver_version: str | None = None
    torch_cuda_available: bool = False
    torch_version: str | None = None
    detection_source: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Serialize to a plain dict."""
        return asdict(self)


@dataclass
class _GPUDetectionCacheEntry:
    """Cached GPU detection payload with expiration time."""

    info: GPUHardwareInfo
    expires_at: float


_gpu_detection_cache: _GPUDetectionCacheEntry | None = None


def _run_command(command: list[str], timeout: int = 5) -> str | None:
    """Run a command and return stripped stdout on success."""
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except Exception:
        return None

    if result.returncode != 0:
        return None

    stdout = result.stdout.strip()
    return stdout or None


def _find_nvidia_smi() -> str | None:
    """Locate nvidia-smi if it is available."""
    resolved = shutil.which("nvidia-smi")
    if resolved:
        return resolved

    if platform.system() == "Windows":
        for candidate in WINDOWS_NVIDIA_SMI_CANDIDATES:
            if candidate.exists():
                return str(candidate)

    return None


def _detect_with_nvidia_smi() -> dict[str, str] | None:
    """Detect NVIDIA GPU details via nvidia-smi."""
    executable = _find_nvidia_smi()
    if not executable:
        return None

    output = _run_command(
        [
            executable,
            "--query-gpu=name,driver_version",
            "--format=csv,noheader",
        ]
    )
    if not output:
        return None

    first_line = output.splitlines()[0]
    parts = [part.strip() for part in first_line.split(",")]
    if not parts or not parts[0]:
        return None

    return {
        "gpu_name": parts[0],
        "driver_version": parts[1] if len(parts) > 1 and parts[1] else "",
    }


def _detect_with_windows_wmi() -> dict[str, str] | None:
    """Detect NVIDIA GPU details on Windows even when nvidia-smi is unavailable."""
    if platform.system() != "Windows":
        return None

    output = _run_command(
        [
            "powershell",
            "-NoProfile",
            "-Command",
            (
                "Get-CimInstance Win32_VideoController "
                "| Select-Object Name,DriverVersion "
                "| ConvertTo-Json -Compress"
            ),
        ],
        timeout=10,
    )
    if not output:
        return None

    try:
        raw = json.loads(output)
    except Exception:
        return None

    entries = raw if isinstance(raw, list) else [raw]
    for entry in entries:
        name = str(entry.get("Name") or entry.get("name") or "").strip()
        if "nvidia" not in name.lower():
            continue
        return {
            "gpu_name": name,
            "driver_version": str(entry.get("DriverVersion") or entry.get("driverVersion") or "").strip(),
        }

    return None


def _detect_with_torch() -> dict[str, Any]:
    """Detect GPU availability from the current torch runtime."""
    info: dict[str, Any] = {
        "torch_cuda_available": False,
        "torch_version": None,
        "cuda_version": None,
        "gpu_name": None,
        "has_metal": False,
    }

    try:
        import torch  # type: ignore
    except ImportError:
        return info

    info["torch_version"] = getattr(torch, "__version__", None)
    info["cuda_version"] = getattr(getattr(torch, "version", None), "cuda", None)

    try:
        if torch.cuda.is_available():
            info["torch_cuda_available"] = True
            if torch.cuda.device_count() > 0:
                info["gpu_name"] = torch.cuda.get_device_name(0)
    except Exception:
        pass

    try:
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            info["has_metal"] = True
    except Exception:
        pass

    return info


def detect_gpu_hardware() -> GPUHardwareInfo:
    """Detect physical GPU hardware plus runtime CUDA availability."""
    global _gpu_detection_cache

    now = time.monotonic()
    if _gpu_detection_cache and now < _gpu_detection_cache.expires_at:
        return GPUHardwareInfo(**_gpu_detection_cache.info.to_dict())

    info = GPUHardwareInfo()

    torch_info = _detect_with_torch()
    info.torch_cuda_available = bool(torch_info.get("torch_cuda_available"))
    info.torch_version = torch_info.get("torch_version")
    info.has_metal = bool(torch_info.get("has_metal"))

    if info.torch_cuda_available:
        info.has_cuda = True
        info.gpu_name = torch_info.get("gpu_name")
        info.cuda_version = torch_info.get("cuda_version")
        info.detection_source = "torch"

    if info.has_metal and not info.detection_source:
        info.detection_source = "torch-mps"

    nvidia_info = _detect_with_nvidia_smi() or _detect_with_windows_wmi()
    if nvidia_info:
        info.has_cuda = True
        info.gpu_name = info.gpu_name or nvidia_info.get("gpu_name")
        info.driver_version = nvidia_info.get("driver_version") or None
        if not info.detection_source:
            info.detection_source = "nvidia-hardware"

    if info.cuda_version is None and info.torch_cuda_available:
        info.cuda_version = torch_info.get("cuda_version")

    _gpu_detection_cache = _GPUDetectionCacheEntry(
        info=GPUHardwareInfo(**info.to_dict()),
        expires_at=now + GPU_DETECTION_CACHE_TTL_SECONDS,
    )

    return info

"""OS presentation shared by the diagnostic API and Rust's Python probe.

This module uses only the standard library so the sidecar can embed its source
in the bounded system-information probe without importing the HTTP app.
"""

import platform
import sys


def system_information() -> dict[str, str]:
    """Return the OS release, correcting the Windows 10 kernel label on 11."""
    release = platform.release()
    if sys.platform == "win32":
        version = sys.getwindowsversion()
        # Windows 11 retains kernel version 10.0; workstation build 22000 is
        # its first release. Server releases must keep their own OS label.
        major, _, build = version.platform_version
        if version.product_type == 1 and major == 10 and build >= 22000:
            release = "11"
    return {
        "os": platform.system(),
        "release": release,
        "machine": platform.machine(),
        "processor": platform.processor(),
    }

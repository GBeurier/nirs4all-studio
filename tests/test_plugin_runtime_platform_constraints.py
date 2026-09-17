"""Use pip's marker semantics to prevent ambiguous per-platform scientific pins."""

from pathlib import Path

import pytest
from packaging.markers import default_environment
from packaging.requirements import Requirement


@pytest.mark.parametrize(
    ("platform", "machine", "expected"),
    [
        ("darwin", "x86_64", {"numpy": "2.3.5", "numba": "0.62.1", "llvmlite": "0.45.1"}),
        ("darwin", "arm64", {"numpy": "2.4.6", "numba": "0.67.0", "llvmlite": "0.49.0"}),
        ("linux", "x86_64", {"numpy": "2.4.6", "numba": "0.67.0", "llvmlite": "0.49.0"}),
        ("linux", "aarch64", {"numpy": "2.4.6", "numba": "0.67.0", "llvmlite": "0.49.0"}),
        ("win32", "AMD64", {"numpy": "2.4.6", "numba": "0.67.0", "llvmlite": "0.49.0"}),
    ],
)
def test_constraints_select_one_compatible_scientific_pin_per_target(platform, machine, expected):
    environment = {**default_environment(), "sys_platform": platform, "platform_machine": machine}
    constraints = Path(__file__).resolve().parents[1] / "build" / "constraints" / "plugin-runtime-cpython311.txt"
    selected = {}
    for line in constraints.read_text().splitlines():
        if not line or line.startswith("#"):
            continue
        requirement = Requirement(line)
        if requirement.marker and not requirement.marker.evaluate(environment):
            continue
        assert requirement.name not in selected, f"Ambiguous constraint for {requirement.name} on {platform}/{machine}"
        selected[requirement.name] = str(requirement.specifier)
    for package, version in expected.items():
        assert selected[package] == f"=={version}"
    if platform == "darwin" and machine == "x86_64":
        # Requirements from the published CPython 3.11 Numba 0.62.1 wheel.
        assert Requirement("numpy>=1.22,<2.4").specifier.contains(expected["numpy"])
        assert Requirement("llvmlite>=0.45.0dev0,<0.46").specifier.contains(expected["llvmlite"])

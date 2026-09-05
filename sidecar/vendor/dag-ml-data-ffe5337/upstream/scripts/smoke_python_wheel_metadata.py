#!/usr/bin/env python3
"""Validate built Python wheel metadata and packaged typing files."""

from __future__ import annotations

import sys
import tomllib
import zipfile
from email.parser import Parser
from pathlib import Path
from typing import Any


def fail(message: str) -> None:
    raise SystemExit(message)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def load_toml(path: Path) -> dict[str, Any]:
    with path.open("rb") as handle:
        return tomllib.load(handle)


def find_pyproject(repo: Path) -> Path:
    pyprojects = sorted((repo / "crates").glob("*-py/pyproject.toml"))
    require(len(pyprojects) == 1, f"expected exactly one Python pyproject, found {len(pyprojects)}")
    return pyprojects[0]


def default_wheels(repo: Path, module_name: str) -> list[Path]:
    wheels = sorted((repo / "target" / "wheels").glob(f"{module_name}-*.whl"))
    require(wheels, f"no built wheels found for {module_name}")
    return wheels


def read_dist_file(names: list[str], suffix: str, wheel: zipfile.ZipFile) -> str:
    matches = [name for name in names if name.endswith(suffix)]
    require(len(matches) == 1, f"expected one {suffix} file, found {len(matches)}")
    return wheel.read(matches[0]).decode("utf-8")


def validate_wheel(wheel_path: Path, pyproject: dict[str, Any]) -> None:
    project = pyproject["project"]
    project_name = project["name"]
    version = project["version"]
    module_name = project_name.replace("-", "_")
    maturin = pyproject["tool"]["maturin"]
    extension_name = maturin["module-name"].split(".")[-1]

    require(wheel_path.is_file(), f"wheel does not exist: {wheel_path}")
    with zipfile.ZipFile(wheel_path) as wheel:
        names = wheel.namelist()
        metadata = Parser().parsestr(read_dist_file(names, ".dist-info/METADATA", wheel))
        wheel_metadata = Parser().parsestr(read_dist_file(names, ".dist-info/WHEEL", wheel))

    require(metadata["Name"] == project_name, f"{wheel_path}: metadata Name mismatch")
    require(metadata["Version"] == version, f"{wheel_path}: metadata Version mismatch")
    require(
        metadata["Requires-Python"] == project["requires-python"],
        f"{wheel_path}: Requires-Python mismatch",
    )
    expected_license = project["license"]
    wheel_license = metadata["License-Expression"] or metadata["License"]
    # PEP 639 tooling may normalize SPDX identifier casing, so compare the
    # license expression case-insensitively against the pyproject declaration.
    require(
        wheel_license is not None and wheel_license.casefold() == expected_license.casefold(),
        f"{wheel_path}: wheel license {wheel_license!r} must match pyproject {expected_license!r}",
    )
    classifiers = set(metadata.get_all("Classifier") or [])
    for classifier in project["classifiers"]:
        require(classifier in classifiers, f"{wheel_path}: missing classifier {classifier!r}")

    tags = wheel_metadata.get_all("Tag") or []
    require(any("-abi3-" in f"-{tag}-" for tag in tags), f"{wheel_path}: wheel must use abi3")
    require(f"{module_name}/__init__.py" in names, f"{wheel_path}: missing package __init__.py")
    require(f"{module_name}/__init__.pyi" in names, f"{wheel_path}: missing package stub")
    require(f"{module_name}/py.typed" in names, f"{wheel_path}: missing py.typed")
    require(
        any(name.startswith(f"{module_name}/{extension_name}") for name in names),
        f"{wheel_path}: missing native extension module",
    )
    require(
        any(name.endswith(".dist-info/licenses/LICENSE") for name in names),
        f"{wheel_path}: missing packaged license file",
    )


def main(argv: list[str]) -> None:
    repo = Path(__file__).resolve().parents[1]
    pyproject = load_toml(find_pyproject(repo))
    module_name = pyproject["project"]["name"].replace("-", "_")
    wheels = [Path(arg) for arg in argv[1:]] or default_wheels(repo, module_name)
    for wheel in wheels:
        validate_wheel(wheel, pyproject)
    print(f"validated Python wheel metadata for {len(wheels)} wheel(s)")


if __name__ == "__main__":
    main(sys.argv)

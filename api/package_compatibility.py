"""Known upstream dependency bounds shared by installation and execution checks.

TabPFN 2.0.x calls BaseEstimator._validate_data (removed in sklearn 1.7),
although its wheel metadata only declares scikit-learn>=1. Studio's nirs4all
runtime requires sklearn>=1.5. These bounds apply only to an explicit install
of that TabPFN series; checking an existing environment never modifies it.
"""
from collections.abc import Mapping

from packaging.requirements import Requirement
from packaging.specifiers import SpecifierSet
from packaging.version import InvalidVersion, Version

_COMPATIBILITY = (("tabpfn", ">=2.0,<2.1", ("scikit-learn>=1.5,<1.7",)),)


def installation_requirements(package: str, version: str | None) -> list[str]:
    """Additional requirements resolved in the same explicit pip transaction."""
    if version is None:
        return []
    try:
        selected = Version(version)
    except InvalidVersion:
        return []
    normalized = package.lower().replace("_", "-")
    return [
        requirement
        for name, versions, requirements in _COMPATIBILITY
        if normalized == name and selected in SpecifierSet(versions)
        for requirement in requirements
    ]


def compatibility_issues(package: str, installed: Mapping[str, str]) -> list[str]:
    """Return actionable version conflicts without importing or changing packages."""
    normalized = package.lower().replace("_", "-")
    version = installed.get(normalized)
    issues = []
    for requirement_text in installation_requirements(normalized, version):
        requirement = Requirement(requirement_text)
        actual = installed.get(requirement.name)
        if actual is None:
            issues.append(f"{normalized} {version} requires {requirement_text}; it is not installed")
        elif not requirement.specifier.contains(actual):
            issues.append(f"{normalized} {version} requires {requirement_text}; installed {requirement.name} is {actual}")
    return issues

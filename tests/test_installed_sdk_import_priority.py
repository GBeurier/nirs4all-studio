"""Import-origin regressions only; fixture packages perform no scientific work."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

STUDIO_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def dependency_projection(tmp_path_factory):
    """Expose existing dependencies without exposing the host's real SDK."""
    projection = tmp_path_factory.mktemp("sdk-resolution-dependencies")
    for path in sys.path:
        directory = Path(path)
        if directory.name not in {"site-packages", "dist-packages"} or not directory.is_dir():
            continue
        for entry in directory.iterdir():
            if entry.name == "nirs4all" or entry.name.startswith("nirs4all-"):
                continue
            destination = projection / entry.name
            if not destination.exists() and not destination.is_symlink():
                destination.symlink_to(entry, target_is_directory=entry.is_dir())
    return projection


def _probe(tmp_path, dependency_projection, entrypoint, state, source_candidate=0):
    studio = tmp_path / "workspace" / "studio"
    shutil.copytree(STUDIO_ROOT / "api", studio / "api", ignore=shutil.ignore_patterns("__pycache__"))
    (studio / "tests").mkdir()
    shutil.copy2(STUDIO_ROOT / "tests" / "conftest.py", studio / "tests" / "conftest.py")
    shutil.copy2(STUDIO_ROOT / "tests" / "test_operator_definitions.py", studio / "tests" / "test_operator_definitions.py")
    installed = tmp_path / "installed-site-packages"
    installed.mkdir()
    candidates = [studio.parent / "nirs4all", studio.parent / "RC-v1-nirs4all-python", studio.parent.parent / "nirs4all"]

    def write_package(root, content):
        package = root / "nirs4all"
        package.mkdir(parents=True)
        (package / "__init__.py").write_text(content)
        return package / "__init__.py"

    source_origin = None
    if state != "unavailable":
        source_origin = write_package(candidates[source_candidate], "ORIGIN = 'sibling-source'\n")
    installed_origin = None
    if state in {"installed", "preloaded", "broken"}:
        content = "raise ImportError('missing-installed-dependency')\n" if state == "broken" else "ORIGIN = 'installed-fixture'\n"
        installed_origin = write_package(installed, content)

    script = """
import importlib.util
import json
import runpy
import sys
from pathlib import Path

studio, installed, dependencies, entrypoint, state = sys.argv[1:]
# -I -S disables user paths and .pth processing. Keep real stdlib and project
# existing dependency files; SDK discovery uses only the explicit fixtures.
sys.path[:] = [installed, dependencies, studio] + [
    p for p in sys.path if p and 'site-packages' not in p and 'dist-packages' not in p
]
before = importlib.util.find_spec('nirs4all')
before_origin = before.origin if before else None
if state == 'preloaded':
    import nirs4all
    nirs4all.__spec__ = None  # Loaded mocks may legitimately lack a spec.
if entrypoint == 'conftest':
    runpy.run_path(str(Path(studio) / 'tests' / 'conftest.py'))
elif entrypoint == 'operator_definitions':
    runpy.run_path(str(Path(studio) / 'tests' / 'test_operator_definitions.py'))
else:
    # Match Studio startup order around the existing shared/lazy import cycle.
    import api.shared
    if entrypoint == 'runs':
        import api.runs
    else:
        import api.lazy_imports
loaded_by_bootstrap = 'nirs4all' in sys.modules
try:
    import nirs4all
    result = {'origin': nirs4all.__file__, 'marker': nirs4all.ORIGIN, 'error': None}
except ImportError as exc:
    result = {'origin': None, 'marker': None, 'error': str(exc), 'error_type': type(exc).__name__}
result.update(before_origin=before_origin, loaded_by_bootstrap=loaded_by_bootstrap, paths=sys.path)
print('SDK_IMPORT_RESULT=' + json.dumps(result))
"""
    environment = os.environ.copy()
    environment.update(SENTRY_DSN="", NIRS4ALL_CONFIG=str(tmp_path / "config"),
                       NIRS4ALL_WORKSPACE=str(tmp_path / "runtime-workspace"),
                       NIRS4ALL_PORTABLE_ROOT=str(tmp_path / "portable"),
                       PYTHONDONTWRITEBYTECODE="1")
    completed = subprocess.run(
        [sys.executable, "-I", "-S", "-c", script, str(studio), str(installed), str(dependency_projection), entrypoint, state],
        cwd=tmp_path, env=environment, text=True, capture_output=True, timeout=30,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr
    line = next(line for line in completed.stdout.splitlines() if line.startswith("SDK_IMPORT_RESULT="))
    return json.loads(line.split("=", 1)[1]), candidates, source_origin, installed_origin


@pytest.mark.parametrize("entrypoint", ["lazy_imports", "runs", "conftest", "operator_definitions"])
@pytest.mark.parametrize("state", ["installed", "absent", "unavailable", "broken", "preloaded"])
def test_sdk_resolution_preserves_discoverable_package(tmp_path, dependency_projection, entrypoint, state):
    result, candidates, source_origin, installed_origin = _probe(tmp_path, dependency_projection, entrypoint, state)
    assert result["loaded_by_bootstrap"] is (state == "preloaded")
    if state in {"installed", "preloaded", "broken"}:
        assert result["before_origin"] == str(installed_origin)
        assert all(str(path) not in result["paths"] for path in candidates)
        if state == "broken":
            assert result["error"] == "missing-installed-dependency"
            assert result["error_type"] == "ImportError"
        else:
            assert result["origin"] == str(installed_origin)
            assert result["marker"] == "installed-fixture"
            assert result["error"] is None
    elif state == "absent":
        assert result["before_origin"] is None
        assert result["origin"] == str(source_origin)
        assert result["marker"] == "sibling-source"
        assert result["error"] is None
    else:
        assert result["before_origin"] is None
        assert result["origin"] is None
        assert result["error_type"] == "ModuleNotFoundError"


@pytest.mark.parametrize("source_candidate", [1, 2])
def test_conftest_retains_alternate_source_fallbacks(tmp_path, dependency_projection, source_candidate):
    result, _, source_origin, _ = _probe(tmp_path, dependency_projection, "conftest", "absent", source_candidate)
    assert result["before_origin"] is None
    assert not result["loaded_by_bootstrap"]
    assert result["origin"] == str(source_origin)
    assert result["marker"] == "sibling-source"


@pytest.mark.parametrize("source_candidate", [1, 2])
def test_operator_definitions_retains_alternate_source_fallbacks(tmp_path, dependency_projection, source_candidate):
    result, _, source_origin, _ = _probe(tmp_path, dependency_projection, "operator_definitions", "absent", source_candidate)
    assert result["before_origin"] is None
    assert not result["loaded_by_bootstrap"]
    assert result["origin"] == str(source_origin)
    assert result["marker"] == "sibling-source"

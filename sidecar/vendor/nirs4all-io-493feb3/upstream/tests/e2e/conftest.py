from __future__ import annotations

from pathlib import Path

import pytest


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption(
        "--artifacts-dir",
        action="store",
        default=None,
        help="Directory where ecosystem E2E entrypoints write their declared artifacts.",
    )


@pytest.fixture
def artifacts_dir(request: pytest.FixtureRequest, tmp_path: Path) -> Path:
    raw = request.config.getoption("--artifacts-dir")
    path = Path(raw).expanduser().resolve() if raw else tmp_path / "artifacts"
    path.mkdir(parents=True, exist_ok=True)
    return path

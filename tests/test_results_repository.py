from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from api.results_repository import (
    ResultsRepositoryNotFound,
    native_results_root,
    resolve_results_repository,
    workspace_content_dir,
    workspace_store_exists,
    workspace_store_root,
)


def test_workspace_content_dir_supports_parent_or_direct_workspace(tmp_path: Path):
    parent_workspace = tmp_path / "parent" / "workspace"
    parent_workspace.mkdir(parents=True)

    direct_workspace = tmp_path / "direct"
    (direct_workspace / "runs").mkdir(parents=True)

    missing_parent = tmp_path / "missing"

    assert workspace_content_dir(tmp_path / "parent") == parent_workspace
    assert workspace_content_dir(direct_workspace) == direct_workspace
    assert workspace_content_dir(missing_parent) == missing_parent / "workspace"


def test_workspace_store_exists_for_sqlite_or_duckdb(tmp_path: Path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()

    assert workspace_store_exists(workspace) is False
    assert workspace_store_root(workspace) is None

    (workspace / "store.sqlite").touch()
    assert workspace_store_exists(workspace) is True
    assert workspace_store_root(workspace) == workspace

    (workspace / "store.sqlite").unlink()
    (workspace / "store.duckdb").touch()
    assert workspace_store_exists(workspace) is True
    assert workspace_store_root(workspace) == workspace


def test_workspace_store_root_checks_nested_workspace(tmp_path: Path):
    workspace = tmp_path / "project" / "workspace"
    workspace.mkdir(parents=True)
    (workspace / "store.duckdb").touch()

    assert workspace_store_exists(tmp_path / "project") is True
    assert workspace_store_root(tmp_path / "project") == workspace


def test_native_results_root_requires_manifest_run(tmp_path: Path):
    workspace = tmp_path / "workspace"
    root = workspace / "nirs4all_results"
    empty_run = root / "run-without-manifest"
    empty_run.mkdir(parents=True)

    assert native_results_root(workspace) is None

    run = root / "run-1"
    run.mkdir()
    (run / "manifest.json").write_text("{}", encoding="utf-8")

    assert native_results_root(workspace) == root


def test_native_results_root_checks_nested_workspace(tmp_path: Path):
    root = tmp_path / "project" / "workspace" / "nirs4all_results"
    run = root / "run-1"
    run.mkdir(parents=True)
    (run / "manifest.json").write_text("{}", encoding="utf-8")

    assert native_results_root(tmp_path / "project") == root


def test_resolve_results_repository_prefers_workspace_store(tmp_path: Path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "store.duckdb").touch()
    native_run = workspace / "nirs4all_results" / "run-1"
    native_run.mkdir(parents=True)
    (native_run / "manifest.json").write_text("{}", encoding="utf-8")

    repository = MagicMock(name="WorkspaceStore")
    factory = MagicMock(return_value=repository)

    assert resolve_results_repository(workspace, workspace_store_factory=factory) is repository
    factory.assert_called_once_with(workspace)


def test_resolve_results_repository_uses_native_adapter_without_store(tmp_path: Path):
    workspace = tmp_path / "workspace"
    native_run = workspace / "nirs4all_results" / "run-1"
    native_run.mkdir(parents=True)
    (native_run / "manifest.json").write_text("{}", encoding="utf-8")

    repository = MagicMock(name="NativeResultsAdapter")

    with patch("api.native_results_adapter.NativeResultsAdapter", return_value=repository) as adapter_cls:
        assert resolve_results_repository(workspace, workspace_store_factory=MagicMock()) is repository

    adapter_cls.assert_called_once_with(workspace / "nirs4all_results")


def test_resolve_results_repository_uses_nested_workspace_store(tmp_path: Path):
    workspace = tmp_path / "project" / "workspace"
    workspace.mkdir(parents=True)
    (workspace / "store.duckdb").touch()

    repository = MagicMock(name="WorkspaceStore")
    factory = MagicMock(return_value=repository)

    assert resolve_results_repository(tmp_path / "project", workspace_store_factory=factory) is repository
    factory.assert_called_once_with(workspace)


def test_resolve_results_repository_raises_without_supported_store(tmp_path: Path):
    with pytest.raises(ResultsRepositoryNotFound):
        resolve_results_repository(tmp_path, workspace_store_factory=MagicMock())

"""Tests for the one-shot dataset-links schema migration in app_config.

Legacy webapp builds persisted na_policy as "drop"/"Drop"/"keep" inside each
dataset's stored ``config`` payload. nirs4all only accepts {auto, abort,
remove_sample, remove_feature, replace, ignore}, so a one-shot migration rewrites
those legacy values to the canonical vocabulary when app_config loads the
dataset-links JSON (and records a ``schema_version`` marker so it runs once).

These tests replace the former live-shim coverage that pinned
``normalize_na_policy`` in dataset_config.py (now deleted): runtime code trusts
the migrated stored data.
"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from api.app_config import (  # noqa: E402
    _DATASET_LINKS_SCHEMA_VERSION,
    AppConfigManager,
)


@pytest.fixture
def isolated_config(tmp_path, monkeypatch):
    """An AppConfigManager backed by an isolated NIRS4ALL_CONFIG directory."""
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    monkeypatch.setenv("NIRS4ALL_CONFIG", str(config_dir))
    return AppConfigManager()


def _legacy_links_payload() -> dict:
    """A dataset-links payload with legacy na_policy values in every shape."""
    return {
        "version": "1.0",
        "datasets": [
            {
                "id": "dataset_1",
                "name": "legacy_ds",
                "path": "/data/legacy",
                "linked_at": "2025-01-01T00:00:00",
                "config": {
                    "na_policy": "Drop",
                    "global_params": {"na_policy": "drop"},
                    "train_x_params": {"na_policy": "KEEP"},
                    "files": [
                        {
                            "path": "/data/Y.csv",
                            "type": "Y",
                            "split": "train",
                            "overrides": {"na_policy": " keep "},
                        },
                    ],
                },
            },
            {
                "id": "dataset_2",
                "name": "multi_source",
                "path": "/data/multi",
                "linked_at": "2025-01-02T00:00:00",
                "config": {
                    "train_x_params": [
                        {"na_policy": "drop"},
                        {"na_policy": "remove_feature"},
                    ],
                },
            },
        ],
        "groups": [],
    }


class TestDatasetLinksMigration:
    """One-shot, idempotent legacy na_policy migration over the stored JSON."""

    def _write(self, manager: AppConfigManager, payload: dict) -> Path:
        path = manager._dataset_links_path
        path.write_text(json.dumps(payload), encoding="utf-8")
        return path

    def test_legacy_na_policy_is_normalized_in_every_shape(self, isolated_config):
        path = self._write(isolated_config, _legacy_links_payload())

        data = isolated_config._load_dataset_links()

        ds1 = data["datasets"][0]["config"]
        assert ds1["na_policy"] == "remove_sample"
        assert ds1["global_params"]["na_policy"] == "remove_sample"
        assert ds1["train_x_params"]["na_policy"] == "ignore"
        assert ds1["files"][0]["overrides"]["na_policy"] == "ignore"

        ds2 = data["datasets"][1]["config"]
        assert ds2["train_x_params"][0]["na_policy"] == "remove_sample"
        assert ds2["train_x_params"][1]["na_policy"] == "remove_feature"

        # Marker recorded and persisted back to disk.
        assert data["schema_version"] == _DATASET_LINKS_SCHEMA_VERSION
        on_disk = json.loads(path.read_text(encoding="utf-8"))
        assert on_disk["schema_version"] == _DATASET_LINKS_SCHEMA_VERSION
        assert on_disk["datasets"][0]["config"]["na_policy"] == "remove_sample"

    def test_migration_is_idempotent_on_second_load(self, isolated_config):
        path = self._write(isolated_config, _legacy_links_payload())

        isolated_config._load_dataset_links()
        first = path.read_text(encoding="utf-8")
        first_mtime = path.stat().st_mtime_ns

        # Second load must not rewrite an already-migrated file.
        data = isolated_config._load_dataset_links()
        assert data["datasets"][0]["config"]["na_policy"] == "remove_sample"
        assert path.read_text(encoding="utf-8") == first
        assert path.stat().st_mtime_ns == first_mtime

    def test_already_normalized_config_is_not_rewritten(self, isolated_config):
        payload = {
            "version": "1.0",
            "datasets": [
                {
                    "id": "dataset_1",
                    "name": "clean",
                    "path": "/data/clean",
                    "linked_at": "2025-01-01T00:00:00",
                    "config": {"global_params": {"na_policy": "remove_sample"}},
                },
            ],
            "groups": [],
        }
        path = self._write(isolated_config, payload)
        before = path.read_text(encoding="utf-8")
        before_mtime = path.stat().st_mtime_ns

        data = isolated_config._load_dataset_links()

        # Values unchanged; no legacy value meant no disk write.
        assert data["datasets"][0]["config"]["global_params"]["na_policy"] == "remove_sample"
        assert path.read_text(encoding="utf-8") == before
        assert path.stat().st_mtime_ns == before_mtime

    def test_get_datasets_returns_migrated_config(self, isolated_config):
        self._write(isolated_config, _legacy_links_payload())

        datasets = isolated_config.get_datasets()

        legacy = next(d for d in datasets if d.id == "dataset_1")
        assert legacy.config["na_policy"] == "remove_sample"
        assert legacy.config["global_params"]["na_policy"] == "remove_sample"

    def test_missing_file_is_safe(self, isolated_config):
        # No dataset_links.json on disk: default structure, no crash, no write.
        assert not isolated_config._dataset_links_path.exists()
        data = isolated_config._load_dataset_links()
        assert data["datasets"] == []
        assert not isolated_config._dataset_links_path.exists()

    def test_empty_datasets_is_safe(self, isolated_config):
        payload = {"version": "1.0", "datasets": [], "groups": []}
        path = self._write(isolated_config, payload)
        before_mtime = path.stat().st_mtime_ns

        data = isolated_config._load_dataset_links()

        assert data["datasets"] == []
        # No legacy values -> no rewrite.
        assert path.stat().st_mtime_ns == before_mtime

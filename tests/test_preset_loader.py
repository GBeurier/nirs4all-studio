"""Tests for canonical preset file loading."""

from __future__ import annotations

import json

import pytest
import yaml
from fastapi import HTTPException

from api import preset_loader
from api.pipeline_canonical import canonical_to_editor, editor_to_canonical
from api.pipelines import _semantic_pipeline_template

LISTED_PRESET_IDS = {
    "pls_basic",
    "pls_derivative",
    "rf_standard",
    "kennard_stone_pls",
    "advanced_nirs",
    "pls_spxy_cartesian_finetune",
}


class TestListPresets:
    def test_returns_all_shipped_files(self):
        entries = preset_loader.list_presets()
        ids = {entry["id"] for entry in entries}
        assert ids == LISTED_PRESET_IDS

    def test_listing_entries_omit_pipeline_block(self):
        for entry in preset_loader.list_presets():
            assert "pipeline" not in entry
            assert "steps" not in entry
            assert isinstance(entry["steps_count"], int)
            assert entry["steps_count"] > 0

    def test_listing_entries_have_required_metadata(self):
        for entry in preset_loader.list_presets():
            assert entry["task_type"] in ("regression", "classification")
            assert entry["name"]
            assert entry["description"]


class TestLoadPreset:
    def test_load_each_shipped_preset_by_id(self):
        for preset_id in LISTED_PRESET_IDS:
            preset = preset_loader.load_preset(preset_id)
            assert preset["id"] == preset_id
            assert isinstance(preset["pipeline"], list)
            assert len(preset["pipeline"]) > 0

    def test_load_unknown_preset_raises_404(self):
        with pytest.raises(HTTPException) as exc:
            preset_loader.load_preset("does_not_exist")
        assert exc.value.status_code == 404


class TestCanonicalPresetContract:
    def test_shipped_presets_roundtrip_through_editor_semantics(self):
        for preset_id in LISTED_PRESET_IDS:
            preset = preset_loader.load_preset(preset_id)

            editor_steps = canonical_to_editor(
                {
                    "name": preset["name"],
                    "description": preset["description"],
                    "pipeline": preset["pipeline"],
                }
            )
            roundtrip = editor_to_canonical(
                editor_steps,
                name=preset["name"],
                description=preset["description"],
                include_wrapper=True,
            )

            assert _semantic_pipeline_template(
                roundtrip["pipeline"],
                name=roundtrip["name"],
                description=roundtrip["description"],
            ) == _semantic_pipeline_template(
                preset["pipeline"],
                name=preset["name"],
                description=preset["description"],
            )


class TestPresetFileParsing:
    def test_yaml_file_round_trip(self, tmp_path, monkeypatch):
        custom_dir = tmp_path / "presets"
        custom_dir.mkdir()
        (custom_dir / "demo.yaml").write_text(
            yaml.safe_dump(
                {
                    "id": "demo_preset",
                    "name": "Demo",
                    "description": "Yaml demo",
                    "task_type": "regression",
                    "pipeline": [
                        "sklearn.preprocessing._data.StandardScaler",
                        {
                            "model": {
                                "class": "sklearn.cross_decomposition._pls.PLSRegression",
                                "params": {"n_components": 5},
                            }
                        },
                    ],
                },
                sort_keys=False,
            ),
            encoding="utf-8",
        )
        monkeypatch.setattr(preset_loader, "PRESETS_DIR", custom_dir)

        entries = preset_loader.list_presets()
        assert [entry["id"] for entry in entries] == ["demo_preset"]

        preset = preset_loader.load_preset("demo_preset")
        assert preset["pipeline"][0] == "sklearn.preprocessing._data.StandardScaler"

    def test_json_file_round_trip(self, tmp_path, monkeypatch):
        custom_dir = tmp_path / "presets"
        custom_dir.mkdir()
        (custom_dir / "demo.json").write_text(
            json.dumps(
                {
                    "id": "demo_json",
                    "name": "Demo JSON",
                    "description": "JSON demo",
                    "task_type": "classification",
                    "pipeline": ["sklearn.preprocessing._data.StandardScaler"],
                }
            ),
            encoding="utf-8",
        )
        monkeypatch.setattr(preset_loader, "PRESETS_DIR", custom_dir)

        preset = preset_loader.load_preset("demo_json")
        assert preset["task_type"] == "classification"

    def test_invalid_file_is_skipped(self, tmp_path, monkeypatch):
        custom_dir = tmp_path / "presets"
        custom_dir.mkdir()
        (custom_dir / "broken.yaml").write_text("id: broken\nname: Broken\n", encoding="utf-8")
        (custom_dir / "good.yaml").write_text(
            yaml.safe_dump(
                {
                    "id": "good",
                    "name": "Good",
                    "description": "ok",
                    "task_type": "regression",
                    "pipeline": ["sklearn.preprocessing._data.StandardScaler"],
                }
            ),
            encoding="utf-8",
        )
        monkeypatch.setattr(preset_loader, "PRESETS_DIR", custom_dir)

        entries = preset_loader.list_presets()
        ids = [entry["id"] for entry in entries]
        assert ids == ["good"]

    def test_invalid_task_type_rejected(self, tmp_path, monkeypatch):
        custom_dir = tmp_path / "presets"
        custom_dir.mkdir()
        (custom_dir / "bad_task.yaml").write_text(
            yaml.safe_dump(
                {
                    "id": "bad_task",
                    "name": "Bad",
                    "description": "x",
                    "task_type": "magic",
                    "pipeline": ["sklearn.preprocessing._data.StandardScaler"],
                }
            ),
            encoding="utf-8",
        )
        monkeypatch.setattr(preset_loader, "PRESETS_DIR", custom_dir)

        assert preset_loader.list_presets() == []
        with pytest.raises(HTTPException) as exc:
            preset_loader.load_preset("bad_task")
        assert exc.value.status_code == 404

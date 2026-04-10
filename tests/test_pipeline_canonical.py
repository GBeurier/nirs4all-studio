from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest
import yaml
from nirs4all.pipeline.config.generator import count_combinations

import api.pipelines as pipelines_api
from api.nirs4all_adapter import expand_pipeline_variants
from api.pipeline_canonical import (
    canonical_to_editor,
    count_runtime_variants,
    editor_steps_to_runtime_canonical,
    editor_to_canonical,
)
from api.pipelines import (
    PipelineCanonicalImportRequest,
    PipelineCanonicalRenderRequest,
    PipelineExportRequest,
    _semantic_pipeline_template,
    create_pipeline_from_preset,
    export_pipeline,
    import_pipeline,
    preview_pipeline_import,
    render_canonical_pipeline,
)


def _load_payload(path: Path) -> dict:
    if path.suffix == ".json":
        return json.loads(path.read_text(encoding="utf-8"))
    return yaml.safe_load(path.read_text(encoding="utf-8"))


@pytest.fixture
def pipelines_workspace(tmp_path, monkeypatch):
    pipelines_dir = tmp_path / "pipelines"
    pipelines_dir.mkdir()
    monkeypatch.setattr(
        pipelines_api.workspace_manager,
        "get_pipelines_path",
        lambda: str(pipelines_dir),
    )
    return pipelines_dir


@pytest.mark.parametrize(
    "path",
    [
        Path("d:/nirs4all/nirs4all-webapp/api/presets/pls_finetune_advanced.yaml"),
        Path("d:/nirs4all/nirs4all/examples/pipeline_samples/08_complex_finetune.json"),
        Path("d:/nirs4all/nirs4all/examples/pipeline_samples/09_filters_splits.yaml"),
    ],
)
def test_canonical_roundtrip_matches_library_semantics(path: Path):
    payload = _load_payload(path)
    editor_steps = canonical_to_editor(payload)
    roundtrip = editor_to_canonical(
        editor_steps,
        name=payload.get("name", ""),
        description=payload.get("description", ""),
        include_wrapper=True,
    )

    expected = _semantic_pipeline_template(
        payload["pipeline"],
        name=payload.get("name", ""),
        description=payload.get("description", ""),
    )
    actual = _semantic_pipeline_template(
        roundtrip["pipeline"],
        name=roundtrip.get("name", ""),
        description=roundtrip.get("description", ""),
    )

    assert actual == expected


def test_separation_branch_imports_as_editable_branch_and_exports_unchanged():
    source = [
        {
            "branch": {
                "by_tag": "y_outlier_iqr",
                "steps": {
                    True: ["sklearn.preprocessing._data.StandardScaler"],
                    False: ["sklearn.preprocessing._data.MinMaxScaler"],
                },
            }
        },
        {"merge": "concat"},
    ]

    editor_steps = canonical_to_editor(source)

    assert editor_steps[0]["branchMode"] == "separation"
    assert "rawNirs4all" not in editor_steps[0] or editor_steps[0]["rawNirs4all"] is None
    assert editor_steps[0]["separationConfig"]["kind"] == "by_tag"
    assert editor_steps[0]["separationConfig"]["key"] == "y_outlier_iqr"
    assert editor_steps[0]["branchMetadata"][0]["value"] is True
    assert editor_steps[0]["branchMetadata"][1]["value"] is False

    roundtrip = editor_to_canonical(editor_steps)
    assert roundtrip == source


def test_scalar_generators_import_as_editable_steps_and_export_unchanged():
    source = [
        {"_grid_": {"alpha": [0.1, 1.0], "n_estimators": [50, 100]}},
        {"_zip_": {"a": [1, 2], "b": ["x", "y"]}},
        {"_sample_": {"distribution": "normal", "mean": 0, "std": 1, "num": 5}},
    ]

    editor_steps = canonical_to_editor(source)

    assert editor_steps[0]["generatorKind"] == "grid"
    assert editor_steps[0]["scalarGeneratorConfig"]["entries"][0]["key"] == "alpha"
    assert editor_steps[1]["generatorKind"] == "zip"
    assert editor_steps[1]["scalarGeneratorConfig"]["entries"][1]["key"] == "b"
    assert editor_steps[2]["generatorKind"] == "sample"
    assert editor_steps[2]["scalarGeneratorConfig"]["sample"]["distribution"] == "normal"

    assert editor_to_canonical(editor_steps) == source


def test_shared_separation_branch_roundtrips_to_list_steps():
    source = [
        {
            "branch": {
                "by_metadata": "instrument",
                "steps": ["sklearn.preprocessing._data.StandardScaler"],
            }
        }
    ]

    editor_steps = canonical_to_editor(source)

    assert editor_steps[0]["branchMode"] == "separation"
    assert editor_steps[0]["separationConfig"]["sharedSteps"] is True
    assert len(editor_steps[0]["branches"]) == 1

    assert editor_to_canonical(editor_steps) == source


def test_create_pipeline_from_advanced_preset_preserves_generators_and_search_space(
    pipelines_workspace,
):
    result = asyncio.run(create_pipeline_from_preset("pls_spxy_cartesian_finetune"))
    pipeline = result["pipeline"]
    steps = pipeline["steps"]

    assert pipeline["category"] == "preset"
    assert steps[1]["generatorKind"] == "cartesian"
    assert steps[1]["subType"] == "generator"

    search_space = steps[-1]["finetuneConfig"]["model_params"][0]
    assert search_space["rawValue"] == ["int", 1, 25]
    assert steps[-1]["finetuneSampler"] == "binary"


def test_export_and_reimport_pipeline_json_uses_canonical_contract(pipelines_workspace):
    created = asyncio.run(create_pipeline_from_preset("pls_spxy_cartesian_finetune"))
    pipeline_id = created["pipeline"]["id"]

    exported = asyncio.run(
        export_pipeline(pipeline_id, PipelineExportRequest(format="json"))
    )
    exported_payload = json.loads(exported["content"])

    assert "pipeline" in exported_payload
    assert "steps" not in exported_payload
    assert any("_cartesian_" in step for step in exported_payload["pipeline"])

    imported = asyncio.run(
        import_pipeline(
            PipelineCanonicalImportRequest(
                content=exported["content"],
                format="json",
                name="Imported Advanced",
            )
        )
    )
    imported_steps = imported["pipeline"]["steps"]

    assert imported_steps[1]["generatorKind"] == "cartesian"
    assert imported_steps[-1]["finetuneConfig"]["model_params"][0]["rawValue"] == [
        "int",
        1,
        25,
    ]


def test_preview_pipeline_import_supports_yaml_content():
    yaml_content = Path(
        "d:/nirs4all/nirs4all-webapp/api/presets/pls_finetune_advanced.yaml"
    ).read_text(encoding="utf-8")

    preview = asyncio.run(
        preview_pipeline_import(
            PipelineCanonicalImportRequest(
                content=yaml_content,
                format="yaml",
            )
        )
    )

    assert preview["success"] is True
    assert preview["steps"][1]["generatorKind"] == "cartesian"
    assert preview["steps"][-1]["finetuneConfig"]["model_params"][0]["rawValue"] == [
        "int",
        1,
        25,
    ]


def test_render_canonical_pipeline_preview_matches_export_payload(pipelines_workspace):
    created = asyncio.run(create_pipeline_from_preset("pls_spxy_cartesian_finetune"))
    pipeline = created["pipeline"]

    preview = asyncio.run(
        render_canonical_pipeline(
            PipelineCanonicalRenderRequest(
                steps=pipeline["steps"],
                name=pipeline["name"],
                description=pipeline.get("description"),
            )
        )
    )

    assert preview["success"] is True
    assert json.loads(preview["json"]) == preview["payload"]
    assert yaml.safe_load(preview["yaml"]) == preview["payload"]
    assert any("_cartesian_" in step for step in preview["payload"]["pipeline"])


def test_runtime_canonical_count_matches_library_for_advanced_preset():
    payload = _load_payload(
        Path("d:/nirs4all/nirs4all-webapp/api/presets/pls_finetune_advanced.yaml")
    )
    editor_steps = canonical_to_editor(payload)
    runtime_pipeline = editor_steps_to_runtime_canonical(editor_steps)

    assert count_runtime_variants(runtime_pipeline) == count_combinations(payload["pipeline"])


def test_variant_expansion_returns_fully_expanded_canonical_variants(monkeypatch):
    payload = _load_payload(
        Path("d:/nirs4all/nirs4all-webapp/api/presets/pls_finetune_advanced.yaml")
    )
    editor_steps = canonical_to_editor(payload)
    monkeypatch.setattr("api.nirs4all_adapter.require_nirs4all", lambda: None)
    variants = expand_pipeline_variants(editor_steps)

    assert len(variants) == count_combinations(payload["pipeline"])
    assert variants
    assert all(count_combinations(variant.steps) == 1 for variant in variants)

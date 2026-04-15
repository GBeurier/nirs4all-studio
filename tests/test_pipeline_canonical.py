from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest
import yaml
from nirs4all.pipeline.config.generator import count_combinations

import api.pipelines as pipelines_api
from api.nirs4all_adapter import build_full_pipeline, check_pipeline_imports, expand_pipeline_variants
from api.pipeline_canonical import (
    canonical_to_editor,
    count_runtime_variants,
    editor_steps_to_runtime_canonical,
    editor_to_canonical,
)
from api.pipelines import (
    PipelineCanonicalImportRequest,
    PipelineCanonicalRenderRequest,
    PipelineCreate,
    PipelineExportRequest,
    PipelineFromPresetRequest,
    _semantic_pipeline_template,
    create_pipeline,
    create_pipeline_from_preset,
    export_pipeline,
    import_pipeline,
    preview_pipeline_import,
    render_canonical_pipeline,
)

_WEBAPP_ROOT = Path(__file__).resolve().parent.parent


def _find_nirs4all_root() -> Path | None:
    """Find the nirs4all library root (CI: nirs4all-lib/, local: sibling dir)."""
    for candidate in [
        _WEBAPP_ROOT / "nirs4all-lib",       # CI checkout
        _WEBAPP_ROOT.parent / "nirs4all",     # local workspace sibling
    ]:
        if candidate.is_dir():
            return candidate
    return None


_NIRS4ALL_ROOT = _find_nirs4all_root()

_PRESET_ADVANCED = _WEBAPP_ROOT / "api/presets/pls_finetune_advanced.yaml"
_SAMPLE_08 = (_NIRS4ALL_ROOT / "examples/pipeline_samples/08_complex_finetune.json") if _NIRS4ALL_ROOT else None
_SAMPLE_09 = (_NIRS4ALL_ROOT / "examples/pipeline_samples/09_filters_splits.yaml") if _NIRS4ALL_ROOT else None


def _load_payload(path: Path) -> dict:
    if path.suffix == ".json":
        return json.loads(path.read_text(encoding="utf-8"))
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _canonical_wrapper_from_payload(
    payload: dict,
    variant: str | None = None,
) -> dict[str, object]:
    """Return a canonical `{name, description, pipeline}` wrapper."""
    if "pipeline" in payload:
        return {
            "name": payload.get("name", ""),
            "description": payload.get("description", ""),
            "pipeline": payload["pipeline"],
        }

    variants = payload.get("variants") or {}
    selected_variant = variant or payload.get("default_variant") or next(iter(variants))
    selected_payload = variants[selected_variant]
    return {
        "name": payload.get("name", ""),
        "description": payload.get("description", ""),
        "pipeline": selected_payload["pipeline"],
    }


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
        pytest.param(_PRESET_ADVANCED, id="preset_advanced"),
        pytest.param(_SAMPLE_08, id="sample_08", marks=pytest.mark.skipif(_SAMPLE_08 is None or not (_SAMPLE_08 and _SAMPLE_08.exists()), reason="nirs4all examples not found")),
        pytest.param(_SAMPLE_09, id="sample_09", marks=pytest.mark.skipif(_SAMPLE_09 is None or not (_SAMPLE_09 and _SAMPLE_09.exists()), reason="nirs4all examples not found")),
    ],
)
def test_canonical_roundtrip_matches_library_semantics(path: Path):
    raw_payload = _load_payload(path)
    payload = _canonical_wrapper_from_payload(raw_payload)
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


def test_canonical_to_editor_resolves_saved_chain_short_class_names():
    editor_steps = canonical_to_editor(
        [
            {"class": "StandardNormalVariate"},
            {
                "class": "KennardStoneSplitter",
                "params": {"test_size": 0.2, "metric": "euclidean"},
            },
            {
                "model": {
                    "class": "PLSRegression",
                    "params": {"n_components": 8},
                }
            },
        ]
    )

    assert [step["type"] for step in editor_steps] == [
        "preprocessing",
        "splitting",
        "model",
    ]
    assert editor_steps[0]["name"] == "SNV"
    assert (
        editor_steps[0]["classPath"]
        == "nirs4all.operators.transforms.StandardNormalVariate"
    )
    assert editor_steps[1]["name"] == "KennardStone"
    assert (
        editor_steps[1]["classPath"]
        == "nirs4all.operators.splitters.KennardStoneSplitter"
    )
    assert editor_steps[2]["name"] == "PLSRegression"
    assert (
        editor_steps[2]["classPath"]
        == "sklearn.cross_decomposition.PLSRegression"
    )
    assert editor_steps[2]["params"] == {"n_components": 8}


def test_canonical_to_editor_normalizes_legacy_boosting_model_paths():
    editor_steps = canonical_to_editor(
        [
            {
                "model": {
                    "class": "xgboost.sklearn.XGBClassifier",
                    "params": {"n_estimators": 25},
                }
            },
            {
                "model": {
                    "class": "lightgbm.sklearn.LGBMRegressor",
                    "params": {"n_estimators": 10},
                }
            },
        ]
    )

    assert editor_steps[0]["name"] == "XGBoostClassifier"
    assert editor_steps[0]["classPath"] == "xgboost.XGBClassifier"
    assert editor_steps[1]["name"] == "LightGBM"
    assert editor_steps[1]["classPath"] == "lightgbm.LGBMRegressor"


def test_editor_runtime_canonical_resolves_boosting_classifier_names_without_classpath():
    steps = [
        {
            "id": "xgb-clf",
            "type": "model",
            "name": "XGBoostClassifier",
            "params": {"n_estimators": 10},
        },
        {
            "id": "lgbm-clf",
            "type": "model",
            "name": "LightGBMClassifier",
            "params": {"n_estimators": 10},
        },
    ]

    canonical = editor_steps_to_runtime_canonical(steps)

    assert canonical == [
        {
            "model": {
                "class": "xgboost.XGBClassifier",
                "params": {"n_estimators": 10},
            }
        },
        {
            "model": {
                "class": "lightgbm.LGBMClassifier",
                "params": {"n_estimators": 10},
            }
        },
    ]


def test_import_check_accepts_boosting_classifier_names_without_classpath():
    steps = [
        {
            "id": "xgb-clf",
            "type": "model",
            "name": "XGBoostClassifier",
            "params": {"n_estimators": 10},
        },
        {
            "id": "lgbm-clf",
            "type": "model",
            "name": "LightGBMClassifier",
            "params": {"n_estimators": 10},
        },
    ]

    assert check_pipeline_imports(steps) == []


def test_create_pipeline_from_advanced_preset_preserves_generators_and_search_space(
    pipelines_workspace,
):
    result = asyncio.run(
        create_pipeline_from_preset(
            "pls_spxy_cartesian_finetune",
            PipelineFromPresetRequest(variant="regression"),
        )
    )
    pipeline = result["pipeline"]
    steps = pipeline["steps"]

    assert pipeline["category"] == "preset"
    assert pipeline["task_type"] == "regression"
    assert steps[1]["generatorKind"] == "cartesian"
    assert steps[1]["subType"] == "generator"

    search_space = steps[-1]["finetuneConfig"]["model_params"][0]
    assert search_space["rawValue"] == ["int", 1, 25]
    assert steps[-1]["finetuneSampler"] == "binary"


def test_create_pipeline_from_preset_persists_selected_classification_variant(
    pipelines_workspace,
):
    result = asyncio.run(
        create_pipeline_from_preset(
            "pls_basic",
            PipelineFromPresetRequest(variant="classification"),
        )
    )
    pipeline = result["pipeline"]

    assert pipeline["task_type"] == "classification"
    assert pipeline["steps"][-1]["name"] in {"PLSDA", "LogisticRegression"}


def test_export_and_reimport_pipeline_json_uses_canonical_contract(pipelines_workspace):
    created = asyncio.run(
        create_pipeline_from_preset(
            "pls_spxy_cartesian_finetune",
            PipelineFromPresetRequest(variant="regression"),
        )
    )
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
    payload = _canonical_wrapper_from_payload(_load_payload(_PRESET_ADVANCED))
    yaml_content = yaml.safe_dump(payload, sort_keys=False)

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
    created = asyncio.run(
        create_pipeline_from_preset(
            "pls_spxy_cartesian_finetune",
            PipelineFromPresetRequest(variant="regression"),
        )
    )
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
    payload = _canonical_wrapper_from_payload(_load_payload(_PRESET_ADVANCED))
    editor_steps = canonical_to_editor(payload)
    runtime_pipeline = editor_steps_to_runtime_canonical(editor_steps)

    assert count_runtime_variants(runtime_pipeline) == count_combinations(payload["pipeline"])


def test_editor_to_canonical_resolves_ridge_without_cross_decomposition():
    editor_steps = [
        {
            "id": "step-ridge",
            "type": "model",
            "name": "Ridge",
            "params": {"alpha": 1.0},
        }
    ]

    canonical = editor_to_canonical(editor_steps)

    model_payload = canonical[0]["model"]
    assert model_payload["class"].startswith("sklearn.linear_model")
    assert model_payload["class"].endswith("Ridge")
    assert "cross_decomposition" not in model_payload["class"]
    assert model_payload["params"] == {"alpha": 1.0}


def test_create_pipeline_hydrates_fresh_saved_steps(pipelines_workspace):
    created = asyncio.run(
        create_pipeline(
            PipelineCreate(
                name="Fresh Ridge",
                description="",
                steps=[
                    {
                        "id": "step-ridge",
                        "type": "model",
                        "name": "Ridge",
                        "params": {"alpha": 1.0},
                    }
                ],
            )
        )
    )

    class_path = created["pipeline"]["steps"][0]["classPath"]
    assert class_path.startswith("sklearn.linear_model")
    assert class_path.endswith("Ridge")
    assert "cross_decomposition" not in class_path


def test_create_pipeline_canonicalizes_incorrect_known_model_classpath(pipelines_workspace):
    created = asyncio.run(
        create_pipeline(
            PipelineCreate(
                name="Fresh OPLS",
                description="",
                steps=[
                    {
                        "id": "step-opls",
                        "type": "model",
                        "name": "OPLS",
                        "classPath": "sklearn.cross_decomposition.OPLS",
                        "params": {},
                    }
                ],
            )
        )
    )

    class_path = created["pipeline"]["steps"][0]["classPath"]
    assert class_path.startswith("nirs4all.operators.models")
    assert class_path.endswith("OPLS")
    assert "cross_decomposition" not in class_path


def test_editor_to_canonical_serializes_function_models_from_classpath():
    editor_steps = [
        {
            "id": "step-nicon",
            "type": "model",
            "name": "NICoN",
            "classPath": "nirs4all.operators.models.pytorch.nicon.nicon",
            "params": {"dropout": 0.2},
        }
    ]

    canonical = editor_to_canonical(editor_steps)

    model_payload = canonical[0]["model"]
    assert model_payload["function"] == "nirs4all.operators.models.nicon"
    assert model_payload["params"] == {"dropout": 0.2}


def test_editor_to_canonical_preserves_tabicl_class_model_path():
    editor_steps = [
        {
            "id": "step-tabicl-clf",
            "type": "model",
            "name": "TabICLClassifier",
            "classPath": "tabicl.TabICLClassifier",
            "params": {},
        }
    ]

    canonical = editor_to_canonical(editor_steps)

    assert canonical == [
        {
            "model": {
                "class": "tabicl.TabICLClassifier",
            }
        }
    ]


def test_canonical_to_editor_keeps_tabicl_model_as_model_step():
    editor_steps = canonical_to_editor(
        [
            {
                "model": {
                    "class": "tabicl.TabICLRegressor",
                }
            }
        ]
    )

    assert len(editor_steps) == 1
    assert editor_steps[0]["type"] == "model"
    assert editor_steps[0]["name"] == "TabICLRegressor"
    assert editor_steps[0]["classPath"] == "tabicl.TabICLRegressor"
    assert editor_steps[0]["modelStyle"] == "class_dict"
    assert editor_steps[0]["params"] == {}


def test_check_pipeline_imports_prefers_function_model_classpath(monkeypatch):
    seen: list[tuple[str, str]] = []

    def fake_resolve(name: str, step_type: str):
        seen.append((name, step_type))
        return object()

    monkeypatch.setattr("api.nirs4all_adapter._resolve_operator_class", fake_resolve)

    issues = check_pipeline_imports([
        {
            "id": "step-nicon",
            "type": "model",
            "name": "NICoN",
            "classPath": "nirs4all.operators.models.pytorch.nicon.nicon",
            "params": {},
        }
    ])

    assert issues == []
    assert seen == [("nirs4all.operators.models.pytorch.nicon.nicon", "model")]


def test_check_pipeline_imports_prefers_class_model_classpath(monkeypatch):
    seen: list[tuple[str, str]] = []

    def fake_resolve(name: str, step_type: str):
        seen.append((name, step_type))
        return object()

    monkeypatch.setattr("api.nirs4all_adapter._resolve_operator_class", fake_resolve)

    issues = check_pipeline_imports([
        {
            "id": "step-tabicl",
            "type": "model",
            "name": "TabICLClassifier",
            "classPath": "tabicl.TabICLClassifier",
            "params": {},
        }
    ])

    assert issues == []
    assert seen == [("tabicl.TabICLClassifier", "model")]


def test_build_full_pipeline_prefers_class_model_classpath(monkeypatch):
    seen: list[tuple[str, str]] = []

    class DummyModel:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    def fake_resolve(name: str, step_type: str):
        seen.append((name, step_type))
        return DummyModel

    monkeypatch.setattr("api.nirs4all_adapter._resolve_operator_class", fake_resolve)

    result = build_full_pipeline([
        {
            "id": "step-tabicl",
            "type": "model",
            "name": "TabICLClassifier",
            "classPath": "tabicl.TabICLClassifier",
            "params": {},
        }
    ])

    assert seen == [("tabicl.TabICLClassifier", "model")]
    assert len(result.steps) == 1
    assert isinstance(result.steps[0]["model"], DummyModel)


def test_render_canonical_pipeline_rejects_unknown_model_definition():
    with pytest.raises(Exception, match="Could not resolve class path for model step 'DefinitelyNotAModel'"):
        asyncio.run(
            render_canonical_pipeline(
                PipelineCanonicalRenderRequest(
                    steps=[
                        {
                            "id": "step-unknown",
                            "type": "model",
                            "name": "DefinitelyNotAModel",
                            "params": {},
                        }
                    ],
                    name="broken",
                )
            )
        )


def test_variant_expansion_returns_fully_expanded_canonical_variants(monkeypatch):
    payload = _canonical_wrapper_from_payload(_load_payload(_PRESET_ADVANCED))
    editor_steps = canonical_to_editor(payload)
    monkeypatch.setattr("api.nirs4all_adapter.require_nirs4all", lambda: None)
    variants = expand_pipeline_variants(editor_steps)

    assert len(variants) == count_combinations(payload["pipeline"])
    assert variants
    assert all(count_combinations(variant.steps) == 1 for variant in variants)

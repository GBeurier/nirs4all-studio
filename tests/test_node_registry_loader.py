import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from api.nirs4all_adapter import _operator_reference_from_step
from api.node_registry_loader import load_editor_registry_reference
from api.pipeline_canonical import resolve_editor_class_path


def test_editor_registry_falls_back_to_public_registry_when_src_nodes_absent(tmp_path, monkeypatch):
    from api import node_registry_loader

    public_dir = tmp_path / "public" / "node-registry"
    public_dir.mkdir(parents=True)
    (public_dir / "extended.json").write_text(
        json.dumps([
            {
                "id": "model.public_fallback",
                "name": "PublicFallback",
                "type": "model",
                "classPath": "example.PublicFallback",
            }
        ]),
        encoding="utf-8",
    )

    monkeypatch.setattr(node_registry_loader, "_DEFINITIONS_DIR", tmp_path / "missing-definitions")
    monkeypatch.setattr(node_registry_loader, "_GENERATED_DIR", tmp_path / "missing-generated")
    monkeypatch.setattr(node_registry_loader, "_PUBLIC_REGISTRY_DIR", public_dir)
    node_registry_loader.load_editor_registry_nodes.cache_clear()
    node_registry_loader.load_editor_registry_reference.cache_clear()

    try:
        reference = node_registry_loader.load_editor_registry_reference()
    finally:
        node_registry_loader.load_editor_registry_nodes.cache_clear()
        node_registry_loader.load_editor_registry_reference.cache_clear()

    assert reference["version"] == "public-node-registry"
    assert reference["totalNodes"] == 1
    assert reference["nodes"][0]["id"] == "model.public_fallback"


def _node_by_id(nodes: list[dict], node_id: str) -> dict:
    match = next((node for node in nodes if node.get("id") == node_id), None)
    assert match is not None, f"Missing node '{node_id}' in editor registry"
    return match


def test_editor_registry_prefers_curated_definitions_for_problem_nodes():
    reference = load_editor_registry_reference()
    nodes = reference["nodes"]

    assert _node_by_id(nodes, "preprocessing.baseline_correction")["classPath"] == (
        "nirs4all.operators.transforms.signal.Baseline"
    )
    assert _node_by_id(nodes, "preprocessing.moving_average")["classPath"] == (
        "nirs4all.operators.transforms.SavitzkyGolay"
    )
    assert _node_by_id(nodes, "model.nicon")["classPath"] == (
        "nirs4all.operators.models.pytorch.nicon.nicon"
    )
    assert _node_by_id(nodes, "model.cnn1d")["classPath"] == (
        "nirs4all.operators.models.pytorch.nicon.customizable_nicon"
    )
    assert _node_by_id(nodes, "model.transformer")["classPath"] == (
        "nirs4all.operators.models.pytorch.spectral_transformer.spectral_transformer"
    )
    assert _node_by_id(nodes, "model.tabpfn")["classPath"] == "tabpfn.TabPFNRegressor"

    # The classifier counterparts must also exist in the backend reference.
    assert _node_by_id(nodes, "model.nicon_classifier")["classPath"] == (
        "nirs4all.operators.models.pytorch.nicon.nicon_classification"
    )
    assert _node_by_id(nodes, "model.cnn1d_classifier")["classPath"] == (
        "nirs4all.operators.models.pytorch.nicon.customizable_nicon_classification"
    )
    assert _node_by_id(nodes, "model.transformer_classifier")["classPath"] == (
        "nirs4all.operators.models.pytorch.spectral_transformer.spectral_transformer_classification"
    )
    assert _node_by_id(nodes, "model.tabpfn_classifier")["classPath"] == "tabpfn.TabPFNClassifier"


def test_resolve_editor_class_path_canonicalizes_legacy_problem_paths():
    assert resolve_editor_class_path(
        "preprocessing",
        "BaselineCorrection",
        "nirs4all.operators.transforms.BaselineCorrection",
    ) == "nirs4all.operators.transforms.signal.Baseline"
    assert resolve_editor_class_path(
        "preprocessing",
        "MovingAverage",
        "nirs4all.operators.transforms.MovingAverage",
    ) == "nirs4all.operators.transforms.SavitzkyGolay"
    assert resolve_editor_class_path(
        "model",
        "NICoN",
        "nirs4all.operators.models.nicon",
    ) == "nirs4all.operators.models.pytorch.nicon.nicon"
    assert resolve_editor_class_path(
        "model",
        "CNN1D",
        "nirs4all.operators.models.CNN1D",
    ) == "nirs4all.operators.models.pytorch.nicon.customizable_nicon"
    assert resolve_editor_class_path(
        "model",
        "Transformer",
        "nirs4all.operators.models.Transformer",
    ) == "nirs4all.operators.models.pytorch.spectral_transformer.spectral_transformer"
    assert resolve_editor_class_path(
        "model",
        "TabPFN",
        "nirs4all.operators.models.TabPFN",
    ) == "tabpfn.TabPFNRegressor"


def test_operator_reference_from_step_uses_canonical_paths():
    assert _operator_reference_from_step(
        {
            "id": "preprocessing.baseline_correction",
            "name": "BaselineCorrection",
            "type": "preprocessing",
            "classPath": "nirs4all.operators.transforms.BaselineCorrection",
        },
        "preprocessing",
    ) == "nirs4all.operators.transforms.signal.Baseline"

    assert _operator_reference_from_step(
        {
            "id": "model.transformer",
            "name": "Transformer",
            "type": "model",
            "classPath": "nirs4all.operators.models.Transformer",
        },
        "model",
    ) == "nirs4all.operators.models.pytorch.spectral_transformer.spectral_transformer"

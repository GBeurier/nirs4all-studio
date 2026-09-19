"""Palette neural controls must configure actual architecture and trainer fields."""
from copy import deepcopy

import pytest

from api.neural_parameters import split_neural_parameters
from api.node_registry_loader import load_editor_registry_nodes
from api.pipeline_canonical import editor_steps_to_runtime_canonical

NODES = {node["id"]: node for node in load_editor_registry_nodes()}
NEURAL_IDS = ["model.nicon", "model.nicon_classifier", "model.cnn1d", "model.cnn1d_classifier", "model.transformer", "model.transformer_classifier"]


def editor_node(identifier):
    node = deepcopy(NODES[identifier])
    node["params"] = {parameter["name"]: parameter["default"] for parameter in node["parameters"] if "default" in parameter}
    node["params"].update(epochs=10, learning_rate=.002, batch_size=8)
    return node


@pytest.mark.parametrize("identifier", NEURAL_IDS)
def test_all_six_neural_nodes_route_training_parameters(identifier):
    node = editor_node(identifier)
    canonical = editor_steps_to_runtime_canonical([node])[0]
    assert canonical["train_params"] == {"epochs": 10, "learning_rate": .002, "batch_size": 8}
    model_params = canonical["model"].get("params", {})
    assert not ({"epochs", "learning_rate", "batch_size"} & model_params.keys())
    if "cnn1d" in identifier:
        assert model_params["filters1"] == 32
        assert model_params["kernel_size1"] == 7
        assert model_params["dropout_rate"] == .2
        assert not ({"n_filters", "kernel_size", "dropout"} & model_params.keys())
    if "transformer" in identifier:
        assert model_params["embed_dim"] == 64
        assert model_params["num_heads"] == 4
        assert model_params["depth"] == 2
        assert not ({"d_model", "nhead", "num_layers"} & model_params.keys())


def test_explicit_training_config_takes_precedence_over_palette_default():
    node = editor_node("model.nicon")
    node["trainingConfig"] = {"epochs": 21}
    assert editor_steps_to_runtime_canonical([node])[0]["train_params"]["epochs"] == 21


def test_alias_conflicts_are_explicit_and_sklearn_parameters_unchanged():
    path = NODES["model.cnn1d"]["classPath"]
    with pytest.raises(ValueError, match="Conflicting neural parameters"):
        split_neural_parameters(path, {"n_filters": 8, "filters1": 16})
    assert split_neural_parameters("sklearn.neural_network.MLPRegressor", {"batch_size": 12}) == ({"batch_size": 12}, {})


def test_neural_parameter_sweeps_target_owner_and_training_fields():
    node = editor_node("model.cnn1d")
    node["paramSweeps"] = {"epochs": {"type": "or", "choices": [10, 20]}, "n_filters": {"type": "or", "choices": [8, 16]}}
    canonical = editor_steps_to_runtime_canonical([node])[0]
    assert canonical["train_params"]["epochs"] == {"_or_": [10, 20]}
    assert canonical["model"]["params"]["filters1"] == {"_or_": [8, 16]}
    assert "epochs" not in canonical["model"]["params"]


def test_neural_finetuning_routes_training_and_architecture_search_spaces():
    node = editor_node("model.transformer")
    node["finetuneConfig"] = {"enabled": True, "n_trials": 2,
        "model_params": [{"name": "epochs", "type": "int", "min": 10, "max": 20},
                         {"name": "d_model", "type": "int", "min": 16, "max": 32}]}
    config = editor_steps_to_runtime_canonical([node])[0]["finetune_params"]
    assert "epochs" in config["train_params"] and "epochs" not in config["model_params"]
    assert "embed_dim" in config["model_params"] and "d_model" not in config["model_params"]

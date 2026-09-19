"""Translate neural editor controls to their owner's model/training contracts."""
from __future__ import annotations

from typing import Any

_PREFIX = "nirs4all.operators.models.pytorch."
_ALIASES = {
    "customizable_nicon": {"n_filters": "filters1", "kernel_size": "kernel_size1", "dropout": "dropout_rate"},
    "customizable_nicon_classification": {"n_filters": "filters1", "kernel_size": "kernel_size1", "dropout": "dropout_rate"},
    "spectral_transformer": {"d_model": "embed_dim", "nhead": "num_heads", "num_layers": "depth"},
    "spectral_transformer_classification": {"d_model": "embed_dim", "nhead": "num_heads", "num_layers": "depth"},
}
_TRAINING_KEYS = {"epochs", "learning_rate", "batch_size"}


def split_neural_parameters(class_path: str, parameters: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Keep numerical construction in the owner; map only named UI controls."""
    model = dict(parameters)
    if not class_path.startswith(_PREFIX):
        return model, {}
    training = {key: model.pop(key) for key in _TRAINING_KEYS if key in model}
    for alias, canonical in _ALIASES.get(class_path.rsplit(".", 1)[-1], {}).items():
        if alias not in model:
            continue
        value = model.pop(alias)
        if canonical in model and model[canonical] != value:
            raise ValueError(f"Conflicting neural parameters '{alias}' and '{canonical}'")
        model[canonical] = value
    return model, training

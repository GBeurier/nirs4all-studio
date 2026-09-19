"""Palette filter modes reach real owner controllers with aligned sample data."""
from copy import deepcopy
from types import SimpleNamespace

import numpy as np
import pytest

import api.shared  # noqa: F401
from api.pipeline_canonical import editor_steps_to_runtime_canonical


@pytest.mark.parametrize("filter_mode", ["remove", "tag"])
@pytest.mark.parametrize("name,params,flagged", [
    ("YOutlierFilter", {"method": "iqr", "threshold": 1.5}, [19]),
    ("MetadataFilter", {"column": "group", "values_to_exclude": ["g0"]}, [0, 4, 8, 12, 16]),
])
def test_palette_filters_change_real_sample_selection(filter_mode, name, params, flagged):
    from nirs4all.controllers.data.exclude import ExcludeController
    from nirs4all.controllers.data.tag import TagController
    from nirs4all.data.dataset import SpectroDataset
    from nirs4all.pipeline.config.context import DataSelector, ExecutionContext
    from nirs4all.pipeline.steps.parser import StepParser

    steps = [{"id": "filter", "type": "filter", "name": name,
              "classPath": f"nirs4all.operators.filters.{name}",
              "params": {"filter_mode": filter_mode, "tag_name": "flagged", **params}}]
    original = deepcopy(steps)
    canonical = editor_steps_to_runtime_canonical(steps)
    keyword = "exclude" if filter_mode == "remove" else "tag"
    assert "filter_mode" not in canonical[0][keyword]["params"]
    assert steps == original

    dataset = SpectroDataset("filters")
    dataset.add_samples(np.arange(120, dtype=float).reshape(20, 6), {"partition": "train"})
    dataset.add_targets(np.r_[np.linspace(0, 1, 19), 100.0])
    dataset.add_metadata(np.array([[f"g{i % 4}"] for i in range(20)]), headers=["group"])
    context = ExecutionContext(selector=DataSelector(partition="train", processing=[["raw"]]))
    runtime = SimpleNamespace(step_runner=SimpleNamespace(verbose=0), next_op=lambda: 1)
    controller = ExcludeController() if filter_mode == "remove" else TagController()
    controller.execute(StepParser().parse(canonical[0]), dataset, context, runtime)
    selected = dataset._indexer.x_indices(context.selector, include_excluded=False).tolist()
    if filter_mode == "remove":
        assert selected == [i for i in range(20) if i not in flagged]
    else:
        assert selected == list(range(20))
        assert np.flatnonzero(dataset.get_tag("flagged")).tolist() == flagged


def test_invalid_filter_mode_is_rejected():
    with pytest.raises(ValueError, match="Unknown filter mode"):
        editor_steps_to_runtime_canonical([{"id": "filter", "type": "filter", "name": "YOutlierFilter",
                                           "params": {"filter_mode": "unexpected"}}])

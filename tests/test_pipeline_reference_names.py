"""Preserve operator identity across the Playground/editor document boundary."""

import pytest

from api.pipeline_canonical import resolve_class_reference


@pytest.mark.parametrize("reference", ["SavitzkyGolay", "nirs4all.operators.transforms.SavitzkyGolay"])
@pytest.mark.parametrize("forced_type", [None, "preprocessing"])
def test_explicit_savitzky_golay_reference_does_not_restore_recipe_alias(reference, forced_type):
    resolved = resolve_class_reference(reference, forced_type=forced_type)
    assert resolved["name"] == "SavitzkyGolay"
    assert resolved["classPath"] == "nirs4all.operators.transforms.SavitzkyGolay"


def test_explicit_recipe_name_remains_available():
    resolved = resolve_class_reference("MovingAverage", forced_type="preprocessing")
    assert resolved["name"] == "MovingAverage"

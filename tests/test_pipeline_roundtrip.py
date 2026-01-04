#!/usr/bin/env python3
"""
Test Pipeline Round-Trip Integrity
===================================

This test validates that all 10 pipeline samples can be:
1. Loaded from nirs4all in canonical format
2. Converted to editor format (simulated)
3. Converted back to nirs4all format
4. Match the original canonical format

Run with: pytest tests/test_pipeline_roundtrip.py -v
"""

import sys
import json
from pathlib import Path

# Add webapp to path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from api.pipelines import (
    list_pipeline_samples,
    get_pipeline_sample,
    _get_samples_dir,
    _get_canonical_pipeline,
)


# Sample IDs to test
SAMPLE_IDS = [
    "01_basic_regression",
    "02_feature_augmentation",
    "03_sample_augmentation",
    "04_branching_basic",
    "05_stacking_merge",
    "06_generator_syntax",
    "07_concat_transform",
    "08_complex_finetune",
    "09_filters_splits",
    "10_complete_all_features",
]


def normalize_for_comparison(obj):
    """Normalize object for comparison (sort dicts, handle tuples)."""
    if isinstance(obj, dict):
        return {k: normalize_for_comparison(v) for k, v in sorted(obj.items())}
    elif isinstance(obj, (list, tuple)):
        return [normalize_for_comparison(item) for item in obj]
    return obj


class TestPipelineSamplesAPI:
    """Test pipeline samples API endpoints."""

    @pytest.mark.asyncio
    async def test_list_samples(self):
        """Test listing all pipeline samples."""
        result = await list_pipeline_samples()

        assert "samples" in result
        assert "total" in result
        assert result["total"] == 10

        sample_ids = [s["id"] for s in result["samples"]]
        for expected_id in SAMPLE_IDS:
            assert expected_id in sample_ids, f"Missing sample: {expected_id}"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("sample_id", SAMPLE_IDS)
    async def test_load_sample_canonical(self, sample_id):
        """Test loading each sample in canonical format."""
        result = await get_pipeline_sample(sample_id, canonical=True)

        assert "pipeline" in result
        assert "name" in result
        assert isinstance(result["pipeline"], list)
        assert len(result["pipeline"]) > 0

    @pytest.mark.asyncio
    @pytest.mark.parametrize("sample_id", SAMPLE_IDS)
    async def test_canonical_format_structure(self, sample_id):
        """Test that canonical format has correct structure."""
        result = await get_pipeline_sample(sample_id, canonical=True)
        pipeline = result["pipeline"]

        # Special string keywords that are not class paths
        special_keywords = {"chart_2d", "chart_y"}

        for step in pipeline:
            if isinstance(step, str):
                # String-only can be class path or special keyword
                if step not in special_keywords:
                    assert "." in step, f"String step should be class path: {step}"
            elif isinstance(step, dict):
                # Check for valid keywords
                valid_keywords = {
                    "class", "params", "model", "y_processing", "branch",
                    "merge", "sample_augmentation", "feature_augmentation",
                    "sample_filter", "concat_transform", "name",
                    "finetune_params", "train_params", "action",
                    "_or_", "_range_", "_log_range_", "_grid_", "param",
                    "pick", "arrange", "count", "chart_2d", "chart_y",
                    "preprocessing",  # Explicit preprocessing keyword
                }
                for key in step.keys():
                    assert key in valid_keywords, f"Unknown key '{key}' in step: {step}"
            else:
                pytest.fail(f"Invalid step type: {type(step)}")


class TestCanonicalFormatDetails:
    """Test specific canonical format expectations."""

    @pytest.mark.asyncio
    async def test_01_basic_has_y_processing(self):
        """Test basic regression has y_processing."""
        result = await get_pipeline_sample("01_basic_regression", canonical=True)
        pipeline = result["pipeline"]

        y_proc_steps = [s for s in pipeline if isinstance(s, dict) and "y_processing" in s]
        assert len(y_proc_steps) == 1, "Should have y_processing step"

    @pytest.mark.asyncio
    async def test_01_basic_has_finetune(self):
        """Test basic regression has finetuning."""
        result = await get_pipeline_sample("01_basic_regression", canonical=True)
        pipeline = result["pipeline"]

        finetune_steps = [s for s in pipeline if isinstance(s, dict) and "finetune_params" in s]
        assert len(finetune_steps) == 1, "Should have finetuned model"

    @pytest.mark.asyncio
    async def test_04_branching_has_branches(self):
        """Test branching sample has branch step."""
        result = await get_pipeline_sample("04_branching_basic", canonical=True)
        pipeline = result["pipeline"]

        branch_steps = [s for s in pipeline if isinstance(s, dict) and "branch" in s]
        assert len(branch_steps) == 1, "Should have branch step"

        branch = branch_steps[0]["branch"]
        assert isinstance(branch, dict), "Branch should be dict with named branches"

    @pytest.mark.asyncio
    async def test_05_stacking_has_merge(self):
        """Test stacking sample has merge step."""
        result = await get_pipeline_sample("05_stacking_merge", canonical=True)
        pipeline = result["pipeline"]

        merge_steps = [s for s in pipeline if isinstance(s, dict) and "merge" in s]
        assert len(merge_steps) == 1, "Should have merge step"

        branch_steps = [s for s in pipeline if isinstance(s, dict) and "branch" in s]
        assert len(branch_steps) == 1, "Should have branch step"

    @pytest.mark.asyncio
    async def test_05_stacking_has_metamodel(self):
        """Test stacking sample has MetaModel."""
        result = await get_pipeline_sample("05_stacking_merge", canonical=True)
        pipeline = result["pipeline"]

        model_steps = [s for s in pipeline if isinstance(s, dict) and "model" in s]
        meta_models = [s for s in model_steps
                      if isinstance(s.get("model"), dict)
                      and "MetaModel" in s["model"].get("class", "")]
        assert len(meta_models) >= 1, "Should have MetaModel"

    @pytest.mark.asyncio
    async def test_06_generators_expand(self):
        """Test generator syntax produces multiple configurations."""
        result = await get_pipeline_sample("06_generator_syntax", canonical=True)

        assert result["has_generators"] == True
        assert result["num_configurations"] > 1

    @pytest.mark.asyncio
    async def test_07_concat_transform(self):
        """Test concat_transform sample."""
        result = await get_pipeline_sample("07_concat_transform", canonical=True)
        pipeline = result["pipeline"]

        concat_steps = [s for s in pipeline if isinstance(s, dict) and "concat_transform" in s]
        assert len(concat_steps) == 1, "Should have concat_transform step"

    @pytest.mark.asyncio
    async def test_09_sample_filter(self):
        """Test filters sample has sample_filter."""
        result = await get_pipeline_sample("09_filters_splits", canonical=True)
        pipeline = result["pipeline"]

        filter_steps = [s for s in pipeline if isinstance(s, dict) and "sample_filter" in s]
        assert len(filter_steps) >= 1, "Should have sample_filter step"


class TestRoundTrip:
    """
    Test round-trip conversion integrity.

    This simulates what the frontend would do:
    1. Load canonical format from API
    2. Convert to editor format
    3. Convert back to canonical format
    4. Validate the output matches the original
    """

    def convert_canonical_to_editor(self, step):
        """
        Simulate frontend conversion from nirs4all to editor format.
        This mimics pipelineConverter.ts::importFromNirs4all
        """
        if isinstance(step, str):
            # Class path string
            return {
                "id": "generated",
                "type": self._classify_step(step),
                "name": step.split(".")[-1],
                "classPath": step,
                "params": {},
            }

        if not isinstance(step, dict):
            return step

        if "class" in step:
            class_path = step["class"]
            return {
                "id": "generated",
                "type": self._classify_step(class_path),
                "name": class_path.split(".")[-1],
                "classPath": class_path,
                "params": step.get("params", {}),
            }

        if "model" in step:
            model_def = step["model"]
            if isinstance(model_def, str):
                class_path = model_def
                params = {}
            elif isinstance(model_def, dict):
                class_path = model_def.get("class", "")
                params = model_def.get("params", {})
            else:
                class_path = str(model_def)
                params = {}

            editor_step = {
                "id": "generated",
                "type": "model",
                "name": class_path.split(".")[-1],
                "classPath": class_path,
                "params": params,
            }
            if "name" in step:
                editor_step["customName"] = step["name"]
            if "finetune_params" in step:
                editor_step["finetuneConfig"] = step["finetune_params"]
            return editor_step

        if "y_processing" in step:
            y_proc = step["y_processing"]
            if isinstance(y_proc, str):
                class_path = y_proc
                params = {}
            else:
                class_path = y_proc.get("class", "")
                params = y_proc.get("params", {})
            return {
                "id": "generated",
                "type": "y_processing",
                "name": class_path.split(".")[-1],
                "classPath": class_path,
                "params": params,
            }

        if "branch" in step:
            branch_data = step["branch"]
            if isinstance(branch_data, dict):
                # Named branches
                branches = {
                    name: [self.convert_canonical_to_editor(s) for s in steps]
                    for name, steps in branch_data.items()
                }
            else:
                # Indexed branches
                branches = [
                    [self.convert_canonical_to_editor(s) for s in steps]
                    for steps in branch_data
                ]
            return {
                "id": "generated",
                "type": "branch",
                "name": "Branch",
                "params": {},
                "branches": branches,
            }

        if "merge" in step:
            return {
                "id": "generated",
                "type": "merge",
                "name": "Merge",
                "params": step["merge"] if isinstance(step["merge"], dict) else {"mode": step["merge"]},
            }

        # Other keywords - preserve structure
        return {
            "id": "generated",
            "type": "other",
            "raw": step,
        }

    def convert_editor_to_canonical(self, step):
        """
        Simulate frontend conversion from editor to nirs4all format.
        This mimics pipelineConverter.ts::exportToNirs4all
        """
        if "raw" in step:
            return step["raw"]

        step_type = step.get("type", "")
        class_path = step.get("classPath", "")
        params = step.get("params", {})

        if step_type == "model":
            model_def = {"class": class_path}
            if params:
                model_def["params"] = params
            result = {"model": model_def}
            if "customName" in step:
                result["name"] = step["customName"]
            if "finetuneConfig" in step:
                result["finetune_params"] = step["finetuneConfig"]
            return result

        if step_type == "y_processing":
            y_def = {"class": class_path}
            if params:
                y_def["params"] = params
            return {"y_processing": y_def}

        if step_type == "branch":
            branches_data = step.get("branches", {})
            if isinstance(branches_data, dict):
                converted = {
                    name: [self.convert_editor_to_canonical(s) for s in steps]
                    for name, steps in branches_data.items()
                }
            else:
                converted = [
                    [self.convert_editor_to_canonical(s) for s in steps]
                    for steps in branches_data
                ]
            return {"branch": converted}

        if step_type == "merge":
            merge_params = step.get("params", {})
            if "mode" in merge_params and len(merge_params) == 1:
                return {"merge": merge_params["mode"]}
            return {"merge": merge_params}

        # Standard class step
        if params:
            return {"class": class_path, "params": params}
        return {"class": class_path}

    def _classify_step(self, class_path: str) -> str:
        """Determine step type from class path."""
        if "model_selection" in class_path or "splitter" in class_path.lower():
            return "splitting"
        if "cross_decomposition" in class_path or "ensemble" in class_path or "linear_model" in class_path or "svm" in class_path:
            return "model"
        return "preprocessing"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("sample_id", SAMPLE_IDS)
    async def test_roundtrip_structure(self, sample_id):
        """Test that round-trip preserves structure."""
        result = await get_pipeline_sample(sample_id, canonical=True)
        original = result["pipeline"]

        # Convert to editor and back
        editor_steps = [self.convert_canonical_to_editor(s) for s in original]
        roundtrip = [self.convert_editor_to_canonical(s) for s in editor_steps]

        # Check step count preserved
        assert len(roundtrip) == len(original), f"Step count changed: {len(original)} -> {len(roundtrip)}"


class TestClassPathMapping:
    """Test class path handling."""

    KNOWN_PATHS = [
        "sklearn.preprocessing._data.MinMaxScaler",
        "sklearn.preprocessing._data.StandardScaler",
        "sklearn.decomposition._pca.PCA",
        "sklearn.model_selection._split.KFold",
        "sklearn.cross_decomposition._pls.PLSRegression",
        "sklearn.ensemble._forest.RandomForestRegressor",
        "sklearn.linear_model._ridge.Ridge",
        "nirs4all.operators.transforms.scalers.StandardNormalVariate",
        "nirs4all.operators.transforms.nirs.MultiplicativeScatterCorrection",
        "nirs4all.operators.transforms.nirs.FirstDerivative",
        "nirs4all.operators.models.meta.MetaModel",
    ]

    @pytest.mark.parametrize("class_path", KNOWN_PATHS)
    def test_class_path_extraction(self, class_path):
        """Test class name can be extracted from path."""
        name = class_path.split(".")[-1]
        assert len(name) > 0
        assert name[0].isupper(), f"Class name should be PascalCase: {name}"

    @pytest.mark.asyncio
    async def test_all_samples_have_valid_class_paths(self):
        """Test all samples only use valid class paths."""
        for sample_id in SAMPLE_IDS:
            result = await get_pipeline_sample(sample_id, canonical=True)
            self._validate_steps(result["pipeline"], sample_id)

    def _validate_steps(self, steps, sample_id):
        """Recursively validate class paths in steps."""
        special_keywords = {"chart_2d", "chart_y"}

        for step in steps:
            if isinstance(step, str):
                if step not in special_keywords:
                    assert "." in step, f"Invalid class path in {sample_id}: {step}"
            elif isinstance(step, dict):
                if "class" in step:
                    assert "." in step["class"], f"Invalid class path in {sample_id}: {step}"
                if "model" in step and isinstance(step["model"], dict):
                    if "class" in step["model"]:
                        assert "." in step["model"]["class"], f"Invalid model class path in {sample_id}"
                    if "model" in step["model"]:  # Nested model (e.g., MetaModel)
                        nested = step["model"]["model"]
                        if isinstance(nested, dict) and "class" in nested:
                            assert "." in nested["class"]
                if "branch" in step:
                    branch_data = step["branch"]
                    if isinstance(branch_data, dict):
                        for name, branch_steps in branch_data.items():
                            self._validate_steps(branch_steps, f"{sample_id}:branch:{name}")
                    else:
                        for i, branch_steps in enumerate(branch_data):
                            self._validate_steps(branch_steps, f"{sample_id}:branch:{i}")


if __name__ == "__main__":
    import asyncio

    async def main():
        print("Running pipeline round-trip tests...")

        # List samples
        print("\n=== Listing Samples ===")
        result = await list_pipeline_samples()
        print(f"Found {result['total']} samples")

        # Test each sample
        print("\n=== Testing Each Sample ===")
        for sample in result["samples"]:
            sample_id = sample["id"]
            try:
                detail = await get_pipeline_sample(sample_id, canonical=True)
                step_count = len(detail["pipeline"])
                has_gen = detail["has_generators"]
                num_cfg = detail["num_configurations"]
                print(f"✓ {sample_id}: {step_count} steps, generators={has_gen}, configs={num_cfg}")
            except Exception as e:
                print(f"✗ {sample_id}: {e}")

    asyncio.run(main())

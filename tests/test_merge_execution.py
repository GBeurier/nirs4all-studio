"""Palette branches and merges preserve the owner execution contract."""
import pytest

import api.shared  # noqa: F401
from api.pipeline_canonical import canonical_to_editor, editor_steps_to_runtime_canonical


def step(name, **kwargs):
    return {"id": name, "type": "flow", "subType": "merge", "name": name, **kwargs}


@pytest.mark.parametrize("mode", ["predictions", "features"])
def test_palette_merge_mode_roundtrips_and_owner_parser_accepts_it(mode):
    from nirs4all.controllers.data.merge import MergeConfigParser

    output = editor_steps_to_runtime_canonical([step("MergePredictions", classPath="merge", params={"mode": mode})])
    assert output == [{"merge": mode}]
    assert MergeConfigParser.parse(output[0]["merge"])
    assert editor_steps_to_runtime_canonical(canonical_to_editor(output)) == output


def test_source_palette_branches_route_named_sources_and_merge_features():
    from nirs4all.controllers.data.merge import MergeConfigParser

    child = {"id": "scale", "type": "preprocessing", "name": "StandardScaler", "classPath": "sklearn.preprocessing.StandardScaler", "params": {}}
    steps = [step("SourceBranch", subType="branch", classPath="source_branch", params={"sources": ["NIR", "markers"]}, branches=[[child], [child]]),
             step("MergeSources", classPath="source_merge", params={"axis": "features"})]
    output = editor_steps_to_runtime_canonical(steps)
    assert output[0]["branch"]["by_source"] is True
    assert list(output[0]["branch"]["steps"]) == ["NIR", "markers"]
    assert output[1] == {"merge": {"sources": "concat"}}
    assert MergeConfigParser.parse(output[1]["merge"]).source_merge.strategy == "concat"
    assert editor_steps_to_runtime_canonical(canonical_to_editor(output)) == output


@pytest.mark.parametrize("name,path,params,message", [
    ("MergePredictions", "merge", {"mode": "average"}, "Unsupported merge mode"),
    ("MergeSources", "source_merge", {"axis": "samples"}, "aligned samples"),
])
def test_unsupported_saved_modes_fail_explicitly(name, path, params, message):
    with pytest.raises(ValueError, match=message):
        editor_steps_to_runtime_canonical([step(name, classPath=path, params=params)])

"""Real HTTP preset witness; the diagnostic oracle never owns a product port."""

from typing import Any, Callable


def verify_pipeline_presets(call: Callable[..., dict[str, Any]]) -> dict[str, int]:
    """Compare every shipped preset/variant with the preserved Python translator.

    The caller supplies an already running, attested Rust HTTP session and an
    isolated qualification workspace. This creates ordinary editor documents;
    it does not claim that every optional model dependency is installed or fit.
    """
    from api.pipeline_canonical import canonical_to_editor, editor_to_canonical
    from api.preset_loader import list_presets

    expected = list_presets()
    listing = call("/api/pipelines/presets")
    assert listing == {"presets": expected, "total": len(expected)}, "Rust preset catalogue differs from the authoring oracle"
    created = 0
    identifiers = set()
    for preset in expected:
        for variant in preset["available_variants"]:
            name = f"Preset witness: {preset['id']} / {variant}"
            result = call(f"/api/pipelines/from-preset/{preset['id']}", {"name": name, "variant": variant})
            assert result["success"] is True, result
            pipeline = result["pipeline"]
            assert pipeline["name"] == name and pipeline["category"] == "preset", pipeline
            assert pipeline["task_type"] == variant, pipeline
            assert pipeline["id"] not in identifiers, "Preset imports overwrote a prior pipeline"
            identifiers.add(pipeline["id"])
            reloaded = call(f"/api/pipelines/{pipeline['id']}")["pipeline"]
            assert reloaded == pipeline, "Preset persistence changed the editor document"
            rendered = call("/api/pipelines/render-canonical", pipeline)
            canonical = {"name": name, "description": preset["description"], "pipeline": preset["variants"][variant]["pipeline"]}
            oracle = editor_to_canonical(canonical_to_editor(canonical), name=name, description=preset["description"], include_wrapper=True)
            assert rendered["payload"] == oracle, (preset["id"], variant, "Canonical preset semantics changed")
            created += 1
    return {"presets": len(expected), "variants_imported_persisted_and_rendered": created}

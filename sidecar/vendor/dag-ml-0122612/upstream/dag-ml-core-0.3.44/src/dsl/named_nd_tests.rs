//! Fixed N-D input admission without materializing numerical host buffers.

use super::*;
use serde_json::json;

fn contract(representation: &str, type_id: &str, shape: serde_json::Value) -> serde_json::Value {
    json!({
        "schema_version": 1,
        "ports": [
            {
                "name": "nir", "accepted_types": ["dense_signal"],
                "accepted_representations": ["signal_1d"], "rank": 2,
                "multi_source": false, "optional": false,
                "metadata": {"source_id": "src0", "dtype": "float32", "feature_shape": [4]}
            },
            {
                "name": "sensor", "accepted_types": [type_id],
                "accepted_representations": [representation],
                "rank": shape.as_array().unwrap().len() + 1,
                "multi_source": false, "optional": false,
                "metadata": {"source_id": "src1", "dtype": "float64", "feature_shape": shape}
            }
        ]
    })
}

fn declaration(input: serde_json::Value) -> PipelineDslSpec {
    serde_json::from_value(json!({
        "id": "native-shaped-inputs", "steps": [{
            "kind": "model", "id": "model:joint", "operator": {"type": "UserModule"},
            "model_input": input
        }]
    }))
    .unwrap()
}

#[test]
fn named_fixed_io_representations_preserve_full_contract_in_native_graph() {
    for (representation, type_id, shape) in [
        ("tabular_numeric", "table", json!([5])),
        ("signal_1d", "dense_signal", json!([5])),
        ("gray_image", "gray_image", json!([2, 3])),
        ("rgb_image", "image_rgb", json!([2, 3, 3])),
        ("mc_image", "multichannel_image", json!([2, 3, 2])),
        (
            "multispectral_image",
            "multichannel_image",
            json!([2, 3, 4]),
        ),
        ("series_mv", "time_series", json!([5, 2])),
    ] {
        let input = contract(representation, type_id, shape);
        let graph = compile_pipeline_dsl(&declaration(input.clone())).unwrap();
        assert_eq!(graph.interface.inputs.len(), 2);
        assert_eq!(graph.nodes[0].ports.inputs[1].name, "sensor");
        assert_eq!(
            graph.nodes[0].ports.inputs[1].representation.as_deref(),
            Some(representation)
        );
        let canonical_input =
            serde_json::to_value(serde_json::from_value::<ModelInputSpec>(input).unwrap()).unwrap();
        assert_eq!(
            graph.nodes[0].metadata[DSL_MODEL_INPUT_METADATA_KEY],
            canonical_input
        );
        let restored: GraphSpec =
            serde_json::from_slice(&serde_json::to_vec(&graph).unwrap()).unwrap();
        assert_eq!(restored, graph);
    }
}

#[test]
fn native_named_admission_rejects_mismatched_type_rank_rgb_channels_and_shape_budget() {
    let original = contract("rgb_image", "image_rgb", json!([2, 3, 3]));
    for (path, value) in [
        ("/ports/1/rank", json!(3)),
        ("/ports/1/accepted_types", json!(["table"])),
        (
            "/ports/1/accepted_representations",
            json!(["rgb_image", "mc_image"]),
        ),
        ("/ports/1/metadata/feature_shape", json!([2, 3, 2])),
        ("/ports/1/metadata/feature_shape", json!([2, 0, 3])),
        ("/ports/1/metadata/feature_shape", json!([2.0, 3, 3])),
        ("/ports/1/metadata/feature_shape", json!([4096, 4096, 3])),
        (
            "/ports/1/metadata/feature_shape",
            json!([u64::MAX, u64::MAX, 3]),
        ),
    ] {
        let mut changed = original.clone();
        *changed.pointer_mut(path).unwrap() = value;
        assert!(
            compile_pipeline_dsl(&declaration(changed.clone())).is_err(),
            "accepted {changed}"
        );
    }
}

#[test]
fn swapping_image_axes_changes_native_variant_identity_even_at_equal_flat_width() {
    let first = declaration(contract("rgb_image", "image_rgb", json!([2, 3, 3])));
    let second = declaration(contract("rgb_image", "image_rgb", json!([3, 2, 3])));
    assert_ne!(
        operator_variant_label(&first.steps).unwrap(),
        operator_variant_label(&second.steps).unwrap()
    );
}

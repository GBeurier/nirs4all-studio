// Plan construction exercises the named contract after DSL compilation.
// No host arrays, module construction or numerical FIT are involved.
use serde_json::json;

fn representations() -> Vec<(&'static str, &'static str, serde_json::Value)> {
    vec![
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
    ]
}

fn fixture(
    representation: &str,
    type_id: &str,
    shape: serde_json::Value,
) -> (GraphSpec, CampaignSpec, ControllerManifest) {
    let contract = json!({
        "schema_version": 1, "ports": [
            {"name":"nir", "accepted_types":["dense_signal"],
             "accepted_representations":["signal_1d"], "rank":2,
             "multi_source":false, "optional":false,
             "metadata":{"source_id":"src0", "dtype":"float32", "feature_shape":[4]}},
            {"name":"sensor", "accepted_types":[type_id],
             "accepted_representations":[representation], "rank":shape.as_array().unwrap().len()+1,
             "multi_source":false, "optional":false,
             "metadata":{"source_id":"src1", "dtype":"float64", "feature_shape":shape}}
        ]
    });
    let dsl: crate::dsl::PipelineDslSpec = serde_json::from_value(json!({
        "id":"named-nd-plan", "steps":[{
            "kind":"model", "id":"model:named-nd", "operator":{"type":"UserModule"},
            "model_input":contract
        }]
    }))
    .unwrap();
    let graph = crate::dsl::compile_pipeline_dsl(&dsl).unwrap();
    let node = &graph.nodes[0];
    let mut controller = manifest("controller:named-nd", NodeKind::Model);
    controller.input_ports = node.ports.inputs.clone();
    controller.output_ports = node.ports.outputs.clone();
    controller.data_requirements =
        Some(node.metadata[crate::dsl::DSL_MODEL_INPUT_METADATA_KEY].clone());
    let mut campaign = campaign("campaign:named-nd");
    campaign.data_bindings.insert(
        node.id.clone(),
        [
            ("nir", "src0", "signal_1d"),
            ("sensor", "src1", representation),
        ]
        .into_iter()
        .map(|(name, source, representation)| {
            let mut binding = data_binding(&node.id);
            binding.input_name = name.into();
            binding.source_ids = vec![source.into()];
            binding.feature_set_id = Some(format!("features:{source}"));
            binding.output_representation = representation.into();
            binding
        })
        .collect(),
    );
    (graph, campaign, controller)
}

fn controller_registry(controller: ControllerManifest) -> ControllerRegistry {
    let mut registry = ControllerRegistry::new();
    registry.register(controller).unwrap();
    registry
}

#[test]
fn named_signal_image_series_and_table_build_and_roundtrip_native_plans() {
    for (representation, type_id, shape) in representations() {
        let (graph, campaign, controller) = fixture(representation, type_id, shape);
        let declared = controller.data_requirements.clone().unwrap();
        let plan = build_execution_plan(
            "plan:named-nd",
            graph,
            campaign,
            &controller_registry(controller),
        )
        .unwrap_or_else(|error| panic!("{representation} plan refused: {error}"));
        let node = &plan.node_plans[&NodeId::new("model:named-nd").unwrap()];
        assert_eq!(node.data_bindings.len(), 2);
        let sensor = node
            .data_bindings
            .iter()
            .find(|binding| binding.input_name == "sensor")
            .unwrap();
        assert_eq!(sensor.source_ids, ["src1"]);
        assert_eq!(sensor.output_representation, representation);
        assert!(sensor.require_relations);
        assert_eq!(
            plan.graph_plan.graph.nodes[0].metadata[crate::dsl::DSL_MODEL_INPUT_METADATA_KEY],
            declared
        );
        let restored: ExecutionPlan =
            serde_json::from_slice(&serde_json::to_vec(&plan).unwrap()).unwrap();
        restored.validate().unwrap();
        assert_eq!(restored, plan);
    }
}

#[test]
fn named_native_plans_refuse_incompatible_graph_controller_and_binding_representations() {
    for (representation, type_id, shape) in representations() {
        // Choose a registered but incompatible representation, including for tables.
        let incompatible = if representation == "tabular_numeric" {
            "signal_1d"
        } else {
            "tabular_numeric"
        };
        for mutation in 0..3 {
            let (mut graph, mut campaign, mut controller) =
                fixture(representation, type_id, shape.clone());
            match mutation {
                0 => {
                    graph.nodes[0]
                        .ports
                        .inputs
                        .iter_mut()
                        .find(|port| port.name == "sensor")
                        .unwrap()
                        .representation = Some(incompatible.into())
                }
                1 => {
                    controller
                        .input_ports
                        .iter_mut()
                        .find(|port| port.name == "sensor")
                        .unwrap()
                        .representation = Some(incompatible.into())
                }
                2 => {
                    campaign
                        .data_bindings
                        .get_mut(&NodeId::new("model:named-nd").unwrap())
                        .unwrap()
                        .iter_mut()
                        .find(|binding| binding.input_name == "sensor")
                        .unwrap()
                        .output_representation = incompatible.into()
                }
                _ => unreachable!(),
            }
            assert!(
                build_execution_plan(
                    "plan:named-nd-invalid",
                    graph,
                    campaign,
                    &controller_registry(controller),
                )
                .is_err(),
                "{representation} accepted incompatible {incompatible}, mutation {mutation}"
            );
        }
    }
}

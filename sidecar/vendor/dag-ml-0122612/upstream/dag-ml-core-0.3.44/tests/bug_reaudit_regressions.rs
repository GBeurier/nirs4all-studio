//! Regression coverage for the five confirmed defects of the second 2026-10-05 audit.
//! Multimodal source-shape guards are exercised beside their native helper.
use dag_ml_core::*;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

// The trial fixtures below use sorted maps and scalar values; serialize the
// documented preimage directly rather than exposing an internal hash helper.
fn stable_json_fingerprint<T: serde::Serialize>(value: &T) -> serde_json::Result<String> {
    Ok(format!("{:x}", Sha256::digest(serde_json::to_vec(value)?)))
}

fn fixtures() -> (GraphSpec, CampaignSpec, Vec<ControllerManifest>) {
    (
        serde_json::from_str(include_str!("fixtures/package/minimal_graph.json")).unwrap(),
        serde_json::from_str(include_str!(
            "fixtures/package/campaign_oof_generation.json"
        ))
        .unwrap(),
        serde_json::from_str(include_str!("fixtures/package/controller_manifests.json")).unwrap(),
    )
}

fn registry(manifests: Vec<ControllerManifest>) -> ControllerRegistry {
    let mut registry = ControllerRegistry::new();
    for manifest in manifests {
        registry.register(manifest).unwrap();
    }
    registry
}

fn plan() -> ExecutionPlan {
    let (graph, campaign, manifests) = fixtures();
    build_execution_plan("plan:reaudit", graph, campaign, &registry(manifests)).unwrap()
}

#[test]
fn changing_a_variant_prefix_does_not_bypass_identity_validation() {
    for id in [
        "trial:invented",
        "hpo:trial:1",
        "hpo:scope:inner:trial:1",
        "host_hpo:trial:0000000001",
    ] {
        let mut forged = plan();
        forged.variants[0].variant_id = VariantId::new(id).unwrap();
        forged.variants[0].seed = Some(666);
        forged.variants[0].fingerprint = "f".repeat(64);
        assert!(forged.validate().is_err(), "forged identity {id}");
    }
}

fn adaptive_plan(namespace: Option<&str>, host: bool) -> ExecutionPlan {
    let mut plan = plan();
    let base = plan.variants[0].clone();
    let mut variant = base.clone();
    let trial = 3_i64;
    let objective = "a".repeat(64);
    variant.choices.insert(
        if host {
            "host_hpo"
        } else {
            "native_methods_hpo"
        }
        .into(),
        GenerationChoice {
            label: format!("trial:{trial}"),
            value: if host {
                json!({"objective_fingerprint": objective, "trial_index": trial})
            } else {
                json!({"trial_id": trial})
            },
            param_overrides: vec![GenerationParamOverride {
                node_id: NodeId::new("model:base").unwrap(),
                params: [("n_components".into(), json!(2))].into(),
            }],
            active_subsequence: None,
        },
    );
    variant.variant_id = VariantId::new(if host {
        format!("host_hpo:trial:{trial:010}")
    } else if let Some(namespace) = namespace {
        format!("hpo:scope:{namespace}:trial:{trial}")
    } else {
        format!("hpo:trial:{trial}")
    })
    .unwrap();
    variant.fingerprint = if host {
        stable_json_fingerprint(&(&base.fingerprint, &variant.choices, &objective)).unwrap()
    } else if let Some(namespace) = namespace {
        stable_json_fingerprint(&(
            base.fingerprint.as_str(),
            namespace,
            &variant.choices,
            trial,
        ))
        .unwrap()
    } else {
        stable_json_fingerprint(&(base.fingerprint.as_str(), &variant.choices, trial)).unwrap()
    };
    plan.variants = vec![variant];
    plan
}

#[test]
fn adaptive_trials_bind_their_seed_fingerprint_choices_and_trial_identity() {
    for (namespace, host) in [(None, false), (Some("inner:fold:0"), false), (None, true)] {
        let original = adaptive_plan(namespace, host);
        original.validate().unwrap();
        let mut forged = original.clone();
        forged.variants[0].seed = Some(forged.variants[0].seed.unwrap() ^ 1);
        assert!(forged.validate().is_err());
        let mut forged = original.clone();
        forged.variants[0].fingerprint = "f".repeat(64);
        assert!(forged.validate().is_err());
        let mut forged = original.clone();
        let dimension = if host {
            "host_hpo"
        } else {
            "native_methods_hpo"
        };
        forged.variants[0].choices.get_mut(dimension).unwrap().label = "trial:4".into();
        assert!(forged.validate().is_err());
        let mut forged = original;
        forged.variants[0]
            .choices
            .get_mut(dimension)
            .unwrap()
            .param_overrides[0]
            .params
            .insert("n_components".into(), json!(3));
        assert!(forged.validate().is_err());
    }
}

#[test]
fn host_hpo_requires_an_explicit_signed_objective_identity() {
    let mut forged = adaptive_plan(None, true);
    forged.variants[0]
        .choices
        .get_mut("host_hpo")
        .unwrap()
        .value
        .as_object_mut()
        .unwrap()
        .remove("objective_fingerprint");
    assert!(forged.validate().is_err());
    let mut forged = adaptive_plan(None, true);
    forged.variants[0]
        .choices
        .get_mut("host_hpo")
        .unwrap()
        .value["objective_fingerprint"] = json!("b".repeat(64));
    assert!(forged.validate().is_err());
}

fn label(steps: Value) -> String {
    operator_variant_label_from_steps_json(&steps.to_string()).unwrap()
}

#[test]
fn structural_labels_keep_opaque_semantic_ids() {
    for field in ["operator", "params", "metadata"] {
        let mut model = json!({"kind":"model", "id":"model:m", "operator":{"type":"LookupModel"}});
        if field == "operator" {
            model[field]["selector"] = json!({"kind":"table", "id":"catalog:A"});
        } else {
            model[field] = json!({"selector":{"kind":"table", "id":"catalog:A"}});
        }
        let mut changed = model.clone();
        changed[field]["selector"]["id"] = json!("catalog:B");
        for (left, right) in [
            (
                json!([{"kind":"sequential", "steps":[model.clone()]}]),
                json!([{"kind":"sequential", "steps":[changed.clone()]}]),
            ),
            (
                json!([{"kind":"branch", "branches":[{"id":"left", "steps":[model.clone()]}]}]),
                json!([{"kind":"branch", "branches":[{"id":"left", "steps":[changed.clone()]}]}]),
            ),
            (
                json!([{"kind":"generator", "id":"g", "tail":[model.clone()]}]),
                json!([{"kind":"generator", "id":"g", "tail":[changed.clone()]}]),
            ),
        ] {
            assert_ne!(label(left), label(right), "opaque {field}");
        }
    }
    let left =
        json!([{"kind":"branch", "selector":{"kind":"table", "id":"catalog:A"}, "branches":[]}]);
    let mut right = left.clone();
    right[0]["selector"]["id"] = json!("catalog:B");
    assert_ne!(label(left), label(right));
}

#[test]
fn structural_labels_preserve_absent_optional_children() {
    let steps = json!([{"kind":"generator", "id":"g", "mode":"or"}]);
    let canonical = json!([{"class":"", "kind":"generator", "params":{},
        "structure":{"kind":"generator", "mode":"or"}}]);
    assert_eq!(label(steps), stable_json_fingerprint(&canonical).unwrap());
}

#[test]
fn structural_labels_ignore_only_typed_dsl_node_ids() {
    let left = json!([{"kind":"sequential", "id":"sequence:a", "steps":[{"kind":"model", "id":"model:a", "operator":{"type":"Ridge"}}]}]);
    let mut right = left.clone();
    right[0]["id"] = json!("sequence:b");
    right[0]["steps"][0]["id"] = json!("model:b");
    assert_eq!(label(left), label(right));
    let left = json!([{"kind":"concat_transform", "id":"concat:a", "branches":[{"id":"left", "steps":[{"id":"transform:a", "operator":"SNV"}]}]}]);
    let mut right = left.clone();
    right[0]["id"] = json!("concat:b");
    right[0]["branches"][0]["steps"][0]["id"] = json!("transform:b");
    assert_eq!(label(left), label(right));
}

fn generator(id: &str, alpha: u32) -> Value {
    json!({"kind":"generator","id":id,"mode":"or","branches":[{"id":"only","steps":[{"kind":"model","id":"m","operator":{"type":"Ridge"},"params":{"alpha":alpha}}]}]})
}

#[test]
fn lossy_sanitization_keeps_distinct_generator_namespaces() {
    for (left, right) in [("g:a", "g_a"), ("__g", "g"), ("g::a", "g__a")] {
        let spec: PipelineDslSpec = serde_json::from_value(json!({"id":"both","steps":[{"kind":"branch","branches":[{"id":"left","steps":[generator(left, 1)]},{"id":"right","steps":[generator(right, 2)]}]}]})).unwrap();
        let compiled = compile_pipeline_dsl_with_generation(&spec).unwrap();
        let ids = compiled
            .graph
            .nodes
            .iter()
            .map(|node| &node.id)
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(ids.len(), compiled.graph.nodes.len());
        assert_eq!(
            compiled.graph,
            compile_pipeline_dsl_with_generation(&spec).unwrap().graph
        );
    }
}

#[test]
fn literal_digest_suffixes_do_not_alias_encoded_generator_namespaces() {
    let spec: PipelineDslSpec =
        serde_json::from_value(json!({"id":"single", "steps":[generator("g:a", 1)]})).unwrap();
    let single = compile_pipeline_dsl_with_generation(&spec).unwrap();
    let encoded = single
        .graph
        .nodes
        .iter()
        .find_map(|node| node.id.as_str().strip_prefix("gen:"))
        .unwrap()
        .split(':')
        .next()
        .unwrap();
    let combined: PipelineDslSpec = serde_json::from_value(json!({"id":"both","steps":[{"kind":"branch","branches":[{"id":"left","steps":[generator("g:a", 1)]},{"id":"right","steps":[generator(encoded, 2)]}]}]})).unwrap();
    compile_pipeline_dsl_with_generation(&combined).unwrap();
}

#[test]
fn single_input_manifests_reject_concrete_fan_in_but_many_and_legacy_accept_it() {
    let (mut graph, campaign, manifests) = fixtures();
    graph.nodes[1].ports.inputs[0].cardinality = PortCardinality::Many;
    // Many is a graph capacity; a single concrete edge is still implementable by One.
    build_execution_plan(
        "plan:one",
        graph.clone(),
        campaign.clone(),
        &registry(manifests.clone()),
    )
    .unwrap();
    let mut other = graph.nodes[0].clone();
    other.id = NodeId::new("transform:other").unwrap();
    let mut edge = graph.edges[0].clone();
    edge.source.node_id = other.id.clone();
    graph.nodes.push(other);
    graph.edges.push(edge);
    graph.validate().unwrap();
    assert!(build_execution_plan(
        "plan:two",
        graph.clone(),
        campaign.clone(),
        &registry(manifests.clone())
    )
    .is_err());
    for cardinality in [PortCardinality::Optional, PortCardinality::Many] {
        let mut adjusted = manifests.clone();
        for manifest in &mut adjusted {
            if manifest.operator_kind == NodeKind::Model {
                manifest.input_ports[0].cardinality = cardinality.clone();
            }
        }
        let result = build_execution_plan(
            "plan:adjusted",
            graph.clone(),
            campaign.clone(),
            &registry(adjusted),
        );
        assert_eq!(result.is_ok(), cardinality == PortCardinality::Many);
    }
    let mut legacy = manifests;
    for manifest in &mut legacy {
        if manifest.operator_kind == NodeKind::Model {
            manifest.input_ports.clear();
        }
    }
    build_execution_plan("plan:legacy", graph, campaign, &registry(legacy)).unwrap();
}

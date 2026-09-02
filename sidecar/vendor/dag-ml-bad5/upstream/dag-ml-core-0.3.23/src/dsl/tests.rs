use super::*;
use crate::controller::{
    ArtifactPolicy, ControllerCapability, ControllerFitScope, ControllerManifest, OperatorSelector,
    RngPolicy,
};
use crate::phase::Phase;

fn registry_manifest(id: &str, kind: NodeKind, aliases: &[&str]) -> ControllerManifest {
    ControllerManifest {
        controller_id: crate::ids::ControllerId::new(id).unwrap(),
        controller_version: "0.1.0".to_string(),
        operator_kind: kind,
        priority: 0,
        supported_phases: BTreeSet::from([Phase::FitCv]),
        input_ports: Vec::new(),
        output_ports: Vec::new(),
        data_requirements: None,
        capabilities: BTreeSet::from([ControllerCapability::Deterministic]),
        operator_selectors: vec![OperatorSelector {
            aliases: aliases.iter().map(|alias| (*alias).to_string()).collect(),
            ..OperatorSelector::default()
        }],
        fit_scope: ControllerFitScope::FoldTrain,
        rng_policy: RngPolicy::UsesCoreSeed,
        artifact_policy: ArtifactPolicy::Serializable,
    }
}

#[test]
fn compiles_linear_pipeline_dsl_to_valid_graph() {
    let spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-linear-smoke",
  "steps": [
    {
      "kind": "transform",
      "id": "transform:snv",
      "operator": {"type": "StandardNormalVariate"},
      "seed_label": "snv"
    },
    {
      "kind": "model",
      "id": "model:base",
      "operator": {"type": "RandomForestRegressor"},
      "params": {"n_estimators": 100},
      "seed_label": "base"
    }
  ]
}"#,
    )
    .unwrap();

    let graph = compile_pipeline_dsl(&spec).unwrap();

    assert_eq!(graph.id, "dsl-linear-smoke");
    assert_eq!(graph.nodes.len(), 2);
    assert_eq!(graph.edges.len(), 1);
    assert_eq!(graph.nodes[0].kind, NodeKind::Transform);
    assert_eq!(graph.nodes[1].kind, NodeKind::Model);
    assert_eq!(graph.edges[0].source.node_id.as_str(), "transform:snv");
    assert_eq!(graph.edges[0].target.node_id.as_str(), "model:base");
    assert_eq!(graph.edges[0].contract.kind, PortKind::Data);
    graph.validate().unwrap();
}

#[test]
fn compiles_pipeline_dsl_unit_contracts_to_graph_interface() {
    let spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-unit-contract-smoke",
  "input": {
    "name": "spectra",
    "representation": "tabular",
    "unit_level": "observation",
    "alignment_key": "sample_id",
    "target_level": "physical_sample"
  },
  "output": {
    "name": "prediction",
    "representation": "regression",
    "unit_level": "physical_sample",
    "alignment_key": "sample_id",
    "target_level": "physical_sample"
  },
  "steps": [
    {
      "kind": "model",
      "id": "model:base",
      "operator": {"type": "RandomForestRegressor"}
    }
  ]
}"#,
    )
    .unwrap();

    let graph = compile_pipeline_dsl(&spec).unwrap();

    assert_eq!(
        graph.interface.inputs[0].unit_level,
        Some(EntityUnitLevel::Observation)
    );
    assert_eq!(
        graph.interface.inputs[0].alignment_key.as_deref(),
        Some("sample_id")
    );
    assert_eq!(
        graph.interface.outputs[0].unit_level,
        Some(EntityUnitLevel::PhysicalSample)
    );
    assert_eq!(
        graph.interface.outputs[0].representation.as_deref(),
        Some("regression")
    );
}

#[test]
fn compiles_branch_merge_predictions_plus_original_dsl() {
    let spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-branch-merge-smoke",
  "steps": [
    {
      "kind": "branch",
      "branches": [
        {
          "id": "b0",
          "steps": [
            {
              "kind": "model",
              "id": "branch:b0.model:ridge",
              "operator": {"type": "Ridge"},
              "params": {"alpha": 0.3},
              "seed_label": "branch:b0"
            }
          ]
        },
        {
          "id": "b1",
          "steps": [
            {
              "kind": "augmentation",
              "id": "branch:b1.augment:noise",
              "operator": {"type": "GaussianNoise"},
              "params": {"scope": "train_only"},
              "seed_label": "branch:b1.augment",
              "shape": {
                "fit_rows": "fold_train",
                "predict_rows": "fold_validation",
                "augmentation_policy": {
                  "sample_scope": "train_only",
                  "feature_scope": "none",
                  "require_origin_id": true,
                  "inherit_group": true,
                  "inherit_target": true
                }
              }
            },
            {
              "kind": "model",
              "id": "branch:b1.model:rf",
              "operator": {"type": "RandomForestRegressor"},
              "params": {"n_estimators": 64},
              "seed_label": "branch:b1"
            }
          ]
        }
      ]
    },
    {
      "kind": "merge_model",
      "id": "merge:stack.pred_plus_original.meta:ridge",
      "operator": {"type": "RidgeMetaStacker"},
      "params": {"alpha": 0.2},
      "seed_label": "merge:stack"
    }
  ]
}"#,
    )
    .unwrap();

    let graph = compile_pipeline_dsl(&spec).unwrap();

    assert_eq!(graph.nodes.len(), 4);
    assert_eq!(graph.edges.len(), 3);
    let merge = graph
        .nodes
        .iter()
        .find(|node| node.id.as_str() == "merge:stack.pred_plus_original.meta:ridge")
        .unwrap();
    assert_eq!(merge.ports.inputs.len(), 3);
    assert_eq!(merge.ports.inputs[0].name, "b0_oof");
    assert_eq!(merge.ports.inputs[1].name, "b1_oof");
    assert_eq!(merge.ports.inputs[2].name, "x_original");
    let prediction_edges = graph
        .edges
        .iter()
        .filter(|edge| edge.contract.kind == PortKind::Prediction)
        .collect::<Vec<_>>();
    assert_eq!(prediction_edges.len(), 2);
    assert!(prediction_edges
        .iter()
        .all(|edge| edge.contract.requires_oof));
    assert!(prediction_edges
        .iter()
        .all(|edge| edge.contract.requires_fold_alignment));
    assert!(graph.edges.iter().any(|edge| edge.source.node_id.as_str()
        == "branch:b1.augment:noise"
        && edge.target.node_id.as_str() == "branch:b1.model:rf"));
    graph.validate().unwrap();
}

#[test]
fn compiles_separation_branch_view_plans() {
    let spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-separation-branch-views",
  "steps": [
    {
      "kind": "branch",
      "mode": "by_metadata",
      "selector": {"metadata_key": "site"},
      "branches": [
        {
          "id": "site_a",
          "selector": "A",
          "steps": [
            {"kind": "model", "id": "model:site.a", "operator": {"type": "PLSRegression"}}
          ]
        },
        {
          "id": "site_b",
          "selector": {"value": "B"},
          "steps": [
            {"kind": "model", "id": "model:site.b", "operator": {"type": "Ridge"}}
          ]
        }
      ]
    },
    {
      "kind": "merge_model",
      "id": "model:site.meta",
      "operator": {"type": "Ridge"},
      "include_original_data": false
    }
  ]
}"#,
    )
    .unwrap();

    let compiled = compile_pipeline_dsl_with_generation(&spec).unwrap();

    assert_eq!(compiled.branch_view_plans.len(), 2);
    assert_eq!(
        compiled.campaign_template.branch_view_plans,
        compiled.branch_view_plans
    );
    assert_eq!(
        compiled.branch_view_plans[0].mode,
        BranchViewMode::ByMetadata
    );
    assert_eq!(compiled.branch_view_plans[0].selector.metadata["site"], "A");
    assert_eq!(compiled.branch_view_plans[1].selector.metadata["site"], "B");
    let site_model = compiled
        .graph
        .nodes
        .iter()
        .find(|node| node.id.as_str() == "model:site.a")
        .unwrap();
    assert_eq!(
        site_model.metadata["dsl_branch_view_plan"]["selector"]["metadata"]["site"],
        "A"
    );
}

#[test]
fn refuses_separation_branch_without_selector() {
    let spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-bad-separation-branch",
  "steps": [
    {
      "kind": "branch",
      "mode": "by_source",
      "branches": [
        {
          "id": "nir",
          "steps": [
            {"kind": "model", "id": "model:nir", "operator": {"type": "Ridge"}}
          ]
        }
      ]
    }
  ]
}"#,
    )
    .unwrap();

    let error = compile_pipeline_dsl_with_generation(&spec)
        .unwrap_err()
        .to_string();

    assert!(error.contains("by_source branch `nir` requires a selector"));
}

#[test]
fn compiles_branch_feature_merge_into_downstream_model() {
    let spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-branch-feature-merge",
  "steps": [
    {
      "kind": "branch",
      "branches": [
        {
          "id": "snv",
          "steps": [
            {
              "kind": "transform",
              "id": "branch:snv.transform",
              "operator": {"type": "SNV"}
            }
          ]
        },
        {
          "id": "msc",
          "steps": [
            {
              "kind": "transform",
              "id": "branch:msc.transform",
              "operator": {"type": "MSC"}
            }
          ]
        }
      ]
    },
    {
      "kind": "merge",
      "id": "merge:features",
      "merge_mode": "features",
      "output_as": "features",
      "include_original_data": false
    },
    {
      "kind": "model",
      "id": "model:pls",
      "operator": {"type": "PLSRegression"}
    }
  ]
}"#,
    )
    .unwrap();

    let graph = compile_pipeline_dsl(&spec).unwrap();
    graph.validate().unwrap();
    let merge = graph
        .nodes
        .iter()
        .find(|node| node.id.as_str() == "merge:features")
        .unwrap();
    assert_eq!(merge.kind, NodeKind::FeatureJoin);
    assert_eq!(merge.ports.inputs.len(), 2);
    assert!(merge.ports.inputs.iter().any(|port| port.name == "snv_x"));
    assert!(merge.ports.inputs.iter().any(|port| port.name == "msc_x"));
    assert!(graph.edges.iter().any(|edge| {
        edge.source.node_id.as_str() == "branch:snv.transform"
            && edge.target.node_id.as_str() == "merge:features"
            && edge.target.port_name == "snv_x"
            && edge.contract.kind == PortKind::Data
    }));
    assert!(graph.edges.iter().any(|edge| {
        edge.source.node_id.as_str() == "merge:features"
            && edge.target.node_id.as_str() == "model:pls"
            && edge.contract.kind == PortKind::Data
    }));
    assert!(!graph
        .edges
        .iter()
        .any(|edge| edge.contract.kind == PortKind::Prediction));
}

#[test]
fn compiles_nirs4all_style_multi_model_branch_and_separate_merge() {
    let spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-nirs4all-branch-parity",
  "steps": [
    {
      "kind": "branch",
      "mode": "duplication",
      "selector": {"scope": "all_samples"},
      "branches": [
        {
          "id": "pls_path",
          "steps": [
            {
              "kind": "model",
              "id": "branch:pls.model:pls5",
              "operator": {"class": "sklearn.cross_decomposition.PLSRegression"},
              "params": {"n_components": 5}
            },
            {
              "kind": "model",
              "id": "branch:pls.model:pls10",
              "operator": {"class": "sklearn.cross_decomposition.PLSRegression"},
              "params": {"n_components": 10}
            }
          ]
        },
        {
          "id": "rf_path",
          "selector": {"source": "nir"},
          "steps": [
            {
              "kind": "transform",
              "id": "branch:rf.transform:snv",
              "operator": {"class": "nirs4all.operators.transforms.StandardNormalVariate"}
            },
            {
              "kind": "model",
              "id": "branch:rf.model:rf",
              "operator": {"class": "sklearn.ensemble.RandomForestRegressor"},
              "params": {"n_estimators": 64}
            },
            {
              "kind": "model",
              "id": "branch:rf.model:gbr",
              "operator": {"class": "sklearn.ensemble.GradientBoostingRegressor"},
              "params": {"n_estimators": 32}
            }
          ]
        }
      ]
    },
    {
      "kind": "merge",
      "id": "merge:stack.predictions_plus_original",
      "merge_mode": "predictions_plus_original",
      "output_as": "features",
      "include_original_data": true,
      "selectors": [
        {"branch": "pls_path", "select": "best", "metric": "rmse"},
        {"branch": "rf_path", "select": {"top_k": 2}, "metric": "r2"}
      ],
      "metadata": {"on_missing": "warn"}
    },
    {
      "kind": "model",
      "id": "model:meta.ridge",
      "operator": {"class": "sklearn.linear_model.Ridge"},
      "variants": [
        {"label": "low", "params": {"alpha": 0.1}},
        {"label": "mid", "params": {"alpha": 0.5}}
      ]
    },
    {
      "kind": "model",
      "id": "model:meta.rf",
      "operator": {"class": "sklearn.ensemble.RandomForestRegressor"},
      "params": {"n_estimators": 30}
    }
  ]
}"#,
    )
    .unwrap();

    let compiled = compile_pipeline_dsl_with_generation(&spec).unwrap();
    let graph = compiled.graph;
    let merge = graph
        .nodes
        .iter()
        .find(|node| node.id.as_str() == "merge:stack.predictions_plus_original")
        .unwrap();

    assert_eq!(merge.kind, NodeKind::MixedJoin);
    assert_eq!(merge.ports.inputs.len(), 5);
    assert_eq!(merge.ports.outputs[0].kind, PortKind::Data);
    assert_eq!(merge.metadata["merge_mode"], "predictions_plus_original");
    assert_eq!(merge.metadata["selectors"][0]["branch"], "pls_path");
    let rf_model = graph
        .nodes
        .iter()
        .find(|node| node.id.as_str() == "branch:rf.model:rf")
        .unwrap();
    assert_eq!(rf_model.metadata["dsl_branch"], "rf_path");
    assert_eq!(rf_model.metadata["dsl_branch_mode"], "duplication");
    assert_eq!(
        rf_model.metadata["dsl_branch_step_selector"]["scope"],
        "all_samples"
    );
    assert_eq!(rf_model.metadata["dsl_branch_selector"]["source"], "nir");
    assert_eq!(
        graph
            .edges
            .iter()
            .filter(|edge| edge.target.node_id == merge.id
                && edge.contract.kind == PortKind::Prediction
                && edge.contract.requires_oof)
            .count(),
        4
    );
    assert!(graph
        .edges
        .iter()
        .any(|edge| edge.source.node_id == merge.id
            && edge.target.node_id.as_str() == "model:meta.ridge"
            && edge.contract.kind == PortKind::Data));
    assert!(graph
        .edges
        .iter()
        .any(|edge| edge.source.node_id == merge.id
            && edge.target.node_id.as_str() == "model:meta.rf"
            && edge.contract.kind == PortKind::Data));
    assert_eq!(compiled.generation.dimensions.len(), 1);
    assert_eq!(
        compiled.generation.dimensions[0].name,
        "model:meta.ridge.params"
    );
    graph.validate().unwrap();
}

#[test]
fn merge_selectors_reject_unknown_branch_and_missing_metric() {
    let unknown_branch: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-bad-merge-selector-branch",
  "steps": [
    {
      "kind": "branch",
      "branches": [
        {
          "id": "known",
          "steps": [
            {
              "kind": "model",
              "id": "branch:known.model:ridge",
              "operator": {"type": "Ridge"}
            }
          ]
        }
      ]
    },
    {
      "kind": "merge",
      "id": "merge:bad.selector",
      "selectors": [
        {"branch": "missing", "select": "all"}
      ]
    }
  ]
}"#,
    )
    .unwrap();
    let error = compile_pipeline_dsl_with_generation(&unknown_branch).unwrap_err();
    assert!(format!("{error}").contains("does not match any pending prediction input"));

    let missing_metric: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-bad-merge-selector-metric",
  "steps": [
    {
      "kind": "branch",
      "branches": [
        {
          "id": "known",
          "steps": [
            {
              "kind": "model",
              "id": "branch:known.model:ridge",
              "operator": {"type": "Ridge"}
            }
          ]
        }
      ]
    },
    {
      "kind": "merge",
      "id": "merge:bad.metric",
      "selectors": [
        {"branch": "known", "select": "best"}
      ]
    }
  ]
}"#,
    )
    .unwrap();
    let error = compile_pipeline_dsl_with_generation(&missing_metric).unwrap_err();
    assert!(format!("{error}").contains("requires a non-empty metric"));
}

#[test]
fn merge_selectors_reject_top_k_above_scope() {
    let spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-bad-merge-selector-top-k",
  "steps": [
    {
      "kind": "branch",
      "branches": [
        {
          "id": "known",
          "steps": [
            {
              "kind": "model",
              "id": "branch:known.model:ridge",
              "operator": {"type": "Ridge"}
            }
          ]
        }
      ]
    },
    {
      "kind": "merge",
      "id": "merge:bad.topk",
      "selectors": [
        {"branch": "known", "select": {"top_k": 2}, "metric": "rmse"}
      ]
    }
  ]
}"#,
    )
    .unwrap();

    let error = compile_pipeline_dsl_with_generation(&spec).unwrap_err();
    assert!(format!("{error}").contains("top_k=2 exceeds 1 matched prediction inputs"));
}

#[test]
fn compiles_nirs4all_shape_changing_and_tuning_surface() {
    let spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-nirs4all-shape-parity",
  "steps": [
    {
      "kind": "y_transform",
      "id": "target:scale",
      "operator": {"class": "sklearn.preprocessing.StandardScaler"}
    },
    {
      "kind": "tag",
      "id": "tag:y_outliers",
      "operator": {"class": "nirs4all.filters.YOutlierFilter"},
      "params": {"method": "iqr"}
    },
    {
      "kind": "exclude",
      "id": "exclude:train_outliers",
      "operator": {"class": "nirs4all.filters.YOutlierFilter"},
      "params": {"mode": "any"}
    },
    {
      "kind": "sample_augmentation",
      "id": "augment:sample.noise",
      "operator": {"class": "nirs4all.operators.transforms.GaussianAdditiveNoise"},
      "params": {"count": 3, "selection": "random"},
      "shape": {
        "fit_rows": "fold_train",
        "predict_rows": "fold_validation",
        "augmentation_policy": {
          "sample_scope": "train_only",
          "feature_scope": "none",
          "require_origin_id": true,
          "inherit_group": true,
          "inherit_target": true
        }
      }
    },
    {
      "kind": "feature_augmentation",
      "id": "augment:feature.views",
      "operator": {"class": "nirs4all.operators.transforms.FeatureAugmentation"},
      "params": {"action": "extend"},
      "shape": {
        "fit_rows": "fold_train",
        "predict_rows": "fold_validation",
        "feature_namespace": "augmented_views",
        "augmentation_policy": {
          "sample_scope": "none",
          "feature_scope": "train_only",
          "require_origin_id": false
        }
      }
    },
    {
      "kind": "concat_transform",
      "id": "join:concat.multi_view",
      "branches": [
        {
          "id": "pca",
          "steps": [
            {
              "id": "concat:pca",
              "operator": {"class": "sklearn.decomposition.PCA"},
              "params": {"n_components": 20}
            }
          ]
        },
        {
          "id": "derivative_pca",
          "steps": [
            {
              "id": "concat:derivative",
              "operator": {"class": "nirs4all.operators.transforms.FirstDerivative"}
            },
            {
              "id": "concat:derivative.pca",
              "operator": {"class": "sklearn.decomposition.PCA"},
              "params": {"n_components": 10}
            }
          ]
        }
      ],
      "shape": {
        "fit_rows": "fold_train",
        "feature_namespace": "concat.multi_view",
        "selection_policy": {
          "scope": "unsupervised"
        }
      }
    },
    {
      "kind": "model",
      "id": "model:tuned",
      "operator": {"class": "sklearn.ensemble.RandomForestRegressor"},
      "finetune_params": {
        "n_trials": 10,
        "approach": "single",
        "eval_mode": "mean",
        "sampler": "random",
        "metric": "rmse",
        "model_params": {
          "max_depth": [3, 5, 7]
        }
      },
      "train_params": {
        "sample_weight": "balanced"
      }
    }
  ]
}"#,
    )
    .unwrap();

    let compiled = compile_pipeline_dsl_with_generation(&spec).unwrap();
    let graph = compiled.graph;
    let kinds = graph
        .nodes
        .iter()
        .map(|node| node.kind.clone())
        .collect::<Vec<_>>();
    assert!(kinds.contains(&NodeKind::YTransform));
    assert!(kinds.contains(&NodeKind::Tag));
    assert!(kinds.contains(&NodeKind::Exclude));
    assert!(kinds.contains(&NodeKind::Augmentation));
    assert!(kinds.contains(&NodeKind::FeatureJoin));
    assert_eq!(compiled.shape_plans.len(), 3);

    let sample_aug = graph
        .nodes
        .iter()
        .find(|node| node.id.as_str() == "augment:sample.noise")
        .unwrap();
    assert_eq!(sample_aug.metadata["dsl_augmentation_kind"], "sample");
    let feature_aug = graph
        .nodes
        .iter()
        .find(|node| node.id.as_str() == "augment:feature.views")
        .unwrap();
    assert_eq!(feature_aug.metadata["dsl_augmentation_kind"], "feature");
    let model = graph
        .nodes
        .iter()
        .find(|node| node.id.as_str() == "model:tuned")
        .unwrap();
    assert_eq!(model.metadata["dsl_tuning"]["n_trials"], 10);
    assert_eq!(
        model.metadata["dsl_train_params"]["sample_weight"],
        "balanced"
    );
    graph.validate().unwrap();
}

#[test]
fn extracts_node_param_variants_into_generation_spec() {
    let spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-generation-smoke",
  "max_variants": 4,
  "steps": [
    {
      "kind": "transform",
      "id": "transform:preprocess",
      "operator": {"type": "Preprocess"},
      "variants": [
        {
          "label": "snv",
          "params": {"method": "snv"}
        },
        {
          "label": "msc",
          "params": {"method": "msc"}
        }
      ]
    },
    {
      "kind": "model",
      "id": "model:base",
      "operator": {"type": "Ridge"},
      "variants": [
        {
          "label": "low",
          "params": {"alpha": 0.1}
        },
        {
          "label": "high",
          "params": {"alpha": 1.0}
        }
      ]
    }
  ]
}"#,
    )
    .unwrap();

    let compiled = compile_pipeline_dsl_with_generation(&spec).unwrap();

    assert_eq!(compiled.generation.strategy, GenerationStrategy::Cartesian);
    assert_eq!(compiled.generation.max_variants, Some(4));
    assert_eq!(compiled.generation.dimensions.len(), 2);
    assert_eq!(
        compiled.generation.dimensions[0].name,
        "transform:preprocess.params"
    );
    assert_eq!(compiled.generation.dimensions[0].choices[0].label, "snv");
    assert_eq!(
        compiled.generation.dimensions[0].choices[0].param_overrides[0].node_id,
        NodeId::new("transform:preprocess").unwrap()
    );
    assert_eq!(
        compiled.generation.dimensions[1].choices[1].param_overrides[0].params["alpha"],
        1.0
    );
    assert!(compiled.generation_fingerprint.is_some());
    assert_eq!(
        compiled.graph.search_space_fingerprint,
        compiled.generation_fingerprint
    );
    compiled.graph.validate().unwrap();
}

#[test]
fn expands_compact_param_generators_into_generation_dimensions() {
    let spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-compact-generation",
  "steps": [
    {
      "kind": "model",
      "id": "model:tuned",
      "operator": {"type": "TunedModel"},
      "generators": [
        {
          "kind": "or",
          "name": "model_family",
          "param": "family",
          "values": [
            {"label": "ridge", "value": "ridge"},
            {"label": "rf", "value": "random_forest"}
          ]
        },
        {
          "kind": "range",
          "param": "alpha",
          "start": 0.1,
          "stop": 0.9,
          "step": 0.4
        },
        {
          "kind": "log_range",
          "param": "lambda",
          "start": 0.01,
          "stop": 1.0,
          "count": 3
        },
        {
          "kind": "grid",
          "name": "tree_grid",
          "params": {
            "max_depth": [3, 5],
            "n_estimators": [50, 100]
          },
          "count": 3
        },
        {
          "kind": "pick",
          "param": "views",
          "values": ["snv", "msc", "derivative"],
          "sizes": [1, 2],
          "count": 4
        },
        {
          "kind": "arrange",
          "param": "chain",
          "values": ["snv", "pca", "pls"],
          "sizes": [2],
          "count": 3
        }
      ]
    }
  ]
}"#,
    )
    .unwrap();

    let compiled = compile_pipeline_dsl_with_generation(&spec).unwrap();

    assert_eq!(compiled.generation.strategy, GenerationStrategy::Cartesian);
    assert_eq!(compiled.generation.dimensions.len(), 6);
    assert_eq!(compiled.generation.dimensions[0].name, "model_family");
    assert_eq!(compiled.generation.dimensions[0].choices.len(), 2);
    assert_eq!(
        compiled.generation.dimensions[1].name,
        "model:tuned.alpha.range"
    );
    assert_eq!(compiled.generation.dimensions[1].choices.len(), 3);
    assert_eq!(
        compiled.generation.dimensions[1].choices[1].param_overrides[0].params["alpha"],
        0.5
    );
    assert_eq!(
        compiled.generation.dimensions[2].name,
        "model:tuned.lambda.log_range"
    );
    assert_eq!(compiled.generation.dimensions[2].choices.len(), 3);
    assert_eq!(compiled.generation.dimensions[3].name, "tree_grid");
    assert_eq!(compiled.generation.dimensions[3].choices.len(), 3);
    assert_eq!(
        compiled.generation.dimensions[3].choices[2].param_overrides[0].params["n_estimators"],
        50
    );
    assert_eq!(
        compiled.generation.dimensions[4].choices[3].param_overrides[0].params["views"],
        serde_json::json!(["snv", "msc"])
    );
    assert_eq!(
        compiled.generation.dimensions[5].choices[2].param_overrides[0].params["chain"],
        serde_json::json!(["pca", "snv"])
    );
    assert!(compiled.generation_fingerprint.is_some());
}

fn log_range_repro_spec() -> PipelineDslSpec {
    serde_json::from_str(
            r#"{
  "id": "dsl-log-range-fingerprint",
  "steps": [
    {
      "kind": "model",
      "id": "model:tuned",
      "operator": {"type": "TunedModel"},
      "generators": [
        {"kind": "log_range", "param": "lambda", "start": 0.001, "stop": 1.0, "count": 4, "base": 10.0}
      ]
    }
  ]
}"#,
        )
        .unwrap()
}

/// Regression for the native `log_range` generator: the generated value text
/// must be a JSON round-trip fixpoint so the graph `search_space_fingerprint`
/// and the campaign generation spec stay in agreement through the
/// compile -> serialize -> plan boundary, and the four base-10 points expand
/// to 0.001 / 0.01 / 0.1 / 1.0.
#[test]
fn log_range_generator_compiles_and_plans_through_json_roundtrip() {
    let compiled = compile_pipeline_dsl_with_generation(&log_range_repro_spec()).unwrap();

    // The expanded points are the four base-10 log-range positions
    // (0.001 / 0.01 / 0.1 / 1.0, up to floating-point interpolation error).
    let dimension = &compiled.generation.dimensions[0];
    assert_eq!(dimension.name, "model:tuned.lambda.log_range");
    let values = dimension
        .choices
        .iter()
        .map(|choice| choice.value["lambda"].as_f64().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(values.len(), 4);
    for (got, want) in values.iter().zip([0.001, 0.01, 0.1, 1.0]) {
        assert!(
            (got - want).abs() <= want * 1e-12,
            "log_range point {got} not close to {want}"
        );
    }

    // In-memory the two fingerprints already agree.
    assert_eq!(
        compiled.graph.search_space_fingerprint,
        compiled.generation_fingerprint
    );

    // JSON round-trip the artifact exactly like the CLI / Python (C-ABI)
    // boundary does, then recompute the campaign-side fingerprint: it must
    // still equal the graph-side fingerprint stored at compile time.
    let graph: GraphSpec =
        serde_json::from_str(&serde_json::to_string(&compiled.graph).unwrap()).unwrap();
    let campaign: crate::plan::CampaignSpec =
        serde_json::from_str(&serde_json::to_string(&compiled.campaign_template).unwrap()).unwrap();
    let expected = graph.search_space_fingerprint.clone().unwrap();
    let actual = generation_spec_fingerprint(&campaign.generation).unwrap();
    assert_eq!(
        expected, actual,
        "log_range search_space_fingerprint must survive the JSON round-trip"
    );

    // And it actually plans (this is the call that previously raised
    // `search_space_fingerprint does not match campaign generation spec`).
    let mut registry = ControllerRegistry::new();
    registry
        .register(registry_manifest(
            "controller:model",
            NodeKind::Model,
            &["TunedModel"],
        ))
        .unwrap();
    let plan =
        crate::plan::build_execution_plan("plan:log-range", graph, campaign, &registry).unwrap();
    assert_eq!(plan.variants.len(), 4);
}

/// The compiled log_range plan must be byte-identical for the same spec
/// (deterministic generation + fingerprints), while `range` and `grid`
/// generators are unaffected by the canonicalization.
#[test]
fn log_range_generation_is_deterministic_and_range_grid_unaffected() {
    let a = compile_pipeline_dsl_with_generation(&log_range_repro_spec()).unwrap();
    let b = compile_pipeline_dsl_with_generation(&log_range_repro_spec()).unwrap();
    assert_eq!(
        serde_json::to_string(&a).unwrap(),
        serde_json::to_string(&b).unwrap(),
    );
    assert_eq!(a.generation_fingerprint, b.generation_fingerprint);

    // range + grid still compile to matching graph/campaign fingerprints
    // (canonicalization is a no-op for their round-trip-stable values).
    let spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-range-grid-fingerprint",
  "steps": [
    {
      "kind": "model",
      "id": "model:tuned",
      "operator": {"type": "TunedModel"},
      "generators": [
        {"kind": "range", "param": "alpha", "start": 0.1, "stop": 0.9, "step": 0.4},
        {"kind": "grid", "name": "tree_grid", "params": {"max_depth": [3, 5]}}
      ]
    }
  ]
}"#,
    )
    .unwrap();
    let compiled = compile_pipeline_dsl_with_generation(&spec).unwrap();
    let graph: GraphSpec =
        serde_json::from_str(&serde_json::to_string(&compiled.graph).unwrap()).unwrap();
    let campaign: crate::plan::CampaignSpec =
        serde_json::from_str(&serde_json::to_string(&compiled.campaign_template).unwrap()).unwrap();
    assert_eq!(
        graph.search_space_fingerprint.unwrap(),
        generation_spec_fingerprint(&campaign.generation).unwrap()
    );
}

#[test]
fn compact_param_generators_reject_invalid_counts() {
    let spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-bad-compact-generation",
  "steps": [
    {
      "kind": "model",
      "id": "model:bad",
      "operator": {"type": "Ridge"},
      "generators": [
        {
          "kind": "or",
          "param": "alpha",
          "values": [0.1, 1.0],
          "count": 0
        }
      ]
    }
  ]
}"#,
    )
    .unwrap();

    let error = compile_pipeline_dsl_with_generation(&spec).unwrap_err();
    assert!(format!("{error}").contains("count=0"));
}

#[test]
fn compiles_coordinated_generation_dimensions() {
    let spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-coordinated-generation",
  "max_variants": 2,
  "generation_dimensions": [
    {
      "name": "stack_profile",
      "choices": [
        {
          "label": "linear_stack",
          "param_overrides": [
            {"node_id": "branch:b0.model:ridge", "params": {"alpha": 0.1}},
            {"node_id": "branch:b1.model:rf", "params": {"max_depth": 4}},
            {"node_id": "merge:stack.pred_plus_original.meta:ridge", "params": {"alpha": 0.05}}
          ]
        },
        {
          "label": "robust_stack",
          "param_overrides": [
            {"node_id": "branch:b0.model:ridge", "params": {"alpha": 1.0}},
            {"node_id": "branch:b1.model:rf", "params": {"max_depth": 8}},
            {"node_id": "merge:stack.pred_plus_original.meta:ridge", "params": {"alpha": 0.5}}
          ]
        }
      ]
    }
  ],
  "steps": [
    {
      "kind": "branch",
      "branches": [
        {
          "id": "b0",
          "steps": [
            {
              "kind": "model",
              "id": "branch:b0.model:ridge",
              "operator": {"type": "Ridge"}
            }
          ]
        },
        {
          "id": "b1",
          "steps": [
            {
              "kind": "model",
              "id": "branch:b1.model:rf",
              "operator": {"type": "RandomForestRegressor"}
            }
          ]
        }
      ]
    },
    {
      "kind": "merge_model",
      "id": "merge:stack.pred_plus_original.meta:ridge",
      "operator": {"type": "RidgeMetaStacker"}
    }
  ]
}"#,
    )
    .unwrap();

    let compiled = compile_pipeline_dsl_with_generation(&spec).unwrap();

    assert_eq!(compiled.generation.strategy, GenerationStrategy::Cartesian);
    assert_eq!(compiled.generation.max_variants, Some(2));
    assert_eq!(compiled.generation.dimensions.len(), 1);
    assert_eq!(compiled.generation.dimensions[0].name, "stack_profile");
    assert_eq!(
        compiled.generation.dimensions[0].choices[0]
            .param_overrides
            .len(),
        3
    );
    assert_eq!(
        compiled.generation.dimensions[0].choices[1].param_overrides[2].node_id,
        NodeId::new("merge:stack.pred_plus_original.meta:ridge").unwrap()
    );
    assert_eq!(
        compiled.generation.dimensions[0].choices[1].value
            ["merge:stack.pred_plus_original.meta:ridge"]["alpha"],
        0.5
    );
    assert_eq!(
        compiled.graph.search_space_fingerprint,
        compiled.generation_fingerprint
    );
    compiled.graph.validate().unwrap();
}

#[test]
fn compiles_generation_constraints_and_prunes_variants() {
    // Two explicit param-override dimensions (2x2 = 4 variants) with a `generation_constraints`
    // block declaring a single mutex pair; the compiled GenerationSpec carries the constraint and
    // `enumerate_variants` prunes the co-occurring variant -> 3 survivors (the DSL arrival path for
    // item B, end-to-end into the native prune).
    let spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-generation-constraints",
  "max_variants": 4,
  "generation_dimensions": [
    {
      "name": "alpha",
      "choices": [
        {"label": "low", "param_overrides": [{"node_id": "model:ridge", "params": {"alpha": 0.1}}]},
        {"label": "high", "param_overrides": [{"node_id": "model:ridge", "params": {"alpha": 1.0}}]}
      ]
    },
    {
      "name": "depth",
      "choices": [
        {"label": "shallow", "param_overrides": [{"node_id": "model:ridge", "params": {"solver_depth": 2}}]},
        {"label": "deep", "param_overrides": [{"node_id": "model:ridge", "params": {"solver_depth": 8}}]}
      ]
    }
  ],
  "generation_constraints": {
    "mutex": [[{"dimension": "alpha", "label": "low"}, {"dimension": "depth", "label": "deep"}]]
  },
  "steps": [
    {
      "kind": "model",
      "id": "model:ridge",
      "operator": {"type": "Ridge"}
    }
  ]
}"#,
    )
    .unwrap();

    let compiled = compile_pipeline_dsl_with_generation(&spec).unwrap();

    // The constraint compiled onto the GenerationSpec.
    assert_eq!(compiled.generation.constraints.mutex.len(), 1);
    assert_eq!(
        compiled.generation.constraints.mutex[0],
        vec![
            ChoiceRef {
                dimension: "alpha".to_string(),
                label: "low".to_string()
            },
            ChoiceRef {
                dimension: "depth".to_string(),
                label: "deep".to_string()
            }
        ]
    );

    // The native prune drops {alpha:low, depth:deep} -> 3 survivors, none carrying that pair.
    let variants =
        crate::generation::enumerate_variants(&compiled.generation, spec.root_seed).unwrap();
    assert_eq!(variants.len(), 3);
    for variant in &variants {
        let is_low_deep = variant
            .choices
            .get("alpha")
            .is_some_and(|choice| choice.label == "low")
            && variant
                .choices
                .get("depth")
                .is_some_and(|choice| choice.label == "deep");
        assert!(!is_low_deep, "the mutex-violating variant survived pruning");
    }

    // An unknown constraint ref is refused at compile time.
    let mut bad = spec.clone();
    bad.generation_constraints = Some(PipelineDslGenerationConstraints {
        exclude: vec![[
            PipelineDslChoiceRef {
                dimension: "alpha".to_string(),
                label: "low".to_string(),
            },
            PipelineDslChoiceRef {
                dimension: "depth".to_string(),
                label: "nope".to_string(),
            },
        ]],
        ..PipelineDslGenerationConstraints::default()
    });
    let error = compile_pipeline_dsl_with_generation(&bad)
        .unwrap_err()
        .to_string();
    assert!(error.contains("unknown choice `depth:nope`"), "{error}");
}

#[test]
fn compiles_active_subsequence_only_generation_choice() {
    // An operator-level variant: the DSL choice carries ONLY active_subsequence (no
    // param_overrides). It must compile to a GenerationChoice that preserves the
    // active_subsequence and has empty param_overrides, with the value defaulting to the
    // active_subsequence string when no explicit value is supplied.
    let choice = PipelineDslGenerationChoice {
        label: "snv_branch".to_string(),
        value: None,
        param_overrides: Vec::new(),
        active_subsequence: Some("seq:snv".to_string()),
    };
    let node_ids = BTreeSet::from([NodeId::new("model:base").unwrap()]);

    let compiled = compile_explicit_generation_choice("preprocessing", &choice, &node_ids).unwrap();

    assert_eq!(compiled.label, "snv_branch");
    assert_eq!(compiled.active_subsequence.as_deref(), Some("seq:snv"));
    assert!(compiled.param_overrides.is_empty());
    assert_eq!(compiled.value, serde_json::json!("seq:snv"));

    // A choice with NEITHER param_overrides nor active_subsequence is rejected.
    let empty = PipelineDslGenerationChoice {
        label: "nothing".to_string(),
        value: None,
        param_overrides: Vec::new(),
        active_subsequence: None,
    };
    let error = compile_explicit_generation_choice("preprocessing", &empty, &node_ids).unwrap_err();
    assert!(format!("{error}").contains("has neither param_overrides nor active_subsequence"));
}

#[test]
fn refuses_coordinated_generation_for_unknown_node() {
    let spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-bad-generation-target",
  "generation_dimensions": [
    {
      "name": "bad_target",
      "choices": [
        {
          "label": "bad",
          "param_overrides": [
            {"node_id": "model:missing", "params": {"alpha": 0.1}}
          ]
        }
      ]
    }
  ],
  "steps": [
    {
      "kind": "model",
      "id": "model:base",
      "operator": {"type": "Ridge"}
    }
  ]
}"#,
    )
    .unwrap();

    let error = compile_pipeline_dsl_with_generation(&spec).unwrap_err();
    assert!(format!("{error}").contains("references unknown node `model:missing`"));
}

#[test]
fn artifact_contains_campaign_template_without_split_graph_nodes() {
    let spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-campaign-template",
  "campaign_id": "campaign:dsl.template",
  "root_seed": 123,
  "leakage_policy": {
    "split_unit": "group",
    "require_group_ids": true
  },
  "split_invocation": {
    "id": "split:group-kfold",
    "leakage_policy": {
      "split_unit": "group",
      "require_group_ids": true
    },
    "params": {
      "n_splits": 3
    }
  },
  "generation_dimensions": [
    {
      "name": "model_family",
      "choices": [
        {
          "label": "ridge_low",
          "param_overrides": [
            {"node_id": "model:base", "params": {"alpha": 0.1}}
          ]
        },
        {
          "label": "ridge_high",
          "param_overrides": [
            {"node_id": "model:base", "params": {"alpha": 1.0}}
          ]
        }
      ]
    }
  ],
  "data_bindings": [
    {
      "node_id": "model:base",
      "input_name": "x",
      "request_id": "data:model.base.x",
      "schema_fingerprint": "f97b37872fa22134b508f98fd8e207e5b776b52594fb8f6f5c3e15bee212246b",
      "plan_fingerprint": "7c5431d85574b3f337022fa5d25971d5b5cf445b90331b49938f573ff6901e4d",
      "relation_fingerprint": "a3a7e329df35db9f2883a17b8611b7fae6dcaa031875e3ec2c9be1b9e29cbe10",
      "output_representation": "tabular_numeric",
      "feature_set_id": "x",
      "source_ids": ["nir"],
      "require_relations": true
    }
  ],
  "steps": [
    {
      "kind": "model",
      "id": "model:base",
      "operator": {"type": "Ridge"}
    }
  ],
  "campaign_metadata": {
    "owner": "dsl-test"
  }
}"#,
    )
    .unwrap();

    let compiled = compile_pipeline_dsl_with_generation(&spec).unwrap();

    assert_eq!(compiled.campaign_template.id, "campaign:dsl.template");
    assert_eq!(compiled.campaign_template.root_seed, Some(123));
    assert_eq!(
        compiled
            .campaign_template
            .split_invocation
            .as_ref()
            .unwrap()
            .id,
        "split:group-kfold"
    );
    assert_eq!(compiled.campaign_template.generation, compiled.generation);
    assert_eq!(
        compiled.data_bindings[&NodeId::new("model:base").unwrap()][0].request_id,
        "data:model.base.x"
    );
    assert_eq!(
        compiled.campaign_template.data_bindings,
        compiled.data_bindings
    );
    assert_eq!(compiled.graph.nodes.len(), 1);
    assert!(compiled
        .graph
        .nodes
        .iter()
        .all(|node| !node.id.as_str().starts_with("split:")));
}

#[test]
fn refuses_data_binding_for_unknown_or_non_data_port() {
    let unknown_input_spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-bad-data-binding",
  "data_bindings": [
    {
      "node_id": "model:base",
      "input_name": "missing",
      "request_id": "data:bad",
      "schema_fingerprint": "f97b37872fa22134b508f98fd8e207e5b776b52594fb8f6f5c3e15bee212246b",
      "plan_fingerprint": "7c5431d85574b3f337022fa5d25971d5b5cf445b90331b49938f573ff6901e4d",
      "output_representation": "tabular_numeric"
    }
  ],
  "steps": [
    {
      "kind": "model",
      "id": "model:base",
      "operator": {"type": "Ridge"}
    }
  ]
}"#,
    )
    .unwrap();
    let error = compile_pipeline_dsl_with_generation(&unknown_input_spec).unwrap_err();
    assert!(format!("{error}").contains("unknown input port `missing`"));

    let prediction_input_spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-prediction-port-data-binding",
  "data_bindings": [
    {
      "node_id": "merge:stack.pred_plus_original.meta:ridge",
      "input_name": "b0_oof",
      "request_id": "data:bad.prediction-port",
      "schema_fingerprint": "f97b37872fa22134b508f98fd8e207e5b776b52594fb8f6f5c3e15bee212246b",
      "plan_fingerprint": "7c5431d85574b3f337022fa5d25971d5b5cf445b90331b49938f573ff6901e4d",
      "output_representation": "tabular_numeric"
    }
  ],
  "steps": [
    {
      "kind": "branch",
      "branches": [
        {
          "id": "b0",
          "steps": [
            {
              "kind": "model",
              "id": "branch:b0.model:ridge",
              "operator": {"type": "Ridge"}
            }
          ]
        }
      ]
    },
    {
      "kind": "merge_model",
      "id": "merge:stack.pred_plus_original.meta:ridge",
      "operator": {"type": "RidgeMetaStacker"}
    }
  ]
}"#,
    )
    .unwrap();
    let error = compile_pipeline_dsl_with_generation(&prediction_input_spec).unwrap_err();
    assert!(format!("{error}").contains("targets non-data input"));
}

#[test]
fn extracts_shape_plans_into_compiled_artifact() {
    let spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-shape-plan-smoke",
  "steps": [
    {
      "kind": "augmentation",
      "id": "augment:synthetic",
      "operator": {"type": "SampleAugmenter"},
      "shape": {
        "input_granularity": "sample",
        "target_granularity": "sample",
        "fit_rows": "fold_train",
        "predict_rows": "fold_validation",
        "feature_namespace": "aug.synthetic",
        "augmentation_policy": {
          "sample_scope": "train_only",
          "feature_scope": "none",
          "require_origin_id": true,
          "inherit_group": true,
          "inherit_target": true
        }
      }
    },
    {
      "kind": "transform",
      "id": "transform:select",
      "operator": {"type": "SupervisedFeatureSelector"},
      "shape": {
        "fit_rows": "fold_train",
        "feature_namespace": "selected",
        "selection_policy": {
          "scope": "supervised_fold_train",
          "store_masks": true
        }
      }
    },
    {
      "kind": "model",
      "id": "model:base",
      "operator": {"type": "Ridge"}
    }
  ]
}"#,
    )
    .unwrap();

    let compiled = compile_pipeline_dsl_with_generation(&spec).unwrap();

    assert_eq!(compiled.shape_plans.len(), 2);
    let augment_plan = compiled
        .shape_plans
        .get(&NodeId::new("augment:synthetic").unwrap())
        .unwrap();
    assert_eq!(
        augment_plan.feature_namespace.as_deref(),
        Some("aug.synthetic")
    );
    assert_eq!(
        augment_plan.augmentation_policy.sample_scope,
        crate::policy::AugmentationScope::TrainOnly
    );
    let select_plan = compiled
        .shape_plans
        .get(&NodeId::new("transform:select").unwrap())
        .unwrap();
    assert_eq!(
        select_plan.selection_policy.scope,
        crate::policy::FeatureSelectionScope::SupervisedFoldTrain
    );
    assert_eq!(compiled.generation.strategy, GenerationStrategy::None);
    compiled.graph.validate().unwrap();
}

#[test]
fn compiles_sequential_filter_and_or_generator_surface() {
    let spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-generator-or-parity",
  "steps": [
    {
      "kind": "sequential",
      "id": "seq:pre",
      "steps": [
        {
          "kind": "sample_filter",
          "id": "filter:y_outlier",
          "operator": {"class": "nirs4all.operators.filters.YOutlierFilter"},
          "params": {"mode": "any"}
        },
        {
          "kind": "transform",
          "id": "transform:scale",
          "operator": {"class": "sklearn.preprocessing.StandardScaler"}
        }
      ]
    },
    {
      "kind": "generator",
      "id": "generator:model_choices",
      "mode": "or",
      "pick": 1,
      "branches": [
        {
          "id": "pls",
          "steps": [
            {
              "kind": "model",
              "id": "model:pls",
              "operator": {"class": "sklearn.cross_decomposition.PLSRegression"},
              "params": {"n_components": 8}
            }
          ]
        },
        {
          "id": "rf",
          "steps": [
            {
              "kind": "model",
              "id": "model:rf",
              "operator": {"class": "sklearn.ensemble.RandomForestRegressor"},
              "params": {"n_estimators": 64}
            }
          ]
        }
      ]
    },
    {
      "kind": "merge",
      "id": "merge:generated",
      "output_as": "features",
      "include_original_data": false,
      "selectors": [
        {"branch": "generator:model_choices:choice0", "select": "all"}
      ]
    }
  ]
}"#,
    )
    .unwrap();

    let graph = compile_pipeline_dsl(&spec).unwrap();
    graph.validate().unwrap();
    let filter = graph
        .nodes
        .iter()
        .find(|node| node.id.as_str() == "filter:y_outlier")
        .unwrap();
    assert_eq!(filter.kind, NodeKind::Exclude);
    assert_eq!(filter.metadata["dsl_filter_kind"], "sample");

    let generated_models = graph
        .nodes
        .iter()
        .filter(|node| node.kind == NodeKind::Model)
        .collect::<Vec<_>>();
    assert_eq!(generated_models.len(), 2);
    assert!(generated_models
        .iter()
        .all(|node| node.id.as_str().starts_with("gen:generator_model_choices")));
    assert!(generated_models.iter().all(|node| {
        node.metadata
            .get("dsl_generator")
            .and_then(|value| value.as_str())
            == Some("generator:model_choices")
    }));

    let merge_inputs = graph
        .nodes
        .iter()
        .find(|node| node.id.as_str() == "merge:generated")
        .unwrap()
        .ports
        .inputs
        .iter()
        .map(|port| port.name.as_str())
        .collect::<Vec<_>>();
    assert_eq!(
        merge_inputs,
        vec![
            "generator_model_choices_choice0_oof",
            "generator_model_choices_choice1_oof"
        ]
    );
}

/// Group a compiled graph's namespaced generator nodes (`gen:<g>:c<i>:n<k>.<orig>`) by their
/// `c<i>` choice index — an INDEPENDENT oracle for the mirror test, derived straight from the graph
/// the existing Mechanism B compile produced (not from the operator-variant model under test).
fn graph_choice_node_groups(graph: &GraphSpec) -> BTreeMap<usize, BTreeSet<NodeId>> {
    let mut groups = BTreeMap::<usize, BTreeSet<NodeId>>::new();
    for node in &graph.nodes {
        let Some(rest) = node.id.as_str().strip_prefix("gen:") else {
            continue;
        };
        // rest = "<g>:c<i>:n<k>.<orig>"; the choice index is the `c<i>` segment.
        let choice_index = rest
            .split(':')
            .find_map(|segment| segment.strip_prefix('c'))
            .and_then(|index| index.split('n').next())
            .and_then(|index| index.parse::<usize>().ok())
            .unwrap_or_else(|| panic!("unexpected namespaced node id `{}`", node.id));
        groups
            .entry(choice_index)
            .or_default()
            .insert(node.id.clone());
    }
    groups
}

/// Phase-3 MIRROR TEST — the operator-variant model is the faithful mirror of Mechanism B's
/// namespaced sub-sequences, proven WITHOUT running native execution.
///
/// For the committed operator-level generator example (`pipeline_dsl_nirs4all_generator_parity`,
/// a 2×2 cartesian preproc/model search), this asserts:
///   (a) the generated operator-variant SET (the dimension choices + their exact active-node-id
///       sets) matches the EXPECTED set derived independently from the compiled graph's namespaced
///       sub-sequences — each choice's active set equals exactly its sub-sequence's namespaced
///       nodes (the authoritative minted set), and (union with the shared non-gen nodes) equals the
///       set of nodes that choice executes;
///   (b) `enumerate_variants` over the model's generation spec yields one `VariantPlan` per choice;
///   (c) the existing Mechanism B compile is UNCHANGED (graph has no operator dimension folded in:
///       `generation.strategy == None`, `search_space_fingerprint == None`).
#[cfg(dag_ml_workspace_contract_fixtures)]
#[test]
fn operator_variant_model_mirrors_generator_subsequences() {
    let spec: PipelineDslSpec = serde_json::from_str(include_str!(
        "../../../../examples/pipeline_dsl_nirs4all_generator_parity.json"
    ))
    .unwrap();

    // The unchanged Mechanism B compile.
    let compiled = compile_pipeline_dsl_with_generation(&spec).unwrap();
    // (c) NO operator dimension is folded into the existing generation / fingerprint.
    assert_eq!(compiled.generation.strategy, GenerationStrategy::None);
    assert!(compiled.generation.dimensions.is_empty());
    assert_eq!(compiled.graph.search_space_fingerprint, None);
    assert_eq!(compiled.generation_fingerprint, None);

    // The new opt-in derivation.
    let models = compile_operator_variant_models(&spec).unwrap();
    assert_eq!(models.len(), 1, "one operator-level generator in the spec");
    let model = &models[0];
    model.validate().unwrap();
    assert_eq!(
        model.generator_id.as_str(),
        "generator:preproc_model_cartesian"
    );

    // The 2×2 cartesian produces exactly 4 operator choices, each operator-only.
    assert_eq!(model.dimension.choices.len(), 4);
    assert_eq!(model.active_nodes.len(), 4);
    for choice in &model.dimension.choices {
        assert!(choice.param_overrides.is_empty());
        assert_eq!(
            choice.active_subsequence.as_deref(),
            Some(choice.label.as_str()),
            "active_subsequence carries the choice key/namespace"
        );
    }

    // The choice keys are the stable Mechanism B choice ids (also the OOF lane selector branch ids).
    let choice_keys = model
        .dimension
        .choices
        .iter()
        .map(|choice| choice.label.clone())
        .collect::<Vec<_>>();
    assert_eq!(
        choice_keys,
        vec![
            "generator:preproc_model_cartesian:choice0",
            "generator:preproc_model_cartesian:choice1",
            "generator:preproc_model_cartesian:choice2",
            "generator:preproc_model_cartesian:choice3",
        ]
    );

    // (a) The EXPECTED active sets, derived independently from the compiled graph's namespaced
    // sub-sequences. Each choice's authoritative active set == exactly its sub-sequence's
    // namespaced nodes (the minted set), keyed by `c<i>` index in choice order.
    let graph_groups = graph_choice_node_groups(&compiled.graph);
    assert_eq!(graph_groups.len(), 4);
    for (choice_index, choice) in model.dimension.choices.iter().enumerate() {
        let key = choice.active_subsequence.as_ref().unwrap();
        let model_set = &model.active_nodes[key];
        let expected_set = &graph_groups[&choice_index];
        assert_eq!(
            model_set, expected_set,
            "choice {choice_index} active set must mirror its namespaced sub-sequence exactly"
        );
        // Every node in the active set is a real node in the compiled graph.
        for node_id in model_set {
            assert!(
                compiled.graph.nodes.iter().any(|node| &node.id == node_id),
                "active node `{node_id}` must exist in the compiled graph"
            );
        }
    }

    // The active sets are disjoint across choices (each sub-sequence is its own namespace).
    for left in 0..4 {
        for right in (left + 1)..4 {
            let lhs = &graph_groups[&left];
            let rhs = &graph_groups[&right];
            assert!(
                lhs.is_disjoint(rhs),
                "choice {left} and {right} sub-sequences must not share namespaced nodes"
            );
        }
    }

    // The contract's union relationship: each choice's executed nodes == its sub-sequence's nodes
    // ∪ the shared non-gen nodes. The shared non-gen nodes are the graph nodes outside every
    // generator namespace (here: filter:y_outlier, merge:generator_predictions, model:meta).
    let shared_non_gen = compiled
        .graph
        .nodes
        .iter()
        .filter(|node| !node.id.as_str().starts_with("gen:"))
        .map(|node| node.id.clone())
        .collect::<BTreeSet<_>>();
    assert_eq!(shared_non_gen.len(), 3);
    for choice_index in 0..4 {
        let mut executed = graph_groups[&choice_index].clone();
        executed.extend(shared_non_gen.iter().cloned());
        assert!(
            shared_non_gen.is_subset(&executed),
            "choice {choice_index} executes the shared non-gen nodes"
        );
        assert!(
            graph_groups[&choice_index].is_subset(&executed),
            "choice {choice_index} executes its own sub-sequence nodes"
        );
    }

    // (b) enumerate_variants over the model's generation spec yields one VariantPlan per choice.
    let generation = model.generation_spec();
    generation.validate().unwrap();
    let variants = crate::generation::enumerate_variants(&generation, spec.root_seed).unwrap();
    assert_eq!(variants.len(), 4, "one VariantPlan per operator choice");
    let dimension_name = model.dimension.name.clone();
    for variant in &variants {
        let choice = &variant.choices[&dimension_name];
        assert!(choice.active_subsequence.is_some());
        assert!(choice.param_overrides.is_empty());
        assert!(model
            .active_nodes
            .contains_key(choice.active_subsequence.as_ref().unwrap()));
    }
    let variant_subsequences = variants
        .iter()
        .map(|variant| {
            variant.choices[&dimension_name]
                .active_subsequence
                .clone()
                .unwrap()
        })
        .collect::<BTreeSet<_>>();
    assert_eq!(
        variant_subsequences,
        choice_keys.iter().cloned().collect::<BTreeSet<_>>(),
        "the VariantPlan set covers exactly the operator choices"
    );
}

/// Determinism + fingerprint stability for the operator-variant model (extends the
/// `cartesian_generation_is_deterministic_and_fingerprinted` pattern to the operator dimension):
/// two derivations are byte-identical, the model's generation spec fingerprints stably, and a
/// changed sub-sequence moves the fingerprint.
#[cfg(dag_ml_workspace_contract_fixtures)]
#[test]
fn operator_variant_model_is_deterministic_and_fingerprinted() {
    let spec: PipelineDslSpec = serde_json::from_str(include_str!(
        "../../../../examples/pipeline_dsl_nirs4all_generator_parity.json"
    ))
    .unwrap();

    let left = compile_operator_variant_models(&spec).unwrap();
    let right = compile_operator_variant_models(&spec).unwrap();
    assert_eq!(left, right, "derivation is deterministic");

    let generation = left[0].generation_spec();
    let fingerprint = generation_spec_fingerprint(&generation).unwrap();
    assert_eq!(
        fingerprint,
        generation_spec_fingerprint(&left[0].generation_spec()).unwrap()
    );

    // A spec with a different sub-sequence (an extra model branch) yields a different operator
    // dimension and a different fingerprint.
    let mut changed = spec.clone();
    if let Some(PipelineDslStep::Generator(generator)) = changed
        .steps
        .iter_mut()
        .find(|step| matches!(step, PipelineDslStep::Generator(_)))
    {
        // Drop one model branch from the second stage: 2×1 instead of 2×2.
        generator.stages[1].branches.truncate(1);
    } else {
        panic!("expected a generator step");
    }
    let changed_models = compile_operator_variant_models(&changed).unwrap();
    assert_eq!(changed_models[0].dimension.choices.len(), 2);
    assert_ne!(
        fingerprint,
        generation_spec_fingerprint(&changed_models[0].generation_spec()).unwrap(),
        "a different sub-sequence set moves the fingerprint"
    );
}

/// A spec with NO operator-level generator yields no operator-variant models (the derivation is a
/// no-op for the common case).
#[test]
fn operator_variant_model_empty_without_operator_generators() {
    let spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-no-operator-generator",
  "steps": [
    {
      "kind": "transform",
      "id": "transform:scale",
      "operator": {"class": "sklearn.preprocessing.StandardScaler"}
    },
    {
      "kind": "model",
      "id": "model:base",
      "operator": {"class": "sklearn.linear_model.Ridge"}
    }
  ]
}"#,
    )
    .unwrap();
    assert!(compile_operator_variant_models(&spec).unwrap().is_empty());
}

/// MUST-FIX 1: active_nodes contains ONLY ids that become real emitted graph nodes. A NAMED
/// `sequential` inside a generator branch consumes a namespace counter slot but is NOT emitted as a
/// graph node (`compile_sequence_container` writes only metadata) — its phantom container id must be
/// absent from the active set, which must match the independent graph-derived oracle exactly.
#[test]
fn operator_variant_model_excludes_phantom_container_nodes() {
    let spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-named-seq-in-generator",
  "steps": [
    {
      "kind": "generator",
      "id": "generator:choices",
      "mode": "or",
      "pick": 1,
      "branches": [
        {
          "id": "pls",
          "steps": [
            {
              "kind": "sequential",
              "id": "seq:inner",
              "steps": [
                {
                  "kind": "transform",
                  "id": "transform:scale",
                  "operator": {"class": "sklearn.preprocessing.StandardScaler"}
                },
                {
                  "kind": "model",
                  "id": "model:pls",
                  "operator": {"class": "sklearn.cross_decomposition.PLSRegression"},
                  "params": {"n_components": 8}
                }
              ]
            }
          ]
        },
        {
          "id": "ridge",
          "steps": [
            {
              "kind": "model",
              "id": "model:ridge",
              "operator": {"class": "sklearn.linear_model.Ridge"}
            }
          ]
        }
      ]
    },
    {
      "kind": "merge",
      "id": "merge:generated",
      "output_as": "features",
      "include_original_data": false,
      "selectors": [
        {"branch": "generator:choices:choice0", "select": "all"}
      ]
    },
    {
      "kind": "model",
      "id": "model:meta",
      "operator": {"class": "sklearn.linear_model.Ridge"}
    }
  ]
}"#,
    )
    .unwrap();

    let compiled = compile_pipeline_dsl_with_generation(&spec).unwrap();
    let models = compile_operator_variant_models(&spec).unwrap();
    assert_eq!(models.len(), 1);
    let model = &models[0];
    model.validate().unwrap();
    assert_eq!(model.dimension.choices.len(), 2);

    // The named-sequential container id is namespaced (it occupies counter slot n0 of choice 0) but
    // is NOT an emitted graph node, so it must NOT appear in any active set.
    for (key, nodes) in &model.active_nodes {
        assert!(
            !nodes
                .iter()
                .any(|node| node.as_str().contains(".seq_inner")),
            "active set for `{key}` must not contain the phantom sequential container id: {nodes:?}"
        );
    }

    // Every active set equals exactly its sub-sequence's EMITTED graph nodes (the oracle derived
    // straight from the compiled graph).
    let graph_groups = graph_choice_node_groups(&compiled.graph);
    assert_eq!(graph_groups.len(), 2);
    for (choice_index, choice) in model.dimension.choices.iter().enumerate() {
        let key = choice.active_subsequence.as_ref().unwrap();
        assert_eq!(
            &model.active_nodes[key], &graph_groups[&choice_index],
            "choice {choice_index} active set must equal exactly its emitted graph nodes"
        );
        // Every active node is a real graph node.
        for node_id in &model.active_nodes[key] {
            assert!(
                compiled.graph.nodes.iter().any(|node| &node.id == node_id),
                "active node `{node_id}` must exist in the compiled graph"
            );
        }
    }
    // Choice 0 (pls): the named sequential's two operator children only (scale + pls).
    assert_eq!(
        model.active_nodes[&model.dimension.choices[0].label].len(),
        2
    );
}

/// MUST-FIX 1(b): a nested operator-generator (a `generator` inside another generator's branch) is
/// rejected with a clear error — Phase 3 covers flat operator generators only.
#[test]
fn operator_variant_model_rejects_nested_generator() {
    let spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-nested-generator",
  "steps": [
    {
      "kind": "generator",
      "id": "generator:outer",
      "mode": "or",
      "pick": 1,
      "branches": [
        {
          "id": "branch_a",
          "steps": [
            {
              "kind": "generator",
              "id": "generator:inner",
              "mode": "or",
              "pick": 1,
              "branches": [
                {
                  "id": "pls",
                  "steps": [
                    {
                      "kind": "model",
                      "id": "model:pls",
                      "operator": {"class": "sklearn.cross_decomposition.PLSRegression"}
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "kind": "merge",
      "id": "merge:generated",
      "output_as": "features",
      "include_original_data": false,
      "selectors": [
        {"branch": "generator:outer:choice0", "select": "all"}
      ]
    },
    {
      "kind": "model",
      "id": "model:meta",
      "operator": {"class": "sklearn.linear_model.Ridge"}
    }
  ]
}"#,
    )
    .unwrap();
    let error = compile_operator_variant_models(&spec)
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("nested operator-generator") && error.contains("generator:inner"),
        "{error}"
    );
}

/// Phase 5 HOST CONTRACT: a known lowered operator sub-sequence hashes to a PINNED `variant_label`
/// sha256. The constant is the cross-language contract — the nirs4all host recomputes the SAME bytes
/// from its own operator-choice config (`sha256` of the JSON array of `{"kind", "class", "params"}`
/// steps in step order, sorted keys, finite numbers, value forms preserved), so this constant MUST
/// NOT drift. A bare-string operator renders `class` to itself; an object operator renders `class`
/// to its COMPACT CANONICAL JSON text (sorted keys); `params` are carried verbatim (`5` stays `5`).
#[test]
fn operator_variant_label_matches_pinned_host_contract() {
    let steps = vec![
        PipelineDslStep::Transform(PipelineDslOperatorStep {
            id: NodeId::new("transform:snv").unwrap(),
            operator: serde_json::Value::String("SNV".to_string()),
            params: BTreeMap::new(),
            metadata: BTreeMap::new(),
            seed_label: None,
            representation: None,
            train_params: BTreeMap::new(),
            tuning: None,
            variants: Vec::new(),
            param_generators: Vec::new(),
            shape: None,
            inner_cv: None,
        }),
        PipelineDslStep::Model(PipelineDslOperatorStep {
            id: NodeId::new("model:pls").unwrap(),
            operator: serde_json::json!({"class": "sklearn.cross_decomposition.PLSRegression"}),
            params: BTreeMap::from([("n_components".to_string(), serde_json::json!(5))]),
            metadata: BTreeMap::new(),
            seed_label: None,
            representation: None,
            train_params: BTreeMap::new(),
            tuning: None,
            variants: Vec::new(),
            param_generators: Vec::new(),
            shape: None,
            inner_cv: None,
        }),
    ];

    // The canonical bytes that BOTH dag-ml and the nirs4all host hash (build it explicitly here to
    // pin the exact contract shape the host must reproduce).
    let canonical = serde_json::json!([
        {"kind": "transform", "class": "SNV", "params": {}},
        {
            "kind": "model",
            "class": "{\"class\":\"sklearn.cross_decomposition.PLSRegression\"}",
            "params": {"n_components": 5}
        }
    ]);
    let expected = crate::campaign::stable_json_fingerprint(&canonical).unwrap();

    let label = operator_variant_label(&steps).unwrap();
    assert_eq!(
        label, expected,
        "operator_variant_label must equal the sha256 of the explicit canonical array"
    );
    // PIN the constant — this is the cross-language contract; drift here breaks the host mapping.
    assert_eq!(
        label, "50df90622e0ee5a318ca81b7a6668bb815509b79f5b34794bde052ac5c692de9",
        "pinned operator-variant content fingerprint drifted from the host contract"
    );
}

/// Phase 5 CROSS-REPO FIXTURE: the `docs/contracts/operator_variant_label.v1.json` fixture's
/// `steps_json` runs through the SAME JSON entry point the dag-ml-py host helper
/// (`canonical_operator_variant_label`) calls, and reproduces the fixture's pinned `variant_label`.
/// This is the byte-identity anchor both repos validate against (`scripts/validate_contracts.py`
/// recomputes the SAME digest from `canonical_value`).
#[cfg(dag_ml_workspace_contract_fixtures)]
#[test]
fn operator_variant_label_fixture_steps_json_matches_pinned() {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../docs/contracts/operator_variant_label.v1.json"
    ))
    .unwrap();
    let case = &fixture["case"];
    let steps_json = case["steps_json"].as_str().unwrap();
    let expected = case["variant_label"].as_str().unwrap();
    let label = operator_variant_label_from_steps_json(steps_json).unwrap();
    assert_eq!(
        label, expected,
        "fixture steps_json must hash to the pinned variant_label via the host-helper codepath"
    );
}

/// Phase 5: `operator_variant_label` preserves numeric VALUE FORMS — `1` and `1.0` are distinct
/// canonical bytes (the DSL carries them distinctly), so they hash to DIFFERENT labels. This guards
/// the "do not coerce 1 vs 1.0" clause of the contract.
#[test]
fn operator_variant_label_preserves_numeric_value_forms() {
    let with_int = vec![PipelineDslStep::Model(PipelineDslOperatorStep {
        id: NodeId::new("model:pls").unwrap(),
        operator: serde_json::Value::String("PLS".to_string()),
        params: BTreeMap::from([("alpha".to_string(), serde_json::json!(1))]),
        metadata: BTreeMap::new(),
        seed_label: None,
        representation: None,
        train_params: BTreeMap::new(),
        tuning: None,
        variants: Vec::new(),
        param_generators: Vec::new(),
        shape: None,
        inner_cv: None,
    })];
    let with_float = vec![PipelineDslStep::Model(PipelineDslOperatorStep {
        id: NodeId::new("model:pls").unwrap(),
        operator: serde_json::Value::String("PLS".to_string()),
        params: BTreeMap::from([("alpha".to_string(), serde_json::json!(1.0))]),
        metadata: BTreeMap::new(),
        seed_label: None,
        representation: None,
        train_params: BTreeMap::new(),
        tuning: None,
        variants: Vec::new(),
        param_generators: Vec::new(),
        shape: None,
        inner_cv: None,
    })];
    assert_ne!(
        operator_variant_label(&with_int).unwrap(),
        operator_variant_label(&with_float).unwrap(),
        "1 and 1.0 must hash to distinct labels (value forms preserved)"
    );
}

/// Phase 5: `compile_operator_variant_models` populates `variant_labels` as a strict bijection with
/// the choices — one 64-hex sha256 per `active_subsequence`, each equal to `operator_variant_label`
/// of that choice's lowered steps, and the model validates.
#[test]
fn compile_operator_variant_models_populates_variant_labels() {
    let spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-operator-or",
  "steps": [
    {
      "kind": "generator",
      "id": "generator:preproc",
      "mode": "or",
      "branches": [
        {"id": "snv", "steps": [{"kind": "transform", "id": "t:snv", "operator": "SNV"}]},
        {"id": "msc", "steps": [{"kind": "transform", "id": "t:msc", "operator": "MSC"}]}
      ]
    }
  ]
}"#,
    )
    .unwrap();
    let models = compile_operator_variant_models(&spec).unwrap();
    assert_eq!(models.len(), 1);
    let model = &models[0];
    model.validate().unwrap();
    // One label per choice, keyed identically to active_nodes (strict bijection).
    assert_eq!(model.variant_labels.len(), model.dimension.choices.len());
    for choice in &model.dimension.choices {
        let key = choice.active_subsequence.as_ref().unwrap();
        let label = model
            .variant_labels
            .get(key)
            .expect("every choice has a variant_label");
        assert_eq!(label.len(), 64);
        assert!(label.bytes().all(|byte| byte.is_ascii_hexdigit()));
    }
    // The two distinct preprocessors (SNV vs MSC) hash to DISTINCT labels.
    let labels: BTreeSet<&String> = model.variant_labels.values().collect();
    assert_eq!(
        labels.len(),
        2,
        "distinct sub-sequences need distinct labels"
    );
}

// ---------------------------------------------------------------------------
// ADR-17 item 1a (+ constrained-cartesian half of 1b): CONSTRAINED operator
// generators. `compile_operator_variant_models` must yield the EXACT pruned
// multi-operator survivor set (member-exact), reusing B's shared constraint
// rule core during sequence-build (Option A). The survivor counts + member sets
// are the nirs4all generation oracle's `_CONSTRAINT_SURVIVORS` locks
// (`tests/integration/parity/test_generators_conformance_extra.py`):
//   _or_+pick2+mutex[[A,B]]/4ops -> 5; pick3+mutex[[A,B,C]] -> 3;
//   pick2+requires[[A,B]] -> 4; pick2+exclude[[A,D]] -> 5;
//   cartesian[[A|B],[C|D]]+exclude[[A,C]] -> 3; pick2+mutex+exclude -> 4;
//   prunes-to-one -> 1. Order is locked to legacy `expand_spec` survivor order.
// ---------------------------------------------------------------------------

/// Each survivor choice's operator-content member set, IN CHOICE ORDER. Reconstructed from the
/// choice's `active_nodes` — every active node id is `gen:<g>:c<i>:n<k>.t_<OP>` (the namespaced form
/// of a branch's `t:<OP>` transform), so the trailing `t_<OP>` segment recovers the operator letter.
/// This is an INDEPENDENT member oracle (derived from the minted node ids, not the labels under test),
/// so a wrong-prune with the right count still fails. The Vec preserves choice order for the
/// order-parity lock.
fn operator_survivor_members(model: &OperatorVariantModel) -> Vec<BTreeSet<String>> {
    model
        .dimension
        .choices
        .iter()
        .map(|choice| {
            let key = choice.active_subsequence.as_ref().unwrap();
            model.active_nodes[key]
                .iter()
                .map(|node_id| {
                    node_id
                        .as_str()
                        .rsplit('.')
                        .next()
                        .and_then(|suffix| suffix.strip_prefix("t_"))
                        .unwrap_or_else(|| panic!("unexpected active node id `{node_id}`"))
                        .to_string()
                })
                .collect::<BTreeSet<_>>()
        })
        .collect()
}

/// Compile the single operator generator out of a constrained `_or_`/`_cartesian_` spec and return
/// its survivors as ordered operator-content member sets.
fn constrained_operator_survivors(spec_json: &str) -> Vec<BTreeSet<String>> {
    let spec: PipelineDslSpec = serde_json::from_str(spec_json).unwrap();
    let models = compile_operator_variant_models(&spec).unwrap();
    assert_eq!(models.len(), 1, "one operator generator in the spec");
    models[0].validate().unwrap();
    // Determinism: a second compile is byte-identical.
    let again = compile_operator_variant_models(&spec).unwrap();
    assert_eq!(
        models, again,
        "constrained operator lowering is deterministic"
    );
    operator_survivor_members(&models[0])
}

fn member_set(operators: &[&str]) -> BTreeSet<String> {
    operators.iter().map(|op| op.to_string()).collect()
}

/// `_or_` over 4 operators, pick 2, `_mutex_[[A,B]]`: the single {A,B} 2-op set is removed -> 5.
/// (nirs4all `generator_or_pick_mutex`: C(4,2)=6 -> 5.)
#[test]
fn constrained_or_pick_mutex_pair_prunes_to_five() {
    let survivors = constrained_operator_survivors(
        r#"{
  "id": "dsl-or-pick-mutex",
  "steps": [
    {
      "kind": "generator",
      "id": "generator:preproc",
      "mode": "or",
      "pick": 2,
      "branches": [
        {"id": "A", "steps": [{"kind": "transform", "id": "t:A", "operator": "A"}]},
        {"id": "B", "steps": [{"kind": "transform", "id": "t:B", "operator": "B"}]},
        {"id": "C", "steps": [{"kind": "transform", "id": "t:C", "operator": "C"}]},
        {"id": "D", "steps": [{"kind": "transform", "id": "t:D", "operator": "D"}]}
      ],
      "constraints": {"mutex": [["A", "B"]]}
    }
  ]
}"#,
    );
    assert_eq!(survivors.len(), 5);
    // The {A,B} pair is the SOLE casualty; every other 2-combination survives, in C(4,2) lex order.
    assert_eq!(
        survivors,
        vec![
            member_set(&["A", "C"]),
            member_set(&["A", "D"]),
            member_set(&["B", "C"]),
            member_set(&["B", "D"]),
            member_set(&["C", "D"]),
        ],
        "member-exact survivor set + legacy expand_spec order"
    );
    assert!(!survivors.contains(&member_set(&["A", "B"])));
}

/// `_or_` over 4 operators, pick 3, SIZE-3 `_mutex_[[A,B,C]]`: legacy "not all co-occur" (issubset)
/// forbids ONLY {A,B,C} and keeps every 3-set with a proper subset -> 3 survivors. A "count>1"
/// reading would over-prune. (nirs4all `generator_or_pick_mutex3`: C(4,3)=4 -> 3.)
#[test]
fn constrained_or_pick_mutex_group_of_three_keeps_subsets() {
    let survivors = constrained_operator_survivors(
        r#"{
  "id": "dsl-or-pick-mutex3",
  "steps": [
    {
      "kind": "generator",
      "id": "generator:preproc",
      "mode": "or",
      "pick": 3,
      "branches": [
        {"id": "A", "steps": [{"kind": "transform", "id": "t:A", "operator": "A"}]},
        {"id": "B", "steps": [{"kind": "transform", "id": "t:B", "operator": "B"}]},
        {"id": "C", "steps": [{"kind": "transform", "id": "t:C", "operator": "C"}]},
        {"id": "D", "steps": [{"kind": "transform", "id": "t:D", "operator": "D"}]}
      ],
      "constraints": {"mutex": [["A", "B", "C"]]}
    }
  ]
}"#,
    );
    assert_eq!(survivors.len(), 3);
    assert_eq!(
        survivors,
        vec![
            member_set(&["A", "B", "D"]),
            member_set(&["A", "C", "D"]),
            member_set(&["B", "C", "D"]),
        ],
    );
    // The all-present {A,B,C} 3-set is the only one dropped.
    assert!(!survivors.contains(&member_set(&["A", "B", "C"])));
}

/// `_or_` over 4 operators, pick 2, `_requires_[[A,B]]`: A-without-B 2-sets ({A,C},{A,D}) drop -> 4.
/// (nirs4all `generator_or_pick_requires`: 6 -> 4.)
#[test]
fn constrained_or_pick_requires_prunes_to_four() {
    let survivors = constrained_operator_survivors(
        r#"{
  "id": "dsl-or-pick-requires",
  "steps": [
    {
      "kind": "generator",
      "id": "generator:preproc",
      "mode": "or",
      "pick": 2,
      "branches": [
        {"id": "A", "steps": [{"kind": "transform", "id": "t:A", "operator": "A"}]},
        {"id": "B", "steps": [{"kind": "transform", "id": "t:B", "operator": "B"}]},
        {"id": "C", "steps": [{"kind": "transform", "id": "t:C", "operator": "C"}]},
        {"id": "D", "steps": [{"kind": "transform", "id": "t:D", "operator": "D"}]}
      ],
      "constraints": {"requires": [["A", "B"]]}
    }
  ]
}"#,
    );
    assert_eq!(survivors.len(), 4);
    assert_eq!(
        survivors,
        vec![
            member_set(&["A", "B"]),
            member_set(&["B", "C"]),
            member_set(&["B", "D"]),
            member_set(&["C", "D"]),
        ],
    );
    // A survives only paired with B.
    for survivor in &survivors {
        if survivor.contains("A") {
            assert!(survivor.contains("B"), "A requires B");
        }
    }
}

/// `_or_` over 4 operators, pick 2, `_exclude_[[A,D]]`: the {A,D} pair is forbidden -> 5.
/// (nirs4all `generator_or_pick_exclude`: 6 -> 5.)
#[test]
fn constrained_or_pick_exclude_prunes_to_five() {
    let survivors = constrained_operator_survivors(
        r#"{
  "id": "dsl-or-pick-exclude",
  "steps": [
    {
      "kind": "generator",
      "id": "generator:preproc",
      "mode": "or",
      "pick": 2,
      "branches": [
        {"id": "A", "steps": [{"kind": "transform", "id": "t:A", "operator": "A"}]},
        {"id": "B", "steps": [{"kind": "transform", "id": "t:B", "operator": "B"}]},
        {"id": "C", "steps": [{"kind": "transform", "id": "t:C", "operator": "C"}]},
        {"id": "D", "steps": [{"kind": "transform", "id": "t:D", "operator": "D"}]}
      ],
      "constraints": {"exclude": [["A", "D"]]}
    }
  ]
}"#,
    );
    assert_eq!(survivors.len(), 5);
    assert_eq!(
        survivors,
        vec![
            member_set(&["A", "B"]),
            member_set(&["A", "C"]),
            member_set(&["B", "C"]),
            member_set(&["B", "D"]),
            member_set(&["C", "D"]),
        ],
    );
    assert!(!survivors.contains(&member_set(&["A", "D"])));
}

/// `_cartesian_[[A|B],[C|D]]` with `_exclude_[[A,C]]`: 2x2 = 4 pipelines, {A,C} pruned -> 3 (the
/// constrained-cartesian half of ADR-17 1b). (nirs4all `generator_cartesian_exclude`: 4 -> 3.)
#[test]
fn constrained_cartesian_exclude_prunes_to_three() {
    let survivors = constrained_operator_survivors(
        r#"{
  "id": "dsl-cartesian-exclude",
  "steps": [
    {
      "kind": "generator",
      "id": "generator:preproc",
      "mode": "cartesian",
      "stages": [
        {
          "id": "stage0",
          "branches": [
            {"id": "A", "steps": [{"kind": "transform", "id": "t:A", "operator": "A"}]},
            {"id": "B", "steps": [{"kind": "transform", "id": "t:B", "operator": "B"}]}
          ]
        },
        {
          "id": "stage1",
          "branches": [
            {"id": "C", "steps": [{"kind": "transform", "id": "t:C", "operator": "C"}]},
            {"id": "D", "steps": [{"kind": "transform", "id": "t:D", "operator": "D"}]}
          ]
        }
      ],
      "constraints": {"exclude": [["A", "C"]]}
    }
  ]
}"#,
    );
    assert_eq!(survivors.len(), 3);
    // 2x2 cartesian lex order with {A,C} (the first row) removed.
    assert_eq!(
        survivors,
        vec![
            member_set(&["A", "D"]),
            member_set(&["B", "C"]),
            member_set(&["B", "D"]),
        ],
    );
    assert!(!survivors.contains(&member_set(&["A", "C"])));
}

/// `_or_` over 4 operators, pick 2, COMBINED `_mutex_[[A,B]]` + `_exclude_[[C,D]]`: two kinds on one
/// generator drop {A,B} and {C,D} -> 4. (nirs4all `generator_combined_constraints`: 6 -> 4.)
#[test]
fn constrained_or_pick_combined_mutex_and_exclude_prunes_to_four() {
    let survivors = constrained_operator_survivors(
        r#"{
  "id": "dsl-or-pick-combined",
  "steps": [
    {
      "kind": "generator",
      "id": "generator:preproc",
      "mode": "or",
      "pick": 2,
      "branches": [
        {"id": "A", "steps": [{"kind": "transform", "id": "t:A", "operator": "A"}]},
        {"id": "B", "steps": [{"kind": "transform", "id": "t:B", "operator": "B"}]},
        {"id": "C", "steps": [{"kind": "transform", "id": "t:C", "operator": "C"}]},
        {"id": "D", "steps": [{"kind": "transform", "id": "t:D", "operator": "D"}]}
      ],
      "constraints": {"mutex": [["A", "B"]], "exclude": [["C", "D"]]}
    }
  ]
}"#,
    );
    assert_eq!(survivors.len(), 4);
    assert_eq!(
        survivors,
        vec![
            member_set(&["A", "C"]),
            member_set(&["A", "D"]),
            member_set(&["B", "C"]),
            member_set(&["B", "D"]),
        ],
    );
    assert!(!survivors.contains(&member_set(&["A", "B"])));
    assert!(!survivors.contains(&member_set(&["C", "D"])));
}

/// `_or_` over 3 operators, pick 2, two mutex pairs that prune C(3,2)=3 down to a single survivor.
/// (nirs4all `generator_constraint_prunes_to_one`: {B,C} only.)
#[test]
fn constrained_or_pick_prunes_to_one() {
    let survivors = constrained_operator_survivors(
        r#"{
  "id": "dsl-or-pick-one",
  "steps": [
    {
      "kind": "generator",
      "id": "generator:preproc",
      "mode": "or",
      "pick": 2,
      "branches": [
        {"id": "A", "steps": [{"kind": "transform", "id": "t:A", "operator": "A"}]},
        {"id": "B", "steps": [{"kind": "transform", "id": "t:B", "operator": "B"}]},
        {"id": "C", "steps": [{"kind": "transform", "id": "t:C", "operator": "C"}]}
      ],
      "constraints": {"mutex": [["A", "B"], ["A", "C"]]}
    }
  ]
}"#,
    );
    assert_eq!(survivors, vec![member_set(&["B", "C"])]);
}

/// MUST-FIX 1 (`_or_`): `count` must truncate the POST-prune survivor list in legacy order, NOT cap
/// the pre-prune expansion. `_or_` over A,B,C pick=2 count=1 `_mutex_[[A,B]]`: the full lex expansion
/// {A,B},{A,C},{B,C} is pruned of {A,B} -> {A,C},{B,C}, then `count=1` truncates to the FIRST survivor
/// {A,C}. (The buggy order would generate only {A,B} first, prune it, and error with zero survivors.)
#[test]
fn constrained_or_pick_count_truncates_post_prune_survivors() {
    let survivors = constrained_operator_survivors(
        r#"{
  "id": "dsl-or-pick-count",
  "steps": [
    {
      "kind": "generator",
      "id": "generator:preproc",
      "mode": "or",
      "pick": 2,
      "count": 1,
      "branches": [
        {"id": "A", "steps": [{"kind": "transform", "id": "t:A", "operator": "A"}]},
        {"id": "B", "steps": [{"kind": "transform", "id": "t:B", "operator": "B"}]},
        {"id": "C", "steps": [{"kind": "transform", "id": "t:C", "operator": "C"}]}
      ],
      "constraints": {"mutex": [["A", "B"]]}
    }
  ]
}"#,
    );
    // count=1 keeps exactly the FIRST post-prune survivor, in legacy lex order: {A,C}.
    assert_eq!(survivors, vec![member_set(&["A", "C"])]);
}

/// MUST-FIX 1 (`_cartesian_`): `count` truncates the POST-prune cartesian survivors in order.
/// `_cartesian_[[A|B],[C|D]]` count=1 `_exclude_[[A,C]]`: the full cartesian {A,C},{A,D},{B,C},{B,D}
/// is pruned of {A,C} -> {A,D},{B,C},{B,D}, then `count=1` truncates to the FIRST survivor {A,D}.
/// (The buggy order would cap the cartesian build at {A,C} first, prune it, and error.)
#[test]
fn constrained_cartesian_count_truncates_post_prune_survivors() {
    let survivors = constrained_operator_survivors(
        r#"{
  "id": "dsl-cartesian-count",
  "steps": [
    {
      "kind": "generator",
      "id": "generator:preproc",
      "mode": "cartesian",
      "count": 1,
      "stages": [
        {
          "id": "stage0",
          "branches": [
            {"id": "A", "steps": [{"kind": "transform", "id": "t:A", "operator": "A"}]},
            {"id": "B", "steps": [{"kind": "transform", "id": "t:B", "operator": "B"}]}
          ]
        },
        {
          "id": "stage1",
          "branches": [
            {"id": "C", "steps": [{"kind": "transform", "id": "t:C", "operator": "C"}]},
            {"id": "D", "steps": [{"kind": "transform", "id": "t:D", "operator": "D"}]}
          ]
        }
      ],
      "constraints": {"exclude": [["A", "C"]]}
    }
  ]
}"#,
    );
    assert_eq!(survivors, vec![member_set(&["A", "D"])]);
}

/// MUST-FIX 2 (colon-bearing branch ids): canonical branch ids ALLOW `:` (`validate_branch_id`), and
/// the operator-content member identity must use the SAME sanitized branch id on BOTH the member set
/// and the constraint-ref resolution — NOT a label re-parsed by `rsplit(':')`. Branches `pre:A`/`pre:B`/
/// `pre:C` pick=2 with `_mutex_[["pre:A","pre:B"]]`: the ref must resolve to the `pre:A`/`pre:B`
/// branches (sanitized `pre_A`/`pre_B`) and prune {pre:A,pre:B} -> 2 survivors. The transform nodes are
/// `t:preA`/... so the independent node-level oracle reconstructs `{preA, preB, preC}`; the pruned
/// survivor {preA,preB} is absent. (Under the old `rsplit(':')` member parse the ref `pre:A` would
/// resolve to `pre_A` while the member set held `A`, rejecting the ref as an unknown operator.)
#[test]
fn constrained_operator_colon_branch_id_resolves_member() {
    let spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-colon-branch",
  "steps": [
    {
      "kind": "generator",
      "id": "generator:preproc",
      "mode": "or",
      "pick": 2,
      "branches": [
        {"id": "pre:A", "steps": [{"kind": "transform", "id": "t:preA", "operator": "A"}]},
        {"id": "pre:B", "steps": [{"kind": "transform", "id": "t:preB", "operator": "B"}]},
        {"id": "pre:C", "steps": [{"kind": "transform", "id": "t:preC", "operator": "C"}]}
      ],
      "constraints": {"mutex": [["pre:A", "pre:B"]]}
    }
  ]
}"#,
    )
    .unwrap();
    // The colon-bearing refs RESOLVE (no unknown-operator error) and prune {pre:A, pre:B}.
    let models = compile_operator_variant_models(&spec).unwrap();
    let survivors = operator_survivor_members(&models[0]);
    assert_eq!(
        survivors,
        vec![member_set(&["preA", "preC"]), member_set(&["preB", "preC"])],
        "colon branch-id refs prune {{pre:A,pre:B}} member-exact, in lex order"
    );
    // And the buggy `rsplit(':')`-style ref (`A` instead of the full `pre:A` id) is now UNKNOWN,
    // proving the member identity is the full sanitized branch id, not the colon tail.
    let mut bad = spec.clone();
    if let Some(PipelineDslStep::Generator(generator)) = bad.steps.first_mut() {
        generator.constraints = Some(PipelineDslGeneratorConstraints {
            mutex: vec![vec!["A".to_string(), "B".to_string()]],
            ..PipelineDslGeneratorConstraints::default()
        });
    } else {
        panic!("expected a generator step");
    }
    let error = compile_operator_variant_models(&bad)
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("constraint references unknown operator `A`"),
        "{error}"
    );
}

/// An operator-content constraint referencing an operator NOT in the generator fails at compile time
/// (parity with the DSL constraint resolver's unknown-choice rejection).
#[test]
fn constrained_operator_unknown_ref_is_rejected() {
    let spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-or-pick-bad",
  "steps": [
    {
      "kind": "generator",
      "id": "generator:preproc",
      "mode": "or",
      "pick": 2,
      "branches": [
        {"id": "A", "steps": [{"kind": "transform", "id": "t:A", "operator": "A"}]},
        {"id": "B", "steps": [{"kind": "transform", "id": "t:B", "operator": "B"}]},
        {"id": "C", "steps": [{"kind": "transform", "id": "t:C", "operator": "C"}]}
      ],
      "constraints": {"mutex": [["A", "NOPE"]]}
    }
  ]
}"#,
    )
    .unwrap();
    let error = compile_operator_variant_models(&spec)
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("constraint references unknown operator `NOPE`"),
        "{error}"
    );
}

/// A constraint that prunes EVERY operator sequence is a loud compile error (parity with B's
/// "constraints pruned every variant").
#[test]
fn constrained_operator_all_pruned_is_an_error() {
    let spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-or-pick-empty",
  "steps": [
    {
      "kind": "generator",
      "id": "generator:preproc",
      "mode": "or",
      "pick": 2,
      "branches": [
        {"id": "A", "steps": [{"kind": "transform", "id": "t:A", "operator": "A"}]},
        {"id": "B", "steps": [{"kind": "transform", "id": "t:B", "operator": "B"}]}
      ],
      "constraints": {"mutex": [["A", "B"]]}
    }
  ]
}"#,
    )
    .unwrap();
    let error = compile_operator_variant_models(&spec)
        .unwrap_err()
        .to_string();
    assert!(error.contains("pruned every operator sequence"), "{error}");
}

/// The compat (nirs4all-JSON) lowerer accepts `_mutex_` on an `_or_`+pick node and routes through the
/// same sequence-build prune — proving item 3 (the DSL lowerer wiring) end to end. The `_or_` entries
/// are operator fragments whose `id` becomes the branch id (`compat_branch_id`); the constraint refs
/// name those same ids (sanitized to `t_A`/`t_B`), so the prune drops {t:A,t:B} -> 5 survivors.
#[test]
fn compat_lowers_or_pick_constraints() {
    let value: serde_json::Value = serde_json::from_str(
        r#"{
  "id": "compat-or-pick-mutex",
  "steps": [
    {
      "_or_": [
        {"kind": "model", "id": "t:A", "operator": "A"},
        {"kind": "model", "id": "t:B", "operator": "B"},
        {"kind": "model", "id": "t:C", "operator": "C"},
        {"kind": "model", "id": "t:D", "operator": "D"}
      ],
      "id": "generator:preproc",
      "pick": 2,
      "_mutex_": [["t:A", "t:B"]]
    }
  ]
}"#,
    )
    .unwrap();
    let spec = lower_nirs4all_compat_pipeline_dsl(&value).unwrap();
    // The lowered generator carries the operator-content constraint (routed from the `_mutex_` key).
    let generator = spec
        .steps
        .iter()
        .find_map(|step| match step {
            PipelineDslStep::Generator(generator) => Some(generator),
            _ => None,
        })
        .expect("a generator step");
    assert_eq!(
        generator.constraints.as_ref().unwrap().mutex,
        vec![vec!["t:A".to_string(), "t:B".to_string()]],
    );
    let models = compile_operator_variant_models(&spec).unwrap();
    let survivors = operator_survivor_members(&models[0]);
    assert_eq!(survivors.len(), 5);
    assert!(!survivors.contains(&member_set(&["A", "B"])));
}

/// ADR-17 item 5 slice B (the CATCH-22 fix): a MODEL-TERMINATED constrained `_or_`+pick+`_mutex_`
/// generator — the model carried in the generator `tail` — lowers natively through BOTH the graph
/// compile AND `compile_operator_variant_models`, yielding the EXACT 6 -> 5 pruned multi-operator
/// survivor set (matching the oracle `generator_or_pick_mutex`) with the model TERMINATING each
/// survivor sub-sequence EXACTLY ONCE.
///
/// This is the host's new lowering: instead of pre-expanding survivors with `expand_spec` and emitting
/// one plain `_or_` branch per survivor, the host emits ONE constrained generator (pick + constraints
/// PRESERVED) plus the downstream model in `tail`. The tail is appended AFTER the prune, so:
///   * the operator-content member set stays the 2-op survivor (the model is NOT a constraint member),
///   * every survivor's `steps` ends in the model (so the graph compile's "must produce a prediction"
///     gate AND `lower_operator_variant_model`'s "activated nodes" gate both pass), and
///   * each `variant_label` is the content fingerprint over `[<2 ops>, <model>]` (the host recomputes
///     it byte-identically).
#[test]
fn model_terminated_constrained_or_pick_mutex_lowers_native_with_model_tail() {
    const SPEC: &str = r#"{
  "id": "dsl-or-pick-mutex-model",
  "input": {"name": "X", "representation": "matrix"},
  "output": {"name": "y_pred", "description": "prediction"},
  "steps": [
    {
      "kind": "generator",
      "id": "generator:preproc",
      "mode": "or",
      "pick": 2,
      "branches": [
        {"id": "A", "steps": [{"kind": "transform", "id": "t:A", "operator": "A"}]},
        {"id": "B", "steps": [{"kind": "transform", "id": "t:B", "operator": "B"}]},
        {"id": "C", "steps": [{"kind": "transform", "id": "t:C", "operator": "C"}]},
        {"id": "D", "steps": [{"kind": "transform", "id": "t:D", "operator": "D"}]}
      ],
      "constraints": {"mutex": [["A", "B"]]},
      "tail": [{"kind": "model", "id": "m:base", "operator": "PLS"}]
    }
  ]
}"#;
    let spec: PipelineDslSpec = serde_json::from_str(SPEC).unwrap();

    // (1) The operator-variant compile prunes the {A,B} pair -> 5 survivors, in legacy C(4,2) order —
    // member-exact, derived from each choice's active TRANSFORM nodes (the model node is filtered out).
    let models = compile_operator_variant_models(&spec).unwrap();
    assert_eq!(models.len(), 1, "one operator generator in the spec");
    models[0].validate().unwrap();
    let survivors: Vec<BTreeSet<String>> = models[0]
        .dimension
        .choices
        .iter()
        .map(|choice| {
            let key = choice.active_subsequence.as_ref().unwrap();
            models[0].active_nodes[key]
                .iter()
                .filter_map(|node_id| {
                    node_id
                        .as_str()
                        .rsplit('.')
                        .next()
                        .and_then(|suffix| suffix.strip_prefix("t_"))
                        .map(str::to_string)
                })
                .collect::<BTreeSet<_>>()
        })
        .collect();
    assert_eq!(
        survivors,
        vec![
            member_set(&["A", "C"]),
            member_set(&["A", "D"]),
            member_set(&["B", "C"]),
            member_set(&["B", "D"]),
            member_set(&["C", "D"]),
        ],
        "member-exact mutex-pruned survivor set + legacy expand_spec order (model tail excluded)"
    );
    assert!(!survivors.contains(&member_set(&["A", "B"])));

    // The model TERMINATES each survivor: every choice activates exactly one model node (the namespaced
    // `m:base`), so the multi-operator survivor ends in the model EXACTLY ONCE (not once per picked
    // branch).
    for choice in &models[0].dimension.choices {
        let key = choice.active_subsequence.as_ref().unwrap();
        let model_nodes = models[0].active_nodes[key]
            .iter()
            .filter(|node_id| node_id.as_str().ends_with(".m_base"))
            .count();
        assert_eq!(
            model_nodes, 1,
            "exactly one model node terminates the survivor"
        );
    }
    // Every survivor's `variant_label` is the content fingerprint over `[<2 ops>, <model>]`; the 5 are
    // distinct (different operator pairs, same model tail) and present for every choice.
    let labels: BTreeSet<&String> = models[0].variant_labels.values().collect();
    assert_eq!(
        labels.len(),
        5,
        "five distinct multi-op+model variant labels"
    );

    // (2) The graph compile accepts the SAME spec (the gate the pre-`tail` model-free choice failed):
    // each pruned survivor produces a model prediction, so the union graph has exactly 5 model nodes.
    let graph = compile_pipeline_dsl(&spec).unwrap();
    let model_node_count = graph
        .nodes
        .iter()
        .filter(|node| node.kind == NodeKind::Model)
        .count();
    assert_eq!(
        model_node_count, 5,
        "one model node per pruned survivor (the tail terminates each of the 5 survivors)"
    );
}

/// ADR-17 item 5 slice B MUST-FIX 3: a multi-`_requires_` `[A, B, C]` is "A requires B AND A requires C".
/// The host SPLITS it into the two `[A, B]` / `[A, C]` PAIRS dag-ml's `[String; 2]` `requires` form expects;
/// this verifies the split pairs prune identically to the legacy multi-requires meaning. `_or_` over 4 ops,
/// pick 3 (`C(4,3)=4`): the trigger A present demands BOTH B and C present. Of the 4 3-combos, only
/// `{A,B,C}` keeps A with both B and C; `{A,B,D}` (A without C), `{A,C,D}` (A without B) drop; `{B,C,D}` has
/// no A so it is unconstrained and survives — 4 -> 2.
#[test]
fn constrained_or_pick_multi_requires_split_pairs_prune_like_legacy() {
    let survivors = constrained_operator_survivors(
        r#"{
  "id": "dsl-or-pick-multi-requires",
  "steps": [
    {
      "kind": "generator",
      "id": "generator:preproc",
      "mode": "or",
      "pick": 3,
      "branches": [
        {"id": "A", "steps": [{"kind": "transform", "id": "t:A", "operator": "A"}]},
        {"id": "B", "steps": [{"kind": "transform", "id": "t:B", "operator": "B"}]},
        {"id": "C", "steps": [{"kind": "transform", "id": "t:C", "operator": "C"}]},
        {"id": "D", "steps": [{"kind": "transform", "id": "t:D", "operator": "D"}]}
      ],
      "constraints": {"requires": [["A", "B"], ["A", "C"]]}
    }
  ]
}"#,
    );
    assert_eq!(survivors.len(), 2);
    assert_eq!(
        survivors,
        vec![member_set(&["A", "B", "C"]), member_set(&["B", "C", "D"])],
        "A-requires-both-B-and-C survivors (the split pairs) + legacy order"
    );
}

/// ADR-17 item 5 slice B MUST-FIX 4: a data-only generator FOLLOWED BY a tail-bearing generator must NOT be
/// fused — `generator_to_cartesian_stages` would DROP the following generator's model tail. The compat
/// lowerer must keep them as SEPARATE steps with the tail intact. Here a leading `_or_` over two transforms
/// (data-only) precedes a canonical tail-bearing `_or_` generator (its model lives in `tail`); the lowered
/// spec must carry TWO generator steps and the second must still own its model tail.
#[test]
fn compat_does_not_fuse_following_tail_bearing_generator() {
    let value: serde_json::Value = serde_json::from_str(
        r#"{
  "id": "compat-no-fuse-tail",
  "pipeline": [
    {"_or_": ["Lead0", "Lead1"]},
    {
      "kind": "generator",
      "id": "generator:tail",
      "mode": "or",
      "pick": 2,
      "branches": [
        {"id": "A", "steps": [{"kind": "transform", "id": "t:A", "operator": "A"}]},
        {"id": "B", "steps": [{"kind": "transform", "id": "t:B", "operator": "B"}]},
        {"id": "C", "steps": [{"kind": "transform", "id": "t:C", "operator": "C"}]}
      ],
      "tail": [{"kind": "model", "id": "m:base", "operator": "PLS"}]
    }
  ]
}"#,
    )
    .unwrap();
    let spec = lower_nirs4all_compat_pipeline_dsl(&value).unwrap();
    let generators: Vec<&PipelineDslGeneratorStep> = spec
        .steps
        .iter()
        .filter_map(|step| match step {
            PipelineDslStep::Generator(generator) => Some(generator),
            _ => None,
        })
        .collect();
    assert_eq!(
        generators.len(),
        2,
        "the data-only `_or_` and the tail-bearing generator stay SEPARATE (no fusion)"
    );
    // The tail-bearing generator kept its model tail (it was NOT cartesian-fused, which would drop it).
    let tail_gen = generators
        .iter()
        .find(|generator| generator.id.as_str() == "generator:tail")
        .expect("the tail-bearing generator survives lowering");
    assert_eq!(tail_gen.tail.len(), 1, "the model tail is preserved");
    assert!(
        matches!(tail_gen.tail[0], PipelineDslStep::Model(_)),
        "the preserved tail step is the model"
    );
}

/// MUST-FIX 2: `OperatorVariantModel::validate` rejects two choices sharing the same
/// `active_subsequence` (no bijection), even when the active_nodes map length is padded.
#[test]
fn operator_variant_model_validate_rejects_duplicate_active_subsequence() {
    fn operator_choice(label: &str, active_subsequence: &str) -> GenerationChoice {
        GenerationChoice {
            label: label.to_string(),
            value: serde_json::Value::String(active_subsequence.to_string()),
            param_overrides: Vec::new(),
            active_subsequence: Some(active_subsequence.to_string()),
        }
    }
    let node = |id: &str| BTreeSet::from([NodeId::new(id).unwrap()]);
    let model = OperatorVariantModel {
        generator_id: NodeId::new("generator:dup").unwrap(),
        dimension: GenerationDimension {
            name: "generator:dup.operators".to_string(),
            // Two DISTINCT labels but the SAME active_subsequence (`shared`).
            choices: vec![
                operator_choice("generator:dup:choice0", "shared"),
                operator_choice("generator:dup:choice1", "shared"),
            ],
        },
        // Length 2 (padded with a stray key) so the old length check would have passed.
        active_nodes: BTreeMap::from([
            ("shared".to_string(), node("gen:dup:c0:n0.a")),
            ("padding".to_string(), node("gen:dup:c1:n0.b")),
        ]),
        variant_labels: BTreeMap::new(),
    };
    let error = model.validate().unwrap_err().to_string();
    assert!(error.contains("duplicate active_subsequence"), "{error}");
}

/// MUST-FIX 2: `OperatorVariantModel::validate` rejects a stray `active_nodes` key that does not
/// correspond to any choice's `active_subsequence`.
#[test]
fn operator_variant_model_validate_rejects_stray_active_nodes_key() {
    let node = |id: &str| BTreeSet::from([NodeId::new(id).unwrap()]);
    let model = OperatorVariantModel {
        generator_id: NodeId::new("generator:stray").unwrap(),
        dimension: GenerationDimension {
            name: "generator:stray.operators".to_string(),
            choices: vec![GenerationChoice {
                label: "generator:stray:choice0".to_string(),
                value: serde_json::Value::String("generator:stray:choice0".to_string()),
                param_overrides: Vec::new(),
                active_subsequence: Some("generator:stray:choice0".to_string()),
            }],
        },
        active_nodes: BTreeMap::from([
            (
                "generator:stray:choice0".to_string(),
                node("gen:stray:c0:n0.a"),
            ),
            // A stray key with no matching choice.
            ("orphan".to_string(), node("gen:stray:c1:n0.b")),
        ]),
        variant_labels: BTreeMap::new(),
    };
    let error = model.validate().unwrap_err().to_string();
    assert!(error.contains("stray active-node set"), "{error}");
}

#[test]
fn compiles_cartesian_generator_as_explicit_prediction_choices() {
    let spec: PipelineDslSpec = serde_json::from_str(
            r#"{
  "id": "dsl-generator-cartesian-parity",
  "steps": [
    {
      "kind": "generator",
      "id": "generator:cartesian",
      "mode": "cartesian",
      "stages": [
        {
          "id": "preproc",
          "branches": [
            {
              "id": "snv",
              "steps": [
                {
                  "kind": "transform",
                  "id": "transform:snv",
                  "operator": {"class": "nirs4all.operators.transforms.StandardNormalVariate"}
                }
              ]
            },
            {
              "id": "msc",
              "steps": [
                {
                  "kind": "transform",
                  "id": "transform:msc",
                  "operator": {"class": "nirs4all.operators.transforms.MultiplicativeScatterCorrection"}
                }
              ]
            }
          ]
        },
        {
          "id": "model",
          "branches": [
            {
              "id": "ridge",
              "steps": [
                {
                  "kind": "model",
                  "id": "model:ridge",
                  "operator": {"class": "sklearn.linear_model.Ridge"}
                }
              ]
            },
            {
              "id": "lasso",
              "steps": [
                {
                  "kind": "model",
                  "id": "model:lasso",
                  "operator": {"class": "sklearn.linear_model.Lasso"}
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "kind": "merge",
      "id": "merge:cartesian",
      "output_as": "features",
      "include_original_data": false
    }
  ]
}"#,
        )
        .unwrap();

    let graph = compile_pipeline_dsl(&spec).unwrap();
    graph.validate().unwrap();
    let models = graph
        .nodes
        .iter()
        .filter(|node| node.kind == NodeKind::Model)
        .collect::<Vec<_>>();
    assert_eq!(models.len(), 4);
    assert!(models.iter().all(|node| {
        node.metadata
            .get("dsl_generator_mode")
            .and_then(|value| value.as_str())
            == Some("cartesian")
    }));
    let merge = graph
        .nodes
        .iter()
        .find(|node| node.id.as_str() == "merge:cartesian")
        .unwrap();
    assert_eq!(merge.ports.inputs.len(), 4);
    assert_eq!(
        graph
            .edges
            .iter()
            .filter(|edge| edge.target.node_id.as_str() == "merge:cartesian")
            .count(),
        4
    );
}

#[test]
fn refuses_generator_choice_without_prediction_output() {
    let spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-generator-bad-choice",
  "steps": [
    {
      "kind": "generator",
      "id": "generator:bad",
      "branches": [
        {
          "id": "transform_only",
          "steps": [
            {
              "kind": "transform",
              "id": "transform:only",
              "operator": {"class": "sklearn.preprocessing.StandardScaler"}
            }
          ]
        }
      ]
    }
  ]
}"#,
    )
    .unwrap();

    let error = compile_pipeline_dsl(&spec).unwrap_err();
    assert!(format!("{error}").contains("must produce at least one model or merge prediction"));
}

#[test]
fn parses_nirs4all_compat_pipeline_and_fuses_data_generators() {
    let spec = parse_pipeline_dsl_json(
            br#"{
  "id": "dsl-nirs4all-compat-fused",
  "pipeline": [
    {"sources": ["nir"]},
    {"_cartesian_": [
      {"_or_": ["SNV", "MSC", null]},
      {"_or_": [null, {"preprocessing": "SavitzkyGolay", "params": {"window": 11, "deriv": 1}}]}
    ]},
    {"split": {"type": "GroupKFold", "n_splits": 3}},
    {"_chain_": [
      {"_grid_": {"model": ["PLSRegression"], "n_components": [5, 10]}},
      {"_grid_": {"model": ["Ridge"], "alpha": [0.1, 1.0]}},
      {"_sample_": {"model": "SVR", "distribution": "log_uniform", "from": 0.001, "to": 1.0, "num": 2, "tune": ["C", "gamma"], "kernel": "rbf"}}
    ]},
    {"merge": "all"},
    {"model": "Ridge", "id": "model:meta", "params": {"alpha": 0.5}}
  ]
}"#,
        )
        .unwrap();

    assert_eq!(spec.steps.len(), 2);
    assert_eq!(
        spec.split_invocation
            .as_ref()
            .unwrap()
            .params
            .get("type")
            .unwrap(),
        "GroupKFold"
    );

    let graph = compile_pipeline_dsl(&spec).unwrap();
    graph.validate().unwrap();
    let meta = graph
        .nodes
        .iter()
        .find(|node| node.id.as_str() == "model:meta")
        .unwrap();
    assert_eq!(meta.kind, NodeKind::Model);
    assert!(meta
        .ports
        .inputs
        .iter()
        .any(|port| port.name == "x_original"));
    assert!(graph.edges.iter().any(|edge| {
        edge.target.node_id.as_str() == "model:meta"
            && edge.contract.kind == PortKind::Prediction
            && edge.contract.requires_oof
    }));
    assert!(graph.nodes.iter().any(|node| {
        node.metadata
            .get("dsl_compat_keyword")
            .and_then(serde_json::Value::as_str)
            == Some("preprocessing")
    }));
    assert!(graph.nodes.iter().any(|node| {
        node.kind == NodeKind::Model
            && node.params.contains_key("C")
            && node.params.contains_key("gamma")
    }));
}

#[test]
fn parses_nirs4all_range_attached_to_following_model() {
    let spec = parse_pipeline_dsl_json(
        br#"{
  "id": "dsl-nirs4all-compat-range",
  "pipeline": [
    {"_range_": [5, 15, 5]},
    {"model": "PLSRegression", "id": "model:pls"}
  ]
}"#,
    )
    .unwrap();

    let compiled = compile_pipeline_dsl_with_generation(&spec).unwrap();
    assert_eq!(compiled.generation.dimensions.len(), 1);
    assert_eq!(compiled.generation.dimensions[0].choices.len(), 3);
    assert_eq!(
        compiled.generation.dimensions[0].choices[0].param_overrides[0].params["n_components"],
        5.0
    );
}

#[test]
fn parses_nirs4all_minimal_aliases_plain_classes_and_split_chain() {
    let spec = parse_pipeline_dsl_json(
            br#"{
  "id": "dsl-nirs4all-compat-minimal-aliases",
  "pipeline": [
    "chart_2d",
    {"class": "sklearn.preprocessing.MinMaxScaler", "params": {"feature_range": [0, 1]}},
    {"class": "nirs4all.operators.splitters.SPXYGFold", "params": {"n_splits": 1, "test_size": 0.2}, "group": "Sample_ID"},
    {"class": "sklearn.model_selection.KFold", "params": {"n_splits": 3, "shuffle": true, "random_state": 42}},
    "SNV",
    "PLSRegression"
  ]
}"#,
        )
        .unwrap();

    let split = spec.split_invocation.as_ref().unwrap();
    assert_eq!(split.id, "split:compat.chain");
    let chain = split.params["compat_split_chain"].as_array().unwrap();
    assert_eq!(chain.len(), 2);
    assert_eq!(
        chain[0]["params"]["class"],
        "nirs4all.operators.splitters.SPXYGFold"
    );
    assert_eq!(chain[0]["params"]["group"], "Sample_ID");
    assert_eq!(chain[1]["params"]["class"], "sklearn.model_selection.KFold");

    let graph = compile_pipeline_dsl(&spec).unwrap();
    graph.validate().unwrap();
    assert!(graph.nodes.iter().any(|node| node.kind == NodeKind::Chart));
    assert!(graph.nodes.iter().any(|node| {
        node.kind == NodeKind::Transform
            && node.operator.as_ref().unwrap()["class"] == "sklearn.preprocessing.MinMaxScaler"
    }));
    assert!(graph.nodes.iter().any(|node| {
        node.kind == NodeKind::Transform && node.operator.as_ref().unwrap().as_str() == Some("SNV")
    }));
    assert!(graph.nodes.iter().any(|node| {
        node.kind == NodeKind::Model
            && node.operator.as_ref().unwrap().as_str() == Some("PLSRegression")
    }));
}

#[test]
fn registry_reclassifies_non_heuristic_minimal_aliases_before_compile() {
    let spec = parse_pipeline_dsl_json(
        br#"{
  "id": "dsl-registry-minimal-aliases",
  "pipeline": [
    "SNV",
    "ElasticSpectra"
  ]
}"#,
    )
    .unwrap();
    let mut registry = ControllerRegistry::new();
    registry
        .register(registry_manifest(
            "controller:transformer.mixin",
            NodeKind::Transform,
            &["SNV"],
        ))
        .unwrap();
    registry
        .register(registry_manifest(
            "controller:elastic.spectra",
            NodeKind::Model,
            &["ElasticSpectra"],
        ))
        .unwrap();

    let compiled =
        compile_pipeline_dsl_with_generation_and_controller_registry(&spec, &registry).unwrap();
    let model = compiled
        .graph
        .nodes
        .iter()
        .find(|node| {
            node.operator.as_ref().and_then(serde_json::Value::as_str) == Some("ElasticSpectra")
        })
        .unwrap();

    assert_eq!(model.kind, NodeKind::Model);
    assert_eq!(model.metadata[DSL_REGISTRY_INFERRED_KIND], "model");
    assert_eq!(model.metadata[DSL_COMPAT_ORIGINAL_KEYWORD], "preprocessing");
    assert!(compiled.graph.nodes.iter().any(|node| {
        node.kind == NodeKind::Transform
            && node.operator.as_ref().and_then(serde_json::Value::as_str) == Some("SNV")
    }));
}

#[test]
fn parses_nirs4all_named_step_wrapper_and_plain_class_model() {
    let spec = parse_pipeline_dsl_json(
            br#"{
  "id": "dsl-nirs4all-compat-named-step",
  "pipeline": [
    {"name": "scaled", "step": {"class": "sklearn.preprocessing.StandardScaler"}},
    {"class": "sklearn.ensemble.RandomForestRegressor", "params": {"n_estimators": 10, "random_state": 42}}
  ]
}"#,
        )
        .unwrap();

    let graph = compile_pipeline_dsl(&spec).unwrap();
    graph.validate().unwrap();
    let scaled = graph
        .nodes
        .iter()
        .find(|node| node.kind == NodeKind::Transform)
        .unwrap();
    assert_eq!(scaled.metadata["dsl_name"], "scaled");
    let model = graph
        .nodes
        .iter()
        .find(|node| node.kind == NodeKind::Model)
        .unwrap();
    assert_eq!(
        model.operator.as_ref().unwrap()["class"],
        "sklearn.ensemble.RandomForestRegressor"
    );
    assert_eq!(model.params["n_estimators"], 10);
}

#[test]
fn compiles_tuner_as_external_prediction_node() {
    let spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-tuner",
  "steps": [
    {
      "kind": "tuner",
      "id": "tuner:optuna",
      "operator": "OptunaTuner",
      "params": {"sampler": "tpe"},
      "tuning": {"n_trials": 4, "metric": "rmse"}
    },
    {
      "kind": "merge_model",
      "id": "model:meta",
      "operator": "Ridge"
    }
  ]
}"#,
    )
    .unwrap();

    let graph = compile_pipeline_dsl(&spec).unwrap();
    graph.validate().unwrap();
    let tuner = graph
        .nodes
        .iter()
        .find(|node| node.id.as_str() == "tuner:optuna")
        .unwrap();
    assert_eq!(tuner.kind, NodeKind::Tuner);
    assert_eq!(
        tuner.operator.as_ref().unwrap().as_str(),
        Some("OptunaTuner")
    );
    assert_eq!(tuner.metadata["dsl_tuning"]["n_trials"], 4);
    assert!(graph.edges.iter().any(|edge| {
        edge.source.node_id.as_str() == "tuner:optuna"
            && edge.source.port_name == "oof"
            && edge.target.node_id.as_str() == "model:meta"
            && edge.contract.kind == PortKind::Prediction
            && edge.contract.requires_oof
            && edge.contract.requires_fold_alignment
    }));
}

#[test]
fn parses_compat_tuner_minimal_alias_and_wrappers() {
    let spec = parse_pipeline_dsl_json(
        br#"{
  "id": "dsl-compat-tuner",
  "pipeline": [
    "SNV",
    {"tuner": "OptunaTuner", "id": "tuner:compat", "n_trials": 3, "metric": "rmse"},
    {"merge": "all"},
    {"model": "Ridge"}
  ]
}"#,
    )
    .unwrap();

    let graph = compile_pipeline_dsl(&spec).unwrap();
    graph.validate().unwrap();
    let transform = graph
        .nodes
        .iter()
        .find(|node| node.kind == NodeKind::Transform)
        .unwrap();
    assert_eq!(transform.operator.as_ref().unwrap().as_str(), Some("SNV"));
    let tuner = graph
        .nodes
        .iter()
        .find(|node| node.id.as_str() == "tuner:compat")
        .unwrap();
    assert_eq!(tuner.kind, NodeKind::Tuner);
    assert_eq!(tuner.params["n_trials"], 3);
    assert_eq!(tuner.metadata["dsl_compat_keyword"], "tuner");
}

#[test]
fn parses_bare_tuner_alias_as_tuner_node() {
    let spec = parse_pipeline_dsl_json(
        br#"{
  "id": "dsl-bare-tuner-alias",
  "pipeline": ["SNV", "OptunaTuner"]
}"#,
    )
    .unwrap();

    let graph = compile_pipeline_dsl(&spec).unwrap();
    graph.validate().unwrap();
    assert!(graph.nodes.iter().any(|node| {
        node.kind == NodeKind::Transform && node.operator.as_ref().unwrap().as_str() == Some("SNV")
    }));
    assert!(graph.nodes.iter().any(|node| {
        node.kind == NodeKind::Tuner
            && node.operator.as_ref().unwrap().as_str() == Some("OptunaTuner")
    }));
}

#[test]
fn compiles_runtime_data_generation_as_external_generator_node() {
    let spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-runtime-data-generation",
  "steps": [
    {
      "kind": "generation",
      "id": "generator:synthetic.train",
      "operator": "SMOTE",
      "params": {"ratio": 0.5},
      "shape": {
        "fit_rows": "fold_train",
        "predict_rows": "fold_validation",
        "augmentation_policy": {
          "sample_scope": "train_only",
          "feature_scope": "none",
          "require_origin_id": true,
          "inherit_group": true,
          "inherit_target": true
        }
      }
    },
    {
      "kind": "model",
      "id": "model:ridge",
      "operator": "Ridge"
    }
  ]
}"#,
    )
    .unwrap();

    let compiled = compile_pipeline_dsl_with_generation(&spec).unwrap();
    compiled.graph.validate().unwrap();
    let generator = compiled
        .graph
        .nodes
        .iter()
        .find(|node| node.id.as_str() == "generator:synthetic.train")
        .unwrap();
    assert_eq!(generator.kind, NodeKind::Generator);
    assert_eq!(generator.operator.as_ref().unwrap().as_str(), Some("SMOTE"));
    assert_eq!(generator.metadata["dsl_generation_kind"], "data");
    assert!(compiled
        .shape_plans
        .contains_key(&NodeId::new("generator:synthetic.train").unwrap()));
    assert!(compiled.graph.edges.iter().any(|edge| {
        edge.source.node_id.as_str() == "generator:synthetic.train"
            && edge.source.port_name == "x_out"
            && edge.target.node_id.as_str() == "model:ridge"
            && edge.target.port_name == "x"
            && edge.contract.kind == PortKind::Data
    }));
}

#[test]
fn parses_compat_runtime_generation_step() {
    let spec = parse_pipeline_dsl_json(
        br#"{
  "id": "dsl-compat-runtime-generation",
  "pipeline": [
    {
      "generation": "SMOTE",
      "id": "generator:compat.synthetic",
      "generation_params": {"ratio": 0.25},
      "shape": {
        "fit_rows": "fold_train",
        "predict_rows": "fold_validation",
        "augmentation_policy": {
          "sample_scope": "train_only",
          "feature_scope": "none",
          "require_origin_id": true,
          "inherit_group": true,
          "inherit_target": true
        }
      }
    },
    "Ridge"
  ]
}"#,
    )
    .unwrap();

    let compiled = compile_pipeline_dsl_with_generation(&spec).unwrap();
    let generator = compiled
        .graph
        .nodes
        .iter()
        .find(|node| node.id.as_str() == "generator:compat.synthetic")
        .unwrap();
    assert_eq!(generator.kind, NodeKind::Generator);
    assert_eq!(generator.params["ratio"], 0.25);
    assert_eq!(generator.metadata["dsl_compat_keyword"], "data_generation");
}

#[test]
fn parses_nirs4all_compat_feature_branch_merge_dict() {
    let spec = parse_pipeline_dsl_json(
        br#"{
  "id": "dsl-nirs4all-compat-feature-merge",
  "pipeline": [
    {
      "branch": {
        "snv": ["SNV"],
        "msc": ["MSC"]
      }
    },
    {
      "merge": {
        "features": "all",
        "output_as": "features",
        "on_missing": "error"
      }
    },
    "PLSRegression"
  ]
}"#,
    )
    .unwrap();

    let graph = compile_pipeline_dsl(&spec).unwrap();
    graph.validate().unwrap();
    let merge = graph
        .nodes
        .iter()
        .find(|node| node.kind == NodeKind::FeatureJoin)
        .unwrap();
    assert_eq!(merge.metadata["merge_mode"], "features");
    assert_eq!(merge.metadata["on_missing"], "error");
    assert!(merge.metadata.contains_key("dsl_compat_merge"));
    assert!(merge.ports.inputs.iter().any(|port| port.name == "snv_x"));
    assert!(merge.ports.inputs.iter().any(|port| port.name == "msc_x"));
    assert!(graph.nodes.iter().any(|node| node.kind == NodeKind::Model
        && node.operator.as_ref().unwrap().as_str() == Some("PLSRegression")));
}

#[cfg(dag_ml_workspace_contract_fixtures)]
#[test]
fn published_pipeline_dsl_schema_declares_current_contract() {
    let schema: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../docs/contracts/pipeline_dsl.schema.json"
    ))
    .unwrap();

    assert_eq!(schema["$id"], PIPELINE_DSL_SCHEMA_ID);
    assert!(schema["oneOf"].is_array());
    assert!(schema["$defs"]["canonical_step_kind"]["enum"]
        .as_array()
        .unwrap()
        .iter()
        .any(|value| value.as_str() == Some("generator")));
    assert!(schema["$defs"]["canonical_step_kind"]["enum"]
        .as_array()
        .unwrap()
        .iter()
        .any(|value| value.as_str() == Some("data_generation")));
    assert!(schema["$defs"]["canonical_step_kind"]["enum"]
        .as_array()
        .unwrap()
        .iter()
        .any(|value| value.as_str() == Some("tuner")));
    assert!(schema["$defs"]["compat_generator_key"]["enum"]
        .as_array()
        .unwrap()
        .iter()
        .any(|value| value.as_str() == Some("_cartesian_")));
    assert!(schema["$defs"]["compat_step_object"]["properties"]
        .as_object()
        .unwrap()
        .contains_key("class"));
    assert!(schema["$defs"]["compat_step_object"]["properties"]
        .as_object()
        .unwrap()
        .contains_key("step"));
    assert!(schema["$defs"]["pipeline_unit_contract"]["properties"]
        .as_object()
        .unwrap()
        .contains_key("unit_level"));
    assert!(schema["$defs"]["entity_unit_level"]["enum"]
        .as_array()
        .unwrap()
        .iter()
        .any(|value| value.as_str() == Some("observation")));
}

#[test]
fn refuses_unsafe_shape_plan_from_dsl() {
    let spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-unsafe-shape-plan",
  "steps": [
    {
      "kind": "augmentation",
      "id": "augment:bad",
      "operator": {"type": "LeakyAugmenter"},
      "shape": {
        "augmentation_policy": {
          "sample_scope": "all_partitions"
        }
      }
    }
  ]
}"#,
    )
    .unwrap();

    let error = compile_pipeline_dsl_with_generation(&spec).unwrap_err();
    assert!(format!("{error}").contains("sample augmentation over all partitions"));
}

#[test]
fn refuses_augmentation_without_shape_plan() {
    let spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-augmentation-without-shape",
  "steps": [
    {
      "kind": "augmentation",
      "id": "augment:missing-shape",
      "operator": {"type": "GaussianNoise"}
    }
  ]
}"#,
    )
    .unwrap();

    let error = compile_pipeline_dsl_with_generation(&spec).unwrap_err();
    assert!(format!("{error}").contains("requires a shape plan"));
}

#[test]
fn refuses_data_generation_without_shape_plan() {
    let spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-generation-without-shape",
  "steps": [
    {
      "kind": "data_generation",
      "id": "generator:missing-shape",
      "operator": {"type": "SMOTE"}
    }
  ]
}"#,
    )
    .unwrap();

    let error = compile_pipeline_dsl_with_generation(&spec).unwrap_err();
    assert!(format!("{error}").contains("requires a shape plan"));
}

#[test]
fn refuses_branch_without_prediction_or_data_output() {
    let spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-bad-branch",
  "steps": [
    {
      "kind": "branch",
      "branches": [
        {
          "id": "b0",
          "steps": [
            {
              "kind": "y_transform",
              "id": "target:only",
              "operator": {"type": "StandardScaler"}
            }
          ]
        }
      ]
    }
  ]
}"#,
    )
    .unwrap();

    let error = compile_pipeline_dsl(&spec).unwrap_err();
    assert!(format!("{error}")
        .contains("must produce at least one model, merge prediction or transformed data"));
}

#[test]
fn dsl_top_level_inner_cv_maps_to_campaign_template() {
    let spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-inner-cv-campaign",
  "inner_cv": {"kind": "kfold", "n_splits": 4, "shuffle": true, "seed": 7},
  "steps": [
    {"kind": "model", "id": "model:base", "operator": {"type": "Ridge"}, "params": {"alpha": 0.5}}
  ]
}"#,
    )
    .unwrap();

    let compiled = compile_pipeline_dsl_with_generation(&spec).unwrap();
    match compiled.campaign_template.inner_cv {
        Some(crate::fold::NestedCvSpec::KFold(ref k)) => {
            assert_eq!(k.n_splits, 4);
            assert!(k.shuffle);
            assert_eq!(k.seed, Some(7));
        }
        ref other => panic!("expected campaign-level KFold inner_cv, got {other:?}"),
    }
}

#[test]
fn dsl_model_step_inner_cv_maps_to_node_metadata() {
    let spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-inner-cv-node",
  "steps": [
    {
      "kind": "model",
      "id": "model:meta",
      "operator": {"type": "Ridge"},
      "inner_cv": {"kind": "group_kfold", "n_splits": 3}
    }
  ]
}"#,
    )
    .unwrap();

    let graph = compile_pipeline_dsl(&spec).unwrap();
    let node = graph
        .nodes
        .iter()
        .find(|node| node.id.as_str() == "model:meta")
        .expect("compiled model node exists");
    let value = node
        .metadata
        .get("dsl_inner_cv")
        .expect("node carries dsl_inner_cv metadata");
    let inner: crate::fold::NestedCvSpec = serde_json::from_value(value.clone()).unwrap();
    match inner {
        crate::fold::NestedCvSpec::GroupKFold(ref g) => assert_eq!(g.n_splits, 3),
        other => panic!("expected node-local GroupKFold inner_cv, got {other:?}"),
    }
}

#[test]
fn dsl_absent_inner_cv_leaves_campaign_and_nodes_unset() {
    let spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-no-inner-cv",
  "steps": [
    {"kind": "model", "id": "model:base", "operator": {"type": "Ridge"}}
  ]
}"#,
    )
    .unwrap();

    let compiled = compile_pipeline_dsl_with_generation(&spec).unwrap();
    assert!(compiled.campaign_template.inner_cv.is_none());
    for node in &compiled.graph.nodes {
        assert!(!node.metadata.contains_key("dsl_inner_cv"));
    }
}

#[test]
fn compat_pipeline_preserves_campaign_and_model_inner_cv() {
    // nirs4all-compatible dict form ("pipeline" key) routes through the compat
    // lowerer; campaign-global and node-local inner_cv must survive lowering.
    let spec = parse_pipeline_dsl_json(
        br#"{
  "id": "dsl-compat-inner-cv",
  "inner_cv": {"kind": "kfold", "n_splits": 5, "shuffle": false, "seed": 3},
  "pipeline": [
    {"split": {"type": "KFold", "n_splits": 4}},
    {"model": "Ridge", "id": "model:base", "inner_cv": {"kind": "group_kfold", "n_splits": 3}}
  ]
}"#,
    )
    .unwrap();

    match spec.inner_cv {
        Some(crate::fold::NestedCvSpec::KFold(ref k)) => assert_eq!(k.n_splits, 5),
        ref other => panic!("expected compat campaign-global KFold inner_cv, got {other:?}"),
    }

    let graph = compile_pipeline_dsl(&spec).unwrap();
    let node = graph
        .nodes
        .iter()
        .find(|node| node.id.as_str() == "model:base")
        .expect("compat model node exists");
    let inner: crate::fold::NestedCvSpec =
        serde_json::from_value(node.metadata.get("dsl_inner_cv").cloned().unwrap()).unwrap();
    match inner {
        crate::fold::NestedCvSpec::GroupKFold(ref g) => assert_eq!(g.n_splits, 3),
        other => panic!("expected compat node-local GroupKFold inner_cv, got {other:?}"),
    }
}

#[test]
fn compat_merge_model_collapse_preserves_inner_cv() {
    // The compat `merge` + `model` stacker shorthand collapses into a
    // merge-model step; its node-local inner_cv must reach the graph node.
    let spec = parse_pipeline_dsl_json(
            br#"{
  "id": "dsl-compat-merge-inner-cv",
  "pipeline": [
    {"_chain_": [
      {"_grid_": {"model": ["PLSRegression"], "n_components": [5, 10]}},
      {"_grid_": {"model": ["Ridge"], "alpha": [0.1, 1.0]}}
    ]},
    {"merge": "predictions"},
    {"model": "Ridge", "id": "model:meta", "params": {"alpha": 0.5}, "inner_cv": {"kind": "kfold", "n_splits": 4, "shuffle": false, "seed": null}}
  ]
}"#,
        )
        .unwrap();

    let graph = compile_pipeline_dsl(&spec).unwrap();
    let node = graph
        .nodes
        .iter()
        .find(|node| node.id.as_str() == "model:meta")
        .expect("compat merge-model node exists");
    let inner: crate::fold::NestedCvSpec =
        serde_json::from_value(node.metadata.get("dsl_inner_cv").cloned().unwrap()).unwrap();
    match inner {
        crate::fold::NestedCvSpec::KFold(ref k) => assert_eq!(k.n_splits, 4),
        other => panic!("expected merge-model KFold inner_cv, got {other:?}"),
    }
}

// ----- plan-time data-aware branch fan-out (Slice 2 keystone) -----

const FANOUT_FP: &str = "1111111111111111111111111111111111111111111111111111111111111111";

/// Build an envelope whose coordinator relations carry the given
/// `(metadata_value, tags)` per sample so a by_metadata/by_tag fan-out has
/// distinct values to discover.
fn fanout_envelope(rows: &[(&str, &str, &[&str])]) -> crate::data::ExternalDataPlanEnvelope {
    use crate::ids::{ObservationId, SampleId};
    use crate::relation::{SampleRelation, SampleRelationSet};
    let records = rows
        .iter()
        .map(|(sample, site, tags)| {
            let mut relation = SampleRelation::new(
                ObservationId::new(format!("obs:{sample}")).unwrap(),
                SampleId::new(format!("sample:{sample}")).unwrap(),
            );
            relation
                .metadata
                .insert("site".to_string(), serde_json::json!(site));
            relation.tags = tags.iter().map(|tag| (*tag).to_string()).collect();
            relation
        })
        .collect::<Vec<_>>();
    let relations = SampleRelationSet { records };
    relations.validate().unwrap();
    crate::data::ExternalDataPlanEnvelope {
        schema_version: crate::data::EXTERNAL_DATA_PLAN_ENVELOPE_SCHEMA_VERSION,
        schema_fingerprint: FANOUT_FP.to_string(),
        plan_fingerprint: FANOUT_FP.to_string(),
        relation_fingerprint: Some(relations.fingerprint().unwrap()),
        data_content_fingerprint: None,
        target_content_fingerprint: None,
        coordinator_relations: Some(relations),
        predict_cohort: None,
    }
}

fn auto_separation_by_metadata_spec() -> PipelineDslSpec {
    serde_json::from_str(
            r#"{
  "id": "dsl-fanout-by-metadata",
  "steps": [
    {
      "kind": "branch",
      "mode": "by_metadata",
      "selector": {"metadata_key": "site"},
      "metadata": {"auto_separate": true},
      "branches": [
        {
          "id": "per_site",
          "steps": [
            {"kind": "transform", "id": "transform:snv", "operator": {"type": "StandardNormalVariate"}},
            {"kind": "model", "id": "model:site", "operator": {"type": "PLSRegression"}}
          ]
        }
      ]
    }
  ]
}"#,
        )
        .unwrap()
}

#[test]
fn fans_out_by_metadata_into_one_branch_per_sorted_value() {
    let spec = auto_separation_by_metadata_spec();
    // Insertion order C, A, B — fan-out must sort to A, B, C.
    let envelope = fanout_envelope(&[
        ("s1", "C", &[]),
        ("s2", "A", &[]),
        ("s3", "B", &[]),
        ("s4", "A", &[]),
    ]);

    let expanded = fan_out_data_aware_branches(&spec, &envelope).unwrap();

    let PipelineDslStep::Branch(branch_step) = &expanded.steps[0] else {
        panic!("expected a branch step");
    };
    // Three distinct sites -> three branches, sorted A,B,C.
    let ids: Vec<&str> = branch_step.branches.iter().map(|b| b.id.as_str()).collect();
    assert_eq!(ids, vec!["per_site__A", "per_site__B", "per_site__C"]);
    // The auto_separate marker is consumed so a re-run is a no-op.
    assert!(!branch_step.metadata.contains_key("auto_separate"));
    // Each branch targets exactly its own metadata value.
    assert_eq!(
        branch_step.branches[0].selector.as_ref().unwrap()["metadata"]["site"],
        "A"
    );
    assert_eq!(
        branch_step.branches[2].selector.as_ref().unwrap()["metadata"]["site"],
        "C"
    );

    // The expanded spec compiles into N concrete branch model nodes, one per
    // partition, each scoped by its own BranchViewPlan — RETAIN ALL.
    let compiled = compile_pipeline_dsl_with_generation(&expanded).unwrap();
    assert_eq!(compiled.branch_view_plans.len(), 3);
    let mut sites: Vec<String> = compiled
        .branch_view_plans
        .iter()
        .map(|plan| plan.selector.metadata["site"].as_str().unwrap().to_string())
        .collect();
    sites.sort();
    assert_eq!(sites, vec!["A", "B", "C"]);
    // One model node per partition, each carrying its own branch view.
    for site in ["A", "B", "C"] {
        let node = compiled
            .graph
            .nodes
            .iter()
            .find(|node| node.id.as_str() == format!("model:site__{site}"))
            .unwrap_or_else(|| panic!("missing per-partition model node for site {site}"));
        assert_eq!(
            node.metadata["dsl_branch_view_plan"]["selector"]["metadata"]["site"],
            site
        );
    }
    compiled.graph.validate().unwrap();
}

#[test]
fn fans_out_by_tag_into_one_branch_per_sorted_tag() {
    let spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-fanout-by-tag",
  "steps": [
    {
      "kind": "branch",
      "mode": "by_tag",
      "metadata": {"auto_separate": true},
      "branches": [
        {
          "id": "per_tag",
          "steps": [
            {"kind": "model", "id": "model:tag", "operator": {"type": "Ridge"}}
          ]
        }
      ]
    }
  ]
}"#,
    )
    .unwrap();
    let envelope = fanout_envelope(&[
        ("s1", "x", &["red", "blue"]),
        ("s2", "y", &["blue"]),
        ("s3", "z", &["green"]),
    ]);

    let expanded = fan_out_data_aware_branches(&spec, &envelope).unwrap();
    let PipelineDslStep::Branch(branch_step) = &expanded.steps[0] else {
        panic!("expected a branch step");
    };
    let ids: Vec<&str> = branch_step.branches.iter().map(|b| b.id.as_str()).collect();
    assert_eq!(ids, vec!["per_tag__blue", "per_tag__green", "per_tag__red"]);
    assert_eq!(
        branch_step.branches[0].selector.as_ref().unwrap()["tags"][0],
        "blue"
    );

    let compiled = compile_pipeline_dsl_with_generation(&expanded).unwrap();
    assert_eq!(compiled.branch_view_plans.len(), 3);
    assert_eq!(compiled.branch_view_plans[0].mode, BranchViewMode::ByTag);
}

#[test]
fn fan_out_is_deterministic_byte_identical() {
    let spec = auto_separation_by_metadata_spec();
    let envelope = fanout_envelope(&[("s1", "B", &[]), ("s2", "A", &[])]);

    let first = fan_out_data_aware_branches(&spec, &envelope).unwrap();
    let second = fan_out_data_aware_branches(&spec, &envelope).unwrap();
    assert_eq!(
        serde_json::to_string(&first).unwrap(),
        serde_json::to_string(&second).unwrap(),
        "identical data must expand to a byte-identical spec"
    );
    // The fan-out fingerprint is recorded and stable across runs.
    let fp = first.metadata[DSL_DATA_AWARE_FANOUT_METADATA_KEY]["fingerprint"].clone();
    assert_eq!(
        fp,
        second.metadata[DSL_DATA_AWARE_FANOUT_METADATA_KEY]["fingerprint"]
    );
    assert!(fp.as_str().unwrap().len() == 64);
}

#[test]
fn leaves_explicit_and_unmarked_branches_untouched() {
    // Same shape as the auto-separation spec but WITHOUT the auto_separate
    // marker -> must be left exactly as written (compiles as a plain
    // single-branch explicit step would, here it errors for lacking a
    // selector, proving fan-out did not touch it).
    let mut spec = auto_separation_by_metadata_spec();
    if let PipelineDslStep::Branch(step) = &mut spec.steps[0] {
        step.metadata.remove("auto_separate");
    }
    let envelope = fanout_envelope(&[("s1", "A", &[]), ("s2", "B", &[])]);
    let expanded = fan_out_data_aware_branches(&spec, &envelope).unwrap();
    // Unchanged: still one branch, no fan-out metadata recorded.
    let PipelineDslStep::Branch(branch_step) = &expanded.steps[0] else {
        panic!("expected a branch step");
    };
    assert_eq!(branch_step.branches.len(), 1);
    assert_eq!(branch_step.branches[0].id, "per_site");
    assert!(!expanded
        .metadata
        .contains_key(DSL_DATA_AWARE_FANOUT_METADATA_KEY));
}

#[test]
fn fan_out_requires_relations_in_envelope() {
    let spec = auto_separation_by_metadata_spec();
    let envelope = crate::data::ExternalDataPlanEnvelope {
        schema_version: crate::data::EXTERNAL_DATA_PLAN_ENVELOPE_SCHEMA_VERSION,
        schema_fingerprint: FANOUT_FP.to_string(),
        plan_fingerprint: FANOUT_FP.to_string(),
        relation_fingerprint: None,
        data_content_fingerprint: None,
        target_content_fingerprint: None,
        coordinator_relations: None,
        predict_cohort: None,
    };
    let error = fan_out_data_aware_branches(&spec, &envelope)
        .unwrap_err()
        .to_string();
    assert!(error.contains("requires coordinator relations"), "{error}");
}

#[test]
fn fan_out_errors_when_no_partition_values_discovered() {
    let spec = auto_separation_by_metadata_spec();
    // Relations carry NO "site" metadata key -> nothing to discover.
    use crate::ids::{ObservationId, SampleId};
    use crate::relation::{SampleRelation, SampleRelationSet};
    let relations = SampleRelationSet {
        records: vec![SampleRelation::new(
            ObservationId::new("obs:s1").unwrap(),
            SampleId::new("sample:s1").unwrap(),
        )],
    };
    let envelope = crate::data::ExternalDataPlanEnvelope {
        schema_version: crate::data::EXTERNAL_DATA_PLAN_ENVELOPE_SCHEMA_VERSION,
        schema_fingerprint: FANOUT_FP.to_string(),
        plan_fingerprint: FANOUT_FP.to_string(),
        relation_fingerprint: Some(relations.fingerprint().unwrap()),
        data_content_fingerprint: None,
        target_content_fingerprint: None,
        coordinator_relations: Some(relations),
        predict_cohort: None,
    };
    let error = fan_out_data_aware_branches(&spec, &envelope)
        .unwrap_err()
        .to_string();
    assert!(error.contains("discovered no partition values"), "{error}");
}

#[test]
fn fan_out_clones_top_level_data_bindings_per_branch() {
    // The executable DSL (from run_backend) carries top-level data_bindings
    // keyed by node id. Fan-out must clone+rewrite them per discovered
    // partition so each per-branch model node has its binding (no dangle, no
    // collision), and the original template-id binding must be gone.
    let mut spec = auto_separation_by_metadata_spec();
    spec.data_bindings = vec![crate::data::DataBinding {
        node_id: NodeId::new("model:site").unwrap(),
        input_name: "x".to_string(),
        request_id: "req".to_string(),
        schema_fingerprint: FANOUT_FP.to_string(),
        plan_fingerprint: FANOUT_FP.to_string(),
        relation_fingerprint: Some(FANOUT_FP.to_string()),
        output_representation: "tabular_numeric".to_string(),
        feature_set_id: Some("x".to_string()),
        source_ids: Vec::new(),
        require_relations: false,
        view_policy: Default::default(),
        metadata: BTreeMap::new(),
    }];
    let envelope = fanout_envelope(&[("s1", "A", &[]), ("s2", "B", &[])]);

    let expanded = fan_out_data_aware_branches(&spec, &envelope).unwrap();

    let bound_nodes: Vec<&str> = expanded
        .data_bindings
        .iter()
        .map(|binding| binding.node_id.as_str())
        .collect();
    assert_eq!(bound_nodes, vec!["model:site__A", "model:site__B"]);
    // The dangling original-id binding is gone.
    assert!(!expanded
        .data_bindings
        .iter()
        .any(|binding| binding.node_id.as_str() == "model:site"));
    // The rewritten bindings still target real per-branch nodes after compile.
    let compiled = compile_pipeline_dsl_with_generation(&expanded).unwrap();
    for site in ["A", "B"] {
        let node_id = format!("model:site__{site}");
        assert!(
            compiled
                .data_bindings
                .contains_key(&NodeId::new(&node_id).unwrap()),
            "binding missing for fanned node {node_id}"
        );
    }
    compiled.graph.validate().unwrap();
}

#[test]
fn fan_out_rejects_merge_inside_auto_separation_template() {
    let spec: PipelineDslSpec = serde_json::from_str(
        r#"{
  "id": "dsl-fanout-merge-template",
  "steps": [
    {
      "kind": "branch",
      "mode": "by_metadata",
      "selector": {"metadata_key": "site"},
      "metadata": {"auto_separate": true},
      "branches": [
        {
          "id": "per_site",
          "steps": [
            {"kind": "model", "id": "model:a", "operator": {"type": "Ridge"}},
            {"kind": "merge_model", "id": "model:meta", "operator": {"type": "Ridge"}}
          ]
        }
      ]
    }
  ]
}"#,
    )
    .unwrap();
    let envelope = fanout_envelope(&[("s1", "A", &[]), ("s2", "B", &[])]);
    let error = fan_out_data_aware_branches(&spec, &envelope)
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("does not support a `merge_model` step"),
        "{error}"
    );
}

#[test]
fn fan_out_rejects_generation_override_on_fanned_node() {
    let mut spec = auto_separation_by_metadata_spec();
    spec.generation_dimensions = vec![PipelineDslGenerationDimension {
        name: "dim".to_string(),
        choices: vec![PipelineDslGenerationChoice {
            label: "c0".to_string(),
            value: None,
            param_overrides: vec![PipelineDslGenerationParamOverride {
                // Targets the template model node that fan-out multiplies.
                node_id: NodeId::new("model:site").unwrap(),
                params: BTreeMap::from([("alpha".to_string(), serde_json::json!(0.1))]),
            }],
            active_subsequence: None,
        }],
    }];
    let envelope = fanout_envelope(&[("s1", "A", &[]), ("s2", "B", &[])]);
    let error = fan_out_data_aware_branches(&spec, &envelope)
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("generation param_override targeting node `model:site`"),
        "{error}"
    );
}

//! Product recipes compose the live native Methods catalog into DAG nodes.
//! Numerics, execution, leakage validation and portable state belong upstream.
use std::collections::BTreeMap;
use std::path::Path;

use dag_ml_core::{DataBinding, NodeId, Phase, TrainingDataIdentity, TrainingRequest};
use serde_json::{json, Value};

pub use crate::native_pipeline_contract::{
    validate_pipeline, NativePipelineRecipe, NativePipelineStep,
};

use crate::io_training::{CanonicalPlsProfile, DatasetPackage, DatasetPackageMethodsProvider};

/// Construct a signed, catalog-resolved training request for a linear native
/// pipeline. Each fitted transform executes separately inside every CV fold.
pub fn native_pipeline_training_request(
    dataset: &DatasetPackage,
    source_id: &str,
    recipe: &NativePipelineRecipe,
    library: &Path,
) -> Result<TrainingRequest, String> {
    if recipe.steps.is_empty()
        || recipe.steps.len() > 32
        || recipe.candidates.is_empty()
        || recipe.candidates.len() > 32
    {
        return Err(
            "native pipeline requires 1..32 steps and 1..32 candidate parameter maps".into(),
        );
    }
    let classification = recipe
        .steps
        .last()
        .is_some_and(|step| step.role == "classifier");
    let provider =
        DatasetPackageMethodsProvider::for_product_pipeline(dataset, source_id, classification)?;
    let base = crate::io_training::base_regression_training_request(
        &provider,
        CanonicalPlsProfile::Raw,
        true,
    )?;
    let runtime = crate::native_methods_replay::configure_methods_runtime_for_source(library)
        .map_err(|e| e.to_string())?;
    let specs = dag_ml_core::methods_estimator_host_controller_specs(&runtime)
        .map_err(|e| e.to_string())?;
    let mut manifests = specs
        .iter()
        .map(|s| s.derive())
        .collect::<dag_ml_core::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    manifests.sort_by(|a, b| a.controller_id.cmp(&b.controller_id));
    let mut request = serde_json::to_value(base).map_err(|e| e.to_string())?;
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    let mut ids = Vec::new();
    for (index, step) in recipe.steps.iter().enumerate() {
        let final_step = index + 1 == recipe.steps.len();
        let kind = match (step.role.as_str(), final_step) {
            ("transformer" | "selector", false) => "transform",
            ("regressor" | "classifier", true) => "model",
            _ => return Err(
                "pipeline requires transformer/selector steps followed by one regressor/classifier"
                    .into(),
            ),
        };
        if step.method_id.trim().is_empty()
            || step.params.contains_key("method_id")
            || step.params.contains_key("unsafe_flags")
        {
            return Err(
                "method_id and unsafe_flags cannot be overridden by user parameters".into(),
            );
        }
        let id = if final_step {
            "model:pls".to_string()
        } else {
            format!("transform:{index}")
        };
        NodeId::new(&id).map_err(|e| e.to_string())?;
        let mut params = step.params.clone();
        params.insert("method_id".into(), json!(step.method_id));
        nodes.push(json!({"id":id,"kind":kind,"operator":format!("n4m:{}",step.method_id),"params":params,
            "ports":{"inputs":[{"name":"x","kind":"data","representation":"tabular_numeric","cardinality":"one","description":""}],
            "outputs":[{"name":if final_step {"oof"} else {"x_out"},"kind":if final_step {"prediction"} else {"data"},"representation":if final_step {Value::Null} else {json!("tabular_numeric")},"cardinality":"one","description":""}]},"metadata":{},"seed_label":null}));
        if let Some(previous) = ids.last() {
            edges.push(json!({"source":{"node_id":previous,"port_name":"x_out"},"target":{"node_id":id,"port_name":"x"},
                "contract":{"kind":"data","representation":"tabular_numeric","requires_oof":false,"requires_fold_alignment":true,"propagates_lineage":true}}));
        }
        ids.push(id);
    }
    request["campaign"]["metadata"]["native_pipeline_target_names"] =
        request["options"]["outputs"][0]["target_names"].clone();
    if let Some(index) = recipe
        .steps
        .last()
        .and_then(|step| step.params.get("native_target_index"))
    {
        let index = index
            .as_u64()
            .and_then(|value| usize::try_from(value).ok())
            .ok_or("native_target_index requires addressable nonnegative integer")?;
        for key in ["target_names", "target_units", "class_labels"] {
            let values = request["options"]["outputs"][0][key]
                .as_array()
                .ok_or("Invalid native output target schema")?;
            let value = values
                .get(index)
                .ok_or("native_target_index exceeds declared targets")?
                .clone();
            request["options"]["outputs"][0][key] = json!([value]);
        }
    }
    if classification {
        if request["options"]["outputs"][0]["target_names"]
            .as_array()
            .is_none_or(|names| names.len() != 1)
        {
            return Err("native classification requires exactly one target".into());
        }
        request["options"]["outputs"][0]["prediction_kind"] = json!("class_label");
        request["options"]["selection"]["metric"] =
            json!({"name":"balanced_accuracy","objective":"maximize"});
    }
    request["graph"]["nodes"] = json!(nodes);
    request["graph"]["edges"] = json!(edges);
    request["controller_manifests"] = json!(manifests);
    // Only the first node reads raw IO buffers; subsequent nodes consume their
    // upstream native identity-keyed feature handles.
    let mut binding = request["campaign"]["data_bindings"]["model:pls"][0].clone();
    binding["node_id"] = json!(ids[0]);
    request["campaign"]["data_bindings"] = json!({ids[0].clone():[binding]});
    let shape = request["campaign"]["shape_plans"]["model:pls"].clone();
    let mut shapes = serde_json::Map::new();
    for id in &ids {
        let mut declaration = shape.clone();
        declaration["node_id"] = json!(id);
        shapes.insert(id.clone(), declaration);
    }
    request["campaign"]["shape_plans"] = Value::Object(shapes);
    let typed_binding: DataBinding =
        serde_json::from_value(request["campaign"]["data_bindings"][&ids[0]][0].clone())
            .map_err(|e| e.to_string())?;
    request["data_identities"] = json!([TrainingDataIdentity::from_binding_envelope(
        &typed_binding,
        provider.external_envelope()
    )
    .map_err(|e| e.to_string())?]);
    let sample_ids: Vec<String> = dataset
        .audits
        .iter()
        .find_map(|audit| audit.get("input_sample_ids"))
        .map(|value| serde_json::from_value(value.clone()).map_err(|e| e.to_string()))
        .transpose()?
        .unwrap_or_else(|| {
            provider
                .relations()
                .records
                .iter()
                .map(|r| r.sample_id.to_string())
                .collect()
        });
    let groups: BTreeMap<String, String> = provider
        .relations()
        .records
        .iter()
        .map(|r| {
            (
                r.sample_id.to_string(),
                r.group_id
                    .as_ref()
                    .map(|g| g.to_string())
                    .unwrap_or_else(|| r.sample_id.to_string()),
            )
        })
        .collect();
    let dependent = groups
        .values()
        .collect::<std::collections::BTreeSet<_>>()
        .len()
        != groups.len()
        || provider
            .relations()
            .records
            .iter()
            .any(|r| r.origin_sample_id.is_some());
    if dependent && dataset.folds.is_empty() {
        return Err("dependent/grouped samples require explicit leakage-safe fold_ids".into());
    }
    if !dataset.folds.is_empty() {
        if dataset.folds.len() < 2 {
            return Err("at least two declared CV folds required".into());
        }
        let fold_set = json!({"id":"native:declared-folds","sample_ids":sample_ids,
            "sample_groups":if dependent {json!(groups)} else {json!({})},
            "folds":dataset.folds.iter().enumerate().map(|(i,(train,validation))|{
                let select = |indexes:&Vec<i64>| -> Result<Vec<String>,String> {
                    indexes.iter().map(|index| usize::try_from(*index).ok().and_then(|position|sample_ids.get(position)).cloned().ok_or("declared fold index outside native training cohort".into())).collect()
                };
                Ok(json!({"fold_id":format!("native.fold.{i}"),"train_sample_ids":select(train)?,"validation_sample_ids":select(validation)?,"metadata":{}}))
            }).collect::<Result<Vec<_>,String>>()?});
        request["campaign"]["split_invocation"]["fold_set"] = fold_set;
        request["campaign"]["split_invocation"]["id"] = json!("native:declared-folds");
    }
    if dependent {
        request["campaign"]["leakage_policy"]["split_unit"] = json!("group");
        request["campaign"]["leakage_policy"]["require_group_ids"] = json!(true);
        request["campaign"]["split_invocation"]["leakage_policy"] =
            request["campaign"]["leakage_policy"].clone();
    }
    request["campaign"]["metadata"]["native_pipeline_recipe"] = json!(recipe);
    request["campaign"]["metadata"]["input_sample_ids"] = json!(provider
        .relations()
        .records
        .iter()
        .map(|r| r.sample_id.to_string())
        .collect::<Vec<_>>());
    for candidate in &recipe.candidates {
        if candidate.contains_key("method_id")
            || candidate.contains_key("unsafe_flags")
            || candidate.contains_key("native_target_index")
        {
            return Err("candidate parameters cannot override method identity or safety".into());
        }
    }
    request["campaign"]["generation"] = json!({"strategy":"cartesian","max_variants":recipe.candidates.len(),
        "dimensions":[{"name":"native_model_params","choices":recipe.candidates.iter().enumerate().map(|(i,params)|json!({
            "label":format!("candidate_{i}"),"value":i,"param_overrides":if params.is_empty() {vec![]} else {vec![json!({"node_id":"model:pls","params":params})]},"active_subsequence":null})).collect::<Vec<_>>()}]});
    let mut request: TrainingRequest =
        serde_json::from_value(request).map_err(|e| e.to_string())?;
    request.request_fingerprint = request.compute_fingerprint().map_err(|e| e.to_string())?;
    request.validate().map_err(|e| e.to_string())?;
    let projected = request.project().map_err(|e| e.to_string())?;
    for (id, step) in ids.iter().zip(&recipe.steps) {
        let node_id = NodeId::new(id).map_err(|e| e.to_string())?;
        let expected = format!("controller:n4m.{}", step.role);
        if projected
            .plan
            .node_plans
            .get(&node_id)
            .is_none_or(|node| node.controller_id.as_str() != expected)
        {
            return Err(format!(
                "native catalog role differs from declared role for {id}"
            ));
        }
    }
    if projected
        .plan
        .node_plans
        .values()
        .any(|node| !node.supported_phases.contains(&Phase::Refit))
    {
        return Err("every native pipeline step must support portable full refit".into());
    }
    Ok(request)
}

/// Train a portable native pipeline with CV/OOF selection and full refit.
/// The JSON transport is a DAG Package V2, distinct from a Core .n4a archive.
pub fn run_pipeline(
    record: &Value,
    source_id: &str,
    library: &Path,
    run_id: &str,
) -> Result<Value, String> {
    run_pipeline_with_contract(record, source_id, library, run_id, None)
}

pub(crate) fn run_pipeline_with_contract(
    record: &Value,
    source_id: &str,
    library: &Path,
    run_id: &str,
    contract: Option<&Value>,
) -> Result<Value, String> {
    if record
        .as_object()
        .is_none_or(|o| o.len() != 2 || !o.contains_key("dataset") || !o.contains_key("pipeline"))
    {
        return Err("pipeline-run requires exactly dataset and pipeline".into());
    }
    let recipe: NativePipelineRecipe =
        serde_json::from_value(record["pipeline"].clone()).map_err(|e| e.to_string())?;
    let (dataset, _) = nirs4all_io_crate::core::public_dataset::masked_matrix_dataset_package(
        &record["dataset"],
        source_id,
    )?;
    let mut request = native_pipeline_training_request(&dataset, source_id, &recipe, library)?;
    if let Some(contract) = contract {
        request
            .campaign
            .metadata
            .insert("native_multimodal_contract".into(), contract.clone());
        request.request_fingerprint = request.compute_fingerprint().map_err(|e| e.to_string())?;
        request.validate().map_err(|e| e.to_string())?;
    }
    let provider = DatasetPackageMethodsProvider::for_product_pipeline(
        &dataset,
        source_id,
        recipe
            .steps
            .last()
            .is_some_and(|step| step.role == "classifier"),
    )?;
    let mut artifacts = dag_ml_core::InMemoryArtifactStore::new();
    let training = crate::io_training::execute_dataset_package_methods_training(
        &provider,
        &request,
        &format!("outcome:{run_id}"),
        dag_ml_core::RunId::new(run_id).map_err(|e| e.to_string())?,
        dag_ml_core::BundleId::new(format!("bundle:{run_id}")).map_err(|e| e.to_string())?,
        library,
        &mut artifacts,
    )?;
    let package = training
        .to_portable_predictor_package(
            format!("package:{run_id}"),
            dag_ml_core::FittedArtifactMode::PortableRequired,
            dag_ml_core::ArtifactLoadMode::NativePortable,
        )
        .map_err(|e| e.to_string())?;
    Ok(
        json!({"schema":"nirs4all.native-pipeline.v1","schema_version":1,
        "config":{"source_id":source_id,"pipeline":recipe},"training_outcome":training,"package":package}),
    )
}

/// Cold, target-free replay is executed entirely by native DAG controllers.
pub fn predict_pipeline(record: &Value, library: &Path, run_id: &str) -> Result<Value, String> {
    let keys = ["model", "sample_ids", "x"];
    if record
        .as_object()
        .is_none_or(|o| o.len() != keys.len() || keys.iter().any(|k| !o.contains_key(*k)))
    {
        return Err("pipeline-predict requires model, sample_ids and x".into());
    }
    let package = validate_pipeline(&record["model"])?;
    let sample_ids: Vec<String> =
        serde_json::from_value(record["sample_ids"].clone()).map_err(|e| e.to_string())?;
    let x: Vec<Vec<f64>> =
        serde_json::from_value(record["x"].clone()).map_err(|e| e.to_string())?;
    let binding = package
        .output_bindings
        .first()
        .ok_or("missing pipeline output")?;
    let mut composition = crate::native_methods_replay::compose_methods_matrix_predict(
        &package,
        crate::MethodsArchiveMatrixPredictRequest {
            sample_ids,
            x,
            expected_target_names: binding.target_names.clone(),
            methods_library_path: library.to_path_buf(),
            methods_library_sha256: String::new(),
            request_id: format!("predict:{run_id}"),
            outcome_id: format!("outcome:{run_id}"),
            run_id: dag_ml_core::RunId::new(run_id).map_err(|e| e.to_string())?,
            warnings: Vec::new(),
            diagnostics: BTreeMap::new(),
        },
        true,
    )
    .map_err(|e| e.to_string())?;
    if let Some(names) = package
        .template
        .campaign
        .metadata
        .get("native_pipeline_target_names")
    {
        let names: Vec<String> =
            serde_json::from_value(names.clone()).map_err(|e| e.to_string())?;
        for rows in composition.input.methods_inputs.values_mut() {
            rows.target_names = names.clone();
        }
    }
    let replay =
        crate::native_methods_replay::replay_methods_predictor_package(&package, composition.input)
            .map_err(|e| e.to_string())?;
    serde_json::to_value(replay).map_err(|e| e.to_string())
}

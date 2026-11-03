//! Product transport composes Methods source encoders, IO assembly and DAG target models.
use crate::pipeline_workflow::{validate_pipeline, NativePipelineRecipe};
use nirs4all_io_crate::core::public_dataset as io;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourcePolicy {
    pub source_id: String,
    pub encoder: String,
    pub missing_policy: String,
}

fn closed(value: &Value, keys: &[&str]) -> Result<(), String> {
    if value.as_object().is_none_or(|fields| {
        fields.len() != keys.len() || keys.iter().any(|key| !fields.contains_key(*key))
    }) {
        return Err(format!(
            "native multimodal record requires exactly {}",
            keys.join(", ")
        ));
    }
    Ok(())
}

fn schemas(record: &Value) -> Result<Value, String> {
    let mut result = serde_json::Map::new();
    for source in record["dataset"]["sources"]
        .as_array()
        .ok_or("Missing source inventory")?
    {
        let name = source["name"].as_str().ok_or("Invalid source identity")?;
        result.insert(name.into(), io::public_source_schema(record, name)?);
    }
    Ok(Value::Object(result))
}

fn projections(
    record: &Value,
    policies: &[SourcePolicy],
    library: &Path,
) -> Result<(Value, Value), String> {
    let sources = record["dataset"]["sources"]
        .as_array()
        .ok_or("Missing source inventory")?;
    if sources.len() != policies.len() {
        return Err("Source policies must match exact ordered source inventory".into());
    }
    crate::native_methods_replay::configure_methods_runtime_for_source(library)
        .map_err(|e| e.to_string())?;
    let mut projected = Vec::new();
    for (source, policy) in sources.iter().zip(policies) {
        if source["name"] != policy.source_id
            || !["reject", "zero_with_indicator"].contains(&policy.missing_policy.as_str())
        {
            return Err("Invalid source policy identity or explicit missing policy".into());
        }
        let absent = source["presence_mask"]["values"]
            .as_array()
            .is_some_and(|rows| rows.iter().any(|row| row == false));
        if policy.encoder == "identity" {
            if source["source_kind"] == "ragged_series"
                || absent
                || policy.missing_policy != "reject"
            {
                return Err(
                    "Identity encoder requires a complete dense source and reject policy".into(),
                );
            }
            let width = source["array"]["shape"][1]
                .as_u64()
                .ok_or("Identity encoder requires rank two numeric matrix")?
                as usize;
            if source["array"]["shape"]
                .as_array()
                .is_none_or(|shape| shape.len() != 2)
            {
                return Err("Identity encoder requires rank two numeric matrix".into());
            }
            let names = if source["feature_names"].is_null() {
                json!((0..width).map(|i| format!("x{i}")).collect::<Vec<_>>())
            } else {
                source["feature_names"].clone()
            };
            projected.push(json!({"source_id":policy.source_id,"sample_ids":source["sample_ids"],"array":source["array"],"feature_names":names,"presence_encoded":false}));
        } else if policy.encoder == "ragged_summary" {
            if source["source_kind"] != "ragged_series" {
                return Err("ragged_summary requires a native ragged_series source".into());
            }
            let x: Vec<Vec<f64>> = serde_json::from_value(source["array"]["values"].clone())
                .map_err(|e| e.to_string())?;
            let channels = source["array"]["shape"][1]
                .as_u64()
                .ok_or("Missing ragged channel width")? as usize;
            let values = x.iter().flatten().copied().collect::<Vec<_>>();
            let context = n4m::Context::new().map_err(|e| e.to_string())?;
            let mut params = n4m::roles::Params::new(&context, "utilities.ragged_summary")
                .map_err(|e| e.to_string())?;
            params
                .set(
                    "offsets",
                    &n4m::roles::ParamValue::IntArray(
                        serde_json::from_value(source["offsets"]["values"].clone())
                            .map_err(|e| e.to_string())?,
                    ),
                )
                .map_err(|e| e.to_string())?;
            let presence: Vec<bool> =
                serde_json::from_value(source["presence_mask"]["values"].clone())
                    .map_err(|e| e.to_string())?;
            params
                .set(
                    "presence",
                    &n4m::roles::ParamValue::IntArray(
                        presence.iter().map(|value| i64::from(*value)).collect(),
                    ),
                )
                .map_err(|e| e.to_string())?;
            params
                .set(
                    "missing_policy",
                    &n4m::roles::ParamValue::Enum(policy.missing_policy.clone()),
                )
                .map_err(|e| e.to_string())?;
            if !source["time_coordinates"].is_null() {
                params
                    .set(
                        "time_coordinates",
                        &n4m::roles::ParamValue::DoubleArray(
                            serde_json::from_value(source["time_coordinates"]["values"].clone())
                                .map_err(|e| e.to_string())?,
                        ),
                    )
                    .map_err(|e| e.to_string())?;
            }
            let matrix =
                n4m::MatrixRef::row_major(&values, x.len(), channels).map_err(|e| e.to_string())?;
            let result = n4m::roles::run_procedure(
                &context,
                "utilities.ragged_summary",
                Some(&params),
                &n4m::roles::FitInputs::new(matrix),
            )
            .map_err(|e| e.to_string())?;
            let output = result
                .double_matrix("features")
                .map_err(|e| e.to_string())?;
            let names = (0..channels)
                .flat_map(|i| {
                    ["mean", "std", "min", "max"].map(move |stat| format!("channel{i}:{stat}"))
                })
                .chain(["length".into(), "duration".into(), "presence".into()])
                .collect::<Vec<String>>();
            projected.push(json!({"source_id":policy.source_id,"sample_ids":source["sample_ids"],"array":{"dtype":"float64","shape":[output.rows,output.cols],"values":output.data.chunks(output.cols).collect::<Vec<_>>()},"feature_names":names,"presence_encoded":policy.missing_policy=="zero_with_indicator"}));
        } else {
            return Err("Native source encoder must be identity or ragged_summary".into());
        }
    }
    io::projected_matrix_dataset(record, &projected)
}

pub fn run_multimodal(record: &Value, library: &Path, run_id: &str) -> Result<Value, String> {
    closed(record, &["dataset", "pipeline", "source_policies"])?;
    let input = io::normalize_dataset(&record["dataset"])?;
    let policies: Vec<SourcePolicy> =
        serde_json::from_value(record["source_policies"].clone()).map_err(|e| e.to_string())?;
    let recipe: NativePipelineRecipe =
        serde_json::from_value(record["pipeline"].clone()).map_err(|e| e.to_string())?;
    if recipe
        .steps
        .iter()
        .any(|step| step.params.contains_key("native_target_index"))
    {
        return Err("Multimodal orchestration owns native_target_index".into());
    }
    let (matrix, provenance) = projections(&input, &policies, library)?;
    let targets: Vec<String> = serde_json::from_value(matrix["dataset"]["target_names"].clone())
        .map_err(|e| e.to_string())?;
    if targets.is_empty() {
        return Err("Multimodal training requires declared targets".into());
    }
    let config = json!({"pipeline":recipe,"source_policies":policies,"source_schemas":schemas(&input)?,"target_names":targets});
    let contract = json!({"config":config,"training_projection_provenance":provenance});
    let mut models = Vec::new();
    for (index, target) in targets.iter().enumerate() {
        let mut selected = recipe.clone();
        selected
            .steps
            .last_mut()
            .ok_or("Missing native target model")?
            .params
            .insert("native_target_index".into(), json!(index));
        let model = crate::pipeline_workflow::run_pipeline_with_contract(
            &json!({"dataset":matrix,"pipeline":selected}),
            "native_features",
            library,
            &format!("{run_id}:target:{index}"),
            Some(&contract),
        )?;
        models.push(json!({"target_name":target,"model":model}));
    }
    Ok(
        json!({"schema":"nirs4all.native-multimodal.v1","schema_version":1,"config":config,"training_projection_provenance":provenance,"target_models":models}),
    )
}

pub fn validate_multimodal(record: &Value) -> Result<(), String> {
    closed(
        record,
        &[
            "schema",
            "schema_version",
            "config",
            "training_projection_provenance",
            "target_models",
        ],
    )?;
    if record["schema"] != "nirs4all.native-multimodal.v1" || record["schema_version"] != 1 {
        return Err("Invalid native multimodal envelope".into());
    }
    closed(
        &record["config"],
        &[
            "pipeline",
            "source_policies",
            "source_schemas",
            "target_names",
        ],
    )?;
    let config = &record["config"];
    let policies: Vec<SourcePolicy> =
        serde_json::from_value(config["source_policies"].clone()).map_err(|e| e.to_string())?;
    let projections = record["training_projection_provenance"]["source_projections"]
        .as_array()
        .ok_or("Missing captured source projections")?;
    let source_schemas = config["source_schemas"]
        .as_object()
        .ok_or("Missing captured source schemas")?;
    let unique: std::collections::BTreeSet<_> = policies.iter().map(|p| &p.source_id).collect();
    if policies.is_empty()
        || policies.len() != projections.len()
        || unique.len() != policies.len()
        || source_schemas.len() != policies.len()
    {
        return Err("Captured source inventory disagrees with projection provenance".into());
    }
    for (policy, projection) in policies.iter().zip(projections) {
        if !matches!(
            policy.missing_policy.as_str(),
            "reject" | "zero_with_indicator"
        ) || !matches!(policy.encoder.as_str(), "identity" | "ragged_summary")
            || (policy.encoder == "identity" && policy.missing_policy != "reject")
            || projection["source_id"] != policy.source_id
            || source_schemas.get(&policy.source_id) != Some(&projection["source_schema"])
            || projection["presence_encoded"] != (policy.missing_policy == "zero_with_indicator")
        {
            return Err("Captured source policy differs from projection provenance".into());
        }
    }
    let recipe: NativePipelineRecipe =
        serde_json::from_value(config["pipeline"].clone()).map_err(|e| e.to_string())?;
    let targets: Vec<String> =
        serde_json::from_value(config["target_names"].clone()).map_err(|e| e.to_string())?;
    let models = record["target_models"]
        .as_array()
        .ok_or("Missing native target models")?;
    if models.len() != targets.len() || models.is_empty() {
        return Err("Native target model inventory disagrees with target schema".into());
    }
    let contract = json!({"config":config,"training_projection_provenance":record["training_projection_provenance"]});
    for (index, (entry, target)) in models.iter().zip(targets).enumerate() {
        closed(entry, &["target_name", "model"])?;
        let package = validate_pipeline(&entry["model"])?;
        let mut selected = recipe.clone();
        selected
            .steps
            .last_mut()
            .ok_or("Missing native target model")?
            .params
            .insert("native_target_index".into(), json!(index));
        if entry["target_name"] != target
            || package.output_bindings[0].target_names != vec![target.clone()]
            || package
                .template
                .campaign
                .metadata
                .get("native_pipeline_target_names")
                != Some(&config["target_names"])
            || entry["model"]["config"]["source_id"] != "native_features"
            || entry["model"]["config"]["pipeline"] != json!(selected)
            || package
                .template
                .campaign
                .metadata
                .get("native_multimodal_contract")
                != Some(&contract)
        {
            return Err(
                "Native multimodal configuration differs from signed target campaign contract"
                    .into(),
            );
        }
    }
    Ok(())
}

pub fn predict_multimodal(record: &Value, library: &Path, run_id: &str) -> Result<Value, String> {
    closed(record, &["model", "dataset"])?;
    let model = &record["model"];
    validate_multimodal(model)?;
    let input = io::normalize_dataset(&record["dataset"])?;
    if !input["dataset"]["y"].is_null() {
        return Err("Native multimodal cold prediction requires target-free input".into());
    }
    if io::canonical_content_bytes(&schemas(&input)?)?
        != io::canonical_content_bytes(&model["config"]["source_schemas"])?
    {
        return Err(
            "Prediction source schemas differ from captured native encoder contract".into(),
        );
    }
    let policies: Vec<SourcePolicy> =
        serde_json::from_value(model["config"]["source_policies"].clone())
            .map_err(|e| e.to_string())?;
    let (matrix, provenance) = projections(&input, &policies, library)?;
    let mut results = Vec::new();
    for (index, entry) in model["target_models"]
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
    {
        let replay = crate::pipeline_workflow::predict_pipeline(
            &json!({"model":entry["model"],"sample_ids":matrix["dataset"]["sample_ids"],"x":matrix["dataset"]["sources"][0]["array"]["values"]}),
            library,
            &format!("{run_id}:target:{index}"),
        )?;
        results.push(json!({"target_name":entry["target_name"],"replay":replay}));
    }
    Ok(json!({"target_results":results,"prediction_projection_provenance":provenance}))
}

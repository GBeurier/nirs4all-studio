//! Portable projection of signed native training arrays; no scores are computed.
//! Dataset/task display labels remain caller provenance, not model attestation.

use dag_ml_core::TrainingOutcome;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

pub fn project_training_predictions_json(
    outcome_json: &str,
    dataset_label: &str,
    task_type_label: &str,
) -> Result<String, String> {
    let outcome = TrainingOutcome::from_json(outcome_json).map_err(|error| error.to_string())?;
    serde_json::to_string(&project_training_predictions(
        &outcome,
        dataset_label,
        task_type_label,
    )?)
    .map_err(|error| error.to_string())
}

pub fn validate_training_predictions_json(
    outcome_json: &str,
    predictions_json: &str,
) -> Result<(), String> {
    let outcome = TrainingOutcome::from_json(outcome_json).map_err(|error| error.to_string())?;
    let rows: Vec<Value> =
        serde_json::from_str(predictions_json).map_err(|error| error.to_string())?;
    validate_training_predictions(&outcome, &rows)
}

pub fn validate_training_predictions(
    outcome: &TrainingOutcome,
    rows: &[Value],
) -> Result<(), String> {
    let dataset_label = rows
        .first()
        .and_then(|row| row["dataset"].as_str())
        .unwrap_or("");
    let task_type_label = rows
        .first()
        .and_then(|row| row["task_type"].as_str())
        .unwrap_or("");
    let expected = project_training_predictions(outcome, dataset_label, task_type_label)?;
    // Host JSON spells an integral binary64 value as either 1 or 1.0. Parse
    // only native floating-array fields as f64, preserving numerical equality
    // without relaxing identity, shape or scientific-context fields.
    let mut normalized = rows.to_vec();
    for row in &mut normalized {
        for field in ["y_true", "y_pred", "y_proba", "weights"] {
            let values: Vec<f64> =
                serde_json::from_value(row[field].clone()).map_err(|error| error.to_string())?;
            if values.iter().any(|value| !value.is_finite()) {
                return Err("native result prediction arrays must be finite".into());
            }
            row[field] = serde_json::to_value(values).map_err(|error| error.to_string())?;
        }
    }
    if normalized != expected {
        return Err(
            "native result predictions differ from the signed model training outcome".into(),
        );
    }
    Ok(())
}

pub fn project_training_predictions(
    outcome: &TrainingOutcome,
    dataset_label: &str,
    task_type_label: &str,
) -> Result<Vec<Value>, String> {
    let ids = outcome
        .effective_plan
        .campaign
        .metadata
        .get("input_sample_ids")
        .and_then(Value::as_array)
        .ok_or("model prediction closure requires signed input_sample_ids")?;
    let mut positions = BTreeMap::new();
    for (index, id) in ids.iter().enumerate() {
        let id = id
            .as_str()
            .ok_or("signed input sample IDs must be strings")?;
        if positions.insert(id.to_owned(), index as i64).is_some() {
            return Err("signed input sample IDs must be unique".into());
        }
    }
    let cohort = outcome
        .effective_plan
        .fold_set
        .as_ref()
        .ok_or("model prediction closure requires a native fold cohort")?
        .sample_ids
        .iter()
        .map(|id| id.as_str().to_owned())
        .collect::<BTreeSet<_>>();
    if positions.keys().cloned().collect::<BTreeSet<_>>() != cohort {
        return Err("signed input sample IDs differ from the native fold cohort".into());
    }
    let selected = outcome.selected_variant_id.as_str();
    let mut rows = Vec::new();
    let mut add = |variant: &str,
                   block: Value,
                   truth: Option<Value>,
                   context: &str|
     -> Result<(), String> {
        let sample_ids: Vec<String> = if let Some(ids) = block["sample_ids"].as_array() {
            ids.iter()
                .map(|id| {
                    id.as_str()
                        .map(str::to_owned)
                        .ok_or("invalid native sample ID".into())
                })
                .collect::<Result<_, String>>()?
        } else {
            block["unit_ids"]
                .as_array()
                .ok_or("native prediction lacks identities")?
                .iter()
                .map(|unit| {
                    if unit["level"].as_str() != Some("sample") {
                        return Err(
                            "dense result projection requires native sample-level blocks".into(),
                        );
                    }
                    unit["id"]
                        .as_str()
                        .map(str::to_owned)
                        .ok_or("invalid native sample unit ID".into())
                })
                .collect::<Result<_, String>>()?
        };
        let matrix: Vec<Vec<f64>> =
            serde_json::from_value(block["values"].clone()).map_err(|error| error.to_string())?;
        let width = matrix
            .first()
            .map(Vec::len)
            .ok_or("native prediction is empty")?;
        let truth: Vec<Vec<f64>> = truth
            .map(|value| serde_json::from_value(value["values"].clone()))
            .transpose()
            .map_err(|error| error.to_string())?
            .unwrap_or_default();
        let indices = sample_ids
            .iter()
            .map(|id| {
                positions.get(id).copied().ok_or_else(|| {
                    format!("native prediction sample {id:?} absent from signed input cohort")
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        let model = block["producer_node"]
            .as_str()
            .ok_or("native prediction lacks producer node")?;
        let partition = block["partition"]
            .as_str()
            .ok_or("native prediction lacks partition")?;
        rows.push(json!({
            "dataset":dataset_label,"config_name":variant,"variant_id":variant,"model_name":model,
            "partition":partition,"fold_id":block["fold_id"].as_str().unwrap_or(""),"refit_context":context,
            "sample_indices":indices,"sample_ids":sample_ids,
            "y_true_shape":if truth.is_empty(){vec![]}else{vec![truth.len() as i64,width as i64]},
            "y_pred_shape":[matrix.len() as i64,width as i64],"y_proba_shape":[],
            "y_true":truth.into_iter().flatten().collect::<Vec<_>>(),
            "y_pred":matrix.into_iter().flatten().collect::<Vec<_>>(),"y_proba":[],"weights":[],
            "arrays_present":true,"val_score":null,"test_score":null,"train_score":null,"scores":{},
            "metric":outcome.score_set.selection_metric.clone().unwrap_or_default(),
            "task_type":task_type_label,"target_width":width as i64,"target_names":block["target_names"]
        }));
        Ok(())
    };
    for average in &outcome.oof_averages {
        add(
            selected,
            serde_json::to_value(&average.predictions).map_err(|error| error.to_string())?,
            Some(serde_json::to_value(&average.y_true).map_err(|error| error.to_string())?),
            "cv_oof_average",
        )?;
    }
    for variant in &outcome.variant_oof_averages {
        for average in &variant.oof_averages {
            add(
                variant.variant_id.as_str(),
                serde_json::to_value(&average.predictions).map_err(|error| error.to_string())?,
                Some(serde_json::to_value(&average.y_true).map_err(|error| error.to_string())?),
                "cv_oof_average",
            )?;
        }
    }
    for average in &outcome.ensemble_averages {
        add(
            selected,
            serde_json::to_value(&average.predictions).map_err(|error| error.to_string())?,
            Some(serde_json::to_value(&average.y_true).map_err(|error| error.to_string())?),
            "cv_ensemble",
        )?;
    }
    for output in &outcome.outputs {
        for prediction in &output.predictions {
            add(
                selected,
                serde_json::to_value(prediction).map_err(|error| error.to_string())?,
                None,
                "selected_output",
            )?;
        }
    }
    Ok(rows)
}

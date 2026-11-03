use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::error::{DataError, Result};
use crate::ids::{RepresentationId, SourceId};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FitScope {
    Stateless,
    FoldTrain,
    FullTrain,
    InferenceOnly,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DataPlanStepKind {
    Materialize,
    Adapt,
    Align,
    Join,
    Collate,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DataPlanStep {
    pub kind: DataPlanStepKind,
    pub source_id: Option<SourceId>,
    pub adapter_id: Option<String>,
    pub input_representation: Option<RepresentationId>,
    pub output_representation: Option<RepresentationId>,
    pub fit_scope: FitScope,
    #[serde(default)]
    pub requires_user_choice: bool,
    #[serde(default)]
    pub metadata: BTreeMap<String, serde_json::Value>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct PlanIssue {
    pub code: String,
    pub message: String,
    #[serde(default)]
    pub choices: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DataPlan {
    pub id: String,
    pub steps: Vec<DataPlanStep>,
    pub output_representation: RepresentationId,
    #[serde(default)]
    pub issues: Vec<PlanIssue>,
}

impl DataPlan {
    pub fn validate(&self) -> Result<()> {
        if self.id.trim().is_empty() {
            return Err(DataError::Validation("data plan id is empty".to_string()));
        }
        if self.steps.is_empty() {
            return Err(DataError::Validation(format!(
                "data plan `{}` contains no steps",
                self.id
            )));
        }
        let mut outputs = BTreeMap::new();
        let mut source_outputs = BTreeMap::new();
        for (idx, step) in self.steps.iter().enumerate() {
            let invalid = |message: String| {
                DataError::Validation(format!("data plan `{}` step {idx}: {message}", self.id))
            };
            match step.kind {
                DataPlanStepKind::Materialize if step.source_id.is_none() => {
                    return Err(DataError::Validation(format!(
                        "data plan `{}` step {} materializes without source_id",
                        self.id, idx
                    )));
                }
                DataPlanStepKind::Adapt if step.adapter_id.is_none() => {
                    return Err(DataError::Validation(format!(
                        "data plan `{}` step {} adapts without adapter_id",
                        self.id, idx
                    )));
                }
                _ => {}
            }
            if step
                .adapter_id
                .as_ref()
                .is_some_and(|id| id.trim().is_empty())
            {
                return Err(invalid("adapter_id must not be empty".into()));
            }
            let mut inputs = Vec::new();
            if let Some(value) = step.metadata.get("input") {
                inputs.push(
                    value
                        .as_str()
                        .ok_or_else(|| invalid("input must be a string".into()))?,
                );
            }
            if let Some(value) = step.metadata.get("inputs") {
                let values = value
                    .as_array()
                    .ok_or_else(|| invalid("inputs must be an array".into()))?;
                if values.is_empty() {
                    return Err(invalid("inputs must not be empty".into()));
                }
                for value in values {
                    inputs.push(
                        value
                            .as_str()
                            .ok_or_else(|| invalid("inputs must contain strings".into()))?,
                    );
                }
            }
            if idx == 0 && step.kind != DataPlanStepKind::Materialize {
                return Err(invalid(
                    "must materialize a source before consuming data".into(),
                ));
            }
            for input in inputs {
                let representation = outputs.get(input).ok_or_else(|| {
                    invalid(format!("input `{input}` references no earlier output"))
                })?;
                if let (Some(actual), Some(expected)) = (representation, &step.input_representation)
                {
                    if actual != expected {
                        return Err(invalid(format!(
                            "input `{input}` representation `{actual}` does not match `{expected}`"
                        )));
                    }
                }
            }
            let output = if let Some(value) = step.metadata.get("output") {
                let id = value
                    .as_str()
                    .filter(|id| !id.trim().is_empty())
                    .ok_or_else(|| invalid("output must be a nonempty string".into()))?;
                Some(id.to_owned())
            } else if step.kind == DataPlanStepKind::Materialize {
                step.source_id.as_ref().map(|id| format!("src:{id}"))
            } else {
                None // Published linear plans may omit explicit edge names.
            };
            if let Some(output) = output {
                if let Some(previous) =
                    outputs.insert(output.clone(), step.output_representation.clone())
                {
                    // A source can be materialized for several model ports.
                    if step.kind != DataPlanStepKind::Materialize
                        || previous != step.output_representation
                        || source_outputs.get(&output) != Some(&step.source_id)
                    {
                        return Err(invalid(format!("duplicate output `{output}`")));
                    }
                }
                if step.kind == DataPlanStepKind::Materialize {
                    source_outputs.insert(output, step.source_id.clone());
                }
            }
        }
        if let Some(Some(output)) = self
            .steps
            .last()
            .map(|step| step.output_representation.as_ref())
        {
            if output != &self.output_representation {
                return Err(DataError::Validation(format!(
                    "data plan `{}` output representation does not match its final step",
                    self.id
                )));
            }
        }
        Ok(())
    }

    pub fn requires_user_choice(&self) -> bool {
        self.steps.iter().any(|step| step.requires_user_choice) || !self.issues.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ids::{RepresentationId, SourceId};

    #[test]
    fn rejects_empty_plan() {
        let plan = DataPlan {
            id: "p".to_string(),
            steps: vec![],
            output_representation: RepresentationId::new("tabular").unwrap(),
            issues: vec![],
        };

        assert!(plan.validate().is_err());
    }

    #[test]
    fn flags_user_choice() {
        let plan = DataPlan {
            id: "p".to_string(),
            steps: vec![DataPlanStep {
                kind: DataPlanStepKind::Materialize,
                source_id: Some(SourceId::new("nir").unwrap()),
                adapter_id: None,
                input_representation: None,
                output_representation: Some(RepresentationId::new("signal").unwrap()),
                fit_scope: FitScope::Stateless,
                requires_user_choice: true,
                metadata: BTreeMap::new(),
            }],
            output_representation: RepresentationId::new("signal").unwrap(),
            issues: vec![],
        };

        assert!(plan.validate().is_ok());
        assert!(plan.requires_user_choice());
    }

    #[test]
    fn validates_explicit_edges_without_breaking_linear_plans() {
        let original: DataPlan = serde_json::from_str(include_str!(
            "../../../examples/fixtures/oof_campaign/expected_data_plan_nir_to_tabular.json"
        ))
        .unwrap();
        original.validate().unwrap();
        let mut plan = original.clone();
        plan.steps[1]
            .metadata
            .insert("input".into(), serde_json::json!("step:missing"));
        assert!(plan
            .validate()
            .unwrap_err()
            .to_string()
            .contains("no earlier output"));
        let mut plan = original.clone();
        plan.steps[1]
            .metadata
            .insert("input".into(), serde_json::json!(42));
        assert!(plan.validate().is_err());
        let mut plan = original.clone();
        plan.steps[1].input_representation = Some(RepresentationId::new("wrong").unwrap());
        assert!(plan.validate().is_err());
        let mut plan = original.clone();
        plan.steps[1]
            .metadata
            .insert("output".into(), serde_json::json!("src:nir"));
        assert!(plan.validate().is_err());
        let mut plan = original.clone();
        plan.steps.remove(0);
        assert!(plan.validate().is_err());
        let mut plan = original.clone();
        plan.output_representation = RepresentationId::new("wrong").unwrap();
        assert!(plan.validate().is_err());
        let mut plan = original;
        for step in &mut plan.steps {
            step.metadata.clear();
        }
        plan.validate().unwrap();
    }
}

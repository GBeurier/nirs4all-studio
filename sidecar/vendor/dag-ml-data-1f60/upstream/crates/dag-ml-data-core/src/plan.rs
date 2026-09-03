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
        for (idx, step) in self.steps.iter().enumerate() {
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
}

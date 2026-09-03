use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use thiserror::Error;

/// A stable ADR-11 error payload that can be serialized across bindings.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DagMlErrorDescriptor {
    /// ADR-11 category, for example `validation`, `runtime` or `controller`.
    pub category: String,
    /// Stable machine-readable code inside the category.
    pub code: String,
    /// Error severity. Current failing variants use `error`.
    pub severity: String,
    /// Human-readable error message.
    pub message: String,
    /// One-sentence remediation hint suitable for user-facing diagnostics.
    pub remediation_hint: String,
    /// Structured debug fields that remain stable enough for logs and tests.
    pub context: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct OofLeakageViolation {
    pub producer_node: String,
    pub partition: String,
    pub fold_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct OofLeakageReport {
    pub node_id: String,
    pub violators: Vec<OofLeakageViolation>,
    pub allow_train_predictions_as_features: bool,
    pub remediation: String,
}

#[derive(Debug, Error)]
pub enum DagMlError {
    #[error("invalid identifier `{value}`: {reason}")]
    InvalidIdentifier { value: String, reason: &'static str },

    #[error("graph validation failed: {0}")]
    GraphValidation(String),

    #[error("controller validation failed: {0}")]
    ControllerValidation(String),

    #[error("campaign validation failed: {0}")]
    CampaignValidation(String),

    #[error("planning failed: {0}")]
    Planning(String),

    #[error("runtime validation failed: {0}")]
    RuntimeValidation(String),

    #[error("OOF validation failed: {0}")]
    OofValidation(String),

    #[error("OOF leakage at `{}`: {} violator(s); {}", .0.node_id, .0.violators.len(), .0.remediation)]
    OofLeakage(Box<OofLeakageReport>),

    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}

impl DagMlError {
    /// Return the stable ADR-11 category for this error.
    pub fn category(&self) -> &'static str {
        self.taxonomy_parts().0
    }

    /// Return the stable ADR-11 code for this error.
    pub fn code(&self) -> &'static str {
        self.taxonomy_parts().1
    }

    /// Return the ADR-11 severity for this error.
    pub fn severity(&self) -> &'static str {
        self.taxonomy_parts().2
    }

    /// Return the remediation hint associated with this error.
    pub fn remediation_hint(&self) -> String {
        match self {
            Self::InvalidIdentifier { .. } => {
                "Use a non-empty stable identifier that matches the dag-ml identifier grammar."
                    .to_string()
            }
            Self::GraphValidation(_) => {
                "Fix the graph contract violation before planning or running the pipeline."
                    .to_string()
            }
            Self::ControllerValidation(_) => {
                "Register or configure the controller so it matches the graph contract."
                    .to_string()
            }
            Self::CampaignValidation(_) => {
                "Fix the campaign template so its folds, metrics and graph references are consistent."
                    .to_string()
            }
            Self::Planning(_) => {
                "Inspect the graph and campaign constraints, then re-plan with a compatible execution request."
                    .to_string()
            }
            Self::RuntimeValidation(_) => {
                "Inspect the runtime inputs and produced artifacts, then rerun the failed step with compatible values."
                    .to_string()
            }
            Self::OofValidation(_) => {
                "Use validated out-of-fold contracts and keep training predictions out of feature inputs unless explicitly allowed."
                    .to_string()
            }
            Self::OofLeakage(report) => report.remediation.clone(),
            Self::Serialization(_) => {
                "Check that the JSON or YAML payload matches the supported dag-ml contract version."
                    .to_string()
            }
        }
    }

    /// Return structured context fields for logs, bindings and tests.
    pub fn context(&self) -> BTreeMap<String, Value> {
        let mut context = BTreeMap::new();
        match self {
            Self::InvalidIdentifier { value, reason } => {
                context.insert("value".to_string(), json!(value));
                context.insert("reason".to_string(), json!(reason));
            }
            Self::GraphValidation(detail)
            | Self::ControllerValidation(detail)
            | Self::CampaignValidation(detail)
            | Self::Planning(detail)
            | Self::RuntimeValidation(detail)
            | Self::OofValidation(detail) => {
                context.insert("detail".to_string(), json!(detail));
            }
            Self::OofLeakage(report) => {
                context.insert("node_id".to_string(), json!(report.node_id));
                context.insert("violator_count".to_string(), json!(report.violators.len()));
                context.insert(
                    "allow_train_predictions_as_features".to_string(),
                    json!(report.allow_train_predictions_as_features),
                );
                context.insert("violators".to_string(), json!(report.violators));
            }
            Self::Serialization(error) => {
                context.insert("detail".to_string(), json!(error.to_string()));
            }
        }
        context
    }

    /// Build the serializable ADR-11 descriptor for this error.
    pub fn descriptor(&self) -> DagMlErrorDescriptor {
        DagMlErrorDescriptor {
            category: self.category().to_string(),
            code: self.code().to_string(),
            severity: self.severity().to_string(),
            message: self.to_string(),
            remediation_hint: self.remediation_hint(),
            context: self.context(),
        }
    }

    /// Serialize the ADR-11 descriptor as compact JSON.
    pub fn descriptor_json(&self) -> std::result::Result<String, serde_json::Error> {
        serde_json::to_string(&self.descriptor())
    }

    /// Stable ADR-11 numeric error code for FFI consumers: the high 16 bits are
    /// the taxonomy category id and the low 16 bits are the per-category code id,
    /// mirroring the `(category << 16) | code` convention from ADR-11.
    pub fn error_code(&self) -> u32 {
        let (category_id, code_id) = self.numeric_taxonomy();
        (u32::from(category_id) << 16) | u32::from(code_id)
    }

    fn taxonomy_parts(&self) -> (&'static str, &'static str, &'static str) {
        match self {
            Self::InvalidIdentifier { .. } => ("validation", "invalid_identifier", "error"),
            Self::GraphValidation(_) => ("validation", "graph_validation", "error"),
            Self::ControllerValidation(_) => ("controller", "controller_validation", "error"),
            Self::CampaignValidation(_) => ("validation", "campaign_validation", "error"),
            Self::Planning(_) => ("runtime", "planning_failed", "error"),
            Self::RuntimeValidation(_) => ("runtime", "runtime_validation", "error"),
            Self::OofValidation(_) => ("validation", "oof_validation", "error"),
            Self::OofLeakage(_) => ("validation", "oof_leakage", "error"),
            Self::Serialization(_) => ("compatibility", "serialization_error", "error"),
        }
    }

    /// Stable `(category_id, code_id)` pair backing [`error_code`](Self::error_code).
    ///
    /// Category ids follow ADR-11: validation=0, runtime=1, data=2, controller=3,
    /// bundle=4, lineage=5, replay=6, security=7, compatibility=8, internal=9.
    /// Code ids are **1-based** so a packed `error_code()` is never `0` — `0` is
    /// reserved as the "no error" sentinel for `dagml_last_error_code()`. Code ids
    /// are stable within their category; never renumber a shipped pair.
    fn numeric_taxonomy(&self) -> (u16, u16) {
        match self {
            Self::InvalidIdentifier { .. } => (0, 1),
            Self::GraphValidation(_) => (0, 2),
            Self::CampaignValidation(_) => (0, 3),
            Self::OofValidation(_) => (0, 4),
            Self::OofLeakage(_) => (0, 5),
            Self::ControllerValidation(_) => (3, 1),
            Self::Planning(_) => (1, 1),
            Self::RuntimeValidation(_) => (1, 2),
            Self::Serialization(_) => (8, 1),
        }
    }
}

pub type Result<T> = std::result::Result<T, DagMlError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_identifier_descriptor_carries_taxonomy_and_context() {
        let error = DagMlError::InvalidIdentifier {
            value: "".to_string(),
            reason: "empty",
        };

        let descriptor = error.descriptor();

        assert_eq!(descriptor.category, "validation");
        assert_eq!(descriptor.code, "invalid_identifier");
        assert_eq!(descriptor.severity, "error");
        assert_eq!(descriptor.context["value"], json!(""));
        assert_eq!(descriptor.context["reason"], json!("empty"));
        assert!(descriptor.remediation_hint.contains("identifier"));
    }

    #[test]
    fn oof_leakage_descriptor_preserves_report_context() {
        let error = DagMlError::OofLeakage(Box::new(OofLeakageReport {
            node_id: "node:model".to_string(),
            violators: vec![OofLeakageViolation {
                producer_node: "node:prep".to_string(),
                partition: "train".to_string(),
                fold_id: Some("fold:0".to_string()),
            }],
            allow_train_predictions_as_features: false,
            remediation: "Use validation-only OOF predictions.".to_string(),
        }));

        let descriptor = error.descriptor();

        assert_eq!(descriptor.category, "validation");
        assert_eq!(descriptor.code, "oof_leakage");
        assert_eq!(
            descriptor.remediation_hint,
            "Use validation-only OOF predictions."
        );
        assert_eq!(descriptor.context["node_id"], json!("node:model"));
        assert_eq!(descriptor.context["violator_count"], json!(1));
        assert_eq!(
            descriptor.context["allow_train_predictions_as_features"],
            json!(false)
        );
    }

    #[test]
    fn error_code_packs_category_and_code() {
        // Code ids are 1-based so no real error packs to the 0 "no error" sentinel.
        assert_eq!(
            DagMlError::InvalidIdentifier {
                value: "x".to_string(),
                reason: "bad",
            }
            .error_code(),
            0x0000_0001
        );
        assert!(
            DagMlError::InvalidIdentifier {
                value: "x".to_string(),
                reason: "bad",
            }
            .error_code()
                != 0
        );
        // validation (0) / graph_validation (2) -> 0x0000_0002
        assert_eq!(
            DagMlError::GraphValidation("x".to_string()).error_code(),
            0x0000_0002
        );
        // controller (3) / controller_validation (1) -> 0x0003_0001
        assert_eq!(
            DagMlError::ControllerValidation("x".to_string()).error_code(),
            0x0003_0001
        );
        // runtime (1) / runtime_validation (2) -> 0x0001_0002
        assert_eq!(
            DagMlError::RuntimeValidation("x".to_string()).error_code(),
            0x0001_0002
        );
        // compatibility (8) / serialization_error (1) -> 0x0008_0001
        let serde_error = serde_json::from_str::<Value>("{").expect_err("invalid JSON");
        assert_eq!(
            DagMlError::Serialization(serde_error).error_code(),
            0x0008_0001
        );
    }

    #[test]
    fn descriptor_json_is_stable_json_payload() {
        let serde_error = serde_json::from_str::<Value>("{").expect_err("invalid JSON");
        let error = DagMlError::Serialization(serde_error);

        let payload = error.descriptor_json().expect("descriptor JSON");
        let parsed = serde_json::from_str::<Value>(&payload).expect("parse descriptor");

        assert_eq!(parsed["category"], json!("compatibility"));
        assert_eq!(parsed["code"], json!("serialization_error"));
        assert!(parsed["message"]
            .as_str()
            .expect("message")
            .contains("serialization error"));
        assert!(parsed["remediation_hint"]
            .as_str()
            .expect("hint")
            .contains("contract version"));
    }
}

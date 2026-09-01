// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! The confidence-scored `DatasetPlan` (ports `infer/plan.py`).
//!
//! Scores are scores, not calibrated probabilities (uncalibrated, C5). Every
//! decision carries an evidence trace; close calls are marked `ambiguous`. The
//! facade `infer()` populates this; `to_value` is on the byte-golden path.

use serde_json::{Map, Value};

use crate::pyfmt::py_round;
use crate::spec::DatasetSpec;

#[derive(Debug, Clone, Default)]
pub struct Decision {
    pub value: Value,
    pub score: f64,
    pub evidence: Vec<String>,
    pub alternatives: Vec<Value>,
    pub ambiguous: bool,
}

impl Decision {
    pub fn new(value: impl Into<Value>, score: f64, evidence: Vec<String>) -> Self {
        Self {
            value: value.into(),
            score,
            evidence,
            alternatives: vec![],
            ambiguous: false,
        }
    }

    pub fn to_value(&self) -> Value {
        serde_json::json!({
            "value": self.value,
            "score": py_round(self.score, 3),
            "evidence": self.evidence,
            "alternatives": self.alternatives,
            "ambiguous": self.ambiguous,
        })
    }
}

#[derive(Debug, Clone)]
pub struct DatasetPlan {
    pub input: Value,
    pub structure: Option<Decision>,
    pub assignments: Vec<Value>,
    pub columns: Vec<Value>,
    pub params: Value,
    pub axis: Option<Value>,
    pub identity: Option<Decision>,
    pub alignment: Vec<Value>,
    pub signal_type: Option<Decision>,
    pub task_type: Option<Decision>,
    pub warnings: Vec<String>,
    pub recommendations: Vec<String>,
    pub dropped_rows: Vec<Value>,
    pub resolved_spec: Option<DatasetSpec>,
    pub overall_score: f64,
    pub calibration: Value,
}

impl Default for DatasetPlan {
    fn default() -> Self {
        Self {
            input: Value::Object(Map::new()),
            structure: None,
            assignments: vec![],
            columns: vec![],
            params: Value::Object(Map::new()),
            axis: None,
            identity: None,
            alignment: vec![],
            signal_type: None,
            task_type: None,
            warnings: vec![],
            recommendations: vec![],
            dropped_rows: vec![],
            resolved_spec: None,
            overall_score: 0.0,
            calibration: serde_json::json!({
                "method": "none",
                "note": "scores are uncalibrated (C5)"
            }),
        }
    }
}

impl DatasetPlan {
    pub fn to_value(&self) -> Value {
        let dec = |d: &Option<Decision>| d.as_ref().map(Decision::to_value).unwrap_or(Value::Null);
        serde_json::json!({
            "input": self.input,
            "structure": dec(&self.structure),
            "assignments": self.assignments,
            "columns": self.columns,
            "params": self.params,
            "axis": self.axis.clone().unwrap_or(Value::Null),
            "identity": dec(&self.identity),
            "alignment": self.alignment,
            "signal_type": dec(&self.signal_type),
            "task_type": dec(&self.task_type),
            "warnings": self.warnings,
            "recommendations": self.recommendations,
            "dropped_rows": self.dropped_rows,
            "resolved_spec": self.resolved_spec.as_ref().map(|s| s.to_value()).unwrap_or(Value::Null),
            "overall_score": py_round(self.overall_score, 3),
            "calibration": self.calibration,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::canonical_json::canonical_json;

    #[test]
    fn decision_rounds_score() {
        let d = Decision::new("absorbance", 0.857142857, vec!["x".into()]);
        let v = d.to_value();
        assert_eq!(v["score"], serde_json::json!(0.857));
        assert_eq!(v["ambiguous"], serde_json::json!(false));
    }

    #[test]
    fn empty_plan_has_all_keys() {
        let plan = DatasetPlan::default();
        let canon = canonical_json(&plan.to_value()).unwrap();
        for key in [
            "alignment",
            "assignments",
            "axis",
            "calibration",
            "columns",
            "dropped_rows",
            "identity",
            "input",
            "overall_score",
            "params",
            "recommendations",
            "resolved_spec",
            "signal_type",
            "structure",
            "task_type",
            "warnings",
        ] {
            assert!(canon.contains(&format!("\"{key}\"")), "missing {key}");
        }
    }
}

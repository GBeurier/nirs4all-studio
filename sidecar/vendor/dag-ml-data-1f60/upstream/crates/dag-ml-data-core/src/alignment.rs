use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::error::{DataError, Result};
use crate::ids::{SampleId, SourceId};
use crate::model::PresenceMask;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AlignmentMode {
    #[default]
    Inner,
    Left,
    Outer,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AlignmentPolicy {
    pub mode: AlignmentMode,
}

impl Default for AlignmentPolicy {
    fn default() -> Self {
        Self {
            mode: AlignmentMode::Inner,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct SourceSampleSet {
    pub source_id: SourceId,
    pub sample_ids: Vec<SampleId>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct SampleAlignmentPlan {
    pub mode: AlignmentMode,
    pub sample_ids: Vec<SampleId>,
    pub masks: Vec<PresenceMask>,
}

impl SampleAlignmentPlan {
    pub fn validate(&self) -> Result<()> {
        if self.sample_ids.is_empty() {
            return Err(DataError::Validation(
                "alignment plan contains no samples".to_string(),
            ));
        }
        let mut samples = BTreeSet::new();
        for sample_id in &self.sample_ids {
            if !samples.insert(sample_id) {
                return Err(DataError::Validation(format!(
                    "alignment plan contains duplicate sample `{sample_id}`"
                )));
            }
        }
        if self.masks.is_empty() {
            return Err(DataError::Validation(
                "alignment plan contains no presence masks".to_string(),
            ));
        }
        let mut sources = BTreeSet::new();
        for mask in &self.masks {
            mask.validate()?;
            if mask.sample_ids != self.sample_ids {
                return Err(DataError::Validation(format!(
                    "presence mask for `{}` does not use alignment sample order",
                    mask.source_id
                )));
            }
            if !sources.insert(&mask.source_id) {
                return Err(DataError::Validation(format!(
                    "alignment plan contains duplicate source mask `{}`",
                    mask.source_id
                )));
            }
        }
        Ok(())
    }
}

pub fn build_sample_alignment_plan(
    sources: &[SourceSampleSet],
    policy: &AlignmentPolicy,
) -> Result<SampleAlignmentPlan> {
    if sources.is_empty() {
        return Err(DataError::Validation(
            "alignment requires at least one source".to_string(),
        ));
    }
    let mut source_ids = BTreeSet::new();
    let mut samples_by_source = Vec::with_capacity(sources.len());
    for source in sources {
        if !source_ids.insert(&source.source_id) {
            return Err(DataError::Validation(format!(
                "alignment contains duplicate source `{}`",
                source.source_id
            )));
        }
        if source.sample_ids.is_empty() {
            return Err(DataError::Validation(format!(
                "alignment source `{}` contains no samples",
                source.source_id
            )));
        }
        let mut samples = BTreeSet::new();
        for sample_id in &source.sample_ids {
            if !samples.insert(sample_id) {
                return Err(DataError::Validation(format!(
                    "alignment source `{}` contains duplicate sample `{sample_id}`",
                    source.source_id
                )));
            }
        }
        samples_by_source.push(samples);
    }

    let sample_ids = match policy.mode {
        AlignmentMode::Inner => sources[0]
            .sample_ids
            .iter()
            .filter(|sample_id| {
                samples_by_source
                    .iter()
                    .all(|samples| samples.contains(*sample_id))
            })
            .cloned()
            .collect::<Vec<_>>(),
        AlignmentMode::Left => sources[0].sample_ids.clone(),
        AlignmentMode::Outer => {
            let mut seen = BTreeSet::new();
            let mut ordered = Vec::new();
            for source in sources {
                for sample_id in &source.sample_ids {
                    if seen.insert(sample_id) {
                        ordered.push(sample_id.clone());
                    }
                }
            }
            ordered
        }
    };

    if sample_ids.is_empty() {
        return Err(DataError::Validation(format!(
            "{:?} alignment produced no shared samples",
            policy.mode
        )));
    }

    let masks = sources
        .iter()
        .zip(samples_by_source.iter())
        .map(|(source, samples)| PresenceMask {
            sample_ids: sample_ids.clone(),
            source_id: source.source_id.clone(),
            present: sample_ids
                .iter()
                .map(|sample_id| samples.contains(sample_id))
                .collect(),
        })
        .collect::<Vec<_>>();
    let plan = SampleAlignmentPlan {
        mode: policy.mode,
        sample_ids,
        masks,
    };
    plan.validate()?;
    Ok(plan)
}

pub fn alignment_mode_from_fusion(value: Option<&serde_json::Value>) -> Result<AlignmentMode> {
    let Some(value) = value else {
        return Ok(AlignmentMode::Inner);
    };
    let Some(mode) = value.get("alignment") else {
        return Ok(AlignmentMode::Inner);
    };
    serde_json::from_value(mode.clone())
        .map_err(|error| DataError::Validation(format!("invalid fusion alignment policy: {error}")))
}

pub fn alignment_metadata(
    inputs: Vec<String>,
    output: String,
    mode: AlignmentMode,
) -> Result<BTreeMap<String, serde_json::Value>> {
    Ok(BTreeMap::from([
        (
            "inputs".to_string(),
            serde_json::Value::Array(inputs.into_iter().map(serde_json::Value::String).collect()),
        ),
        ("output".to_string(), serde_json::Value::String(output)),
        ("alignment".to_string(), serde_json::to_value(mode)?),
    ]))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source(source_id: &str, sample_ids: &[&str]) -> SourceSampleSet {
        SourceSampleSet {
            source_id: SourceId::new(source_id).unwrap(),
            sample_ids: sample_ids
                .iter()
                .map(|sample_id| SampleId::new(*sample_id).unwrap())
                .collect(),
        }
    }

    fn samples(plan: &SampleAlignmentPlan) -> Vec<String> {
        plan.sample_ids.iter().map(ToString::to_string).collect()
    }

    #[test]
    fn inner_alignment_keeps_first_source_order_for_shared_samples() {
        let plan = build_sample_alignment_plan(
            &[
                source("nir", &["S002", "S001", "S003"]),
                source("chem", &["S001", "S003"]),
            ],
            &AlignmentPolicy {
                mode: AlignmentMode::Inner,
            },
        )
        .unwrap();

        assert_eq!(samples(&plan), vec!["S001", "S003"]);
        assert_eq!(plan.masks[0].present, vec![true, true]);
        assert_eq!(plan.masks[1].present, vec![true, true]);
    }

    #[test]
    fn left_alignment_preserves_left_samples_and_marks_missing_sources() {
        let plan = build_sample_alignment_plan(
            &[
                source("nir", &["S002", "S001", "S003"]),
                source("chem", &["S001", "S003"]),
            ],
            &AlignmentPolicy {
                mode: AlignmentMode::Left,
            },
        )
        .unwrap();

        assert_eq!(samples(&plan), vec!["S002", "S001", "S003"]);
        assert_eq!(plan.masks[0].present, vec![true, true, true]);
        assert_eq!(plan.masks[1].present, vec![false, true, true]);
    }

    #[test]
    fn outer_alignment_appends_new_samples_in_source_order() {
        let plan = build_sample_alignment_plan(
            &[
                source("nir", &["S002", "S001"]),
                source("chem", &["S003", "S001"]),
                source("image", &["S004", "S002"]),
            ],
            &AlignmentPolicy {
                mode: AlignmentMode::Outer,
            },
        )
        .unwrap();

        assert_eq!(samples(&plan), vec!["S002", "S001", "S003", "S004"]);
        assert_eq!(plan.masks[0].present, vec![true, true, false, false]);
        assert_eq!(plan.masks[1].present, vec![false, true, true, false]);
        assert_eq!(plan.masks[2].present, vec![true, false, false, true]);
    }

    #[test]
    fn alignment_refuses_duplicate_samples_per_source() {
        let err = build_sample_alignment_plan(
            &[source("nir", &["S001", "S001"])],
            &AlignmentPolicy::default(),
        )
        .unwrap_err();

        assert!(err.to_string().contains("duplicate sample"));
    }
}

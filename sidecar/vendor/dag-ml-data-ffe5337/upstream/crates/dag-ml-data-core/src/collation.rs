use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use crate::error::{DataError, Result};
use crate::handle::CoordinatorFeatureBlock;
use crate::ids::{ObservationId, RepresentationId, SampleId};

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CollationPadding {
    #[default]
    None,
    Right,
    Left,
    Center,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CollationPolicy {
    #[serde(default)]
    pub padding: CollationPadding,
    #[serde(default)]
    pub truncate: bool,
    #[serde(default)]
    pub batch_container: Option<String>,
    #[serde(default = "default_true")]
    pub emit_mask: bool,
    #[serde(default)]
    pub max_length: Option<usize>,
    #[serde(default)]
    pub pad_value: f64,
}

impl Default for CollationPolicy {
    fn default() -> Self {
        Self {
            padding: CollationPadding::None,
            truncate: false,
            batch_container: None,
            emit_mask: true,
            max_length: None,
            pad_value: 0.0,
        }
    }
}

fn default_true() -> bool {
    true
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NumericCollationInputBlock {
    pub block_id: String,
    pub representation_id: RepresentationId,
    pub observation_ids: Vec<ObservationId>,
    pub sample_ids: Vec<SampleId>,
    pub rows: Vec<Vec<Option<f64>>>,
    #[serde(default)]
    pub feature_names: Option<Vec<String>>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NumericTensorBlock {
    pub block_id: String,
    pub representation_id: RepresentationId,
    pub batch_container: String,
    pub observation_ids: Vec<ObservationId>,
    pub sample_ids: Vec<SampleId>,
    pub shape: Vec<usize>,
    pub values: Vec<f64>,
    #[serde(default)]
    pub presence_mask: Option<Vec<bool>>,
    #[serde(default)]
    pub validity_mask: Option<Vec<bool>>,
    #[serde(default)]
    pub feature_names: Option<Vec<String>>,
}

pub fn numeric_input_from_feature_block(
    block: &CoordinatorFeatureBlock,
) -> Result<NumericCollationInputBlock> {
    validate_feature_block_shape(block)?;
    let rows = block
        .values
        .iter()
        .enumerate()
        .map(|(row_idx, row)| {
            row.iter()
                .enumerate()
                .map(|(feature_idx, value)| match value {
                    serde_json::Value::Null => Ok(None),
                    serde_json::Value::Number(number) => number.as_f64().map(Some).ok_or_else(|| {
                        DataError::Validation(format!(
                            "feature block `{}` row `{}` feature `{}` contains a non-f64 numeric value",
                            block.feature_set_id,
                            block.observation_ids[row_idx],
                            block.feature_names[feature_idx]
                        ))
                    }),
                    _ => Err(DataError::Validation(format!(
                        "feature block `{}` row `{}` feature `{}` must be numeric or null for collation",
                        block.feature_set_id,
                        block.observation_ids[row_idx],
                        block.feature_names[feature_idx]
                    ))),
                })
                .collect::<Result<Vec<_>>>()
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(NumericCollationInputBlock {
        block_id: block.feature_set_id.clone(),
        representation_id: block.representation_id.clone(),
        observation_ids: block.observation_ids.clone(),
        sample_ids: block.sample_ids.clone(),
        rows,
        feature_names: Some(block.feature_names.clone()),
    })
}

pub fn collate_feature_block(
    block: &CoordinatorFeatureBlock,
    policy: &CollationPolicy,
) -> Result<NumericTensorBlock> {
    let input = numeric_input_from_feature_block(block)?;
    collate_numeric_block(&input, policy)
}

pub fn collate_numeric_block(
    block: &NumericCollationInputBlock,
    policy: &CollationPolicy,
) -> Result<NumericTensorBlock> {
    validate_numeric_input_block(block)?;
    validate_collation_policy(policy)?;
    let target_len = target_length(block, policy)?;
    validate_feature_names_for_collation(block, policy, target_len)?;

    let batch = block.rows.len();
    let mut values = Vec::with_capacity(batch * target_len);
    let mut presence = Vec::with_capacity(batch * target_len);
    let mut validity = Vec::with_capacity(batch * target_len);
    let mut has_invalid = false;
    for row in &block.rows {
        let projected = project_row(row, target_len, policy)?;
        values.extend(
            projected
                .values
                .iter()
                .map(|value| value.unwrap_or(policy.pad_value)),
        );
        presence.extend(projected.presence.iter().copied());
        for (value, present) in projected.values.iter().zip(projected.presence.iter()) {
            let valid = *present && value.is_some();
            has_invalid |= !valid;
            validity.push(valid);
        }
    }

    Ok(NumericTensorBlock {
        block_id: block.block_id.clone(),
        representation_id: block.representation_id.clone(),
        batch_container: policy
            .batch_container
            .clone()
            .unwrap_or_else(|| "ndarray".to_string()),
        observation_ids: block.observation_ids.clone(),
        sample_ids: block.sample_ids.clone(),
        shape: vec![batch, target_len],
        values,
        presence_mask: policy.emit_mask.then_some(presence),
        validity_mask: has_invalid.then_some(validity),
        feature_names: projected_feature_names(block.feature_names.as_deref(), target_len, policy)?,
    })
}

struct ProjectedRow {
    values: Vec<Option<f64>>,
    presence: Vec<bool>,
}

fn validate_collation_policy(policy: &CollationPolicy) -> Result<()> {
    if policy.max_length == Some(0) {
        return Err(DataError::Validation(
            "collation max_length must be greater than zero".to_string(),
        ));
    }
    if let Some(container) = &policy.batch_container {
        if container.trim().is_empty() {
            return Err(DataError::Validation(
                "collation batch_container must not be empty".to_string(),
            ));
        }
    }
    if !policy.pad_value.is_finite() {
        return Err(DataError::Validation(
            "collation pad_value must be finite".to_string(),
        ));
    }
    Ok(())
}

fn validate_numeric_input_block(block: &NumericCollationInputBlock) -> Result<()> {
    if block.block_id.trim().is_empty() {
        return Err(DataError::Validation(
            "collation input block_id is empty".to_string(),
        ));
    }
    if block.observation_ids.is_empty() {
        return Err(DataError::Validation(format!(
            "collation input block `{}` contains no rows",
            block.block_id
        )));
    }
    if block.observation_ids.len() != block.sample_ids.len()
        || block.sample_ids.len() != block.rows.len()
    {
        return Err(DataError::Validation(format!(
            "collation input block `{}` row identity/value lengths differ",
            block.block_id
        )));
    }
    let mut observations = BTreeSet::new();
    for (idx, row) in block.rows.iter().enumerate() {
        if !observations.insert(&block.observation_ids[idx]) {
            return Err(DataError::Validation(format!(
                "collation input block `{}` contains duplicate observation `{}`",
                block.block_id, block.observation_ids[idx]
            )));
        }
        if row.is_empty() {
            return Err(DataError::Validation(format!(
                "collation input block `{}` row `{}` is empty",
                block.block_id, block.observation_ids[idx]
            )));
        }
        for value in row.iter().flatten() {
            if !value.is_finite() {
                return Err(DataError::Validation(format!(
                    "collation input block `{}` row `{}` contains a non-finite value",
                    block.block_id, block.observation_ids[idx]
                )));
            }
        }
    }
    if let Some(feature_names) = &block.feature_names {
        if feature_names.is_empty() {
            return Err(DataError::Validation(format!(
                "collation input block `{}` has empty feature_names",
                block.block_id
            )));
        }
        if feature_names.iter().any(|name| name.trim().is_empty()) {
            return Err(DataError::Validation(format!(
                "collation input block `{}` has an empty feature name",
                block.block_id
            )));
        }
        let mut names = BTreeSet::new();
        for name in feature_names {
            if !names.insert(name) {
                return Err(DataError::Validation(format!(
                    "collation input block `{}` has duplicate feature `{name}`",
                    block.block_id
                )));
            }
        }
    }
    Ok(())
}

fn validate_feature_block_shape(block: &CoordinatorFeatureBlock) -> Result<()> {
    if block.feature_set_id.trim().is_empty() {
        return Err(DataError::Validation(
            "feature block feature_set_id is empty".to_string(),
        ));
    }
    if block.feature_names.is_empty() {
        return Err(DataError::Validation(format!(
            "feature block `{}` contains no features",
            block.feature_set_id
        )));
    }
    if block.observation_ids.len() != block.sample_ids.len()
        || block.sample_ids.len() != block.values.len()
    {
        return Err(DataError::Validation(format!(
            "feature block `{}` row identity/value lengths differ",
            block.feature_set_id
        )));
    }
    for (idx, row) in block.values.iter().enumerate() {
        if row.len() != block.feature_names.len() {
            return Err(DataError::Validation(format!(
                "feature block `{}` row `{}` has {} values for {} features",
                block.feature_set_id,
                block.observation_ids[idx],
                row.len(),
                block.feature_names.len()
            )));
        }
    }
    Ok(())
}

fn validate_feature_names_for_collation(
    block: &NumericCollationInputBlock,
    policy: &CollationPolicy,
    target_len: usize,
) -> Result<()> {
    let Some(feature_names) = &block.feature_names else {
        return Ok(());
    };
    for row in &block.rows {
        if row.len() != feature_names.len() {
            return Err(DataError::Validation(format!(
                "collation input block `{}` named features require rectangular rows",
                block.block_id
            )));
        }
    }
    if target_len > feature_names.len() {
        return Err(DataError::Validation(format!(
            "collation input block `{}` cannot pad named feature rows",
            block.block_id
        )));
    }
    if target_len < feature_names.len() && !policy.truncate {
        return Err(DataError::Validation(format!(
            "collation input block `{}` feature names require truncation for max_length",
            block.block_id
        )));
    }
    Ok(())
}

fn target_length(block: &NumericCollationInputBlock, policy: &CollationPolicy) -> Result<usize> {
    let max_observed = block.rows.iter().map(Vec::len).max().unwrap_or(0);
    let target = policy.max_length.unwrap_or(max_observed);
    if target == 0 {
        return Err(DataError::Validation(format!(
            "collation input block `{}` produced an empty target length",
            block.block_id
        )));
    }
    if !policy.truncate && block.rows.iter().any(|row| row.len() > target) {
        return Err(DataError::Validation(format!(
            "collation input block `{}` has rows longer than max_length without truncate",
            block.block_id
        )));
    }
    if policy.padding == CollationPadding::None && block.rows.iter().any(|row| row.len() < target) {
        return Err(DataError::Validation(format!(
            "collation input block `{}` has ragged rows but padding is none",
            block.block_id
        )));
    }
    Ok(target)
}

fn project_row(
    row: &[Option<f64>],
    target_len: usize,
    policy: &CollationPolicy,
) -> Result<ProjectedRow> {
    let truncated = if row.len() > target_len {
        if !policy.truncate {
            return Err(DataError::Validation(
                "collation row is longer than target length without truncate".to_string(),
            ));
        }
        let start = truncate_start(row.len(), target_len, policy.padding);
        row[start..start + target_len].to_vec()
    } else {
        row.to_vec()
    };

    if truncated.len() == target_len {
        return Ok(ProjectedRow {
            presence: vec![true; target_len],
            values: truncated,
        });
    }
    if policy.padding == CollationPadding::None {
        return Err(DataError::Validation(
            "collation row is shorter than target length but padding is none".to_string(),
        ));
    }

    let missing = target_len - truncated.len();
    let (left_pad, right_pad) = match policy.padding {
        CollationPadding::None => unreachable!("padding none handled above"),
        CollationPadding::Right => (0, missing),
        CollationPadding::Left => (missing, 0),
        CollationPadding::Center => (missing / 2, missing - (missing / 2)),
    };
    let mut values = Vec::with_capacity(target_len);
    let mut presence = Vec::with_capacity(target_len);
    values.extend(std::iter::repeat_n(None, left_pad));
    presence.extend(std::iter::repeat_n(false, left_pad));
    values.extend(truncated);
    presence.extend(std::iter::repeat_n(true, target_len - left_pad - right_pad));
    values.extend(std::iter::repeat_n(None, right_pad));
    presence.extend(std::iter::repeat_n(false, right_pad));
    Ok(ProjectedRow { values, presence })
}

fn truncate_start(row_len: usize, target_len: usize, padding: CollationPadding) -> usize {
    match padding {
        CollationPadding::Left => row_len - target_len,
        CollationPadding::Center => (row_len - target_len) / 2,
        CollationPadding::None | CollationPadding::Right => 0,
    }
}

fn projected_feature_names(
    feature_names: Option<&[String]>,
    target_len: usize,
    policy: &CollationPolicy,
) -> Result<Option<Vec<String>>> {
    let Some(feature_names) = feature_names else {
        return Ok(None);
    };
    if target_len == feature_names.len() {
        return Ok(Some(feature_names.to_vec()));
    }
    if target_len > feature_names.len() {
        return Err(DataError::Validation(
            "named feature collation cannot add padded feature names".to_string(),
        ));
    }
    let start = truncate_start(feature_names.len(), target_len, policy.padding);
    Ok(Some(feature_names[start..start + target_len].to_vec()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ids::RepresentationId;
    use serde_json::json;

    fn obs(value: &str) -> ObservationId {
        ObservationId::new(value).unwrap()
    }

    fn sample(value: &str) -> SampleId {
        SampleId::new(value).unwrap()
    }

    fn feature_block() -> CoordinatorFeatureBlock {
        CoordinatorFeatureBlock {
            feature_set_id: "x".to_string(),
            representation_id: RepresentationId::new("tabular_numeric").unwrap(),
            feature_names: vec!["f0".to_string(), "f1".to_string()],
            observation_ids: vec![obs("obs.S001"), obs("obs.S002")],
            sample_ids: vec![sample("S001"), sample("S002")],
            values: vec![vec![json!(1.0), json!(2.0)], vec![json!(3.0), json!(4.0)]],
        }
    }

    #[test]
    fn collates_rectangular_feature_block_to_row_major_tensor() {
        let tensor = collate_feature_block(
            &feature_block(),
            &CollationPolicy {
                emit_mask: false,
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(tensor.shape, vec![2, 2]);
        assert_eq!(tensor.values, vec![1.0, 2.0, 3.0, 4.0]);
        assert_eq!(tensor.presence_mask, None);
        assert_eq!(tensor.validity_mask, None);
        assert_eq!(
            tensor.feature_names,
            Some(vec!["f0".to_string(), "f1".to_string()])
        );
    }

    #[test]
    fn right_padding_emits_presence_and_validity_masks() {
        let block = NumericCollationInputBlock {
            block_id: "seq".to_string(),
            representation_id: RepresentationId::new("sequence_tensor").unwrap(),
            observation_ids: vec![obs("obs.S001"), obs("obs.S002")],
            sample_ids: vec![sample("S001"), sample("S002")],
            rows: vec![vec![Some(1.0), Some(2.0)], vec![Some(3.0), None]],
            feature_names: None,
        };
        let tensor = collate_numeric_block(
            &block,
            &CollationPolicy {
                padding: CollationPadding::Right,
                max_length: Some(3),
                pad_value: -1.0,
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(tensor.shape, vec![2, 3]);
        assert_eq!(tensor.values, vec![1.0, 2.0, -1.0, 3.0, -1.0, -1.0]);
        assert_eq!(
            tensor.presence_mask,
            Some(vec![true, true, false, true, true, false])
        );
        assert_eq!(
            tensor.validity_mask,
            Some(vec![true, true, false, true, false, false])
        );
    }

    #[test]
    fn no_padding_refuses_ragged_rows() {
        let block = NumericCollationInputBlock {
            block_id: "seq".to_string(),
            representation_id: RepresentationId::new("sequence_tensor").unwrap(),
            observation_ids: vec![obs("obs.S001"), obs("obs.S002")],
            sample_ids: vec![sample("S001"), sample("S002")],
            rows: vec![vec![Some(1.0), Some(2.0)], vec![Some(3.0)]],
            feature_names: None,
        };

        let err = collate_numeric_block(&block, &CollationPolicy::default()).unwrap_err();

        assert!(err.to_string().contains("ragged rows"));
    }

    #[test]
    fn left_truncation_keeps_suffix_and_projects_feature_names() {
        let tensor = collate_feature_block(
            &feature_block(),
            &CollationPolicy {
                padding: CollationPadding::Left,
                truncate: true,
                max_length: Some(1),
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(tensor.shape, vec![2, 1]);
        assert_eq!(tensor.values, vec![2.0, 4.0]);
        assert_eq!(tensor.feature_names, Some(vec!["f1".to_string()]));
    }

    #[test]
    fn collation_refuses_non_numeric_feature_values() {
        let mut block = feature_block();
        block.values[0][0] = json!("bad");

        let err = collate_feature_block(&block, &CollationPolicy::default()).unwrap_err();

        assert!(err.to_string().contains("must be numeric or null"));
    }
}

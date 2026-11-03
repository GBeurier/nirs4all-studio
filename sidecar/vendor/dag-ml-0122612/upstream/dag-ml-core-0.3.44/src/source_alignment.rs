//! Identity-only alignment for independently ordered named source views.
//!
//! The core returns row indices. Feature buffers and fitted operators remain
//! host-owned; every binding can apply the same validated permutation.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::error::{DagMlError, Result};
use crate::ids::SampleId;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NamedSourceSampleOrder {
    pub source_id: String,
    pub sample_ids: Vec<SampleId>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NamedSourceAlignmentRequest {
    pub sample_ids: Vec<SampleId>,
    pub required_source_ids: Vec<String>,
    pub sources: Vec<NamedSourceSampleOrder>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NamedSourceRowSelection {
    pub source_id: String,
    pub row_indices: Vec<usize>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NamedSourceAlignment {
    pub sample_ids: Vec<SampleId>,
    pub sources: Vec<NamedSourceRowSelection>,
}

/// Validate exact source/sample coverage and plan one row permutation per source.
pub fn align_named_source_rows(
    request: &NamedSourceAlignmentRequest,
) -> Result<NamedSourceAlignment> {
    if request.sample_ids.is_empty()
        || request.sample_ids.iter().collect::<BTreeSet<_>>().len() != request.sample_ids.len()
    {
        return Err(DagMlError::RuntimeValidation(
            "named-source alignment requires nonempty unique requested sample IDs".to_string(),
        ));
    }
    if request.required_source_ids.is_empty()
        || request
            .required_source_ids
            .iter()
            .any(|id| id.trim().is_empty())
        || request
            .required_source_ids
            .iter()
            .collect::<BTreeSet<_>>()
            .len()
            != request.required_source_ids.len()
    {
        return Err(DagMlError::RuntimeValidation(
            "named-source alignment requires nonempty unique source IDs".to_string(),
        ));
    }
    let mut supplied = BTreeMap::new();
    for source in &request.sources {
        if source.source_id.trim().is_empty()
            || supplied
                .insert(source.source_id.as_str(), &source.sample_ids)
                .is_some()
        {
            return Err(DagMlError::RuntimeValidation(
                "named-source alignment has an empty or duplicate source ID".to_string(),
            ));
        }
    }
    if supplied.keys().copied().collect::<BTreeSet<_>>()
        != request
            .required_source_ids
            .iter()
            .map(String::as_str)
            .collect()
    {
        return Err(DagMlError::RuntimeValidation(
            "named-source alignment source set differs from required sources".to_string(),
        ));
    }
    let requested = request.sample_ids.iter().collect::<BTreeSet<_>>();
    let mut selections = Vec::with_capacity(request.required_source_ids.len());
    for source_id in &request.required_source_ids {
        let sample_ids = supplied[source_id.as_str()];
        let mut positions = BTreeMap::new();
        for (index, sample_id) in sample_ids.iter().enumerate() {
            if positions.insert(sample_id, index).is_some() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "named source `{source_id}` has duplicate sample IDs"
                )));
            }
        }
        if positions.keys().copied().collect::<BTreeSet<_>>() != requested {
            return Err(DagMlError::RuntimeValidation(format!(
                "named source `{source_id}` sample IDs differ from requested samples"
            )));
        }
        selections.push(NamedSourceRowSelection {
            source_id: source_id.clone(),
            row_indices: request.sample_ids.iter().map(|id| positions[id]).collect(),
        });
    }
    Ok(NamedSourceAlignment {
        sample_ids: request.sample_ids.clone(),
        sources: selections,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(value: &str) -> SampleId {
        SampleId::new(value).unwrap()
    }

    fn request() -> NamedSourceAlignmentRequest {
        NamedSourceAlignmentRequest {
            sample_ids: vec![id("s1"), id("s2")],
            required_source_ids: vec!["source_0".to_string(), "source_1".to_string()],
            sources: vec![
                NamedSourceSampleOrder {
                    source_id: "source_1".to_string(),
                    sample_ids: vec![id("s1"), id("s2")],
                },
                NamedSourceSampleOrder {
                    source_id: "source_0".to_string(),
                    sample_ids: vec![id("s2"), id("s1")],
                },
            ],
        }
    }

    #[test]
    fn aligns_named_sources_by_sample_id_and_required_source_order() {
        let aligned = align_named_source_rows(&request()).unwrap();
        assert_eq!(aligned.sources[0].source_id, "source_0");
        assert_eq!(aligned.sources[0].row_indices, [1, 0]);
        assert_eq!(aligned.sources[1].source_id, "source_1");
        assert_eq!(aligned.sources[1].row_indices, [0, 1]);
    }

    #[test]
    fn rejects_missing_extra_and_duplicate_sources_or_samples() {
        let mut invalid = request();
        invalid.sources.pop();
        assert!(align_named_source_rows(&invalid).is_err());
        let mut invalid = request();
        invalid.sources[0].source_id = "unknown".to_string();
        assert!(align_named_source_rows(&invalid).is_err());
        let mut invalid = request();
        invalid.sources[0].sample_ids = vec![id("s1"), id("s1")];
        assert!(align_named_source_rows(&invalid).is_err());
        let mut invalid = request();
        invalid.sources[0].sample_ids = vec![id("s1"), id("s3")];
        assert!(align_named_source_rows(&invalid).is_err());
        let mut invalid = request();
        invalid.sample_ids = vec![id("s1"), id("s1")];
        assert!(align_named_source_rows(&invalid).is_err());
    }
}

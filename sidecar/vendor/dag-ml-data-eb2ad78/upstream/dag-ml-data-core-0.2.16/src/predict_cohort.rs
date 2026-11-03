//! Shared V2 cohort identity. Phase scheduling and fitting policy belong to DAG.
use crate::coordinator::validate_fingerprint;
use crate::{CoordinatorRelationSet, DataError, Result, SampleId};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PredictCohortRole {
    ExternalTest,
    Inference,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PredictCohort {
    pub role: PredictCohortRole,
    pub physical_sample_ids: Vec<SampleId>,
    pub origin_sample_ids: Vec<SampleId>,
    pub target_names: Vec<String>,
    pub relation_fingerprint: String,
    pub relations: CoordinatorRelationSet,
    pub data_content_fingerprint: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_content_fingerprint: Option<String>,
    pub cohort_fingerprint: String,
}

#[derive(Serialize, Deserialize)]
struct FingerprintInput {
    role: PredictCohortRole,
    physical_sample_ids: Vec<SampleId>,
    origin_sample_ids: Vec<SampleId>,
    target_names: Vec<String>,
    relation_fingerprint: String,
    relations: CoordinatorRelationSet,
    data_content_fingerprint: String,
    target_content_fingerprint: Option<String>,
}

impl PredictCohort {
    pub fn from_relations(
        role: PredictCohortRole,
        relations: CoordinatorRelationSet,
        target_names: Vec<String>,
        data_content_fingerprint: String,
        target_content_fingerprint: Option<String>,
    ) -> Result<Self> {
        let mut cohort = Self {
            physical_sample_ids: relations
                .records
                .iter()
                .map(|row| row.sample_id.clone())
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect(),
            origin_sample_ids: relations
                .records
                .iter()
                .map(|row| {
                    row.origin_sample_id
                        .clone()
                        .unwrap_or_else(|| row.sample_id.clone())
                })
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect(),
            relation_fingerprint: relations.fingerprint()?,
            role,
            relations,
            target_names,
            data_content_fingerprint,
            target_content_fingerprint,
            cohort_fingerprint: String::new(),
        };
        cohort.cohort_fingerprint = cohort.fingerprint()?;
        Ok(cohort)
    }

    fn validate_members(&self) -> Result<()> {
        for (label, ids) in [
            ("physical", &self.physical_sample_ids),
            ("origin", &self.origin_sample_ids),
        ] {
            if ids.is_empty() || ids.windows(2).any(|pair| pair[0] >= pair[1]) {
                return Err(DataError::Validation(format!(
                    "predict cohort {label} IDs must be nonempty, sorted and unique"
                )));
            }
        }
        let targets = self.target_names.iter().collect::<BTreeSet<_>>();
        if targets.is_empty()
            || targets.len() != self.target_names.len()
            || self.target_names.iter().any(|name| name.trim().is_empty())
        {
            return Err(DataError::Validation(
                "predict cohort target names must be nonempty and unique".into(),
            ));
        }
        validate_fingerprint(
            "predict cohort data content",
            &self.data_content_fingerprint,
        )?;
        if let Some(target) = &self.target_content_fingerprint {
            validate_fingerprint("predict cohort target content", target)?;
        }
        if (self.role == PredictCohortRole::ExternalTest)
            != self.target_content_fingerprint.is_some()
        {
            return Err(DataError::Validation(
                "external_test requires target content; inference forbids it".into(),
            ));
        }
        self.relations.validate()?;
        if self.relation_fingerprint != self.relations.fingerprint()? {
            return Err(DataError::Validation(
                "predict cohort relation fingerprint does not match relations".into(),
            ));
        }
        let samples = self
            .relations
            .records
            .iter()
            .map(|row| &row.sample_id)
            .collect::<BTreeSet<_>>();
        let origins = self
            .relations
            .records
            .iter()
            .map(|row| row.origin_sample_id.as_ref().unwrap_or(&row.sample_id))
            .collect::<BTreeSet<_>>();
        if samples != self.physical_sample_ids.iter().collect()
            || origins != self.origin_sample_ids.iter().collect()
        {
            return Err(DataError::Validation(
                "predict cohort IDs do not cover exactly its relations".into(),
            ));
        }
        Ok(())
    }

    pub fn fingerprint(&self) -> Result<String> {
        self.validate_members()?;
        crate::fingerprint::typed_fingerprint(&FingerprintInput {
            role: self.role,
            physical_sample_ids: self.physical_sample_ids.clone(),
            origin_sample_ids: self.origin_sample_ids.clone(),
            target_names: self.target_names.clone(),
            relation_fingerprint: self.relation_fingerprint.clone(),
            relations: self.relations.clone(),
            data_content_fingerprint: self.data_content_fingerprint.clone(),
            target_content_fingerprint: self.target_content_fingerprint.clone(),
        })
    }

    pub fn validate(&self) -> Result<()> {
        validate_fingerprint("predict cohort", &self.cohort_fingerprint)?;
        if self.cohort_fingerprint != self.fingerprint()? {
            return Err(DataError::Validation(
                "predict cohort fingerprint does not match content".into(),
            ));
        }
        Ok(())
    }

    pub fn validate_disjoint(&self, training_relations: &CoordinatorRelationSet) -> Result<()> {
        self.validate()?;
        training_relations.validate()?;
        if self.role == PredictCohortRole::Inference {
            return Ok(());
        }
        let training = training_relations
            .records
            .iter()
            .flat_map(|row| std::iter::once(&row.sample_id).chain(row.origin_sample_id.as_ref()))
            .collect::<BTreeSet<_>>();
        if self
            .physical_sample_ids
            .iter()
            .chain(&self.origin_sample_ids)
            .any(|id| training.contains(id))
        {
            return Err(DataError::Validation(
                "external_test cohort overlaps training physical/origin identities".into(),
            ));
        }
        Ok(())
    }
}

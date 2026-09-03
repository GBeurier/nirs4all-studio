use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::coordinator::{
    parse_native_branch_view_filter, validate_fingerprint, CoordinatorDataPlanEnvelope,
    CoordinatorRelation, CoordinatorRelationSet,
};
use crate::error::{DataError, Result};
use crate::ids::{ObservationId, RepresentationId, SampleId, SourceId, TargetId};
use crate::model::DataView;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CoordinatorHandleKind {
    Data,
    View,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CoordinatorHandleRef {
    pub handle: u64,
    pub kind: CoordinatorHandleKind,
    pub owner_controller: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CoordinatorDataMaterializationRequest {
    pub run_id: String,
    pub node_id: String,
    pub input_name: String,
    pub phase: String,
    #[serde(default)]
    pub variant_id: Option<String>,
    #[serde(default)]
    pub fold_id: Option<String>,
    pub request_id: String,
    pub schema_fingerprint: String,
    pub plan_fingerprint: String,
    #[serde(default)]
    pub relation_fingerprint: Option<String>,
    pub output_representation: RepresentationId,
    #[serde(default)]
    pub source_ids: Vec<SourceId>,
    #[serde(default)]
    pub require_relations: bool,
}

impl CoordinatorDataMaterializationRequest {
    pub fn validate(&self) -> Result<()> {
        validate_non_empty("run_id", &self.run_id)?;
        validate_non_empty("node_id", &self.node_id)?;
        validate_non_empty("input_name", &self.input_name)?;
        validate_non_empty("phase", &self.phase)?;
        validate_non_empty("request_id", &self.request_id)?;
        validate_fingerprint("schema", &self.schema_fingerprint)?;
        validate_fingerprint("plan", &self.plan_fingerprint)?;
        if let Some(relation_fingerprint) = &self.relation_fingerprint {
            validate_fingerprint("relation", relation_fingerprint)?;
        } else if self.require_relations {
            return Err(DataError::Validation(format!(
                "materialization request `{}` on `{}` requires relations but has no relation_fingerprint",
                self.input_name, self.node_id
            )));
        }
        let unique_sources = self.source_ids.iter().collect::<BTreeSet<_>>();
        if unique_sources.len() != self.source_ids.len() {
            return Err(DataError::Validation(format!(
                "materialization request `{}` on `{}` contains duplicate source ids",
                self.input_name, self.node_id
            )));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CoordinatorDataHandleRecord {
    pub handle: CoordinatorHandleRef,
    pub run_id: String,
    pub node_id: String,
    pub input_name: String,
    pub phase: String,
    #[serde(default)]
    pub variant_id: Option<String>,
    #[serde(default)]
    pub fold_id: Option<String>,
    pub request_id: String,
    pub schema_fingerprint: String,
    pub plan_fingerprint: String,
    #[serde(default)]
    pub relation_fingerprint: Option<String>,
    pub plan_id: String,
    pub output_representation: RepresentationId,
    #[serde(default)]
    pub source_ids: Vec<SourceId>,
    #[serde(default)]
    pub sample_count: Option<usize>,
    #[serde(default)]
    pub relation_record_count: Option<usize>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CoordinatorDataViewRecord {
    pub handle: CoordinatorHandleRef,
    pub parent_handle: CoordinatorHandleRef,
    pub view: DataView,
    pub sample_count: usize,
    pub relation_record_count: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CoordinatorTargetValue {
    pub sample_id: SampleId,
    pub value: serde_json::Value,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CoordinatorTargetTable {
    pub target_id: TargetId,
    pub values: Vec<CoordinatorTargetValue>,
}

impl CoordinatorTargetTable {
    pub fn validate(&self) -> Result<()> {
        if self.values.is_empty() {
            return Err(DataError::Validation(format!(
                "target table `{}` contains no values",
                self.target_id
            )));
        }
        let mut seen = BTreeSet::new();
        for value in &self.values {
            if !seen.insert(&value.sample_id) {
                return Err(DataError::Validation(format!(
                    "target table `{}` contains duplicate sample `{}`",
                    self.target_id, value.sample_id
                )));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CoordinatorTargetBlock {
    pub target_id: TargetId,
    pub sample_ids: Vec<SampleId>,
    pub values: Vec<serde_json::Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CoordinatorMultiTargetBlock {
    pub target_ids: Vec<TargetId>,
    pub sample_ids: Vec<SampleId>,
    /// Target-major values: `values[target_idx][sample_idx]`.
    pub values: Vec<Vec<serde_json::Value>>,
    /// Target-major validity masks aligned with `values`.
    pub validity_masks: Vec<Vec<bool>>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CoordinatorFeatureRow {
    pub observation_id: ObservationId,
    pub values: Vec<serde_json::Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CoordinatorFeatureTable {
    pub feature_set_id: String,
    pub representation_id: RepresentationId,
    pub feature_names: Vec<String>,
    pub rows: Vec<CoordinatorFeatureRow>,
}

impl CoordinatorFeatureTable {
    pub fn validate(&self) -> Result<()> {
        validate_non_empty("feature_set_id", &self.feature_set_id)?;
        if self.feature_names.is_empty() {
            return Err(DataError::Validation(format!(
                "feature table `{}` contains no features",
                self.feature_set_id
            )));
        }
        let mut seen_features = BTreeSet::new();
        for feature_name in &self.feature_names {
            validate_non_empty("feature_name", feature_name)?;
            if !seen_features.insert(feature_name) {
                return Err(DataError::Validation(format!(
                    "feature table `{}` contains duplicate feature `{}`",
                    self.feature_set_id, feature_name
                )));
            }
        }
        if self.rows.is_empty() {
            return Err(DataError::Validation(format!(
                "feature table `{}` contains no rows",
                self.feature_set_id
            )));
        }
        let mut seen_observations = BTreeSet::new();
        for row in &self.rows {
            if !seen_observations.insert(&row.observation_id) {
                return Err(DataError::Validation(format!(
                    "feature table `{}` contains duplicate observation `{}`",
                    self.feature_set_id, row.observation_id
                )));
            }
            if row.values.len() != self.feature_names.len() {
                return Err(DataError::Validation(format!(
                    "feature table `{}` row `{}` has {} values for {} features",
                    self.feature_set_id,
                    row.observation_id,
                    row.values.len(),
                    self.feature_names.len()
                )));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CoordinatorFeatureBlock {
    pub feature_set_id: String,
    pub representation_id: RepresentationId,
    pub feature_names: Vec<String>,
    pub observation_ids: Vec<ObservationId>,
    pub sample_ids: Vec<SampleId>,
    pub values: Vec<Vec<serde_json::Value>>,
}

/// Typed sibling of [`CoordinatorFeatureBlock`]: the same projection with the
/// cells flattened row-major into one `Vec<f64>` instead of per-cell JSON
/// values. Produced by the `*_f64` projection path so a large numeric block
/// never allocates `rows × cols` boxed [`serde_json::Value`]s. Masked cells
/// are rejected by that path (it has no `Null` to project them into).
#[derive(Clone, Debug, PartialEq)]
pub struct CoordinatorFeatureBlockF64 {
    pub feature_set_id: String,
    pub representation_id: RepresentationId,
    pub feature_names: Vec<String>,
    pub observation_ids: Vec<ObservationId>,
    pub sample_ids: Vec<SampleId>,
    pub values: Vec<f64>,
}

#[derive(Debug)]
pub struct CoordinatorHandleArena {
    owner_controller: String,
    next_handle: RefCell<u64>,
    records: RefCell<BTreeMap<u64, CoordinatorDataHandleRecord>>,
    data_relations: RefCell<BTreeMap<u64, CoordinatorRelationSet>>,
    view_records: RefCell<BTreeMap<u64, CoordinatorDataViewRecord>>,
    view_relations: RefCell<BTreeMap<u64, CoordinatorRelationSet>>,
}

impl CoordinatorHandleArena {
    pub fn new(owner_controller: impl Into<String>) -> Result<Self> {
        let owner_controller = owner_controller.into();
        validate_non_empty("owner_controller", &owner_controller)?;
        Ok(Self {
            owner_controller,
            next_handle: RefCell::new(1),
            records: RefCell::new(BTreeMap::new()),
            data_relations: RefCell::new(BTreeMap::new()),
            view_records: RefCell::new(BTreeMap::new()),
            view_relations: RefCell::new(BTreeMap::new()),
        })
    }

    pub fn materialize(
        &self,
        envelope: &CoordinatorDataPlanEnvelope,
        request: &CoordinatorDataMaterializationRequest,
    ) -> Result<CoordinatorDataHandleRecord> {
        envelope.validate()?;
        request.validate()?;
        validate_request_against_envelope(envelope, request)?;
        let scoped_relations = envelope
            .coordinator_relations
            .as_ref()
            .map(|relations| scoped_relations_for_materialization(relations, request))
            .transpose()?;

        let handle = CoordinatorHandleRef {
            handle: self.next_handle(),
            kind: CoordinatorHandleKind::Data,
            owner_controller: self.owner_controller.clone(),
        };
        let record = CoordinatorDataHandleRecord {
            handle: handle.clone(),
            run_id: request.run_id.clone(),
            node_id: request.node_id.clone(),
            input_name: request.input_name.clone(),
            phase: request.phase.clone(),
            variant_id: request.variant_id.clone(),
            fold_id: request.fold_id.clone(),
            request_id: request.request_id.clone(),
            schema_fingerprint: request.schema_fingerprint.clone(),
            plan_fingerprint: request.plan_fingerprint.clone(),
            relation_fingerprint: request.relation_fingerprint.clone(),
            plan_id: envelope.plan.id.clone(),
            output_representation: request.output_representation.clone(),
            source_ids: request.source_ids.clone(),
            sample_count: scoped_relations.as_ref().map(|relations| {
                relations
                    .records
                    .iter()
                    .map(|record| &record.sample_id)
                    .collect::<BTreeSet<_>>()
                    .len()
            }),
            relation_record_count: scoped_relations
                .as_ref()
                .map(|relations| relations.records.len()),
        };
        self.records
            .borrow_mut()
            .insert(handle.handle, record.clone());
        if let Some(relations) = scoped_relations {
            self.data_relations
                .borrow_mut()
                .insert(handle.handle, relations);
        }
        Ok(record)
    }

    pub fn make_view(
        &self,
        data_handle: u64,
        view: &DataView,
    ) -> Result<CoordinatorDataViewRecord> {
        validate_view(view)?;
        let parent =
            self.records
                .borrow()
                .get(&data_handle)
                .cloned()
                .ok_or(DataError::UnknownHandle {
                    kind: "data",
                    handle: data_handle,
                })?;
        let relations = self
            .data_relations
            .borrow()
            .get(&data_handle)
            .cloned()
            .ok_or_else(|| {
                DataError::Validation(format!(
                    "data handle `{data_handle}` has no coordinator relations"
                ))
            })?;
        let filtered = filter_relations(&relations.records, view)?;
        let sample_count = unique_sample_count(&filtered);
        let relation_record_count = filtered.len();
        let handle = CoordinatorHandleRef {
            handle: self.next_handle(),
            kind: CoordinatorHandleKind::View,
            owner_controller: self.owner_controller.clone(),
        };
        let record = CoordinatorDataViewRecord {
            handle: handle.clone(),
            parent_handle: parent.handle,
            view: view.clone(),
            sample_count,
            relation_record_count,
        };
        self.view_records
            .borrow_mut()
            .insert(handle.handle, record.clone());
        self.view_relations
            .borrow_mut()
            .insert(handle.handle, CoordinatorRelationSet { records: filtered });
        Ok(record)
    }

    pub fn view_record(&self, handle: u64) -> Option<CoordinatorDataViewRecord> {
        self.view_records.borrow().get(&handle).cloned()
    }

    pub fn view_identity(&self, handle: u64) -> Result<CoordinatorRelationSet> {
        self.view_relations
            .borrow()
            .get(&handle)
            .cloned()
            .ok_or(DataError::UnknownHandle {
                kind: "view",
                handle,
            })
    }

    pub fn data_identity(&self, handle: u64) -> Result<CoordinatorRelationSet> {
        // A handle is only "unknown" if it is absent from the data-handle
        // registry. A live handle materialized without scoped relations is
        // present in `records` but has no `data_relations` entry — that is a
        // missing-relations contract error, not an unknown/stale handle.
        if !self.records.borrow().contains_key(&handle) {
            return Err(DataError::UnknownHandle {
                kind: "data",
                handle,
            });
        }
        self.data_relations
            .borrow()
            .get(&handle)
            .cloned()
            .ok_or_else(|| {
                DataError::Validation(format!(
                    "data handle `{handle}` has no coordinator relations"
                ))
            })
    }

    pub fn release_handle(&self, handle: u64) -> bool {
        if self.view_records.borrow_mut().remove(&handle).is_some() {
            self.view_relations.borrow_mut().remove(&handle);
            return true;
        }
        if let Some(record) = self.records.borrow_mut().remove(&handle) {
            self.data_relations.borrow_mut().remove(&handle);
            let child_views = self
                .view_records
                .borrow()
                .iter()
                .filter_map(|(view_handle, view_record)| {
                    (view_record.parent_handle == record.handle).then_some(*view_handle)
                })
                .collect::<Vec<_>>();
            for view_handle in child_views {
                self.view_records.borrow_mut().remove(&view_handle);
                self.view_relations.borrow_mut().remove(&view_handle);
            }
            return true;
        }
        false
    }

    pub fn target_values(
        &self,
        view_handle: u64,
        target_table: &CoordinatorTargetTable,
    ) -> Result<CoordinatorTargetBlock> {
        target_table.validate()?;
        let relations = self.view_identity(view_handle)?;
        let values_by_sample = target_table
            .values
            .iter()
            .map(|value| (&value.sample_id, &value.value))
            .collect::<BTreeMap<_, _>>();
        let mut seen_samples = BTreeSet::new();
        let mut sample_ids = Vec::new();
        let mut values = Vec::new();
        for relation in relations.records.iter().filter(|relation| {
            relation
                .target_id
                .as_ref()
                .map(|target_id| target_id == &target_table.target_id)
                .unwrap_or(true)
        }) {
            if !seen_samples.insert(&relation.sample_id) {
                continue;
            }
            let value = values_by_sample.get(&relation.sample_id).ok_or_else(|| {
                DataError::Validation(format!(
                    "target table `{}` has no value for sample `{}`",
                    target_table.target_id, relation.sample_id
                ))
            })?;
            sample_ids.push(relation.sample_id.clone());
            values.push((*value).clone());
        }
        if sample_ids.is_empty() {
            return Err(DataError::Validation(format!(
                "view `{view_handle}` contains no samples for target `{}`",
                target_table.target_id
            )));
        }
        Ok(CoordinatorTargetBlock {
            target_id: target_table.target_id.clone(),
            sample_ids,
            values,
        })
    }

    pub fn multi_target_values(
        &self,
        view_handle: u64,
        target_tables: &[CoordinatorTargetTable],
    ) -> Result<CoordinatorMultiTargetBlock> {
        if target_tables.is_empty() {
            return Err(DataError::Validation(
                "multi-target materialization requires at least one target table".to_string(),
            ));
        }
        let mut seen_targets = BTreeSet::new();
        for table in target_tables {
            table.validate()?;
            if !seen_targets.insert(table.target_id.clone()) {
                return Err(DataError::Validation(format!(
                    "multi-target materialization contains duplicate target `{}`",
                    table.target_id
                )));
            }
        }

        let target_ids = target_tables
            .iter()
            .map(|table| table.target_id.clone())
            .collect::<Vec<_>>();
        let target_universe = target_ids.iter().collect::<BTreeSet<_>>();
        let relations = self.view_identity(view_handle)?;
        let mut seen_samples = BTreeSet::new();
        let mut sample_ids = Vec::new();
        for relation in relations.records.iter().filter(|relation| {
            relation
                .target_id
                .as_ref()
                .map(|target_id| target_universe.contains(target_id))
                .unwrap_or(true)
        }) {
            if seen_samples.insert(relation.sample_id.clone()) {
                sample_ids.push(relation.sample_id.clone());
            }
        }
        if sample_ids.is_empty() {
            return Err(DataError::Validation(format!(
                "view `{view_handle}` contains no samples for requested targets"
            )));
        }

        let mut values = Vec::with_capacity(target_tables.len());
        let mut validity_masks = Vec::with_capacity(target_tables.len());
        for table in target_tables {
            let values_by_sample = table
                .values
                .iter()
                .map(|value| (&value.sample_id, &value.value))
                .collect::<BTreeMap<_, _>>();
            let mut target_values = Vec::with_capacity(sample_ids.len());
            let mut validity = Vec::with_capacity(sample_ids.len());
            for sample_id in &sample_ids {
                match values_by_sample.get(sample_id) {
                    Some(value) if !value.is_null() => {
                        target_values.push((*value).clone());
                        validity.push(true);
                    }
                    Some(_) | None => {
                        target_values.push(serde_json::Value::Null);
                        validity.push(false);
                    }
                }
            }
            values.push(target_values);
            validity_masks.push(validity);
        }

        Ok(CoordinatorMultiTargetBlock {
            target_ids,
            sample_ids,
            values,
            validity_masks,
        })
    }

    pub fn feature_values(
        &self,
        view_handle: u64,
        feature_table: &CoordinatorFeatureTable,
    ) -> Result<CoordinatorFeatureBlock> {
        feature_table.validate()?;
        let view_record = self
            .view_records
            .borrow()
            .get(&view_handle)
            .cloned()
            .ok_or(DataError::UnknownHandle {
                kind: "view",
                handle: view_handle,
            })?;
        let parent_record = self
            .records
            .borrow()
            .get(&view_record.parent_handle.handle)
            .cloned()
            .ok_or(DataError::UnknownHandle {
                kind: "data",
                handle: view_record.parent_handle.handle,
            })?;
        if feature_table.representation_id != parent_record.output_representation {
            return Err(DataError::Validation(format!(
                "feature table `{}` representation `{}` does not match materialized output representation `{}`",
                feature_table.feature_set_id,
                feature_table.representation_id,
                parent_record.output_representation
            )));
        }
        let relations = self.view_identity(view_handle)?;
        let selected_indices = selected_feature_indices(feature_table, &view_record.view)?;
        let rows_by_observation = feature_table
            .rows
            .iter()
            .map(|row| (&row.observation_id, row))
            .collect::<BTreeMap<_, _>>();
        let mut observation_ids = Vec::with_capacity(relations.records.len());
        let mut sample_ids = Vec::with_capacity(relations.records.len());
        let mut values = Vec::with_capacity(relations.records.len());
        for relation in &relations.records {
            let row = rows_by_observation
                .get(&relation.observation_id)
                .ok_or_else(|| {
                    DataError::Validation(format!(
                        "feature table `{}` has no row for observation `{}`",
                        feature_table.feature_set_id, relation.observation_id
                    ))
                })?;
            observation_ids.push(relation.observation_id.clone());
            sample_ids.push(relation.sample_id.clone());
            values.push(
                selected_indices
                    .iter()
                    .map(|idx| row.values[*idx].clone())
                    .collect(),
            );
        }
        Ok(CoordinatorFeatureBlock {
            feature_set_id: feature_table.feature_set_id.clone(),
            representation_id: feature_table.representation_id.clone(),
            feature_names: selected_indices
                .iter()
                .map(|idx| feature_table.feature_names[*idx].clone())
                .collect(),
            observation_ids,
            sample_ids,
            values,
        })
    }

    pub fn handle_record(&self, handle: u64) -> Option<CoordinatorDataHandleRecord> {
        self.records.borrow().get(&handle).cloned()
    }

    pub fn handle_records(&self) -> Vec<CoordinatorDataHandleRecord> {
        self.records.borrow().values().cloned().collect()
    }

    fn next_handle(&self) -> u64 {
        let mut next = self.next_handle.borrow_mut();
        let handle = *next;
        *next += 1;
        handle
    }
}

fn validate_request_against_envelope(
    envelope: &CoordinatorDataPlanEnvelope,
    request: &CoordinatorDataMaterializationRequest,
) -> Result<()> {
    if request.schema_fingerprint != envelope.schema_fingerprint {
        return Err(DataError::FingerprintMismatch {
            kind: "schema",
            expected: envelope.schema_fingerprint.clone(),
            actual: request.schema_fingerprint.clone(),
        });
    }
    if request.plan_fingerprint != envelope.plan_fingerprint {
        return Err(DataError::FingerprintMismatch {
            kind: "plan",
            expected: envelope.plan_fingerprint.clone(),
            actual: request.plan_fingerprint.clone(),
        });
    }
    if request.relation_fingerprint != envelope.relation_fingerprint {
        let none = || "<none>".to_string();
        return Err(DataError::FingerprintMismatch {
            kind: "relation",
            expected: envelope.relation_fingerprint.clone().unwrap_or_else(none),
            actual: request.relation_fingerprint.clone().unwrap_or_else(none),
        });
    }
    if request.require_relations && envelope.coordinator_relations.is_none() {
        return Err(DataError::Validation(format!(
            "materialization request `{}` on `{}` requires coordinator relations",
            request.input_name, request.node_id
        )));
    }
    if request.output_representation != envelope.plan.output_representation {
        return Err(DataError::Validation(format!(
            "materialization request `{}` on `{}` output representation `{}` does not match plan output `{}`",
            request.input_name,
            request.node_id,
            request.output_representation,
            envelope.plan.output_representation
        )));
    }
    if !request.source_ids.is_empty() {
        let plan_sources = envelope
            .plan
            .steps
            .iter()
            .filter_map(|step| step.source_id.as_ref())
            .collect::<BTreeSet<_>>();
        for source_id in &request.source_ids {
            if !plan_sources.contains(source_id) {
                return Err(DataError::Validation(format!(
                    "materialization request `{}` on `{}` source `{}` is not present in data plan `{}`",
                    request.input_name, request.node_id, source_id, envelope.plan.id
                )));
            }
        }
    }
    Ok(())
}

fn scoped_relations_for_materialization(
    relations: &CoordinatorRelationSet,
    request: &CoordinatorDataMaterializationRequest,
) -> Result<CoordinatorRelationSet> {
    relations.validate()?;
    if request.source_ids.is_empty() {
        return Ok(relations.clone());
    }
    let source_filter = request.source_ids.iter().collect::<BTreeSet<_>>();
    let scoped = relations
        .records
        .iter()
        .filter(|relation| {
            relation
                .source_id
                .as_ref()
                .map(|source_id| source_filter.contains(source_id))
                .unwrap_or(false)
        })
        .cloned()
        .collect::<Vec<_>>();
    if scoped.is_empty() {
        return Err(DataError::Validation(format!(
            "materialization request `{}` on `{}` selected no coordinator relations for requested source ids",
            request.input_name, request.node_id
        )));
    }
    let scoped = CoordinatorRelationSet { records: scoped };
    scoped.validate()?;
    Ok(scoped)
}

fn validate_non_empty(label: &str, value: &str) -> Result<()> {
    if value.trim().is_empty() {
        return Err(DataError::Validation(format!("{label} must not be empty")));
    }
    Ok(())
}

fn validate_view(view: &DataView) -> Result<()> {
    if let Some(samples) = &view.sample_ids {
        let unique = samples.iter().collect::<BTreeSet<_>>();
        if unique.len() != samples.len() {
            return Err(DataError::Validation(
                "data view contains duplicate sample ids".to_string(),
            ));
        }
    }
    if let Some(sources) = &view.source_ids {
        let unique = sources.iter().collect::<BTreeSet<_>>();
        if unique.len() != sources.len() {
            return Err(DataError::Validation(
                "data view contains duplicate source ids".to_string(),
            ));
        }
    }
    if let Some(columns) = &view.columns {
        let unique = columns.iter().collect::<BTreeSet<_>>();
        if unique.len() != columns.len() {
            return Err(DataError::Validation(
                "data view contains duplicate columns".to_string(),
            ));
        }
        if columns.iter().any(|column| column.trim().is_empty()) {
            return Err(DataError::Validation(
                "data view contains an empty column".to_string(),
            ));
        }
    }
    if let Some(branch_view) = &view.branch_view {
        branch_view.validate()?;
    }
    Ok(())
}

fn filter_relations(
    relations: &[CoordinatorRelation],
    view: &DataView,
) -> Result<Vec<CoordinatorRelation>> {
    let sample_filter = view
        .sample_ids
        .as_ref()
        .map(|sample_ids| sample_ids.iter().collect::<BTreeSet<_>>());
    let source_filter = view
        .source_ids
        .as_ref()
        .map(|source_ids| source_ids.iter().collect::<BTreeSet<_>>());
    // When both `view.source_ids` and `view.branch_view` constrain sources, the
    // two are composed as intersection: a relation must pass both filters.
    // `source_ids` is the materialization scope (sources loaded into the parent
    // handle); the branch selector is the subset this branch cares about.
    // Intersection prevents a branch from silently widening past what was
    // actually materialized.
    let mut branch_source_filter: Option<BTreeSet<&SourceId>> = None;
    let mut branch_metadata_filter: Option<&BTreeMap<String, serde_json::Value>> = None;
    let mut branch_tag_filter: Option<BTreeSet<&String>> = None;
    let mut branch_native_filter = None;
    if let Some(branch_view) = view.branch_view.as_ref() {
        match branch_view.mode {
            crate::coordinator::CoordinatorBranchViewMode::BySource => {
                branch_source_filter = Some(
                    branch_view
                        .selector
                        .source_ids
                        .iter()
                        .collect::<BTreeSet<_>>(),
                );
            }
            // A relation matches a `by_metadata` selector iff its own metadata
            // contains every selector key with an equal value; `by_tag` iff its
            // tags contain every selector tag.
            crate::coordinator::CoordinatorBranchViewMode::ByMetadata => {
                branch_metadata_filter = Some(&branch_view.selector.metadata);
            }
            crate::coordinator::CoordinatorBranchViewMode::ByTag => {
                branch_tag_filter = Some(branch_view.selector.tags.iter().collect::<BTreeSet<_>>());
            }
            crate::coordinator::CoordinatorBranchViewMode::Separation => {}
            crate::coordinator::CoordinatorBranchViewMode::ByFilter => {
                let filter = branch_view.selector.filter.as_ref().ok_or_else(|| {
                    DataError::Validation(format!(
                        "coordinator branch view `{}` mode=by_filter requires filter",
                        branch_view.view_id
                    ))
                })?;
                branch_native_filter = Some(parse_native_branch_view_filter(
                    filter,
                    &format!("coordinator branch view `{}`", branch_view.view_id),
                )?);
            }
        }
    }
    let mut filtered = relations
        .iter()
        .enumerate()
        .filter(|relation| {
            let relation = relation.1;
            sample_filter
                .as_ref()
                .map(|samples| samples.contains(&relation.sample_id))
                .unwrap_or(true)
        })
        .filter(|relation| {
            let relation = relation.1;
            source_filter
                .as_ref()
                .map(|sources| {
                    relation
                        .source_id
                        .as_ref()
                        .map(|source_id| sources.contains(source_id))
                        .unwrap_or(false)
                })
                .unwrap_or(true)
        })
        .filter(|relation| {
            let relation = relation.1;
            branch_source_filter
                .as_ref()
                .map(|sources| {
                    relation
                        .source_id
                        .as_ref()
                        .map(|source_id| sources.contains(source_id))
                        .unwrap_or(false)
                })
                .unwrap_or(true)
        })
        .filter(|relation| {
            let relation = relation.1;
            branch_metadata_filter
                .map(|selector| {
                    selector
                        .iter()
                        .all(|(key, value)| relation.metadata.get(key) == Some(value))
                })
                .unwrap_or(true)
        })
        .filter(|relation| {
            let relation = relation.1;
            branch_tag_filter
                .as_ref()
                .map(|tags| tags.iter().all(|tag| relation.tags.contains(tag)))
                .unwrap_or(true)
        })
        .filter(|relation| {
            let relation = relation.1;
            branch_native_filter
                .as_ref()
                .map(|filter| {
                    filter
                        .metadata_equals
                        .iter()
                        .all(|(key, value)| relation.metadata.get(key) == Some(value))
                        && filter
                            .tags_all
                            .iter()
                            .all(|tag| relation.tags.contains(tag))
                })
                .unwrap_or(true)
        })
        .filter(|relation| view.include_augmented || !relation.1.is_augmented)
        .filter(|relation| view.include_excluded || !relation.1.excluded)
        .map(|(idx, relation)| (idx, relation.clone()))
        .collect::<Vec<_>>();
    if filtered.is_empty() {
        return Err(DataError::Validation(
            "data view selected no coordinator relations".to_string(),
        ));
    }
    if let Some(sample_ids) = &view.sample_ids {
        let sample_order = sample_ids
            .iter()
            .enumerate()
            .map(|(idx, sample_id)| (sample_id, idx))
            .collect::<BTreeMap<_, _>>();
        filtered.sort_by_key(|(idx, relation)| {
            (
                sample_order
                    .get(&relation.sample_id)
                    .copied()
                    .unwrap_or(usize::MAX),
                *idx,
            )
        });
    }
    Ok(filtered.into_iter().map(|(_, relation)| relation).collect())
}

fn unique_sample_count(relations: &[CoordinatorRelation]) -> usize {
    relations
        .iter()
        .map(|relation| &relation.sample_id)
        .collect::<BTreeSet<_>>()
        .len()
}

fn selected_feature_indices(
    table: &CoordinatorFeatureTable,
    view: &DataView,
) -> Result<Vec<usize>> {
    let index_by_name = table
        .feature_names
        .iter()
        .enumerate()
        .map(|(idx, name)| (name, idx))
        .collect::<BTreeMap<_, _>>();
    let indices = if let Some(columns) = &view.columns {
        columns
            .iter()
            .map(|column| {
                index_by_name.get(column).copied().ok_or_else(|| {
                    DataError::Validation(format!(
                        "feature table `{}` has no feature column `{}`",
                        table.feature_set_id, column
                    ))
                })
            })
            .collect::<Result<Vec<_>>>()?
    } else {
        (0..table.feature_names.len()).collect()
    };
    if indices.is_empty() {
        return Err(DataError::Validation(format!(
            "feature table `{}` selected no feature columns",
            table.feature_set_id
        )));
    }
    Ok(indices)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn envelope() -> CoordinatorDataPlanEnvelope {
        serde_json::from_str(include_str!(
            "../../../examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json"
        ))
        .unwrap()
    }

    fn request() -> CoordinatorDataMaterializationRequest {
        serde_json::from_str(include_str!(
            "../../../examples/fixtures/oof_campaign/materialization_request_model_base_x.json"
        ))
        .unwrap()
    }

    #[test]
    fn materializes_validated_coordinator_handle_record() {
        let arena = CoordinatorHandleArena::new("controller:data.provider").unwrap();
        let record = arena.materialize(&envelope(), &request()).unwrap();

        assert_eq!(record.handle.handle, 1);
        assert_eq!(record.handle.kind, CoordinatorHandleKind::Data);
        assert_eq!(record.input_name, "x");
        assert_eq!(record.plan_id, "nir-to-tabular");
        assert_eq!(record.sample_count, Some(2));
        assert_eq!(record.relation_record_count, Some(4));
        assert_eq!(arena.handle_record(1), Some(record));
        assert_eq!(arena.handle_records().len(), 1);
    }

    #[test]
    fn materialization_refuses_fingerprint_mismatch() {
        let arena = CoordinatorHandleArena::new("controller:data.provider").unwrap();
        let mut request = request();
        request.plan_fingerprint = "0".repeat(64);

        assert!(arena.materialize(&envelope(), &request).is_err());
    }

    #[test]
    fn materialization_scopes_relations_to_requested_sources() {
        let mut envelope = envelope();
        let chem = SourceId::new("chem").unwrap();
        envelope.plan.steps.push(crate::plan::DataPlanStep {
            kind: crate::plan::DataPlanStepKind::Materialize,
            source_id: Some(chem.clone()),
            adapter_id: None,
            input_representation: None,
            output_representation: Some(RepresentationId::new("tabular_numeric").unwrap()),
            fit_scope: crate::plan::FitScope::Stateless,
            requires_user_choice: false,
            metadata: BTreeMap::new(),
        });
        envelope.plan_fingerprint = crate::data_plan_fingerprint(&envelope.plan).unwrap();
        envelope.relation_fingerprint = None;
        envelope
            .coordinator_relations
            .as_mut()
            .unwrap()
            .records
            .push(CoordinatorRelation {
                observation_id: ObservationId::new("chem.S001").unwrap(),
                sample_id: SampleId::new("S001").unwrap(),
                target_id: Some(TargetId::new("y").unwrap()),
                group_id: None,
                origin_sample_id: None,
                source_id: Some(chem.clone()),
                is_augmented: false,
                excluded: false,
                metadata: BTreeMap::new(),
                tags: Vec::new(),
            });
        envelope.validate().unwrap();

        let mut request = request();
        request.plan_fingerprint = envelope.plan_fingerprint.clone();
        request.relation_fingerprint = None;
        request.require_relations = false;
        request.source_ids = vec![SourceId::new("nir").unwrap()];

        let arena = CoordinatorHandleArena::new("controller:data.provider").unwrap();
        let data = arena.materialize(&envelope, &request).unwrap();
        let view = arena
            .make_view(data.handle.handle, &DataView::default())
            .unwrap();
        let identity = arena.view_identity(view.handle.handle).unwrap();

        assert_eq!(data.relation_record_count, Some(4));
        assert_eq!(
            arena
                .data_identity(data.handle.handle)
                .unwrap()
                .records
                .len(),
            4
        );
        assert!(identity
            .records
            .iter()
            .all(|record| record.source_id.as_ref() == Some(&SourceId::new("nir").unwrap())));
    }

    #[test]
    fn view_filters_augmented_rows_and_preserves_repetition_identity() {
        let arena = CoordinatorHandleArena::new("controller:data.provider").unwrap();
        let data = arena.materialize(&envelope(), &request()).unwrap();
        let view = DataView {
            sample_ids: Some(vec![SampleId::new("S001").unwrap()]),
            include_augmented: false,
            ..Default::default()
        };

        let view_record = arena.make_view(data.handle.handle, &view).unwrap();
        let identity = arena.view_identity(view_record.handle.handle).unwrap();

        assert_eq!(view_record.handle.kind, CoordinatorHandleKind::View);
        assert_eq!(view_record.sample_count, 1);
        assert_eq!(view_record.relation_record_count, 2);
        assert_eq!(identity.records.len(), 2);
        assert_eq!(identity.records[0].observation_id.as_str(), "obs.S001.base");
        assert_eq!(identity.records[1].observation_id.as_str(), "obs.S001.rep1");
        assert_eq!(
            arena.view_record(view_record.handle.handle),
            Some(view_record)
        );
    }

    #[test]
    fn view_drops_excluded_rows_for_training_and_keeps_them_otherwise() {
        // Mark the sole S002 observation excluded. Under a training policy
        // (`include_excluded=false`) it must be filtered out; under a
        // validation/predict policy (`include_excluded=true`) it must be kept.
        let mut envelope = envelope();
        for record in &mut envelope.coordinator_relations.as_mut().unwrap().records {
            if record.observation_id.as_str() == "obs.S002.base" {
                record.excluded = true;
            }
        }
        // `relation_fingerprint` is a replay key for the *source* relation
        // table, not for the derived coordinator_relations we just edited, so
        // it stays intact: the embedded coordinator relations are validated
        // structurally, and `excluded` does not participate in that fingerprint.
        envelope.validate().unwrap();

        let arena = CoordinatorHandleArena::new("controller:data.provider").unwrap();
        let data = arena.materialize(&envelope, &request()).unwrap();

        // Training view: excluded S002 row is dropped.
        let train_view = DataView {
            include_augmented: true,
            include_excluded: false,
            ..Default::default()
        };
        let train_record = arena.make_view(data.handle.handle, &train_view).unwrap();
        let train_identity = arena.view_identity(train_record.handle.handle).unwrap();
        assert!(
            train_identity
                .records
                .iter()
                .all(|record| record.sample_id.as_str() != "S002"),
            "excluded sample S002 must be absent from a training view"
        );
        assert_eq!(train_record.relation_record_count, 3);

        // Validation/predict view: excluded S002 row is retained.
        let predict_view = DataView {
            include_augmented: true,
            include_excluded: true,
            ..Default::default()
        };
        let predict_record = arena.make_view(data.handle.handle, &predict_view).unwrap();
        let predict_identity = arena.view_identity(predict_record.handle.handle).unwrap();
        assert!(
            predict_identity
                .records
                .iter()
                .any(|record| record.sample_id.as_str() == "S002"),
            "excluded sample S002 must be present in a validation/predict view"
        );
        assert_eq!(predict_record.relation_record_count, 4);
    }

    #[test]
    fn branch_view_by_source_filters_relations_to_branch_sources() {
        use crate::coordinator::{
            CoordinatorBranchView, CoordinatorBranchViewMode, CoordinatorBranchViewSelector,
        };

        let mut envelope = envelope();
        let chem = SourceId::new("chem").unwrap();
        envelope.plan.steps.push(crate::plan::DataPlanStep {
            kind: crate::plan::DataPlanStepKind::Materialize,
            source_id: Some(chem.clone()),
            adapter_id: None,
            input_representation: None,
            output_representation: Some(RepresentationId::new("tabular_numeric").unwrap()),
            fit_scope: crate::plan::FitScope::Stateless,
            requires_user_choice: false,
            metadata: BTreeMap::new(),
        });
        envelope.plan_fingerprint = crate::data_plan_fingerprint(&envelope.plan).unwrap();
        envelope.relation_fingerprint = None;
        envelope
            .coordinator_relations
            .as_mut()
            .unwrap()
            .records
            .push(CoordinatorRelation {
                observation_id: ObservationId::new("chem.S001").unwrap(),
                sample_id: SampleId::new("S001").unwrap(),
                target_id: Some(TargetId::new("y").unwrap()),
                group_id: None,
                origin_sample_id: None,
                source_id: Some(chem.clone()),
                is_augmented: false,
                excluded: false,
                metadata: BTreeMap::new(),
                tags: Vec::new(),
            });
        envelope.validate().unwrap();
        let mut request = request();
        request.plan_fingerprint = envelope.plan_fingerprint.clone();
        request.relation_fingerprint = None;
        request.require_relations = false;
        request.source_ids = vec![SourceId::new("nir").unwrap(), chem.clone()];

        let arena = CoordinatorHandleArena::new("controller:data.provider").unwrap();
        let data = arena.materialize(&envelope, &request).unwrap();
        let view = DataView {
            branch_view: Some(CoordinatorBranchView {
                view_id: "branch_view:nir".to_string(),
                branch_id: "branch:nir_only".to_string(),
                mode: CoordinatorBranchViewMode::BySource,
                selector: CoordinatorBranchViewSelector {
                    source_ids: vec![SourceId::new("nir").unwrap()],
                    ..Default::default()
                },
                allow_overlap: false,
                metadata: BTreeMap::new(),
            }),
            include_augmented: true,
            ..Default::default()
        };
        let view_record = arena.make_view(data.handle.handle, &view).unwrap();
        let identity = arena.view_identity(view_record.handle.handle).unwrap();

        assert!(identity
            .records
            .iter()
            .all(|record| record.source_id.as_ref() == Some(&SourceId::new("nir").unwrap())));
        assert!(identity.records.iter().any(|record| record
            .observation_id
            .as_str()
            .starts_with("obs.S001")
            || record.observation_id.as_str().starts_with("obs.S002")));
    }

    #[test]
    fn branch_view_separation_does_not_restrict_relations() {
        use crate::coordinator::{
            CoordinatorBranchView, CoordinatorBranchViewMode, CoordinatorBranchViewSelector,
        };

        let arena = CoordinatorHandleArena::new("controller:data.provider").unwrap();
        let data = arena.materialize(&envelope(), &request()).unwrap();
        let view = DataView {
            branch_view: Some(CoordinatorBranchView {
                view_id: "branch_view:separation".to_string(),
                branch_id: "branch:0".to_string(),
                mode: CoordinatorBranchViewMode::Separation,
                selector: CoordinatorBranchViewSelector {
                    tags: vec!["clean".to_string()],
                    ..Default::default()
                },
                allow_overlap: false,
                metadata: BTreeMap::new(),
            }),
            include_augmented: true,
            ..Default::default()
        };
        let view_record = arena.make_view(data.handle.handle, &view).unwrap();
        let identity = arena.view_identity(view_record.handle.handle).unwrap();
        assert!(!identity.records.is_empty());
    }

    /// Build the shared envelope, tagging S001 observations with
    /// `metadata={"group":"A"}` + `tags=["clean"]` and the S002 observation
    /// with `metadata={"group":"B"}` + `tags=["dirty"]`, so `by_metadata` /
    /// `by_tag` branch views have something to discriminate on. Editing the
    /// derived `coordinator_relations` does not invalidate the source
    /// `relation_fingerprint` (it is a replay key for the source table, not the
    /// derived view).
    fn tagged_envelope() -> CoordinatorDataPlanEnvelope {
        let mut envelope = envelope();
        for record in &mut envelope.coordinator_relations.as_mut().unwrap().records {
            let (group, tag) = if record.sample_id.as_str() == "S002" {
                ("B", "dirty")
            } else {
                ("A", "clean")
            };
            record
                .metadata
                .insert("group".to_string(), serde_json::json!(group));
            record.tags = vec![tag.to_string()];
        }
        envelope.validate().unwrap();
        envelope
    }

    #[test]
    fn branch_view_by_metadata_filters_relations_natively() {
        use crate::coordinator::{
            CoordinatorBranchView, CoordinatorBranchViewMode, CoordinatorBranchViewSelector,
        };

        let arena = CoordinatorHandleArena::new("controller:data.provider").unwrap();
        let data = arena.materialize(&tagged_envelope(), &request()).unwrap();

        let by_metadata = |group: &str| CoordinatorBranchView {
            view_id: format!("branch_view:group_{group}"),
            branch_id: format!("branch:group_{group}"),
            mode: CoordinatorBranchViewMode::ByMetadata,
            selector: CoordinatorBranchViewSelector {
                metadata: BTreeMap::from([("group".to_string(), serde_json::json!(group))]),
                ..Default::default()
            },
            allow_overlap: false,
            metadata: BTreeMap::new(),
        };

        // group=A INCLUDES the S001 relations and EXCLUDES S002.
        let view_a = DataView {
            branch_view: Some(by_metadata("A")),
            include_augmented: true,
            ..Default::default()
        };
        let record_a = arena.make_view(data.handle.handle, &view_a).unwrap();
        let identity_a = arena.view_identity(record_a.handle.handle).unwrap();
        assert!(
            identity_a
                .records
                .iter()
                .all(|record| record.sample_id.as_str() == "S001"),
            "by_metadata group=A must include only S001 relations"
        );
        assert!(
            identity_a
                .records
                .iter()
                .any(|record| record.sample_id.as_str() == "S001"),
            "by_metadata group=A must keep the matching S001 relations"
        );

        // group=B INCLUDES S002 and EXCLUDES S001.
        let view_b = DataView {
            branch_view: Some(by_metadata("B")),
            include_augmented: true,
            ..Default::default()
        };
        let record_b = arena.make_view(data.handle.handle, &view_b).unwrap();
        let identity_b = arena.view_identity(record_b.handle.handle).unwrap();
        assert!(
            identity_b
                .records
                .iter()
                .all(|record| record.sample_id.as_str() == "S002"),
            "by_metadata group=B must exclude S001 relations"
        );
    }

    #[test]
    fn branch_view_by_tag_filters_relations_natively() {
        use crate::coordinator::{
            CoordinatorBranchView, CoordinatorBranchViewMode, CoordinatorBranchViewSelector,
        };

        let arena = CoordinatorHandleArena::new("controller:data.provider").unwrap();
        let data = arena.materialize(&tagged_envelope(), &request()).unwrap();

        let by_tag = |tag: &str| CoordinatorBranchView {
            view_id: format!("branch_view:tag_{tag}"),
            branch_id: format!("branch:tag_{tag}"),
            mode: CoordinatorBranchViewMode::ByTag,
            selector: CoordinatorBranchViewSelector {
                tags: vec![tag.to_string()],
                ..Default::default()
            },
            allow_overlap: false,
            metadata: BTreeMap::new(),
        };

        // tag=clean INCLUDES S001 and EXCLUDES S002.
        let view_clean = DataView {
            branch_view: Some(by_tag("clean")),
            include_augmented: true,
            ..Default::default()
        };
        let record_clean = arena.make_view(data.handle.handle, &view_clean).unwrap();
        let identity_clean = arena.view_identity(record_clean.handle.handle).unwrap();
        assert!(
            identity_clean
                .records
                .iter()
                .all(|record| record.sample_id.as_str() == "S001"),
            "by_tag clean must include only S001 relations"
        );

        // tag=dirty INCLUDES S002 and EXCLUDES S001.
        let view_dirty = DataView {
            branch_view: Some(by_tag("dirty")),
            include_augmented: true,
            ..Default::default()
        };
        let record_dirty = arena.make_view(data.handle.handle, &view_dirty).unwrap();
        let identity_dirty = arena.view_identity(record_dirty.handle.handle).unwrap();
        assert!(
            identity_dirty
                .records
                .iter()
                .all(|record| record.sample_id.as_str() == "S002"),
            "by_tag dirty must exclude S001 relations"
        );
    }

    #[test]
    fn branch_view_by_filter_filters_closed_metadata_and_tag_predicates() {
        use crate::coordinator::{
            CoordinatorBranchView, CoordinatorBranchViewMode, CoordinatorBranchViewSelector,
        };

        let arena = CoordinatorHandleArena::new("controller:data.provider").unwrap();
        let data = arena.materialize(&tagged_envelope(), &request()).unwrap();
        let view = DataView {
            branch_view: Some(CoordinatorBranchView {
                view_id: "branch_view:filter_A_clean".to_string(),
                branch_id: "branch:filter_A_clean".to_string(),
                mode: CoordinatorBranchViewMode::ByFilter,
                selector: CoordinatorBranchViewSelector {
                    filter: Some(serde_json::json!({
                        "metadata_equals": {"group": "A"},
                        "tags_all": ["clean"]
                    })),
                    ..Default::default()
                },
                allow_overlap: false,
                metadata: BTreeMap::new(),
            }),
            include_augmented: true,
            ..Default::default()
        };
        let record = arena.make_view(data.handle.handle, &view).unwrap();
        let identity = arena.view_identity(record.handle.handle).unwrap();
        assert!(
            identity
                .records
                .iter()
                .all(|relation| relation.sample_id.as_str() == "S001"),
            "closed by_filter must retain exactly the matching relations"
        );
    }

    #[test]
    fn branch_view_empty_partition_intersection_raises_a_clear_error() {
        // A branch_view scoped to group=B, intersected with a fold restriction
        // (sample_ids) that contains ONLY S001 samples, selects no relations —
        // the empty partition ∩ fold case. The arena must surface this explicitly
        // rather than returning an empty view (no silent mis-coverage).
        use crate::coordinator::{
            CoordinatorBranchView, CoordinatorBranchViewMode, CoordinatorBranchViewSelector,
        };

        let arena = CoordinatorHandleArena::new("controller:data.provider").unwrap();
        let envelope = tagged_envelope();
        let data = arena.materialize(&envelope, &request()).unwrap();

        // The S001 sample id only (group=A); group=B (S002) is disjoint from this.
        // `DataView.sample_ids` rejects duplicates, so collect the distinct id.
        let s001_samples: Vec<SampleId> = envelope
            .coordinator_relations
            .as_ref()
            .unwrap()
            .records
            .iter()
            .filter(|record| record.sample_id.as_str() == "S001")
            .map(|record| record.sample_id.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        assert!(!s001_samples.is_empty(), "fixture must carry S001 samples");

        let view = DataView {
            branch_view: Some(CoordinatorBranchView {
                view_id: "branch_view:group_B".to_string(),
                branch_id: "branch:group_B".to_string(),
                mode: CoordinatorBranchViewMode::ByMetadata,
                selector: CoordinatorBranchViewSelector {
                    metadata: BTreeMap::from([("group".to_string(), serde_json::json!("B"))]),
                    ..Default::default()
                },
                allow_overlap: false,
                metadata: BTreeMap::new(),
            }),
            sample_ids: Some(s001_samples),
            include_augmented: true,
            ..Default::default()
        };
        let error = arena
            .make_view(data.handle.handle, &view)
            .unwrap_err()
            .to_string();
        assert!(
            error.contains("selected no coordinator relations"),
            "empty branch ∩ fold must raise a clear error: {error}"
        );
    }

    #[test]
    fn branch_view_by_filter_refuses_unknown_predicates_before_selection() {
        use crate::coordinator::{
            CoordinatorBranchView, CoordinatorBranchViewMode, CoordinatorBranchViewSelector,
        };

        let arena = CoordinatorHandleArena::new("controller:data.provider").unwrap();
        let data = arena.materialize(&envelope(), &request()).unwrap();
        let view = DataView {
            branch_view: Some(CoordinatorBranchView {
                view_id: "branch_view:by_filter".to_string(),
                branch_id: "branch:0".to_string(),
                mode: CoordinatorBranchViewMode::ByFilter,
                selector: CoordinatorBranchViewSelector {
                    filter: Some(serde_json::json!({"op": "always"})),
                    ..Default::default()
                },
                allow_overlap: false,
                metadata: BTreeMap::new(),
            }),
            include_augmented: true,
            ..Default::default()
        };
        let error = arena
            .make_view(data.handle.handle, &view)
            .expect_err("unknown by_filter predicates must fail closed");
        let message = format!("{error}");
        assert!(
            message.contains("native predicate"),
            "expected native-predicate validation error, got: {message}"
        );
    }

    #[test]
    fn target_values_are_sample_level_and_dedup_repetitions() {
        let arena = CoordinatorHandleArena::new("controller:data.provider").unwrap();
        let data = arena.materialize(&envelope(), &request()).unwrap();
        let view = DataView {
            sample_ids: Some(vec![SampleId::new("S001").unwrap()]),
            include_augmented: false,
            ..Default::default()
        };
        let view_record = arena.make_view(data.handle.handle, &view).unwrap();
        let target_table = CoordinatorTargetTable {
            target_id: TargetId::new("y").unwrap(),
            values: vec![
                CoordinatorTargetValue {
                    sample_id: SampleId::new("S001").unwrap(),
                    value: json!(42.0),
                },
                CoordinatorTargetValue {
                    sample_id: SampleId::new("S002").unwrap(),
                    value: json!(7.0),
                },
            ],
        };

        let target = arena
            .target_values(view_record.handle.handle, &target_table)
            .unwrap();

        assert_eq!(target.target_id.as_str(), "y");
        assert_eq!(target.sample_ids, vec![SampleId::new("S001").unwrap()]);
        assert_eq!(target.values, vec![json!(42.0)]);
    }

    #[test]
    fn multi_target_values_align_samples_and_emit_validity_masks() {
        let arena = CoordinatorHandleArena::new("controller:data.provider").unwrap();
        let data = arena.materialize(&envelope(), &request()).unwrap();
        let view = DataView {
            sample_ids: Some(vec![
                SampleId::new("S002").unwrap(),
                SampleId::new("S001").unwrap(),
            ]),
            include_augmented: false,
            ..Default::default()
        };
        let view_record = arena.make_view(data.handle.handle, &view).unwrap();
        let y = CoordinatorTargetTable {
            target_id: TargetId::new("y").unwrap(),
            values: vec![
                CoordinatorTargetValue {
                    sample_id: SampleId::new("S001").unwrap(),
                    value: json!(42.0),
                },
                CoordinatorTargetValue {
                    sample_id: SampleId::new("S002").unwrap(),
                    value: json!(7.0),
                },
            ],
        };
        let protein = CoordinatorTargetTable {
            target_id: TargetId::new("protein").unwrap(),
            values: vec![CoordinatorTargetValue {
                sample_id: SampleId::new("S001").unwrap(),
                value: json!(12.5),
            }],
        };

        let block = arena
            .multi_target_values(view_record.handle.handle, &[y, protein])
            .unwrap();

        assert_eq!(
            block.target_ids,
            vec![
                TargetId::new("y").unwrap(),
                TargetId::new("protein").unwrap()
            ]
        );
        assert_eq!(
            block.sample_ids,
            vec![
                SampleId::new("S002").unwrap(),
                SampleId::new("S001").unwrap()
            ]
        );
        assert_eq!(block.values[0], vec![json!(7.0), json!(42.0)]);
        assert_eq!(block.validity_masks[0], vec![true, true]);
        assert_eq!(block.values[1], vec![json!(null), json!(12.5)]);
        assert_eq!(block.validity_masks[1], vec![false, true]);
    }

    #[test]
    fn feature_values_are_observation_level_and_filter_columns() {
        let arena = CoordinatorHandleArena::new("controller:data.provider").unwrap();
        let data = arena.materialize(&envelope(), &request()).unwrap();
        let view = DataView {
            sample_ids: Some(vec![SampleId::new("S001").unwrap()]),
            columns: Some(vec!["f1".to_string()]),
            include_augmented: false,
            ..Default::default()
        };
        let view_record = arena.make_view(data.handle.handle, &view).unwrap();
        let feature_table = CoordinatorFeatureTable {
            feature_set_id: "x".to_string(),
            representation_id: RepresentationId::new("tabular_numeric").unwrap(),
            feature_names: vec!["f0".to_string(), "f1".to_string()],
            rows: vec![
                CoordinatorFeatureRow {
                    observation_id: ObservationId::new("obs.S001.base").unwrap(),
                    values: vec![json!(1.0), json!(10.0)],
                },
                CoordinatorFeatureRow {
                    observation_id: ObservationId::new("obs.S001.rep1").unwrap(),
                    values: vec![json!(2.0), json!(20.0)],
                },
                CoordinatorFeatureRow {
                    observation_id: ObservationId::new("obs.S001.aug0").unwrap(),
                    values: vec![json!(3.0), json!(30.0)],
                },
                CoordinatorFeatureRow {
                    observation_id: ObservationId::new("obs.S002.base").unwrap(),
                    values: vec![json!(4.0), json!(40.0)],
                },
            ],
        };

        let features = arena
            .feature_values(view_record.handle.handle, &feature_table)
            .unwrap();

        assert_eq!(features.feature_set_id, "x");
        assert_eq!(features.feature_names, vec!["f1".to_string()]);
        assert_eq!(features.representation_id.as_str(), "tabular_numeric");
        assert_eq!(
            features.observation_ids,
            vec![
                ObservationId::new("obs.S001.base").unwrap(),
                ObservationId::new("obs.S001.rep1").unwrap(),
            ]
        );
        assert_eq!(
            features.sample_ids,
            vec![
                SampleId::new("S001").unwrap(),
                SampleId::new("S001").unwrap()
            ]
        );
        assert_eq!(features.values, vec![vec![json!(10.0)], vec![json!(20.0)]]);

        let mut wrong_representation = feature_table;
        wrong_representation.representation_id = RepresentationId::new("dense_signal").unwrap();
        assert!(arena
            .feature_values(view_record.handle.handle, &wrong_representation)
            .is_err());
    }

    #[test]
    fn view_honors_requested_sample_order_for_identity_targets_and_features() {
        let arena = CoordinatorHandleArena::new("controller:data.provider").unwrap();
        let data = arena.materialize(&envelope(), &request()).unwrap();
        let view = DataView {
            sample_ids: Some(vec![
                SampleId::new("S002").unwrap(),
                SampleId::new("S001").unwrap(),
            ]),
            include_augmented: false,
            ..Default::default()
        };
        let view_record = arena.make_view(data.handle.handle, &view).unwrap();

        let identity = arena.view_identity(view_record.handle.handle).unwrap();
        assert_eq!(
            identity
                .records
                .iter()
                .map(|relation| relation.observation_id.as_str())
                .collect::<Vec<_>>(),
            vec!["obs.S002.base", "obs.S001.base", "obs.S001.rep1"]
        );

        let target_table = CoordinatorTargetTable {
            target_id: TargetId::new("y").unwrap(),
            values: vec![
                CoordinatorTargetValue {
                    sample_id: SampleId::new("S001").unwrap(),
                    value: json!(42.0),
                },
                CoordinatorTargetValue {
                    sample_id: SampleId::new("S002").unwrap(),
                    value: json!(7.0),
                },
            ],
        };
        let target = arena
            .target_values(view_record.handle.handle, &target_table)
            .unwrap();
        assert_eq!(
            target.sample_ids,
            vec![
                SampleId::new("S002").unwrap(),
                SampleId::new("S001").unwrap()
            ]
        );
        assert_eq!(target.values, vec![json!(7.0), json!(42.0)]);

        let feature_table = CoordinatorFeatureTable {
            feature_set_id: "x".to_string(),
            representation_id: RepresentationId::new("tabular_numeric").unwrap(),
            feature_names: vec!["f0".to_string(), "f1".to_string()],
            rows: vec![
                CoordinatorFeatureRow {
                    observation_id: ObservationId::new("obs.S001.base").unwrap(),
                    values: vec![json!(1.0), json!(10.0)],
                },
                CoordinatorFeatureRow {
                    observation_id: ObservationId::new("obs.S001.rep1").unwrap(),
                    values: vec![json!(2.0), json!(20.0)],
                },
                CoordinatorFeatureRow {
                    observation_id: ObservationId::new("obs.S002.base").unwrap(),
                    values: vec![json!(4.0), json!(40.0)],
                },
            ],
        };
        let features = arena
            .feature_values(view_record.handle.handle, &feature_table)
            .unwrap();
        assert_eq!(
            features.observation_ids,
            vec![
                ObservationId::new("obs.S002.base").unwrap(),
                ObservationId::new("obs.S001.base").unwrap(),
                ObservationId::new("obs.S001.rep1").unwrap(),
            ]
        );
        assert_eq!(
            features.values,
            vec![
                vec![json!(4.0), json!(40.0)],
                vec![json!(1.0), json!(10.0)],
                vec![json!(2.0), json!(20.0)],
            ]
        );
    }

    #[test]
    fn release_data_handle_releases_child_views() {
        let arena = CoordinatorHandleArena::new("controller:data.provider").unwrap();
        let data = arena.materialize(&envelope(), &request()).unwrap();
        let view_record = arena
            .make_view(data.handle.handle, &DataView::default())
            .unwrap();

        assert!(arena.release_handle(data.handle.handle));
        assert_eq!(arena.handle_record(data.handle.handle), None);
        assert_eq!(arena.view_record(view_record.handle.handle), None);
        let error = arena.view_identity(view_record.handle.handle).unwrap_err();
        assert_eq!(error.category(), "runtime");
        assert_eq!(error.code(), "unknown_handle");
        assert_eq!(error.error_code(), 0x0001_0001);
        assert!(!arena.release_handle(data.handle.handle));
    }
}

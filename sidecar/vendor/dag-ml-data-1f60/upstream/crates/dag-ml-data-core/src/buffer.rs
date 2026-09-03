use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::content_hash::StreamingHasher;
use crate::coordinator::CoordinatorRelationSet;
use crate::error::{DataError, Result};
use crate::handle::{CoordinatorFeatureBlock, CoordinatorFeatureBlockF64, CoordinatorFeatureTable};
use crate::ids::{ObservationId, RepresentationId, SourceId};

pub const NUMERIC_FEATURE_BUFFER_MANIFEST_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Debug, PartialEq)]
pub struct NumericFeatureBuffer {
    pub feature_set_id: String,
    pub representation_id: RepresentationId,
    pub feature_names: Vec<String>,
    pub observation_ids: Vec<ObservationId>,
    columns: Vec<Vec<Option<f64>>>,
    row_index_by_observation: BTreeMap<ObservationId, usize>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct NumericFeatureBufferManifest {
    pub schema_version: u32,
    pub feature_set_id: String,
    pub representation_id: RepresentationId,
    pub feature_names: Vec<String>,
    pub observation_ids: Vec<ObservationId>,
    pub row_count: usize,
    pub feature_count: usize,
    pub value_count: usize,
    pub estimated_value_bytes: usize,
    pub buffer_fingerprint: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct NumericFeatureBufferBinding {
    pub feature_set_id: String,
    pub representation_id: RepresentationId,
    pub source_ids: Vec<SourceId>,
    pub row_count: usize,
    pub feature_count: usize,
    pub buffer_fingerprint: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NumericFeatureMatrixF64 {
    pub feature_set_id: String,
    pub representation_id: RepresentationId,
    pub feature_names: Vec<String>,
    pub observation_ids: Vec<ObservationId>,
    pub values: Vec<f64>,
    #[serde(default)]
    pub validity_mask: Option<Vec<bool>>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NumericFeatureMatrixF64Columnar {
    pub feature_set_id: String,
    pub representation_id: RepresentationId,
    pub feature_names: Vec<String>,
    pub observation_ids: Vec<ObservationId>,
    pub columns: Vec<Vec<f64>>,
    #[serde(default)]
    pub validity_masks: Option<Vec<Vec<bool>>>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct NumericFeatureBufferStore {
    buffers: BTreeMap<String, NumericFeatureBuffer>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct NumericFeatureBufferArena {
    store: NumericFeatureBufferStore,
    data_bindings: BTreeMap<u64, BTreeMap<String, NumericFeatureBufferBinding>>,
}

impl NumericFeatureBuffer {
    pub fn from_feature_table(table: CoordinatorFeatureTable) -> Result<Self> {
        table.validate()?;
        let row_count = table.rows.len();
        let mut observation_ids = Vec::with_capacity(row_count);
        let mut columns = (0..table.feature_names.len())
            .map(|_| Vec::with_capacity(row_count))
            .collect::<Vec<_>>();
        let mut row_index_by_observation = BTreeMap::new();

        for (row_idx, row) in table.rows.into_iter().enumerate() {
            if row_index_by_observation
                .insert(row.observation_id.clone(), row_idx)
                .is_some()
            {
                return Err(DataError::Validation(format!(
                    "feature table `{}` contains duplicate observation `{}`",
                    table.feature_set_id, row.observation_id
                )));
            }
            observation_ids.push(row.observation_id.clone());
            for (feature_idx, value) in row.values.into_iter().enumerate() {
                let feature_name = &table.feature_names[feature_idx];
                columns[feature_idx].push(numeric_feature_value(
                    &table.feature_set_id,
                    &row.observation_id,
                    feature_name,
                    value,
                )?);
            }
        }

        Ok(Self {
            feature_set_id: table.feature_set_id,
            representation_id: table.representation_id,
            feature_names: table.feature_names,
            observation_ids,
            columns,
            row_index_by_observation,
        })
    }

    pub fn from_f64_matrix(matrix: NumericFeatureMatrixF64) -> Result<Self> {
        matrix.validate()?;
        let row_count = matrix.observation_ids.len();
        let feature_count = matrix.feature_names.len();
        let mut columns = (0..feature_count)
            .map(|_| Vec::with_capacity(row_count))
            .collect::<Vec<_>>();
        for row_idx in 0..row_count {
            for (feature_idx, column) in columns.iter_mut().enumerate() {
                let flat_idx = row_idx * feature_count + feature_idx;
                let is_valid = matrix
                    .validity_mask
                    .as_ref()
                    .map(|mask| mask[flat_idx])
                    .unwrap_or(true);
                column.push(is_valid.then_some(matrix.values[flat_idx]));
            }
        }
        let row_index_by_observation = matrix
            .observation_ids
            .iter()
            .cloned()
            .enumerate()
            .map(|(idx, observation_id)| (observation_id, idx))
            .collect();

        Ok(Self {
            feature_set_id: matrix.feature_set_id,
            representation_id: matrix.representation_id,
            feature_names: matrix.feature_names,
            observation_ids: matrix.observation_ids,
            columns,
            row_index_by_observation,
        })
    }

    pub fn from_f64_column_matrix(matrix: NumericFeatureMatrixF64Columnar) -> Result<Self> {
        matrix.validate()?;
        let row_count = matrix.observation_ids.len();
        let mut columns = Vec::with_capacity(matrix.feature_names.len());
        for (feature_idx, column_values) in matrix.columns.into_iter().enumerate() {
            let mask = matrix
                .validity_masks
                .as_ref()
                .map(|masks| masks[feature_idx].as_slice());
            let mut column = Vec::with_capacity(row_count);
            for (row_idx, value) in column_values.into_iter().enumerate() {
                let is_valid = mask.map(|mask| mask[row_idx]).unwrap_or(true);
                column.push(is_valid.then_some(value));
            }
            columns.push(column);
        }
        let row_index_by_observation = matrix
            .observation_ids
            .iter()
            .cloned()
            .enumerate()
            .map(|(idx, observation_id)| (observation_id, idx))
            .collect();

        Ok(Self {
            feature_set_id: matrix.feature_set_id,
            representation_id: matrix.representation_id,
            feature_names: matrix.feature_names,
            observation_ids: matrix.observation_ids,
            columns,
            row_index_by_observation,
        })
    }

    pub fn row_count(&self) -> usize {
        self.observation_ids.len()
    }

    pub fn feature_count(&self) -> usize {
        self.feature_names.len()
    }

    pub fn value_count(&self) -> usize {
        self.row_count() * self.feature_count()
    }

    pub fn estimated_value_bytes(&self) -> usize {
        self.value_count() * std::mem::size_of::<f64>()
    }

    pub fn contains_observation(&self, observation_id: &ObservationId) -> bool {
        self.row_index_by_observation.contains_key(observation_id)
    }

    /// Reproducibility fingerprint of the buffer's logical content as a 64-char
    /// lowercase hex SHA-256.
    ///
    /// The preimage is fed to the hasher incrementally — there is NO
    /// `O(n_cells)` intermediate byte vector or per-cell boxed value — so a
    /// multi-million-cell matrix costs one fixed scratch buffer, not a
    /// transient copy of the whole payload (the old `serde_json::to_vec` path).
    ///
    /// Preimage layout (every multi-byte field little-endian; every
    /// variable-length field/collection length-prefixed so framing is
    /// unambiguous):
    ///
    /// ```text
    /// domain tag  b"dag-ml-data.numeric-feature-buffer.v2\0"   (fixed literal)
    /// feature_set_id        : str   (u64 byte-len, then UTF-8)
    /// representation_id     : str   (u64 byte-len, then UTF-8)
    /// feature_names         : str[] (u64 count, then each str)
    /// observation_ids       : str[] (u64 count, then each str)
    /// n_rows                : u64   (fixed-width LE)
    /// n_cols                : u64   (fixed-width LE)
    /// cells row-major over (row, col):
    ///   each cell           : 1 presence byte (1=Some, 0=None) + 8 LE f64 bytes
    /// ```
    ///
    /// Rationale for the load-bearing choices:
    /// * **Shape is hashed explicitly** as fixed-width `n_rows`/`n_cols`, and the
    ///   cell stream is emitted in one fixed traversal, so a `2x3` and a `3x2`
    ///   buffer with identical flat values produce different digests.
    /// * **Storage is column-major** (`columns[feature][row]`); we deliberately
    ///   traverse **row-major** over `(row, col)` and document that fixed order
    ///   here. The constructors normalize both row-major and column-major typed
    ///   inputs into the same `columns` storage, so the same logical matrix
    ///   always streams in the same order regardless of input layout.
    /// * **Masked cells** emit a `0` presence byte then 8 zero value bytes, a
    ///   fixed 9-byte stride. The presence byte alone separates `None` from
    ///   `Some(0.0)` (whose value bytes are also all zero), so a mask flip is
    ///   never indistinguishable from a real value.
    pub fn fingerprint(&self) -> Result<String> {
        let mut hasher = StreamingHasher::new(b"dag-ml-data.numeric-feature-buffer.v2\0");
        hasher.absorb_str(&self.feature_set_id);
        hasher.absorb_str(self.representation_id.as_str());
        hasher.absorb_str_collection(self.feature_names.iter().map(String::as_str));
        hasher.absorb_str_collection(self.observation_ids.iter().map(ObservationId::as_str));
        let n_rows = self.row_count();
        let n_cols = self.feature_count();
        hasher.absorb_len(n_rows);
        hasher.absorb_len(n_cols);
        for row in 0..n_rows {
            for column in &self.columns {
                hasher.absorb_cell(column[row]);
            }
        }
        Ok(hasher.finalize_hex())
    }

    pub fn manifest(&self) -> Result<NumericFeatureBufferManifest> {
        Ok(NumericFeatureBufferManifest {
            schema_version: NUMERIC_FEATURE_BUFFER_MANIFEST_SCHEMA_VERSION,
            feature_set_id: self.feature_set_id.clone(),
            representation_id: self.representation_id.clone(),
            feature_names: self.feature_names.clone(),
            observation_ids: self.observation_ids.clone(),
            row_count: self.row_count(),
            feature_count: self.feature_count(),
            value_count: self.value_count(),
            estimated_value_bytes: self.estimated_value_bytes(),
            buffer_fingerprint: self.fingerprint()?,
        })
    }

    /// Returns the buffer's contents as a `NumericFeatureMatrixF64Columnar`,
    /// suitable for binary persistence or pass-through to other typed-input
    /// constructors. The output is the inverse of
    /// `NumericFeatureBuffer::from_f64_column_matrix`: a round-trip through
    /// this method and the constructor preserves the buffer fingerprint.
    pub fn to_f64_column_matrix(&self) -> NumericFeatureMatrixF64Columnar {
        let row_count = self.row_count();
        let mut columns = Vec::with_capacity(self.columns.len());
        let mut masks = Vec::with_capacity(self.columns.len());
        let mut any_null = false;
        for column in &self.columns {
            let mut values = Vec::with_capacity(row_count);
            let mut mask = Vec::with_capacity(row_count);
            for cell in column {
                match cell {
                    Some(value) => {
                        values.push(*value);
                        mask.push(true);
                    }
                    None => {
                        values.push(0.0);
                        mask.push(false);
                        any_null = true;
                    }
                }
            }
            columns.push(values);
            masks.push(mask);
        }
        NumericFeatureMatrixF64Columnar {
            feature_set_id: self.feature_set_id.clone(),
            representation_id: self.representation_id.clone(),
            feature_names: self.feature_names.clone(),
            observation_ids: self.observation_ids.clone(),
            columns,
            validity_masks: any_null.then_some(masks),
        }
    }

    pub fn selected_indices(&self, columns: Option<&[String]>) -> Result<Vec<usize>> {
        let index_by_name = self
            .feature_names
            .iter()
            .enumerate()
            .map(|(idx, name)| (name, idx))
            .collect::<BTreeMap<_, _>>();
        let indices = if let Some(columns) = columns {
            let mut seen = BTreeSet::new();
            columns
                .iter()
                .map(|column| {
                    if !seen.insert(column) {
                        return Err(DataError::Validation(format!(
                            "feature table `{}` selected duplicate feature column `{}`",
                            self.feature_set_id, column
                        )));
                    }
                    index_by_name.get(column).copied().ok_or_else(|| {
                        DataError::Validation(format!(
                            "feature table `{}` has no feature column `{}`",
                            self.feature_set_id, column
                        ))
                    })
                })
                .collect::<Result<Vec<_>>>()?
        } else {
            (0..self.feature_names.len()).collect()
        };
        if indices.is_empty() {
            return Err(DataError::Validation(format!(
                "feature table `{}` selected no feature columns",
                self.feature_set_id
            )));
        }
        Ok(indices)
    }

    pub fn project_relations(
        &self,
        relations: &CoordinatorRelationSet,
        source_id: Option<&SourceId>,
        columns: Option<&[String]>,
    ) -> Result<CoordinatorFeatureBlock> {
        relations.validate()?;
        let selected_indices = self.selected_indices(columns)?;
        let mut observation_ids = Vec::with_capacity(relations.records.len());
        let mut sample_ids = Vec::with_capacity(relations.records.len());
        let mut values = Vec::with_capacity(relations.records.len());

        for relation in relations.records.iter().filter(|relation| {
            source_id
                .map(|source_id| relation.source_id.as_ref() == Some(source_id))
                .unwrap_or(true)
        }) {
            let row_idx = self
                .row_index_by_observation
                .get(&relation.observation_id)
                .ok_or_else(|| {
                    DataError::Validation(format!(
                        "feature table `{}` has no row for observation `{}`",
                        self.feature_set_id, relation.observation_id
                    ))
                })?;
            observation_ids.push(relation.observation_id.clone());
            sample_ids.push(relation.sample_id.clone());
            values.push(
                selected_indices
                    .iter()
                    .map(|feature_idx| {
                        self.columns[*feature_idx][*row_idx]
                            .map_or(serde_json::Value::Null, serde_json::Value::from)
                    })
                    .collect(),
            );
        }

        Ok(CoordinatorFeatureBlock {
            feature_set_id: self.feature_set_id.clone(),
            representation_id: self.representation_id.clone(),
            feature_names: selected_indices
                .iter()
                .map(|idx| self.feature_names[*idx].clone())
                .collect(),
            observation_ids,
            sample_ids,
            values,
        })
    }

    /// Like [`Self::project_relations`] but flattens the cells row-major
    /// straight into one `Vec<f64>` — no `rows × cols` boxed
    /// [`serde_json::Value`]s. This is the hot path for large numeric blocks
    /// crossing a typed-array binding boundary. Masked (invalid) cells are an
    /// error: the typed projection has no `Null` to project them into.
    pub fn project_relations_f64(
        &self,
        relations: &CoordinatorRelationSet,
        source_id: Option<&SourceId>,
        columns: Option<&[String]>,
    ) -> Result<CoordinatorFeatureBlockF64> {
        relations.validate()?;
        let selected_indices = self.selected_indices(columns)?;
        let mut observation_ids = Vec::with_capacity(relations.records.len());
        let mut sample_ids = Vec::with_capacity(relations.records.len());
        let mut values = Vec::with_capacity(relations.records.len() * selected_indices.len());

        for relation in relations.records.iter().filter(|relation| {
            source_id
                .map(|source_id| relation.source_id.as_ref() == Some(source_id))
                .unwrap_or(true)
        }) {
            let row_idx = self
                .row_index_by_observation
                .get(&relation.observation_id)
                .ok_or_else(|| {
                    DataError::Validation(format!(
                        "feature table `{}` has no row for observation `{}`",
                        self.feature_set_id, relation.observation_id
                    ))
                })?;
            for feature_idx in &selected_indices {
                values.push(self.columns[*feature_idx][*row_idx].ok_or_else(|| {
                    DataError::Validation(format!(
                        "feature table `{}` observation `{}` feature `{}` is masked; the typed f64 projection requires fully numeric values",
                        self.feature_set_id,
                        relation.observation_id,
                        self.feature_names[*feature_idx]
                    ))
                })?);
            }
            observation_ids.push(relation.observation_id.clone());
            sample_ids.push(relation.sample_id.clone());
        }

        Ok(CoordinatorFeatureBlockF64 {
            feature_set_id: self.feature_set_id.clone(),
            representation_id: self.representation_id.clone(),
            feature_names: selected_indices
                .iter()
                .map(|idx| self.feature_names[*idx].clone())
                .collect(),
            observation_ids,
            sample_ids,
            values,
        })
    }

    fn binding_for_sources(
        &self,
        source_ids: Vec<SourceId>,
    ) -> Result<NumericFeatureBufferBinding> {
        Ok(NumericFeatureBufferBinding {
            feature_set_id: self.feature_set_id.clone(),
            representation_id: self.representation_id.clone(),
            source_ids,
            row_count: self.row_count(),
            feature_count: self.feature_count(),
            buffer_fingerprint: self.fingerprint()?,
        })
    }
}

impl NumericFeatureMatrixF64 {
    pub fn validate(&self) -> Result<()> {
        validate_feature_shape(
            &self.feature_set_id,
            &self.feature_names,
            &self.observation_ids,
        )?;
        let expected_values = self.feature_names.len() * self.observation_ids.len();
        if self.values.len() != expected_values {
            return Err(DataError::Validation(format!(
                "f64 feature matrix `{}` has {} values for {} observations x {} features",
                self.feature_set_id,
                self.values.len(),
                self.observation_ids.len(),
                self.feature_names.len()
            )));
        }
        if let Some(validity_mask) = &self.validity_mask {
            if validity_mask.len() != expected_values {
                return Err(DataError::Validation(format!(
                    "f64 feature matrix `{}` validity_mask has {} values for {} observations x {} features",
                    self.feature_set_id,
                    validity_mask.len(),
                    self.observation_ids.len(),
                    self.feature_names.len()
                )));
            }
        }
        for (idx, value) in self.values.iter().enumerate() {
            let is_valid = self
                .validity_mask
                .as_ref()
                .map(|mask| mask[idx])
                .unwrap_or(true);
            if is_valid && !value.is_finite() {
                return Err(DataError::Validation(format!(
                    "f64 feature matrix `{}` value {} is not finite",
                    self.feature_set_id, idx
                )));
            }
        }
        Ok(())
    }
}

impl NumericFeatureMatrixF64Columnar {
    pub fn validate(&self) -> Result<()> {
        validate_feature_shape(
            &self.feature_set_id,
            &self.feature_names,
            &self.observation_ids,
        )?;
        if self.columns.len() != self.feature_names.len() {
            return Err(DataError::Validation(format!(
                "f64 columnar feature matrix `{}` has {} columns for {} features",
                self.feature_set_id,
                self.columns.len(),
                self.feature_names.len()
            )));
        }
        if let Some(validity_masks) = &self.validity_masks {
            if validity_masks.len() != self.feature_names.len() {
                return Err(DataError::Validation(format!(
                    "f64 columnar feature matrix `{}` has {} validity_masks for {} features",
                    self.feature_set_id,
                    validity_masks.len(),
                    self.feature_names.len()
                )));
            }
        }
        let row_count = self.observation_ids.len();
        for (feature_idx, column) in self.columns.iter().enumerate() {
            if column.len() != row_count {
                return Err(DataError::Validation(format!(
                    "f64 columnar feature matrix `{}` column {} has {} values for {} observations",
                    self.feature_set_id,
                    feature_idx,
                    column.len(),
                    row_count
                )));
            }
            let mask = self
                .validity_masks
                .as_ref()
                .map(|masks| masks[feature_idx].as_slice());
            if let Some(mask) = mask {
                if mask.len() != row_count {
                    return Err(DataError::Validation(format!(
                        "f64 columnar feature matrix `{}` column {} validity_mask has {} values for {} observations",
                        self.feature_set_id,
                        feature_idx,
                        mask.len(),
                        row_count
                    )));
                }
            }
            for (row_idx, value) in column.iter().enumerate() {
                let is_valid = mask.map(|mask| mask[row_idx]).unwrap_or(true);
                if is_valid && !value.is_finite() {
                    return Err(DataError::Validation(format!(
                        "f64 columnar feature matrix `{}` column {} row {} is not finite",
                        self.feature_set_id, feature_idx, row_idx
                    )));
                }
            }
        }
        Ok(())
    }
}

impl NumericFeatureBufferStore {
    pub fn new(buffers: BTreeMap<String, NumericFeatureBuffer>) -> Result<Self> {
        for (feature_set_id, buffer) in &buffers {
            if feature_set_id != &buffer.feature_set_id {
                return Err(DataError::Validation(format!(
                    "feature buffer store key `{feature_set_id}` does not match buffer feature_set_id `{}`",
                    buffer.feature_set_id
                )));
            }
        }
        Ok(Self { buffers })
    }

    pub fn from_feature_tables(tables: Vec<CoordinatorFeatureTable>) -> Result<Self> {
        let mut buffers = BTreeMap::new();
        for table in tables {
            let feature_set_id = table.feature_set_id.clone();
            let buffer = NumericFeatureBuffer::from_feature_table(table)?;
            if buffers.insert(feature_set_id.clone(), buffer).is_some() {
                return Err(DataError::Validation(format!(
                    "duplicate feature table `{feature_set_id}`"
                )));
            }
        }
        Self::new(buffers)
    }

    pub fn from_f64_matrices(matrices: Vec<NumericFeatureMatrixF64>) -> Result<Self> {
        let mut buffers = BTreeMap::new();
        for matrix in matrices {
            let feature_set_id = matrix.feature_set_id.clone();
            let buffer = NumericFeatureBuffer::from_f64_matrix(matrix)?;
            if buffers.insert(feature_set_id.clone(), buffer).is_some() {
                return Err(DataError::Validation(format!(
                    "duplicate f64 feature matrix `{feature_set_id}`"
                )));
            }
        }
        Self::new(buffers)
    }

    pub fn from_f64_column_matrices(
        matrices: Vec<NumericFeatureMatrixF64Columnar>,
    ) -> Result<Self> {
        let mut buffers = BTreeMap::new();
        for matrix in matrices {
            let feature_set_id = matrix.feature_set_id.clone();
            let buffer = NumericFeatureBuffer::from_f64_column_matrix(matrix)?;
            if buffers.insert(feature_set_id.clone(), buffer).is_some() {
                return Err(DataError::Validation(format!(
                    "duplicate f64 columnar feature matrix `{feature_set_id}`"
                )));
            }
        }
        Self::new(buffers)
    }

    pub fn is_empty(&self) -> bool {
        self.buffers.is_empty()
    }

    pub fn len(&self) -> usize {
        self.buffers.len()
    }

    pub fn get(&self, feature_set_id: &str) -> Option<&NumericFeatureBuffer> {
        self.buffers.get(feature_set_id)
    }

    /// Deterministic iteration over `(feature_set_id, buffer)` pairs in
    /// ascending `feature_set_id` order. Used by the file-store serializer
    /// to produce byte-identical output for byte-identical stores.
    pub fn iter(&self) -> impl Iterator<Item = (&String, &NumericFeatureBuffer)> {
        self.buffers.iter()
    }

    pub fn manifests(&self) -> Result<Vec<NumericFeatureBufferManifest>> {
        self.buffers
            .values()
            .map(NumericFeatureBuffer::manifest)
            .collect()
    }

    pub fn bindings_for_relations(
        &self,
        relations: &CoordinatorRelationSet,
        representation_id: &RepresentationId,
    ) -> Result<Vec<NumericFeatureBufferBinding>> {
        relations.validate()?;
        let source_ids = relations
            .records
            .iter()
            .filter_map(|relation| relation.source_id.as_ref())
            .collect::<BTreeSet<_>>();

        let mut bindings = Vec::new();
        for buffer in self.buffers.values() {
            if &buffer.representation_id != representation_id {
                continue;
            }
            let mut covered_sources = Vec::new();
            if source_ids.is_empty() {
                if relations
                    .records
                    .iter()
                    .all(|relation| buffer.contains_observation(&relation.observation_id))
                {
                    bindings.push(buffer.binding_for_sources(Vec::new())?);
                }
                continue;
            }
            for source_id in &source_ids {
                let source_records = relations
                    .records
                    .iter()
                    .filter(|relation| relation.source_id.as_ref() == Some(*source_id));
                if source_records
                    .clone()
                    .all(|relation| buffer.contains_observation(&relation.observation_id))
                {
                    covered_sources.push((*source_id).clone());
                }
            }
            if !covered_sources.is_empty() {
                bindings.push(buffer.binding_for_sources(covered_sources)?);
            }
        }
        Ok(bindings)
    }

    pub fn project_relations(
        &self,
        feature_set_id: &str,
        relations: &CoordinatorRelationSet,
        source_id: Option<&SourceId>,
        columns: Option<&[String]>,
    ) -> Result<CoordinatorFeatureBlock> {
        let buffer = self.buffers.get(feature_set_id).ok_or_else(|| {
            DataError::Validation(format!("unknown feature buffer `{feature_set_id}`"))
        })?;
        buffer.project_relations(relations, source_id, columns)
    }

    pub fn project_relations_f64(
        &self,
        feature_set_id: &str,
        relations: &CoordinatorRelationSet,
        source_id: Option<&SourceId>,
        columns: Option<&[String]>,
    ) -> Result<CoordinatorFeatureBlockF64> {
        let buffer = self.buffers.get(feature_set_id).ok_or_else(|| {
            DataError::Validation(format!("unknown feature buffer `{feature_set_id}`"))
        })?;
        buffer.project_relations_f64(relations, source_id, columns)
    }
}

impl NumericFeatureBufferArena {
    pub fn new(store: NumericFeatureBufferStore) -> Self {
        Self {
            store,
            data_bindings: BTreeMap::new(),
        }
    }

    pub fn manifests(&self) -> Result<Vec<NumericFeatureBufferManifest>> {
        self.store.manifests()
    }

    pub fn bind_data_handle(
        &mut self,
        data_handle: u64,
        relations: &CoordinatorRelationSet,
        representation_id: &RepresentationId,
    ) -> Result<Vec<NumericFeatureBufferBinding>> {
        let bindings = self
            .store
            .bindings_for_relations(relations, representation_id)?;
        self.data_bindings.insert(
            data_handle,
            bindings
                .iter()
                .cloned()
                .map(|binding| (binding.feature_set_id.clone(), binding))
                .collect(),
        );
        Ok(bindings)
    }

    pub fn release_data_handle(&mut self, data_handle: u64) -> bool {
        self.data_bindings.remove(&data_handle).is_some()
    }

    pub fn bindings_for_data_handle(
        &self,
        data_handle: u64,
    ) -> Result<Vec<NumericFeatureBufferBinding>> {
        let bindings = self.data_bindings.get(&data_handle).ok_or_else(|| {
            DataError::Validation(format!(
                "data handle `{data_handle}` has no feature buffer bindings"
            ))
        })?;
        Ok(bindings.values().cloned().collect())
    }

    pub fn project_bound_relations(
        &self,
        data_handle: u64,
        feature_set_id: &str,
        relations: &CoordinatorRelationSet,
        source_id: Option<&SourceId>,
        columns: Option<&[String]>,
    ) -> Result<CoordinatorFeatureBlock> {
        self.validate_bound_sources(data_handle, feature_set_id, relations, source_id)?;
        self.store
            .project_relations(feature_set_id, relations, source_id, columns)
    }

    pub fn project_bound_relations_f64(
        &self,
        data_handle: u64,
        feature_set_id: &str,
        relations: &CoordinatorRelationSet,
        source_id: Option<&SourceId>,
        columns: Option<&[String]>,
    ) -> Result<CoordinatorFeatureBlockF64> {
        self.validate_bound_sources(data_handle, feature_set_id, relations, source_id)?;
        self.store
            .project_relations_f64(feature_set_id, relations, source_id, columns)
    }

    fn validate_bound_sources(
        &self,
        data_handle: u64,
        feature_set_id: &str,
        relations: &CoordinatorRelationSet,
        source_id: Option<&SourceId>,
    ) -> Result<()> {
        relations.validate()?;
        let binding = self
            .data_bindings
            .get(&data_handle)
            .and_then(|bindings| bindings.get(feature_set_id))
            .ok_or_else(|| {
                DataError::Validation(format!(
                    "feature buffer `{feature_set_id}` is not bound to data handle `{data_handle}`"
                ))
            })?;
        let relation_source_ids = relations
            .records
            .iter()
            .filter_map(|relation| relation.source_id.as_ref())
            .cloned()
            .collect::<BTreeSet<_>>();
        let required_source_ids = if let Some(source_id) = source_id {
            if relation_source_ids.is_empty() || !relation_source_ids.contains(source_id) {
                return Err(DataError::Validation(format!(
                    "feature buffer `{feature_set_id}` source `{source_id}` is not present in view for data handle `{data_handle}`"
                )));
            }
            vec![source_id.clone()]
        } else {
            relation_source_ids.into_iter().collect::<Vec<_>>()
        };
        for source_id in &required_source_ids {
            if !binding.source_ids.contains(source_id) {
                return Err(DataError::Validation(format!(
                    "feature buffer `{feature_set_id}` is not bound to source `{source_id}` for data handle `{data_handle}`"
                )));
            }
        }
        Ok(())
    }
}

fn numeric_feature_value(
    feature_set_id: &str,
    observation_id: &ObservationId,
    feature_name: &str,
    value: serde_json::Value,
) -> Result<Option<f64>> {
    match value {
        serde_json::Value::Null => Ok(None),
        serde_json::Value::Number(number) => number.as_f64().map(Some).ok_or_else(|| {
            DataError::Validation(format!(
                "feature table `{feature_set_id}` row `{observation_id}` feature `{feature_name}` contains a non-f64 numeric value"
            ))
        }),
        _ => Err(DataError::Validation(format!(
            "feature table `{feature_set_id}` row `{observation_id}` feature `{feature_name}` must be numeric or null"
        ))),
    }
}

fn validate_feature_shape(
    feature_set_id: &str,
    feature_names: &[String],
    observation_ids: &[ObservationId],
) -> Result<()> {
    if feature_set_id.trim().is_empty() {
        return Err(DataError::Validation("feature_set_id is empty".to_string()));
    }
    if feature_names.is_empty() {
        return Err(DataError::Validation(format!(
            "feature matrix `{feature_set_id}` contains no features"
        )));
    }
    let mut seen_features = BTreeSet::new();
    for feature_name in feature_names {
        if feature_name.trim().is_empty() {
            return Err(DataError::Validation(format!(
                "feature matrix `{feature_set_id}` contains an empty feature name"
            )));
        }
        if !seen_features.insert(feature_name) {
            return Err(DataError::Validation(format!(
                "feature matrix `{feature_set_id}` contains duplicate feature `{feature_name}`"
            )));
        }
    }
    if observation_ids.is_empty() {
        return Err(DataError::Validation(format!(
            "feature matrix `{feature_set_id}` contains no observations"
        )));
    }
    let mut seen_observations = BTreeSet::new();
    for observation_id in observation_ids {
        if !seen_observations.insert(observation_id) {
            return Err(DataError::Validation(format!(
                "feature matrix `{feature_set_id}` contains duplicate observation `{observation_id}`"
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::coordinator::CoordinatorRelation;
    use crate::handle::CoordinatorFeatureRow;
    use crate::ids::{SampleId, TargetId};

    fn oid(value: &str) -> ObservationId {
        ObservationId::new(value).unwrap()
    }

    fn sid(value: &str) -> SampleId {
        SampleId::new(value).unwrap()
    }

    fn source(value: &str) -> SourceId {
        SourceId::new(value).unwrap()
    }

    fn table() -> CoordinatorFeatureTable {
        CoordinatorFeatureTable {
            feature_set_id: "x".to_string(),
            representation_id: RepresentationId::new("tabular_numeric").unwrap(),
            feature_names: vec!["f0".to_string(), "f1".to_string()],
            rows: vec![
                CoordinatorFeatureRow {
                    observation_id: oid("obs.s1.nir"),
                    values: vec![serde_json::json!(1.0), serde_json::json!(10.0)],
                },
                CoordinatorFeatureRow {
                    observation_id: oid("obs.s1.chem"),
                    values: vec![serde_json::json!(2.0), serde_json::json!(20.0)],
                },
                CoordinatorFeatureRow {
                    observation_id: oid("obs.s2.nir"),
                    values: vec![serde_json::json!(3.0), serde_json::Value::Null],
                },
            ],
        }
    }

    fn f64_matrix() -> NumericFeatureMatrixF64 {
        NumericFeatureMatrixF64 {
            feature_set_id: "x".to_string(),
            representation_id: RepresentationId::new("tabular_numeric").unwrap(),
            feature_names: vec!["f0".to_string(), "f1".to_string()],
            observation_ids: vec![oid("obs.s1.nir"), oid("obs.s1.chem"), oid("obs.s2.nir")],
            values: vec![1.0, 10.0, 2.0, 20.0, 3.0, 0.0],
            validity_mask: Some(vec![true, true, true, true, true, false]),
        }
    }

    fn f64_column_matrix() -> NumericFeatureMatrixF64Columnar {
        NumericFeatureMatrixF64Columnar {
            feature_set_id: "x".to_string(),
            representation_id: RepresentationId::new("tabular_numeric").unwrap(),
            feature_names: vec!["f0".to_string(), "f1".to_string()],
            observation_ids: vec![oid("obs.s1.nir"), oid("obs.s1.chem"), oid("obs.s2.nir")],
            columns: vec![vec![1.0, 2.0, 3.0], vec![10.0, 20.0, 0.0]],
            validity_masks: Some(vec![vec![true, true, true], vec![true, true, false]]),
        }
    }

    fn relations() -> CoordinatorRelationSet {
        CoordinatorRelationSet {
            records: vec![
                relation("obs.s2.nir", "S2", "nir"),
                relation("obs.s1.nir", "S1", "nir"),
                relation("obs.s1.chem", "S1", "chem"),
            ],
        }
    }

    fn relation(observation_id: &str, sample_id: &str, source_id: &str) -> CoordinatorRelation {
        CoordinatorRelation {
            observation_id: oid(observation_id),
            sample_id: sid(sample_id),
            target_id: Some(TargetId::new("y").unwrap()),
            group_id: None,
            origin_sample_id: None,
            source_id: Some(source(source_id)),
            is_augmented: false,
            excluded: false,
            metadata: BTreeMap::new(),
            tags: Vec::new(),
        }
    }

    #[test]
    fn projects_view_relations_from_columnar_numeric_buffer() {
        let buffer = NumericFeatureBuffer::from_feature_table(table()).unwrap();
        assert_eq!(buffer.row_count(), 3);
        assert_eq!(buffer.feature_count(), 2);
        assert_eq!(buffer.value_count(), 6);
        let manifest = buffer.manifest().unwrap();
        assert_eq!(
            manifest.schema_version,
            NUMERIC_FEATURE_BUFFER_MANIFEST_SCHEMA_VERSION
        );
        assert_eq!(manifest.row_count, 3);
        assert_eq!(manifest.feature_count, 2);
        assert_eq!(manifest.value_count, 6);
        assert_eq!(manifest.estimated_value_bytes, 48);
        assert_eq!(manifest.buffer_fingerprint.len(), 64);

        let block = buffer
            .project_relations(
                &relations(),
                Some(&source("nir")),
                Some(&["f1".to_string()]),
            )
            .unwrap();

        assert_eq!(block.feature_set_id, "x");
        assert_eq!(block.feature_names, vec!["f1".to_string()]);
        assert_eq!(
            block.observation_ids,
            vec![oid("obs.s2.nir"), oid("obs.s1.nir")]
        );
        assert_eq!(block.sample_ids, vec![sid("S2"), sid("S1")]);
        assert_eq!(
            block.values,
            vec![vec![serde_json::Value::Null], vec![serde_json::json!(10.0)]]
        );
    }

    #[test]
    fn typed_f64_projection_matches_boxed_projection() {
        // Unmasked buffer: project_relations_f64 must yield the boxed block's
        // rows concatenated row-major, with identical ids/names/ordering.
        let mut matrix = f64_matrix();
        matrix.validity_mask = None;
        matrix.values = vec![1.0, 10.0, 2.0, 20.0, 3.0, 30.0];
        let buffer = NumericFeatureBuffer::from_f64_matrix(matrix).unwrap();

        let boxed = buffer.project_relations(&relations(), None, None).unwrap();
        let typed = buffer
            .project_relations_f64(&relations(), None, None)
            .unwrap();

        assert_eq!(typed.feature_set_id, boxed.feature_set_id);
        assert_eq!(typed.representation_id, boxed.representation_id);
        assert_eq!(typed.feature_names, boxed.feature_names);
        assert_eq!(typed.observation_ids, boxed.observation_ids);
        assert_eq!(typed.sample_ids, boxed.sample_ids);
        let expected: Vec<f64> = boxed
            .values
            .iter()
            .flat_map(|row| row.iter().map(|v| v.as_f64().unwrap()))
            .collect();
        assert_eq!(typed.values, expected);
    }

    #[test]
    fn typed_f64_projection_rejects_masked_cells() {
        // f64_matrix() masks obs.s2.nir/f1 — the boxed path projects Null, the
        // typed path must refuse (it has no Null to project into).
        let buffer = NumericFeatureBuffer::from_f64_matrix(f64_matrix()).unwrap();
        let error = buffer
            .project_relations_f64(&relations(), None, None)
            .unwrap_err();
        assert!(format!("{error}").contains("is masked"));
    }

    #[test]
    fn rejects_duplicate_selected_columns() {
        let buffer = NumericFeatureBuffer::from_feature_table(table()).unwrap();
        let error = buffer
            .selected_indices(Some(&["f0".to_string(), "f0".to_string()]))
            .unwrap_err();
        assert!(format!("{error}").contains("duplicate feature column"));
    }

    #[test]
    fn rejects_missing_observation_in_projection() {
        let buffer = NumericFeatureBuffer::from_feature_table(table()).unwrap();
        let missing = CoordinatorRelationSet {
            records: vec![relation("obs.missing", "S9", "nir")],
        };
        let error = buffer.project_relations(&missing, None, None).unwrap_err();
        assert!(format!("{error}").contains("has no row for observation"));
    }

    #[test]
    fn builds_columnar_buffer_from_row_major_f64_matrix() {
        let buffer = NumericFeatureBuffer::from_f64_matrix(f64_matrix()).unwrap();
        assert_eq!(buffer.row_count(), 3);
        assert_eq!(buffer.feature_count(), 2);

        let block = buffer
            .project_relations(&relations(), Some(&source("nir")), None)
            .unwrap();

        assert_eq!(
            block.observation_ids,
            vec![oid("obs.s2.nir"), oid("obs.s1.nir")]
        );
        assert_eq!(
            block.values,
            vec![
                vec![serde_json::json!(3.0), serde_json::Value::Null],
                vec![serde_json::json!(1.0), serde_json::json!(10.0)],
            ]
        );
    }

    #[test]
    fn rejects_malformed_f64_matrix_shape() {
        let mut matrix = f64_matrix();
        matrix.values.pop();
        let error = NumericFeatureBuffer::from_f64_matrix(matrix).unwrap_err();
        assert!(format!("{error}").contains("has 5 values"));

        let mut matrix = f64_matrix();
        matrix.validity_mask = Some(vec![true]);
        let error = NumericFeatureBuffer::from_f64_matrix(matrix).unwrap_err();
        assert!(format!("{error}").contains("validity_mask has 1 values"));

        let mut matrix = f64_matrix();
        matrix.values[0] = f64::NAN;
        let error = NumericFeatureBuffer::from_f64_matrix(matrix).unwrap_err();
        assert!(format!("{error}").contains("value 0 is not finite"));

        let mut matrix = f64_matrix();
        matrix.values[5] = f64::NAN;
        assert!(NumericFeatureBuffer::from_f64_matrix(matrix).is_ok());
    }

    #[test]
    fn store_manifests_and_projects_by_feature_set_id() {
        let store = NumericFeatureBufferStore::from_feature_tables(vec![table()]).unwrap();
        assert_eq!(store.len(), 1);
        assert!(!store.is_empty());

        let manifests = store.manifests().unwrap();
        assert_eq!(manifests.len(), 1);
        assert_eq!(manifests[0].feature_set_id, "x");
        assert_eq!(manifests[0].feature_names, vec!["f0", "f1"]);

        let block = store
            .project_relations("x", &relations(), Some(&source("chem")), None)
            .unwrap();
        assert_eq!(block.observation_ids, vec![oid("obs.s1.chem")]);
        assert_eq!(
            block.values,
            vec![vec![serde_json::json!(2.0), serde_json::json!(20.0)]]
        );
    }

    #[test]
    fn store_derives_source_bindings_from_relation_coverage() {
        let store = NumericFeatureBufferStore::from_feature_tables(vec![table()]).unwrap();
        let bindings = store
            .bindings_for_relations(
                &relations(),
                &RepresentationId::new("tabular_numeric").unwrap(),
            )
            .unwrap();

        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].feature_set_id, "x");
        assert_eq!(bindings[0].source_ids, vec![source("chem"), source("nir")]);
        assert_eq!(bindings[0].row_count, 3);
        assert_eq!(bindings[0].feature_count, 2);
        assert_eq!(bindings[0].buffer_fingerprint.len(), 64);

        let wrong_representation = store
            .bindings_for_relations(
                &relations(),
                &RepresentationId::new("dense_signal").unwrap(),
            )
            .unwrap();
        assert!(wrong_representation.is_empty());
    }

    #[test]
    fn store_accepts_typed_f64_matrices() {
        let store = NumericFeatureBufferStore::from_f64_matrices(vec![f64_matrix()]).unwrap();
        let manifests = store.manifests().unwrap();

        assert_eq!(manifests.len(), 1);
        assert_eq!(manifests[0].feature_set_id, "x");
        assert_eq!(manifests[0].value_count, 6);

        let error = NumericFeatureBufferStore::from_f64_matrices(vec![f64_matrix(), f64_matrix()])
            .unwrap_err();
        assert!(format!("{error}").contains("duplicate f64 feature matrix"));
    }

    #[test]
    fn arena_binds_projects_and_releases_data_handle_buffers() {
        let store = NumericFeatureBufferStore::from_feature_tables(vec![table()]).unwrap();
        let mut arena = NumericFeatureBufferArena::new(store);
        let bindings = arena
            .bind_data_handle(
                7,
                &relations(),
                &RepresentationId::new("tabular_numeric").unwrap(),
            )
            .unwrap();

        assert_eq!(bindings.len(), 1);
        assert_eq!(arena.bindings_for_data_handle(7).unwrap(), bindings);

        let block = arena
            .project_bound_relations(7, "x", &relations(), Some(&source("nir")), None)
            .unwrap();
        assert_eq!(
            block.observation_ids,
            vec![oid("obs.s2.nir"), oid("obs.s1.nir")]
        );

        let error = arena
            .project_bound_relations(8, "x", &relations(), Some(&source("nir")), None)
            .unwrap_err();
        assert!(format!("{error}").contains("not bound to data handle"));

        assert!(arena.release_data_handle(7));
        let error = arena.bindings_for_data_handle(7).unwrap_err();
        assert!(format!("{error}").contains("no feature buffer bindings"));
    }

    #[test]
    fn store_refuses_duplicate_feature_sets() {
        let error =
            NumericFeatureBufferStore::from_feature_tables(vec![table(), table()]).unwrap_err();
        assert!(format!("{error}").contains("duplicate feature table"));
    }

    #[test]
    fn builds_columnar_buffer_from_column_major_f64_matrix() {
        let buffer = NumericFeatureBuffer::from_f64_column_matrix(f64_column_matrix()).unwrap();
        assert_eq!(buffer.row_count(), 3);
        assert_eq!(buffer.feature_count(), 2);

        let block = buffer
            .project_relations(&relations(), Some(&source("nir")), None)
            .unwrap();

        assert_eq!(
            block.observation_ids,
            vec![oid("obs.s2.nir"), oid("obs.s1.nir")]
        );
        assert_eq!(
            block.values,
            vec![
                vec![serde_json::json!(3.0), serde_json::Value::Null],
                vec![serde_json::json!(1.0), serde_json::json!(10.0)],
            ]
        );
    }

    #[test]
    fn column_major_and_row_major_produce_identical_buffer_fingerprints() {
        let row_major = NumericFeatureBuffer::from_f64_matrix(f64_matrix()).unwrap();
        let columnar = NumericFeatureBuffer::from_f64_column_matrix(f64_column_matrix()).unwrap();
        assert_eq!(
            row_major.fingerprint().unwrap(),
            columnar.fingerprint().unwrap()
        );
    }

    /// Builds an `rows x cols` buffer whose flat row-major values are
    /// `0,1,2,...`, with generated feature / observation ids, no masking.
    fn dense_buffer(rows: usize, cols: usize) -> NumericFeatureBuffer {
        let columns = (0..cols)
            .map(|c| (0..rows).map(|r| (r * cols + c) as f64).collect::<Vec<_>>())
            .collect::<Vec<_>>();
        let matrix = NumericFeatureMatrixF64Columnar {
            feature_set_id: "x".to_string(),
            representation_id: RepresentationId::new("tabular_numeric").unwrap(),
            feature_names: (0..cols).map(|c| format!("f{c}")).collect(),
            observation_ids: (0..rows).map(|r| oid(&format!("obs.{r}"))).collect(),
            columns,
            validity_masks: None,
        };
        NumericFeatureBuffer::from_f64_column_matrix(matrix).unwrap()
    }

    #[test]
    fn fingerprint_is_64_lowercase_hex() {
        let fp = NumericFeatureBuffer::from_feature_table(table())
            .unwrap()
            .fingerprint()
            .unwrap();
        assert_eq!(fp.len(), 64);
        assert!(fp
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }

    #[test]
    fn fingerprint_is_deterministic_across_calls_and_clone() {
        let buffer = NumericFeatureBuffer::from_feature_table(table()).unwrap();
        let once = buffer.fingerprint().unwrap();
        let twice = buffer.fingerprint().unwrap();
        assert_eq!(once, twice, "same buffer hashed twice must match");
        let clone = buffer.clone();
        assert_eq!(
            once,
            clone.fingerprint().unwrap(),
            "a clone must fingerprint identically"
        );
    }

    #[test]
    fn fingerprint_changes_when_a_single_cell_flips() {
        let baseline = f64_column_matrix();
        let base_fp = NumericFeatureBuffer::from_f64_column_matrix(baseline.clone())
            .unwrap()
            .fingerprint()
            .unwrap();
        let mut flipped = baseline;
        flipped.columns[0][0] += 1.0;
        let flipped_fp = NumericFeatureBuffer::from_f64_column_matrix(flipped)
            .unwrap()
            .fingerprint()
            .unwrap();
        assert_ne!(base_fp, flipped_fp);
    }

    #[test]
    fn fingerprint_changes_when_a_feature_is_renamed() {
        let baseline = f64_column_matrix();
        let base_fp = NumericFeatureBuffer::from_f64_column_matrix(baseline.clone())
            .unwrap()
            .fingerprint()
            .unwrap();
        let mut renamed = baseline;
        renamed.feature_names[0] = "f0_renamed".to_string();
        let renamed_fp = NumericFeatureBuffer::from_f64_column_matrix(renamed)
            .unwrap()
            .fingerprint()
            .unwrap();
        assert_ne!(base_fp, renamed_fp);
    }

    #[test]
    fn fingerprint_changes_when_observation_ids_are_reordered() {
        // Reorder rows AND their values together so the buffer stays a valid
        // permutation of the same logical rows; only row order changes.
        let baseline = f64_column_matrix();
        let base_fp = NumericFeatureBuffer::from_f64_column_matrix(baseline.clone())
            .unwrap()
            .fingerprint()
            .unwrap();
        let mut reordered = baseline.clone();
        reordered.observation_ids.swap(0, 2);
        for column in &mut reordered.columns {
            column.swap(0, 2);
        }
        if let Some(masks) = reordered.validity_masks.as_mut() {
            for mask in masks {
                mask.swap(0, 2);
            }
        }
        let reordered_fp = NumericFeatureBuffer::from_f64_column_matrix(reordered)
            .unwrap()
            .fingerprint()
            .unwrap();
        assert_ne!(base_fp, reordered_fp);
    }

    #[test]
    fn fingerprint_distinguishes_transposed_shapes_with_identical_flat_values() {
        // 2x3 and 3x2 share the flat row-major value sequence 0..6 but differ in
        // shape. At the buffer level this is over-determined (the feature-name
        // and observation-id collection counts also differ); the focused proof
        // that the explicit n_rows/n_cols framing alone is load-bearing is
        // `shape_framing_alone_changes_digest`, which holds the cell stream
        // constant and varies only the shape integers.
        let two_by_three = dense_buffer(2, 3).fingerprint().unwrap();
        let three_by_two = dense_buffer(3, 2).fingerprint().unwrap();
        assert_ne!(two_by_three, three_by_two);
    }

    #[test]
    fn shape_framing_alone_changes_digest() {
        // Reproduce just the shape + cell portion of the buffer preimage with
        // the SAME six cells but transposed (n_rows, n_cols), proving the shape
        // integers are what separate 2x3 from 3x2 — independent of names/ids.
        let cells: [Option<f64>; 6] = [
            Some(0.0),
            Some(1.0),
            Some(2.0),
            Some(3.0),
            Some(4.0),
            Some(5.0),
        ];
        let digest = |rows: u64, cols: u64| {
            let mut hasher = StreamingHasher::new(b"shape-probe\0");
            hasher.absorb_u64(rows);
            hasher.absorb_u64(cols);
            for cell in cells {
                hasher.absorb_cell(cell);
            }
            hasher.finalize_hex()
        };
        assert_ne!(digest(2, 3), digest(3, 2));
    }

    #[test]
    fn fingerprint_distinguishes_masked_cell_from_real_zero() {
        // None vs Some(0.0): the value bytes are identical (all zero); only the
        // presence byte separates them.
        let masked = NumericFeatureMatrixF64Columnar {
            feature_set_id: "x".to_string(),
            representation_id: RepresentationId::new("tabular_numeric").unwrap(),
            feature_names: vec!["f0".to_string()],
            observation_ids: vec![oid("obs.0")],
            columns: vec![vec![0.0]],
            validity_masks: Some(vec![vec![false]]),
        };
        let real_zero = NumericFeatureMatrixF64Columnar {
            feature_set_id: "x".to_string(),
            representation_id: RepresentationId::new("tabular_numeric").unwrap(),
            feature_names: vec!["f0".to_string()],
            observation_ids: vec![oid("obs.0")],
            columns: vec![vec![0.0]],
            validity_masks: None,
        };
        let masked_fp = NumericFeatureBuffer::from_f64_column_matrix(masked)
            .unwrap()
            .fingerprint()
            .unwrap();
        let zero_fp = NumericFeatureBuffer::from_f64_column_matrix(real_zero)
            .unwrap()
            .fingerprint()
            .unwrap();
        assert_ne!(masked_fp, zero_fp);
    }

    #[test]
    fn fingerprint_changes_when_representation_changes() {
        let baseline = f64_column_matrix();
        let base_fp = NumericFeatureBuffer::from_f64_column_matrix(baseline.clone())
            .unwrap()
            .fingerprint()
            .unwrap();
        let mut other = baseline;
        other.representation_id = RepresentationId::new("dense_signal").unwrap();
        let other_fp = NumericFeatureBuffer::from_f64_column_matrix(other)
            .unwrap()
            .fingerprint()
            .unwrap();
        assert_ne!(base_fp, other_fp);
    }

    #[test]
    #[ignore = "perf sanity probe; run with --release --ignored --nocapture"]
    fn fingerprint_large_buffer_under_500ms() {
        // The historical serde_json path cost ~2.8 s on a 3021x1050 matrix in a
        // WASM context (a ~31 MB transient allocation). Optimized native must be
        // far under 500 ms with the streamed hash. The 500 ms budget is asserted
        // only in optimized builds: an unoptimized `cargo test` runs the sha2
        // compression with overflow checks and no SIMD, so its wall time is not
        // representative of "native" performance and would be a false failure.
        // The number is always printed.
        let rows = 3021usize;
        let cols = 1050usize;
        let columns = (0..cols)
            .map(|c| {
                (0..rows)
                    .map(|r| (r as f64) * 0.5 + (c as f64))
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();
        let matrix = NumericFeatureMatrixF64Columnar {
            feature_set_id: "big".to_string(),
            representation_id: RepresentationId::new("tabular_numeric").unwrap(),
            feature_names: (0..cols).map(|c| format!("f{c}")).collect(),
            observation_ids: (0..rows).map(|r| oid(&format!("obs.{r}"))).collect(),
            columns,
            validity_masks: None,
        };
        let buffer = NumericFeatureBuffer::from_f64_column_matrix(matrix).unwrap();
        let start = std::time::Instant::now();
        let fp = buffer.fingerprint().unwrap();
        let elapsed = start.elapsed();
        println!(
            "fingerprint({rows}x{cols}) = {:.3} ms (fp={fp})",
            elapsed.as_secs_f64() * 1e3
        );
        assert_eq!(fp.len(), 64);
        if !cfg!(debug_assertions) {
            assert!(
                elapsed.as_millis() < 500,
                "fingerprint took {} ms (>= 500 ms budget)",
                elapsed.as_millis()
            );
        }
    }

    #[test]
    fn rejects_malformed_columnar_f64_matrix_shape() {
        let mut matrix = f64_column_matrix();
        matrix.columns[0].pop();
        let error = NumericFeatureBuffer::from_f64_column_matrix(matrix).unwrap_err();
        assert!(format!("{error}").contains("column 0 has 2 values"));

        let mut matrix = f64_column_matrix();
        matrix.columns.pop();
        let error = NumericFeatureBuffer::from_f64_column_matrix(matrix).unwrap_err();
        assert!(format!("{error}").contains("has 1 columns for 2 features"));

        let mut matrix = f64_column_matrix();
        matrix.validity_masks = Some(vec![vec![true, true, true]]);
        let error = NumericFeatureBuffer::from_f64_column_matrix(matrix).unwrap_err();
        assert!(format!("{error}").contains("has 1 validity_masks for 2 features"));

        let mut matrix = f64_column_matrix();
        if let Some(masks) = matrix.validity_masks.as_mut() {
            masks[0].pop();
        }
        let error = NumericFeatureBuffer::from_f64_column_matrix(matrix).unwrap_err();
        assert!(format!("{error}").contains("column 0 validity_mask has 2 values"));

        let mut matrix = f64_column_matrix();
        matrix.columns[0][0] = f64::NAN;
        let error = NumericFeatureBuffer::from_f64_column_matrix(matrix).unwrap_err();
        assert!(format!("{error}").contains("column 0 row 0 is not finite"));

        let mut matrix = f64_column_matrix();
        matrix.columns[1][2] = f64::NAN;
        assert!(NumericFeatureBuffer::from_f64_column_matrix(matrix).is_ok());
    }

    #[test]
    fn store_accepts_typed_f64_column_matrices() {
        let store =
            NumericFeatureBufferStore::from_f64_column_matrices(vec![f64_column_matrix()]).unwrap();
        let manifests = store.manifests().unwrap();

        assert_eq!(manifests.len(), 1);
        assert_eq!(manifests[0].feature_set_id, "x");
        assert_eq!(manifests[0].value_count, 6);

        let error = NumericFeatureBufferStore::from_f64_column_matrices(vec![
            f64_column_matrix(),
            f64_column_matrix(),
        ])
        .unwrap_err();
        assert!(format!("{error}").contains("duplicate f64 columnar feature matrix"));
    }
}

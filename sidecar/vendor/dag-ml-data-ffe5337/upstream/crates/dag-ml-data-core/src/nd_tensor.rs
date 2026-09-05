//! Borrowed N-D tensor transport: host-owned dense tensors (e.g. uint8
//! `[N,H,W,C]` RGB, float32 `[N,H,W,Wavelength]` hyperspectral) copied into
//! provider-owned, canonical row-major storage, keyed and gathered by
//! `observation_id`.
//!
//! Axis 0 is ALWAYS the sample/observation axis; the remaining axes are opaque
//! to this layer (no conv / decode / preprocessing / interpolation). Strides are
//! a transport detail of the *input*: borrowed strided input is copied into
//! canonical contiguous bytes at construction and strides are then discarded, so
//! everything stored here is contiguous row-major and fingerprintable.
//!
//! This is the ND parallel of [`crate::buffer`]: a [`NdTensorStore`] of immutable
//! tensors, an [`NdTensorArena`] that binds them to materialized data handles by
//! output representation, and a relation-ordered [`NdTensorBlock`] export.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::content_hash::StreamingHasher;
use crate::coordinator::CoordinatorRelationSet;
use crate::error::{DataError, Result};
use crate::ids::{ObservationId, RepresentationId, SampleId, SourceId};

/// Schema version of [`NdTensorManifest`] / [`NdTensorBinding`].
pub const ND_TENSOR_MANIFEST_SCHEMA_VERSION: u32 = 1;

/// Maximum supported tensor rank. Bounds the shape-product arithmetic and keeps
/// the contract finite.
pub const ND_TENSOR_MAX_RANK: usize = 16;

/// Element dtype of an N-D tensor. The C ABI exposes a matching `#[repr(C)]`
/// `DagMlDataTensorDType` enum and maps to/from this type explicitly; this core
/// enum carries no ABI guarantee of its own.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NdTensorDType {
    F64,
    F32,
    U8,
    I32,
    Bool,
}

impl NdTensorDType {
    /// Size in bytes of one element of this dtype.
    pub fn element_size(self) -> usize {
        match self {
            NdTensorDType::F64 => 8,
            NdTensorDType::F32 => 4,
            NdTensorDType::U8 => 1,
            NdTensorDType::I32 => 4,
            NdTensorDType::Bool => 1,
        }
    }

    /// Stable, explicit tag absorbed into the content fingerprint. Hard-coded
    /// (not the enum's memory discriminant or its serde name) so the dtype is
    /// part of the preimage and reordering variants here can never silently
    /// change a fingerprint. Two tensors whose `data` bytes happen to coincide
    /// but whose dtypes differ (e.g. `[N]` `U8` vs the low byte of an `I32`)
    /// fingerprint differently.
    fn fingerprint_tag(self) -> u64 {
        match self {
            NdTensorDType::F64 => 1,
            NdTensorDType::F32 => 2,
            NdTensorDType::U8 => 3,
            NdTensorDType::I32 => 4,
            NdTensorDType::Bool => 5,
        }
    }
}

/// A canonical (contiguous row-major) N-D tensor handed to the store. The C ABI
/// layer copies any strided borrowed input into this shape before calling in.
#[derive(Clone, Debug, PartialEq)]
pub struct NdTensorInput {
    pub tensor_id: String,
    pub representation_id: RepresentationId,
    pub container: String,
    pub dtype: NdTensorDType,
    /// Full shape; `shape[0]` is the sample/observation axis.
    pub shape: Vec<usize>,
    /// One id per axis-0 row; `len == shape[0]`.
    pub observation_ids: Vec<ObservationId>,
    /// Optional advisory sample ids (validated for length only; the authoritative
    /// sample mapping comes from the coordinator relations at export time).
    pub sample_ids: Option<Vec<SampleId>>,
    /// Contiguous row-major bytes; `len == product(shape) * dtype.element_size()`.
    ///
    /// Multibyte elements (`F64`/`F32`/`I32`) MUST be encoded **little-endian**.
    /// This layer copies the bytes verbatim and never reinterprets them as
    /// native-endian values, so the byte order is part of the input contract,
    /// not something the layer can fix up. The content fingerprint hashes these
    /// bytes as-is; pinning little-endian here is what makes the fingerprint
    /// platform-independent (a big-endian host must canonicalize to LE before
    /// constructing the input).
    pub data: Vec<u8>,
    /// Optional per-axis-0-row presence mask; `len == shape[0]`.
    pub row_presence: Option<Vec<bool>>,
}

/// A stored, immutable, contiguous row-major N-D tensor.
#[derive(Clone, Debug, PartialEq)]
pub struct NdTensor {
    tensor_id: String,
    representation_id: RepresentationId,
    container: String,
    dtype: NdTensorDType,
    shape: Vec<usize>,
    observation_ids: Vec<ObservationId>,
    data: Vec<u8>,
    row_presence: Option<Vec<bool>>,
    row_index_by_observation: BTreeMap<ObservationId, usize>,
    /// Bytes per axis-0 row: `product(shape[1..]) * element_size`.
    row_stride_bytes: usize,
}

/// Provider-wide manifest of one stored tensor (no payload bytes).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct NdTensorManifest {
    pub schema_version: u32,
    pub tensor_id: String,
    pub representation_id: RepresentationId,
    pub container: String,
    pub dtype: NdTensorDType,
    pub shape: Vec<usize>,
    pub observation_ids: Vec<ObservationId>,
    pub row_count: usize,
    pub element_bytes: usize,
    pub data_bytes: usize,
    pub tensor_fingerprint: String,
}

/// Binding of one stored tensor to a materialized data handle.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct NdTensorBinding {
    pub tensor_id: String,
    pub representation_id: RepresentationId,
    pub container: String,
    pub dtype: NdTensorDType,
    pub source_ids: Vec<SourceId>,
    pub shape: Vec<usize>,
    pub row_count: usize,
    pub tensor_fingerprint: String,
}

/// A relation-ordered, axis-0-filtered export of a stored tensor. `shape[0]` is
/// the number of selected rows; `data` is contiguous row-major bytes.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NdTensorBlock {
    pub tensor_id: String,
    pub representation_id: RepresentationId,
    pub container: String,
    pub dtype: NdTensorDType,
    pub shape: Vec<usize>,
    pub observation_ids: Vec<ObservationId>,
    pub sample_ids: Vec<SampleId>,
    pub data: Vec<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub row_presence: Option<Vec<bool>>,
}

/// An immutable collection of N-D tensors keyed by `tensor_id`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct NdTensorStore {
    tensors: BTreeMap<String, NdTensor>,
}

/// A store plus per-data-handle bindings, mirroring `NumericFeatureBufferArena`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct NdTensorArena {
    store: NdTensorStore,
    data_bindings: BTreeMap<u64, BTreeMap<String, NdTensorBinding>>,
}

fn checked_shape_product(tensor_id: &str, shape: &[usize]) -> Result<usize> {
    let mut product: usize = 1;
    for dim in shape {
        product = product.checked_mul(*dim).ok_or_else(|| {
            DataError::Validation(format!(
                "nd tensor `{tensor_id}` shape product overflows usize"
            ))
        })?;
    }
    Ok(product)
}

impl NdTensor {
    /// Builds and validates a stored tensor from canonical contiguous input.
    pub fn from_input(input: NdTensorInput) -> Result<Self> {
        let NdTensorInput {
            tensor_id,
            representation_id,
            container,
            dtype,
            shape,
            observation_ids,
            sample_ids,
            data,
            row_presence,
        } = input;

        if tensor_id.trim().is_empty() {
            return Err(DataError::Validation(
                "nd tensor has an empty tensor id".to_string(),
            ));
        }
        if container.trim().is_empty() {
            return Err(DataError::Validation(format!(
                "nd tensor `{tensor_id}` has an empty container"
            )));
        }
        if shape.is_empty() || shape.len() > ND_TENSOR_MAX_RANK {
            return Err(DataError::Validation(format!(
                "nd tensor `{tensor_id}` rank {} is not in 1..={ND_TENSOR_MAX_RANK}",
                shape.len()
            )));
        }
        if shape.contains(&0) {
            return Err(DataError::Validation(format!(
                "nd tensor `{tensor_id}` has a zero dimension in shape {shape:?}"
            )));
        }
        let row_count = shape[0];
        if observation_ids.len() != row_count {
            return Err(DataError::Validation(format!(
                "nd tensor `{tensor_id}` has {} observation ids for axis-0 size {row_count}",
                observation_ids.len()
            )));
        }
        if observation_ids.is_empty() {
            return Err(DataError::Validation(format!(
                "nd tensor `{tensor_id}` has no observations"
            )));
        }
        let mut row_index_by_observation = BTreeMap::new();
        for (idx, observation_id) in observation_ids.iter().enumerate() {
            if row_index_by_observation
                .insert(observation_id.clone(), idx)
                .is_some()
            {
                return Err(DataError::Validation(format!(
                    "nd tensor `{tensor_id}` has duplicate observation `{observation_id}`"
                )));
            }
        }
        if let Some(sample_ids) = &sample_ids {
            if sample_ids.len() != row_count {
                return Err(DataError::Validation(format!(
                    "nd tensor `{tensor_id}` has {} sample ids for axis-0 size {row_count}",
                    sample_ids.len()
                )));
            }
        }

        let element_size = dtype.element_size();
        let total_elements = checked_shape_product(&tensor_id, &shape)?;
        let expected_bytes = total_elements.checked_mul(element_size).ok_or_else(|| {
            DataError::Validation(format!("nd tensor `{tensor_id}` byte size overflows usize"))
        })?;
        if data.len() != expected_bytes {
            return Err(DataError::Validation(format!(
                "nd tensor `{tensor_id}` has {} data bytes for shape {shape:?} dtype {dtype:?} ({expected_bytes} expected)",
                data.len()
            )));
        }
        if dtype == NdTensorDType::Bool && data.iter().any(|byte| *byte > 1) {
            return Err(DataError::Validation(format!(
                "nd tensor `{tensor_id}` bool payload contains a byte that is not 0 or 1"
            )));
        }
        if let Some(row_presence) = &row_presence {
            if row_presence.len() != row_count {
                return Err(DataError::Validation(format!(
                    "nd tensor `{tensor_id}` row presence has {} flags for axis-0 size {row_count}",
                    row_presence.len()
                )));
            }
        }

        // product(shape[1..]) * element_size; rank-1 rows are one element each.
        // All dims are > 0 (rejected above), so row_count > 0.
        let row_stride_bytes = expected_bytes / row_count;

        Ok(Self {
            tensor_id,
            representation_id,
            container,
            dtype,
            shape,
            observation_ids,
            data,
            row_presence,
            row_index_by_observation,
            row_stride_bytes,
        })
    }

    fn contains_observation(&self, observation_id: &ObservationId) -> bool {
        self.row_index_by_observation.contains_key(observation_id)
    }

    /// Gathers axis-0 rows in relation order (optionally scoped to one source),
    /// keyed by `observation_id`. Output `sample_ids` come from the relations,
    /// not the stored tensor.
    pub fn project_relations(
        &self,
        relations: &CoordinatorRelationSet,
        source_id: Option<&SourceId>,
    ) -> Result<NdTensorBlock> {
        relations.validate()?;
        let selected = relations.records.iter().filter(|relation| {
            source_id
                .map(|source_id| relation.source_id.as_ref() == Some(source_id))
                .unwrap_or(true)
        });

        let mut observation_ids = Vec::new();
        let mut sample_ids = Vec::new();
        let mut data = Vec::new();
        let mut presence = Vec::new();
        for relation in selected {
            let row_idx = *self
                .row_index_by_observation
                .get(&relation.observation_id)
                .ok_or_else(|| {
                    DataError::Validation(format!(
                        "nd tensor `{}` has no row for observation `{}`",
                        self.tensor_id, relation.observation_id
                    ))
                })?;
            let start = row_idx * self.row_stride_bytes;
            data.extend_from_slice(&self.data[start..start + self.row_stride_bytes]);
            if let Some(row_presence) = &self.row_presence {
                presence.push(row_presence[row_idx]);
            }
            observation_ids.push(relation.observation_id.clone());
            sample_ids.push(relation.sample_id.clone());
        }

        let mut shape = self.shape.clone();
        shape[0] = observation_ids.len();

        Ok(NdTensorBlock {
            tensor_id: self.tensor_id.clone(),
            representation_id: self.representation_id.clone(),
            container: self.container.clone(),
            dtype: self.dtype,
            shape,
            observation_ids,
            sample_ids,
            data,
            row_presence: self.row_presence.as_ref().map(|_| presence),
        })
    }

    /// Reproducibility fingerprint of the tensor's logical content as a 64-char
    /// lowercase hex SHA-256.
    ///
    /// Streamed, never serialized to an intermediate byte vector: the bulk
    /// `data` payload is fed straight through the hasher (the old
    /// `serde_json::to_vec` path materialized the whole `Vec<u8>` as a JSON
    /// array of integers, multiplying both time and transient memory).
    ///
    /// Preimage layout (every multi-byte field little-endian; every
    /// variable-length field length-prefixed):
    ///
    /// ```text
    /// domain tag  b"dag-ml-data.nd-tensor.v2\0"   (fixed literal)
    /// tensor_id         : str   (u64 byte-len, then UTF-8)
    /// representation_id : str
    /// container         : str
    /// dtype             : u64   (stable fingerprint tag, see fingerprint_tag)
    /// shape             : u64 rank, then each dim as u64
    /// observation_ids   : str[] (u64 count, then each str)
    /// data              : u64 byte-len, then the contiguous row-major bytes
    /// row_presence      : u64 tag (0 = absent), or (1, u64 len, one 0/1 byte each)
    /// ```
    ///
    /// `data` is the host's **canonical contiguous row-major** payload: the
    /// element bytes are already in the platform-independent little-endian
    /// encoding the C-ABI copies in verbatim (the layer never re-interprets
    /// them as native-endian values), so feeding the raw bytes IS the
    /// per-dtype LE encoding. The dtype tag and the byte-length prefix mean
    /// identical bytes under a different dtype or a different shape never
    /// collide.
    fn fingerprint(&self) -> Result<String> {
        let mut hasher = StreamingHasher::new(b"dag-ml-data.nd-tensor.v2\0");
        hasher.absorb_str(&self.tensor_id);
        hasher.absorb_str(self.representation_id.as_str());
        hasher.absorb_str(&self.container);
        hasher.absorb_u64(self.dtype.fingerprint_tag());
        hasher.absorb_len(self.shape.len());
        for dim in &self.shape {
            hasher.absorb_len(*dim);
        }
        hasher.absorb_str_collection(self.observation_ids.iter().map(ObservationId::as_str));
        hasher.absorb_len(self.data.len());
        hasher.absorb_raw(&self.data);
        match &self.row_presence {
            None => hasher.absorb_u64(0),
            Some(presence) => {
                hasher.absorb_u64(1);
                hasher.absorb_len(presence.len());
                for present in presence {
                    hasher.absorb_raw(&[u8::from(*present)]);
                }
            }
        }
        Ok(hasher.finalize_hex())
    }

    fn manifest(&self) -> Result<NdTensorManifest> {
        Ok(NdTensorManifest {
            schema_version: ND_TENSOR_MANIFEST_SCHEMA_VERSION,
            tensor_id: self.tensor_id.clone(),
            representation_id: self.representation_id.clone(),
            container: self.container.clone(),
            dtype: self.dtype,
            shape: self.shape.clone(),
            observation_ids: self.observation_ids.clone(),
            row_count: self.shape[0],
            element_bytes: self.dtype.element_size(),
            data_bytes: self.data.len(),
            tensor_fingerprint: self.fingerprint()?,
        })
    }

    fn binding_for_sources(&self, source_ids: Vec<SourceId>) -> Result<NdTensorBinding> {
        Ok(NdTensorBinding {
            tensor_id: self.tensor_id.clone(),
            representation_id: self.representation_id.clone(),
            container: self.container.clone(),
            dtype: self.dtype,
            source_ids,
            shape: self.shape.clone(),
            row_count: self.shape[0],
            tensor_fingerprint: self.fingerprint()?,
        })
    }
}

impl NdTensorStore {
    /// Builds a store from canonical inputs, rejecting duplicate tensor ids.
    pub fn from_inputs(inputs: Vec<NdTensorInput>) -> Result<Self> {
        let mut tensors = BTreeMap::new();
        for input in inputs {
            let tensor = NdTensor::from_input(input)?;
            let tensor_id = tensor.tensor_id.clone();
            if tensors.insert(tensor_id.clone(), tensor).is_some() {
                return Err(DataError::Validation(format!(
                    "duplicate nd tensor `{tensor_id}`"
                )));
            }
        }
        Ok(Self { tensors })
    }

    pub fn is_empty(&self) -> bool {
        self.tensors.is_empty()
    }

    /// Provider-wide manifests for every stored tensor.
    pub fn manifests(&self) -> Result<Vec<NdTensorManifest>> {
        self.tensors.values().map(NdTensor::manifest).collect()
    }

    /// Bindings for tensors whose representation matches `representation_id` and
    /// whose observations cover the relation set (per source).
    pub fn bindings_for_relations(
        &self,
        relations: &CoordinatorRelationSet,
        representation_id: &RepresentationId,
    ) -> Result<Vec<NdTensorBinding>> {
        relations.validate()?;
        let source_ids = relations
            .records
            .iter()
            .filter_map(|relation| relation.source_id.as_ref())
            .collect::<BTreeSet<_>>();

        let mut bindings = Vec::new();
        for tensor in self.tensors.values() {
            if &tensor.representation_id != representation_id {
                continue;
            }
            if source_ids.is_empty() {
                if relations
                    .records
                    .iter()
                    .all(|relation| tensor.contains_observation(&relation.observation_id))
                {
                    bindings.push(tensor.binding_for_sources(Vec::new())?);
                }
                continue;
            }
            let mut covered_sources = Vec::new();
            for source_id in &source_ids {
                let covers_source = relations
                    .records
                    .iter()
                    .filter(|relation| relation.source_id.as_ref() == Some(*source_id))
                    .all(|relation| tensor.contains_observation(&relation.observation_id));
                if covers_source {
                    covered_sources.push((*source_id).clone());
                }
            }
            if !covered_sources.is_empty() {
                bindings.push(tensor.binding_for_sources(covered_sources)?);
            }
        }
        Ok(bindings)
    }

    /// Projects a single tensor over the given relations.
    pub fn project_relations(
        &self,
        tensor_id: &str,
        relations: &CoordinatorRelationSet,
        source_id: Option<&SourceId>,
    ) -> Result<NdTensorBlock> {
        let tensor = self.tensors.get(tensor_id).ok_or_else(|| {
            DataError::Validation(format!("nd tensor `{tensor_id}` is not present"))
        })?;
        tensor.project_relations(relations, source_id)
    }
}

impl NdTensorArena {
    pub fn new(store: NdTensorStore) -> Self {
        Self {
            store,
            data_bindings: BTreeMap::new(),
        }
    }

    /// Binds tensors matching `representation_id` to `data_handle` and returns
    /// the bindings.
    pub fn bind_data_handle(
        &mut self,
        data_handle: u64,
        relations: &CoordinatorRelationSet,
        representation_id: &RepresentationId,
    ) -> Result<Vec<NdTensorBinding>> {
        let bindings = self
            .store
            .bindings_for_relations(relations, representation_id)?;
        self.data_bindings.insert(
            data_handle,
            bindings
                .iter()
                .cloned()
                .map(|binding| (binding.tensor_id.clone(), binding))
                .collect(),
        );
        Ok(bindings)
    }

    pub fn release_data_handle(&mut self, data_handle: u64) -> bool {
        self.data_bindings.remove(&data_handle).is_some()
    }

    pub fn manifests(&self) -> Result<Vec<NdTensorManifest>> {
        self.store.manifests()
    }

    pub fn bindings_for_data_handle(&self, data_handle: u64) -> Result<Vec<NdTensorBinding>> {
        let bindings = self.data_bindings.get(&data_handle).ok_or_else(|| {
            DataError::Validation(format!(
                "data handle `{data_handle}` has no nd tensor bindings"
            ))
        })?;
        Ok(bindings.values().cloned().collect())
    }

    /// Projects a bound tensor over `relations`. Mirrors the feature-buffer
    /// bound-source check: the tensor must be bound to `data_handle`; an explicit
    /// `source_id` must be present in the view AND bound; an unscoped export
    /// requires EVERY source present in the view to be bound.
    pub fn project_bound_relations(
        &self,
        data_handle: u64,
        tensor_id: &str,
        relations: &CoordinatorRelationSet,
        source_id: Option<&SourceId>,
    ) -> Result<NdTensorBlock> {
        relations.validate()?;
        let binding = self
            .data_bindings
            .get(&data_handle)
            .and_then(|bindings| bindings.get(tensor_id))
            .ok_or_else(|| {
                DataError::Validation(format!(
                    "nd tensor `{tensor_id}` is not bound to data handle `{data_handle}`"
                ))
            })?;
        let view_source_ids = relations
            .records
            .iter()
            .filter_map(|relation| relation.source_id.as_ref())
            .cloned()
            .collect::<BTreeSet<_>>();
        let required_source_ids: Vec<SourceId> = if let Some(source_id) = source_id {
            if view_source_ids.is_empty() || !view_source_ids.contains(source_id) {
                return Err(DataError::Validation(format!(
                    "nd tensor `{tensor_id}` source `{source_id}` is not present in view for data handle `{data_handle}`"
                )));
            }
            vec![source_id.clone()]
        } else {
            view_source_ids.into_iter().collect()
        };
        for required in &required_source_ids {
            if !binding.source_ids.contains(required) {
                return Err(DataError::Validation(format!(
                    "nd tensor `{tensor_id}` is not bound to source `{required}` for data handle `{data_handle}`"
                )));
            }
        }
        self.store
            .project_relations(tensor_id, relations, source_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::coordinator::CoordinatorRelation;
    use crate::ids::SampleId;

    fn relation(observation: &str, sample: &str, source: &str) -> CoordinatorRelation {
        CoordinatorRelation {
            observation_id: ObservationId::new(observation).unwrap(),
            sample_id: SampleId::new(sample).unwrap(),
            target_id: None,
            group_id: None,
            origin_sample_id: None,
            source_id: Some(SourceId::new(source).unwrap()),
            is_augmented: false,
            excluded: false,
            metadata: BTreeMap::new(),
            tags: Vec::new(),
        }
    }

    // [3, 2, 2] u8 RGB-ish tensor: 3 rows (obs.s1..s3), each a 2x2 frame.
    fn rgb_input() -> NdTensorInput {
        NdTensorInput {
            tensor_id: "rgb".to_string(),
            representation_id: RepresentationId::new("rgb_image").unwrap(),
            container: "pil_image_batch".to_string(),
            dtype: NdTensorDType::U8,
            shape: vec![3, 2, 2],
            observation_ids: vec![
                ObservationId::new("obs.s1").unwrap(),
                ObservationId::new("obs.s2").unwrap(),
                ObservationId::new("obs.s3").unwrap(),
            ],
            sample_ids: None,
            data: (0u8..12).collect(),
            row_presence: None,
        }
    }

    #[test]
    fn from_input_validates_and_projects_in_relation_order() {
        let store = NdTensorStore::from_inputs(vec![rgb_input()]).unwrap();
        let relations = CoordinatorRelationSet {
            records: vec![
                relation("obs.s3", "s3", "cam"),
                relation("obs.s1", "s1", "cam"),
            ],
        };
        let block = store.project_relations("rgb", &relations, None).unwrap();
        assert_eq!(block.shape, vec![2, 2, 2]);
        assert_eq!(block.dtype, NdTensorDType::U8);
        // Rows gathered in relation order: s3 (bytes 8..12) then s1 (0..4).
        assert_eq!(block.data, vec![8, 9, 10, 11, 0, 1, 2, 3]);
        assert_eq!(
            block.sample_ids,
            vec![SampleId::new("s3").unwrap(), SampleId::new("s1").unwrap()]
        );
    }

    #[test]
    fn rejects_wrong_data_len() {
        let mut input = rgb_input();
        input.data.pop();
        let error = NdTensor::from_input(input).unwrap_err();
        assert!(format!("{error}").contains("data bytes"));
    }

    #[test]
    fn rejects_observation_count_mismatch() {
        let mut input = rgb_input();
        input.observation_ids.pop();
        let error = NdTensor::from_input(input).unwrap_err();
        assert!(format!("{error}").contains("observation ids"));
    }

    #[test]
    fn rejects_rank_zero_and_over_max() {
        let mut zero = rgb_input();
        zero.shape = vec![];
        assert!(NdTensor::from_input(zero).is_err());
        let mut huge = rgb_input();
        huge.shape = vec![3; ND_TENSOR_MAX_RANK + 1];
        assert!(NdTensor::from_input(huge).is_err());
    }

    #[test]
    fn rejects_non_binary_bool_payload() {
        let input = NdTensorInput {
            tensor_id: "mask".to_string(),
            representation_id: RepresentationId::new("mask_image").unwrap(),
            container: "ndarray".to_string(),
            dtype: NdTensorDType::Bool,
            shape: vec![2, 2],
            observation_ids: vec![
                ObservationId::new("obs.s1").unwrap(),
                ObservationId::new("obs.s2").unwrap(),
            ],
            sample_ids: None,
            data: vec![1, 0, 2, 1],
            row_presence: None,
        };
        let error = NdTensor::from_input(input).unwrap_err();
        assert!(format!("{error}").contains("not 0 or 1"));
    }

    #[test]
    fn arena_binds_and_refuses_unbound_or_wrong_source() {
        let mut arena = NdTensorArena::new(NdTensorStore::from_inputs(vec![rgb_input()]).unwrap());
        let relations = CoordinatorRelationSet {
            records: vec![
                relation("obs.s1", "s1", "cam"),
                relation("obs.s2", "s2", "cam"),
                relation("obs.s3", "s3", "cam"),
            ],
        };
        let representation = RepresentationId::new("rgb_image").unwrap();
        let bindings = arena
            .bind_data_handle(1, &relations, &representation)
            .unwrap();
        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].source_ids, vec![SourceId::new("cam").unwrap()]);

        // Bound source projects.
        let block = arena
            .project_bound_relations(1, "rgb", &relations, Some(&SourceId::new("cam").unwrap()))
            .unwrap();
        assert_eq!(block.shape, vec![3, 2, 2]);

        // Unbound source / handle are refused.
        assert!(arena
            .project_bound_relations(1, "rgb", &relations, Some(&SourceId::new("nope").unwrap()))
            .is_err());
        assert!(arena
            .project_bound_relations(2, "rgb", &relations, None)
            .is_err());
        assert!(arena.release_data_handle(1));
        assert!(arena.bindings_for_data_handle(1).is_err());
    }

    #[test]
    fn rejects_empty_tensor_id() {
        let mut input = rgb_input();
        input.tensor_id = "  ".to_string();
        let error = NdTensor::from_input(input).unwrap_err();
        assert!(format!("{error}").contains("empty tensor id"));
    }

    #[test]
    fn rejects_zero_dimension() {
        let mut input = rgb_input();
        input.shape = vec![3, 0];
        input.data = Vec::new();
        let error = NdTensor::from_input(input).unwrap_err();
        assert!(format!("{error}").contains("zero dimension"));
    }

    #[test]
    fn arena_refuses_unscoped_export_when_a_view_source_is_unbound() {
        // Tensor only contains source `a` observations.
        let input = NdTensorInput {
            tensor_id: "multi".to_string(),
            representation_id: RepresentationId::new("rgb_image").unwrap(),
            container: "ndarray".to_string(),
            dtype: NdTensorDType::U8,
            shape: vec![1, 2],
            observation_ids: vec![ObservationId::new("obs.a1").unwrap()],
            sample_ids: None,
            data: vec![1, 2],
            row_presence: None,
        };
        let mut arena = NdTensorArena::new(NdTensorStore::from_inputs(vec![input]).unwrap());
        // The view spans sources `a` and `b`.
        let relations = CoordinatorRelationSet {
            records: vec![relation("obs.a1", "a1", "a"), relation("obs.b1", "b1", "b")],
        };
        let representation = RepresentationId::new("rgb_image").unwrap();
        let bindings = arena
            .bind_data_handle(1, &relations, &representation)
            .unwrap();
        // Only source `a` is covered.
        assert_eq!(bindings[0].source_ids, vec![SourceId::new("a").unwrap()]);

        // Unscoped export over the a+b view is refused (b is unbound).
        assert!(arena
            .project_bound_relations(1, "multi", &relations, None)
            .is_err());
        // Scoped to the uncovered source `b` is refused.
        assert!(arena
            .project_bound_relations(1, "multi", &relations, Some(&SourceId::new("b").unwrap()))
            .is_err());
        // Scoped to the covered source `a` over an a-only view succeeds.
        let a_only = CoordinatorRelationSet {
            records: vec![relation("obs.a1", "a1", "a")],
        };
        let block = arena
            .project_bound_relations(1, "multi", &a_only, Some(&SourceId::new("a").unwrap()))
            .unwrap();
        assert_eq!(block.shape, vec![1, 2]);
    }

    #[test]
    fn manifest_carries_shape_and_fingerprint() {
        let store = NdTensorStore::from_inputs(vec![rgb_input()]).unwrap();
        let manifests = store.manifests().unwrap();
        assert_eq!(manifests.len(), 1);
        assert_eq!(manifests[0].shape, vec![3, 2, 2]);
        assert_eq!(manifests[0].data_bytes, 12);
        assert_eq!(manifests[0].element_bytes, 1);
        assert_eq!(manifests[0].tensor_fingerprint.len(), 64);
    }

    fn fp(input: NdTensorInput) -> String {
        NdTensor::from_input(input).unwrap().fingerprint().unwrap()
    }

    #[test]
    fn tensor_fingerprint_is_64_lowercase_hex() {
        let fingerprint = fp(rgb_input());
        assert_eq!(fingerprint.len(), 64);
        assert!(fingerprint
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }

    #[test]
    fn tensor_fingerprint_is_deterministic_across_calls_and_clone() {
        let tensor = NdTensor::from_input(rgb_input()).unwrap();
        let once = tensor.fingerprint().unwrap();
        assert_eq!(once, tensor.fingerprint().unwrap());
        assert_eq!(once, tensor.clone().fingerprint().unwrap());
    }

    #[test]
    fn tensor_fingerprint_changes_when_a_single_data_byte_flips() {
        let baseline = fp(rgb_input());
        let mut flipped = rgb_input();
        flipped.data[0] ^= 0xFF;
        assert_ne!(baseline, fp(flipped));
    }

    #[test]
    fn tensor_fingerprint_changes_when_tensor_id_is_renamed() {
        let baseline = fp(rgb_input());
        let mut renamed = rgb_input();
        renamed.tensor_id = "rgb_renamed".to_string();
        assert_ne!(baseline, fp(renamed));
    }

    #[test]
    fn tensor_fingerprint_changes_when_observation_ids_are_reordered() {
        // Permute both the rows' bytes and their ids together so the tensor
        // stays a valid permutation of the same logical rows.
        let baseline = fp(rgb_input());
        let mut reordered = rgb_input();
        reordered.observation_ids.swap(0, 2);
        // Each row is 4 bytes ([_,2,2] u8); swap row 0 and row 2.
        let (head, tail) = reordered.data.split_at_mut(8);
        head[0..4].swap_with_slice(&mut tail[0..4]);
        assert_ne!(baseline, fp(reordered));
    }

    #[test]
    fn tensor_fingerprint_distinguishes_transposed_shapes_with_identical_bytes() {
        // Same 12 bytes, axis-0 size 3 either way; [3,2,2] vs [3,4] differ only
        // in the trailing shape, which the rank+dims framing must separate.
        let base = NdTensorInput {
            tensor_id: "t".to_string(),
            representation_id: RepresentationId::new("rgb_image").unwrap(),
            container: "ndarray".to_string(),
            dtype: NdTensorDType::U8,
            shape: vec![3, 2, 2],
            observation_ids: vec![
                ObservationId::new("obs.s1").unwrap(),
                ObservationId::new("obs.s2").unwrap(),
                ObservationId::new("obs.s3").unwrap(),
            ],
            sample_ids: None,
            data: (0u8..12).collect(),
            row_presence: None,
        };
        let mut reshaped = base.clone();
        reshaped.shape = vec![3, 4];
        assert_ne!(fp(base), fp(reshaped));
    }

    #[test]
    fn tensor_fingerprint_distinguishes_dtype_with_identical_bytes() {
        // Four bytes, axis-0 size 1: one I32 element vs four U8 elements share
        // the same payload bytes; the dtype tag must separate them.
        let as_i32 = NdTensorInput {
            tensor_id: "t".to_string(),
            representation_id: RepresentationId::new("rgb_image").unwrap(),
            container: "ndarray".to_string(),
            dtype: NdTensorDType::I32,
            shape: vec![1, 1],
            observation_ids: vec![ObservationId::new("obs.s1").unwrap()],
            sample_ids: None,
            data: vec![1, 2, 3, 4],
            row_presence: None,
        };
        let mut as_u8 = as_i32.clone();
        as_u8.dtype = NdTensorDType::U8;
        as_u8.shape = vec![1, 4];
        assert_ne!(fp(as_i32), fp(as_u8));
    }

    #[test]
    fn tensor_fingerprint_hashes_data_bytes_verbatim_in_declared_order() {
        // Conformance: the layer hashes element bytes as-is and never
        // byte-swaps, so the little-endian input contract is what makes the
        // fingerprint platform-independent. An f32 = 1.0 is `00 00 80 3f` LE;
        // feeding the byte-reversed (big-endian) arrangement of the same
        // logical value must change the fingerprint, proving order is honored.
        let f32_one_le: [u8; 4] = 1.0f32.to_le_bytes(); // 00 00 80 3f
        let le = NdTensorInput {
            tensor_id: "t".to_string(),
            representation_id: RepresentationId::new("hyperspectral").unwrap(),
            container: "ndarray".to_string(),
            dtype: NdTensorDType::F32,
            shape: vec![1, 1],
            observation_ids: vec![ObservationId::new("obs.s1").unwrap()],
            sample_ids: None,
            data: f32_one_le.to_vec(),
            row_presence: None,
        };
        let mut be = le.clone();
        let mut reversed = f32_one_le;
        reversed.reverse(); // 3f 80 00 00 — the BE arrangement
        be.data = reversed.to_vec();
        // Two LE builds match; the BE arrangement differs.
        assert_eq!(fp(le.clone()), fp(le.clone()));
        assert_ne!(fp(le), fp(be));
    }

    #[test]
    fn tensor_fingerprint_distinguishes_row_presence_states() {
        // No presence vs all-present-present mask are different logical states
        // and must fingerprint differently (the absent-tag vs the framed mask).
        let baseline = fp(rgb_input());
        let mut with_presence = rgb_input();
        with_presence.row_presence = Some(vec![true, true, true]);
        let present_fp = fp(with_presence);
        assert_ne!(baseline, present_fp);

        let mut one_absent = rgb_input();
        one_absent.row_presence = Some(vec![true, false, true]);
        assert_ne!(present_fp, fp(one_absent));
    }

    #[test]
    #[ignore = "perf sanity probe; run with --release --ignored --nocapture"]
    fn tensor_fingerprint_large_payload_under_500ms() {
        // Stream a ~12 MB u8-equivalent / ~12.7 M-element f32 payload; the
        // streamed hash must stay well under the 500 ms budget (the old
        // serde_json path expanded every byte to a JSON integer first). The
        // budget is asserted only in optimized builds — an unoptimized
        // `cargo test` runs sha2 with overflow checks and no SIMD, so its wall
        // time is not "native" performance. The number is always printed.
        let rows = 3021usize;
        let cols = 1050usize;
        let element_size = NdTensorDType::F32.element_size();
        let data = vec![0x3Cu8; rows * cols * element_size];
        let input = NdTensorInput {
            tensor_id: "big".to_string(),
            representation_id: RepresentationId::new("hyperspectral").unwrap(),
            container: "ndarray".to_string(),
            dtype: NdTensorDType::F32,
            shape: vec![rows, cols],
            observation_ids: (0..rows)
                .map(|r| ObservationId::new(format!("obs.{r}")).unwrap())
                .collect(),
            sample_ids: None,
            data,
            row_presence: None,
        };
        let tensor = NdTensor::from_input(input).unwrap();
        let start = std::time::Instant::now();
        let fingerprint = tensor.fingerprint().unwrap();
        let elapsed = start.elapsed();
        println!(
            "nd tensor fingerprint({rows}x{cols} f32) = {:.3} ms (fp={fingerprint})",
            elapsed.as_secs_f64() * 1e3
        );
        assert_eq!(fingerprint.len(), 64);
        if !cfg!(debug_assertions) {
            assert!(
                elapsed.as_millis() < 500,
                "tensor fingerprint took {} ms (>= 500 ms budget)",
                elapsed.as_millis()
            );
        }
    }
}

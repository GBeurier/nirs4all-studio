//! Modality-neutral in-memory data provider for `dag-ml-data`.
//!
//! This crate holds the pure-Rust provider logic that was historically embedded
//! in the C ABI crate (`dag-ml-data-capi`). It owns no C types: every method
//! takes and returns `dag-ml-data-core` contract types and reports failures as
//! [`dag_ml_data_core::DataError`]. The C ABI crate is a thin marshaling layer
//! on top of this; other backends (Python/NumPy, WASM) can reuse the same
//! contract surface.
//!
//! [`InMemoryProvider`] is the reference backend: it serves an immutable
//! coordinator data-plan envelope plus host-supplied target tables and numeric
//! feature buffers. It is genuinely `Send + Sync` — both interior arenas live
//! behind a single `Mutex`, not `RefCell`, so it can be shared across host
//! threads without an `unsafe` marker, and compound operations (materialize then
//! bind, release of handle and buffers) are linearizable. The handle space,
//! data/view parentage, and release semantics are owned by
//! [`dag_ml_data_core::CoordinatorHandleArena`]; callers see only opaque
//! non-zero `u64` handles.

use std::collections::BTreeMap;
use std::sync::{Mutex, MutexGuard};

use dag_ml_data_core::{
    fuse_feature_blocks, CollationPolicy, CoordinatorDataHandleRecord,
    CoordinatorDataMaterializationRequest, CoordinatorDataPlanEnvelope, CoordinatorDataViewRecord,
    CoordinatorFeatureBlock, CoordinatorFeatureBlockF64, CoordinatorHandleArena,
    CoordinatorRelationSet, CoordinatorTargetBlock, CoordinatorTargetTable, DataError, DataView,
    FeatureFusionPolicy, FeatureFusionSourceLayout, NdTensorArena, NdTensorBinding, NdTensorBlock,
    NdTensorManifest, NdTensorStore, NumericFeatureBufferArena, NumericFeatureBufferBinding,
    NumericFeatureBufferManifest, NumericFeatureBufferStore, Result, SampleAlignmentPlan,
    SourceFeatureBlock, SourceId, TargetId,
};
use serde::Deserialize;

mod json;
pub use json::JsonInMemoryProvider;

/// Default owner-controller label for the provider's handle arena.
pub fn default_owner_controller() -> String {
    "controller:data.provider".to_string()
}

/// One source of a multi-source feature fusion request.
#[derive(Debug, Deserialize)]
pub struct ProviderFeatureFusionSource {
    /// Source whose buffers contribute to the fusion.
    pub source_id: SourceId,
    /// Feature set bound to that source.
    pub feature_set_id: String,
    /// Optional column projection within the feature set.
    #[serde(default)]
    pub columns: Option<Vec<String>>,
}

/// Selector for a multi-source feature fusion over provider buffers.
#[derive(Debug, Deserialize)]
pub struct ProviderFeatureFusionSelector {
    /// Identifier of the fused feature set.
    pub feature_set_id: String,
    /// Per-source contributions to fuse.
    pub sources: Vec<ProviderFeatureFusionSource>,
    /// Sample-alignment plan across the sources.
    pub alignment: SampleAlignmentPlan,
    /// Optional by-source layout contract for source order and concat spans.
    #[serde(default)]
    pub source_layout: Option<FeatureFusionSourceLayout>,
    /// Fusion policy (namespacing, broadcasting, masks).
    #[serde(default)]
    pub policy: FeatureFusionPolicy,
}

/// Selector for a feature collation request: either a single feature set or a
/// fusion of several, with a collation policy.
#[derive(Debug, Deserialize)]
pub struct ProviderFeatureCollationRequest {
    /// Single feature-set source (mutually exclusive with `fusion`).
    #[serde(default)]
    pub feature_set_id: Option<String>,
    /// Multi-source fusion source (mutually exclusive with `feature_set_id`).
    #[serde(default)]
    pub fusion: Option<ProviderFeatureFusionSelector>,
    /// Collation policy (padding/truncation, masks).
    #[serde(default)]
    pub policy: CollationPolicy,
}

/// Rust-owned, modality-neutral in-memory provider.
///
/// Serves one immutable coordinator data-plan envelope, the host-supplied target
/// tables, and the numeric feature-buffer store. The provider does not branch on
/// modality: it routes feature buffers by representation id and aligns by sample
/// / observation identity, so the same code path serves spectra, tabular data,
/// time series, markers, and so on.
pub struct InMemoryProvider {
    // A single mutex guards both arenas so compound operations (materialize then
    // bind, release of both the handle and its buffers) are linearizable: no
    // thread can observe a half-updated state, and there is no lock-ordering
    // hazard because there is only one lock.
    arenas: Mutex<ProviderArenas>,
    envelope: CoordinatorDataPlanEnvelope,
    target_tables: BTreeMap<TargetId, CoordinatorTargetTable>,
}

struct ProviderArenas {
    handles: CoordinatorHandleArena,
    features: NumericFeatureBufferArena,
    nd_tensors: NdTensorArena,
}

/// The provider contract the C ABI vtable is built on.
///
/// Any backend — the reference [`InMemoryProvider`], or a future Python/NumPy or
/// WASM-backed provider — implements these six operations in terms of the
/// generic `dag-ml-data-core` contract types and opaque non-zero `u64` handles.
/// Handle semantics are part of the contract: `materialize` mints a data handle,
/// `make_view` mints a view handle parented to a data handle, and `release`
/// invalidates a handle and its children (best-effort; returns whether anything
/// was released). Modality-specific extensions (feature fusion, collation
/// selectors, buffer manifests) are deliberately NOT part of this trait; they
/// live as inherent methods on the concrete backend that supports them.
pub trait DagMlDataProvider {
    /// Materializes a data handle for `request`.
    fn materialize(
        &self,
        request: &CoordinatorDataMaterializationRequest,
    ) -> Result<CoordinatorDataHandleRecord>;

    /// Creates a filtered view over a materialized data handle.
    fn make_view(&self, data_handle: u64, view: &DataView) -> Result<CoordinatorDataViewRecord>;

    /// Returns the sample/observation identity rows of a view.
    fn view_identity(&self, view_handle: u64) -> Result<CoordinatorRelationSet>;

    /// Projects the target block for `target_id` over a view.
    fn target_block(
        &self,
        view_handle: u64,
        target_id: &TargetId,
    ) -> Result<CoordinatorTargetBlock>;

    /// Projects a single feature set over a view.
    fn feature_block(
        &self,
        view_handle: u64,
        feature_set_id: &str,
    ) -> Result<CoordinatorFeatureBlock>;

    /// Releases a data or view handle and any state attached to it. Returns
    /// whether anything was released.
    fn release(&self, handle: u64) -> bool;
}

impl InMemoryProvider {
    /// Builds a provider over a validated envelope, target tables, and feature
    /// store (no N-D tensors).
    pub fn new(
        envelope: CoordinatorDataPlanEnvelope,
        target_tables: BTreeMap<TargetId, CoordinatorTargetTable>,
        feature_store: NumericFeatureBufferStore,
    ) -> Result<Self> {
        Self::new_with_tensors(
            envelope,
            target_tables,
            feature_store,
            NdTensorStore::default(),
        )
    }

    /// Builds a provider that also serves host-supplied N-D tensors (RGB images,
    /// hyperspectral cubes, ...) bound by representation like feature buffers.
    pub fn new_with_tensors(
        envelope: CoordinatorDataPlanEnvelope,
        target_tables: BTreeMap<TargetId, CoordinatorTargetTable>,
        feature_store: NumericFeatureBufferStore,
        nd_tensor_store: NdTensorStore,
    ) -> Result<Self> {
        envelope.validate()?;
        Ok(Self {
            arenas: Mutex::new(ProviderArenas {
                handles: CoordinatorHandleArena::new(default_owner_controller())?,
                features: NumericFeatureBufferArena::new(feature_store),
                nd_tensors: NdTensorArena::new(nd_tensor_store),
            }),
            envelope,
            target_tables,
        })
    }

    /// Projects a feature set over a view, optionally scoped to one source and a
    /// column subset. When no columns are given and no source scope is set, the
    /// view's own column projection (if any) is applied.
    pub fn feature_block_filtered(
        &self,
        view_handle: u64,
        feature_set_id: &str,
        source_id: Option<&SourceId>,
        columns: Option<&[String]>,
    ) -> Result<CoordinatorFeatureBlock> {
        let arenas = self.lock_arenas()?;
        let view_record =
            arenas
                .handles
                .view_record(view_handle)
                .ok_or(DataError::UnknownHandle {
                    kind: "view",
                    handle: view_handle,
                })?;
        let parent_record = arenas
            .handles
            .handle_record(view_record.parent_handle.handle)
            .ok_or(DataError::UnknownHandle {
                kind: "data",
                handle: view_record.parent_handle.handle,
            })?;
        let relations = arenas.handles.view_identity(view_handle)?;
        let selected_columns: Option<Vec<String>> = if source_id.is_some() {
            columns.map(<[String]>::to_vec)
        } else {
            columns
                .map(<[String]>::to_vec)
                .or_else(|| view_record.view.columns.clone())
        };
        arenas.features.project_bound_relations(
            parent_record.handle.handle,
            feature_set_id,
            &relations,
            source_id,
            selected_columns.as_deref(),
        )
    }

    /// Typed sibling of [`DagMlDataProvider::feature_block`]: projects the
    /// feature set over the view straight into a flat row-major `Vec<f64>` —
    /// no `rows × cols` boxed JSON values. The view's own column projection
    /// (if any) is honored, exactly like the untyped path. Masked cells are an
    /// error. This is the hot path for large numeric matrices crossing a
    /// typed-array binding boundary (e.g. WASM `Float64Array`).
    pub fn feature_block_f64(
        &self,
        view_handle: u64,
        feature_set_id: &str,
    ) -> Result<CoordinatorFeatureBlockF64> {
        let arenas = self.lock_arenas()?;
        let view_record =
            arenas
                .handles
                .view_record(view_handle)
                .ok_or(DataError::UnknownHandle {
                    kind: "view",
                    handle: view_handle,
                })?;
        let parent_record = arenas
            .handles
            .handle_record(view_record.parent_handle.handle)
            .ok_or(DataError::UnknownHandle {
                kind: "data",
                handle: view_record.parent_handle.handle,
            })?;
        let relations = arenas.handles.view_identity(view_handle)?;
        let selected_columns = view_record.view.columns.clone();
        arenas.features.project_bound_relations_f64(
            parent_record.handle.handle,
            feature_set_id,
            &relations,
            None,
            selected_columns.as_deref(),
        )
    }

    /// Fuses feature buffers from several sources into one feature block.
    pub fn feature_fusion_block(
        &self,
        view_handle: u64,
        selector: &ProviderFeatureFusionSelector,
    ) -> Result<CoordinatorFeatureBlock> {
        if selector.sources.is_empty() {
            return Err(DataError::Validation(
                "feature fusion selector requires at least one source".to_string(),
            ));
        }
        let mut sources = Vec::with_capacity(selector.sources.len());
        for source in &selector.sources {
            let block = self.feature_block_filtered(
                view_handle,
                &source.feature_set_id,
                Some(&source.source_id),
                source.columns.as_deref(),
            )?;
            sources.push(SourceFeatureBlock {
                source_id: source.source_id.clone(),
                block,
            });
        }
        if let Some(layout) = &selector.source_layout {
            layout.validate_for_source_blocks(&selector.feature_set_id, &sources)?;
        }
        fuse_feature_blocks(
            selector.feature_set_id.clone(),
            &sources,
            &selector.alignment,
            &selector.policy,
        )
    }

    /// Resolves a collation selector to a single feature block, either a single
    /// feature set or a multi-source fusion.
    pub fn feature_collation_block(
        &self,
        view_handle: u64,
        selector: &ProviderFeatureCollationRequest,
    ) -> Result<CoordinatorFeatureBlock> {
        match (&selector.feature_set_id, &selector.fusion) {
            (Some(feature_set_id), None) => {
                if feature_set_id.trim().is_empty() {
                    return Err(DataError::Validation(
                        "feature collation selector feature_set_id is empty".to_string(),
                    ));
                }
                self.feature_block(view_handle, feature_set_id)
            }
            (None, Some(fusion)) => self.feature_fusion_block(view_handle, fusion),
            (Some(_), Some(_)) => Err(DataError::Validation(
                "feature collation selector must not specify both feature_set_id and fusion"
                    .to_string(),
            )),
            (None, None) => Err(DataError::Validation(
                "feature collation selector requires feature_set_id or fusion".to_string(),
            )),
        }
    }

    /// Returns the provider-wide feature-buffer manifests.
    pub fn feature_buffer_manifests(&self) -> Result<Vec<NumericFeatureBufferManifest>> {
        self.lock_arenas()?.features.manifests()
    }

    /// Returns the feature-buffer bindings scoped to one materialized data
    /// handle.
    pub fn data_feature_buffer_bindings(
        &self,
        data_handle: u64,
    ) -> Result<Vec<NumericFeatureBufferBinding>> {
        let arenas = self.lock_arenas()?;
        if arenas.handles.handle_record(data_handle).is_none() {
            return Err(DataError::UnknownHandle {
                kind: "data",
                handle: data_handle,
            });
        }
        arenas.features.bindings_for_data_handle(data_handle)
    }

    /// Returns the provider-wide N-D tensor manifests.
    pub fn nd_tensor_manifests(&self) -> Result<Vec<NdTensorManifest>> {
        self.lock_arenas()?.nd_tensors.manifests()
    }

    /// Returns the N-D tensor bindings scoped to one materialized data handle.
    pub fn data_nd_tensor_bindings(&self, data_handle: u64) -> Result<Vec<NdTensorBinding>> {
        let arenas = self.lock_arenas()?;
        if arenas.handles.handle_record(data_handle).is_none() {
            return Err(DataError::UnknownHandle {
                kind: "data",
                handle: data_handle,
            });
        }
        arenas.nd_tensors.bindings_for_data_handle(data_handle)
    }

    /// Projects a bound N-D tensor over a view (axis-0 gather by observation id),
    /// optionally scoped to one source.
    pub fn nd_tensor_block(
        &self,
        view_handle: u64,
        tensor_id: &str,
        source_id: Option<&SourceId>,
    ) -> Result<NdTensorBlock> {
        let arenas = self.lock_arenas()?;
        let view_record =
            arenas
                .handles
                .view_record(view_handle)
                .ok_or(DataError::UnknownHandle {
                    kind: "view",
                    handle: view_handle,
                })?;
        let parent_record = arenas
            .handles
            .handle_record(view_record.parent_handle.handle)
            .ok_or(DataError::UnknownHandle {
                kind: "data",
                handle: view_record.parent_handle.handle,
            })?;
        let relations = arenas.handles.view_identity(view_handle)?;
        arenas.nd_tensors.project_bound_relations(
            parent_record.handle.handle,
            tensor_id,
            &relations,
            source_id,
        )
    }

    /// Locks both arenas. A poisoned lock (a prior panic while holding it) is
    /// mapped to a `DataError` so the failure crosses the C ABI as a status
    /// code instead of unwinding across the FFI boundary.
    fn lock_arenas(&self) -> Result<MutexGuard<'_, ProviderArenas>> {
        self.arenas
            .lock()
            .map_err(|_| DataError::Validation("provider arena mutex is poisoned".to_string()))
    }
}

impl DagMlDataProvider for InMemoryProvider {
    /// Materializes a data handle for `request` and binds the feature buffers
    /// whose representation matches the materialized output representation.
    fn materialize(
        &self,
        request: &CoordinatorDataMaterializationRequest,
    ) -> Result<CoordinatorDataHandleRecord> {
        let mut arenas = self.lock_arenas()?;
        let record = arenas.handles.materialize(&self.envelope, request)?;
        // Bind feature buffers and N-D tensors under the same lock so the data
        // handle and its bindings are published atomically with respect to
        // `release`.
        let relations = arenas.handles.data_identity(record.handle.handle).ok();
        if let Some(relations) = relations {
            let handle = record.handle.handle;
            let representation = record.output_representation.clone();
            arenas
                .features
                .bind_data_handle(handle, &relations, &representation)?;
            arenas
                .nd_tensors
                .bind_data_handle(handle, &relations, &representation)?;
        }
        Ok(record)
    }

    fn make_view(&self, data_handle: u64, view: &DataView) -> Result<CoordinatorDataViewRecord> {
        self.lock_arenas()?.handles.make_view(data_handle, view)
    }

    fn view_identity(&self, view_handle: u64) -> Result<CoordinatorRelationSet> {
        self.lock_arenas()?.handles.view_identity(view_handle)
    }

    /// A valid-but-absent target id is reported as a semantic data-validation
    /// failure (not a boundary error).
    fn target_block(
        &self,
        view_handle: u64,
        target_id: &TargetId,
    ) -> Result<CoordinatorTargetBlock> {
        let target_table = self
            .target_tables
            .get(target_id)
            .ok_or_else(|| DataError::Validation(format!("unknown target id `{target_id}`")))?;
        self.lock_arenas()?
            .handles
            .target_values(view_handle, target_table)
    }

    fn feature_block(
        &self,
        view_handle: u64,
        feature_set_id: &str,
    ) -> Result<CoordinatorFeatureBlock> {
        self.feature_block_filtered(view_handle, feature_set_id, None, None)
    }

    fn release(&self, handle: u64) -> bool {
        let Ok(mut arenas) = self.lock_arenas() else {
            return false;
        };
        let released_handle = arenas.handles.release_handle(handle);
        let released_buffers = arenas.features.release_data_handle(handle);
        let released_tensors = arenas.nd_tensors.release_data_handle(handle);
        released_handle || released_buffers || released_tensors
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use dag_ml_data_core::{
        AxisKind, AxisSpec, CoordinatorDataMaterializationRequest, CoordinatorDataPlanEnvelope,
        DataPlan, DataPlanStep, DataPlanStepKind, DataView, DatasetSchema, FitScope,
        NumericFeatureBufferStore, NumericFeatureMatrixF64, ObservationId, RepresentationId,
        RepresentationSpec, SampleId, SampleRelation, SampleRelationTable, SourceDescriptor,
        SourceGranularity, SourceId, TypeId,
    };

    use super::{DagMlDataProvider, InMemoryProvider, ProviderFeatureCollationRequest};

    /// A single-source tabular provider: source `src`, samples `s1..s3`, one
    /// feature set `x` with two columns (`f0`, `f1`). Mirrors the C-ABI modality
    /// fixtures but stays entirely in pure Rust so the extracted provider crate
    /// is exercised without the FFI layer.
    fn fixture_parts() -> (
        CoordinatorDataPlanEnvelope,
        CoordinatorDataMaterializationRequest,
        NumericFeatureBufferStore,
    ) {
        let representation_id = RepresentationId::new("tabular_numeric").unwrap();
        let native_representation = RepresentationSpec {
            id: representation_id.clone(),
            type_id: TypeId::new("table").unwrap(),
            rank: Some(2),
            axes: vec![
                AxisSpec {
                    name: "sample".to_string(),
                    kind: AxisKind::Sample,
                    unit: None,
                    size: Some(3),
                    variable: false,
                    coordinate: None,
                },
                AxisSpec {
                    name: "feature".to_string(),
                    kind: AxisKind::Feature,
                    unit: None,
                    size: Some(2),
                    variable: false,
                    coordinate: None,
                },
            ],
            container: "dataframe".to_string(),
            dtype: Some("float64".to_string()),
            sparse: false,
            ragged: false,
            signal_type: None,
        };
        let schema = DatasetSchema {
            dataset_id: "tabular-dataset".to_string(),
            sample_ids: vec![
                SampleId::new("s1").unwrap(),
                SampleId::new("s2").unwrap(),
                SampleId::new("s3").unwrap(),
            ],
            sources: vec![SourceDescriptor {
                id: SourceId::new("src").unwrap(),
                name: "tabular source".to_string(),
                type_id: TypeId::new("table").unwrap(),
                modality: "tabular".to_string(),
                native_representation,
                sample_key: "sample_id".to_string(),
                granularity: SourceGranularity::PerSample,
                schema: BTreeMap::new(),
                tags: BTreeMap::new(),
                shape_contract: None,
            }],
            targets: BTreeMap::new(),
            metadata: BTreeMap::new(),
            metadata_schema: None,
            groups: Vec::new(),
            folds: Vec::new(),
        };
        let relation = |observation: &str, sample: &str| SampleRelation {
            observation_id: ObservationId::new(observation).unwrap(),
            sample_id: SampleId::new(sample).unwrap(),
            source_id: Some(SourceId::new("src").unwrap()),
            target_id: None,
            group_id: None,
            origin_id: None,
            repetition_id: None,
            augmented: false,
            excluded: false,
            metadata: BTreeMap::new(),
            tags: Vec::new(),
            augmentation: None,
        };
        let relations = SampleRelationTable {
            rows: vec![
                relation("obs.s1", "s1"),
                relation("obs.s2", "s2"),
                relation("obs.s3", "s3"),
            ],
        };
        let plan = DataPlan {
            id: "modality-tabular_numeric".to_string(),
            steps: vec![DataPlanStep {
                kind: DataPlanStepKind::Materialize,
                source_id: Some(SourceId::new("src").unwrap()),
                adapter_id: None,
                input_representation: None,
                output_representation: Some(representation_id.clone()),
                fit_scope: FitScope::Stateless,
                requires_user_choice: false,
                metadata: BTreeMap::new(),
            }],
            output_representation: representation_id.clone(),
            issues: Vec::new(),
        };
        let envelope =
            CoordinatorDataPlanEnvelope::from_parts(&schema, plan, Some(&relations)).unwrap();
        let request = CoordinatorDataMaterializationRequest {
            run_id: "run:test".to_string(),
            node_id: "node:model".to_string(),
            input_name: "X".to_string(),
            phase: "fit".to_string(),
            variant_id: None,
            fold_id: None,
            request_id: "req:test".to_string(),
            schema_fingerprint: envelope.schema_fingerprint.clone(),
            plan_fingerprint: envelope.plan_fingerprint.clone(),
            relation_fingerprint: envelope.relation_fingerprint.clone(),
            output_representation: representation_id.clone(),
            source_ids: Vec::new(),
            require_relations: false,
        };
        let store = NumericFeatureBufferStore::from_f64_matrices(vec![NumericFeatureMatrixF64 {
            feature_set_id: "x".to_string(),
            representation_id,
            feature_names: vec!["f0".to_string(), "f1".to_string()],
            observation_ids: vec![
                ObservationId::new("obs.s1").unwrap(),
                ObservationId::new("obs.s2").unwrap(),
                ObservationId::new("obs.s3").unwrap(),
            ],
            values: vec![1.0, 10.0, 2.0, 20.0, 3.0, 30.0],
            validity_mask: None,
        }])
        .unwrap();
        (envelope, request, store)
    }

    fn fixture() -> (InMemoryProvider, CoordinatorDataMaterializationRequest) {
        let (envelope, request, store) = fixture_parts();
        (
            InMemoryProvider::new(envelope, BTreeMap::new(), store).unwrap(),
            request,
        )
    }

    fn nd_fixture() -> (InMemoryProvider, CoordinatorDataMaterializationRequest) {
        use dag_ml_data_core::{NdTensorDType, NdTensorInput, NdTensorStore};
        let (envelope, request, store) = fixture_parts();
        // [3, 2] u8 tensor over obs.s1..s3, representation matches the plan
        // output so it binds at materialize like the feature buffers.
        let nd = NdTensorStore::from_inputs(vec![NdTensorInput {
            tensor_id: "rgb".to_string(),
            representation_id: RepresentationId::new("tabular_numeric").unwrap(),
            container: "pil_image_batch".to_string(),
            dtype: NdTensorDType::U8,
            shape: vec![3, 2],
            observation_ids: vec![
                ObservationId::new("obs.s1").unwrap(),
                ObservationId::new("obs.s2").unwrap(),
                ObservationId::new("obs.s3").unwrap(),
            ],
            sample_ids: None,
            data: vec![1, 2, 3, 4, 5, 6],
            row_presence: None,
        }])
        .unwrap();
        (
            InMemoryProvider::new_with_tensors(envelope, BTreeMap::new(), store, nd).unwrap(),
            request,
        )
    }

    fn full_view() -> DataView {
        DataView {
            sample_ids: Some(vec![
                SampleId::new("s1").unwrap(),
                SampleId::new("s2").unwrap(),
                SampleId::new("s3").unwrap(),
            ]),
            include_augmented: true,
            ..DataView::default()
        }
    }

    fn observation_strings(block: &dag_ml_data_core::CoordinatorFeatureBlock) -> Vec<String> {
        block
            .observation_ids
            .iter()
            .map(|observation| observation.as_str().to_string())
            .collect()
    }

    #[test]
    fn materialize_binds_nd_tensors_and_block_projects_in_relation_order() {
        let (provider, request) = nd_fixture();
        let data = provider.materialize(&request).unwrap();

        let manifests = provider.nd_tensor_manifests().unwrap();
        assert_eq!(manifests.len(), 1);
        assert_eq!(manifests[0].shape, vec![3, 2]);
        assert!(!provider
            .data_nd_tensor_bindings(data.handle.handle)
            .unwrap()
            .is_empty());

        // View selects s3 then s1; the ND block gathers axis-0 rows in that order.
        let view = DataView {
            sample_ids: Some(vec![
                SampleId::new("s3").unwrap(),
                SampleId::new("s1").unwrap(),
            ]),
            include_augmented: true,
            ..DataView::default()
        };
        let view = provider.make_view(data.handle.handle, &view).unwrap();
        let block = provider
            .nd_tensor_block(view.handle.handle, "rgb", None)
            .unwrap();
        assert_eq!(block.shape, vec![2, 2]);
        assert_eq!(block.data, vec![5, 6, 1, 2]);

        assert!(provider.release(data.handle.handle));
        assert!(provider
            .data_nd_tensor_bindings(data.handle.handle)
            .is_err());
    }

    #[test]
    fn materialize_binds_features_and_feature_block_projects() {
        let (provider, request) = fixture();
        let data = provider.materialize(&request).unwrap();
        let view = provider
            .make_view(data.handle.handle, &full_view())
            .unwrap();
        let block = provider.feature_block(view.handle.handle, "x").unwrap();
        assert_eq!(
            block.feature_names,
            vec!["f0".to_string(), "f1".to_string()]
        );
        assert_eq!(
            observation_strings(&block),
            vec!["obs.s1", "obs.s2", "obs.s3"]
        );
        assert_eq!(
            block.values,
            vec![
                vec![serde_json::json!(1.0), serde_json::json!(10.0)],
                vec![serde_json::json!(2.0), serde_json::json!(20.0)],
                vec![serde_json::json!(3.0), serde_json::json!(30.0)],
            ]
        );
    }

    #[test]
    fn view_column_projection_limits_features() {
        let (provider, request) = fixture();
        let data = provider.materialize(&request).unwrap();
        let view = DataView {
            columns: Some(vec!["f1".to_string()]),
            ..full_view()
        };
        let view = provider.make_view(data.handle.handle, &view).unwrap();
        let block = provider.feature_block(view.handle.handle, "x").unwrap();
        assert_eq!(block.feature_names, vec!["f1".to_string()]);
        assert_eq!(
            block.values,
            vec![
                vec![serde_json::json!(10.0)],
                vec![serde_json::json!(20.0)],
                vec![serde_json::json!(30.0)],
            ]
        );
    }

    #[test]
    fn collation_selector_routes_single_feature_set() {
        let (provider, request) = fixture();
        let data = provider.materialize(&request).unwrap();
        let view = provider
            .make_view(data.handle.handle, &full_view())
            .unwrap();
        let selector = ProviderFeatureCollationRequest {
            feature_set_id: Some("x".to_string()),
            fusion: None,
            policy: Default::default(),
        };
        let block = provider
            .feature_collation_block(view.handle.handle, &selector)
            .unwrap();
        assert_eq!(
            block.feature_names,
            vec!["f0".to_string(), "f1".to_string()]
        );
    }

    #[test]
    fn release_removes_data_handle_bindings() {
        let (provider, request) = fixture();
        let data = provider.materialize(&request).unwrap();
        assert!(!provider
            .data_feature_buffer_bindings(data.handle.handle)
            .unwrap()
            .is_empty());
        assert!(provider.release(data.handle.handle));
        assert!(provider
            .data_feature_buffer_bindings(data.handle.handle)
            .is_err());
    }
}

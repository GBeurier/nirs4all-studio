//! Typed IO `DatasetPackage` to DAG-ML/Methods training composition.
//!
//! IO remains the authority for package materialization and numeric buffers;
//! DAG-ML remains the authority for folds, training, selection and replay.
//! This module only adapts their public provider contracts inside the portable
//! aggregate.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::Mutex;

use dag_ml_core::{
    build_archive_v2_native_portable_payloads, data_binding_requirement_key, execute_training,
    ArtifactLoadMode, BundleId, ControllerId, DataBinding, DataMaterializationRequest,
    DataProviderViewSpec, DataViewRequest, EntityUnitLevel, ExternalDataPlanEnvelope,
    FittedArtifactMode, HandleKind, HandleRef, InMemoryArtifactStore, MethodsPlsController,
    MethodsPlsData, MethodsPlsDataRequest, MethodsPlsDataset, MethodsPlsMatrix, MethodsRuntime,
    Phase, RunId, RuntimeControllerRegistry, RuntimeDataProvider, SampleRelation,
    SampleRelationSet, TrainingDataIdentity, TrainingExecutionInput, TrainingInfluenceManifest,
    TrainingOutcome, TrainingRequest,
};
use dag_ml_data_crate::{
    CoordinatorDataMaterializationRequest, CoordinatorHandleKind, DataView, SampleId as IoSampleId,
    SourceId as IoSourceId,
};
use dag_ml_data_provider_crate::DagMlDataProvider;
pub use nirs4all_io_dagml::DatasetPackage;
use nirs4all_io_dagml::PackageProvider;

use crate::{write_archive_v2, ArchivePayload, ArchiveV2Reference, ArchiveV2WriteRequest};

#[derive(Clone, Debug, PartialEq)]
struct ViewSlot {
    node_id: dag_ml_core::NodeId,
    input_name: String,
    phase: Phase,
    variant_id: Option<dag_ml_core::VariantId>,
    fold_id: Option<dag_ml_core::FoldId>,
    view: DataProviderViewSpec,
    handle: u64,
}

#[derive(Default)]
struct ProviderHandles {
    data: BTreeSet<u64>,
    views: Vec<ViewSlot>,
}

/// Runtime adapter over one exact numeric source selected from an IO package.
///
/// The adapter does not own or reinterpret feature buffers. It forwards every
/// scheduler-created identity view to IO's `PackageProvider`, projects the
/// resulting typed `f64` block, and releases all provider handles explicitly.
pub struct DatasetPackageMethodsProvider {
    provider: PackageProvider,
    external_envelope: ExternalDataPlanEnvelope,
    relations: SampleRelationSet,
    source_id: String,
    handles: Mutex<ProviderHandles>,
}

impl DatasetPackageMethodsProvider {
    /// Select one source from a dense numeric package. Fusion, N-D tensors and
    /// named processing stacks remain fail-closed in the IO owner.
    pub fn new(package: &DatasetPackage, source_id: &str) -> Result<Self, String> {
        if package.task_type != "regression" {
            return Err(format!(
                "Core Methods package training requires task_type=regression, got `{}`",
                package.task_type
            ));
        }
        let provider = PackageProvider::from_package_source(package, source_id)
            .map_err(|error| error.to_string())?;
        if provider.target_names().is_empty() || provider.target_ids().is_empty() {
            return Err("Core Methods package training requires numeric targets".to_string());
        }
        let relations = convert_relations(
            provider
                .envelope()
                .coordinator_relations
                .as_ref()
                .ok_or("Core Methods package training requires coordinator relations")?,
        )?;
        let relation_fingerprint = relations.fingerprint().map_err(|error| error.to_string())?;
        let external_envelope = ExternalDataPlanEnvelope {
            schema_version: 1,
            schema_fingerprint: provider.envelope().schema_fingerprint.clone(),
            plan_fingerprint: provider.envelope().plan_fingerprint.clone(),
            relation_fingerprint: Some(relation_fingerprint),
            data_content_fingerprint: provider.envelope().data_content_fingerprint.clone(),
            target_content_fingerprint: provider.envelope().target_content_fingerprint.clone(),
            coordinator_relations: Some(relations.clone()),
            predict_cohort: None,
        };
        external_envelope
            .validate()
            .map_err(|error| error.to_string())?;
        Ok(Self {
            provider,
            external_envelope,
            relations,
            source_id: source_id.to_string(),
            handles: Mutex::new(ProviderHandles::default()),
        })
    }

    pub fn external_envelope(&self) -> &ExternalDataPlanEnvelope {
        &self.external_envelope
    }

    pub fn relations(&self) -> &SampleRelationSet {
        &self.relations
    }

    pub fn source_id(&self) -> &str {
        &self.source_id
    }

    /// Explicitly release all IO provider handles. `Drop` invokes the same
    /// operation, so early-return and error paths are deterministic too.
    pub fn release_all(&self) {
        let Ok(mut handles) = self.handles.lock() else {
            return;
        };
        for slot in handles.views.drain(..).rev() {
            self.provider.release(slot.handle);
        }
        for handle in std::mem::take(&mut handles.data).into_iter().rev() {
            self.provider.release(handle);
        }
    }

    fn validate_binding(&self, binding: &DataBinding) -> Result<(), String> {
        binding
            .validate_envelope(&self.external_envelope)
            .map_err(|error| error.to_string())?;
        if binding.feature_set_id() != self.provider.feature_set_id()
            || binding.source_ids.as_slice() != [self.source_id.as_str()]
            || binding.output_representation
                != self.provider.envelope().plan.output_representation.as_str()
        {
            return Err(format!(
                "Core Methods package binding `{}` must select only IO source `{}` and its exact output representation",
                data_binding_requirement_key(&binding.node_id, &binding.input_name),
                self.source_id
            ));
        }
        Ok(())
    }

    fn view_handle(
        &self,
        request: &MethodsPlsDataRequest,
        view: &DataProviderViewSpec,
    ) -> Result<u64, String> {
        let handles = self
            .handles
            .lock()
            .map_err(|_| "Core IO provider handle registry is poisoned".to_string())?;
        handles
            .views
            .iter()
            .rev()
            .find(|slot| {
                slot.node_id == request.node_id
                    && slot.input_name == request.binding.input_name
                    && slot.phase == request.phase
                    && slot.variant_id == request.variant_id
                    && slot.fold_id == request.fold_id
                    && slot.view == *view
            })
            .map(|slot| slot.handle)
            .ok_or_else(|| {
                format!(
                    "Core IO provider has no scheduler-created view for `{}.{}` {:?}",
                    request.node_id, request.binding.input_name, request.phase
                )
            })
    }

    fn project_dataset(
        &self,
        request: &MethodsPlsDataRequest,
        view: &DataProviderViewSpec,
        require_targets: bool,
    ) -> Result<MethodsPlsDataset, String> {
        let view_handle = self.view_handle(request, view)?;
        let feature = self
            .provider
            .feature_block_f64(view_handle)
            .map_err(|error| error.to_string())?;
        if feature.feature_set_id != self.provider.feature_set_id()
            || feature.observation_ids.len() != feature.sample_ids.len()
            || feature
                .sample_ids
                .len()
                .checked_mul(feature.feature_names.len())
                != Some(feature.values.len())
        {
            return Err("Core IO provider returned an invalid typed feature block".to_string());
        }
        let sample_ids = feature
            .sample_ids
            .iter()
            .map(|id| dag_ml_core::SampleId::new(id.as_str()).map_err(|error| error.to_string()))
            .collect::<Result<Vec<_>, _>>()?;
        let target_names = self.provider.target_names().to_vec();
        let y = if require_targets {
            Some(self.project_targets(view_handle, &feature.sample_ids, &target_names)?)
        } else {
            None
        };
        let dataset = MethodsPlsDataset {
            sample_ids,
            x: MethodsPlsMatrix {
                rows: feature.sample_ids.len(),
                cols: feature.feature_names.len(),
                values: feature.values,
            },
            y,
            target_names,
        };
        dataset
            .validate("IO DatasetPackage", require_targets)
            .map_err(|error| error.to_string())?;
        Ok(dataset)
    }

    fn project_targets(
        &self,
        view_handle: u64,
        sample_ids: &[IoSampleId],
        target_names: &[String],
    ) -> Result<MethodsPlsMatrix, String> {
        let target_ids = self.provider.target_ids();
        let values = if target_ids.len() == 1 && target_names.len() > 1 {
            let block = self
                .provider
                .target_block(view_handle, &target_ids[0])
                .map_err(|error| error.to_string())?;
            validate_target_samples(sample_ids, &block.sample_ids)?;
            let mut values = Vec::with_capacity(sample_ids.len() * target_names.len());
            for value in &block.values {
                let row = value
                    .as_array()
                    .ok_or("Core IO provider multi-target block contains a non-array row")?;
                if row.len() != target_names.len() {
                    return Err(
                        "Core IO provider multi-target block width differs from target names"
                            .to_string(),
                    );
                }
                for cell in row {
                    values.push(finite_number(cell, "multi-target cell")?);
                }
            }
            values
        } else {
            if target_ids.len() != target_names.len() {
                return Err(
                    "Core IO provider target identifiers differ from target-column names"
                        .to_string(),
                );
            }
            let blocks = target_ids
                .iter()
                .map(|target_id| {
                    self.provider
                        .target_block(view_handle, target_id)
                        .map_err(|error| error.to_string())
                })
                .collect::<Result<Vec<_>, _>>()?;
            for block in &blocks {
                validate_target_samples(sample_ids, &block.sample_ids)?;
            }
            let mut values = Vec::with_capacity(sample_ids.len() * target_names.len());
            for row in 0..sample_ids.len() {
                for block in &blocks {
                    values.push(finite_number(&block.values[row], "target cell")?);
                }
            }
            values
        };
        Ok(MethodsPlsMatrix {
            values,
            rows: sample_ids.len(),
            cols: target_names.len(),
        })
    }
}

impl Drop for DatasetPackageMethodsProvider {
    fn drop(&mut self) {
        self.release_all();
    }
}

impl RuntimeDataProvider for DatasetPackageMethodsProvider {
    fn materialize(&self, request: &DataMaterializationRequest) -> dag_ml_core::Result<HandleRef> {
        self.validate_binding(&request.binding)
            .map_err(dag_ml_core::DagMlError::RuntimeValidation)?;
        let io_request = CoordinatorDataMaterializationRequest {
            run_id: request.run_id.to_string(),
            node_id: request.node_id.to_string(),
            input_name: request.input_name.clone(),
            phase: request.phase.as_str().to_string(),
            variant_id: request.variant_id.as_ref().map(ToString::to_string),
            fold_id: request.fold_id.as_ref().map(ToString::to_string),
            request_id: request.binding.request_id.clone(),
            schema_fingerprint: self.provider.envelope().schema_fingerprint.clone(),
            plan_fingerprint: self.provider.envelope().plan_fingerprint.clone(),
            relation_fingerprint: self.provider.envelope().relation_fingerprint.clone(),
            output_representation: self.provider.envelope().plan.output_representation.clone(),
            source_ids: vec![IoSourceId::new(&self.source_id)
                .map_err(|error| dag_ml_core::DagMlError::RuntimeValidation(error.to_string()))?],
            require_relations: request.binding.require_relations,
        };
        let record = self
            .provider
            .materialize(&io_request)
            .map_err(|error| dag_ml_core::DagMlError::RuntimeValidation(error.to_string()))?;
        if record.handle.kind != CoordinatorHandleKind::Data {
            return Err(dag_ml_core::DagMlError::RuntimeValidation(
                "IO PackageProvider returned a non-data materialization handle".to_string(),
            ));
        }
        self.handles
            .lock()
            .map_err(|_| {
                dag_ml_core::DagMlError::RuntimeValidation(
                    "Core IO provider handle registry is poisoned".to_string(),
                )
            })?
            .data
            .insert(record.handle.handle);
        Ok(HandleRef {
            handle: record.handle.handle,
            kind: HandleKind::Data,
            owner_controller: ControllerId::new(record.handle.owner_controller)
                .map_err(|error| dag_ml_core::DagMlError::RuntimeValidation(error.to_string()))?,
        })
    }

    fn make_view(&self, request: &DataViewRequest) -> dag_ml_core::Result<HandleRef> {
        self.validate_binding(&request.binding)
            .map_err(dag_ml_core::DagMlError::RuntimeValidation)?;
        let mut handles = self.handles.lock().map_err(|_| {
            dag_ml_core::DagMlError::RuntimeValidation(
                "Core IO provider handle registry is poisoned".to_string(),
            )
        })?;
        if !handles.data.contains(&request.data_handle.handle) {
            return Err(dag_ml_core::DagMlError::RuntimeValidation(format!(
                "Core IO provider does not own data handle {}",
                request.data_handle.handle
            )));
        }
        if request.view.branch_view.is_some() {
            return Err(dag_ml_core::DagMlError::RuntimeValidation(
                "Core DATA-002 Methods training does not support branch/fusion views".to_string(),
            ));
        }
        let view = DataView {
            sample_ids: request
                .view
                .sample_ids
                .as_ref()
                .map(|ids| {
                    ids.iter()
                        .map(|id| IoSampleId::new(id.as_str()).map_err(|error| error.to_string()))
                        .collect::<Result<Vec<_>, _>>()
                })
                .transpose()
                .map_err(dag_ml_core::DagMlError::RuntimeValidation)?,
            partition: None,
            fold_id: None,
            source_ids: Some(vec![IoSourceId::new(&self.source_id).map_err(|error| {
                dag_ml_core::DagMlError::RuntimeValidation(error.to_string())
            })?]),
            columns: request.view.columns.clone(),
            include_augmented: request.view.include_augmented,
            include_excluded: request.view.include_excluded,
            branch_view: None,
            extra: request.view.extra.clone(),
        };
        let record = self
            .provider
            .make_view(request.data_handle.handle, &view)
            .map_err(|error| dag_ml_core::DagMlError::RuntimeValidation(error.to_string()))?;
        if record.handle.kind != CoordinatorHandleKind::View {
            return Err(dag_ml_core::DagMlError::RuntimeValidation(
                "IO PackageProvider returned a non-view handle".to_string(),
            ));
        }
        handles.views.push(ViewSlot {
            node_id: request.node_id.clone(),
            input_name: request.input_name.clone(),
            phase: request.phase,
            variant_id: request.variant_id.clone(),
            fold_id: request.fold_id.clone(),
            view: request.view.clone(),
            handle: record.handle.handle,
        });
        Ok(HandleRef {
            handle: record.handle.handle,
            kind: HandleKind::DataView,
            owner_controller: ControllerId::new(record.handle.owner_controller)
                .map_err(|error| dag_ml_core::DagMlError::RuntimeValidation(error.to_string()))?,
        })
    }

    fn training_data_identity(
        &self,
        binding: &DataBinding,
    ) -> dag_ml_core::Result<Option<TrainingDataIdentity>> {
        self.validate_binding(binding)
            .map_err(dag_ml_core::DagMlError::RuntimeValidation)?;
        TrainingDataIdentity::from_binding_envelope(binding, &self.external_envelope).map(Some)
    }

    fn coordinator_relations(
        &self,
        binding: &DataBinding,
    ) -> dag_ml_core::Result<Option<SampleRelationSet>> {
        self.validate_binding(binding)
            .map_err(dag_ml_core::DagMlError::RuntimeValidation)?;
        Ok(Some(self.relations.clone()))
    }

    fn methods_pls_capability(&self) -> dag_ml_core::Result<()> {
        Ok(())
    }

    fn preflight_methods_pls(&self, request: &MethodsPlsDataRequest) -> dag_ml_core::Result<()> {
        request.validate()?;
        self.validate_binding(&request.binding)
            .map_err(dag_ml_core::DagMlError::RuntimeValidation)
    }

    fn methods_pls_data(
        &self,
        request: &MethodsPlsDataRequest,
    ) -> dag_ml_core::Result<MethodsPlsData> {
        self.preflight_methods_pls(request)?;
        let fit = self
            .project_dataset(request, &request.fit_view, request.phase != Phase::Predict)
            .map_err(dag_ml_core::DagMlError::RuntimeValidation)?;
        let prediction = request
            .prediction_view
            .as_ref()
            .map(|view| self.project_dataset(request, view, true))
            .transpose()
            .map_err(dag_ml_core::DagMlError::RuntimeValidation)?;
        let data = MethodsPlsData { fit, prediction };
        data.validate_for(request)?;
        Ok(data)
    }
}

fn convert_relations(
    relations: &dag_ml_data_crate::CoordinatorRelationSet,
) -> Result<SampleRelationSet, String> {
    let records = relations
        .records
        .iter()
        .map(|record| {
            Ok(SampleRelation {
                unit_level: EntityUnitLevel::Observation,
                unit_id: None,
                observation_id: dag_ml_core::ObservationId::new(record.observation_id.as_str())
                    .map_err(|error| error.to_string())?,
                sample_id: dag_ml_core::SampleId::new(record.sample_id.as_str())
                    .map_err(|error| error.to_string())?,
                source_id: record.source_id.as_ref().map(ToString::to_string),
                rep_id: None,
                target_id: record
                    .target_id
                    .as_ref()
                    .map(|id| dag_ml_core::TargetId::new(id.as_str()))
                    .transpose()
                    .map_err(|error| error.to_string())?,
                group_id: record
                    .group_id
                    .as_ref()
                    .map(|id| dag_ml_core::GroupId::new(id.as_str()))
                    .transpose()
                    .map_err(|error| error.to_string())?,
                origin_sample_id: record
                    .origin_sample_id
                    .as_ref()
                    .map(|id| dag_ml_core::SampleId::new(id.as_str()))
                    .transpose()
                    .map_err(|error| error.to_string())?,
                derived_unit_id: None,
                component_observation_ids: Vec::new(),
                sample_influence_weight: None,
                quality_flag: None,
                is_augmented: record.is_augmented,
                excluded: record.excluded,
                metadata: record.metadata.clone(),
                tags: record.tags.clone(),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let converted = SampleRelationSet { records };
    converted.validate().map_err(|error| error.to_string())?;
    Ok(converted)
}

fn validate_target_samples(expected: &[IoSampleId], actual: &[IoSampleId]) -> Result<(), String> {
    if expected != actual {
        return Err(
            "Core IO provider target rows differ from feature sample identities".to_string(),
        );
    }
    Ok(())
}

fn finite_number(value: &serde_json::Value, label: &str) -> Result<f64, String> {
    let number = value
        .as_f64()
        .ok_or_else(|| format!("Core IO provider {label} is not numeric"))?;
    if !number.is_finite() {
        return Err(format!("Core IO provider {label} is non-finite"));
    }
    Ok(number)
}

/// Closed input for native Methods training from an IO `DatasetPackage`.
pub struct DatasetPackageMethodsArchiveV2Request<'a> {
    pub dataset: &'a DatasetPackage,
    pub source_id: &'a str,
    pub training_request: &'a TrainingRequest,
    pub outcome_id: &'a str,
    pub run_id: RunId,
    pub bundle_id: BundleId,
    pub package_id: &'a str,
    pub archive_id: &'a str,
    pub archive_path: &'a Path,
    pub methods_library_path: &'a Path,
}

/// Native training evidence and the persisted Archive V2 identity.
pub struct DatasetPackageMethodsArchiveV2Outcome {
    pub training: TrainingOutcome,
    pub archive: ArchiveV2Reference,
}

/// Execute the selected IO package source through DAG-ML's typed training
/// operation and Methods controller, then persist the portable Package V2 as a
/// Core Archive V2. No Python, `SpectroDataset`, fallback or JSON round-trip is
/// involved.
pub fn train_dataset_package_methods_archive_v2(
    input: DatasetPackageMethodsArchiveV2Request<'_>,
) -> Result<DatasetPackageMethodsArchiveV2Outcome, String> {
    let provider = DatasetPackageMethodsProvider::new(input.dataset, input.source_id)?;
    let projection = input
        .training_request
        .project()
        .map_err(|error| error.to_string())?;
    let influence = TrainingInfluenceManifest::derive_for_projection(
        &projection,
        input.training_request,
        provider.relations(),
    )
    .map_err(|error| error.to_string())?;
    let runtime =
        MethodsRuntime::configure(input.methods_library_path).map_err(|error| error.to_string())?;
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(MethodsPlsController::new(runtime)))
        .map_err(|error| error.to_string())?;
    let mut artifacts = InMemoryArtifactStore::new();
    let training = execute_training(TrainingExecutionInput {
        request: input.training_request,
        outcome_id: input.outcome_id.to_string(),
        run_id: input.run_id,
        bundle_id: input.bundle_id,
        controllers: &controllers,
        data_provider: &provider,
        relations: provider.relations(),
        training_influence: &influence,
        artifact_store: &mut artifacts,
        warnings: Vec::new(),
        diagnostics: BTreeMap::new(),
    })
    .map_err(|error| error.to_string())?;
    let package = training
        .to_portable_predictor_package(
            input.package_id,
            FittedArtifactMode::PortableRequired,
            ArtifactLoadMode::NativePortable,
        )
        .map_err(|error| error.to_string())?;
    let payloads = build_archive_v2_native_portable_payloads(input.archive_id, &training, &package)
        .map_err(|error| error.to_string())?;
    let archive = write_archive_v2(
        input.archive_path,
        ArchiveV2WriteRequest {
            manifest: payloads.manifest,
            payloads: payloads
                .members
                .into_iter()
                .map(|(path, bytes)| ArchivePayload { path, bytes })
                .collect(),
        },
    )
    .map_err(|error| error.to_string())?;
    provider.release_all();
    Ok(DatasetPackageMethodsArchiveV2Outcome { training, archive })
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::path::{Path, PathBuf};

    use dag_ml_core::{
        DataBinding, GraphSpec, RunId, TrainingDataIdentity, TrainingRequest,
        TRAINING_REQUEST_SCHEMA_VERSION,
    };
    use nirs4all_io_crate::core::materialize::{
        AssembledDataset, Cell, Column, FoldProvenance, Frame, IdentityProvenance, Matrix,
        PartitionBlock,
    };
    use sha2::{Digest, Sha256};

    use super::*;
    use crate::{
        load_archive_v2, predict_methods_archive_v2_matrix, MethodsArchiveMatrixPredictRequest,
    };

    fn matrix(rows: usize, columns: usize, values: &[f32]) -> Matrix {
        Matrix {
            data: values.to_vec(),
            n_rows: rows,
            n_cols: columns,
        }
    }

    fn numeric_multi_source_package() -> DatasetPackage {
        let block = PartitionBlock {
            n_samples: 8,
            source_ids: vec!["spectra".into(), "markers".into()],
            x: vec![
                matrix(
                    8,
                    3,
                    &[
                        1.0, 2.0, 3.0, 2.0, 4.0, 6.0, 3.0, 6.0, 9.0, 4.0, 8.0, 12.0, 5.0, 10.0,
                        15.0, 6.0, 12.0, 18.0, 7.0, 14.0, 21.0, 8.0, 16.0, 24.0,
                    ],
                ),
                matrix(
                    8,
                    2,
                    &[
                        0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0,
                        0.0,
                    ],
                ),
            ],
            feature_headers: vec![
                vec!["1000".into(), "1010".into(), "1020".into()],
                vec!["marker_a".into(), "marker_b".into()],
            ],
            header_units: vec!["nm".into(), "category".into()],
            signal_types: vec![Some("absorbance".into()), None],
            processings: vec![vec![], vec![]],
            y: Some(matrix(8, 1, &[3.0, 5.0, 7.0, 9.0, 11.0, 13.0, 15.0, 17.0])),
            y_headers: vec!["protein".into()],
            y_categorical: Default::default(),
            metadata: Some(Frame::from_columns(
                vec![
                    Column::from_cells(
                        "sample_id",
                        (1..=8)
                            .map(|index| Cell::Str(format!("sample.{index}")))
                            .collect(),
                    ),
                    Column::from_cells(
                        "observation_id",
                        (1..=8)
                            .map(|index| Cell::Str(format!("observation.{index}")))
                            .collect(),
                    ),
                    Column::from_cells(
                        "group_id",
                        (1..=8)
                            .map(|index| {
                                Cell::Str(if index <= 4 { "batch.a" } else { "batch.b" }.into())
                            })
                            .collect(),
                    ),
                ],
                "text",
            )),
            weights: None,
            weights_header: None,
        };
        let mut assembled = AssembledDataset {
            name: "data002-multi-source".into(),
            task_type: "regression".into(),
            signal_type: "absorbance".into(),
            n_sources: 2,
            blocks: Default::default(),
            folds: vec![
                (vec![4, 5, 6, 7], vec![0, 1, 2, 3]),
                (vec![0, 1, 2, 3], vec![4, 5, 6, 7]),
            ],
            fold_provenance: vec![
                FoldProvenance {
                    train_observation_ids: (5..=8)
                        .map(|index| format!("observation.{index}"))
                        .collect(),
                    validation_observation_ids: (1..=4)
                        .map(|index| format!("observation.{index}"))
                        .collect(),
                },
                FoldProvenance {
                    train_observation_ids: (1..=4)
                        .map(|index| format!("observation.{index}"))
                        .collect(),
                    validation_observation_ids: (5..=8)
                        .map(|index| format!("observation.{index}"))
                        .collect(),
                },
            ],
            repetition: None,
            identity: IdentityProvenance {
                source_ids: vec!["spectra".into(), "markers".into()],
                sample_id: Some("sample_id".into()),
                observation_id: Some("observation_id".into()),
                repetition_id: None,
                group_id: Some("group_id".into()),
            },
            aggregate: None,
            warnings: vec![],
            audits: vec![],
        };
        assembled.blocks.insert("train".to_string(), block);
        DatasetPackage::from_assembled(&assembled)
    }

    fn training_request(provider: &DatasetPackageMethodsProvider) -> TrainingRequest {
        let envelope = provider.external_envelope();
        let relation_fingerprint = envelope.relation_fingerprint.clone().unwrap();
        let binding: DataBinding = serde_json::from_value(serde_json::json!({
            "node_id": "model:pls",
            "input_name": "x",
            "request_id": "io:data002:spectra",
            "schema_fingerprint": envelope.schema_fingerprint,
            "plan_fingerprint": envelope.plan_fingerprint,
            "relation_fingerprint": relation_fingerprint,
            "output_representation": "tabular_numeric",
            "feature_set_id": "spectra",
            "source_ids": ["spectra"],
            "require_relations": true,
            "view_policy": {
                "fit_partition": "fold_train",
                "predict_partition": "fold_validation",
                "include_augmented_train": false,
                "include_augmented_validation": false,
                "include_excluded": false,
                "require_sample_ids": true
            },
            "metadata": {}
        }))
        .unwrap();
        let identity = TrainingDataIdentity::from_binding_envelope(&binding, envelope).unwrap();
        let graph: GraphSpec = serde_json::from_value(serde_json::json!({
            "id": "data002-methods-pls",
            "interface": {
                "inputs": [{"name": "x", "kind": "data", "representation": "tabular_numeric", "cardinality": "one", "description": "selected IO numeric source"}],
                "outputs": [{"name": "prediction", "kind": "prediction", "representation": null, "cardinality": "one", "description": "PLS prediction"}]
            },
            "nodes": [{
                "id": "model:pls",
                "kind": "model",
                "operator": "pls",
                "params": {"n_components": 1},
                "ports": {
                    "inputs": [{"name": "x", "kind": "data", "representation": "tabular_numeric", "cardinality": "one", "description": ""}],
                    "outputs": [{"name": "oof", "kind": "prediction", "representation": null, "cardinality": "one", "description": ""}]
                },
                "metadata": {},
                "seed_label": null
            }],
            "edges": [],
            "search_space_fingerprint": null,
            "metadata": {}
        }))
        .unwrap();
        let campaign = serde_json::from_value(serde_json::json!({
            "id": "campaign:data002",
            "root_seed": 91,
            "leakage_policy": {
                "split_unit": "group",
                "forbid_origin_cross_fold": true,
                "allow_observation_split_with_shared_target": false,
                "require_group_ids": true,
                "unsafe_flags": []
            },
            "aggregation_policy": {
                "aggregation_level": "sample",
                "method": "mean",
                "weights": "none",
                "emit_parallel_metrics": true,
                "selection_metric_level": "sample",
                "store_raw_predictions": true,
                "store_aggregated_predictions": true
            },
            "split_invocation": {
                "id": "io:folds",
                "controller_id": null,
                "leakage_policy": {
                    "split_unit": "group",
                    "forbid_origin_cross_fold": true,
                    "allow_observation_split_with_shared_target": false,
                    "require_group_ids": true,
                    "unsafe_flags": []
                },
                "params": {"kind": "precomputed"},
                "fold_set": {
                    "id": "io:folds",
                    "sample_ids": ["sample.1", "sample.2", "sample.3", "sample.4", "sample.5", "sample.6", "sample.7", "sample.8"],
                    "folds": [
                        {"fold_id": "io.fold.0", "train_sample_ids": ["sample.5", "sample.6", "sample.7", "sample.8"], "validation_sample_ids": ["sample.1", "sample.2", "sample.3", "sample.4"], "metadata": {}},
                        {"fold_id": "io.fold.1", "train_sample_ids": ["sample.1", "sample.2", "sample.3", "sample.4"], "validation_sample_ids": ["sample.5", "sample.6", "sample.7", "sample.8"], "metadata": {}}
                    ],
                    "sample_groups": {
                        "sample.1": "batch.a", "sample.2": "batch.a", "sample.3": "batch.a", "sample.4": "batch.a",
                        "sample.5": "batch.b", "sample.6": "batch.b", "sample.7": "batch.b", "sample.8": "batch.b"
                    }
                }
            },
            "generation": {"strategy": "none", "dimensions": [], "max_variants": 1},
            "shape_plans": {
                "model:pls": {
                    "node_id": "model:pls",
                    "input_granularity": "sample",
                    "target_granularity": "sample",
                    "fit_rows": "fold_train",
                    "predict_rows": "fold_validation",
                    "feature_namespace": "spectra",
                    "feature_schema_fingerprint": null,
                    "target_space": "raw",
                    "aggregation_policy": {
                        "aggregation_level": "sample", "method": "mean", "weights": "none",
                        "emit_parallel_metrics": true, "selection_metric_level": "sample",
                        "store_raw_predictions": true, "store_aggregated_predictions": true
                    },
                    "augmentation_policy": {
                        "sample_scope": "train_only", "feature_scope": "train_only",
                        "require_origin_id": true, "inherit_group": true, "inherit_target": true
                    },
                    "selection_policy": {"scope": "none", "store_masks": true, "allow_schema_mismatch_on_join": false}
                }
            },
            "data_bindings": {"model:pls": [binding]},
            "metadata": {}
        }))
        .unwrap();
        let manifests = serde_json::from_value(serde_json::json!([{
            "controller_id": "controller:methods.pls",
            "controller_version": "libn4m-2.5",
            "operator_kind": "model",
            "priority": 0,
            "supported_phases": ["FIT_CV", "REFIT", "PREDICT"],
            "input_ports": [{"name": "x", "kind": "data", "representation": "tabular_numeric", "cardinality": "one", "description": ""}],
            "output_ports": [{"name": "oof", "kind": "prediction", "representation": null, "cardinality": "one", "description": ""}],
            "data_requirements": null,
            "capabilities": ["deterministic", "thread_safe", "process_safe", "emits_predictions", "emits_artifacts", "stateful", "supports_portable_full_refit"],
            "fit_scope": "fold_train",
            "rng_policy": "uses_core_seed",
            "artifact_policy": "serializable"
        }]))
        .unwrap();
        let options = serde_json::from_value(serde_json::json!({
            "refit": true,
            "refit_strategy": "refit_one",
            "seed": 91,
            "selection": {
                "id": "selection:rmse",
                "metric": {"name": "rmse", "objective": "minimize"},
                "required_metric_level": "sample",
                "require_finite": true,
                "evaluation_scope": "oof"
            },
            "selection_output_id": "output:prediction",
            "outputs": [{
                "output_id": "output:prediction", "node_id": "model:pls", "port_name": "oof",
                "prediction_level": "sample", "unit_level": "physical_sample",
                "prediction_kind": "regression_point", "target_names": ["protein"],
                "target_units": [null], "class_labels": [[]], "output_order": "target_order", "target_space": "raw"
            }],
            "scheduler": {"kind": "sequential", "backend": null, "workers": 1},
            "resources": {"cpu_threads": 1, "memory_bytes": null, "gpu_devices": [], "wall_time_ms": null},
            "artifacts": {"cv_artifacts": "discard", "prediction_caches": "retain", "fitted_artifacts": "portable_required"}
        }))
        .unwrap();
        let mut request = TrainingRequest {
            schema_version: TRAINING_REQUEST_SCHEMA_VERSION,
            request_id: "training:data002".into(),
            plan_id: "plan:data002".into(),
            graph,
            campaign,
            controller_manifests: manifests,
            data_identities: vec![identity],
            parameter_patches: vec![],
            patch_policies: vec![],
            influence_requirements: vec![],
            training_losses: vec![],
            options,
            request_fingerprint: "0".repeat(64),
        };
        request.request_fingerprint = request.compute_fingerprint().unwrap();
        request
    }

    fn sha256(path: &Path) -> String {
        let bytes = std::fs::read(path).unwrap();
        format!("{:x}", Sha256::digest(bytes))
    }

    fn assert_fresh_prediction(archive_path: &Path, library: &Path) {
        let archive = load_archive_v2(archive_path).unwrap();
        let predicted = predict_methods_archive_v2_matrix(
            &archive,
            MethodsArchiveMatrixPredictRequest {
                sample_ids: vec!["fresh:1".into(), "fresh:2".into()],
                x: vec![vec![9.0, 18.0, 27.0], vec![10.0, 20.0, 30.0]],
                expected_target_names: vec!["protein".into()],
                methods_library_path: library.to_path_buf(),
                methods_library_sha256: sha256(library),
                request_id: "predict:data002".into(),
                outcome_id: "outcome:data002:fresh".into(),
                run_id: RunId::new("run:data002:fresh").unwrap(),
                warnings: vec![],
                diagnostics: BTreeMap::new(),
            },
        )
        .unwrap();
        let values = &predicted.outputs[0].predictions[0].values;
        assert!((values[0][0] - 19.0).abs() < 1.0e-8);
        assert!((values[1][0] - 21.0).abs() < 1.0e-8);
    }

    #[test]
    fn numeric_package_provider_trains_archives_and_fresh_predicts() {
        if let (Some(archive), Some(library)) = (
            std::env::var_os("N4A_DATA002_CHILD_ARCHIVE"),
            std::env::var_os("N4A_DATA002_CHILD_LIBRARY"),
        ) {
            assert_fresh_prediction(Path::new(&archive), Path::new(&library));
            return;
        }
        let library = PathBuf::from(
            std::env::var_os("N4M_LIBRARY_PATH").expect("N4M_LIBRARY_PATH must name libn4m"),
        );
        let package = numeric_multi_source_package();
        let provider = DatasetPackageMethodsProvider::new(&package, "spectra").unwrap();
        assert_eq!(provider.source_id(), "spectra");
        assert_eq!(provider.external_envelope().plan_fingerprint.len(), 64);
        assert_eq!(provider.relations().records.len(), 8);
        assert!(provider.relations().records.iter().all(|relation| {
            relation.source_id.as_deref() == Some("spectra")
                && relation.group_id.is_some()
                && relation.target_id.is_some()
        }));
        let request = training_request(&provider);
        drop(provider);

        let directory = tempfile::tempdir().unwrap();
        let archive_path = directory.path().join("data002.n4a");
        let trained =
            train_dataset_package_methods_archive_v2(DatasetPackageMethodsArchiveV2Request {
                dataset: &package,
                source_id: "spectra",
                training_request: &request,
                outcome_id: "outcome:data002",
                run_id: RunId::new("run:data002:train").unwrap(),
                bundle_id: BundleId::new("bundle:data002").unwrap(),
                package_id: "predictor:data002",
                archive_id: "archive:data002",
                archive_path: &archive_path,
                methods_library_path: &library,
            })
            .unwrap();
        assert_eq!(trained.training.execution_bundle.data_requirements.len(), 1);
        assert_eq!(trained.training.execution_bundle.refit_artifacts.len(), 1);

        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .arg("io_training::tests::numeric_package_provider_trains_archives_and_fresh_predicts")
            .arg("--exact")
            .env("N4A_DATA002_CHILD_ARCHIVE", &archive_path)
            .env("N4A_DATA002_CHILD_LIBRARY", &library)
            .status()
            .unwrap();
        assert!(status.success(), "fresh-process Archive V2 replay failed");

        let mut unsupported = package.to_assembled();
        unsupported.blocks.get_mut("train").unwrap().processings[0]
            .push(("snv".into(), matrix(8, 3, &[0.0; 24])));
        let unsupported = DatasetPackage::from_assembled(&unsupported);
        assert!(DatasetPackageMethodsProvider::new(&unsupported, "spectra")
            .err()
            .unwrap()
            .contains("processing"));
    }
}

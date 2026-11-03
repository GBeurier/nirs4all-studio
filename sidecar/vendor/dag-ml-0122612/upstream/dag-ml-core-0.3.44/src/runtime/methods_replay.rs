//! Typed, callback-free Methods PREDICT replay.
//!
//! This is the Rust ownership boundary used by product hosts such as Core and
//! the Studio sidecar.  Hosts supply an already attested current cohort; this
//! module owns controller registration, raw N4MM hydration and scheduler
//! execution.  It deliberately has no Python, callback or host-artifact path.

#[cfg(feature = "methods-optimizer")]
use std::collections::{BTreeMap, BTreeSet};

#[cfg(feature = "methods-optimizer")]
use crate::data::{data_binding_requirement_key, ExternalDataPlanEnvelope, InMemoryDataProvider};
#[cfg(feature = "methods-optimizer")]
use crate::hpo::{
    methods_native_controller_ids, register_methods_native_controllers, MethodsRuntime,
};
#[cfg(feature = "methods-optimizer")]
use crate::replay::{
    execute_loaded_portable_refit_replay_v3, execute_loaded_predictor_replay,
    LoadedPortableRefitReplayInputV3, LoadedPredictorReplayInput, PortableRefitReplayOutcomeV3,
    TrainingReplayOutcome, TrainingReplayRequest,
};
#[cfg(feature = "methods-optimizer")]
use crate::runtime::{
    DataMaterializationRequest, DataViewRequest, MethodsPlsData, MethodsPlsDataRequest,
    MethodsPlsDataset, MethodsPlsMatrix, RuntimeControllerRegistry, RuntimeDataProvider,
};
#[cfg(feature = "methods-optimizer")]
use crate::training::{LoadedPredictor, PortablePredictorPackage};
#[cfg(feature = "methods-optimizer")]
use crate::training_runtime::PortableRefitPackageV3;
#[cfg(feature = "methods-optimizer")]
use crate::{ControllerId, DagMlError, HandleRef, Phase, Result, RunId, SampleId};

/// Complete, callback-free input for one durable Package V2 Methods replay.
///
/// The caller must construct the replay request and external envelopes through
/// DAG-ML's signed contracts.  This type accepts no positional sample IDs or
/// host model handles; `methods_inputs` are keyed by the exact data-binding
/// requirement key and reindexed only by scheduler-selected views.
#[cfg(feature = "methods-optimizer")]
pub struct MethodsPortablePredictorReplayInput<'a> {
    pub package: &'a PortablePredictorPackage,
    pub request: &'a TrainingReplayRequest,
    pub data_envelopes: &'a BTreeMap<String, ExternalDataPlanEnvelope>,
    pub methods_inputs: &'a BTreeMap<String, MethodsPlsDataset>,
    pub runtime: MethodsRuntime,
    pub outcome_id: String,
    pub run_id: RunId,
    pub warnings: Vec<String>,
    pub diagnostics: BTreeMap<String, serde_json::Value>,
}

/// Complete, callback-free input for one durable Package V3 Methods refit replay.
///
/// V3 is a target-bound full-refit package, distinct from the V2 CV/SELECT
/// predictor package above.  The caller supplies only attested envelopes and
/// identity-keyed numeric data. This entry point registers Methods itself;
/// `supplemental_controllers` is an invocation-local registry for any other
/// executable controller already represented by the portable V3 plan.  It
/// deliberately accepts no Python callback, host handle, or positional cohort
/// mapping.
#[cfg(feature = "methods-optimizer")]
pub struct MethodsPortableRefitReplayInputV3<'a> {
    pub package: &'a PortableRefitPackageV3,
    pub request: &'a TrainingReplayRequest,
    pub data_envelopes: &'a BTreeMap<String, ExternalDataPlanEnvelope>,
    pub methods_inputs: &'a BTreeMap<String, MethodsPlsDataset>,
    pub runtime: MethodsRuntime,
    pub supplemental_controllers: RuntimeControllerRegistry,
    pub outcome_id: String,
    pub run_id: RunId,
    pub warnings: Vec<String>,
    pub diagnostics: BTreeMap<String, serde_json::Value>,
}

/// Execute one Methods-only PREDICT replay without a host callback.
///
/// The native controller and every hydrated N4MM handle are invocation-local;
/// callers receive only the self-validating replay outcome.
#[cfg(feature = "methods-optimizer")]
pub fn execute_loaded_methods_predictor_replay(
    input: MethodsPortablePredictorReplayInput<'_>,
) -> Result<TrainingReplayOutcome> {
    input.package.validate()?;
    input.request.validate()?;
    if input.request.phase != Phase::Predict {
        return Err(DagMlError::RuntimeValidation(
            "callback-free Methods package replay supports PREDICT only".to_string(),
        ));
    }
    let native_controllers = methods_native_controller_ids();
    if input
        .package
        .effective_plan
        .node_plans
        .values()
        .any(|node| !native_controllers.contains(&node.controller_id))
    {
        return Err(DagMlError::RuntimeValidation(
            "callback-free Methods package replay requires every executable node to use a registered native Methods controller"
                .to_string(),
        ));
    }
    let provider = MethodsPortableReplayProvider::new(
        input.data_envelopes.clone(),
        input.methods_inputs.clone(),
    )?;
    let mut controllers = RuntimeControllerRegistry::new();
    register_methods_native_controllers(&mut controllers, input.runtime)?;
    let predictor = LoadedPredictor::new(input.package.clone(), BTreeMap::new())?;
    execute_loaded_predictor_replay(LoadedPredictorReplayInput {
        predictor: &predictor,
        request: input.request,
        outcome_id: input.outcome_id,
        run_id: input.run_id,
        controllers: &controllers,
        data_provider: &provider,
        data_envelopes: input.data_envelopes,
        warnings: input.warnings,
        diagnostics: input.diagnostics,
    })
}

/// Execute one Methods-only Package V3 full-refit PREDICT replay.
///
/// The V3 package contains only native raw artifacts.  Each call therefore
/// creates an invocation-local Methods controller and hands raw-N4MM hydration
/// to the generic scheduler-owned replay path.  No process-local capability
/// survives the call.
#[cfg(feature = "methods-optimizer")]
pub fn execute_loaded_methods_portable_refit_replay_v3(
    input: MethodsPortableRefitReplayInputV3<'_>,
) -> Result<PortableRefitReplayOutcomeV3> {
    input.package.validate()?;
    input.request.validate()?;
    if input.request.phase != Phase::Predict {
        return Err(DagMlError::RuntimeValidation(
            "callback-free Methods Package V3 replay supports PREDICT only".to_string(),
        ));
    }
    let provider = MethodsPortableReplayProvider::new(
        input.data_envelopes.clone(),
        input.methods_inputs.clone(),
    )?;
    let mut controllers = input.supplemental_controllers;
    register_methods_native_controllers(&mut controllers, input.runtime)?;
    for node in input.package.outcome.effective_plan.node_plans.values() {
        if controllers.get(&node.controller_id).is_none() {
            return Err(DagMlError::RuntimeValidation(format!(
                "callback-free Methods Package V3 replay has no invocation-local controller for node `{}` (`{}`)",
                node.node_id, node.controller_id
            )));
        }
    }
    execute_loaded_portable_refit_replay_v3(LoadedPortableRefitReplayInputV3 {
        package: input.package,
        request: input.request,
        outcome_id: input.outcome_id,
        run_id: input.run_id,
        controllers: &controllers,
        data_provider: &provider,
        data_envelopes: input.data_envelopes,
        warnings: input.warnings,
        diagnostics: input.diagnostics,
    })
}

#[cfg(feature = "methods-optimizer")]
struct MethodsPortableReplayProvider {
    inner: InMemoryDataProvider,
    inputs: BTreeMap<String, MethodsPlsDataset>,
    cohort_sample_ids: BTreeMap<String, Vec<SampleId>>,
}

#[cfg(feature = "methods-optimizer")]
impl MethodsPortableReplayProvider {
    fn new(
        envelopes: BTreeMap<String, ExternalDataPlanEnvelope>,
        inputs: BTreeMap<String, MethodsPlsDataset>,
    ) -> Result<Self> {
        let mut inner = InMemoryDataProvider::new(ControllerId::new(
            "controller:dagml.methods.portable-replay-provider",
        )?);
        let mut cohort_sample_ids = BTreeMap::new();
        for (key, envelope) in envelopes {
            let ids = if let Some(cohort) = &envelope.predict_cohort {
                Some(cohort.physical_sample_ids.clone())
            } else {
                envelope.coordinator_relations.as_ref().map(|relations| {
                    // Legacy V1 has no separate PREDICT cohort. Preserve its
                    // relation delivery order, deduplicating physical samples.
                    let mut seen = BTreeSet::new();
                    relations
                        .records
                        .iter()
                        .filter(|record| seen.insert(record.sample_id.clone()))
                        .map(|record| record.sample_id.clone())
                        .collect()
                })
            };
            inner.register_envelope(envelope)?;
            if let Some(ids) = ids {
                cohort_sample_ids.insert(key, ids);
            }
        }
        for (key, dataset) in &inputs {
            dataset.validate(&format!("native Methods replay input `{key}`"), false)?;
        }
        Ok(Self {
            inner,
            inputs,
            cohort_sample_ids,
        })
    }

    fn dataset_for_view(
        dataset: &MethodsPlsDataset,
        sample_ids: &[SampleId],
    ) -> Result<MethodsPlsDataset> {
        let index_by_id = dataset
            .sample_ids
            .iter()
            .enumerate()
            .map(|(index, sample_id)| (sample_id, index))
            .collect::<BTreeMap<_, _>>();
        let indices = sample_ids
            .iter()
            .map(|sample_id| index_by_id.get(sample_id).copied().ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "native Methods replay view requests sample `{sample_id}` absent from its attested input"
                ))
            }))
            .collect::<Result<Vec<_>>>()?;
        let select = |matrix: &MethodsPlsMatrix| MethodsPlsMatrix {
            values: indices
                .iter()
                .flat_map(|index| {
                    let start = index * matrix.cols;
                    matrix.values[start..start + matrix.cols].iter().copied()
                })
                .collect(),
            rows: indices.len(),
            cols: matrix.cols,
        };
        Ok(MethodsPlsDataset {
            y_validity_masks: None,
            sample_ids: sample_ids.to_vec(),
            x: select(&dataset.x),
            y: None,
            target_names: dataset.target_names.clone(),
        })
    }

    fn data_for(&self, request: &MethodsPlsDataRequest) -> Result<MethodsPlsData> {
        request.validate()?;
        if request.phase != Phase::Predict {
            return Err(DagMlError::RuntimeValidation(
                "native Methods portable replay provider supports PREDICT only".to_string(),
            ));
        }
        let key =
            data_binding_requirement_key(&request.binding.node_id, &request.binding.input_name);
        let dataset = self.inputs.get(&key).ok_or_else(|| {
            DagMlError::RuntimeValidation(format!("native Methods replay has no input for `{key}`"))
        })?;
        let ids = match request.fit_view.sample_ids.as_deref() {
            Some(ids) => ids,
            None => self.cohort_sample_ids.get(&key).map(Vec::as_slice).ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "native Methods replay input `{key}` requires attested PREDICT cohort identities"
                ))
            })?,
        };
        Ok(MethodsPlsData {
            fit: Self::dataset_for_view(dataset, ids)?,
            prediction: None,
        })
    }
}

#[cfg(feature = "methods-optimizer")]
impl RuntimeDataProvider for MethodsPortableReplayProvider {
    fn materialize(&self, request: &DataMaterializationRequest) -> Result<HandleRef> {
        self.inner.materialize(request)
    }

    fn make_view(&self, request: &DataViewRequest) -> Result<HandleRef> {
        self.inner.make_view(request)
    }

    fn predict_cohort(
        &self,
        binding: &crate::data::DataBinding,
        phase: Phase,
    ) -> Result<Option<crate::data::PredictCohort>> {
        self.inner.predict_cohort(binding, phase)
    }

    fn methods_pls_capability(&self) -> Result<()> {
        Ok(())
    }

    fn preflight_methods_pls(&self, request: &MethodsPlsDataRequest) -> Result<()> {
        self.data_for(request).map(|_| ())
    }

    fn methods_pls_data(&self, request: &MethodsPlsDataRequest) -> Result<MethodsPlsData> {
        self.data_for(request)
    }
}

#[cfg(all(test, feature = "methods-optimizer"))]
mod cohort_identity_tests {
    use super::*;
    use crate::data::{DataBinding, DataViewPolicy};
    use crate::runtime::{DataProviderViewSpec, DataRequestPartition};
    use crate::{NodeId, ObservationId, SampleRelation, SampleRelationSet};

    fn fixture() -> (MethodsPortableReplayProvider, MethodsPlsDataRequest) {
        let node = NodeId::new("model:base").unwrap();
        let relations = SampleRelationSet {
            records: vec![
                SampleRelation::new(
                    ObservationId::new("observation:two").unwrap(),
                    SampleId::new("sample:two").unwrap(),
                ),
                SampleRelation::new(
                    ObservationId::new("observation:one").unwrap(),
                    SampleId::new("sample:one").unwrap(),
                ),
            ],
        };
        let envelope = ExternalDataPlanEnvelope {
            schema_version: 1,
            schema_fingerprint: "a".repeat(64),
            plan_fingerprint: "b".repeat(64),
            relation_fingerprint: Some(relations.fingerprint().unwrap()),
            data_content_fingerprint: None,
            target_content_fingerprint: None,
            coordinator_relations: Some(relations),
            predict_cohort: None,
        };
        let binding = DataBinding {
            node_id: node.clone(),
            input_name: "x".into(),
            request_id: "input:predict".into(),
            schema_fingerprint: envelope.schema_fingerprint.clone(),
            plan_fingerprint: envelope.plan_fingerprint.clone(),
            relation_fingerprint: envelope.relation_fingerprint.clone(),
            output_representation: "tabular_numeric".into(),
            feature_set_id: None,
            source_ids: vec![],
            require_relations: true,
            view_policy: DataViewPolicy::default(),
            metadata: BTreeMap::new(),
        };
        let key = data_binding_requirement_key(&node, "x");
        let dataset = MethodsPlsDataset {
            y_validity_masks: None,
            sample_ids: ["sample:unused", "sample:one", "sample:two"]
                .map(|id| SampleId::new(id).unwrap())
                .to_vec(),
            x: MethodsPlsMatrix {
                rows: 3,
                cols: 1,
                values: vec![99.0, 3.0, 8.0],
            },
            y: None,
            target_names: vec!["protein".into()],
        };
        let provider = MethodsPortableReplayProvider::new(
            BTreeMap::from([(key.clone(), envelope)]),
            BTreeMap::from([(key, dataset)]),
        )
        .unwrap();
        let request = MethodsPlsDataRequest {
            node_id: node,
            phase: Phase::Predict,
            variant_id: None,
            fold_id: None,
            binding,
            identity: None,
            fit_view: DataProviderViewSpec {
                sample_ids: None,
                partition: DataRequestPartition::Predict,
                fold_id: None,
                source_ids: None,
                columns: None,
                include_augmented: false,
                include_excluded: false,
                branch_view: None,
                extra: BTreeMap::new(),
            },
            prediction_view: None,
        };
        (provider, request)
    }

    #[test]
    fn predict_fallback_refuses_foreign_replacement_of_required_cohort_id() {
        let (mut provider, request) = fixture();
        provider.inputs.get_mut("model:base.x").unwrap().sample_ids[2] =
            SampleId::new("predict.foreign").unwrap();
        let error = provider
            .preflight_methods_pls(&request)
            .unwrap_err()
            .to_string();
        assert!(error.contains("sample:two") && error.contains("absent from its attested input"));
    }

    #[test]
    fn predict_fallback_reindexes_permuted_rows_and_keeps_explicit_subset_views() {
        let (mut provider, mut request) = fixture();
        let expected = provider.methods_pls_data(&request).unwrap().fit;
        assert_eq!(
            expected.sample_ids,
            ["sample:two", "sample:one"].map(|id| SampleId::new(id).unwrap())
        );
        assert_eq!(expected.x.values, vec![8.0, 3.0]);
        let dataset = provider.inputs.get_mut("model:base.x").unwrap();
        dataset.sample_ids.reverse();
        dataset.x.values.reverse();
        assert_eq!(provider.methods_pls_data(&request).unwrap().fit, expected);
        request.fit_view.sample_ids = Some(vec![SampleId::new("sample:one").unwrap()]);
        let subset = provider.methods_pls_data(&request).unwrap().fit;
        assert_eq!(subset.x.values, vec![3.0]);
        assert_eq!(subset.sample_ids, request.fit_view.sample_ids.unwrap());
    }
}

use dag_ml_core::training::PredictionSource;
use dag_ml_core::*;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
#[cfg(feature = "methods-optimizer-local")]
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

struct FoldDomainController(TrainingController);

impl RuntimeController for FoldDomainController {
    fn controller_id(&self) -> &ControllerId {
        self.0.controller_id()
    }
    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        let mut result = self.0.invoke(task)?;
        let label = if task
            .fold_id
            .as_ref()
            .is_some_and(|fold| fold.as_str() == "fold:1")
        {
            1.0
        } else {
            0.0
        };
        for block in &mut result.predictions {
            for row in &mut block.values {
                row[0] = if row[0] == 0.0 { label } else { 1.0 - label };
            }
        }
        for block in &mut result.regression_targets {
            for row in &mut block.values {
                row[0] = label;
            }
        }
        let mut fit_sample_ids = task
            .data_views
            .values()
            .filter(|view| {
                matches!(
                    view.partition,
                    DataRequestPartition::FoldTrain | DataRequestPartition::FullTrain
                )
            })
            .filter_map(|view| view.sample_ids.as_ref())
            .flatten()
            .cloned()
            .collect::<Vec<_>>();
        fit_sample_ids.sort();
        fit_sample_ids.dedup();
        let state_json =
            serde_json::json!({"fixture_domain":task.fold_id,"class_zero_threshold":label})
                .to_string();
        result.lineage.target_domain = Some(target_domain::TargetDomain {
            schema_version: 1,
            recipe_fingerprint: "a".repeat(64),
            state_fingerprint: content_hash(&state_json),
            state_json,
            fit_sample_ids,
            class_labels: vec![0.0, 1.0],
        });
        Ok(result)
    }
}

#[test]
fn fold_local_domains_native_training_select_and_portable_validation_are_exact() {
    let mut fixture = fixture(true, false);
    fixture.request.campaign.shape_plans.clear();
    fixture.request.graph.metadata.insert(target_domain::TARGET_DOMAIN_POLICY_KEY.into(),serde_json::json!({
        "schema_version":1,"mode":"fold_local_macro","node_id":"model:base","recipe_fingerprint":"a".repeat(64),"class_labels":[0.0,1.0]
    }));
    fixture.request.options.outputs[0].prediction_kind = PredictionKind::ClassLabel;
    fixture.request.options.outputs[0].class_labels = vec![vec!["0".into(), "1".into()]];
    fixture.request.options.selection.metric = SelectionMetric {
        name: "balanced_accuracy".into(),
        objective: MetricObjective::Maximize,
    };
    rebuild(&mut fixture);
    let state = Arc::new(CallState::default());
    *state.preferred.lock().unwrap() = Some(fixture.preferred.clone());
    let mut registry = RuntimeControllerRegistry::new();
    registry
        .register(Box::new(TrainingController {
            id: ControllerId::new("controller:transform.mock").unwrap(),
            state: state.clone(),
            emits_predictions: false,
            emits_artifact: false,
            prediction_name: "aux".into(),
        }))
        .unwrap();
    registry
        .register(Box::new(FoldDomainController(TrainingController {
            id: ControllerId::new("controller:model.mock").unwrap(),
            state,
            emits_predictions: true,
            emits_artifact: true,
            prediction_name: "protein".into(),
        })))
        .unwrap();
    let provider = provider(&fixture);
    let mut store = InMemoryArtifactStore::new();
    let outcome = execute_training(TrainingExecutionInput {
        request: &fixture.request,
        outcome_id: "outcome:fold-domains".into(),
        run_id: RunId::new("run:fold-domains").unwrap(),
        bundle_id: BundleId::new("bundle:fold-domains").unwrap(),
        controllers: &registry,
        data_provider: &provider,
        relations: &fixture.relations,
        training_influence: &fixture.influence,
        artifact_store: &mut store,
        warnings: Vec::new(),
        diagnostics: BTreeMap::new(),
    })
    .unwrap();
    assert_eq!(outcome.selected_variant_id, fixture.preferred);
    assert!(
        outcome.oof_averages.is_empty()
            && outcome.variant_oof_averages.is_empty()
            && outcome.ensemble_averages.is_empty()
    );
    let serialized = serde_json::to_string(&outcome).unwrap();
    TrainingOutcome::from_json(&serialized).unwrap();
    let mut changed = outcome.clone();
    let other_domain = changed
        .score_set
        .reports
        .iter_mut()
        .find(|report| {
            report.variant_id.as_ref() != Some(&outcome.selected_variant_id)
                && report.target_domain.is_some()
        })
        .unwrap()
        .target_domain
        .as_mut()
        .unwrap();
    other_domain.state_json = "{\"fixture_domain\":\"different mapping\"}".into();
    other_domain.state_fingerprint = content_hash(&other_domain.state_json);
    changed.execution_bundle.scores = Some(changed.score_set.clone());
    resign_outcome(&mut changed);
    assert!(changed
        .validate()
        .unwrap_err()
        .to_string()
        .contains("not comparable"));
    let mut changed = outcome.clone();
    let summary = changed
        .score_set
        .reports
        .iter_mut()
        .find(|report| {
            report
                .fold_id
                .as_ref()
                .is_some_and(|fold| fold.as_str() == "macro")
        })
        .unwrap();
    summary.metrics.insert("balanced_accuracy".into(), 0.123);
    changed.execution_bundle.scores = Some(changed.score_set.clone());
    resign_outcome(&mut changed);
    assert!(changed
        .validate()
        .unwrap_err()
        .to_string()
        .contains("macro score"));
    let mut changed = outcome;
    let domain = changed
        .score_set
        .reports
        .iter_mut()
        .find_map(|report| report.target_domain.as_mut())
        .unwrap();
    domain.fit_sample_ids = vec![sample("foreign:sample")];
    changed.execution_bundle.scores = Some(changed.score_set.clone());
    resign_outcome(&mut changed);
    assert!(changed
        .validate()
        .unwrap_err()
        .to_string()
        .contains("domain"));
}

#[cfg(feature = "methods-optimizer-local")]
#[path = "../src/stable_json.rs"]
mod canonical_archive_json;

#[cfg(dag_ml_workspace_contract_fixtures)]
const PACKAGE_FIXTURE: &str =
    include_str!("../../../examples/fixtures/training/portable_predictor_package.v1.json");

#[derive(Default)]
struct CallState {
    calls: Mutex<Vec<(Phase, NodeId)>>,
    scoped_calls: Mutex<Vec<(Phase, NodeId, Option<FoldId>)>>,
    observed_resources: Mutex<Vec<Option<TrainingResourceLimits>>>,
    fit_counts: Mutex<BTreeMap<VariantId, usize>>,
    next_handle: AtomicU64,
    preferred: Mutex<Option<VariantId>>,
    divergent_rerun: Mutex<bool>,
    invalid_refit_output: Mutex<bool>,
    artifact_only_refit: Mutex<bool>,
    score_auxiliary: Mutex<bool>,
    emit_extra_fit_cv_partitions: Mutex<bool>,
    emit_explicit_model_ports: Mutex<bool>,
    predict_sample_ids: Mutex<Option<Vec<SampleId>>>,
    scoped_validation_samples: Mutex<BTreeMap<FoldId, Vec<SampleId>>>,
    observed_model_patch_values: Mutex<Vec<Option<serde_json::Value>>>,
}

#[cfg(feature = "methods-optimizer-local")]
fn methods_runtime() -> MethodsRuntime {
    let library_path = std::env::var_os("N4M_LIBRARY_PATH")
        .expect("methods native tests require an explicit N4M_LIBRARY_PATH");
    MethodsRuntime::configure(library_path).expect("configure explicit Methods test runtime")
}

impl CallState {
    fn count(&self, phase: Phase, node: &str) -> usize {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .filter(|(actual_phase, actual_node)| {
                *actual_phase == phase && actual_node.as_str() == node
            })
            .count()
    }

    fn total(&self) -> usize {
        self.calls.lock().unwrap().len()
    }

    fn handle(&self) -> u64 {
        self.next_handle.fetch_add(1, Ordering::SeqCst) + 1
    }
}

#[cfg(feature = "methods-optimizer-local")]
struct SharedMethodsPlsController(Arc<MethodsPlsController>);

#[cfg(feature = "methods-optimizer-local")]
impl RuntimeController for SharedMethodsPlsController {
    fn controller_id(&self) -> &ControllerId {
        self.0.controller_id()
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        self.0.invoke(task)
    }

    fn export_artifact_payload(&self, artifact_id: &ArtifactId) -> Result<Option<Vec<u8>>> {
        self.0.export_artifact_payload(artifact_id)
    }

    fn hydrate_artifact_payload(
        &self,
        request: &ArtifactMaterializationRequest,
        payload: &[u8],
    ) -> Result<HandleRef> {
        self.0.hydrate_artifact_payload(request, payload)
    }

    fn release_hydrated_artifact_payload(&self, handle: &HandleRef) -> Result<()> {
        self.0.release_hydrated_artifact_payload(handle)
    }

    fn invoke_with_data_provider(
        &self,
        task: &NodeTask,
        provider: &dyn RuntimeDataProvider,
    ) -> Result<NodeResult> {
        self.0.invoke_with_data_provider(task, provider)
    }
}

struct AttestedProvider {
    identity: Option<TrainingDataIdentity>,
    relations: SampleRelationSet,
    contradictory_relations: Option<SampleRelationSet>,
    omit_relations: bool,
    next_handle: AtomicU64,
    methods_pls_enabled: bool,
    /// Provider-owned numerical source.  Deliberately keyed by the signed
    /// sample identity instead of deriving values from a sample-id spelling.
    methods_rows: BTreeMap<SampleId, [f64; 4]>,
    methods_pls_feature_count: usize,
    /// Variant-attested OOF target offsets for the native-HPO test operation.
    /// The scheduler still computes the report from real Methods PLS
    /// predictions; this provider only supplies the selected validation labels.
    methods_hpo_oof_target_offsets: BTreeMap<i64, f64>,
    /// A real provider-boundary refusal keyed by the scheduler-attested HPO
    /// variant identity. It qualifies failed-trial/resume paths without
    /// relying on obsolete model-rank errors or fabricating optimizer states.
    fail_methods_hpo_trial_id: Option<i64>,
}

impl RuntimeDataProvider for AttestedProvider {
    fn materialize(&self, _request: &DataMaterializationRequest) -> Result<HandleRef> {
        Ok(self.handle(HandleKind::Data))
    }

    fn make_view(&self, _request: &DataViewRequest) -> Result<HandleRef> {
        Ok(self.handle(HandleKind::DataView))
    }

    fn training_data_identity(
        &self,
        _binding: &DataBinding,
    ) -> Result<Option<TrainingDataIdentity>> {
        Ok(self.identity.clone())
    }

    fn coordinator_relations(&self, _binding: &DataBinding) -> Result<Option<SampleRelationSet>> {
        if self.omit_relations {
            return Ok(None);
        }
        Ok(Some(
            self.contradictory_relations
                .clone()
                .unwrap_or_else(|| self.relations.clone()),
        ))
    }

    fn methods_pls_capability(&self) -> Result<()> {
        if self.methods_pls_enabled {
            Ok(())
        } else {
            Err(DagMlError::RuntimeValidation(
                "test provider intentionally has no portable Methods PLS view".to_string(),
            ))
        }
    }

    fn methods_pls_data(&self, request: &MethodsPlsDataRequest) -> Result<MethodsPlsData> {
        self.methods_pls_capability()?;
        if self.fail_methods_hpo_trial_id.is_some_and(|trial_id| {
            request
                .variant_id
                .as_ref()
                .is_some_and(|variant| variant.as_str() == format!("hpo:trial:{trial_id}"))
        }) {
            return Err(DagMlError::RuntimeValidation(format!(
                "test provider refused attested Methods HPO variant `{}`",
                request.variant_id.as_ref().expect("checked above")
            )));
        }
        let hpo_target_offset = request.variant_id.as_ref().and_then(|variant| {
            variant
                .as_str()
                .strip_prefix("hpo:trial:")
                .and_then(|trial_id| trial_id.parse::<i64>().ok())
                .and_then(|trial_id| self.methods_hpo_oof_target_offsets.get(&trial_id))
                .copied()
        });
        let rows = |view: &DataProviderViewSpec,
                    include_targets: bool,
                    prediction_targets: bool|
         -> Result<MethodsPlsDataset> {
            // Replay PREDICT deliberately delegates the new cohort to the
            // provider, so it has no training-fold sample-id list.  This
            // fixture treats an absent Predict view selection as its current
            // attested cohort in stable identity order.
            let sample_ids = view
                .sample_ids
                .clone()
                .unwrap_or_else(|| self.methods_rows.keys().cloned().collect::<Vec<SampleId>>());
            let mut x = Vec::with_capacity(sample_ids.len() * self.methods_pls_feature_count);
            let mut y = Vec::with_capacity(sample_ids.len());
            for sample_id in &sample_ids {
                let row = self.methods_rows.get(sample_id).ok_or_else(|| {
                    DagMlError::RuntimeValidation(format!(
                        "portable Methods PLS provider has no attested numerical row for `{sample_id}`"
                    ))
                })?;
                // These values are provider-owned source rows.  DAG-ML only
                // supplies the scheduler-selected identity view.
                x.extend_from_slice(&row[..self.methods_pls_feature_count]);
                if include_targets {
                    y.push(match hpo_target_offset {
                        // A small non-constant native fit target keeps Methods
                        // PLS numerically well-posed. The provider then
                        // supplies an attested validation target offset for
                        // this HPO variant, and DAG-ML's ordinary RMSE
                        // collector emits the score delivered to native Median.
                        Some(offset) if request.phase == Phase::FitCv => {
                            let baseline = row[0] * 1e-3;
                            if prediction_targets {
                                baseline + offset
                            } else {
                                baseline
                            }
                        }
                        _ => row[3],
                    });
                }
            }
            let row_count = sample_ids.len();
            Ok(MethodsPlsDataset {
                y_validity_masks: None,
                sample_ids,
                x: MethodsPlsMatrix {
                    values: x,
                    rows: row_count,
                    cols: self.methods_pls_feature_count,
                },
                y: include_targets.then_some(MethodsPlsMatrix {
                    values: y,
                    rows: row_count,
                    cols: 1,
                }),
                target_names: vec!["protein".to_string()],
            })
        };
        Ok(MethodsPlsData {
            fit: rows(&request.fit_view, request.phase != Phase::Predict, false)?,
            prediction: request
                .prediction_view
                .as_ref()
                .map(|view| rows(view, true, true))
                .transpose()?,
        })
    }
}

impl AttestedProvider {
    fn handle(&self, kind: HandleKind) -> HandleRef {
        HandleRef {
            handle: self.next_handle.fetch_add(1, Ordering::SeqCst) + 1,
            kind,
            owner_controller: ControllerId::new("controller:data.provider").unwrap(),
        }
    }
}

struct TrainingController {
    id: ControllerId,
    state: Arc<CallState>,
    emits_predictions: bool,
    emits_artifact: bool,
    prediction_name: String,
}

impl RuntimeController for TrainingController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        self.state
            .observed_resources
            .lock()
            .unwrap()
            .push(task.resources.clone());
        self.state
            .calls
            .lock()
            .unwrap()
            .push((task.phase, task.node_plan.node_id.clone()));
        self.state.scoped_calls.lock().unwrap().push((
            task.phase,
            task.node_plan.node_id.clone(),
            task.fold_id.clone(),
        ));
        let is_model = task.node_plan.node_id.as_str() == "model:base";
        if is_model {
            self.state
                .observed_model_patch_values
                .lock()
                .unwrap()
                .push(task.node_plan.params.get("patched_bias").cloned());
        }
        let scoped_samples = task.fold_id.as_ref().and_then(|fold| {
            self.state
                .scoped_validation_samples
                .lock()
                .unwrap()
                .get(fold)
                .cloned()
        });
        let sample_ids =
            scoped_samples.unwrap_or_else(|| match task.fold_id.as_ref().map(FoldId::as_str) {
                Some("fold:0") => vec![sample("sample:1"), sample("sample:2")],
                Some("fold:1") => vec![sample("sample:3"), sample("sample:4")],
                None if task.phase == Phase::Predict => self
                    .state
                    .predict_sample_ids
                    .lock()
                    .unwrap()
                    .clone()
                    .unwrap_or_else(|| {
                        (1..=4)
                            .map(|index| sample(&format!("sample:{index}")))
                            .collect()
                    }),
                _ => (1..=4)
                    .map(|index| sample(&format!("sample:{index}")))
                    .collect(),
            });

        let mut value = 0.0;
        if is_model && task.phase == Phase::FitCv {
            let variant = task.variant_id.clone().expect("campaign task variant");
            let preferred = self.state.preferred.lock().unwrap().clone().unwrap();
            let ordinal = {
                let mut counts = self.state.fit_counts.lock().unwrap();
                let count = counts.entry(variant.clone()).or_default();
                let ordinal = *count;
                *count += 1;
                ordinal
            };
            value = if variant == preferred { 0.0 } else { 5.0 };
            if variant == preferred && ordinal >= 2 && *self.state.divergent_rerun.lock().unwrap() {
                value = 1.0;
            }
        } else if self.emits_predictions
            && task.phase == Phase::FitCv
            && *self.state.score_auxiliary.lock().unwrap()
        {
            let preferred = self.state.preferred.lock().unwrap().clone().unwrap();
            value = if task.variant_id.as_ref() == Some(&preferred) {
                5.0
            } else {
                0.0
            };
        }

        let partition = if matches!(task.phase, Phase::Refit | Phase::Predict) {
            PredictionPartition::Final
        } else {
            PredictionPartition::Validation
        };
        let prediction_target = if task.phase == Phase::Refit
            && *self.state.invalid_refit_output.lock().unwrap()
            && is_model
        {
            "wrong"
        } else {
            &self.prediction_name
        };
        let explicit_model_ports =
            is_model && *self.state.emit_explicit_model_ports.lock().unwrap();
        let mut predictions = if self.emits_predictions
            && matches!(task.phase, Phase::FitCv | Phase::Refit | Phase::Predict)
        {
            vec![PredictionBlock {
                prediction_id: Some(format!(
                    "prediction:{}:{}:{}",
                    task.node_plan.node_id,
                    task.phase.as_str(),
                    task.fold_id.as_ref().map(FoldId::as_str).unwrap_or("full")
                )),
                producer_node: task.node_plan.node_id.clone(),
                producer_port: explicit_model_ports.then(|| "oof".to_string()),
                partition,
                fold_id: if task.phase == Phase::FitCv {
                    task.fold_id.clone()
                } else {
                    None
                },
                sample_ids: sample_ids.clone(),
                values: sample_ids.iter().map(|_| vec![value]).collect(),
                target_names: vec![prediction_target.to_string()],
            }]
        } else {
            Vec::new()
        };
        if explicit_model_ports && !predictions.is_empty() {
            let mut sibling = predictions
                .first()
                .expect("explicit model port controller emits the primary prediction")
                .clone();
            sibling.prediction_id = sibling
                .prediction_id
                .as_ref()
                .map(|id| format!("{id}:probability"));
            sibling.producer_port = Some("probability".to_string());
            sibling.values = sibling
                .values
                .iter()
                .map(|row| row.iter().map(|value| value + 100.0).collect())
                .collect();
            predictions.push(sibling);
        }
        if is_model && task.phase == Phase::Refit && *self.state.artifact_only_refit.lock().unwrap()
        {
            predictions.clear();
        }
        if self.emits_predictions
            && task.phase == Phase::FitCv
            && *self.state.emit_extra_fit_cv_partitions.lock().unwrap()
        {
            let validation = predictions
                .first()
                .expect("FIT_CV prediction controller emits Validation")
                .clone();
            let train_sample_ids = task
                .data_views
                .get("data:x")
                .and_then(|view| view.sample_ids.clone())
                .expect("FIT_CV train block uses its attested fold-train view");
            let train_values = vec![vec![value]; train_sample_ids.len()];
            predictions.extend([
                PredictionBlock {
                    prediction_id: Some(format!(
                        "prediction:{}:FIT_CV:train:{}",
                        task.node_plan.node_id,
                        task.fold_id.as_ref().map(FoldId::as_str).unwrap_or("full")
                    )),
                    partition: PredictionPartition::Train,
                    sample_ids: train_sample_ids,
                    values: train_values,
                    ..validation.clone()
                },
                PredictionBlock {
                    prediction_id: Some(format!(
                        "prediction:{}:FIT_CV:final:{}",
                        task.node_plan.node_id,
                        task.fold_id.as_ref().map(FoldId::as_str).unwrap_or("full")
                    )),
                    partition: PredictionPartition::Final,
                    ..validation
                },
            ]);
        }
        let explanations = if is_model && task.phase == Phase::Explain {
            vec![ExplanationBlock {
                producer_node: task.node_plan.node_id.clone(),
                producer_port: explicit_model_ports.then(|| "oof".to_string()),
                method: "fixture_explain".to_string(),
                target_name: Some(self.prediction_name.clone()),
                payload: serde_json::json!({"importance": 1.0}),
            }]
        } else {
            Vec::new()
        };
        let score_this_producer =
            is_model || (self.emits_predictions && *self.state.score_auxiliary.lock().unwrap());
        let regression_targets = if score_this_producer && task.phase == Phase::FitCv {
            vec![RegressionTargetBlock {
                validity_masks: None,
                level: PredictionLevel::Sample,
                unit_ids: sample_ids
                    .iter()
                    .cloned()
                    .map(PredictionUnitId::Sample)
                    .collect(),
                values: sample_ids.iter().map(|_| vec![0.0]).collect(),
                target_names: vec![self.prediction_name.clone()],
            }]
        } else {
            Vec::new()
        };
        let artifacts = if self.emits_artifact && task.phase == Phase::Refit {
            vec![ArtifactRef {
                id: ArtifactId::new(format!("artifact:{}:refit", task.node_plan.node_id)).unwrap(),
                kind: "test_model".to_string(),
                controller_id: self.id.clone(),
                backend: None,
                uri: None,
                content_fingerprint: None,
                size_bytes: Some(8),
                plugin: None,
                plugin_version: None,
                abi_major: None,
                abi_min_minor: None,
                native_predictor_descriptor: None,
                native_estimator_descriptor: None,
            }]
        } else {
            Vec::new()
        };
        let artifact_handles = artifacts
            .iter()
            .map(|artifact| {
                (
                    artifact.id.clone(),
                    HandleRef {
                        handle: self.state.handle(),
                        kind: HandleKind::Artifact,
                        owner_controller: self.id.clone(),
                    },
                )
            })
            .collect();
        let output_port = if is_model { "oof" } else { "x_out" };
        Ok(NodeResult {
            schema_version: None,
            classification_probabilities: Vec::new(),
            consumed_data_views: std::collections::BTreeMap::new(),
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([(
                output_port.to_string(),
                HandleRef {
                    handle: self.state.handle(),
                    kind: if is_model {
                        HandleKind::Prediction
                    } else {
                        HandleKind::Data
                    },
                    owner_controller: self.id.clone(),
                },
            )]),
            predictions,
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations,
            shape_deltas: Vec::new(),
            artifacts: artifacts.clone(),
            artifact_handles,
            fit_influence_diagnostics: Vec::new(),
            regression_targets,
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:{}:{}:{}:{}",
                    task.node_plan.node_id,
                    task.phase.as_str(),
                    task.variant_id
                        .as_ref()
                        .map(VariantId::as_str)
                        .unwrap_or("base"),
                    task.fold_id.as_ref().map(FoldId::as_str).unwrap_or("full")
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
                input_lineage: Vec::new(),
                artifact_refs: artifacts,
                params_fingerprint: task.node_plan.params_fingerprint.clone(),
                data_model_shape_fingerprint: None,
                aggregation_policy_fingerprint: None,
                seed: task.seed,
                unsafe_flags: BTreeSet::new(),
                metrics: BTreeMap::new(),
                loss_attestations: Vec::new(),
                early_stopping_records: Vec::new(),
                target_domain: None,
            },
        })
    }
}

struct Fixture {
    request: TrainingRequest,
    relations: SampleRelationSet,
    influence: TrainingInfluenceManifest,
    preferred: VariantId,
}

fn fixture(refit: bool, stacking: bool) -> Fixture {
    let graph: GraphSpec =
        serde_json::from_str(include_str!("fixtures/package/minimal_graph.json")).unwrap();
    let mut campaign: CampaignSpec = serde_json::from_str(include_str!(
        "fixtures/package/campaign_oof_generation.json"
    ))
    .unwrap();
    let mut controller_manifests: Vec<ControllerManifest> =
        serde_json::from_str(include_str!("fixtures/package/controller_manifests.json")).unwrap();
    controller_manifests.sort_by(|left, right| left.controller_id.cmp(&right.controller_id));
    let relations = relations();
    let relation_fingerprint = relations.fingerprint().unwrap();
    for bindings in campaign.data_bindings.values_mut() {
        for binding in bindings {
            binding.relation_fingerprint = Some(relation_fingerprint.clone());
        }
    }
    let mut data_identities = campaign
        .data_bindings
        .values()
        .flatten()
        .map(|binding| {
            let mut identity = TrainingDataIdentity {
                requirement_key: data_binding_requirement_key(
                    &binding.node_id,
                    &binding.input_name,
                ),
                schema_fingerprint: binding.schema_fingerprint.clone(),
                plan_fingerprint: binding.plan_fingerprint.clone(),
                relation_fingerprint: relation_fingerprint.clone(),
                data_content_fingerprint: "a".repeat(64),
                target_content_fingerprint: "b".repeat(64),
                identity_fingerprint: "0".repeat(64),
            };
            identity.identity_fingerprint = identity.compute_fingerprint().unwrap();
            identity
        })
        .collect::<Vec<_>>();
    data_identities.sort_by(|left, right| left.requirement_key.cmp(&right.requirement_key));
    let options: TrainingOptions = serde_json::from_value(serde_json::json!({
        "refit": refit,
        "refit_strategy": if refit { serde_json::json!("refit_one") } else { serde_json::Value::Null },
        "seed": 12345,
        "selection": {
            "id": "selection:rmse",
            "metric": {"name": "rmse", "objective": "minimize"},
            "require_finite": true
        },
        "selection_output_id": "output:prediction",
        "outputs": [{
            "output_id": "output:prediction",
            "node_id": "model:base",
            "prediction_level": "sample",
            "unit_level": "physical_sample",
            "prediction_kind": "regression_point",
            "target_names": ["protein"],
            "target_units": ["percent"],
            "class_labels": [[]],
            "output_order": "target_order",
            "target_space": "raw"
        }],
        "scheduler": {"kind": "sequential", "backend": null, "workers": 1},
        "resources": {"cpu_threads": 1, "memory_bytes": null, "gpu_devices": [], "wall_time_ms": null},
        "artifacts": {"cv_artifacts": "discard", "prediction_caches": "retain", "fitted_artifacts": "allow_host_sidecar"}
    }))
    .unwrap();
    let mut request = TrainingRequest {
        schema_version: TRAINING_REQUEST_SCHEMA_VERSION,
        request_id: "training:package.synthetic".to_string(),
        plan_id: "plan:training.package.synthetic".to_string(),
        graph,
        campaign,
        controller_manifests,
        data_identities,
        parameter_patches: Vec::new(),
        patch_policies: Vec::new(),
        influence_requirements: Vec::new(),
        training_losses: Vec::new(),
        options,
        request_fingerprint: "0".repeat(64),
    };
    request.options.refit = refit;
    request.options.refit_strategy = refit.then_some(RefitStrategy::RefitOne);
    request.options.selection.required_metric_level = Some(PredictionLevel::Sample);
    request.options.selection.evaluation_scope = Some(EvaluationScope::Oof);
    request.options.resources.memory_bytes = None;
    request.options.resources.wall_time_ms = None;
    request.options.artifacts.cv_artifacts = CvArtifactRetention::Discard;
    request.options.artifacts.fitted_artifacts = FittedArtifactMode::AllowHostSidecar;
    for dimension in &mut request.campaign.generation.dimensions {
        if dimension.name == "model_family" {
            for (index, choice) in dimension.choices.iter_mut().enumerate() {
                choice.param_overrides = vec![GenerationParamOverride {
                    node_id: node("model:base"),
                    params: BTreeMap::from([(
                        "n_estimators".to_string(),
                        serde_json::json!(10 + index),
                    )]),
                }];
            }
        }
    }
    if stacking {
        add_stacking_edge(&mut request);
    }
    resign_request(&mut request);
    let projection = request.project().unwrap();
    let preferred = projection.plan.variants[0].variant_id.clone();
    let influence = influence_manifest(&request, &projection, &relations);
    Fixture {
        request,
        relations,
        influence,
        preferred,
    }
}

fn add_stacking_edge(request: &mut TrainingRequest) {
    let prediction_port = PortSpec {
        name: "oof_aux".to_string(),
        kind: PortKind::Prediction,
        representation: None,
        cardinality: PortCardinality::One,
        unit_level: None,
        alignment_key: None,
        target_level: None,
        description: String::new(),
    };
    let input_port = PortSpec {
        name: "meta".to_string(),
        ..prediction_port.clone()
    };
    request
        .graph
        .nodes
        .iter_mut()
        .find(|node| node.id.as_str() == "transform:snv")
        .unwrap()
        .ports
        .outputs
        .push(prediction_port.clone());
    request
        .graph
        .nodes
        .iter_mut()
        .find(|node| node.id.as_str() == "model:base")
        .unwrap()
        .ports
        .inputs
        .push(input_port.clone());
    request.graph.edges.push(EdgeSpec {
        source: PortRef {
            node_id: node("transform:snv"),
            port_name: "oof_aux".to_string(),
        },
        target: PortRef {
            node_id: node("model:base"),
            port_name: "meta".to_string(),
        },
        contract: EdgeContract {
            requires_oof: true,
            requires_fold_alignment: true,
            ..EdgeContract::new(PortKind::Prediction, None)
        },
    });
    let transform = request
        .controller_manifests
        .iter_mut()
        .find(|manifest| manifest.controller_id.as_str() == "controller:transform.mock")
        .unwrap();
    transform.output_ports.push(prediction_port);
    transform
        .capabilities
        .insert(ControllerCapability::EmitsPredictions);
    let model = request
        .controller_manifests
        .iter_mut()
        .find(|manifest| manifest.controller_id.as_str() == "controller:model.mock")
        .unwrap();
    model.input_ports.push(input_port);
}

fn add_portable_methods_hpo(fixture: &mut Fixture) {
    fixture.request.campaign.generation.dimensions.clear();
    fixture.request.campaign.generation.strategy = GenerationStrategy::None;
    fixture
        .request
        .graph
        .nodes
        .iter_mut()
        .find(|node| node.id.as_str() == "model:base")
        .unwrap()
        .operator = Some(serde_json::json!("pls"));
    // This fixture switches a mock forest controller to the production PLS
    // controller. Do not retain the forest's n_estimators parameter: the
    // native PLS descriptor rightly rejects parameters from another model.
    fixture
        .request
        .graph
        .nodes
        .iter_mut()
        .find(|node| node.id.as_str() == "model:base")
        .unwrap()
        .params = BTreeMap::from([("n_components".to_string(), serde_json::json!(1))]);
    fixture.request.campaign.metadata.insert(
        "methods_hpo_operation".to_string(),
        serde_json::json!({
            "operation_id": "hpo:methods",
            "study": {
                "controller_id": "controller:tuner.methods",
                "study_id": "study:training.test",
                "methods_abi": "libn4m:dev-debug",
                "search_space": {
                    "parameters": [{
                        "kind": "int",
                        "name": "n_components",
                        "low": 1,
                        "high": 3,
                        "step": 1,
                        "log": false
                    }]
                },
                "optimizer": {
                    "sampler": "random",
                    "pruner": "none",
                    "direction": "minimize",
                    "metric": "rmse",
                    "seed": 7,
                    "n_startup_trials": 0,
                    "max_resource": 0,
                    "reduction_factor": 0
                }
            },
            "trials": 2,
            "target_node_id": "model:base",
            "parameter_paths": {"n_components": "n_components"}
        }),
    );
    let mut tuner_manifest = fixture
        .request
        .controller_manifests
        .iter()
        .find(|manifest| manifest.controller_id.as_str() == "controller:model.mock")
        .unwrap()
        .clone();
    tuner_manifest.controller_id = ControllerId::new("controller:tuner.methods").unwrap();
    tuner_manifest.operator_kind = NodeKind::Tuner;
    tuner_manifest.input_ports.clear();
    tuner_manifest.output_ports.clear();
    fixture.request.controller_manifests.push(tuner_manifest);
    let model = fixture
        .request
        .controller_manifests
        .iter_mut()
        .find(|manifest| manifest.controller_id.as_str() == "controller:model.mock")
        .unwrap();
    model.controller_id = ControllerId::new(METHODS_PLS_CONTROLLER_ID).unwrap();
    model.controller_version = "libn4m-2.2".to_string();
    // This is a controller-declared Archive/Package V3 capability, not an
    // implication of merely supporting the scheduler REFIT phase.  The test
    // fixture uses the production N4MM controller, which is portable across
    // a fresh process and can therefore honestly opt in.
    model
        .capabilities
        .insert(ControllerCapability::SupportsPortableFullRefit);
    rebuild(fixture);
    fixture.preferred = VariantId::new("hpo:trial:0").unwrap();
}

#[cfg(feature = "methods-optimizer-local")]
fn use_studio_pls_regression_v1_params(fixture: &mut Fixture) {
    let params = serde_json::from_str(include_str!(
        "fixtures/package/studio_pls_regression_v1_params.json"
    ))
    .unwrap();
    fixture
        .request
        .graph
        .nodes
        .iter_mut()
        .find(|node| node.id.as_str() == "model:base")
        .unwrap()
        .params = params;
    rebuild(fixture);
}

#[cfg(feature = "methods-optimizer-local")]
fn use_portable_methods_pipeline(fixture: &mut Fixture) {
    fixture.request.campaign.generation.dimensions.clear();
    fixture.request.campaign.generation.strategy = GenerationStrategy::None;
    fixture
        .request
        .campaign
        .shape_plans
        .remove(&node("transform:snv"));
    fixture
        .request
        .graph
        .nodes
        .retain(|node| node.id.as_str() == "model:base");
    fixture.request.graph.edges.clear();
    let model_node = fixture.request.graph.nodes.first_mut().unwrap();
    model_node.operator = Some(serde_json::json!("pls"));
    model_node.seed_label = None;
    model_node.params = BTreeMap::from([
        ("n_components".to_string(), serde_json::json!(1)),
        (
            "pipeline".to_string(),
            serde_json::json!({
                "schema_version": 1,
                "pipeline_type": "n4m.snv_savgol_smooth.v1",
                "savgol_window": 3,
                "savgol_poly_degree": 2
            }),
        ),
    ]);
    fixture
        .request
        .controller_manifests
        .retain(|manifest| manifest.operator_kind == NodeKind::Model);
    let model = fixture.request.controller_manifests.first_mut().unwrap();
    model.controller_id = ControllerId::new(METHODS_PLS_CONTROLLER_ID).unwrap();
    model.controller_version = "libn4m-2.5".to_string();
    model
        .capabilities
        .insert(ControllerCapability::SupportsPortableFullRefit);
    rebuild(fixture);
}

/// HPO is a scheduler campaign operation, so tests alter its explicit
/// descriptor rather than reintroducing a control-only graph node.
fn methods_hpo_descriptor_mut(fixture: &mut Fixture) -> &mut serde_json::Value {
    fixture
        .request
        .campaign
        .metadata
        .get_mut("methods_hpo_operation")
        .expect("portable Methods HPO fixture has its campaign operation")
}

/// Use two ordinary four-row training folds with three provider-owned feature
/// columns. That makes all V1 `n_components=1..=3` candidates genuinely
/// evaluable; the alternating third feature is intentionally out-of-fold
/// hostile, making component 3 the deterministic bad Median candidate.
#[cfg(feature = "methods-optimizer-local")]
fn give_methods_hpo_four_train_rows(fixture: &mut Fixture) {
    let fold_set = fixture
        .request
        .campaign
        .split_invocation
        .as_mut()
        .unwrap()
        .fold_set
        .as_mut()
        .unwrap();
    fold_set.sample_ids = (1..=8)
        .map(|index| sample(&format!("sample:{index}")))
        .collect();
    fold_set.folds = vec![
        FoldAssignment {
            fold_id: FoldId::new("fold:0").unwrap(),
            train_sample_ids: vec![
                sample("sample:5"),
                sample("sample:6"),
                sample("sample:7"),
                sample("sample:8"),
            ],
            validation_sample_ids: vec![
                sample("sample:1"),
                sample("sample:2"),
                sample("sample:3"),
                sample("sample:4"),
            ],
            metadata: BTreeMap::new(),
        },
        FoldAssignment {
            fold_id: FoldId::new("fold:1").unwrap(),
            train_sample_ids: vec![
                sample("sample:1"),
                sample("sample:2"),
                sample("sample:3"),
                sample("sample:4"),
            ],
            validation_sample_ids: vec![
                sample("sample:5"),
                sample("sample:6"),
                sample("sample:7"),
                sample("sample:8"),
            ],
            metadata: BTreeMap::new(),
        },
    ];
    for index in 5..=8 {
        fixture.relations.records.push(SampleRelation::new(
            ObservationId::new(format!("observation:{index}")).unwrap(),
            sample(&format!("sample:{index}")),
        ));
    }
    let relation_fingerprint = fixture.relations.fingerprint().unwrap();
    for bindings in fixture.request.campaign.data_bindings.values_mut() {
        for binding in bindings {
            binding.relation_fingerprint = Some(relation_fingerprint.clone());
        }
    }
    for identity in &mut fixture.request.data_identities {
        identity.relation_fingerprint = relation_fingerprint.clone();
        identity.identity_fingerprint = "0".repeat(64);
        identity.identity_fingerprint = identity.compute_fingerprint().unwrap();
    }
}

#[cfg(feature = "methods-optimizer-local")]
fn give_methods_hpo_seeded_three_fold_rows(fixture: &mut Fixture) {
    give_methods_hpo_four_train_rows(fixture);
    let fold_set = fixture
        .request
        .campaign
        .split_invocation
        .as_mut()
        .unwrap()
        .fold_set
        .as_mut()
        .unwrap();
    let fold_set_id = fold_set.id.clone();
    let sample_ids = fold_set.sample_ids.clone();
    *fold_set = KFoldSpec {
        n_splits: 3,
        shuffle: true,
        seed: Some(9),
    }
    .split(fold_set_id, &sample_ids)
    .unwrap();
}

/// Configure a fully attested, deterministic OOF scoring provider for native
/// HPO. The provider returns fit/validation target blocks; Methods PLS still
/// predicts them, DAG-ML still calculates the OOF RMSE report, and libn4m
/// alone makes the Median pruning decision. No optimizer status or score is
/// injected into the tuner session.
#[cfg(feature = "methods-optimizer-local")]
fn configure_deterministic_hpo_oof_provider(provider: &mut AttestedProvider) {
    provider.methods_pls_feature_count = 3;
    provider.methods_hpo_oof_target_offsets = BTreeMap::from([
        // Native TPE seed 51 asks components 2, 1, then 3. The true
        // provider-generated OOF RMSEs make 3 worse than the completed peer
        // median, so `report_intermediate` terminalizes it as PRUNED.
        (0, 0.25),
        (1, 0.5),
        (2, 10.0),
    ]);
}

fn run(
    fixture: &Fixture,
    state: Arc<CallState>,
    provider: &AttestedProvider,
    store: &mut InMemoryArtifactStore,
) -> Result<TrainingOutcome> {
    run_custom(
        fixture,
        state,
        provider,
        store,
        "outcome:test.native",
        BTreeMap::from([("test".to_string(), serde_json::json!(true))]),
        true,
    )
}

fn run_custom(
    fixture: &Fixture,
    state: Arc<CallState>,
    provider: &AttestedProvider,
    store: &mut InMemoryArtifactStore,
    outcome_id: &str,
    diagnostics: BTreeMap<String, serde_json::Value>,
    complete_controllers: bool,
) -> Result<TrainingOutcome> {
    *state.preferred.lock().unwrap() = Some(fixture.preferred.clone());
    let controllers = controllers(fixture, state, complete_controllers);
    execute_training(TrainingExecutionInput {
        request: &fixture.request,
        outcome_id: outcome_id.to_string(),
        run_id: RunId::new("run:test.native").unwrap(),
        bundle_id: BundleId::new("bundle:test.native").unwrap(),
        controllers: &controllers,
        data_provider: provider,
        relations: &fixture.relations,
        training_influence: &fixture.influence,
        artifact_store: store,
        warnings: Vec::new(),
        diagnostics,
    })
}

fn controllers(
    fixture: &Fixture,
    state: Arc<CallState>,
    complete: bool,
) -> RuntimeControllerRegistry {
    let transform_predictions = fixture
        .request
        .graph
        .edges
        .iter()
        .any(|edge| edge.contract.requires_oof);
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(TrainingController {
            id: ControllerId::new("controller:transform.mock").unwrap(),
            state: state.clone(),
            emits_predictions: transform_predictions,
            emits_artifact: false,
            prediction_name: "aux".to_string(),
        }))
        .unwrap();
    if complete
        && fixture
            .request
            .controller_manifests
            .iter()
            .any(|manifest| manifest.controller_id.as_str() == METHODS_NATIVE_REGRESSION_CONTROLLER)
    {
        #[cfg(feature = "methods-optimizer-local")]
        controllers
            .register(Box::new(MethodsNativeRegressionController::new(
                methods_runtime(),
            )))
            .unwrap();
    } else if complete
        && fixture
            .request
            .controller_manifests
            .iter()
            .any(|manifest| manifest.controller_id.as_str() == METHODS_PLS_CONTROLLER_ID)
    {
        #[cfg(feature = "methods-optimizer-local")]
        controllers
            .register(Box::new(MethodsPlsController::new(methods_runtime())))
            .unwrap();
    } else if complete {
        controllers
            .register(Box::new(TrainingController {
                id: ControllerId::new("controller:model.mock").unwrap(),
                state,
                emits_predictions: true,
                emits_artifact: true,
                prediction_name: "protein".to_string(),
            }))
            .unwrap();
    }
    if fixture
        .request
        .controller_manifests
        .iter()
        .any(|manifest| manifest.controller_id.as_str() == "controller:tuner.methods")
    {
        #[cfg(feature = "methods-optimizer-local")]
        controllers
            .register(Box::new(MethodsHpoController::new(
                ControllerId::new("controller:tuner.methods").unwrap(),
                methods_runtime(),
            )))
            .unwrap();
        #[cfg(not(feature = "methods-optimizer-local"))]
        controllers
            .register(Box::new(TrainingController {
                id: ControllerId::new("controller:tuner.methods").unwrap(),
                state: Arc::new(CallState::default()),
                emits_predictions: false,
                emits_artifact: false,
                prediction_name: "unused".to_string(),
            }))
            .unwrap();
    }
    controllers
}

#[cfg(feature = "methods-optimizer-local")]
fn use_native_pls_phase_profile(fixture: &mut Fixture, trials: Option<u32>) {
    use_portable_methods_pipeline(fixture);
    let params = BTreeMap::from([
        (
            "native_profile".into(),
            serde_json::json!(METHODS_PLS_ROLE_PROFILE),
        ),
        ("n_components".into(), serde_json::json!(1)),
        ("scale".into(), serde_json::json!(true)),
    ]);
    let contract = methods_pls_role_pipeline_contract(&params).unwrap();
    let model = fixture.request.graph.nodes.first_mut().unwrap();
    model.operator = Some(contract["operator"].clone());
    model.params = params;
    let manifest: ControllerManifest =
        serde_json::from_value(contract["manifest"].clone()).unwrap();
    fixture.request.controller_manifests = vec![manifest.clone()];
    if let Some(trials) = trials {
        let mut old = self::fixture(true, false);
        add_portable_methods_hpo(&mut old);
        let mut operation = methods_hpo_descriptor_mut(&mut old).clone();
        operation["schema_version"] = serde_json::json!(2);
        operation["native_profile"] = serde_json::json!(METHODS_PLS_ROLE_PROFILE);
        operation["trials"] = serde_json::json!(trials);
        operation["study"]["methods_abi"] = serde_json::json!("n4m-abi-2.14");
        operation["study"]["search_space"] = serde_json::json!({"parameters":[{"kind":"categorical","name":"scale","values":[false,true]}]});
        operation["parameter_paths"] = serde_json::json!({"scale":"scale"});
        fixture
            .request
            .campaign
            .metadata
            .insert("methods_hpo_operation".into(), operation);
        let mut tuner = manifest;
        tuner.controller_id = ControllerId::new("controller:tuner.methods").unwrap();
        tuner.operator_kind = NodeKind::Tuner;
        tuner.input_ports.clear();
        tuner.output_ports.clear();
        fixture.request.controller_manifests.push(tuner);
    }
    rebuild(fixture);
}

#[cfg(feature = "methods-optimizer-local")]
#[test]
fn native_pls_fixed_phase_controls_validate_without_hpo_selection_influence() {
    let mut fixture = fixture(true, false);
    use_native_pls_phase_profile(&mut fixture, None);
    fixture.request.parameter_patches = vec![
        ParameterPatch {
            schema_version: 1,
            node_id: node("model:base"),
            namespace: ParameterNamespace::Fit,
            path: vec!["refit_params".into()],
            value: serde_json::json!({"scale":true}),
        },
        ParameterPatch {
            schema_version: 1,
            node_id: node("model:base"),
            namespace: ParameterNamespace::Fit,
            path: vec!["train_params".into()],
            value: serde_json::json!({"scale":false}),
        },
    ];
    fixture.request.patch_policies = vec![NodePatchPolicy {
        node_id: node("model:base"),
        allowed_namespaces: BTreeSet::from([ParameterNamespace::Fit]),
    }];
    rebuild(&mut fixture);
    let mut store = InMemoryArtifactStore::new();
    let outcome = run(
        &fixture,
        Arc::new(CallState::default()),
        &provider(&fixture),
        &mut store,
    )
    .unwrap();
    outcome.validate().unwrap();
    assert!(outcome.methods_hpo_resume_state.is_none());
    // Generic SELECT records selection influence even for a fixed recipe.
    // A Fit-only patch does not independently require an HPO attestation.
    let mut without_hpo = outcome.clone();
    without_hpo
        .training_influence
        .entries
        .retain(|entry| entry.kind != TrainingInfluenceKind::HpoSelection);
    without_hpo.training_influence.manifest_fingerprint = without_hpo
        .training_influence
        .compute_fingerprint()
        .unwrap();
    resign_outcome(&mut without_hpo);
    without_hpo.validate().unwrap();
    assert_eq!(outcome.parameter_patches, fixture.request.parameter_patches);
    let artifact = &outcome.execution_bundle.refit_artifacts[0].artifact;
    let inspected = inspect_methods_role_pipeline_params(
        &outcome.execution_bundle.raw_artifact_payloads[&artifact.id],
        &methods_runtime(),
    )
    .unwrap();
    assert_eq!(inspected["model_params"]["scale"], serde_json::json!(true));
    TrainingOutcome::from_json(&serde_json::to_string(&outcome).unwrap()).unwrap();
    let mut tampered = outcome;
    tampered
        .parameter_patches
        .iter_mut()
        .find(|p| p.path[0] == "train_params")
        .unwrap()
        .value["scale"] = serde_json::json!(true);
    resign_outcome(&mut tampered);
    assert!(tampered.validate().is_err());
}

#[cfg(feature = "methods-optimizer-local")]
fn native_fold_hpo_fixture(trials: u32) -> Fixture {
    let mut fixture = fixture(true, false);
    use_native_pls_phase_profile(&mut fixture, Some(trials));
    give_methods_hpo_four_train_rows(&mut fixture);
    rebuild(&mut fixture);
    let outer = fixture.request.project().unwrap().plan.fold_set.unwrap();
    let spec = NestedCvSpec::KFold(KFoldSpec {
        n_splits: 2,
        shuffle: false,
        seed: None,
    });
    let inner = outer
        .folds
        .iter()
        .map(|fold| {
            (
                fold.fold_id.clone(),
                outer.nested_fold_set(&spec, fold).unwrap(),
            )
        })
        .collect::<BTreeMap<_, _>>();
    let mut refit = KFoldSpec {
        n_splits: 2,
        shuffle: false,
        seed: None,
    }
    .split("refit.inner", &outer.sample_ids)
    .unwrap();
    for fold in &mut refit.folds {
        fold.fold_id = FoldId::new(format!("refit.inner.{}", fold.fold_id)).unwrap();
    }
    let operation = methods_hpo_descriptor_mut(&mut fixture);
    operation["schema_version"] = serde_json::json!(3);
    operation["scope"] = serde_json::json!("fold");
    operation["inner_fold_sets"] = serde_json::to_value(inner).unwrap();
    operation["refit_inner_fold_set"] = serde_json::to_value(refit).unwrap();
    rebuild(&mut fixture);
    fixture
}

#[cfg(feature = "methods-optimizer-local")]
fn fold_hpo_witness_provider(fixture: &Fixture) -> AttestedProvider {
    let mut provider = provider(fixture);
    // Opposite target mechanisms in the two outer training scopes require
    // different scale choices; the feature buffers remain provider-owned.
    for (id, row) in &mut provider.methods_rows {
        let index = id
            .as_str()
            .strip_prefix("sample:")
            .unwrap()
            .parse::<usize>()
            .unwrap();
        row[3] = if index <= 4 { row[0] } else { row[1] };
    }
    provider
}

#[cfg(feature = "methods-optimizer-local")]
#[test]
fn native_fold_hpo_uses_distinct_outer_winners_and_independent_refit_raw() {
    let fixture = native_fold_hpo_fixture(12);
    let mut store = InMemoryArtifactStore::new();
    let outcome = run(
        &fixture,
        Arc::new(CallState::default()),
        &fold_hpo_witness_provider(&fixture),
        &mut store,
    )
    .unwrap();
    outcome.validate().unwrap();
    let state = outcome.methods_hpo_fold_state.as_ref().unwrap();
    assert!(outcome.methods_hpo_resume_state.is_none());
    assert_eq!(state.outer_scopes.len(), 2);
    assert_eq!(
        state.outer_scopes[0].winner_params["scale"],
        serde_json::json!(false)
    );
    assert_eq!(
        state.outer_scopes[1].winner_params["scale"],
        serde_json::json!(true)
    );
    assert_eq!(state.refit_scope.phase, Phase::Refit);
    assert_eq!(
        state.refit_scope.winner_variant_id,
        outcome.selected_variant_id
    );
    let study_ids = state
        .outer_scopes
        .iter()
        .chain(std::iter::once(&state.refit_scope))
        .map(|s| &s.resume_state.checkpoint.binding.study_id)
        .collect::<BTreeSet<_>>();
    assert_eq!(study_ids.len(), 3);
    let variants = state
        .outer_scopes
        .iter()
        .chain(std::iter::once(&state.refit_scope))
        .flat_map(|s| {
            s.resume_state
                .completed_proposals
                .iter()
                .map(|p| &p.variant.variant_id)
        })
        .collect::<BTreeSet<_>>();
    assert_eq!(variants.len(), 36);
    for scope in &state.outer_scopes {
        let record = outcome
            .lineage
            .iter()
            .find(|r| {
                r.node_id == state.target_node_id
                    && r.phase == Phase::FitCv
                    && r.fold_id == scope.outer_fold_id
            })
            .unwrap();
        assert_eq!(record.params_fingerprint, scope.params_fingerprint);
        assert_eq!(
            record.variant_id.as_ref(),
            Some(&outcome.selected_variant_id)
        );
    }
    assert_eq!(outcome.execution_bundle.refit_artifacts.len(), 1);
    let artifact = &outcome.execution_bundle.refit_artifacts[0];
    let inspected = inspect_methods_role_pipeline_params(
        &outcome.execution_bundle.raw_artifact_payloads[&artifact.artifact.id],
        &methods_runtime(),
    )
    .unwrap();
    assert_eq!(
        inspected["model_params"]["scale"],
        state.refit_scope.winner_params["scale"]
    );
    TrainingOutcome::from_json(&serde_json::to_string(&outcome).unwrap()).unwrap();
    let mut tampered = outcome.clone();
    tampered
        .methods_hpo_fold_state
        .as_mut()
        .unwrap()
        .outer_scopes[0]
        .params_fingerprint = "0".repeat(64);
    tampered.execution_bundle.methods_hpo_fold_state = tampered.methods_hpo_fold_state.clone();
    resign_outcome(&mut tampered);
    assert!(tampered.validate().is_err());
}

#[cfg(feature = "methods-optimizer-local")]
#[test]
fn native_fold_hpo_outer_validation_targets_cannot_choose_its_inner_winner() {
    let fixture = native_fold_hpo_fixture(8);
    let execute = |provider: &AttestedProvider| {
        let mut store = InMemoryArtifactStore::new();
        run(
            &fixture,
            Arc::new(CallState::default()),
            provider,
            &mut store,
        )
        .unwrap()
    };
    let mut provider = fold_hpo_witness_provider(&fixture);
    let first = execute(&provider);
    for index in 1..=4 {
        provider
            .methods_rows
            .get_mut(&sample(&format!("sample:{index}")))
            .unwrap()[3] += 10000.0;
    }
    let second = execute(&provider);
    let a = &first.methods_hpo_fold_state.as_ref().unwrap().outer_scopes[0];
    let b = &second.methods_hpo_fold_state.as_ref().unwrap().outer_scopes[0];
    assert_eq!(a.winner_params, b.winner_params);
    assert_eq!(
        a.resume_state.completed_reports,
        b.resume_state.completed_reports
    );
    assert_ne!(first.score_set, second.score_set);
}

#[cfg(feature = "methods-optimizer-local")]
#[test]
fn native_fold_hpo_refit_override_changes_raw_recipe_without_changing_inner_selection() {
    let mut fixture = native_fold_hpo_fixture(8);
    let execute = |fixture: &Fixture| {
        let mut store = InMemoryArtifactStore::new();
        run(
            fixture,
            Arc::new(CallState::default()),
            &fold_hpo_witness_provider(fixture),
            &mut store,
        )
        .unwrap()
    };
    let baseline = execute(&fixture);
    let winner = baseline
        .methods_hpo_fold_state
        .as_ref()
        .unwrap()
        .refit_scope
        .winner_params["scale"]
        .as_bool()
        .unwrap();
    fixture.request.parameter_patches = vec![ParameterPatch {
        schema_version: 1,
        node_id: node("model:base"),
        namespace: ParameterNamespace::Fit,
        path: vec!["refit_params".into()],
        value: serde_json::json!({"scale":!winner}),
    }];
    fixture.request.patch_policies = vec![NodePatchPolicy {
        node_id: node("model:base"),
        allowed_namespaces: BTreeSet::from([ParameterNamespace::Fit]),
    }];
    rebuild(&mut fixture);
    let overridden = execute(&fixture);
    let state = overridden.methods_hpo_fold_state.as_ref().unwrap();
    assert_eq!(
        state.refit_scope.winner_params["scale"],
        serde_json::json!(winner)
    );
    let artifact = &overridden.execution_bundle.refit_artifacts[0];
    assert_eq!(
        state.refit_scope.params_fingerprint,
        artifact.params_fingerprint
    );
    let inspected = inspect_methods_role_pipeline_params(
        &overridden.execution_bundle.raw_artifact_payloads[&artifact.artifact.id],
        &methods_runtime(),
    )
    .unwrap();
    assert_eq!(
        inspected["model_params"]["scale"],
        serde_json::json!(!winner)
    );
    overridden.validate().unwrap();
}

#[cfg(feature = "methods-optimizer-local")]
#[test]
fn native_fold_hpo_missing_root_target_is_a_contract_error_without_panicking() {
    let fixture = native_fold_hpo_fixture(2);
    let mut store = InMemoryArtifactStore::new();
    let outcome = run(
        &fixture,
        Arc::new(CallState::default()),
        &fold_hpo_witness_provider(&fixture),
        &mut store,
    )
    .unwrap();
    let mut package = outcome
        .to_portable_predictor_package(
            "predictor:fold.missing.target",
            FittedArtifactMode::PortableRequired,
            ArtifactLoadMode::NativePortable,
        )
        .unwrap();
    let state = package
        .execution_bundle
        .methods_hpo_fold_state
        .as_mut()
        .unwrap();
    state.target_node_id = node("model:absent");
    state
        .base_plan
        .campaign
        .metadata
        .get_mut("methods_hpo_operation")
        .unwrap()["target_node_id"] = serde_json::json!("model:absent");
    state.base_plan.campaign_fingerprint = legacy_serde_fingerprint(&state.base_plan.campaign);
    state.provenance.selection.target_node_id = state.target_node_id.clone();
    // Re-seal immutable campaign authority and scoped plans, while each resume
    // ledger still names its real model. The missing root is a semantic error,
    // not a stale JSON fingerprint that can hide an unchecked map access.
    let campaign_fingerprint = |plan: &ExecutionPlan| {
        let mut campaign = plan.campaign.clone();
        let operation = campaign
            .metadata
            .get_mut("methods_hpo_operation")
            .unwrap()
            .as_object_mut()
            .unwrap();
        operation.remove("resume_package_json");
        operation.remove("trials");
        legacy_serde_fingerprint(&campaign)
    };
    state.provenance.campaign_fingerprint = campaign_fingerprint(&state.base_plan);
    for scope in state
        .outer_scopes
        .iter_mut()
        .chain(std::iter::once(&mut state.refit_scope))
    {
        let plan =
            methods_fold_hpo_study_plan(&state.base_plan, &scope.scope_id, &scope.inner_fold_set)
                .unwrap();
        scope.scope_plan_fingerprint = legacy_serde_fingerprint(&plan);
        scope.resume_state.provenance.campaign_fingerprint = campaign_fingerprint(&plan);
    }
    let validation = std::panic::catch_unwind(|| state.validate());
    let error = validation
        .expect("missing target must not panic")
        .unwrap_err()
        .to_string();
    assert!(error.contains("root target is absent"), "{error}");
    package.package_fingerprint = package.compute_fingerprint().unwrap();
    let json = serde_json::to_string(&package).unwrap();
    let read = std::panic::catch_unwind(|| methods_hpo_fold_state_from_package_json(&json));
    let error = read
        .expect("public package reader must not panic")
        .unwrap_err()
        .to_string();
    assert!(error.contains("root target is absent"), "{error}");
}

#[cfg(feature = "methods-optimizer-local")]
#[test]
fn native_fold_hpo_complete_package_resume_matches_fresh_studies_and_refuses_scope_swap() {
    let execute = |trials, package: Option<&PortablePredictorPackage>| {
        let mut fixture = native_fold_hpo_fixture(trials);
        if let Some(package) = package {
            methods_hpo_descriptor_mut(&mut fixture)["resume_package_json"] =
                serde_json::json!(serde_json::to_string(package).unwrap());
        }
        // Match the Python dict boundary before the first projection/FIT.
        // Historical graph fingerprints bind that initial representation;
        // sorting an arbitrary native fixture only after FIT changes it.
        let mut wire = serde_json::to_value(&fixture.request).unwrap();
        wire.sort_all_objects();
        fixture.request = serde_json::from_value(wire).unwrap();
        rebuild(&mut fixture);
        let mut store = InMemoryArtifactStore::new();
        run(
            &fixture,
            Arc::new(CallState::default()),
            &fold_hpo_witness_provider(&fixture),
            &mut store,
        )
        .unwrap()
    };
    let first = execute(2, None);
    let package = first
        .to_portable_predictor_package(
            "predictor:fold.resume",
            FittedArtifactMode::PortableRequired,
            ArtifactLoadMode::NativePortable,
        )
        .unwrap();
    // Python persists contract dictionaries with sorted keys. This must keep
    // the native scope/campaign seals intact with serde_json/preserve_order.
    let mut wire = serde_json::to_value(&package).unwrap();
    wire.sort_all_objects();
    let package: PortablePredictorPackage = serde_json::from_value(wire).unwrap();
    methods_hpo_fold_state_from_package_json(&serde_json::to_string(&package).unwrap()).unwrap();
    let resumed = execute(8, Some(&package));
    assert_eq!(
        resumed.execution_bundle.metadata["methods_hpo_resumed_from_package_fingerprint"],
        serde_json::json!(package.package_fingerprint)
    );
    let fresh = execute(8, None);
    assert_eq!(resumed.selected_variant_id, fresh.selected_variant_id);
    assert_eq!(resumed.oof_averages, fresh.oof_averages);
    for (a, b) in resumed
        .methods_hpo_fold_state
        .as_ref()
        .unwrap()
        .outer_scopes
        .iter()
        .chain(std::iter::once(
            &resumed.methods_hpo_fold_state.as_ref().unwrap().refit_scope,
        ))
        .zip(
            fresh
                .methods_hpo_fold_state
                .as_ref()
                .unwrap()
                .outer_scopes
                .iter()
                .chain(std::iter::once(
                    &fresh.methods_hpo_fold_state.as_ref().unwrap().refit_scope,
                )),
        )
    {
        assert_eq!(a.resume_state.trial_history_len, 8);
        assert_eq!(a.winner_params, b.winner_params);
        assert_eq!(
            a.resume_state.completed_reports,
            b.resume_state.completed_reports
        );
        assert_eq!(a.resume_state.incumbent, b.resume_state.incumbent);
    }
    let mut swapped = package.clone();
    let state = swapped
        .execution_bundle
        .methods_hpo_fold_state
        .as_mut()
        .unwrap();
    let previous = state.outer_scopes[0].resume_state.clone();
    state.outer_scopes[0].resume_state = state.outer_scopes[1].resume_state.clone();
    state.outer_scopes[1].resume_state = previous;
    swapped.package_fingerprint = swapped.compute_fingerprint().unwrap();
    let error = methods_hpo_fold_state_from_package_json(&serde_json::to_string(&swapped).unwrap())
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("scope") || error.contains("provenance"),
        "{error}"
    );
}

#[cfg(feature = "methods-optimizer-local")]
#[test]
fn native_fold_hpo_explicit_folds_refuse_leak_group_drift_and_identity_collisions() {
    let mut fixture = native_fold_hpo_fixture(2);
    // The package roundtrip below models Python dict input and persistence.
    let mut wire = serde_json::to_value(&fixture.request).unwrap();
    wire.sort_all_objects();
    fixture.request = serde_json::from_value(wire).unwrap();
    rebuild(&mut fixture);
    let plan = fixture.request.project().unwrap().plan;
    let raw = &plan.campaign.metadata["methods_hpo_operation"];
    let inner: BTreeMap<FoldId, NestedFoldSet> =
        serde_json::from_value(raw["inner_fold_sets"].clone()).unwrap();
    let refit: FoldSet = serde_json::from_value(raw["refit_inner_fold_set"].clone()).unwrap();
    validate_methods_fold_hpo_folds(&plan, &inner, &refit).unwrap();
    let mut leaking = inner.clone();
    leaking
        .values_mut()
        .next()
        .unwrap()
        .inner_fold_set
        .sample_ids
        .push(sample("sample:1"));
    assert!(validate_methods_fold_hpo_folds(&plan, &leaking, &refit).is_err());
    let mut collision = inner.clone();
    let existing = collision.values().next().unwrap().inner_fold_set.folds[0]
        .fold_id
        .clone();
    collision.values_mut().nth(1).unwrap().inner_fold_set.folds[0].fold_id = existing;
    assert!(validate_methods_fold_hpo_folds(&plan, &collision, &refit).is_err());
    let mut grouped = plan.clone();
    let root = grouped.fold_set.as_mut().unwrap();
    root.sample_groups = root
        .sample_ids
        .iter()
        .enumerate()
        .map(|(i, id)| (id.clone(), GroupId::new(format!("group:{i}")).unwrap()))
        .collect();
    assert!(validate_methods_fold_hpo_folds(&grouped, &inner, &refit).is_err());
    let first = inner.values().next().unwrap();
    let scope_id = methods_fold_hpo_scope_id(
        raw["operation_id"].as_str().unwrap(),
        Some(&first.parent_outer_fold_id),
    );
    let scoped = methods_fold_hpo_study_plan(&plan, &scope_id, &first.inner_fold_set).unwrap();
    scoped.validate().unwrap();
    let mut wire = serde_json::to_value(&scoped).unwrap();
    wire.sort_all_objects();
    let restored: ExecutionPlan = serde_json::from_value(wire).unwrap();
    restored.validate().unwrap();
    assert_eq!(restored.campaign_fingerprint, scoped.campaign_fingerprint);
    assert_eq!(scoped.fold_set.as_ref(), Some(&first.inner_fold_set));
    assert_ne!(scoped.campaign_fingerprint, plan.campaign_fingerprint);
}

#[cfg(feature = "methods-optimizer-local")]
#[test]
fn native_pls_scale_ties_preserve_native_incumbent_and_resume_matches_full_budget() {
    let execute = |trials, resume: Option<&PortablePredictorPackage>| {
        let mut fixture = fixture(true, false);
        use_native_pls_phase_profile(&mut fixture, Some(trials));
        if let Some(package) = resume {
            methods_hpo_descriptor_mut(&mut fixture)["resume_package_json"] =
                serde_json::json!(serde_json::to_string(package).unwrap());
            rebuild(&mut fixture);
        }
        let mut store = InMemoryArtifactStore::new();
        run(
            &fixture,
            Arc::new(CallState::default()),
            &provider(&fixture),
            &mut store,
        )
        .unwrap()
    };
    let first = execute(2, None);
    let package = first
        .to_portable_predictor_package(
            "predictor:scale.resume",
            FittedArtifactMode::PortableRequired,
            ArtifactLoadMode::NativePortable,
        )
        .unwrap();
    let resumed = execute(6, Some(&package));
    let full = execute(6, None);
    for outcome in [&resumed, &full] {
        outcome.validate().unwrap();
        let state = outcome.methods_hpo_resume_state.as_ref().unwrap();
        state.validate().unwrap();
        assert_eq!(state.trial_history_len, 6);
        assert_eq!(state.completed_reports.len(), 6);
        assert!(
            state
                .completed_reports
                .iter()
                .filter(|report| report.score.to_bits() == state.incumbent.score.to_bits())
                .count()
                > 1
        );
        let native_best = state
            .completed_reports
            .iter()
            .find(|report| report.trial_id == state.incumbent.trial_id)
            .unwrap();
        assert_eq!(native_best.variant_id, state.incumbent.variant_id);
        assert_eq!(native_best.score.to_bits(), state.incumbent.score.to_bits());
        let selected = state
            .completed_reports
            .iter()
            .find(|report| report.variant_id == outcome.selected_variant_id)
            .unwrap();
        assert_eq!(selected.score.to_bits(), native_best.score.to_bits());
        TrainingOutcome::from_json(&serde_json::to_string(outcome).unwrap()).unwrap();
    }
    assert_eq!(resumed.selected_variant_id, full.selected_variant_id);
    assert_eq!(resumed.oof_averages, full.oof_averages);
    let resumed_state = resumed.methods_hpo_resume_state.as_ref().unwrap();
    let full_state = full.methods_hpo_resume_state.as_ref().unwrap();
    assert_eq!(resumed_state.incumbent, full_state.incumbent);
    let normalize_durations = |entries: &[MethodsHpoTerminalEvidence]| {
        let mut entries = entries.to_vec();
        for entry in &mut entries {
            assert!(entry.trial.duration.is_finite() && entry.trial.duration >= 0.0);
            entry.trial.duration = 0.0;
        }
        entries
    };
    assert_eq!(
        normalize_durations(&resumed_state.terminal_trials),
        normalize_durations(&full_state.terminal_trials)
    );
    assert_eq!(
        resumed_state.completed_reports,
        full_state.completed_reports
    );
}

fn provider(fixture: &Fixture) -> AttestedProvider {
    AttestedProvider {
        identity: Some(fixture.request.data_identities[0].clone()),
        relations: fixture.relations.clone(),
        contradictory_relations: None,
        omit_relations: false,
        next_handle: AtomicU64::new(0),
        methods_pls_enabled: fixture.request.controller_manifests.iter().any(|manifest| {
            manifest.controller_id.as_str() == METHODS_PLS_CONTROLLER_ID
                || manifest.controller_id.as_str() == "controller:methods.native.regression"
        }),
        methods_rows: BTreeMap::from([
            (SampleId::new("sample:1").unwrap(), [1.0, 1.0, 2.0, 2.0]),
            (SampleId::new("sample:2").unwrap(), [2.0, 4.0, -1.0, 1.0]),
            (SampleId::new("sample:3").unwrap(), [3.0, 9.0, 2.0, -2.0]),
            (SampleId::new("sample:4").unwrap(), [4.0, 16.0, -1.0, -7.0]),
            (
                SampleId::new("sample:5").unwrap(),
                [5.0, 25.0, -14.0, -14.0],
            ),
            (SampleId::new("sample:6").unwrap(), [6.0, 36.0, 23.0, -23.0]),
            (
                SampleId::new("sample:7").unwrap(),
                [7.0, 49.0, -14.0, -34.0],
            ),
            (SampleId::new("sample:8").unwrap(), [8.0, 64.0, 23.0, -47.0]),
        ]),
        methods_pls_feature_count: 2,
        methods_hpo_oof_target_offsets: BTreeMap::new(),
        fail_methods_hpo_trial_id: None,
    }
}

#[cfg(feature = "methods-optimizer-local")]
fn target_free_methods_provider(
    fixture: &Fixture,
    source: &TrainingOutcome,
    mut envelopes: BTreeMap<String, ExternalDataPlanEnvelope>,
) -> MethodsPlsPredictDataProvider {
    let source_provider = provider(fixture);
    let binding = source
        .effective_plan
        .node_plans
        .values()
        .find(|node| node.controller_id.as_str() == METHODS_PLS_CONTROLLER_ID)
        .and_then(|node| {
            node.data_bindings
                .iter()
                .find(|binding| binding.input_name == "x")
        })
        .expect("Methods PLS source plan has an x data binding")
        .clone();
    let key = data_binding_requirement_key(&binding.node_id, &binding.input_name);
    let sample_ids = source_provider
        .methods_rows
        .keys()
        .cloned()
        .collect::<Vec<_>>();
    let values = sample_ids
        .iter()
        .flat_map(|sample_id| {
            source_provider.methods_rows[sample_id][..source_provider.methods_pls_feature_count]
                .iter()
                .copied()
        })
        .collect::<Vec<_>>();
    let mut bindings = source
        .effective_plan
        .node_plans
        .values()
        .flat_map(|node| node.data_bindings.iter().cloned())
        .collect::<Vec<_>>();
    for binding in &mut bindings {
        let binding_key = data_binding_requirement_key(&binding.node_id, &binding.input_name);
        binding.relation_fingerprint = envelopes
            .get(&binding_key)
            .expect("replay envelope exactly covers effective-plan bindings")
            .relation_fingerprint
            .clone();
    }
    let dataset = MethodsPlsDataset {
        y_validity_masks: None,
        x: MethodsPlsMatrix {
            rows: sample_ids.len(),
            cols: source_provider.methods_pls_feature_count,
            values,
        },
        sample_ids,
        y: None,
        target_names: vec!["protein".to_string()],
    };
    let data_content_fingerprint = methods_pls_predict_feature_content_fingerprint(&dataset.x)
        .expect("target-free Methods PLS rows have a canonical content fingerprint");
    envelopes
        .get_mut(&key)
        .expect("target-free replay envelope covers the Methods x binding")
        .data_content_fingerprint = Some(data_content_fingerprint.clone());
    MethodsPlsPredictDataProvider::new(
        ControllerId::new("controller:data.provider").unwrap(),
        bindings,
        envelopes,
        BTreeMap::from([(
            key,
            MethodsPlsPredictInput {
                data_content_profile: METHODS_PLS_PREDICT_CONTENT_PROFILE.to_string(),
                data_content_fingerprint,
                dataset,
            },
        )]),
    )
    .expect("target-free Methods provider must bind its exact PREDICT cohort")
}

fn replay_envelopes_with_relation(
    outcome: &TrainingOutcome,
    relation_fingerprint: &str,
) -> BTreeMap<String, ExternalDataPlanEnvelope> {
    outcome
        .execution_bundle
        .data_requirements
        .iter()
        .map(|requirement| {
            let key = requirement.key();
            (
                key.clone(),
                ExternalDataPlanEnvelope {
                    schema_version: EXTERNAL_DATA_PLAN_ENVELOPE_SCHEMA_VERSION,
                    schema_fingerprint: requirement.schema_fingerprint.clone(),
                    plan_fingerprint: requirement.plan_fingerprint.clone(),
                    relation_fingerprint: Some(relation_fingerprint.to_string()),
                    data_content_fingerprint: Some(content_hash(&format!("{key}:data"))),
                    target_content_fingerprint: Some(content_hash(&format!("{key}:target"))),
                    coordinator_relations: Some(relations()),
                    predict_cohort: None,
                },
            )
        })
        .collect()
}

fn replay_envelopes_with_relations(
    outcome: &TrainingOutcome,
    relations: &SampleRelationSet,
) -> BTreeMap<String, ExternalDataPlanEnvelope> {
    let relation_fingerprint = relations.fingerprint().unwrap();
    outcome
        .execution_bundle
        .data_requirements
        .iter()
        .map(|requirement| {
            let key = requirement.key();
            (
                key.clone(),
                ExternalDataPlanEnvelope {
                    schema_version: EXTERNAL_DATA_PLAN_ENVELOPE_SCHEMA_VERSION,
                    schema_fingerprint: requirement.schema_fingerprint.clone(),
                    plan_fingerprint: requirement.plan_fingerprint.clone(),
                    relation_fingerprint: Some(relation_fingerprint.clone()),
                    data_content_fingerprint: Some(content_hash(&format!("{key}:data"))),
                    target_content_fingerprint: Some(content_hash(&format!("{key}:target"))),
                    coordinator_relations: Some(relations.clone()),
                    predict_cohort: None,
                },
            )
        })
        .collect()
}

fn calibration_relations(sample_ids: &[SampleId]) -> SampleRelationSet {
    SampleRelationSet {
        records: sample_ids
            .iter()
            .enumerate()
            .map(|(index, sample_id)| {
                let mut relation = SampleRelation::new(
                    ObservationId::new(format!("observation:calibration:{}", index + 1)).unwrap(),
                    sample_id.clone(),
                );
                relation.origin_sample_id =
                    Some(sample(&format!("origin:calibration:{}", index + 1)));
                relation
            })
            .collect(),
    }
}

fn calibration_context(
    source: &TrainingOutcome,
    replay: &TrainingReplayOutcome,
    relations: &SampleRelationSet,
) -> ConformalCalibrationContext {
    let output = &replay.outputs[0];
    let point = &output.predictions[0];
    let physical = point.sample_ids.iter().collect::<BTreeSet<_>>();
    let origin_sample_ids = relations
        .records
        .iter()
        .filter(|relation| physical.contains(&relation.sample_id))
        .filter_map(|relation| relation.origin_sample_id.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let mut cohort = ConformalCalibrationCohort {
        role: "calibration".to_string(),
        physical_sample_ids: point.sample_ids.clone(),
        origin_sample_ids,
        target_names: output.binding.target_names.clone(),
        manifest_fingerprint: String::new(),
    };
    cohort.manifest_fingerprint = cohort.compute_fingerprint().unwrap();
    let mut context = ConformalCalibrationContext {
        predictor_binding_fingerprint: output.binding.binding_fingerprint.clone(),
        source_training_outcome_fingerprint: source.outcome_fingerprint.clone(),
        calibration_replay_outcome_fingerprint: replay.outcome_fingerprint.clone(),
        data_identities_fingerprint: source.data_identities_fingerprint().unwrap(),
        fold_set_fingerprint: dag_ml_core::fold::fold_set_fingerprint(
            source.effective_plan.fold_set.as_ref().unwrap(),
        )
        .unwrap(),
        training_influence_fingerprint: source.training_influence.manifest_fingerprint.clone(),
        relation_fingerprint: relations.fingerprint().unwrap(),
        calibration_cohort: cohort,
        context_fingerprint: String::new(),
    };
    context.context_fingerprint = context.compute_fingerprint().unwrap();
    context
}

fn replay_request(outcome: &TrainingOutcome, phase: Phase) -> TrainingReplayRequest {
    let mut data_envelope_keys = outcome
        .execution_bundle
        .data_requirements
        .iter()
        .map(|requirement| requirement.key())
        .collect::<Vec<_>>();
    data_envelope_keys.sort();
    let mut output_binding_ids = outcome
        .outputs
        .iter()
        .map(|output| output.binding.binding_id.clone())
        .collect::<Vec<_>>();
    output_binding_ids.sort();
    let mut request = TrainingReplayRequest {
        schema_version: TRAINING_REPLAY_REQUEST_SCHEMA_VERSION,
        request_id: format!("replay:attached.{}", phase.as_str().to_ascii_lowercase()),
        source_outcome_fingerprint: outcome.outcome_fingerprint.clone(),
        phase,
        data_envelope_keys,
        output_binding_ids,
        request_fingerprint: "0".repeat(64),
    };
    request.request_fingerprint = request.compute_fingerprint().unwrap();
    request
}

fn add_model_probability_port(fixture: &mut Fixture) {
    let mut extra = fixture
        .request
        .graph
        .nodes
        .iter()
        .find(|node| node.id.as_str() == "model:base")
        .unwrap()
        .ports
        .outputs[0]
        .clone();
    extra.name = "probability".to_string();
    fixture
        .request
        .graph
        .nodes
        .iter_mut()
        .find(|node| node.id.as_str() == "model:base")
        .unwrap()
        .ports
        .outputs
        .push(extra.clone());
    fixture
        .request
        .controller_manifests
        .iter_mut()
        .find(|manifest| manifest.controller_id.as_str() == "controller:model.mock")
        .unwrap()
        .output_ports
        .push(extra);
    fixture.request.options.outputs[0].port_name = Some("oof".to_string());
    rebuild(fixture);
}

fn add_explain_support(fixture: &mut Fixture) {
    for manifest in &mut fixture.request.controller_manifests {
        manifest.supported_phases.insert(Phase::Explain);
    }
    rebuild(fixture);
}

fn content_hash(value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn assert_preflight_rejected(mut fixture: Fixture, mutate: impl FnOnce(&mut TrainingRequest)) {
    mutate(&mut fixture.request);
    resign_request(&mut fixture.request);
    let state = Arc::new(CallState::default());
    let mut store = InMemoryArtifactStore::new();
    assert!(run(&fixture, state.clone(), &provider(&fixture), &mut store).is_err());
    assert_eq!(state.total(), 0);
    assert!(store.is_empty());
}

fn early_stopping_requirements() -> Vec<ControllerInfluenceRequirement> {
    vec![
        ControllerInfluenceRequirement {
            node_id: node("model:base"),
            kind: TrainingInfluenceKind::EarlyStopping,
            scope_id: "early:fold:0".to_string(),
            phase: Phase::FitCv,
            fold_id: Some(FoldId::new("fold:0").unwrap()),
            physical_sample_ids: vec![sample("sample:3")],
        },
        ControllerInfluenceRequirement {
            node_id: node("model:base"),
            kind: TrainingInfluenceKind::EarlyStopping,
            scope_id: "early:fold:1".to_string(),
            phase: Phase::FitCv,
            fold_id: Some(FoldId::new("fold:1").unwrap()),
            physical_sample_ids: vec![sample("sample:1")],
        },
        ControllerInfluenceRequirement {
            node_id: node("model:base"),
            kind: TrainingInfluenceKind::EarlyStopping,
            scope_id: "early:refit".to_string(),
            phase: Phase::Refit,
            fold_id: None,
            physical_sample_ids: vec![sample("sample:1")],
        },
    ]
}

fn full_scope_requirements(
    kind: TrainingInfluenceKind,
    prefix: &str,
) -> Vec<ControllerInfluenceRequirement> {
    vec![
        ControllerInfluenceRequirement {
            node_id: node("model:base"),
            kind,
            scope_id: format!("{prefix}:fold:0"),
            phase: Phase::FitCv,
            fold_id: Some(FoldId::new("fold:0").unwrap()),
            physical_sample_ids: vec![sample("sample:3"), sample("sample:4")],
        },
        ControllerInfluenceRequirement {
            node_id: node("model:base"),
            kind,
            scope_id: format!("{prefix}:fold:1"),
            phase: Phase::FitCv,
            fold_id: Some(FoldId::new("fold:1").unwrap()),
            physical_sample_ids: vec![sample("sample:1"), sample("sample:2")],
        },
        ControllerInfluenceRequirement {
            node_id: node("model:base"),
            kind,
            scope_id: format!("{prefix}:refit"),
            phase: Phase::Refit,
            fold_id: None,
            physical_sample_ids: (1..=4)
                .map(|index| sample(&format!("sample:{index}")))
                .collect(),
        },
    ]
}

fn relations() -> SampleRelationSet {
    SampleRelationSet {
        records: (1..=4)
            .map(|index| {
                let mut relation = SampleRelation::new(
                    ObservationId::new(format!("observation:{index}")).unwrap(),
                    sample(&format!("sample:{index}")),
                );
                relation.group_id =
                    Some(GroupId::new(if index <= 2 { "group:0" } else { "group:1" }).unwrap());
                relation
            })
            .collect(),
    }
}

fn influence_manifest(
    request: &TrainingRequest,
    projection: &TrainingContractProjection,
    relations: &SampleRelationSet,
) -> TrainingInfluenceManifest {
    TrainingInfluenceManifest::derive_for_projection(projection, request, relations).unwrap()
}

fn resign_request(request: &mut TrainingRequest) {
    request.request_fingerprint = "0".repeat(64);
    request.request_fingerprint = request.compute_fingerprint().unwrap();
}

fn rebuild(fixture: &mut Fixture) {
    fixture
        .request
        .controller_manifests
        .sort_by(|left, right| left.controller_id.cmp(&right.controller_id));
    resign_request(&mut fixture.request);
    let projection = fixture.request.project().unwrap();
    fixture.preferred = projection.plan.variants[0].variant_id.clone();
    fixture.influence = influence_manifest(&fixture.request, &projection, &fixture.relations);
}

fn resign_outcome(outcome: &mut TrainingOutcome) {
    let plan_json = serde_json::to_string(&outcome.effective_plan).unwrap();
    outcome.effective_plan_fingerprint =
        parse_typed_json(&plan_json).unwrap().fingerprint().unwrap();
    outcome.outcome_fingerprint = "0".repeat(64);
    outcome.outcome_fingerprint = outcome.compute_fingerprint().unwrap();
}

fn resign_runtime_calibration(calibration: &mut ConformalCalibration) {
    calibration.context.context_fingerprint = "0".repeat(64);
    calibration.context.context_fingerprint = calibration.context.compute_fingerprint().unwrap();
    calibration.calibration_fingerprint = "0".repeat(64);
    calibration.calibration_fingerprint = calibration.compute_fingerprint().unwrap();
}

fn resign_package(package: &mut PortablePredictorPackage) {
    package.training_outcome.execution_bundle_fingerprint =
        parse_typed_json(&serde_json::to_string(&package.execution_bundle).unwrap())
            .unwrap()
            .fingerprint()
            .unwrap();
    package.package_fingerprint = "0".repeat(64);
    package.package_fingerprint = package.compute_fingerprint().unwrap();
}

fn resign_replay_outcome(outcome: &mut TrainingReplayOutcome) {
    outcome.outcome_fingerprint = "0".repeat(64);
    outcome.outcome_fingerprint = outcome.compute_fingerprint().unwrap();
}

fn rewrite_replay_relation_fingerprint(
    replay: &mut TrainingReplayOutcome,
    relation_fingerprint: &str,
) {
    for identity in &mut replay.input_data_identities {
        identity.relation_fingerprint = relation_fingerprint.to_string();
        identity.identity_fingerprint = "0".repeat(64);
        identity.identity_fingerprint = identity.compute_fingerprint().unwrap();
    }
    resign_replay_outcome(replay);
}

fn resign_outcome_conformal_closure(outcome: &mut TrainingOutcome) {
    let replay_fingerprint = outcome
        .conformal_calibration_replay
        .as_ref()
        .unwrap()
        .outcome_fingerprint
        .clone();
    let calibration = outcome.conformal_calibration.as_mut().unwrap();
    calibration.context.calibration_replay_outcome_fingerprint = replay_fingerprint;
    resign_runtime_calibration(calibration);
    outcome.execution_bundle.conformal_calibration = Some(calibration.reference().unwrap());
    resign_outcome(outcome);
}

fn resign_package_conformal_closure(package: &mut PortablePredictorPackage) {
    let replay_fingerprint = package
        .conformal_calibration_replay
        .as_ref()
        .unwrap()
        .outcome_fingerprint
        .clone();
    let calibration = package.conformal_calibration.as_mut().unwrap();
    calibration.context.calibration_replay_outcome_fingerprint = replay_fingerprint;
    resign_runtime_calibration(calibration);
    package.execution_bundle.conformal_calibration = Some(calibration.reference().unwrap());
    resign_package(package);
}

fn legacy_serde_fingerprint(value: &impl serde::Serialize) -> String {
    let digest = Sha256::digest(serde_json::to_vec(value).unwrap());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(dag_ml_workspace_contract_fixtures)]
fn typed_fingerprint(value: &impl serde::Serialize) -> String {
    let json = serde_json::to_string(value).unwrap();
    parse_typed_json(&json).unwrap().fingerprint().unwrap()
}

fn sample(value: &str) -> SampleId {
    SampleId::new(value).unwrap()
}

#[cfg(feature = "methods-optimizer-local")]
fn first_json_difference(
    path: &str,
    left: &serde_json::Value,
    right: &serde_json::Value,
) -> Option<String> {
    match (left, right) {
        (serde_json::Value::Object(left), serde_json::Value::Object(right)) => left
            .keys()
            .chain(right.keys())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .find_map(|key| match (left.get(key), right.get(key)) {
                (Some(left), Some(right)) => {
                    first_json_difference(&format!("{path}.{key}"), left, right)
                }
                _ => Some(format!("{path}.{key}: missing on one side")),
            }),
        (serde_json::Value::Array(left), serde_json::Value::Array(right)) => {
            if left.len() != right.len() {
                return Some(format!(
                    "{path}: array length {} != {}",
                    left.len(),
                    right.len()
                ));
            }
            left.iter()
                .zip(right)
                .enumerate()
                .find_map(|(index, (left, right))| {
                    first_json_difference(&format!("{path}[{index}]"), left, right)
                })
        }
        _ if left == right => None,
        _ => Some(format!("{path}: {left} != {right}")),
    }
}

#[cfg(feature = "methods-optimizer-local")]
fn first_tcv_difference(
    path: &str,
    left: &dag_ml_core::canonical::TypedCanonicalValue,
    right: &dag_ml_core::canonical::TypedCanonicalValue,
) -> Option<String> {
    use dag_ml_core::canonical::TypedCanonicalValue;

    match (left, right) {
        (TypedCanonicalValue::Array(left), TypedCanonicalValue::Array(right)) => left
            .iter()
            .zip(right)
            .enumerate()
            .find_map(|(index, (left, right))| {
                first_tcv_difference(&format!("{path}[{index}]"), left, right)
            })
            .or_else(|| {
                (left.len() != right.len())
                    .then(|| format!("{path}: array length {} != {}", left.len(), right.len()))
            }),
        (TypedCanonicalValue::Object(left), TypedCanonicalValue::Object(right)) => {
            let keys = left
                .iter()
                .chain(right)
                .map(|(key, _)| key.as_str())
                .collect::<BTreeSet<_>>();
            keys.into_iter().find_map(|key| {
                let left = left
                    .iter()
                    .find(|(candidate, _)| candidate == key)
                    .map(|(_, value)| value);
                let right = right
                    .iter()
                    .find(|(candidate, _)| candidate == key)
                    .map(|(_, value)| value);
                match (left, right) {
                    (Some(left), Some(right)) => {
                        first_tcv_difference(&format!("{path}.{key}"), left, right)
                    }
                    _ => Some(format!("{path}.{key}: missing on one side")),
                }
            })
        }
        _ if left == right => None,
        _ => Some(format!("{path}: {left:?} != {right:?}")),
    }
}

fn node(value: &str) -> NodeId {
    NodeId::new(value).unwrap()
}

/// A generic host-owned RAW artifact, deliberately not a built-in Methods kind.
struct RawTrainingController {
    inner: TrainingController,
    export: Option<Vec<u8>>,
}

impl RuntimeController for RawTrainingController {
    fn controller_id(&self) -> &ControllerId {
        self.inner.controller_id()
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        let mut result = self.inner.invoke(task)?;
        for artifact in &mut result.artifacts {
            artifact.backend = Some(ArtifactBackend::Raw);
            artifact.content_fingerprint = Some(format!("{:x}", Sha256::digest(b"raw-test")));
            artifact.uri = Some("artifacts/generic-test.bin".into());
            artifact.size_bytes = Some(8);
        }
        result.lineage.artifact_refs = result.artifacts.clone();
        Ok(result)
    }

    fn export_artifact_payload(&self, _id: &ArtifactId) -> Result<Option<Vec<u8>>> {
        Ok(self.export.clone())
    }
}

#[test]
fn generic_raw_training_exports_and_validates_payloads_without_methods_feature() {
    for (export, succeeds) in [
        (Some(b"raw-test".to_vec()), true),
        (None, false),
        (Some(b"tampered".to_vec()), false),
    ] {
        let fixture = fixture(true, false);
        let state = Arc::new(CallState::default());
        *state.preferred.lock().unwrap() = Some(fixture.preferred.clone());
        let mut controllers = controllers(&fixture, state.clone(), false);
        controllers
            .register(Box::new(RawTrainingController {
                inner: TrainingController {
                    id: ControllerId::new("controller:model.mock").unwrap(),
                    state,
                    emits_predictions: true,
                    emits_artifact: true,
                    prediction_name: "protein".into(),
                },
                export,
            }))
            .unwrap();
        let provider = provider(&fixture);
        let mut store = InMemoryArtifactStore::new();
        let result = execute_training(TrainingExecutionInput {
            request: &fixture.request,
            outcome_id: "outcome:raw.generic".into(),
            run_id: RunId::new("run:raw.generic").unwrap(),
            bundle_id: BundleId::new("bundle:raw.generic").unwrap(),
            controllers: &controllers,
            data_provider: &provider,
            relations: &fixture.relations,
            training_influence: &fixture.influence,
            artifact_store: &mut store,
            warnings: Vec::new(),
            diagnostics: BTreeMap::new(),
        });
        if succeeds {
            let outcome = result.unwrap();
            outcome.validate().unwrap();
            assert_eq!(outcome.execution_bundle.raw_artifact_payloads.len(), 1);
            assert_eq!(
                outcome
                    .execution_bundle
                    .raw_artifact_payloads
                    .values()
                    .next()
                    .unwrap(),
                b"raw-test"
            );
            outcome
                .to_portable_predictor_package(
                    "package:raw.generic",
                    FittedArtifactMode::PortableRequired,
                    ArtifactLoadMode::NativePortable,
                )
                .unwrap();
        } else {
            assert!(result.is_err());
            assert!(
                store.is_empty(),
                "failed payload transfer must not publish fitted artifacts"
            );
        }
    }
}

#[test]
fn singleton_training_retains_one_cv_execution_per_fold_and_exports_complete_state() {
    for refit in [false, true] {
        for scheduler_kind in [
            TrainingSchedulerKind::Sequential,
            TrainingSchedulerKind::Parallel,
        ] {
            let mut fixture = fixture(refit, true);
            for dimension in &mut fixture.request.campaign.generation.dimensions {
                dimension.choices.truncate(1);
            }
            fixture.request.campaign.generation.max_variants = Some(1);
            fixture.request.options.scheduler.kind = scheduler_kind;
            fixture.request.options.scheduler.backend = (scheduler_kind
                == TrainingSchedulerKind::Parallel)
                .then_some(TrainingSchedulerBackend::Threads);
            fixture.request.options.scheduler.workers =
                if scheduler_kind == TrainingSchedulerKind::Parallel {
                    2
                } else {
                    1
                };
            fixture.request.options.resources.cpu_threads =
                fixture.request.options.scheduler.workers;
            rebuild(&mut fixture);
            assert_eq!(fixture.request.project().unwrap().plan.variants.len(), 1);
            let state = Arc::new(CallState::default());
            // A second execution would emit different scores and fail the
            // existing retained-report guard, as well as the exact call counts.
            *state.divergent_rerun.lock().unwrap() = true;
            *state.score_auxiliary.lock().unwrap() = true;
            let mut store = InMemoryArtifactStore::new();
            let outcome = run(&fixture, state.clone(), &provider(&fixture), &mut store).unwrap();
            outcome.validate().unwrap();
            let calls = state.scoped_calls.lock().unwrap();
            assert!(outcome.variant_oof_averages.is_empty());
            assert!(serde_json::to_value(&outcome)
                .unwrap()
                .get("variant_oof_averages")
                .is_none());
            for producer in [node("transform:snv"), node("model:base")] {
                for fold in ["fold:0", "fold:1"] {
                    let fold_id = FoldId::new(fold).unwrap();
                    assert_eq!(
                        calls
                            .iter()
                            .filter(|(phase, node_id, actual_fold)| {
                                *phase == Phase::FitCv
                                    && *node_id == producer
                                    && actual_fold.as_ref() == Some(&fold_id)
                            })
                            .count(),
                        1
                    );
                }
                assert_eq!(
                    state.count(Phase::Refit, producer.as_str()),
                    usize::from(refit)
                );
                for fold in ["avg", "w_avg"] {
                    assert_eq!(
                        outcome
                            .oof_averages
                            .iter()
                            .filter(|average| {
                                average.predictions.producer_node == producer
                                    && average.predictions.fold_id.as_ref().unwrap().as_str()
                                        == fold
                            })
                            .count(),
                        1
                    );
                }
            }
            assert_eq!(calls.len(), 4 + 2 * usize::from(refit));
            assert_eq!(outcome.lineage.len(), calls.len());
            assert_eq!(outcome.selected_variant_id, fixture.preferred);
            assert_eq!(outcome.execution_bundle.selections.len(), 1);
            assert_eq!(outcome.data_identities, fixture.request.data_identities);
            assert_eq!(outcome.training_influence, fixture.influence);
            assert_eq!(
                outcome.execution_bundle.scores.as_ref(),
                Some(&outcome.score_set)
            );
            let report_scopes = outcome
                .score_set
                .reports
                .iter()
                .map(|report| {
                    (
                        report.producer_node.clone(),
                        report.producer_port.clone(),
                        report.partition.clone(),
                        report.fold_id.clone(),
                        report.variant_id.clone(),
                        report.level,
                    )
                })
                .collect::<BTreeSet<_>>();
            assert_eq!(report_scopes.len(), outcome.score_set.reports.len());
            assert_eq!(outcome.execution_bundle.prediction_caches.len(), 1);
            let caches = outcome.portable_prediction_caches.as_ref().unwrap();
            caches
                .validate_against_bundle(&outcome.execution_bundle)
                .unwrap();
            assert_eq!(caches.caches.len(), 1);
            validate_prediction_cache_payload_matches_record(
                &caches.caches[0],
                &outcome.execution_bundle.prediction_caches[0],
            )
            .unwrap();
            assert_eq!(store.len(), usize::from(refit));
            assert_eq!(
                outcome.execution_bundle.refit_artifacts.len(),
                usize::from(refit)
            );
            if refit {
                let package = outcome
                    .to_portable_predictor_package(
                        "predictor:singleton.retained",
                        FittedArtifactMode::AllowHostSidecar,
                        ArtifactLoadMode::HostSidecar,
                    )
                    .unwrap();
                package.validate().unwrap();
                assert_eq!(package.artifact_bindings.len(), 1);
                assert_eq!(package.output_bindings[0], outcome.outputs[0].binding);
                PortablePredictorPackage::from_json(&serde_json::to_string(&package).unwrap())
                    .unwrap();
            }
            assert_eq!(
                TrainingOutcome::from_json(&serde_json::to_string(&outcome).unwrap()).unwrap(),
                outcome
            );
        }
    }
}

#[test]
fn native_training_refit_and_no_refit_are_deterministic_and_auditable() {
    let refit = fixture(true, false);
    let state = Arc::new(CallState::default());
    let mut store = InMemoryArtifactStore::new();
    let outcome = run(&refit, state.clone(), &provider(&refit), &mut store).unwrap();
    outcome.validate().unwrap();
    let reference = outcome.to_reference().unwrap();
    assert_eq!(
        reference.training_request_fingerprint,
        refit.request.request_fingerprint
    );
    assert_eq!(
        reference.data_identities_fingerprint,
        outcome.data_identities_fingerprint().unwrap()
    );
    assert_eq!(
        reference.execution_bundle_fingerprint,
        outcome.execution_bundle_fingerprint().unwrap()
    );
    assert_eq!(outcome.refit.status, TrainingRefitStatus::Completed);
    assert!(!outcome.oof_averages.is_empty());
    assert!(outcome.oof_averages.iter().any(|average| average
        .predictions
        .fold_id
        .as_ref()
        .unwrap()
        .as_str()
        == "avg"));
    assert!(outcome.oof_averages.iter().any(|average| average
        .predictions
        .fold_id
        .as_ref()
        .unwrap()
        .as_str()
        == "w_avg"));
    for average in &outcome.oof_averages {
        assert_eq!(
            average.predictions.partition,
            PredictionPartition::Validation
        );
        assert!(matches!(
            average.predictions.fold_id.as_ref().unwrap().as_str(),
            "avg" | "w_avg"
        ));
        assert_eq!(average.predictions.unit_ids, average.y_true.unit_ids);
        assert_eq!(
            average.predictions.values.len(),
            average.y_true.values.len()
        );
    }
    let json = serde_json::to_string(&outcome).unwrap();
    assert_eq!(TrainingOutcome::from_json(&json).unwrap(), outcome);
    assert_eq!(outcome.variant_oof_averages.len(), 1);
    let loser = &outcome.variant_oof_averages[0];
    assert_ne!(loser.variant_id, outcome.selected_variant_id);
    assert!(loser.oof_averages.iter().any(|average| average
        .predictions
        .fold_id
        .as_ref()
        .unwrap()
        .as_str()
        == "avg"));
    assert!(loser.oof_averages.iter().any(|average| average
        .predictions
        .fold_id
        .as_ref()
        .unwrap()
        .as_str()
        == "w_avg"));
    assert_ne!(loser.oof_averages, outcome.oof_averages);
    let mut forged_loser = outcome.clone();
    forged_loser.variant_oof_averages[0].oof_averages[0]
        .predictions
        .values[0][0] += 1.0;
    resign_outcome(&mut forged_loser);
    assert!(forged_loser.validate().is_err());
    let mut aliased_loser = outcome.clone();
    aliased_loser.variant_oof_averages[0].variant_id = outcome.selected_variant_id.clone();
    resign_outcome(&mut aliased_loser);
    assert!(aliased_loser.validate().is_err());
    let mut duplicate_loser = outcome.clone();
    duplicate_loser.variant_oof_averages.push(loser.clone());
    resign_outcome(&mut duplicate_loser);
    assert!(duplicate_loser.validate().is_err());
    let mut foreign_loser = outcome.clone();
    foreign_loser.variant_oof_averages[0].variant_id = VariantId::new("variant:foreign").unwrap();
    resign_outcome(&mut foreign_loser);
    assert!(foreign_loser.validate().is_err());
    let mut forged_average = outcome.clone();
    forged_average.oof_averages[0].predictions.values[0][0] += 1.0;
    resign_outcome(&mut forged_average);
    assert!(forged_average
        .validate()
        .unwrap_err()
        .to_string()
        .contains("OOF average values disagree with selected score report"));
    // A completed refit whose closure supports PREDICT (but not EXPLAIN) and whose
    // only state-retaining node (model:base) has its retained artifact advertises
    // exactly [PREDICT] and never re-advertises REFIT.
    assert_eq!(outcome.replayable_phases, vec![Phase::Predict]);
    assert_eq!(
        outcome.outputs[0].binding.prediction_source,
        PredictionSource::FinalRefit
    );
    assert_eq!(outcome.execution_bundle.selections.len(), 1);
    assert_eq!(outcome.execution_bundle.refit_artifacts.len(), 1);
    assert_eq!(store.len(), 1);
    assert_eq!(state.count(Phase::FitCv, "model:base"), 6);
    assert_eq!(state.count(Phase::FitCv, "transform:snv"), 6);
    assert_eq!(state.count(Phase::Refit, "model:base"), 1);
    assert_eq!(state.count(Phase::Refit, "transform:snv"), 1);
    assert_eq!(outcome.parameter_patches.len(), 1);
    assert_eq!(
        outcome.effective_plan.node_plans[&node("model:base")].params["n_estimators"],
        outcome.parameter_patches[0].value
    );

    let no_refit = fixture(false, false);
    let no_refit_state = Arc::new(CallState::default());
    let mut no_refit_store = InMemoryArtifactStore::new();
    let first = run(
        &no_refit,
        no_refit_state.clone(),
        &provider(&no_refit),
        &mut no_refit_store,
    )
    .unwrap();
    let mut second_store = InMemoryArtifactStore::new();
    let second = run(
        &no_refit,
        Arc::new(CallState::default()),
        &provider(&no_refit),
        &mut second_store,
    )
    .unwrap();
    assert_eq!(first, second);
    assert_eq!(first.refit.status, TrainingRefitStatus::Skipped);
    assert_eq!(
        first.outputs[0].binding.prediction_source,
        PredictionSource::CvEnsemble
    );
    assert_eq!(first.replayable_phases, vec![Phase::Refit]);
    assert!(no_refit_store.is_empty());
    assert_eq!(no_refit_state.count(Phase::Refit, "model:base"), 0);
}

#[cfg(not(feature = "methods-optimizer"))]
#[test]
fn native_methods_hpo_fails_closed_without_the_local_methods_overlay() {
    let mut fixture = fixture(true, false);
    add_portable_methods_hpo(&mut fixture);
    let state = Arc::new(CallState::default());
    let mut store = InMemoryArtifactStore::new();

    let error = run(&fixture, state.clone(), &provider(&fixture), &mut store).unwrap_err();

    assert!(
        error
            .to_string()
            .contains("Methods optimizer support is disabled"),
        "unexpected error: {error}"
    );
    assert_eq!(
        state.total(),
        0,
        "HPO preflight must precede task execution"
    );
    assert!(store.is_empty());
}

#[cfg(not(feature = "methods-optimizer-local"))]
#[test]
fn native_methods_hpo_refuses_a_non_v1_search_space_before_overlay_preflight() {
    let mut fixture = fixture(true, false);
    add_portable_methods_hpo(&mut fixture);
    let descriptor = methods_hpo_descriptor_mut(&mut fixture);
    descriptor["study"]["search_space"]["parameters"][0]["high"] = serde_json::json!(2);
    rebuild(&mut fixture);
    let state = Arc::new(CallState::default());
    let mut store = InMemoryArtifactStore::new();

    let error = run(&fixture, state.clone(), &provider(&fixture), &mut store).unwrap_err();

    assert!(
        error
            .to_string()
            .contains("active `n_components` integer bounds 1..=3"),
        "unexpected error: {error}"
    );
    assert_eq!(state.total(), 0);
    assert!(store.is_empty());
}

#[cfg(not(feature = "methods-optimizer-local"))]
#[test]
fn native_methods_hpo_refuses_legacy_free_resume_fields() {
    let mut fixture = fixture(true, false);
    add_portable_methods_hpo(&mut fixture);
    let descriptor = methods_hpo_descriptor_mut(&mut fixture)
        .as_object_mut()
        .unwrap();
    descriptor.insert("resume_checkpoint".to_string(), serde_json::Value::Null);
    rebuild(&mut fixture);
    let state = Arc::new(CallState::default());
    let mut store = InMemoryArtifactStore::new();

    let error = run(&fixture, state.clone(), &provider(&fixture), &mut store).unwrap_err();

    assert!(
        error
            .to_string()
            .contains("unknown field `resume_checkpoint`"),
        "unexpected error: {error}"
    );
    assert_eq!(state.total(), 0);
    assert!(store.is_empty());
}

#[cfg(feature = "methods-optimizer-local")]
fn provider_with_declared_hpo_failure(fixture: &Fixture) -> AttestedProvider {
    let mut data = provider(fixture);
    // ABI 2.20 represents unresolved PLS components explicitly instead of
    // rejecting n_components=3 on this two-feature fixture. Retain the intended
    // failed-trial witness through an actual provider refusal, with unchanged
    // labels, native predictions and scoring. Do not manufacture score offsets.
    data.fail_methods_hpo_trial_id = Some(1);
    data
}

#[cfg(feature = "methods-optimizer-local")]
#[test]
fn native_methods_hpo_v1_equal_scores_remain_refused_before_refit() {
    let mut fixture = fixture(true, false);
    add_portable_methods_hpo(&mut fixture);
    let state = Arc::new(CallState::default());
    let mut store = InMemoryArtifactStore::new();
    let error = run(&fixture, state.clone(), &provider(&fixture), &mut store).unwrap_err();
    assert!(
        error.to_string().contains("incumbent score is tied"),
        "{error}"
    );
    assert_eq!(state.count(Phase::Refit, "transform:snv"), 0);
}

#[cfg(feature = "methods-optimizer-local")]
#[test]
fn native_methods_hpo_runs_inside_training_and_refits_the_selected_pls_once() {
    let mut fixture = fixture(true, false);
    add_portable_methods_hpo(&mut fixture);
    let state = Arc::new(CallState::default());
    let mut store = InMemoryArtifactStore::new();
    let outcome = run(
        &fixture,
        state.clone(),
        &provider_with_declared_hpo_failure(&fixture),
        &mut store,
    )
    .unwrap();

    outcome.validate().unwrap();
    assert!(outcome
        .selected_variant_id
        .as_str()
        .starts_with("hpo:trial:"));
    assert!(!outcome.oof_averages.is_empty());
    for average in &outcome.oof_averages {
        assert_eq!(
            outcome
                .score_set
                .reports
                .iter()
                .filter(|report| {
                    report.variant_id.as_ref() == Some(&outcome.selected_variant_id)
                        && report.producer_node == average.predictions.producer_node
                        && report.producer_port == average.predictions.producer_port
                        && report.partition == average.predictions.partition
                        && report.fold_id == average.predictions.fold_id
                        && report.level == average.predictions.level
                })
                .count(),
            1,
            "every retained HPO OOF block needs exactly one terminal score",
        );
    }
    let native_oof_rmse = outcome
        .score_set
        .reports
        .iter()
        .find(|report| {
            report.producer_node.as_str() == "model:base"
                && report.partition == PredictionPartition::Validation
                && report
                    .fold_id
                    .as_ref()
                    .is_some_and(|fold| fold.as_str() == "avg")
        })
        .unwrap()
        .metrics["rmse"];
    // Golden generated by libn4m 2.2 on the provider-owned four-row view.
    // PLS may use a platform BLAS, so retain numerical evidence without
    // requiring bitwise equality across supported native toolchains.
    assert!((native_oof_rmse - 3.328_227_381_906_01).abs() < 1.0e-10);
    assert!(outcome
        .execution_bundle
        .refit_artifacts
        .iter()
        .any(|record| record.artifact.kind == "n4m_model"));
    let resume_state = outcome
        .methods_hpo_resume_state
        .as_ref()
        .expect("native HPO persists its complete resumable state in the outcome");
    resume_state.validate().unwrap();
    assert!(
        !resume_state.completed_proposals.is_empty(),
        "an initial native HPO outcome must never persist a report without its exact proposal"
    );
    assert_eq!(
        resume_state.completed_proposals.len(),
        resume_state.completed_reports.len(),
        "completed proposals and terminal OOF reports must remain one-to-one"
    );
    assert_eq!(
        resume_state.completed_proposals.len(),
        resume_state.candidates.len(),
        "completed proposals and candidate OOF evidence must remain one-to-one"
    );
    assert_eq!(
        resume_state.trial_history_len, 2,
        "initial total HPO budget is two"
    );
    assert_eq!(
        resume_state.completed_proposals.len(),
        1,
        "only one asked trial completed and supplied selectable OOF evidence"
    );
    assert_eq!(
        resume_state.trial_history_len as usize - resume_state.completed_proposals.len(),
        1,
        "the explicitly refused provider candidate stops after its first transform fold"
    );
    // Two transform folds for the completed candidate, one before the failed
    // candidate is rejected, then two selected FIT_CV folds. REFIT remains a
    // separate exactly-once full-data call.
    assert_eq!(state.count(Phase::FitCv, "transform:snv"), 5);
    assert_eq!(state.count(Phase::Refit, "transform:snv"), 1);
    // HPO provenance is a campaign artifact, never a control-only graph node
    // or special predictor-closure lineage record.
    assert_eq!(resume_state.operation_id, "hpo:methods");
    assert_eq!(resume_state.target_node_id, node("model:base"));
    assert_eq!(
        outcome.execution_bundle.methods_hpo_resume_state.as_ref(),
        Some(resume_state)
    );
    assert!(outcome
        .execution_bundle
        .raw_artifact_payloads
        .values()
        .any(|payload| !payload.is_empty()));
    // A JSON round trip models a new process/controller receiving only the
    // durable outcome rather than any in-memory optimizer state.
    let replayed = TrainingOutcome::from_json(&serde_json::to_string(&outcome).unwrap()).unwrap();
    assert_eq!(
        replayed.methods_hpo_resume_state,
        outcome.methods_hpo_resume_state
    );
    assert_eq!(
        outcome.effective_plan.node_plans[&node("model:base")].params["n_components"],
        outcome.parameter_patches[0].value
    );
}

#[cfg(feature = "methods-optimizer-local")]
#[test]
fn native_methods_hpo_training_resume_keeps_selected_rerun_reports_identical() {
    let mut first_fixture = fixture(true, false);
    add_portable_methods_hpo(&mut first_fixture);
    let mut first_store = InMemoryArtifactStore::new();
    let first = run(
        &first_fixture,
        Arc::new(CallState::default()),
        &provider_with_declared_hpo_failure(&first_fixture),
        &mut first_store,
    )
    .unwrap();
    let first = TrainingOutcome::from_json(&serde_json::to_string(&first).unwrap()).unwrap();
    let package = first
        .to_portable_predictor_package(
            "predictor:resume.segment",
            FittedArtifactMode::PortableRequired,
            ArtifactLoadMode::NativePortable,
        )
        .unwrap();
    let first_resume_state = first
        .methods_hpo_resume_state
        .as_ref()
        .expect("initial native HPO outcome must persist resume state");
    assert_eq!(
        first_resume_state.provenance.graph_fingerprint,
        package.effective_plan.graph_fingerprint
    );
    assert_eq!(
        first_resume_state.provenance.controller_fingerprint,
        package.effective_plan.controller_fingerprint
    );
    PortablePredictorPackage::from_json(&serde_json::to_string(&package).unwrap())
        .unwrap()
        .validate()
        .unwrap();
    let mut resumed_fixture = fixture(true, false);
    add_portable_methods_hpo(&mut resumed_fixture);
    let descriptor = methods_hpo_descriptor_mut(&mut resumed_fixture)
        .as_object_mut()
        .unwrap();
    descriptor.insert("trials".into(), serde_json::json!(3));
    descriptor.insert(
        "resume_package_json".into(),
        serde_json::to_value(serde_json::to_string(&package).unwrap()).unwrap(),
    );
    rebuild(&mut resumed_fixture);
    resumed_fixture.request =
        TrainingRequest::from_json(&serde_json::to_string(&resumed_fixture.request).unwrap())
            .unwrap();
    let state = Arc::new(CallState::default());
    let mut store = InMemoryArtifactStore::new();
    let resumed = run(
        &resumed_fixture,
        state.clone(),
        &provider_with_declared_hpo_failure(&resumed_fixture),
        &mut store,
    )
    .expect("checkpoint resume must preserve selected rerun evidence");
    let resumed_resume_state = resumed
        .methods_hpo_resume_state
        .as_ref()
        .expect("resumed native HPO outcome must persist resume state");
    assert_eq!(
        resumed_resume_state.provenance.graph_fingerprint,
        resumed.effective_plan.graph_fingerprint
    );
    assert_eq!(
        resumed_resume_state.provenance.controller_fingerprint,
        resumed.effective_plan.controller_fingerprint
    );
    assert_eq!(
        resumed_resume_state.provenance.graph_fingerprint,
        first_resume_state.provenance.graph_fingerprint,
        "resume-package bytes and requested total trial count must not alter immutable HPO plan provenance",
    );
    assert_eq!(resumed.selected_variant_id, first.selected_variant_id);
    assert_eq!(state.count(Phase::Refit, "transform:snv"), 1);
    let resumed_terminal_reports = resumed_resume_state
        .completed_reports
        .iter()
        .map(|completed| completed.report.clone())
        .collect::<Vec<_>>();
    assert_eq!(
        resumed.score_set.reports, resumed_terminal_reports,
        "the outcome ScoreSet must retain the merged terminal HPO report identities verbatim",
    );
    // The persisted selection evidence is deliberately the terminal
    // sample-level OOF average, not an invented per-fold score transcript.
    // `execute_training` must therefore match this exact report identity on
    // the selected rerun; this regression previously failed with the rerun's
    // full fold transcript compared against this one retained terminal report.
    let selected_terminal_reports = resumed
        .score_set
        .reports
        .iter()
        .filter(|report| report.variant_id.as_ref() == Some(&resumed.selected_variant_id))
        .collect::<Vec<_>>();
    assert_eq!(
        selected_terminal_reports.len(),
        1,
        "selected terminal HPO reports: {selected_terminal_reports:#?}"
    );
    let selected_terminal_report = selected_terminal_reports[0];
    assert_eq!(
        selected_terminal_report.producer_node.as_str(),
        "model:base"
    );
    assert_eq!(
        selected_terminal_report.producer_port.as_deref(),
        // `model:base` declares its sole prediction output as `oof` in the
        // fixture. The scheduler resolves the omitted request output port to
        // that declared graph port, and HPO terminal reports must preserve the
        // same canonical identity through resume and SELECT.
        Some("oof")
    );
    assert_eq!(
        selected_terminal_report.partition,
        PredictionPartition::Validation
    );
    assert!(selected_terminal_report
        .fold_id
        .as_ref()
        .is_some_and(|fold| fold.as_str() == "avg"));
    assert_eq!(selected_terminal_report.level, PredictionLevel::Sample);
    assert_eq!(resumed_resume_state.trial_history_len, 3);

    let mut uninterrupted_fixture = fixture(true, false);
    add_portable_methods_hpo(&mut uninterrupted_fixture);
    methods_hpo_descriptor_mut(&mut uninterrupted_fixture)
        .as_object_mut()
        .unwrap()
        .insert("trials".into(), serde_json::json!(3));
    rebuild(&mut uninterrupted_fixture);
    let mut uninterrupted_store = InMemoryArtifactStore::new();
    let uninterrupted = run(
        &uninterrupted_fixture,
        Arc::new(CallState::default()),
        &provider_with_declared_hpo_failure(&uninterrupted_fixture),
        &mut uninterrupted_store,
    )
    .unwrap();
    let uninterrupted_resume_state = uninterrupted.methods_hpo_resume_state.as_ref().unwrap();
    assert_eq!(
        resumed_resume_state.trial_history_len,
        uninterrupted_resume_state.trial_history_len
    );
    assert_eq!(
        resumed_resume_state.completed_proposals,
        uninterrupted_resume_state.completed_proposals
    );
    assert_eq!(
        resumed_resume_state.completed_reports,
        uninterrupted_resume_state.completed_reports
    );
    assert_eq!(
        resumed_resume_state.incumbent,
        uninterrupted_resume_state.incumbent
    );
}

#[cfg(feature = "methods-optimizer-local")]
#[test]
fn native_methods_hpo_resume_merges_new_completed_evidence_before_validation() {
    let mut initial_fixture = fixture(true, false);
    add_portable_methods_hpo(&mut initial_fixture);
    give_methods_hpo_seeded_three_fold_rows(&mut initial_fixture);
    let descriptor = methods_hpo_descriptor_mut(&mut initial_fixture);
    descriptor["study"]["optimizer"]["sampler"] = serde_json::json!("tpe");
    descriptor["study"]["optimizer"]["pruner"] = serde_json::json!("median");
    descriptor["study"]["optimizer"]["seed"] = serde_json::json!(51);
    descriptor["study"]["optimizer"]["n_startup_trials"] = serde_json::json!(2);
    descriptor["trials"] = serde_json::json!(2);
    rebuild(&mut initial_fixture);

    let mut initial_provider = provider(&initial_fixture);
    configure_deterministic_hpo_oof_provider(&mut initial_provider);
    initial_provider
        .methods_hpo_oof_target_offsets
        .insert(3, 0.125);
    let initial = run(
        &initial_fixture,
        Arc::new(CallState::default()),
        &initial_provider,
        &mut InMemoryArtifactStore::new(),
    )
    .expect("initial two-trial TPE/Median campaign");
    let initial_resume = initial
        .methods_hpo_resume_state
        .as_ref()
        .expect("initial campaign persists resume evidence")
        .clone();
    assert_eq!(initial_resume.trial_history_len, 2);
    assert_eq!(initial_resume.completed_proposals.len(), 2);
    assert_ne!(
        initial_resume.completed_reports[0].score.to_bits(),
        initial_resume.completed_reports[1].score.to_bits(),
        "the resume witness must not depend on SELECT's anti-tie rejection"
    );
    let package = initial
        .to_portable_predictor_package(
            "predictor:tpe-median.completed-resume",
            FittedArtifactMode::PortableRequired,
            ArtifactLoadMode::NativePortable,
        )
        .expect("initial campaign produces a portable resume package");
    let package_json = serde_json::to_string(&package).unwrap();

    let mut resumed_fixture = fixture(true, false);
    add_portable_methods_hpo(&mut resumed_fixture);
    give_methods_hpo_seeded_three_fold_rows(&mut resumed_fixture);
    let descriptor = methods_hpo_descriptor_mut(&mut resumed_fixture);
    descriptor["study"]["optimizer"]["sampler"] = serde_json::json!("tpe");
    descriptor["study"]["optimizer"]["pruner"] = serde_json::json!("median");
    descriptor["study"]["optimizer"]["seed"] = serde_json::json!(51);
    descriptor["study"]["optimizer"]["n_startup_trials"] = serde_json::json!(2);
    descriptor["trials"] = serde_json::json!(4);
    descriptor["resume_package_json"] = serde_json::json!(package_json);
    rebuild(&mut resumed_fixture);

    let mut resumed_provider = provider(&resumed_fixture);
    configure_deterministic_hpo_oof_provider(&mut resumed_provider);
    resumed_provider
        .methods_hpo_oof_target_offsets
        .insert(3, 0.125);
    let resumed = run(
        &resumed_fixture,
        Arc::new(CallState::default()),
        &resumed_provider,
        &mut InMemoryArtifactStore::new(),
    )
    .expect("resumed campaign merges old and fresh completed evidence");
    let resumed_resume = resumed
        .methods_hpo_resume_state
        .as_ref()
        .expect("resumed campaign persists merged evidence");
    resumed_resume.validate().unwrap();
    assert_eq!(resumed_resume.trial_history_len, 4);
    assert_eq!(
        &resumed_resume.terminal_trials[..initial_resume.terminal_trials.len()],
        initial_resume.terminal_trials.as_slice(),
        "resume must preserve the old terminal native ledger verbatim"
    );

    let new_completed = resumed_resume
        .terminal_trials
        .iter()
        .filter(|entry| entry.trial.id >= 2 && entry.trial.status == HpoTrialStatus::Completed)
        .map(|entry| entry.trial.id)
        .collect::<BTreeSet<_>>();
    assert!(
        !new_completed.is_empty(),
        "the witness must exercise fresh COMPLETED evidence after resume"
    );
    let completed_ids = resumed_resume
        .completed_proposals
        .iter()
        .map(|proposal| proposal.trial_id)
        .collect::<BTreeSet<_>>();
    assert!(new_completed.is_subset(&completed_ids));
    assert_eq!(
        resumed_resume
            .completed_proposals
            .iter()
            .filter(|proposal| proposal.trial_id < 2)
            .cloned()
            .collect::<Vec<_>>(),
        initial_resume.completed_proposals
    );
    assert_eq!(
        resumed_resume
            .completed_reports
            .iter()
            .filter(|report| report.trial_id < 2)
            .cloned()
            .collect::<Vec<_>>(),
        initial_resume.completed_reports
    );
    assert_eq!(
        resumed_resume
            .candidates
            .iter()
            .filter(|candidate| candidate.trial_id < 2)
            .cloned()
            .collect::<Vec<_>>(),
        initial_resume.candidates
    );
}

#[cfg(feature = "methods-optimizer-local")]
#[test]
fn native_methods_hpo_tpe_median_operation_preserves_terminal_ledger_through_package_resume() {
    // This runs the production-shaped operation end-to-end: an attested
    // provider feeds the Methods PLS controller, proposals are evaluated by
    // the sequential scheduler, and the registered Methods tuner owns the
    // native TPE/Median study.  It must not regress to a test-only evaluator
    // or a synthetic optimizer transcript.
    // First establish, through the same real controller/provider/fold path but
    // with no pruner, that trial 2's `n_components=3` OOF score is worse than
    // the completed component-2 baseline. The following TPE/Median operation
    // uses the identical space, seed and data, so its PRUNED state is native
    // evidence rather than a test-injected optimizer outcome.
    let mut baseline_fixture = fixture(true, false);
    add_portable_methods_hpo(&mut baseline_fixture);
    give_methods_hpo_four_train_rows(&mut baseline_fixture);
    let descriptor = methods_hpo_descriptor_mut(&mut baseline_fixture);
    descriptor["study"]["optimizer"]["sampler"] = serde_json::json!("tpe");
    descriptor["study"]["optimizer"]["pruner"] = serde_json::json!("none");
    descriptor["study"]["optimizer"]["seed"] = serde_json::json!(51);
    descriptor["study"]["optimizer"]["n_startup_trials"] = serde_json::json!(2);
    descriptor["trials"] = serde_json::json!(3);
    rebuild(&mut baseline_fixture);
    let mut baseline_provider = provider(&baseline_fixture);
    configure_deterministic_hpo_oof_provider(&mut baseline_provider);
    let baseline = run(
        &baseline_fixture,
        Arc::new(CallState::default()),
        &baseline_provider,
        &mut InMemoryArtifactStore::new(),
    )
    .expect("unpruned TPE baseline evaluates the third PLS component");
    let baseline_trials = &baseline
        .methods_hpo_resume_state
        .as_ref()
        .expect("baseline preserves native terminal evidence")
        .terminal_trials;
    assert_eq!(
        baseline_trials
            .iter()
            .map(|entry| (entry.trial.id, entry.trial.status))
            .collect::<Vec<_>>(),
        vec![
            (0, HpoTrialStatus::Completed),
            (1, HpoTrialStatus::Completed),
            (2, HpoTrialStatus::Completed),
        ],
        "no-pruner baseline must evaluate native TPE trial 2"
    );
    let trial_score = |trial_id| {
        baseline_trials
            .iter()
            .find(|entry| entry.trial.id == trial_id)
            .and_then(|entry| entry.trial.score)
            .expect("completed baseline trial has a native score")
    };
    assert!(
        trial_score(2) > trial_score(0),
        "component 3 must be demonstrably worse OOF than component 2 before Median pruning"
    );

    let mut initial_fixture = fixture(true, false);
    add_portable_methods_hpo(&mut initial_fixture);
    give_methods_hpo_four_train_rows(&mut initial_fixture);
    let descriptor = methods_hpo_descriptor_mut(&mut initial_fixture);
    descriptor["study"]["optimizer"]["sampler"] = serde_json::json!("tpe");
    descriptor["study"]["optimizer"]["pruner"] = serde_json::json!("median");
    descriptor["study"]["optimizer"]["seed"] = serde_json::json!(51);
    descriptor["study"]["optimizer"]["n_startup_trials"] = serde_json::json!(2);
    descriptor["trials"] = serde_json::json!(3);
    rebuild(&mut initial_fixture);

    let mut initial_provider = provider(&initial_fixture);
    configure_deterministic_hpo_oof_provider(&mut initial_provider);
    let mut initial_store = InMemoryArtifactStore::new();
    let initial = run(
        &initial_fixture,
        Arc::new(CallState::default()),
        &initial_provider,
        &mut initial_store,
    )
    .expect("initial TPE/Median native HPO operation");
    assert_eq!(
        initial.compute_fingerprint().unwrap(),
        initial.outcome_fingerprint,
        "operation returned a self-inconsistent outcome",
    );
    let initial_json = serde_json::to_string(&initial).unwrap();
    let round_tripped: TrainingOutcome = serde_json::from_str(&initial_json).unwrap();
    let initial_value: serde_json::Value = serde_json::from_str(&initial_json).unwrap();
    let round_tripped_value = serde_json::to_value(&round_tripped).unwrap();
    let reserialized_json = serde_json::to_string(&round_tripped).unwrap();
    assert_eq!(
        round_tripped.compute_fingerprint().unwrap(),
        initial.outcome_fingerprint,
        "native TPE/Median outcome fingerprint must survive its JSON boundary; first JSON difference: {:?}",
        (
            first_json_difference("$", &initial_value, &round_tripped_value),
            first_tcv_difference(
                "$",
                &parse_typed_json(&initial_json).unwrap(),
                &parse_typed_json(&reserialized_json).unwrap(),
            ),
        ),
    );
    let initial = TrainingOutcome::from_json(&initial_json)
        .expect("initial terminal evidence survives its outcome JSON boundary");
    let package = initial
        .to_portable_predictor_package(
            "predictor:tpe-median.resume",
            FittedArtifactMode::PortableRequired,
            ArtifactLoadMode::NativePortable,
        )
        .expect("portable package carries the complete native resume state");
    let package_json = serde_json::to_string(&package).unwrap();
    PortablePredictorPackage::from_json(&package_json)
        .expect("package JSON is the only accepted resume boundary")
        .validate()
        .unwrap();

    let mut resumed_fixture = fixture(true, false);
    add_portable_methods_hpo(&mut resumed_fixture);
    give_methods_hpo_four_train_rows(&mut resumed_fixture);
    let descriptor = methods_hpo_descriptor_mut(&mut resumed_fixture);
    descriptor["study"]["optimizer"]["sampler"] = serde_json::json!("tpe");
    descriptor["study"]["optimizer"]["pruner"] = serde_json::json!("median");
    descriptor["study"]["optimizer"]["seed"] = serde_json::json!(51);
    descriptor["study"]["optimizer"]["n_startup_trials"] = serde_json::json!(2);
    descriptor["trials"] = serde_json::json!(4);
    descriptor["resume_package_json"] = serde_json::json!(package_json);
    rebuild(&mut resumed_fixture);
    resumed_fixture.request =
        TrainingRequest::from_json(&serde_json::to_string(&resumed_fixture.request).unwrap())
            .unwrap();

    let resumed_state = Arc::new(CallState::default());
    let mut resumed_provider = provider(&resumed_fixture);
    configure_deterministic_hpo_oof_provider(&mut resumed_provider);
    // Trial 3 is requested only after the native TPE/Median sequence has
    // completed trials 0/1 and terminalized trial 2 as PRUNED. This is a real
    // data-provider refusal keyed by `MethodsPlsDataRequest.variant_id`, not a
    // fabricated optimizer terminal transition.
    resumed_provider.fail_methods_hpo_trial_id = Some(3);
    let mut resumed_store = InMemoryArtifactStore::new();
    let resumed = run(
        &resumed_fixture,
        resumed_state.clone(),
        &resumed_provider,
        &mut resumed_store,
    )
    .expect("TPE/Median package resume must execute through the scheduler");
    resumed.validate().unwrap();
    let resumed_ledger = &resumed
        .methods_hpo_resume_state
        .as_ref()
        .expect("resumed operation persists its terminal native ledger")
        .terminal_trials;
    assert_eq!(
        resumed_ledger
            .iter()
            .map(|entry| (entry.trial.id, entry.trial.status))
            .collect::<Vec<_>>(),
        vec![
            (0, HpoTrialStatus::Completed),
            (1, HpoTrialStatus::Completed),
            (2, HpoTrialStatus::Pruned),
            (3, HpoTrialStatus::Failed),
        ],
        "native TPE/Median terminal order/reasons: {resumed_ledger:#?}"
    );
    assert!(resumed_ledger.iter().any(|entry| {
        entry
            .trial
            .intermediates
            .iter()
            .any(|intermediate| intermediate.step == 0)
    }));

    // The normal DAG-ML SELECT decision, not a tuner-side marker, must agree
    // exactly with the native incumbent; the campaign performs one SELECT and
    // the selected variant is refit once after (never inside) optimization.
    assert_eq!(resumed.execution_bundle.selections.len(), 1);
    let decision = resumed.execution_bundle.selections.values().next().unwrap();
    let incumbent = &resumed.methods_hpo_resume_state.as_ref().unwrap().incumbent;
    assert_eq!(
        decision.selected_candidate_id,
        incumbent.variant_id.as_str()
    );
    assert_eq!(decision.selected_score.to_bits(), incumbent.score.to_bits());
    assert_eq!(resumed.selected_variant_id, incumbent.variant_id);
    assert_eq!(resumed_state.count(Phase::Refit, "transform:snv"), 1);

    let mut uninterrupted_fixture = fixture(true, false);
    add_portable_methods_hpo(&mut uninterrupted_fixture);
    give_methods_hpo_four_train_rows(&mut uninterrupted_fixture);
    let descriptor = methods_hpo_descriptor_mut(&mut uninterrupted_fixture);
    descriptor["study"]["optimizer"]["sampler"] = serde_json::json!("tpe");
    descriptor["study"]["optimizer"]["pruner"] = serde_json::json!("median");
    descriptor["study"]["optimizer"]["seed"] = serde_json::json!(51);
    descriptor["study"]["optimizer"]["n_startup_trials"] = serde_json::json!(2);
    descriptor["trials"] = serde_json::json!(4);
    rebuild(&mut uninterrupted_fixture);
    let uninterrupted_state = Arc::new(CallState::default());
    let mut uninterrupted_provider = provider(&uninterrupted_fixture);
    configure_deterministic_hpo_oof_provider(&mut uninterrupted_provider);
    uninterrupted_provider.fail_methods_hpo_trial_id = Some(3);
    let mut uninterrupted_store = InMemoryArtifactStore::new();
    let uninterrupted = run(
        &uninterrupted_fixture,
        uninterrupted_state.clone(),
        &uninterrupted_provider,
        &mut uninterrupted_store,
    )
    .expect("uninterrupted TPE/Median native HPO operation");
    let uninterrupted_resume = uninterrupted.methods_hpo_resume_state.as_ref().unwrap();
    let resumed_resume = resumed.methods_hpo_resume_state.as_ref().unwrap();
    // Native wall-clock duration is observability rather than semantic optimizer
    // identity: two independently executed, otherwise identical TPE runs have
    // distinct elapsed times. Every durable trial is still required to carry a
    // finite non-negative duration; compare all remaining terminal evidence
    // exactly, including IDs, ordering, parameters, statuses, scores,
    // intermediates, structured failures, and variant identity.
    let semantic_ledger = |ledger: &Vec<dag_ml_core::MethodsHpoTerminalEvidence>| {
        let mut semantic = ledger.clone();
        for entry in &mut semantic {
            assert!(
                entry.trial.duration.is_finite() && entry.trial.duration >= 0.0,
                "native trial {} has an invalid duration",
                entry.trial.id
            );
            entry.trial.duration = 0.0;
        }
        semantic
    };
    assert_eq!(
        semantic_ledger(&resumed_resume.terminal_trials),
        semantic_ledger(&uninterrupted_resume.terminal_trials)
    );
    assert_eq!(resumed_resume.incumbent, uninterrupted_resume.incumbent);
    assert_eq!(
        resumed.selected_variant_id,
        uninterrupted.selected_variant_id
    );
    assert_eq!(uninterrupted.execution_bundle.selections.len(), 1);
    assert_eq!(uninterrupted_state.count(Phase::Refit, "transform:snv"), 1);
}

#[cfg(feature = "methods-optimizer-local")]
#[test]
fn native_methods_hpo_replay_hydrates_n4mm_from_json_bundle_in_fresh_controller() {
    let mut fixture = fixture(true, false);
    add_portable_methods_hpo(&mut fixture);
    use_studio_pls_regression_v1_params(&mut fixture);
    // Keep the live REFIT output as an independent numerical oracle for every
    // host-resolved PREDICT row. Without this expansion REFIT covers samples
    // 1..=4 while this provider's inference cohort correctly covers 1..=8.
    give_methods_hpo_four_train_rows(&mut fixture);
    rebuild(&mut fixture);
    let mut source_store = InMemoryArtifactStore::new();
    let source = run(
        &fixture,
        Arc::new(CallState::default()),
        &provider(&fixture),
        &mut source_store,
    )
    .expect("source native Methods HPO training");
    let source_params = &source.effective_plan.node_plans[&node("model:base")].params;
    assert_eq!(source_params["copy"], serde_json::json!(true));
    assert_eq!(source_params["max_iter"], serde_json::json!(500));
    assert_eq!(source_params["scale"], serde_json::json!(true));
    assert_eq!(source_params["tol"], serde_json::json!(1.0e-6));
    assert!(source.replayable_phases.contains(&Phase::Predict));
    assert!(!source.execution_bundle.raw_artifact_payloads.is_empty());
    let mut missing_payload = source.execution_bundle.clone();
    missing_payload.raw_artifact_payloads.clear();
    assert!(missing_payload
        .validate()
        .unwrap_err()
        .to_string()
        .contains("must exactly cover RAW refit artifacts"));
    let mut orphan_payload = source.execution_bundle.clone();
    orphan_payload
        .raw_artifact_payloads
        .insert(ArtifactId::new("artifact:orphan.n4mm").unwrap(), vec![0]);
    assert!(orphan_payload
        .validate()
        .unwrap_err()
        .to_string()
        .contains("must exactly cover RAW refit artifacts"));

    // A JSON boundary models a different process.  The replay registry is new
    // and the fallback store deliberately has no old fitted-model handles;
    // only `ExecutionBundle::raw_artifact_payloads` may make PREDICT work.
    let source = TrainingOutcome::from_json(&serde_json::to_string(&source).unwrap()).unwrap();
    let request = replay_request(&source, Phase::Predict);
    let fresh_state = Arc::new(CallState::default());
    let methods_controller = Arc::new(MethodsPlsController::new(methods_runtime()));
    let mut fresh_controllers = controllers(&fixture, fresh_state.clone(), false);
    fresh_controllers
        .register(Box::new(SharedMethodsPlsController(
            methods_controller.clone(),
        )))
        .unwrap();
    let empty_fallback_store = InMemoryArtifactStore::new();

    // Artifact hydration precedes graph execution. A provider refusal after
    // hydration must roll the invocation-local payload back instead of
    // growing controller state on every failed replay.
    let mut refusing_provider = provider(&fixture);
    refusing_provider.methods_pls_enabled = false;
    let error = execute_attached_training_replay(AttachedTrainingReplayInput {
        source: &source,
        request: &request,
        outcome_id: "replay:methods-hpo.n4mm.provider-refusal".to_string(),
        run_id: RunId::new("run:methods-hpo.replay.provider-refusal").unwrap(),
        controllers: &fresh_controllers,
        data_provider: &refusing_provider,
        artifact_store: &empty_fallback_store,
        data_envelopes: &replay_envelopes_with_relation(&source, &"a".repeat(64)),
        warnings: Vec::new(),
        diagnostics: BTreeMap::new(),
    })
    .expect_err("provider refusal must abort after N4MM hydration");
    assert!(error
        .to_string()
        .contains("test provider intentionally has no portable Methods PLS view"));
    assert_eq!(methods_controller.hydrated_payload_count().unwrap(), 0);
    let failed_replay_transform_calls = fresh_state.count(Phase::Predict, "transform:snv");

    let replay = execute_attached_training_replay(AttachedTrainingReplayInput {
        source: &source,
        request: &request,
        outcome_id: "replay:methods-hpo.n4mm".to_string(),
        run_id: RunId::new("run:methods-hpo.replay").unwrap(),
        controllers: &fresh_controllers,
        data_provider: &provider(&fixture),
        artifact_store: &empty_fallback_store,
        data_envelopes: &replay_envelopes_with_relation(&source, &"a".repeat(64)),
        warnings: Vec::new(),
        diagnostics: BTreeMap::new(),
    })
    .expect("fresh controller should hydrate durable N4MM payload");

    // PREDICT is host-resolved (`sample_ids == None`), so matching REFIT and
    // replay cohorts is a fixture choice rather than a scheduler assumption.
    // It lets the live native model attest every imported N4MM output row.
    let expected = &source.outputs[0].predictions[0];
    let actual = &replay.outputs[0].predictions[0];
    assert_eq!(
        expected.sample_ids,
        (1..=8)
            .map(|index| sample(&format!("sample:{index}")))
            .collect::<Vec<_>>()
    );
    assert_eq!(expected.sample_ids, actual.sample_ids);
    assert_eq!(expected.values.len(), actual.values.len());
    for ((sample_id, expected), actual) in expected
        .sample_ids
        .iter()
        .zip(&expected.values)
        .zip(&actual.values)
    {
        assert_eq!(expected.len(), actual.len());
        for (expected, actual) in expected.iter().zip(actual.iter()) {
            assert!(
                (expected - actual).abs() < 1.0e-12,
                "hydrated N4MM prediction for {sample_id} drifted: expected {expected}, got {actual}"
            );
        }
    }

    // A fresh inference cohort is intentionally target-free. The exact same
    // native N4MM controller must accept it without replacing the absent
    // target identity with a training-time sentinel.
    let mut target_free_envelopes = replay_envelopes_with_relation(&source, &"a".repeat(64));
    for envelope in target_free_envelopes.values_mut() {
        envelope.target_content_fingerprint = None;
    }
    let target_free_provider =
        target_free_methods_provider(&fixture, &source, target_free_envelopes.clone());
    let target_free = execute_attached_training_replay(AttachedTrainingReplayInput {
        source: &source,
        request: &request,
        outcome_id: "replay:methods-hpo.n4mm.target-free".to_string(),
        run_id: RunId::new("run:methods-hpo.replay.target-free").unwrap(),
        controllers: &fresh_controllers,
        data_provider: &target_free_provider,
        artifact_store: &empty_fallback_store,
        data_envelopes: &target_free_envelopes,
        warnings: Vec::new(),
        diagnostics: BTreeMap::new(),
    })
    .expect("fresh native Methods PREDICT must accept an X-only cohort");
    assert!(target_free
        .input_data_identities
        .iter()
        .all(|identity| identity.target_content_fingerprint.is_none()));
    assert_eq!(target_free.outputs[0].predictions[0], *actual);
    assert_eq!(methods_controller.hydrated_payload_count().unwrap(), 0);

    // Hydrated handles are invocation-local and consumed once. Reusing the
    // same otherwise-fresh registry must hydrate a distinct capability from
    // the durable bundle rather than depend on state left by the first replay.
    let replay_again = execute_attached_training_replay(AttachedTrainingReplayInput {
        source: &source,
        request: &request,
        outcome_id: "replay:methods-hpo.n4mm.again".to_string(),
        run_id: RunId::new("run:methods-hpo.replay.again").unwrap(),
        controllers: &fresh_controllers,
        data_provider: &provider(&fixture),
        artifact_store: &empty_fallback_store,
        data_envelopes: &replay_envelopes_with_relation(&source, &"a".repeat(64)),
        warnings: Vec::new(),
        diagnostics: BTreeMap::new(),
    })
    .expect("same controller should rehydrate N4MM for each replay invocation");
    assert_eq!(replay_again.outputs[0].predictions[0], *actual);

    // The deployable package follows the same raw-payload route. Native
    // portable loading must never ask a host-sidecar resolver for a handle.
    let package = source
        .to_portable_predictor_package(
            "predictor:methods-hpo.n4mm",
            FittedArtifactMode::PortableRequired,
            ArtifactLoadMode::NativePortable,
        )
        .unwrap();
    let package =
        PortablePredictorPackage::from_json(&serde_json::to_string(&package).unwrap()).unwrap();

    // Existing retained-cache outcomes stay byte-for-byte on their historical
    // path.  This native HPO campaign has no graph OOF edge, so its retained
    // payload set is empty but still present because the request asked to
    // retain caches.
    let retained_caches = source
        .portable_prediction_caches
        .as_ref()
        .expect("the retained-cache source preserves its payload-set member");
    let retained_archive = build_archive_v2_native_portable_payloads(
        "archive:methods-hpo.retained",
        &source,
        &package,
    )
    .expect("existing retained-cache archive behavior remains available");
    assert_eq!(
        retained_archive
            .members
            .get(ARCHIVE_V2_CACHE_MEMBER)
            .unwrap(),
        canonical_archive_json::to_vec(retained_caches)
            .unwrap()
            .as_slice(),
        "a retained cache payload set must use canonical archive bytes"
    );

    // Model the strict terminal facade's legal absence of retained OOF cache
    // payloads without modifying the source Package or Outcome in place.  The
    // synthetic archive member is allowed only because the bundle has no OOF
    // requirements/cache records and the effective graph has no requires_oof
    // edge.  Re-signing models a real portable JSON boundary.
    assert!(source.execution_bundle.prediction_requirements.is_empty());
    assert!(source.execution_bundle.prediction_caches.is_empty());
    assert!(source
        .effective_plan
        .graph_plan
        .graph
        .edges
        .iter()
        .all(|edge| !edge.contract.requires_oof));
    let mut archive_source = source.clone();
    archive_source.portable_prediction_caches = None;
    resign_outcome(&mut archive_source);
    archive_source.validate().unwrap();
    let archive_package = archive_source
        .to_portable_predictor_package(
            "predictor:methods-hpo.strict-terminal",
            FittedArtifactMode::PortableRequired,
            ArtifactLoadMode::NativePortable,
        )
        .unwrap();
    let archive_package =
        PortablePredictorPackage::from_json(&serde_json::to_string(&archive_package).unwrap())
            .unwrap();
    let archive = build_archive_v2_native_portable_payloads(
        "archive:methods-hpo.n4mm",
        &archive_source,
        &archive_package,
    )
    .expect("a strict no-OOF-cache native Methods outcome closes the Archive V2 P0 member set");
    assert_eq!(
        archive.members.get(ARCHIVE_V2_PACKAGE_MEMBER).unwrap(),
        canonical_archive_json::to_vec(&archive_package)
            .unwrap()
            .as_slice()
    );
    let archive_caches: BundlePredictionCachePayloadSet =
        serde_json::from_slice(archive.members.get(ARCHIVE_V2_CACHE_MEMBER).unwrap()).unwrap();
    assert_eq!(
        archive_caches.bundle_id,
        archive_source.execution_bundle.bundle_id
    );
    assert_eq!(archive_caches.schema_version, 2);
    assert!(archive_caches.caches.is_empty());
    archive_caches
        .validate_against_bundle(&archive_source.execution_bundle)
        .unwrap();
    assert!(archive.members.keys().all(|path| !path.contains("receipt")));
    assert!(archive
        .members
        .keys()
        .all(|path| path.starts_with("dagml/") || path.starts_with("methods/")));
    assert_eq!(
        archive.manifest["payloads"]["methods"]["n4mm"][0]["semantic_profile"],
        "n4mm_raw_sha256"
    );
    assert_eq!(
        archive.manifest["replay"]["training_artifacts"]["training_outcome"]
            ["semantic_fingerprint"],
        archive_source.outcome_fingerprint
    );
    assert_eq!(
        archive.manifest["member_inventory"]
            .as_array()
            .unwrap()
            .iter()
            .find(|member| member["path"] == ARCHIVE_V2_OUTCOME_MEMBER)
            .unwrap()["semantic_fingerprint"],
        archive_source.outcome_fingerprint
    );
    // Core owns only bounded ZIP/inventory storage. Its returned Package V2
    // bytes cross back into DAG-ML for semantic parsing and fresh replay.
    // The registry-only Core 0.3.22 dev baseline has a frozen closed manifest
    // schema from before `abi_min_minor`. Exercise its historical PLS read
    // shape for this transport-only round trip; the exact new writer manifest
    // (asserted above) is qualified against the release-train Core separately.
    let mut registry_baseline_manifest = archive.manifest.clone();
    for reference in registry_baseline_manifest["payloads"]["methods"]["n4mm"]
        .as_array_mut()
        .expect("Archive V2 N4MM references")
    {
        if reference["format_version"] != serde_json::json!(3) {
            reference
                .as_object_mut()
                .expect("Archive V2 N4MM reference object")
                .remove("abi_min_minor");
        }
    }
    let historical = core_transport_roundtrip(&registry_baseline_manifest, &archive.members);
    assert_eq!(historical.writer_reference, historical.loaded_reference);
    assert_eq!(
        &historical.portable_package,
        archive.members.get(ARCHIVE_V2_PACKAGE_MEMBER).unwrap()
    );
    assert_eq!(
        historical.members.get(ARCHIVE_V2_CACHE_MEMBER).unwrap(),
        archive.members.get(ARCHIVE_V2_CACHE_MEMBER).unwrap(),
        "Core must preserve the synthetic empty cache member byte-for-byte"
    );
    let loaded_cache: BundlePredictionCachePayloadSet =
        serde_json::from_slice(historical.members.get(ARCHIVE_V2_CACHE_MEMBER).unwrap()).unwrap();
    assert_eq!(loaded_cache, archive_caches);
    loaded_cache
        .validate_against_bundle(&archive_source.execution_bundle)
        .unwrap();
    let loaded_outcome = TrainingOutcome::from_json(
        std::str::from_utf8(historical.members.get(ARCHIVE_V2_OUTCOME_MEMBER).unwrap()).unwrap(),
    )
    .unwrap();
    assert!(loaded_outcome.portable_prediction_caches.is_none());
    assert!(historical.loaded_is_v2);
    let archived_package = PortablePredictorPackage::from_json(
        std::str::from_utf8(&historical.portable_package).unwrap(),
    )
    .expect("DAG-ML must validate Core-returned Package V2 bytes");
    let archived_loaded = archived_package
        .load_with(|record| {
            panic!(
                "Core-loaded native artifact `{}` unexpectedly requested a host-sidecar handle",
                record.artifact.id
            )
        })
        .unwrap();
    let archive_replay_state = Arc::new(CallState::default());
    let archive_methods = Arc::new(MethodsPlsController::new(methods_runtime()));
    let mut archive_controllers = controllers(&fixture, archive_replay_state, false);
    archive_controllers
        .register(Box::new(SharedMethodsPlsController(
            archive_methods.clone(),
        )))
        .unwrap();
    let archive_request = replay_request(&archive_source, Phase::Predict);
    let archive_replay = execute_loaded_predictor_replay(LoadedPredictorReplayInput {
        predictor: &archived_loaded,
        request: &archive_request,
        outcome_id: "replay:core-archive.methods-hpo.n4mm".to_string(),
        run_id: RunId::new("run:core-archive.methods-hpo.replay").unwrap(),
        controllers: &archive_controllers,
        data_provider: &provider(&fixture),
        data_envelopes: &replay_envelopes_with_relation(&archive_source, &"a".repeat(64)),
        warnings: Vec::new(),
        diagnostics: BTreeMap::new(),
    })
    .expect("fresh controller must replay the Core-loaded native package");
    assert_eq!(archive_replay.outputs[0].predictions[0], *actual);
    assert_eq!(archive_methods.hydrated_payload_count().unwrap(), 0);

    // A raw member bit flip is rejected by Core before a package parser or a
    // host fallback can receive it.
    assert!(historical.tampered_member_rejected);
    let mut host_sidecar = package.clone();
    host_sidecar.fitted_artifact_mode = FittedArtifactMode::AllowHostSidecar;
    for binding in &mut host_sidecar.artifact_bindings {
        binding.load_mode = ArtifactLoadMode::HostSidecar;
    }
    host_sidecar.package_fingerprint = host_sidecar.compute_fingerprint().unwrap();
    assert!(build_archive_v2_native_portable_payloads(
        "archive:methods-hpo.host-sidecar",
        &source,
        &host_sidecar,
    )
    .unwrap_err()
    .to_string()
    .contains("host-sidecar"));
    let mut missing_raw_payload = package.clone();
    missing_raw_payload
        .execution_bundle
        .raw_artifact_payloads
        .clear();
    missing_raw_payload.package_fingerprint = missing_raw_payload.compute_fingerprint().unwrap();
    assert!(build_archive_v2_native_portable_payloads(
        "archive:methods-hpo.missing-raw",
        &source,
        &missing_raw_payload,
    )
    .is_err());
    let loaded = package
        .clone()
        .load_with(|record| {
            panic!(
                "native-portable artifact `{}` unexpectedly requested a host-sidecar handle",
                record.artifact.id
            )
        })
        .unwrap();
    let unknown_controllers = RuntimeControllerRegistry::new();
    assert!(execute_loaded_predictor_replay(LoadedPredictorReplayInput {
        predictor: &loaded,
        request: &request,
        outcome_id: "replay:loaded.methods-hpo.unknown-controller".to_string(),
        run_id: RunId::new("run:loaded.methods-hpo.unknown-controller").unwrap(),
        controllers: &unknown_controllers,
        data_provider: &provider(&fixture),
        data_envelopes: &replay_envelopes_with_relation(&source, &"a".repeat(64)),
        warnings: Vec::new(),
        diagnostics: BTreeMap::new(),
    })
    .unwrap_err()
    .to_string()
    .contains("is not registered"));
    let loaded_replay = execute_loaded_predictor_replay(LoadedPredictorReplayInput {
        predictor: &loaded,
        request: &request,
        outcome_id: "replay:loaded.methods-hpo.n4mm".to_string(),
        run_id: RunId::new("run:loaded.methods-hpo.replay").unwrap(),
        controllers: &fresh_controllers,
        data_provider: &provider(&fixture),
        data_envelopes: &replay_envelopes_with_relation(&source, &"a".repeat(64)),
        warnings: Vec::new(),
        diagnostics: BTreeMap::new(),
    })
    .expect("loaded package should hydrate durable N4MM payload");
    assert_eq!(loaded_replay.outputs[0].predictions[0], *actual);
    assert_eq!(
        fresh_state.count(Phase::Predict, "transform:snv"),
        // target-bound, target-free, repeated attached, then loaded-package
        // replay all use the same fresh registry; the Core archive route owns
        // a separate registry below.
        failed_replay_transform_calls + 4
    );
    assert_eq!(methods_controller.hydrated_payload_count().unwrap(), 0);
}

#[cfg(feature = "methods-optimizer-local")]
#[test]
fn native_methods_pipeline_round_trips_versioned_archive_member_into_fresh_predict() {
    let mut fixture = fixture(true, false);
    give_methods_hpo_four_train_rows(&mut fixture);
    use_portable_methods_pipeline(&mut fixture);
    let mut native_provider = provider(&fixture);
    native_provider.methods_pls_feature_count = 4;
    let mut source_store = InMemoryArtifactStore::new();
    let source = run(
        &fixture,
        Arc::new(CallState::default()),
        &native_provider,
        &mut source_store,
    )
    .expect("native Methods pipeline FIT_CV and REFIT");

    assert_eq!(source.effective_plan.node_plans.len(), 1);
    assert!(source.effective_plan.graph_plan.graph.edges.is_empty());
    let artifact = &source.execution_bundle.refit_artifacts[0].artifact;
    let descriptor = artifact
        .native_predictor_descriptor
        .as_ref()
        .expect("new pipeline publication carries its inspected descriptor");
    assert_eq!(descriptor.format_version, 3);
    assert_eq!(
        artifact.abi_min_minor,
        Some(dag_ml_core::hpo::METHODS_COMPONENT_RESOLUTION_N4MM_MIN_ABI_MINOR)
    );
    let pipeline = descriptor.pipeline.as_ref().unwrap();
    assert_eq!(pipeline.savgol_window, 3);
    assert_eq!(pipeline.savgol_poly_degree, 2);
    assert_eq!(pipeline.raw_n_features, 4);
    assert_eq!(pipeline.model_n_features, 4);

    let package = source
        .to_portable_predictor_package(
            "predictor:methods.pipeline-v2",
            FittedArtifactMode::PortableRequired,
            ArtifactLoadMode::NativePortable,
        )
        .expect("pipeline N4MM is a portable predictor");
    let archive =
        build_archive_v2_native_portable_payloads("archive:methods.pipeline-v2", &source, &package)
            .expect("pipeline Package V2 closes Archive V2");
    if let Some(directory) = std::env::var_os("DAGML_ARCHIVE_CAPI_FIXTURES_DIR") {
        let directory = PathBuf::from(directory);
        std::fs::write(
            directory.join("outcome_v2.json"),
            serde_json::to_vec(&source).unwrap(),
        )
        .unwrap();
        std::fs::write(
            directory.join("package_v2.json"),
            serde_json::to_vec(&package).unwrap(),
        )
        .unwrap();
    }
    assert_eq!(
        archive.manifest["payloads"]["methods"]["n4mm"][0]["format_version"],
        serde_json::json!(3)
    );

    // Reading the Package member back is the semantic archive boundary: no
    // process-local model handle or preprocessed matrix crosses it.
    let archived_package = PortablePredictorPackage::from_json(
        std::str::from_utf8(archive.members.get(ARCHIVE_V2_PACKAGE_MEMBER).unwrap()).unwrap(),
    )
    .expect("archived pipeline package validates after reload");
    let loaded = archived_package
        .load_with(|record| {
            panic!(
                "native pipeline artifact `{}` unexpectedly requested a host handle",
                record.artifact.id
            )
        })
        .unwrap();
    let request = replay_request(&source, Phase::Predict);
    let methods_controller = Arc::new(MethodsPlsController::new(methods_runtime()));
    let mut fresh_controllers = controllers(&fixture, Arc::new(CallState::default()), false);
    fresh_controllers
        .register(Box::new(SharedMethodsPlsController(
            methods_controller.clone(),
        )))
        .unwrap();
    let replay = execute_loaded_predictor_replay(LoadedPredictorReplayInput {
        predictor: &loaded,
        request: &request,
        outcome_id: "replay:methods.pipeline-v2".to_string(),
        run_id: RunId::new("run:methods.pipeline-v2.replay").unwrap(),
        controllers: &fresh_controllers,
        data_provider: &native_provider,
        data_envelopes: &replay_envelopes_with_relation(&source, &"a".repeat(64)),
        warnings: Vec::new(),
        diagnostics: BTreeMap::new(),
    })
    .expect("fresh controller imports N4MM v2 and predicts raw X");
    let mut expected_predictions = source.outputs[0].predictions.clone();
    for (expected, actual) in expected_predictions
        .iter_mut()
        .zip(&replay.outputs[0].predictions)
    {
        expected.prediction_id.clone_from(&actual.prediction_id);
    }
    assert_eq!(replay.outputs[0].predictions, expected_predictions);
    assert_eq!(methods_controller.hydrated_payload_count().unwrap(), 0);
}

#[cfg(feature = "methods-optimizer-local")]
#[test]
fn native_methods_full_refit_executes_on_a_fresh_attested_cohort() {
    let mut fixture = fixture(true, false);
    add_portable_methods_hpo(&mut fixture);
    fixture
        .request
        .controller_manifests
        .iter_mut()
        .find(|manifest| manifest.controller_id.as_str() == "controller:transform.mock")
        .expect("fixture transform manifest")
        .capabilities
        .insert(ControllerCapability::SupportsPortableFullRefit);
    give_methods_hpo_four_train_rows(&mut fixture);
    rebuild(&mut fixture);
    let mut source_store = InMemoryArtifactStore::new();
    let source = run(
        &fixture,
        Arc::new(CallState::default()),
        &provider(&fixture),
        &mut source_store,
    )
    .expect("source native Methods training");
    let package = source
        .to_portable_predictor_package(
            "predictor:methods.full-refit.source",
            FittedArtifactMode::PortableRequired,
            ArtifactLoadMode::NativePortable,
        )
        .expect("portable Methods source package");
    let recipe = PortableRefitRecipe::derive_from_package(&package, "recipe:methods.full")
        .expect("Methods controller explicitly supports portable full refit");

    let mut target_identities = fixture.request.data_identities.clone();
    for identity in &mut target_identities {
        identity.data_content_fingerprint = "c".repeat(64);
        identity.target_content_fingerprint = "d".repeat(64);
        identity.identity_fingerprint = "0".repeat(64);
        identity.identity_fingerprint = identity.compute_fingerprint().unwrap();
    }
    let mut target_request = fixture.request.clone();
    target_request.data_identities = target_identities.clone();
    target_request.request_fingerprint = "0".repeat(64);
    target_request.request_fingerprint = target_request.compute_fingerprint().unwrap();
    let mut target_provider = provider(&fixture);
    target_provider.identity = Some(target_identities[0].clone());
    let mut binding_changed_request = target_request.clone();
    let replacement_schema = "e".repeat(64);
    for bindings in binding_changed_request.campaign.data_bindings.values_mut() {
        for binding in bindings {
            binding.schema_fingerprint = replacement_schema.clone();
        }
    }
    for identity in &mut binding_changed_request.data_identities {
        identity.schema_fingerprint = replacement_schema.clone();
        identity.identity_fingerprint = "0".repeat(64);
        identity.identity_fingerprint = identity.compute_fingerprint().unwrap();
    }
    binding_changed_request.request_fingerprint = "0".repeat(64);
    binding_changed_request.request_fingerprint =
        binding_changed_request.compute_fingerprint().unwrap();
    let changed_binding_plan =
        derive_portable_full_refit_target_plan(&recipe, &package, &binding_changed_request)
            .expect("a new cohort binding derives a selected-parent REFIT plan");
    assert_ne!(
        changed_binding_plan.campaign_fingerprint, source.effective_plan.campaign_fingerprint,
        "new cohort envelope identity must be retained in the V3 child plan"
    );
    assert_eq!(
        changed_binding_plan
            .campaign
            .data_bindings
            .values()
            .next()
            .unwrap()[0]
            .schema_fingerprint,
        replacement_schema,
        "only the target request contributes the target binding identity"
    );
    let target_plan = derive_portable_full_refit_target_plan(&recipe, &package, &target_request)
        .expect("target cohort plan derives from the selected parent recipe");
    assert_eq!(
        target_plan
            .variants
            .iter()
            .find(|variant| variant.variant_id == recipe.selected_variant_id)
            .expect("selected parent variant remains present")
            .fingerprint,
        recipe.selected_variant_fingerprint,
        "the target cohort may replace bindings/folds but cannot select another variant"
    );
    let execution = execute_portable_full_refit(PortableFullRefitExecutionInput {
        recipe: &recipe,
        source_package: &package,
        target_plan: &target_plan,
        target_training_request: &target_request,
        target_training_request_fingerprint: target_request.request_fingerprint.clone(),
        target_data_identities: &target_identities,
        target_training_influence: &fixture.influence,
        run_id: RunId::new("run:methods.full-refit.target").unwrap(),
        controllers: &controllers(&fixture, Arc::new(CallState::default()), true),
        data_provider: &target_provider,
    })
    .expect("fresh target cohort executes exactly one portable full refit");
    assert!(!execution.results.is_empty());
    assert!(!execution.refit_artifacts.is_empty());
    assert_eq!(
        execution.raw_artifact_payloads.len(),
        execution.refit_artifacts.len(),
        "every refit artifact must be detached from the execution-local controller"
    );
    assert!(execution.refit_artifacts.iter().all(|record| {
        execution
            .raw_artifact_payloads
            .get(&record.artifact.id)
            .is_some_and(|payload| !payload.is_empty())
    }));
    let refit_package = build_portable_refit_package_v3(PortableRefitPackageV3BuildInput {
        package_id: "predictor:methods.full-refit.child".to_string(),
        outcome_id: "outcome:methods.full-refit.child".to_string(),
        bundle_id: BundleId::new("bundle:methods.full-refit.child").unwrap(),
        recipe: &recipe,
        source_package: &package,
        target_plan: &target_plan,
        target_training_request: &target_request,
        target_data_identities: &target_identities,
        target_training_influence: &fixture.influence,
        execution: &execution,
    })
    .expect("fresh full refit writes a detached V3 child package");
    refit_package.validate().unwrap();
    assert!(
        refit_package
            .outcome
            .execution_bundle
            .refit_artifacts
            .iter()
            .all(|record| record.prediction_requirement_keys.is_empty()),
        "V3 owns trained REFIT artifacts, never the parent CV OOF cache dependencies"
    );
    let refit_json = serde_json::to_string(&refit_package).unwrap();
    assert_eq!(
        PortableRefitPackageV3::from_json(&refit_json).unwrap(),
        refit_package,
        "V3 child package round-trips through strict TCV1 JSON"
    );
    assert_eq!(
        refit_package.outcome.execution_bundle.raw_artifact_payloads,
        execution.raw_artifact_payloads,
        "V3 package owns the exact detached REFIT bytes, not controller handles"
    );
    let archive_v3 =
        build_archive_v3_native_refit_payloads("archive:methods.full-refit.child", &refit_package)
            .expect("DAG-ML assembles the exact Archive V3 refit closure");
    if let Some(directory) = std::env::var_os("DAGML_ARCHIVE_CAPI_FIXTURES_DIR") {
        std::fs::write(
            PathBuf::from(directory).join("package_v3.json"),
            serde_json::to_vec(&refit_package).unwrap(),
        )
        .unwrap();
    }
    assert_eq!(
        archive_v3.manifest["schema_version"],
        serde_json::json!(3),
        "a V3 full-refit child is never serialized as an Archive V2 predictor"
    );
    assert_eq!(
        archive_v3.manifest["replay"]["portable_refit_package"]["semantic_fingerprint"],
        refit_package.package_fingerprint,
    );
    assert_eq!(
        PortableRefitPackageV3::from_json(
            std::str::from_utf8(
                archive_v3
                    .members
                    .get(ARCHIVE_V3_PACKAGE_MEMBER)
                    .expect("Archive V3 package member"),
            )
            .unwrap(),
        )
        .unwrap(),
        refit_package,
        "the Archive V3 member remains DAG-ML's strict child package"
    );
    for record in &execution.refit_artifacts {
        let path = record.artifact.uri.as_deref().expect("portable N4MM URI");
        assert_eq!(
            archive_v3.members.get(path),
            execution.raw_artifact_payloads.get(&record.artifact.id),
            "Archive V3 N4MM member must byte-equal the detached V3 payload"
        );
    }
    let runtime_bundle = refit_package
        .outcome
        .to_runtime_replay_bundle()
        .expect("validated V3 child derives a scheduler-only replay bundle");
    runtime_bundle
        .validate_against_plan(&refit_package.outcome.effective_plan)
        .unwrap();
    assert_eq!(
        runtime_bundle.raw_artifact_payloads, execution.raw_artifact_payloads,
        "runtime projection preserves the exact V3 raw artifact inventory"
    );
    let mut v3_replay_request = replay_request(&source, Phase::Predict);
    v3_replay_request.request_id = "replay:methods.full-refit.v3".to_string();
    v3_replay_request.source_outcome_fingerprint =
        refit_package.outcome.outcome_fingerprint.clone();
    v3_replay_request.request_fingerprint = "0".repeat(64);
    v3_replay_request.request_fingerprint = v3_replay_request.compute_fingerprint().unwrap();
    let replay_envelopes = replay_envelopes_with_relation(&source, &"a".repeat(64));
    let methods_binding = refit_package
        .outcome
        .effective_plan
        .node_plans
        .values()
        .find(|node| node.controller_id.as_str() == METHODS_PLS_CONTROLLER_ID)
        .and_then(|node| {
            node.data_bindings
                .iter()
                .find(|binding| binding.input_name == "x")
        })
        .expect("V3 Methods replay has an x data binding");
    let methods_key =
        data_binding_requirement_key(&methods_binding.node_id, &methods_binding.input_name);
    let replay_provider = provider(&fixture);
    let replay_sample_ids = replay_provider
        .methods_rows
        .keys()
        .cloned()
        .collect::<Vec<_>>();
    let replay_values = replay_sample_ids
        .iter()
        .flat_map(|sample_id| {
            replay_provider.methods_rows[sample_id][..replay_provider.methods_pls_feature_count]
                .iter()
                .copied()
        })
        .collect::<Vec<_>>();
    let replay_inputs = BTreeMap::from([(
        methods_key,
        MethodsPlsDataset {
            y_validity_masks: None,
            sample_ids: replay_sample_ids.clone(),
            x: MethodsPlsMatrix {
                values: replay_values,
                rows: replay_sample_ids.len(),
                cols: replay_provider.methods_pls_feature_count,
            },
            y: None,
            target_names: vec!["protein".to_string()],
        },
    )]);
    let v3_replay =
        execute_loaded_methods_portable_refit_replay_v3(MethodsPortableRefitReplayInputV3 {
            package: &refit_package,
            request: &v3_replay_request,
            data_envelopes: &replay_envelopes,
            methods_inputs: &replay_inputs,
            runtime: methods_runtime(),
            supplemental_controllers: controllers(&fixture, Arc::new(CallState::default()), false),
            outcome_id: "replay:methods.full-refit.v3".to_string(),
            run_id: RunId::new("run:methods.full-refit.v3").unwrap(),
            warnings: Vec::new(),
            diagnostics: BTreeMap::new(),
        })
        .expect("a fresh Methods registry rehydrates and predicts from V3 raw artifacts");
    assert!(!v3_replay.outputs.is_empty());
    v3_replay
        .validate_against(&refit_package, &v3_replay_request)
        .unwrap();
    let v3_replay_json = serde_json::to_string(&v3_replay).unwrap();
    assert_eq!(
        PortableRefitReplayOutcomeV3::from_json_for_package(
            &v3_replay_json,
            &refit_package,
            &v3_replay_request,
        )
        .unwrap(),
        v3_replay,
        "V3 replay evidence strict-round-trips only with its exact child package and request"
    );
    let mut missing_payload = execution.clone();
    missing_payload
        .raw_artifact_payloads
        .remove(&missing_payload.refit_artifacts[0].artifact.id);
    assert!(
        build_portable_refit_package_v3(PortableRefitPackageV3BuildInput {
            package_id: "predictor:methods.full-refit.missing".to_string(),
            outcome_id: "outcome:methods.full-refit.missing".to_string(),
            bundle_id: BundleId::new("bundle:methods.full-refit.missing").unwrap(),
            recipe: &recipe,
            source_package: &package,
            target_plan: &target_plan,
            target_training_request: &target_request,
            target_data_identities: &target_identities,
            target_training_influence: &fixture.influence,
            execution: &missing_payload,
        })
        .is_err()
    );
    assert_ne!(
        execution.provenance.target_data_identities_fingerprint,
        recipe.parent_outcome.data_identities_fingerprint
    );
}

#[cfg(not(feature = "methods-optimizer"))]
#[test]
fn native_training_refuses_methods_hpo_before_provider_data_work() {
    let mut fixture = fixture(true, false);
    add_portable_methods_hpo(&mut fixture);
    let state = Arc::new(CallState::default());
    let provider = provider(&fixture);
    let mut store = InMemoryArtifactStore::new();
    let error = run(&fixture, state.clone(), &provider, &mut store).unwrap_err();

    assert!(error
        .to_string()
        .contains("native Methods HPO preflight failed before data access"));
    assert_eq!(provider.next_handle.load(Ordering::SeqCst), 0);
    assert_eq!(state.total(), 0);
    assert!(store.is_empty());
}

#[cfg(feature = "methods-optimizer-local")]
#[test]
fn native_training_refuses_hpo_without_the_provider_pls_capability_before_data_work() {
    let mut fixture = fixture(true, false);
    add_portable_methods_hpo(&mut fixture);
    let state = Arc::new(CallState::default());
    let mut provider = provider(&fixture);
    provider.methods_pls_enabled = false;
    let mut store = InMemoryArtifactStore::new();
    let error = run(&fixture, state.clone(), &provider, &mut store).unwrap_err();

    assert!(error
        .to_string()
        .contains("test provider intentionally has no portable Methods PLS view"));
    assert_eq!(provider.next_handle.load(Ordering::SeqCst), 0);
    assert_eq!(state.total(), 0);
    assert!(store.is_empty());
}

#[test]
fn attached_training_replay_predict_rebinds_current_cohort_without_mutating_source() {
    let mut fixture = fixture(true, false);
    add_model_probability_port(&mut fixture);
    let state = Arc::new(CallState::default());
    *state.emit_explicit_model_ports.lock().unwrap() = true;
    let mut store = InMemoryArtifactStore::new();
    let source = run(&fixture, state.clone(), &provider(&fixture), &mut store)
        .expect("source training outcome");
    assert!(source.replayable_phases.contains(&Phase::Predict));
    let source_fingerprint = source.outcome_fingerprint.clone();
    let source_bundle_relation = source.execution_bundle.data_requirements[0]
        .relation_fingerprint
        .clone();

    let current_relation = "f".repeat(64);
    let envelopes = replay_envelopes_with_relation(&source, &current_relation);
    let request = replay_request(&source, Phase::Predict);
    let controllers = controllers(&fixture, state.clone(), true);

    let replay = execute_attached_training_replay(AttachedTrainingReplayInput {
        source: &source,
        request: &request,
        outcome_id: "replay:attached.predict.outcome".to_string(),
        run_id: RunId::new("run:attached.predict").unwrap(),
        controllers: &controllers,
        data_provider: &provider(&fixture),
        artifact_store: &store,
        data_envelopes: &envelopes,
        warnings: Vec::new(),
        diagnostics: BTreeMap::from([("attached".to_string(), serde_json::json!(true))]),
    })
    .expect("attached replay");

    assert_eq!(source.outcome_fingerprint, source_fingerprint);
    assert_eq!(
        source.execution_bundle.data_requirements[0].relation_fingerprint,
        source_bundle_relation
    );
    assert_eq!(replay.phase, Phase::Predict);
    assert_eq!(
        replay.source_training_outcome,
        source.to_reference().unwrap()
    );
    assert_eq!(
        replay.replay_request_fingerprint,
        request.request_fingerprint
    );
    assert_eq!(replay.outputs.len(), request.output_binding_ids.len());
    assert!(replay.explanations.is_empty());
    assert!(replay
        .input_data_identities
        .iter()
        .all(|identity| identity.relation_fingerprint == current_relation));
    assert!(replay.outputs.iter().all(|output| {
        output.schema_version == Some(BOUND_TRAINING_OUTPUT_SCHEMA_VERSION)
            && !output.predictions.is_empty()
            && output.predictions.iter().all(|block| {
                block.partition == PredictionPartition::Final
                    && block.fold_id.is_none()
                    && block.producer_port.as_deref() == Some(output.binding.port_name.as_str())
            })
    }));
    assert_eq!(
        replay.prediction_block_count,
        replay
            .outputs
            .iter()
            .map(|output| output.predictions.len())
            .sum::<usize>()
    );
    assert!(state.count(Phase::Predict, "model:base") > 0);
}

#[test]
fn native_calibration_refuses_training_cohort_reuse() {
    let fixture = fixture(true, false);
    let state = Arc::new(CallState::default());
    let mut store = InMemoryArtifactStore::new();
    let mut source = run(&fixture, state.clone(), &provider(&fixture), &mut store)
        .expect("source training outcome");
    let calibration_relation_fingerprint = fixture.relations.fingerprint().unwrap();
    let envelopes = replay_envelopes_with_relation(&source, &calibration_relation_fingerprint);
    let request = replay_request(&source, Phase::Predict);
    let controllers = controllers(&fixture, state.clone(), true);
    let replay = execute_attached_training_replay(AttachedTrainingReplayInput {
        source: &source,
        request: &request,
        outcome_id: "replay:calibration.input".to_string(),
        run_id: RunId::new("run:calibration.input").unwrap(),
        controllers: &controllers,
        data_provider: &provider(&fixture),
        artifact_store: &store,
        data_envelopes: &envelopes,
        warnings: Vec::new(),
        diagnostics: BTreeMap::new(),
    })
    .expect("calibration replay");
    let point = &replay.outputs[0].predictions[0];
    let mut cohort = ConformalCalibrationCohort {
        role: "calibration".to_string(),
        physical_sample_ids: point.sample_ids.clone(),
        origin_sample_ids: Vec::new(),
        target_names: replay.outputs[0].binding.target_names.clone(),
        manifest_fingerprint: String::new(),
    };
    cohort.manifest_fingerprint = cohort.compute_fingerprint().unwrap();
    let mut context = ConformalCalibrationContext {
        predictor_binding_fingerprint: replay.outputs[0].binding.binding_fingerprint.clone(),
        source_training_outcome_fingerprint: source.outcome_fingerprint.clone(),
        calibration_replay_outcome_fingerprint: replay.outcome_fingerprint.clone(),
        data_identities_fingerprint: source.data_identities_fingerprint().unwrap(),
        fold_set_fingerprint: dag_ml_core::fold::fold_set_fingerprint(
            source.effective_plan.fold_set.as_ref().unwrap(),
        )
        .unwrap(),
        training_influence_fingerprint: source.training_influence.manifest_fingerprint.clone(),
        relation_fingerprint: source.training_influence.relation_fingerprint.clone(),
        calibration_cohort: cohort,
        context_fingerprint: String::new(),
    };
    context.context_fingerprint = context.compute_fingerprint().unwrap();
    let error = calibrate_attached_training_replay(
        &mut source,
        &replay,
        replay.outputs[0].binding.binding_id.as_str(),
        &fixture.relations,
        ConformalCalibrationTruth {
            sample_ids: point.sample_ids.clone(),
            values: point.values.clone(),
        },
        context,
        vec![0.5],
        ConformalMultiTargetPolicy::Marginal,
        ConformalSmallSamplePolicy::Error,
    )
    .expect_err("calibration must not reuse a training cohort");
    assert!(
        error.to_string().contains("overlaps training influence"),
        "{error}"
    );
    assert!(source.conformal_calibration.is_none());
}

#[test]
fn loaded_v2_conformal_package_replays_intervals_and_rejects_resigned_tampering() {
    let fixture = fixture(true, false);
    let state = Arc::new(CallState::default());
    let calibration_sample_ids = (1..=4)
        .map(|index| sample(&format!("sample:calibration:{index}")))
        .collect::<Vec<_>>();
    *state.predict_sample_ids.lock().unwrap() = Some(calibration_sample_ids.clone());
    let mut store = InMemoryArtifactStore::new();
    let mut source = run(&fixture, state.clone(), &provider(&fixture), &mut store)
        .expect("source training outcome");
    let relations = calibration_relations(&calibration_sample_ids);
    let envelopes = replay_envelopes_with_relations(&source, &relations);
    let calibration_request = replay_request(&source, Phase::Predict);
    let controllers = controllers(&fixture, state.clone(), true);
    let calibration_replay = execute_attached_training_replay(AttachedTrainingReplayInput {
        source: &source,
        request: &calibration_request,
        outcome_id: "replay:calibration.v2".to_string(),
        run_id: RunId::new("run:calibration.v2").unwrap(),
        controllers: &controllers,
        data_provider: &provider(&fixture),
        artifact_store: &store,
        data_envelopes: &envelopes,
        warnings: Vec::new(),
        diagnostics: BTreeMap::new(),
    })
    .expect("calibration replay");
    let point = &calibration_replay.outputs[0].predictions[0];
    let context = derive_attached_conformal_calibration_context(
        &source,
        &calibration_replay,
        calibration_replay.outputs[0].binding.binding_id.as_str(),
        &relations,
    )
    .expect("native coordinator derives the calibration provenance closure");
    assert_eq!(
        context,
        calibration_context(&source, &calibration_replay, &relations)
    );
    let calibration = calibrate_attached_training_replay(
        &mut source,
        &calibration_replay,
        calibration_replay.outputs[0].binding.binding_id.as_str(),
        &relations,
        ConformalCalibrationTruth {
            sample_ids: point.sample_ids.clone(),
            values: vec![vec![1.0], vec![2.0], vec![3.0], vec![4.0]],
        },
        context,
        vec![0.5],
        ConformalMultiTargetPolicy::Marginal,
        ConformalSmallSamplePolicy::Error,
    )
    .expect("authoritative calibration attachment");
    assert_eq!(
        calibration.context.relation_fingerprint,
        relations.fingerprint().unwrap()
    );
    source.validate().unwrap();
    assert_eq!(
        source.conformal_calibration_replay.as_ref(),
        Some(&calibration_replay)
    );

    let development_relation_fingerprint = source.training_influence.relation_fingerprint.clone();
    let mut equal_relation_outcome = source.clone();
    rewrite_replay_relation_fingerprint(
        equal_relation_outcome
            .conformal_calibration_replay
            .as_mut()
            .unwrap(),
        &development_relation_fingerprint,
    );
    equal_relation_outcome
        .conformal_calibration
        .as_mut()
        .unwrap()
        .context
        .relation_fingerprint = development_relation_fingerprint.clone();
    resign_outcome_conformal_closure(&mut equal_relation_outcome);
    assert!(equal_relation_outcome
        .validate()
        .unwrap_err()
        .to_string()
        .contains("distinct from development relations"));

    let influenced_sample = source.training_influence.entries[0].physical_sample_ids[0].clone();
    let mut overlapping_outcome = source.clone();
    let binding_id = overlapping_outcome
        .conformal_calibration
        .as_ref()
        .unwrap()
        .binding_id
        .clone();
    overlapping_outcome
        .conformal_calibration_replay
        .as_mut()
        .unwrap()
        .outputs
        .iter_mut()
        .find(|output| output.binding.binding_id == binding_id)
        .unwrap()
        .predictions[0]
        .sample_ids[0] = influenced_sample.clone();
    resign_replay_outcome(
        overlapping_outcome
            .conformal_calibration_replay
            .as_mut()
            .unwrap(),
    );
    let overlapping_calibration = overlapping_outcome.conformal_calibration.as_mut().unwrap();
    overlapping_calibration.sample_ids[0] = influenced_sample.clone();
    overlapping_calibration
        .context
        .calibration_cohort
        .physical_sample_ids[0] = influenced_sample.clone();
    overlapping_calibration
        .context
        .calibration_cohort
        .manifest_fingerprint = overlapping_calibration
        .context
        .calibration_cohort
        .compute_fingerprint()
        .unwrap();
    resign_outcome_conformal_closure(&mut overlapping_outcome);
    assert!(overlapping_outcome
        .validate()
        .unwrap_err()
        .to_string()
        .contains("overlaps training influence closure"));

    let mut foreign_outcome = source.clone();
    let foreign_calibration = foreign_outcome.conformal_calibration.as_mut().unwrap();
    foreign_calibration
        .context
        .source_training_outcome_fingerprint = "f".repeat(64);
    resign_runtime_calibration(foreign_calibration);
    foreign_outcome.execution_bundle.conformal_calibration =
        Some(foreign_calibration.reference().unwrap());
    resign_outcome(&mut foreign_outcome);
    assert!(foreign_outcome
        .validate()
        .unwrap_err()
        .to_string()
        .contains("pre-calibration source"));

    let package = source
        .to_portable_predictor_package(
            "predictor:conformal.v2",
            FittedArtifactMode::AllowHostSidecar,
            ArtifactLoadMode::HostSidecar,
        )
        .expect("V2 conformal package");
    let package = PortablePredictorPackage::from_json(
        &serde_json::to_string(&package).expect("serialize V2 package"),
    )
    .expect("load strict V2 package");
    assert_eq!(
        package.conformal_calibration_replay.as_ref(),
        Some(&calibration_replay)
    );

    let mut equal_relation_package = package.clone();
    rewrite_replay_relation_fingerprint(
        equal_relation_package
            .conformal_calibration_replay
            .as_mut()
            .unwrap(),
        &development_relation_fingerprint,
    );
    equal_relation_package
        .conformal_calibration
        .as_mut()
        .unwrap()
        .context
        .relation_fingerprint = development_relation_fingerprint.clone();
    resign_package_conformal_closure(&mut equal_relation_package);
    assert!(equal_relation_package
        .validate()
        .unwrap_err()
        .to_string()
        .contains("distinct from development relations"));

    let mut overlapping_package = package.clone();
    let binding_id = overlapping_package
        .conformal_calibration
        .as_ref()
        .unwrap()
        .binding_id
        .clone();
    overlapping_package
        .conformal_calibration_replay
        .as_mut()
        .unwrap()
        .outputs
        .iter_mut()
        .find(|output| output.binding.binding_id == binding_id)
        .unwrap()
        .predictions[0]
        .sample_ids[0] = influenced_sample.clone();
    resign_replay_outcome(
        overlapping_package
            .conformal_calibration_replay
            .as_mut()
            .unwrap(),
    );
    let overlapping_calibration = overlapping_package.conformal_calibration.as_mut().unwrap();
    overlapping_calibration.sample_ids[0] = influenced_sample.clone();
    overlapping_calibration
        .context
        .calibration_cohort
        .physical_sample_ids[0] = influenced_sample;
    overlapping_calibration
        .context
        .calibration_cohort
        .manifest_fingerprint = overlapping_calibration
        .context
        .calibration_cohort
        .compute_fingerprint()
        .unwrap();
    resign_package_conformal_closure(&mut overlapping_package);
    assert!(overlapping_package
        .validate()
        .unwrap_err()
        .to_string()
        .contains("overlaps training influence closure"));

    let mut foreign_replay_package = package.clone();
    let foreign_replay = foreign_replay_package
        .conformal_calibration_replay
        .as_mut()
        .unwrap();
    foreign_replay.source_training_outcome.outcome_fingerprint = "f".repeat(64);
    let mut foreign_request = TrainingReplayRequest {
        schema_version: TRAINING_REPLAY_REQUEST_SCHEMA_VERSION,
        request_id: foreign_replay.replay_request_id.clone(),
        source_outcome_fingerprint: foreign_replay
            .source_training_outcome
            .outcome_fingerprint
            .clone(),
        phase: foreign_replay.phase,
        data_envelope_keys: foreign_replay
            .input_data_identities
            .iter()
            .map(|identity| identity.requirement_key.clone())
            .collect(),
        output_binding_ids: foreign_replay
            .outputs
            .iter()
            .map(|output| output.binding.binding_id.clone())
            .collect(),
        request_fingerprint: "0".repeat(64),
    };
    foreign_request.request_fingerprint = foreign_request.compute_fingerprint().unwrap();
    foreign_replay.replay_request_fingerprint = foreign_request.request_fingerprint;
    resign_replay_outcome(foreign_replay);
    resign_package_conformal_closure(&mut foreign_replay_package);
    assert!(foreign_replay_package
        .validate()
        .unwrap_err()
        .to_string()
        .contains("cross-link package provenance"));

    let mut injected_output_package = package.clone();
    let persisted_replay = injected_output_package
        .conformal_calibration_replay
        .as_mut()
        .unwrap();
    let mut foreign_output = persisted_replay.outputs[0].clone();
    foreign_output.binding.binding_id = "zz:foreign.calibration.output".to_string();
    foreign_output.binding.binding_fingerprint = "0".repeat(64);
    foreign_output.binding.binding_fingerprint =
        foreign_output.binding.compute_fingerprint().unwrap();
    persisted_replay.prediction_block_count += foreign_output.predictions.len();
    persisted_replay.observation_prediction_block_count +=
        foreign_output.observation_predictions.len();
    persisted_replay.aggregated_prediction_block_count +=
        foreign_output.aggregated_predictions.len();
    persisted_replay.outputs.push(foreign_output);
    let mut injected_request = TrainingReplayRequest {
        schema_version: TRAINING_REPLAY_REQUEST_SCHEMA_VERSION,
        request_id: persisted_replay.replay_request_id.clone(),
        source_outcome_fingerprint: persisted_replay
            .source_training_outcome
            .outcome_fingerprint
            .clone(),
        phase: persisted_replay.phase,
        data_envelope_keys: persisted_replay
            .input_data_identities
            .iter()
            .map(|identity| identity.requirement_key.clone())
            .collect(),
        output_binding_ids: persisted_replay
            .outputs
            .iter()
            .map(|output| output.binding.binding_id.clone())
            .collect(),
        request_fingerprint: "0".repeat(64),
    };
    injected_request.request_fingerprint = injected_request.compute_fingerprint().unwrap();
    persisted_replay.replay_request_fingerprint = injected_request.request_fingerprint;
    resign_replay_outcome(persisted_replay);
    resign_package_conformal_closure(&mut injected_output_package);
    assert!(injected_output_package
        .validate()
        .unwrap_err()
        .to_string()
        .contains("output binding absent from the package"));
    let loaded = package
        .clone()
        .load_with(|record| {
            store
                .get(&record.artifact.id)
                .map(|record| record.handle.clone())
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation(format!(
                        "missing sidecar handle for `{}`",
                        record.artifact.id
                    ))
                })
        })
        .unwrap();

    let production_sample_ids = vec![sample("sample:production:1"), sample("sample:production:2")];
    *state.predict_sample_ids.lock().unwrap() = Some(production_sample_ids.clone());
    let production_relations = calibration_relations(&production_sample_ids);
    let production_envelopes = replay_envelopes_with_relations(&source, &production_relations);
    let production_request = replay_request(&source, Phase::Predict);
    let replay = execute_loaded_predictor_replay(LoadedPredictorReplayInput {
        predictor: &loaded,
        request: &production_request,
        outcome_id: "replay:loaded.conformal.v2".to_string(),
        run_id: RunId::new("run:loaded.conformal.v2").unwrap(),
        controllers: &controllers,
        data_provider: &provider(&fixture),
        data_envelopes: &production_envelopes,
        warnings: Vec::new(),
        diagnostics: BTreeMap::new(),
    })
    .expect("loaded V2 predictor replay");
    assert_eq!(
        replay.schema_version,
        TRAINING_REPLAY_OUTCOME_SCHEMA_VERSION
    );
    assert_eq!(replay.conformal_intervals.len(), 1);
    assert_eq!(
        replay.conformal_intervals[0].sample_ids,
        production_sample_ids
    );
    replay
        .validate_against_package(loaded.package(), &production_request)
        .unwrap();
    let presentation =
        build_conformal_presentation_v1(loaded.package(), &production_request, &replay)
            .expect("native conformal presentation");
    assert_eq!(presentation.sample_ids, production_sample_ids);
    assert_eq!(presentation.point_predictions.len(), 2);
    assert_eq!(presentation.intervals.len(), 1);
    assert_eq!(presentation.intervals[0].lower.len(), 2);
    assert_eq!(
        ConformalPresentationV1::from_json(&serde_json::to_string(&presentation).unwrap()).unwrap(),
        presentation
    );

    // A production PREDICT cohort has no authoritative y_true.  V3 preserves
    // that target-free identity while applying intervals derived from the
    // separately attested calibration cohort; it must not fabricate a target
    // fingerprint merely to satisfy the conformal closure.
    let mut target_free_replay = replay.clone();
    for identity in &mut target_free_replay.input_data_identities {
        identity.target_content_fingerprint = None;
        identity.identity_fingerprint = identity.compute_fingerprint().unwrap();
    }
    target_free_replay.outcome_fingerprint = target_free_replay.compute_fingerprint().unwrap();
    target_free_replay
        .validate_against_package(loaded.package(), &production_request)
        .unwrap();

    let mut deleted = replay.clone();
    deleted.conformal_intervals.clear();
    resign_replay_outcome(&mut deleted);
    assert!(deleted
        .validate_against_package(loaded.package(), &production_request)
        .unwrap_err()
        .to_string()
        .contains("exactly cover"));

    let mut injected = replay.clone();
    injected
        .conformal_intervals
        .push(injected.conformal_intervals[0].clone());
    resign_replay_outcome(&mut injected);
    assert!(injected
        .validate_against_package(loaded.package(), &production_request)
        .unwrap_err()
        .to_string()
        .contains("exactly cover"));

    let mut transplant = package.clone();
    let foreign = transplant.conformal_calibration.as_mut().unwrap();
    foreign.context.source_training_outcome_fingerprint = "f".repeat(64);
    resign_runtime_calibration(foreign);
    transplant.execution_bundle.conformal_calibration = Some(foreign.reference().unwrap());
    resign_package(&mut transplant);
    assert!(transplant
        .validate()
        .unwrap_err()
        .to_string()
        .contains("cross-link package provenance"));

    let mut v1_with_conformal = package;
    v1_with_conformal.schema_version = LEGACY_PORTABLE_PREDICTOR_PACKAGE_SCHEMA_VERSION;
    resign_package(&mut v1_with_conformal);
    assert!(v1_with_conformal
        .validate()
        .unwrap_err()
        .to_string()
        .contains("V1 cannot carry conformal state"));
}

#[test]
fn calibration_attachment_rejects_missing_ambiguous_and_forged_origin_authority() {
    let fixture = fixture(true, false);
    let state = Arc::new(CallState::default());
    let sample_ids = (1..=4)
        .map(|index| sample(&format!("sample:authority:{index}")))
        .collect::<Vec<_>>();
    *state.predict_sample_ids.lock().unwrap() = Some(sample_ids.clone());
    let mut store = InMemoryArtifactStore::new();
    let mut source = run(&fixture, state.clone(), &provider(&fixture), &mut store).unwrap();
    let controllers = controllers(&fixture, state, true);
    let request = replay_request(&source, Phase::Predict);
    let replay_for = |source: &TrainingOutcome, relations: &SampleRelationSet, suffix: &str| {
        let envelopes = replay_envelopes_with_relations(source, relations);
        execute_attached_training_replay(AttachedTrainingReplayInput {
            source,
            request: &request,
            outcome_id: format!("replay:authority.{suffix}"),
            run_id: RunId::new(format!("run:authority.{suffix}")).unwrap(),
            controllers: &controllers,
            data_provider: &provider(&fixture),
            artifact_store: &store,
            data_envelopes: &envelopes,
            warnings: Vec::new(),
            diagnostics: BTreeMap::new(),
        })
        .unwrap()
    };

    let mut missing = calibration_relations(&sample_ids);
    missing.records.pop();
    let replay = replay_for(&source, &missing, "missing");
    let point = &replay.outputs[0].predictions[0];
    let context = calibration_context(&source, &replay, &missing);
    let error = calibrate_attached_training_replay(
        &mut source,
        &replay,
        replay.outputs[0].binding.binding_id.as_str(),
        &missing,
        ConformalCalibrationTruth {
            sample_ids: point.sample_ids.clone(),
            values: point.values.clone(),
        },
        context,
        vec![0.5],
        ConformalMultiTargetPolicy::Marginal,
        ConformalSmallSamplePolicy::Error,
    )
    .unwrap_err();
    assert!(error.to_string().contains("absent from relation authority"));

    let mut ambiguous = calibration_relations(&sample_ids);
    let mut conflicting = ambiguous.records[0].clone();
    conflicting.observation_id = ObservationId::new("observation:authority:conflict").unwrap();
    conflicting.origin_sample_id = Some(sample("origin:authority:conflict"));
    ambiguous.records.push(conflicting);
    let replay = replay_for(&source, &ambiguous, "ambiguous");
    let point = &replay.outputs[0].predictions[0];
    let context = calibration_context(&source, &replay, &ambiguous);
    let error = calibrate_attached_training_replay(
        &mut source,
        &replay,
        replay.outputs[0].binding.binding_id.as_str(),
        &ambiguous,
        ConformalCalibrationTruth {
            sample_ids: point.sample_ids.clone(),
            values: point.values.clone(),
        },
        context,
        vec![0.5],
        ConformalMultiTargetPolicy::Marginal,
        ConformalSmallSamplePolicy::Error,
    )
    .unwrap_err();
    assert!(error.to_string().contains("ambiguous origin relations"));

    let relations = calibration_relations(&sample_ids);
    let replay = replay_for(&source, &relations, "forged");
    let point = &replay.outputs[0].predictions[0];
    for inject in [false, true] {
        let mut context = calibration_context(&source, &replay, &relations);
        if inject {
            context
                .calibration_cohort
                .origin_sample_ids
                .push(sample("origin:authority:injected"));
        } else {
            context.calibration_cohort.origin_sample_ids.pop();
        }
        context.calibration_cohort.origin_sample_ids.sort();
        context.calibration_cohort.manifest_fingerprint =
            context.calibration_cohort.compute_fingerprint().unwrap();
        context.context_fingerprint = context.compute_fingerprint().unwrap();
        let error = calibrate_attached_training_replay(
            &mut source,
            &replay,
            replay.outputs[0].binding.binding_id.as_str(),
            &relations,
            ConformalCalibrationTruth {
                sample_ids: point.sample_ids.clone(),
                values: point.values.clone(),
            },
            context,
            vec![0.5],
            ConformalMultiTargetPolicy::Marginal,
            ConformalSmallSamplePolicy::Error,
        )
        .unwrap_err();
        assert!(error.to_string().contains("origin closure"), "{error}");
    }

    let mut context = calibration_context(&source, &replay, &relations);
    context.relation_fingerprint = "e".repeat(64);
    context.context_fingerprint = context.compute_fingerprint().unwrap();
    let error = calibrate_attached_training_replay(
        &mut source,
        &replay,
        replay.outputs[0].binding.binding_id.as_str(),
        &relations,
        ConformalCalibrationTruth {
            sample_ids: point.sample_ids.clone(),
            values: point.values.clone(),
        },
        context,
        vec![0.5],
        ConformalMultiTargetPolicy::Marginal,
        ConformalSmallSamplePolicy::Error,
    )
    .unwrap_err();
    assert!(error.to_string().contains("relation authority"));

    let mut non_predict = replay.clone();
    non_predict.phase = Phase::Explain;
    let context = calibration_context(&source, &replay, &relations);
    let error = calibrate_attached_training_replay(
        &mut source,
        &non_predict,
        replay.outputs[0].binding.binding_id.as_str(),
        &relations,
        ConformalCalibrationTruth {
            sample_ids: point.sample_ids.clone(),
            values: point.values.clone(),
        },
        context,
        vec![0.5],
        ConformalMultiTargetPolicy::Marginal,
        ConformalSmallSamplePolicy::Error,
    )
    .unwrap_err();
    assert!(error.to_string().contains("requires a PREDICT replay"));
    assert!(source.conformal_calibration.is_none());
}

#[test]
fn calibration_attachment_rejects_development_relation_authority_with_disjoint_extra_rows() {
    let mut fixture = fixture(true, false);
    let state = Arc::new(CallState::default());
    let calibration_sample_ids = (1..=4)
        .map(|index| sample(&format!("sample:shared-authority:{index}")))
        .collect::<Vec<_>>();
    fixture
        .relations
        .records
        .extend(calibration_relations(&calibration_sample_ids).records);
    fixture.relations.records.sort_by(|left, right| {
        left.observation_id
            .as_str()
            .cmp(right.observation_id.as_str())
    });
    let shared_relation_fingerprint = fixture.relations.fingerprint().unwrap();
    for bindings in fixture.request.campaign.data_bindings.values_mut() {
        for binding in bindings {
            binding.relation_fingerprint = Some(shared_relation_fingerprint.clone());
        }
    }
    for identity in &mut fixture.request.data_identities {
        identity.relation_fingerprint = shared_relation_fingerprint.clone();
        identity.identity_fingerprint = "0".repeat(64);
        identity.identity_fingerprint = identity.compute_fingerprint().unwrap();
    }
    rebuild(&mut fixture);
    *state.predict_sample_ids.lock().unwrap() = Some(calibration_sample_ids);
    let mut store = InMemoryArtifactStore::new();
    let mut source = run(&fixture, state.clone(), &provider(&fixture), &mut store).unwrap();
    let envelopes = replay_envelopes_with_relations(&source, &fixture.relations);
    let request = replay_request(&source, Phase::Predict);
    let controllers = controllers(&fixture, state, true);
    let replay = execute_attached_training_replay(AttachedTrainingReplayInput {
        source: &source,
        request: &request,
        outcome_id: "replay:shared-authority".to_string(),
        run_id: RunId::new("run:shared-authority").unwrap(),
        controllers: &controllers,
        data_provider: &provider(&fixture),
        artifact_store: &store,
        data_envelopes: &envelopes,
        warnings: Vec::new(),
        diagnostics: BTreeMap::new(),
    })
    .unwrap();
    let point = &replay.outputs[0].predictions[0];
    let context = calibration_context(&source, &replay, &fixture.relations);
    let error = calibrate_attached_training_replay(
        &mut source,
        &replay,
        replay.outputs[0].binding.binding_id.as_str(),
        &fixture.relations,
        ConformalCalibrationTruth {
            sample_ids: point.sample_ids.clone(),
            values: point.values.clone(),
        },
        context,
        vec![0.5],
        ConformalMultiTargetPolicy::Marginal,
        ConformalSmallSamplePolicy::Error,
    )
    .unwrap_err();
    assert!(
        error
            .to_string()
            .contains("distinct from development relations"),
        "{error}"
    );
    assert!(source.conformal_calibration.is_none());
}

#[test]
fn attached_training_replay_explain_emits_explanations_without_outputs() {
    let mut fixture = fixture(true, false);
    add_model_probability_port(&mut fixture);
    add_explain_support(&mut fixture);
    let state = Arc::new(CallState::default());
    *state.emit_explicit_model_ports.lock().unwrap() = true;
    let mut store = InMemoryArtifactStore::new();
    let source = run(&fixture, state.clone(), &provider(&fixture), &mut store)
        .expect("source training outcome");
    assert!(source.replayable_phases.contains(&Phase::Explain));

    let current_relation = "e".repeat(64);
    let envelopes = replay_envelopes_with_relation(&source, &current_relation);
    let request = replay_request(&source, Phase::Explain);
    let controllers = controllers(&fixture, state.clone(), true);

    let replay = execute_attached_training_replay(AttachedTrainingReplayInput {
        source: &source,
        request: &request,
        outcome_id: "replay:attached.explain.outcome".to_string(),
        run_id: RunId::new("run:attached.explain").unwrap(),
        controllers: &controllers,
        data_provider: &provider(&fixture),
        artifact_store: &store,
        data_envelopes: &envelopes,
        warnings: Vec::new(),
        diagnostics: BTreeMap::new(),
    })
    .expect("attached explain replay");

    assert_eq!(replay.phase, Phase::Explain);
    assert!(replay.outputs.is_empty());
    assert_eq!(replay.explanation_block_count, replay.explanations.len());
    assert!(replay.explanations.iter().any(|block| {
        block.producer_node.as_str() == "model:base"
            && block.producer_port.as_deref() == Some("oof")
            && block.method == "fixture_explain"
    }));
    assert!(replay
        .input_data_identities
        .iter()
        .all(|identity| identity.relation_fingerprint == current_relation));
    assert!(state.count(Phase::Explain, "model:base") > 0);
}

#[test]
fn cv_ensemble_excludes_non_validation_fit_cv_blocks_and_refit_stays_final() {
    let no_refit = fixture(false, false);
    let no_refit_state = Arc::new(CallState::default());
    *no_refit_state.emit_extra_fit_cv_partitions.lock().unwrap() = true;
    let mut no_refit_store = InMemoryArtifactStore::new();
    let no_refit_outcome = run(
        &no_refit,
        no_refit_state.clone(),
        &provider(&no_refit),
        &mut no_refit_store,
    )
    .unwrap();
    let cv_output = &no_refit_outcome.outputs[0];
    assert_eq!(
        cv_output.binding.prediction_source,
        PredictionSource::CvEnsemble
    );
    assert_eq!(
        cv_output.predictions.len(),
        2,
        "the selected rerun keeps one Validation block per fold"
    );
    assert!(
        cv_output
            .predictions
            .iter()
            .all(|block| block.partition == PredictionPartition::Validation),
        "Train/Final FIT_CV blocks must not enter a cv_ensemble output"
    );
    assert!(
        !cv_output.aggregated_predictions.is_empty()
            && cv_output
                .aggregated_predictions
                .iter()
                .all(|block| block.partition == PredictionPartition::Validation),
        "the Validation OOF average remains present"
    );
    assert!(no_refit_state.count(Phase::FitCv, "model:base") > 0);

    for invalid_partition in [
        PredictionPartition::Train,
        PredictionPartition::Test,
        PredictionPartition::Final,
    ] {
        let mut tampered = no_refit_outcome.clone();
        tampered.outputs[0].predictions[0].partition = invalid_partition.clone();
        resign_outcome(&mut tampered);
        let error = TrainingOutcome::from_json(&serde_json::to_string(&tampered).unwrap())
            .expect_err("a re-signed cv_ensemble cannot contain a non-Validation block");
        assert!(
            error
                .to_string()
                .contains("cv_ensemble output blocks must use validation partition"),
            "unexpected {invalid_partition:?} rejection: {error}"
        );
    }
    let mut missing_fold = no_refit_outcome.clone();
    missing_fold.outputs[0].predictions[0].fold_id = None;
    resign_outcome(&mut missing_fold);
    let error = TrainingOutcome::from_json(&serde_json::to_string(&missing_fold).unwrap())
        .expect_err("a cv_ensemble Validation block must identify its fold or avg reduction");
    assert!(
        error
            .to_string()
            .contains("cv_ensemble output blocks must use validation partition with a fold id"),
        "unexpected missing-fold rejection: {error}"
    );

    let refit = fixture(true, false);
    let refit_state = Arc::new(CallState::default());
    *refit_state.emit_extra_fit_cv_partitions.lock().unwrap() = true;
    let mut refit_store = InMemoryArtifactStore::new();
    let refit_outcome = run(&refit, refit_state, &provider(&refit), &mut refit_store).unwrap();
    let final_output = &refit_outcome.outputs[0];
    assert_eq!(
        final_output.binding.prediction_source,
        PredictionSource::FinalRefit
    );
    assert!(
        !final_output.predictions.is_empty()
            && final_output.predictions.iter().all(|block| {
                block.partition == PredictionPartition::Final && block.fold_id.is_none()
            }),
        "FinalRefit remains Final-only even when FIT_CV emitted extra partitions"
    );
}

#[test]
fn stacking_cache_retention_and_discard_are_both_explicit() {
    let retained = fixture(false, true);
    let mut retained_store = InMemoryArtifactStore::new();
    let outcome = run(
        &retained,
        Arc::new(CallState::default()),
        &provider(&retained),
        &mut retained_store,
    )
    .unwrap();
    assert_eq!(outcome.execution_bundle.prediction_requirements.len(), 1);
    assert_eq!(outcome.execution_bundle.prediction_caches.len(), 1);
    let cache_record = &outcome.execution_bundle.prediction_caches[0];
    assert_eq!(
        outcome
            .portable_prediction_caches
            .as_ref()
            .unwrap()
            .caches
            .len(),
        1
    );
    let cache_payload = &outcome.portable_prediction_caches.as_ref().unwrap().caches[0];
    assert_eq!(
        cache_record.cache_namespace_fingerprints,
        cache_payload.cache_namespace_fingerprints
    );
    assert_eq!(
        cache_record.cache_namespace_fingerprints.len(),
        cache_record.blocks.len()
    );
    assert!(cache_record
        .cache_namespace_fingerprints
        .iter()
        .all(|fingerprint| fingerprint.len() == 64));
    let mut namespace_drift = cache_payload.clone();
    namespace_drift.cache_namespace_fingerprints[0] = "f".repeat(64);
    assert!(
        validate_prediction_cache_payload_matches_record(&namespace_drift, cache_record)
            .unwrap_err()
            .to_string()
            .contains("does not match cache record")
    );
    // The no-refit stacking outcome carries the full OOF triple (bundle
    // requirement + retained cache record + portable payload) for its in-closure
    // requires_oof edge, so REFIT replay is honestly self-contained.
    assert_eq!(outcome.replayable_phases, vec![Phase::Refit]);

    let mut discarded = fixture(true, true);
    discarded.request.options.artifacts.prediction_caches = PredictionCacheRetention::Discard;
    resign_request(&mut discarded.request);
    let projection = discarded.request.project().unwrap();
    discarded.influence = influence_manifest(&discarded.request, &projection, &discarded.relations);
    let mut discard_store = InMemoryArtifactStore::new();
    let discard_state = Arc::new(CallState::default());
    let error = run(
        &discarded,
        discard_state.clone(),
        &provider(&discarded),
        &mut discard_store,
    )
    .unwrap_err();
    assert!(error
        .to_string()
        .contains("requires retained prediction caches"));
    assert_eq!(discard_state.total(), 0);
    assert!(discard_store.is_empty());
}

#[test]
fn oof_refit_without_prediction_cohort_retains_explicit_artifact_only_binding() {
    let case = fixture(true, true);
    let state = Arc::new(CallState::default());
    *state.artifact_only_refit.lock().unwrap() = true;
    let mut store = InMemoryArtifactStore::new();
    let outcome = run(&case, state, &provider(&case), &mut store).unwrap();
    let output = &outcome.outputs[0];
    assert!(output.artifact_only);
    assert!(output.refit_test_cohort.is_none());
    assert!(output.predictions.is_empty());
    assert!(output.observation_predictions.is_empty());
    assert!(output.aggregated_predictions.is_empty());
    assert_eq!(
        output.binding.prediction_source,
        PredictionSource::FinalRefit
    );
    assert!(!outcome.oof_averages.is_empty());
    assert!(!outcome.execution_bundle.refit_artifacts.is_empty());
    assert!(outcome.to_reference().is_ok());
    assert_eq!(
        TrainingOutcome::from_json(&serde_json::to_string(&outcome).unwrap()).unwrap(),
        outcome
    );

    let mut missing_artifact = outcome.clone();
    missing_artifact
        .execution_bundle
        .refit_artifacts
        .retain(|record| record.node_id != output.binding.node_id);
    resign_outcome(&mut missing_artifact);
    assert!(missing_artifact.validate().is_err());
    let mut missing_lineage = outcome.clone();
    missing_lineage
        .lineage
        .retain(|record| record.node_id != output.binding.node_id || record.phase != Phase::Refit);
    resign_outcome(&mut missing_lineage);
    assert!(missing_lineage.validate().is_err());

    let missing = fixture(true, false);
    let state = Arc::new(CallState::default());
    *state.artifact_only_refit.lock().unwrap() = true;
    let mut store = InMemoryArtifactStore::new();
    let error = run(&missing, state, &provider(&missing), &mut store).unwrap_err();
    assert!(error.to_string().contains("contains no prediction block"));
    assert!(
        store.is_empty(),
        "missing raw predictions cannot commit a deployed output"
    );
}

#[test]
fn oof_refit_test_binding_revalidates_exact_disjoint_cohort_after_reload() {
    let fixture = fixture(true, true);
    let mut store = InMemoryArtifactStore::new();
    let mut outcome = run(
        &fixture,
        Arc::new(CallState::default()),
        &provider(&fixture),
        &mut store,
    )
    .unwrap();
    let cohort = PredictCohort::from_relations(
        PredictCohortRole::ExternalTest,
        SampleRelationSet {
            records: vec![SampleRelation::new(
                ObservationId::new("observation:test").unwrap(),
                sample("sample:test"),
            )],
        },
        vec!["protein".to_string()],
        "c".repeat(64),
        Some("d".repeat(64)),
    )
    .unwrap();
    let output = &mut outcome.outputs[0];
    let mut block = output.predictions[0].clone();
    block.partition = PredictionPartition::Test;
    block.fold_id = None;
    block.sample_ids = cohort.physical_sample_ids.clone();
    block.values = vec![vec![7.0]];
    output.predictions = vec![block];
    output.observation_predictions.clear();
    output.aggregated_predictions.clear();
    output.refit_test_cohort = Some(cohort);
    let mut test_report = outcome
        .score_set
        .reports
        .iter()
        .find(|report| {
            report.producer_node == outcome.outputs[0].binding.node_id
                && report.partition == PredictionPartition::Validation
                && report.variant_id.as_ref() == Some(&outcome.selected_variant_id)
        })
        .unwrap()
        .clone();
    test_report.partition = PredictionPartition::Test;
    test_report.fold_id = None;
    test_report.row_count = 1;
    test_report.prediction_id = outcome.outputs[0].predictions[0].prediction_id.clone();
    outcome.score_set.reports.push(test_report);
    outcome.execution_bundle.scores = Some(outcome.score_set.clone());
    resign_outcome(&mut outcome);
    assert_eq!(
        TrainingOutcome::from_json(&serde_json::to_string(&outcome).unwrap()).unwrap(),
        outcome
    );

    for mutation in [
        "training_id",
        "fold",
        "final",
        "missing_block",
        "artifact_only",
        "missing_cohort",
        "hide_test_reports",
        "wrong_artifact_owner",
        "wrong_refit_variant",
        "duplicate_test_id",
        "training_origin",
    ] {
        let mut forged = outcome.clone();
        let output = &mut forged.outputs[0];
        match mutation {
            "training_id" => output.predictions[0].sample_ids = vec![sample("sample:1")],
            "fold" => output.predictions[0].fold_id = Some(FoldId::new("fold:0").unwrap()),
            "final" => output.predictions[0].partition = PredictionPartition::Final,
            "missing_block" => output.predictions.clear(),
            "artifact_only" => output.artifact_only = true,
            "missing_cohort" => output.refit_test_cohort = None,
            "hide_test_reports" => {
                output.predictions.clear();
                output.refit_test_cohort = None;
                output.artifact_only = true;
            }
            "wrong_artifact_owner" => {
                let node_id = output.binding.node_id.clone();
                let artifact = forged
                    .execution_bundle
                    .refit_artifacts
                    .iter_mut()
                    .find(|record| record.node_id == node_id)
                    .unwrap();
                artifact.controller_id = ControllerId::new("controller:forged").unwrap();
            }
            "wrong_refit_variant" => {
                let node_id = output.binding.node_id.clone();
                let lineage = forged
                    .lineage
                    .iter_mut()
                    .find(|record| record.node_id == node_id && record.phase == Phase::Refit)
                    .unwrap();
                lineage.variant_id = Some(VariantId::new("variant:forged").unwrap());
            }
            "duplicate_test_id" => {
                output.predictions[0].sample_ids.push(sample("sample:test"));
                output.predictions[0].values.push(vec![7.0]);
            }
            "training_origin" => {
                let cohort = output.refit_test_cohort.as_mut().unwrap();
                cohort.relations.records[0].origin_sample_id = Some(sample("sample:1"));
                cohort.origin_sample_ids = vec![sample("sample:1")];
                cohort.relation_fingerprint = cohort.relations.fingerprint().unwrap();
                cohort.cohort_fingerprint = cohort.fingerprint().unwrap();
            }
            _ => unreachable!(),
        }
        resign_outcome(&mut forged);
        assert!(
            forged.validate().is_err(),
            "forged REFIT Test scope accepted: {mutation}"
        );
    }
    let mut missing_cv = outcome.clone();
    missing_cv
        .score_set
        .reports
        .retain(|report| report.partition != PredictionPartition::Validation);
    missing_cv.execution_bundle.scores = Some(missing_cv.score_set.clone());
    resign_outcome(&mut missing_cv);
    assert!(
        missing_cv.validate().is_err(),
        "Test predictions must never replace SELECT OOF evidence"
    );
}

#[test]
fn explicit_selection_output_controls_multi_producer_ranking() {
    let fixture = fixture(false, true);
    let state = Arc::new(CallState::default());
    *state.score_auxiliary.lock().unwrap() = true;
    let mut store = InMemoryArtifactStore::new();
    let outcome = run(&fixture, state, &provider(&fixture), &mut store).unwrap();
    assert_eq!(outcome.selection_output_id, "output:prediction");
    assert_eq!(outcome.selected_variant_id, fixture.preferred);
    assert_eq!(
        outcome
            .score_set
            .reports
            .iter()
            .filter(|report| {
                report.partition == PredictionPartition::Validation
                    && report
                        .fold_id
                        .as_ref()
                        .is_some_and(|fold| fold.as_str() == "avg")
            })
            .map(|report| report.producer_node.clone())
            .collect::<BTreeSet<_>>()
            .len(),
        2
    );
    let decision = outcome.execution_bundle.selections.values().next().unwrap();
    assert_eq!(decision.selected_candidate_id, fixture.preferred.as_str());
}

#[test]
fn native_training_materializes_operator_parameter_patches_before_execution() {
    let mut fixture = fixture(true, false);
    fixture.request.parameter_patches = vec![ParameterPatch {
        schema_version: PARAMETER_PATCH_SCHEMA_VERSION,
        node_id: node("model:base"),
        namespace: ParameterNamespace::Operator,
        path: vec!["patched_bias".to_string()],
        value: serde_json::json!(20),
    }];
    fixture.request.patch_policies = vec![NodePatchPolicy {
        node_id: node("model:base"),
        allowed_namespaces: [ParameterNamespace::Operator].into_iter().collect(),
    }];
    rebuild(&mut fixture);

    let state = Arc::new(CallState::default());
    let mut store = InMemoryArtifactStore::new();
    let outcome = run(&fixture, state.clone(), &provider(&fixture), &mut store).unwrap();

    assert!(state
        .observed_model_patch_values
        .lock()
        .unwrap()
        .iter()
        .all(|value| value.as_ref() == Some(&serde_json::json!(20))));
    assert!(outcome.parameter_patches.iter().any(|patch| {
        patch.node_id.as_str() == "model:base"
            && patch.namespace == ParameterNamespace::Operator
            && patch.path == ["patched_bias".to_string()]
            && patch.value == serde_json::json!(20)
    }));
    let node_plan = &outcome.effective_plan.node_plans[&node("model:base")];
    assert_eq!(node_plan.params["patched_bias"], serde_json::json!(20));
    assert_eq!(
        node_plan.params_fingerprint,
        legacy_serde_fingerprint(&node_plan.params)
    );
    outcome.validate().unwrap();
}

#[test]
fn native_training_refuses_unexposed_or_structural_parameter_patches() {
    for (namespace, expected) in [
        (
            ParameterNamespace::Fit,
            "does not expose Fit parameter patches",
        ),
        (
            ParameterNamespace::Control,
            "does not expose Control parameter patches",
        ),
        (
            ParameterNamespace::Structural,
            "requires recompilation for structural parameter patches",
        ),
    ] {
        let mut fixture = fixture(true, false);
        fixture.request.parameter_patches = vec![ParameterPatch {
            schema_version: PARAMETER_PATCH_SCHEMA_VERSION,
            node_id: node("model:base"),
            namespace,
            path: vec!["patched_bias".to_string()],
            value: serde_json::json!(20),
        }];
        fixture.request.patch_policies = vec![NodePatchPolicy {
            node_id: node("model:base"),
            allowed_namespaces: [namespace].into_iter().collect(),
        }];
        rebuild(&mut fixture);
        let state = Arc::new(CallState::default());
        let mut store = InMemoryArtifactStore::new();
        let error = run(&fixture, state.clone(), &provider(&fixture), &mut store).unwrap_err();
        assert!(
            error.to_string().contains(expected),
            "unexpected error for {namespace:?}: {error}"
        );
        assert_eq!(state.total(), 0);
        assert!(store.is_empty());
    }
}

#[test]
fn outcome_rejects_selection_score_rank_and_producer_drift() {
    let fixture = fixture(false, false);
    let mut store = InMemoryArtifactStore::new();
    let outcome = run(
        &fixture,
        Arc::new(CallState::default()),
        &provider(&fixture),
        &mut store,
    )
    .unwrap();

    let mut selected_score = outcome.clone();
    selected_score
        .execution_bundle
        .selections
        .values_mut()
        .next()
        .unwrap()
        .selected_score += 0.25;
    resign_outcome(&mut selected_score);
    assert!(selected_score.validate().is_err());

    let mut ranked_score = outcome.clone();
    ranked_score
        .execution_bundle
        .selections
        .values_mut()
        .next()
        .unwrap()
        .ranked_candidates[1]
        .score += 0.25;
    resign_outcome(&mut ranked_score);
    assert!(ranked_score.validate().is_err());

    let mut objective = outcome.clone();
    objective
        .execution_bundle
        .selections
        .values_mut()
        .next()
        .unwrap()
        .objective = MetricObjective::Maximize;
    resign_outcome(&mut objective);
    assert!(objective.validate().is_err());

    let mut mixed_output = outcome.clone();
    let source = mixed_output.outputs[0].predictions[0].clone();
    mixed_output.outputs[0]
        .observation_predictions
        .push(ObservationPredictionBlock {
            prediction_id: Some("prediction:resigned-observation".to_string()),
            producer_node: source.producer_node,
            producer_port: None,
            partition: source.partition,
            fold_id: source.fold_id,
            observation_ids: vec![ObservationId::new("observation:resigned").unwrap()],
            values: vec![vec![0.0]],
            weights: Vec::new(),
            target_names: source.target_names,
        });
    resign_outcome(&mut mixed_output);
    assert!(mixed_output.validate().is_err());

    let mut producer = outcome;
    producer
        .score_set
        .reports
        .iter_mut()
        .find(|report| {
            report
                .fold_id
                .as_ref()
                .is_some_and(|fold| fold.as_str() == "avg")
        })
        .unwrap()
        .producer_node = node("transform:snv");
    producer.execution_bundle.scores = Some(producer.score_set.clone());
    resign_outcome(&mut producer);
    assert!(producer.validate().is_err());
}

#[test]
fn divergent_selected_rerun_is_rejected() {
    let fixture = fixture(true, false);
    let state = Arc::new(CallState::default());
    *state.divergent_rerun.lock().unwrap() = true;
    let mut store = InMemoryArtifactStore::new();
    let error = run(&fixture, state, &provider(&fixture), &mut store).unwrap_err();
    assert!(error.to_string().contains("rerun diverged"));
    assert!(store.is_empty());
}

#[test]
fn late_output_failure_does_not_commit_artifacts() {
    let fixture = fixture(true, false);
    let state = Arc::new(CallState::default());
    *state.invalid_refit_output.lock().unwrap() = true;
    let mut store = InMemoryArtifactStore::new();
    assert!(run(&fixture, state.clone(), &provider(&fixture), &mut store).is_err());
    assert!(state.count(Phase::FitCv, "model:base") > 0);
    assert_eq!(state.count(Phase::Refit, "model:base"), 1);
    assert!(store.is_empty());
}

#[test]
fn provider_identity_and_relation_mismatches_fail_before_controllers() {
    let fixture = fixture(true, false);
    let state = Arc::new(CallState::default());
    let mut bad_identity = fixture.request.data_identities[0].clone();
    bad_identity.data_content_fingerprint = "f".repeat(64);
    bad_identity.identity_fingerprint = "0".repeat(64);
    bad_identity.identity_fingerprint = bad_identity.compute_fingerprint().unwrap();
    let bad_identity_provider = AttestedProvider {
        identity: Some(bad_identity),
        relations: fixture.relations.clone(),
        contradictory_relations: None,
        omit_relations: false,
        next_handle: AtomicU64::new(0),
        methods_pls_enabled: false,
        methods_rows: BTreeMap::new(),
        methods_pls_feature_count: 2,
        methods_hpo_oof_target_offsets: BTreeMap::new(),
        fail_methods_hpo_trial_id: None,
    };
    let mut store = InMemoryArtifactStore::new();
    assert!(run(&fixture, state.clone(), &bad_identity_provider, &mut store).is_err());
    assert_eq!(state.total(), 0);

    let mut contradictory = relations();
    contradictory.records.pop();
    let bad_relations_provider = AttestedProvider {
        identity: Some(fixture.request.data_identities[0].clone()),
        relations: fixture.relations.clone(),
        contradictory_relations: Some(contradictory),
        omit_relations: false,
        next_handle: AtomicU64::new(0),
        methods_pls_enabled: false,
        methods_rows: BTreeMap::new(),
        methods_pls_feature_count: 2,
        methods_hpo_oof_target_offsets: BTreeMap::new(),
        fail_methods_hpo_trial_id: None,
    };
    assert!(run(&fixture, state.clone(), &bad_relations_provider, &mut store).is_err());
    assert_eq!(state.total(), 0);

    let mut provider = provider(&fixture);
    provider.omit_relations = true;
    assert!(run(&fixture, state.clone(), &provider, &mut store).is_err());
    assert_eq!(state.total(), 0);
}

#[test]
fn native_training_enforces_controller_influence_capability_scopes() {
    for (capability, kind, requirements) in [
        (
            ControllerCapability::UsesEarlyStopping,
            TrainingInfluenceKind::EarlyStopping,
            early_stopping_requirements(),
        ),
        (
            ControllerCapability::UsesTrainingWeights,
            TrainingInfluenceKind::WeightingResampling,
            full_scope_requirements(TrainingInfluenceKind::WeightingResampling, "weighting"),
        ),
        (
            ControllerCapability::PerformsInternalTuning,
            TrainingInfluenceKind::HpoSelection,
            full_scope_requirements(TrainingInfluenceKind::HpoSelection, "internal_hpo"),
        ),
    ] {
        let mut fixture = fixture(true, false);
        let model_manifest = fixture
            .request
            .controller_manifests
            .iter_mut()
            .find(|manifest| manifest.operator_kind == NodeKind::Model)
            .unwrap();
        model_manifest.capabilities.insert(capability);
        if capability == ControllerCapability::UsesTrainingWeights {
            model_manifest
                .capabilities
                .insert(ControllerCapability::SupportsSampleWeights);
        }
        fixture.request.influence_requirements = requirements;
        rebuild(&mut fixture);

        let state = Arc::new(CallState::default());
        let mut store = InMemoryArtifactStore::new();
        let outcome = run(&fixture, state, &provider(&fixture), &mut store).unwrap();
        assert_eq!(
            outcome
                .training_influence
                .entries
                .iter()
                .filter(|entry| entry.kind == kind && entry.node_id.is_some())
                .count(),
            3,
            "capability {capability:?} must contribute every fold/refit scope"
        );
        outcome.validate().unwrap();
    }
}

#[test]
fn native_training_rejects_missing_or_leaking_controller_influence_before_controllers() {
    assert_preflight_rejected(fixture(true, false), |request| {
        request
            .controller_manifests
            .iter_mut()
            .find(|manifest| manifest.operator_kind == NodeKind::Model)
            .unwrap()
            .capabilities
            .insert(ControllerCapability::UsesEarlyStopping);
    });

    assert_preflight_rejected(fixture(true, false), |request| {
        request
            .controller_manifests
            .iter_mut()
            .find(|manifest| manifest.operator_kind == NodeKind::Model)
            .unwrap()
            .capabilities
            .insert(ControllerCapability::UsesEarlyStopping);
        request.influence_requirements = early_stopping_requirements();
        request.influence_requirements[0].physical_sample_ids = vec![sample("sample:1")];
    });
}

#[test]
fn native_training_persists_runtime_derived_influence_evidence() {
    let fixture = fixture(true, false);
    let projection = fixture.request.project().unwrap();
    let expected = TrainingInfluenceManifest::derive_for_projection(
        &projection,
        &fixture.request,
        &fixture.relations,
    )
    .unwrap();
    let state = Arc::new(CallState::default());
    let mut store = InMemoryArtifactStore::new();
    let outcome = run(&fixture, state, &provider(&fixture), &mut store).unwrap();

    assert_eq!(outcome.training_influence, expected);
    assert!(outcome.training_influence.entries.iter().any(|entry| {
        entry.kind == TrainingInfluenceKind::HpoSelection
            && entry.node_id.is_none()
            && entry.scope_id.starts_with("select:")
            && entry.group_ids
                == vec![
                    GroupId::new("group:0").unwrap(),
                    GroupId::new("group:1").unwrap(),
                ]
    }));
    assert!(outcome.training_influence.entries.iter().all(|entry| {
        let unique_groups = entry.group_ids.iter().collect::<BTreeSet<_>>();
        !entry.physical_sample_ids.is_empty()
            && unique_groups.len() == entry.group_ids.len()
            && entry.group_ids.windows(2).all(|pair| pair[0] < pair[1])
    }));
    outcome.validate().unwrap();
}

#[test]
fn classification_selection_is_native_when_columns_are_coherent() {
    let mut fixture = fixture(false, false);
    fixture.request.options.selection.metric.name = "balanced_accuracy".to_string();
    fixture.request.options.selection.metric.objective = MetricObjective::Maximize;
    fixture.request.options.outputs[0].prediction_kind = PredictionKind::ClassLabel;
    fixture.request.options.outputs[0].class_labels = vec![vec!["0".to_string(), "1".to_string()]];
    resign_request(&mut fixture.request);
    let projection = fixture.request.project().unwrap();
    fixture.preferred = projection.plan.variants[0].variant_id.clone();
    fixture.influence = influence_manifest(&fixture.request, &projection, &fixture.relations);
    let mut store = InMemoryArtifactStore::new();
    let outcome = run(
        &fixture,
        Arc::new(CallState::default()),
        &provider(&fixture),
        &mut store,
    )
    .unwrap();
    assert_eq!(
        outcome.score_set.selection_metric.as_deref(),
        Some("balanced_accuracy")
    );
    assert_eq!(
        outcome.outputs[0].binding.prediction_kind,
        PredictionKind::ClassLabel
    );
}

#[test]
fn parallel_threads_matches_sequential_selection_and_lineage() {
    let sequential = fixture(false, false);
    let mut sequential_store = InMemoryArtifactStore::new();
    let sequential_outcome = run(
        &sequential,
        Arc::new(CallState::default()),
        &provider(&sequential),
        &mut sequential_store,
    )
    .unwrap();

    let mut parallel = fixture(false, false);
    parallel.request.options.scheduler.kind = TrainingSchedulerKind::Parallel;
    parallel.request.options.scheduler.backend = Some(TrainingSchedulerBackend::Threads);
    parallel.request.options.scheduler.workers = 2;
    parallel.request.options.resources.cpu_threads = 2;
    rebuild(&mut parallel);
    let mut parallel_store = InMemoryArtifactStore::new();
    let parallel_outcome = run(
        &parallel,
        Arc::new(CallState::default()),
        &provider(&parallel),
        &mut parallel_store,
    )
    .unwrap();
    parallel_outcome.validate().unwrap();
    assert_eq!(
        parallel_outcome.selected_variant_id,
        sequential_outcome.selected_variant_id
    );
    assert_eq!(parallel_outcome.score_set, sequential_outcome.score_set);
    assert_eq!(parallel_outcome.outputs, sequential_outcome.outputs);
    assert_eq!(parallel_outcome.lineage, sequential_outcome.lineage);
}

#[test]
fn unsupported_options_are_never_silently_ignored() {
    assert_preflight_rejected(fixture(true, false), |request| {
        request.options.resources.memory_bytes = Some(1024)
    });
    assert_preflight_rejected(fixture(true, false), |request| {
        request.options.resources.wall_time_ms = Some(1000)
    });
    assert_preflight_rejected(fixture(true, false), |request| {
        request.options.resources.cpu_threads = 2
    });
    assert_preflight_rejected(fixture(true, false), |request| {
        request.options.artifacts.cv_artifacts = CvArtifactRetention::MetadataOnly
    });
    assert_preflight_rejected(fixture(true, false), |request| {
        request.options.refit_strategy = Some(RefitStrategy::RefitEnsemble)
    });
    assert_preflight_rejected(fixture(true, false), |request| {
        request.options.selection.reduction_id = Some("reduction:test".to_string())
    });
    assert_preflight_rejected(fixture(true, false), |request| {
        request.options.selection.stacking_fit_contract = Some(StackingFitContract {
            meta_training_features: MetaTrainingFeatures::Oof,
            inference_features: InferenceFeatures::RefitBasePredictions,
            selection_protocol: SelectionProtocol::Nested,
            meta_row_domain: MetaRowDomain::Sample,
            final_reduction_id: None,
            unsafe_allow_reuse_oof: false,
        })
    });
    assert_preflight_rejected(fixture(true, false), |request| {
        request.options.selection.require_finite = false
    });
    assert_preflight_rejected(fixture(true, false), |request| {
        request.options.selection.evaluation_scope = Some(EvaluationScope::Holdout)
    });
    assert_preflight_rejected(fixture(true, false), |request| {
        request.options.selection.required_metric_level = Some(PredictionLevel::Group)
    });
    assert_preflight_rejected(fixture(true, false), |request| {
        request.options.selection.refit_slot_plan = Some(RefitSlotPlan {
            strategy: RefitStrategy::RefitOne,
            selection_level: PredictionLevel::Group,
            member_count: 1,
            selection_metric: request.options.selection.metric.clone(),
            reduction_id: None,
        })
    });
    assert_preflight_rejected(fixture(true, false), |request| {
        request.options.scheduler.kind = TrainingSchedulerKind::Parallel;
        request.options.scheduler.backend = Some(TrainingSchedulerBackend::Processes);
        request.options.scheduler.workers = 2;
        request.options.resources.cpu_threads = 2;
    });
    assert_preflight_rejected(fixture(true, false), |request| {
        request.parameter_patches.push(ParameterPatch {
            schema_version: PARAMETER_PATCH_SCHEMA_VERSION,
            node_id: node("model:base"),
            namespace: ParameterNamespace::Operator,
            path: vec!["n_estimators".to_string()],
            value: serde_json::json!(20),
        });
    });
    assert_preflight_rejected(fixture(true, false), |request| {
        request.options.outputs[0].prediction_kind = PredictionKind::ClassProbability;
        request.options.outputs[0].output_order = OutputOrder::TargetMajorClassMinor;
        request.options.outputs[0].class_labels = vec![vec!["0".to_string(), "1".to_string()]];
    });
    assert_preflight_rejected(fixture(true, false), |request| {
        request.options.outputs[0].prediction_kind = PredictionKind::DecisionScore;
    });
    assert_preflight_rejected(fixture(true, false), |request| {
        request.options.selection.metric.name = "accuracy".to_string();
        request.options.selection.metric.objective = MetricObjective::Maximize;
    });
}

#[test]
fn gpu_resources_are_forwarded_unchanged_to_every_training_task() {
    let mut fixture = fixture(true, false);
    fixture.request.options.resources.gpu_devices = vec!["cuda:0".to_string()];
    rebuild(&mut fixture);
    let state = Arc::new(CallState::default());
    let mut store = InMemoryArtifactStore::new();
    let outcome = run(&fixture, state.clone(), &provider(&fixture), &mut store).unwrap();
    outcome.validate().unwrap();
    let observed = state.observed_resources.lock().unwrap();
    assert!(!observed.is_empty());
    assert!(observed
        .iter()
        .all(|resources| resources.as_ref() == Some(&fixture.request.options.resources)));
}

#[test]
fn partial_predictor_closure_and_legacy_multi_prediction_ports_fail_closed() {
    let mut partial = fixture(true, false);
    let mut unused = partial.request.graph.nodes[0].clone();
    unused.id = node("transform:unused");
    unused.seed_label = Some("unused".to_string());
    partial.request.graph.nodes.push(unused);
    rebuild(&mut partial);
    let partial_state = Arc::new(CallState::default());
    let mut store = InMemoryArtifactStore::new();
    let error = run(
        &partial,
        partial_state.clone(),
        &provider(&partial),
        &mut store,
    )
    .unwrap_err();
    assert!(error.to_string().contains("predictor closure"));
    assert_eq!(partial_state.total(), 0);

    let mut multi_port = fixture(true, false);
    let mut extra = multi_port
        .request
        .graph
        .nodes
        .iter()
        .find(|node| node.id.as_str() == "model:base")
        .unwrap()
        .ports
        .outputs[0]
        .clone();
    extra.name = "probability".to_string();
    multi_port
        .request
        .graph
        .nodes
        .iter_mut()
        .find(|node| node.id.as_str() == "model:base")
        .unwrap()
        .ports
        .outputs
        .push(extra.clone());
    multi_port
        .request
        .controller_manifests
        .iter_mut()
        .find(|manifest| manifest.controller_id.as_str() == "controller:model.mock")
        .unwrap()
        .output_ports
        .push(extra);
    multi_port.request.options.outputs[0].port_name = Some("oof".to_string());
    resign_request(&mut multi_port.request);
    let multi_state = Arc::new(CallState::default());
    let error = run(
        &multi_port,
        multi_state.clone(),
        &provider(&multi_port),
        &mut store,
    )
    .unwrap_err();
    assert!(error.to_string().contains("without producer_port"));
    assert!(multi_state.total() > 0);

    let mut upstream_multi = fixture(true, true);
    let mut extra = upstream_multi
        .request
        .graph
        .nodes
        .iter()
        .find(|node| node.id.as_str() == "transform:snv")
        .unwrap()
        .ports
        .outputs
        .iter()
        .find(|port| port.kind == PortKind::Prediction)
        .unwrap()
        .clone();
    extra.name = "oof_aux_second".to_string();
    upstream_multi
        .request
        .graph
        .nodes
        .iter_mut()
        .find(|node| node.id.as_str() == "transform:snv")
        .unwrap()
        .ports
        .outputs
        .push(extra.clone());
    upstream_multi
        .request
        .controller_manifests
        .iter_mut()
        .find(|manifest| manifest.controller_id.as_str() == "controller:transform.mock")
        .unwrap()
        .output_ports
        .push(extra);
    rebuild(&mut upstream_multi);
    let upstream_state = Arc::new(CallState::default());
    let error = run(
        &upstream_multi,
        upstream_state.clone(),
        &provider(&upstream_multi),
        &mut store,
    )
    .unwrap_err();
    assert!(error.to_string().contains("without producer_port"));
    assert!(upstream_state.total() > 0);
}

#[test]
fn explicit_multi_prediction_port_output_binds_requested_port_only() {
    let mut fixture = fixture(true, false);
    let mut extra = fixture
        .request
        .graph
        .nodes
        .iter()
        .find(|node| node.id.as_str() == "model:base")
        .unwrap()
        .ports
        .outputs[0]
        .clone();
    extra.name = "probability".to_string();
    fixture
        .request
        .graph
        .nodes
        .iter_mut()
        .find(|node| node.id.as_str() == "model:base")
        .unwrap()
        .ports
        .outputs
        .push(extra.clone());
    fixture
        .request
        .controller_manifests
        .iter_mut()
        .find(|manifest| manifest.controller_id.as_str() == "controller:model.mock")
        .unwrap()
        .output_ports
        .push(extra);
    fixture.request.options.outputs[0].port_name = Some("oof".to_string());
    rebuild(&mut fixture);

    let state = Arc::new(CallState::default());
    *state.emit_explicit_model_ports.lock().unwrap() = true;
    let mut store = InMemoryArtifactStore::new();
    let outcome = run(&fixture, state, &provider(&fixture), &mut store).unwrap();
    assert_eq!(outcome.outputs.len(), 1);
    let output = &outcome.outputs[0];
    assert_eq!(output.binding.node_id.as_str(), "model:base");
    assert_eq!(output.binding.port_name, "oof");
    assert!(output.observation_predictions.is_empty());
    assert!(output.aggregated_predictions.is_empty());
    assert!(!output.predictions.is_empty());
    assert!(output.predictions.iter().all(|block| {
        block.producer_node.as_str() == "model:base"
            && block.producer_port.as_deref() == Some("oof")
            && block.partition == PredictionPartition::Final
            && block.fold_id.is_none()
    }));
    assert!(outcome
        .score_set
        .reports
        .iter()
        .any(|report| report.producer_node.as_str() == "model:base"
            && report.producer_port.as_deref() == Some("probability")));
}

#[test]
fn identifiers_controllers_diagnostics_and_store_are_prevalidated() {
    let fixture = fixture(true, false);
    let provider = provider(&fixture);

    let state = Arc::new(CallState::default());
    let mut store = InMemoryArtifactStore::new();
    assert!(run_custom(
        &fixture,
        state.clone(),
        &provider,
        &mut store,
        "not a portable id",
        BTreeMap::new(),
        true,
    )
    .is_err());
    assert_eq!(state.total(), 0);

    assert!(run_custom(
        &fixture,
        state.clone(),
        &provider,
        &mut store,
        "outcome:test.preflight",
        BTreeMap::from([(
            "bad".to_string(),
            serde_json::json!({"handle": 7, "owner_controller": "controller:model.mock"}),
        )]),
        true,
    )
    .is_err());
    assert_eq!(state.total(), 0);

    assert!(run_custom(
        &fixture,
        state.clone(),
        &provider,
        &mut store,
        "outcome:test.preflight",
        BTreeMap::new(),
        false,
    )
    .is_err());
    assert_eq!(state.total(), 0);

    let record = RefitArtifactRecord {
        node_id: node("model:base"),
        controller_id: ControllerId::new("controller:model.mock").unwrap(),
        artifact: ArtifactRef {
            id: ArtifactId::new("artifact:preexisting").unwrap(),
            kind: "test".to_string(),
            controller_id: ControllerId::new("controller:model.mock").unwrap(),
            backend: None,
            uri: None,
            content_fingerprint: None,
            size_bytes: Some(1),
            plugin: None,
            plugin_version: None,
            abi_major: None,
            abi_min_minor: None,
            native_predictor_descriptor: None,
            native_estimator_descriptor: None,
        },
        params_fingerprint: "a".repeat(64),
        training_loss_fingerprint: None,
        data_requirement_keys: Vec::new(),
        prediction_requirement_keys: Vec::new(),
    };
    store
        .register(
            &record,
            HandleRef {
                handle: 1,
                kind: HandleKind::Artifact,
                owner_controller: ControllerId::new("controller:model.mock").unwrap(),
            },
        )
        .unwrap();
    assert!(run_custom(
        &fixture,
        state.clone(),
        &provider,
        &mut store,
        "outcome:test.preflight",
        BTreeMap::new(),
        true,
    )
    .is_err());
    assert_eq!(state.total(), 0);
}

fn set_transform_manifest(fixture: &mut Fixture, mutate: impl Fn(&mut ControllerManifest)) {
    for manifest in &mut fixture.request.controller_manifests {
        if manifest.controller_id.as_str() == "controller:transform.mock" {
            mutate(manifest);
        }
    }
    rebuild(fixture);
}

// A stateless transform whose `artifact_policy` is `ReplayRequired` still carries
// no reloadable inference state: retained state is required for
// `Stateful || EmitsArtifacts` only, never for `ReplayRequired` or `fit_scope`.
// It therefore has no refit artifact yet keeps the completed-refit outcome
// PREDICT-replayable — a real integration proof, not a pure fact-table case.
#[test]
fn completed_refit_stateless_replay_required_node_needs_no_artifact() {
    let mut fixture = fixture(true, false);
    set_transform_manifest(&mut fixture, |manifest| {
        manifest.artifact_policy = ArtifactPolicy::ReplayRequired;
    });
    let mut store = InMemoryArtifactStore::new();
    let outcome = run(
        &fixture,
        Arc::new(CallState::default()),
        &provider(&fixture),
        &mut store,
    )
    .unwrap();
    outcome.validate().unwrap();
    let transform = &outcome.effective_plan.node_plans[&node("transform:snv")];
    assert_eq!(transform.artifact_policy, ArtifactPolicy::ReplayRequired);
    assert!(!transform
        .controller_capabilities
        .contains(&ControllerCapability::Stateful));
    assert!(!transform
        .controller_capabilities
        .contains(&ControllerCapability::EmitsArtifacts));
    assert!(!outcome
        .execution_bundle
        .refit_artifacts
        .iter()
        .any(|artifact| artifact.node_id.as_str() == "transform:snv"));
    assert_eq!(outcome.replayable_phases, vec![Phase::Predict]);
}

// A `Stateful` node that emits no artifact requires retained inference state but
// has no retained artifact (only `EmitsArtifacts` nodes produce refit artifacts),
// so the honest completed-refit answer is [] — never a false PREDICT.
#[test]
fn completed_refit_stateful_non_emitter_without_artifact_derives_empty() {
    let mut fixture = fixture(true, false);
    set_transform_manifest(&mut fixture, |manifest| {
        manifest.capabilities.insert(ControllerCapability::Stateful);
    });
    let mut store = InMemoryArtifactStore::new();
    let outcome = run(
        &fixture,
        Arc::new(CallState::default()),
        &provider(&fixture),
        &mut store,
    )
    .unwrap();
    outcome.validate().unwrap();
    let transform = &outcome.effective_plan.node_plans[&node("transform:snv")];
    assert!(transform
        .controller_capabilities
        .contains(&ControllerCapability::Stateful));
    assert!(!outcome
        .execution_bundle
        .refit_artifacts
        .iter()
        .any(|artifact| artifact.node_id.as_str() == "transform:snv"));
    assert!(outcome.replayable_phases.is_empty());
}

// The completed-refit outcome advertises exactly [PREDICT]; a re-signed outcome
// forging a stronger or weaker replay claim is rejected by re-derivation.
#[test]
fn refit_outcome_rejects_forged_replay_claims_even_when_resigned() {
    let fixture = fixture(true, false);
    let mut store = InMemoryArtifactStore::new();
    let outcome = run(
        &fixture,
        Arc::new(CallState::default()),
        &provider(&fixture),
        &mut store,
    )
    .unwrap();
    assert_eq!(outcome.replayable_phases, vec![Phase::Predict]);

    // Advertising EXPLAIN (model.mock does not support it) is refused.
    let mut explain_claim = outcome.clone();
    explain_claim.replayable_phases = vec![Phase::Predict, Phase::Explain];
    resign_outcome(&mut explain_claim);
    let error = explain_claim.validate().unwrap_err();
    assert!(
        error.to_string().contains("replayable_phases do not match"),
        "{error}"
    );

    // A completed refit re-advertising REFIT is refused.
    let mut refit_claim = outcome.clone();
    refit_claim.replayable_phases = vec![Phase::Refit];
    resign_outcome(&mut refit_claim);
    let error = refit_claim.validate().unwrap_err();
    assert!(
        error.to_string().contains("replayable_phases do not match"),
        "{error}"
    );

    // Dropping the honest PREDICT is refused too — [] is not honest here.
    let mut empty_claim = outcome;
    empty_claim.replayable_phases = Vec::new();
    resign_outcome(&mut empty_claim);
    let error = empty_claim.validate().unwrap_err();
    assert!(
        error.to_string().contains("replayable_phases do not match"),
        "{error}"
    );
}

// Re-signing the outer outcome fingerprint cannot launder plan topology or
// adjacency drift: the embedded ExecutionPlan is independently re-validated
// (canonical topological order and edge-derived input/output adjacency).
#[test]
fn re_signed_plan_topology_and_adjacency_drift_are_rejected() {
    let fixture = fixture(true, false);
    let mut store = InMemoryArtifactStore::new();
    let outcome = run(
        &fixture,
        Arc::new(CallState::default()),
        &provider(&fixture),
        &mut store,
    )
    .unwrap();

    let mut topology = outcome.clone();
    topology
        .effective_plan
        .graph_plan
        .topological_order
        .reverse();
    resign_outcome(&mut topology);
    let error = topology.validate().unwrap_err();
    assert!(error.to_string().contains("topological"), "{error}");

    let mut adjacency = outcome;
    adjacency
        .effective_plan
        .node_plans
        .get_mut(&node("model:base"))
        .unwrap()
        .input_nodes
        .clear();
    resign_outcome(&mut adjacency);
    let error = adjacency.validate().unwrap_err();
    assert!(
        error.to_string().contains("input/output adjacency"),
        "{error}"
    );
}

#[cfg(dag_ml_workspace_contract_fixtures)]
#[test]
fn portable_package_independently_requires_predict_replayability() {
    let mut package: PortablePredictorPackage = serde_json::from_str(PACKAGE_FIXTURE).unwrap();
    package.validate().unwrap();

    let controller_id = ControllerId::new("controller:augmentation.mock").unwrap();
    package
        .effective_plan
        .controller_manifests
        .get_mut(&controller_id)
        .unwrap()
        .supported_phases
        .remove(&Phase::Predict);
    for node_plan in package.effective_plan.node_plans.values_mut() {
        if node_plan.controller_id == controller_id {
            node_plan.supported_phases.remove(&Phase::Predict);
        }
    }
    package.effective_plan.controller_fingerprint =
        legacy_serde_fingerprint(&package.effective_plan.controller_manifests);
    package.execution_bundle.controller_fingerprint =
        package.effective_plan.controller_fingerprint.clone();
    package.template.controller_manifests = package.effective_plan.controller_manifests.clone();
    package.template.template_fingerprint = "0".repeat(64);
    package.template.template_fingerprint = package.template.compute_fingerprint().unwrap();
    package.training_outcome.effective_plan_fingerprint =
        typed_fingerprint(&package.effective_plan);
    package.training_outcome.execution_bundle_fingerprint =
        typed_fingerprint(&package.execution_bundle);
    package.package_fingerprint = "0".repeat(64);
    package.package_fingerprint = package.compute_fingerprint().unwrap();

    let error = package.validate().unwrap_err();
    assert!(error.to_string().contains("PREDICT-replayable"), "{error}");
}

#[test]
fn d8_training_outcome_exports_loadable_host_sidecar_package() {
    let fixture = fixture(true, false);
    let state = Arc::new(CallState::default());
    let mut store = InMemoryArtifactStore::new();
    let outcome = run(&fixture, state, &provider(&fixture), &mut store).unwrap();
    assert_eq!(outcome.refit.status, TrainingRefitStatus::Completed);
    assert!(!outcome.execution_bundle.refit_artifacts.is_empty());

    let package = outcome
        .to_portable_predictor_package(
            "predictor:package.d8.host_sidecar",
            FittedArtifactMode::AllowHostSidecar,
            ArtifactLoadMode::HostSidecar,
        )
        .unwrap();
    assert_eq!(
        package.schema_version,
        PORTABLE_PREDICTOR_PACKAGE_SCHEMA_VERSION
    );
    package.validate().unwrap();
    assert_eq!(
        package.artifact_bindings.len(),
        outcome.execution_bundle.refit_artifacts.len()
    );
    assert!(package
        .artifact_bindings
        .iter()
        .all(|binding| binding.load_mode == ArtifactLoadMode::HostSidecar));
    assert_eq!(
        package.training_outcome.outcome_fingerprint,
        outcome.outcome_fingerprint
    );
    assert_eq!(
        package
            .output_bindings
            .iter()
            .map(|binding| binding.binding_fingerprint.clone())
            .collect::<Vec<_>>(),
        outcome
            .outputs
            .iter()
            .map(|output| output.binding.binding_fingerprint.clone())
            .collect::<Vec<_>>()
    );

    let json = serde_json::to_string(&package).unwrap();
    let parsed = PortablePredictorPackage::from_json(&json).unwrap();
    let loaded = parsed
        .clone()
        .load_with(|record| Ok(format!("sidecar:{}", record.artifact.id)))
        .unwrap();
    for binding in &parsed.artifact_bindings {
        assert_eq!(
            loaded.artifact(&binding.artifact_id).unwrap(),
            &format!("sidecar:{}", binding.artifact_id)
        );
    }

    let mut stale = parsed;
    stale
        .execution_bundle
        .metadata
        .insert("stale_bundle".to_string(), serde_json::json!(true));
    stale.package_fingerprint = "0".repeat(64);
    stale.package_fingerprint = stale.compute_fingerprint().unwrap();
    let error = stale.validate().unwrap_err();
    assert!(
        error.to_string().contains("execution bundle content"),
        "{error}"
    );
}

#[test]
fn d8_loaded_predictor_replays_predict_without_source_training_outcome() {
    let mut fixture = fixture(true, false);
    add_model_probability_port(&mut fixture);
    add_explain_support(&mut fixture);
    let state = Arc::new(CallState::default());
    *state.emit_explicit_model_ports.lock().unwrap() = true;
    let mut store = InMemoryArtifactStore::new();
    let source = run(&fixture, state.clone(), &provider(&fixture), &mut store)
        .expect("source training outcome");
    let package = source
        .to_portable_predictor_package(
            "predictor:package.d8.stateless",
            FittedArtifactMode::AllowHostSidecar,
            ArtifactLoadMode::HostSidecar,
        )
        .unwrap();
    let loaded = package
        .clone()
        .load_with(|record| {
            store
                .get(&record.artifact.id)
                .map(|handle_record| handle_record.handle.clone())
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation(format!(
                        "missing sidecar handle for `{}`",
                        record.artifact.id
                    ))
                })
        })
        .unwrap();

    let current_relation = "e".repeat(64);
    let envelopes = replay_envelopes_with_relation(&source, &current_relation);
    let request = replay_request(&source, Phase::Predict);
    let controllers = controllers(&fixture, state.clone(), true);
    let replay = execute_loaded_predictor_replay(LoadedPredictorReplayInput {
        predictor: &loaded,
        request: &request,
        outcome_id: "replay:loaded.predict.outcome".to_string(),
        run_id: RunId::new("run:loaded.predict").unwrap(),
        controllers: &controllers,
        data_provider: &provider(&fixture),
        data_envelopes: &envelopes,
        warnings: Vec::new(),
        diagnostics: BTreeMap::from([("loaded_package".to_string(), serde_json::json!(true))]),
    })
    .expect("loaded package replay");

    assert_eq!(
        package.schema_version,
        PORTABLE_PREDICTOR_PACKAGE_SCHEMA_VERSION
    );
    assert_eq!(
        replay.schema_version,
        TRAINING_REPLAY_OUTCOME_SCHEMA_VERSION
    );
    assert_eq!(replay.phase, Phase::Predict);
    assert_eq!(replay.source_training_outcome, package.training_outcome);
    assert_eq!(
        replay.replay_request_fingerprint,
        request.request_fingerprint
    );
    assert_eq!(replay.outputs.len(), request.output_binding_ids.len());
    assert!(replay.explanations.is_empty());
    assert!(replay
        .input_data_identities
        .iter()
        .all(|identity| identity.relation_fingerprint == current_relation));
    assert!(replay.outputs.iter().all(|output| {
        output.schema_version == Some(BOUND_TRAINING_OUTPUT_SCHEMA_VERSION)
            && !output.predictions.is_empty()
            && output.predictions.iter().all(|block| {
                block.partition == PredictionPartition::Final
                    && block.fold_id.is_none()
                    && block.producer_port.as_deref() == Some(output.binding.port_name.as_str())
            })
    }));
    replay
        .validate_against_package(loaded.package(), &request)
        .unwrap();
    assert!(state.count(Phase::Predict, "model:base") > 0);

    let mut explain_request = request.clone();
    explain_request.phase = Phase::Explain;
    explain_request.request_fingerprint = "0".repeat(64);
    explain_request.request_fingerprint = explain_request.compute_fingerprint().unwrap();
    let replay = execute_loaded_predictor_replay(LoadedPredictorReplayInput {
        predictor: &loaded,
        request: &explain_request,
        outcome_id: "replay:loaded.explain.outcome".to_string(),
        run_id: RunId::new("run:loaded.explain").unwrap(),
        controllers: &controllers,
        data_provider: &provider(&fixture),
        data_envelopes: &envelopes,
        warnings: Vec::new(),
        diagnostics: BTreeMap::new(),
    })
    .expect("loaded package explain replay");
    assert_eq!(replay.phase, Phase::Explain);
    assert!(replay.outputs.is_empty());
    assert_eq!(replay.explanation_block_count, replay.explanations.len());
    assert!(replay.explanations.iter().any(|block| {
        block.producer_node.as_str() == "model:base"
            && block.producer_port.as_deref() == Some("oof")
            && block.method == "fixture_explain"
    }));
    replay
        .validate_against_package(loaded.package(), &explain_request)
        .unwrap();
    assert!(state.count(Phase::Explain, "model:base") > 0);
}

#[test]
fn portable_package_replays_all_named_outputs_and_only_explicit_selection() {
    let mut fixture = fixture(true, false);
    add_model_probability_port(&mut fixture);
    fixture.request.options.outputs[0].output_id = "output:source_0".to_string();
    let mut second_output = fixture.request.options.outputs[0].clone();
    second_output.output_id = "output:source_1".to_string();
    second_output.port_name = Some("probability".to_string());
    fixture.request.options.outputs.push(second_output);
    fixture.request.options.selection_output_id = "output:source_0".to_string();
    rebuild(&mut fixture);

    let state = Arc::new(CallState::default());
    *state.emit_explicit_model_ports.lock().unwrap() = true;
    let mut store = InMemoryArtifactStore::new();
    let source = run(&fixture, state.clone(), &provider(&fixture), &mut store).unwrap();
    let package = source
        .to_portable_predictor_package(
            "predictor:package.independent_outputs",
            FittedArtifactMode::AllowHostSidecar,
            ArtifactLoadMode::HostSidecar,
        )
        .unwrap();
    let binding_ids = ["output:source_0", "output:source_1"];
    assert_eq!(
        package
            .output_bindings
            .iter()
            .map(|binding| binding.binding_id.as_str())
            .collect::<Vec<_>>(),
        binding_ids
    );
    for binding_id in binding_ids {
        assert_eq!(
            package
                .select_output(binding_id)
                .unwrap()
                .output_binding
                .binding_id,
            binding_id
        );
    }
    assert!(package.select_output("source_0").is_err());

    let loaded = package
        .load_with(|record| {
            store
                .get(&record.artifact.id)
                .map(|handle| handle.handle.clone())
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation("missing sidecar artifact".to_string())
                })
        })
        .unwrap();
    let envelopes = replay_envelopes_with_relation(&source, &"e".repeat(64));
    let controllers = controllers(&fixture, state, true);
    let request = replay_request(&source, Phase::Predict);
    let replay = execute_loaded_predictor_replay(LoadedPredictorReplayInput {
        predictor: &loaded,
        request: &request,
        outcome_id: "replay:independent_outputs.all".to_string(),
        run_id: RunId::new("run:independent_outputs.all").unwrap(),
        controllers: &controllers,
        data_provider: &provider(&fixture),
        data_envelopes: &envelopes,
        warnings: Vec::new(),
        diagnostics: BTreeMap::new(),
    })
    .unwrap();
    replay
        .validate_against_package(loaded.package(), &request)
        .unwrap();
    assert_eq!(replay.outputs.len(), 2);
    assert_eq!(replay.outputs[0].binding.binding_id, binding_ids[0]);
    assert_eq!(replay.outputs[1].binding.binding_id, binding_ids[1]);
    assert_eq!(
        replay.outputs[0].predictions[0].sample_ids,
        replay.outputs[1].predictions[0].sample_ids
    );
    assert_ne!(
        replay.outputs[0].predictions[0].values,
        replay.outputs[1].predictions[0].values
    );

    let mut selected = request.clone();
    selected.output_binding_ids = vec![binding_ids[1].to_string()];
    selected.request_fingerprint = selected.compute_fingerprint().unwrap();
    let selected_replay = execute_loaded_predictor_replay(LoadedPredictorReplayInput {
        predictor: &loaded,
        request: &selected,
        outcome_id: "replay:independent_outputs.selected".to_string(),
        run_id: RunId::new("run:independent_outputs.selected").unwrap(),
        controllers: &controllers,
        data_provider: &provider(&fixture),
        data_envelopes: &envelopes,
        warnings: Vec::new(),
        diagnostics: BTreeMap::new(),
    })
    .unwrap();
    selected_replay
        .validate_against_package(loaded.package(), &selected)
        .unwrap();
    assert_eq!(selected_replay.outputs.len(), 1);
    assert_eq!(
        selected_replay.outputs[0].binding.binding_id,
        binding_ids[1]
    );
}

#[test]
fn loaded_stacking_predict_recomputes_fresh_cohort_without_training_cache() {
    let fixture = fixture(true, true);
    let mut artifact_store = InMemoryArtifactStore::new();
    let source = run(
        &fixture,
        Arc::new(CallState::default()),
        &provider(&fixture),
        &mut artifact_store,
    )
    .expect("stacking source training");
    assert!(!source.execution_bundle.prediction_caches.is_empty());
    let cached_sample_ids = source
        .portable_prediction_caches
        .as_ref()
        .expect("stacking training retains its OOF cache payload")
        .caches
        .iter()
        .flat_map(|payload| payload.blocks.iter())
        .flat_map(|block| block.sample_ids.iter().cloned())
        .collect::<BTreeSet<_>>();

    // The JSON round trip and fresh controller registry model a loaded
    // Package V2 in another process. Its bundle retains signed OOF cache
    // records, but PREDICT must execute the graph on the new cohort and must
    // never turn those training predictions into inference features.
    let package = source
        .to_portable_predictor_package(
            "predictor:package.loaded.stacking",
            FittedArtifactMode::AllowHostSidecar,
            ArtifactLoadMode::HostSidecar,
        )
        .unwrap();
    let parsed = PortablePredictorPackage::from_json(&serde_json::to_string(&package).unwrap())
        .expect("serialized stacking package");
    let loaded = parsed
        .load_with(|record| {
            artifact_store
                .get(&record.artifact.id)
                .map(|stored| stored.handle.clone())
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation(format!(
                        "missing sidecar handle for `{}`",
                        record.artifact.id
                    ))
                })
        })
        .unwrap();

    let fresh_sample_ids = vec![
        sample("sample:fresh:1"),
        sample("sample:fresh:2"),
        sample("sample:fresh:3"),
    ];
    assert!(fresh_sample_ids
        .iter()
        .all(|sample_id| !cached_sample_ids.contains(sample_id)));
    let fresh_state = Arc::new(CallState::default());
    *fresh_state.predict_sample_ids.lock().unwrap() = Some(fresh_sample_ids.clone());
    let fresh_controllers = controllers(&fixture, fresh_state.clone(), true);
    let fresh_relations = calibration_relations(&fresh_sample_ids);
    let replay = execute_loaded_predictor_replay(LoadedPredictorReplayInput {
        predictor: &loaded,
        request: &replay_request(&source, Phase::Predict),
        outcome_id: "replay:loaded.stacking.fresh".to_string(),
        run_id: RunId::new("run:loaded.stacking.fresh").unwrap(),
        controllers: &fresh_controllers,
        data_provider: &provider(&fixture),
        data_envelopes: &replay_envelopes_with_relations(&source, &fresh_relations),
        warnings: Vec::new(),
        diagnostics: BTreeMap::new(),
    })
    .expect("loaded stacking predictor must replay the fresh cohort");

    assert!(!replay.prediction_cache_store);
    assert_eq!(replay.outputs.len(), 1);
    assert_eq!(replay.outputs[0].predictions.len(), 1);
    assert_eq!(
        replay.outputs[0].predictions[0].sample_ids,
        fresh_sample_ids
    );
    assert_eq!(fresh_state.count(Phase::Predict, "transform:snv"), 1);
    assert_eq!(fresh_state.count(Phase::Predict, "model:base"), 1);
}

#[cfg(dag_ml_workspace_contract_fixtures)]
fn positional_struct(
    value: &serde_json::Value,
    fields: &[(&str, serde_json::Value)],
) -> serde_json::Value {
    let object = value.as_object().expect("fixture struct is an object");
    serde_json::Value::Array(
        fields
            .iter()
            .map(|(name, default)| {
                object
                    .get(*name)
                    .cloned()
                    .unwrap_or_else(|| default.clone())
            })
            .collect(),
    )
}

#[cfg(dag_ml_workspace_contract_fixtures)]
#[test]
fn standalone_contract_readers_reject_serde_positional_struct_wires() {
    let package: serde_json::Value = serde_json::from_str(PACKAGE_FIXTURE).unwrap();

    let graph = &package["template"]["graph"];
    let graph_sequence = positional_struct(
        graph,
        &[
            ("id", serde_json::Value::Null),
            ("interface", serde_json::json!({})),
            ("nodes", serde_json::json!([])),
            ("edges", serde_json::json!([])),
            ("search_space_fingerprint", serde_json::Value::Null),
            ("metadata", serde_json::json!({})),
        ],
    );
    let permissive_graph: GraphSpec = serde_json::from_value(graph_sequence.clone()).unwrap();
    permissive_graph.validate().unwrap();
    assert!(GraphSpec::from_json(&serde_json::to_string(&graph_sequence).unwrap()).is_err());

    let campaign = &package["template"]["campaign"];
    let campaign_sequence = positional_struct(
        campaign,
        &[
            ("id", serde_json::Value::Null),
            ("root_seed", serde_json::Value::Null),
            ("leakage_policy", serde_json::json!({})),
            ("aggregation_policy", serde_json::json!({})),
            ("split_invocation", serde_json::Value::Null),
            ("generation", serde_json::json!({})),
            ("shape_plans", serde_json::json!({})),
            ("data_bindings", serde_json::json!({})),
            ("branch_view_plans", serde_json::json!([])),
            ("inner_cv", serde_json::Value::Null),
            ("metadata", serde_json::json!({})),
        ],
    );
    let permissive_campaign: CampaignSpec =
        serde_json::from_value(campaign_sequence.clone()).unwrap();
    permissive_campaign.validate().unwrap();
    assert!(CampaignSpec::from_json(&serde_json::to_string(&campaign_sequence).unwrap()).is_err());

    let bundle = &package["execution_bundle"];
    let bundle_fields = [
        ("bundle_id", serde_json::Value::Null),
        ("schema_version", serde_json::json!(1)),
        ("plan_id", serde_json::Value::Null),
        ("graph_fingerprint", serde_json::Value::Null),
        ("campaign_fingerprint", serde_json::Value::Null),
        ("controller_fingerprint", serde_json::Value::Null),
        ("selected_variant_id", serde_json::Value::Null),
        ("selections", serde_json::json!({})),
        ("refit_artifacts", serde_json::json!([])),
        ("prediction_requirements", serde_json::json!([])),
        ("prediction_caches", serde_json::json!([])),
        ("methods_hpo_resume_state", serde_json::Value::Null),
        ("methods_hpo_fold_state", serde_json::Value::Null),
        ("conformal_calibration", serde_json::Value::Null),
        ("raw_artifact_payloads", serde_json::json!({})),
        ("scores", serde_json::Value::Null),
        ("data_requirements", serde_json::json!([])),
        ("unsafe_flags", serde_json::json!([])),
        ("metadata", serde_json::json!({})),
    ];
    let bundle_sequence = positional_struct(bundle, &bundle_fields);
    let permissive_bundle: ExecutionBundle =
        serde_json::from_value(bundle_sequence.clone()).unwrap();
    permissive_bundle.validate().unwrap();
    assert!(ExecutionBundle::from_json(&serde_json::to_string(&bundle_sequence).unwrap()).is_err());

    let mut nested_bundle = bundle.clone();
    let artifact = nested_bundle["refit_artifacts"][0].clone();
    nested_bundle["refit_artifacts"][0] = positional_struct(
        &artifact,
        &[
            ("node_id", serde_json::Value::Null),
            ("controller_id", serde_json::Value::Null),
            ("artifact", serde_json::Value::Null),
            ("params_fingerprint", serde_json::Value::Null),
            ("training_loss_fingerprint", serde_json::Value::Null),
            ("data_requirement_keys", serde_json::json!([])),
            ("prediction_requirement_keys", serde_json::json!([])),
        ],
    );
    let permissive_nested: ExecutionBundle = serde_json::from_value(nested_bundle.clone()).unwrap();
    permissive_nested.validate().unwrap();
    assert!(ExecutionBundle::from_json(&serde_json::to_string(&nested_bundle).unwrap()).is_err());
}

#[test]
fn nested_group_oof_refit_lineage_retains_exact_signed_inner_runs_after_reload() {
    let mut case = fixture(true, true);
    // Nested stacking consumes only OOF prediction graph inputs. The shared
    // flat fixture also has a transform-to-model Data edge, which is not part
    // of this signed topology. Bind that same attested raw source upstream.
    case.request
        .graph
        .edges
        .retain(|edge| edge.contract.requires_oof);
    case.request
        .graph
        .nodes
        .iter_mut()
        .find(|node| node.id == self::node("model:base"))
        .unwrap()
        .ports
        .inputs
        .retain(|port| port.kind == PortKind::Prediction);
    let mut raw_bindings = case
        .request
        .campaign
        .data_bindings
        .remove(&node("model:base"))
        .unwrap();
    for binding in &mut raw_bindings {
        binding.node_id = node("transform:snv");
    }
    case.request
        .campaign
        .data_bindings
        .insert(node("transform:snv"), raw_bindings);
    for identity in &mut case.request.data_identities {
        identity.requirement_key = data_binding_requirement_key(&node("transform:snv"), "x");
    }
    // Four distinct attested groups leave two groups in each outer train
    // scope, so both outer-local and full-refit GroupKFold(2) are valid.
    for (index, relation) in case.relations.records.iter_mut().enumerate() {
        relation.group_id = Some(GroupId::new(format!("group:{index}")).unwrap());
    }
    let fingerprint = case.relations.fingerprint().unwrap();
    for binding in case.request.campaign.data_bindings.values_mut().flatten() {
        binding.relation_fingerprint = Some(fingerprint.clone());
    }
    for identity in &mut case.request.data_identities {
        identity.relation_fingerprint = fingerprint.clone();
        identity.identity_fingerprint = identity.compute_fingerprint().unwrap();
    }
    let inner = NestedCvSpec::GroupKFold(GroupKFoldSpec { n_splits: 2 });
    case.request.campaign.inner_cv = Some(inner.clone());
    let outer = case
        .request
        .campaign
        .split_invocation
        .as_mut()
        .unwrap()
        .fold_set
        .as_mut()
        .unwrap();
    outer.sample_groups = case
        .relations
        .records
        .iter()
        .map(|relation| {
            (
                relation.sample_id.clone(),
                relation.group_id.clone().unwrap(),
            )
        })
        .collect();
    let outer = outer.clone();
    let meta = case
        .request
        .graph
        .nodes
        .iter_mut()
        .find(|node| node.id == self::node("model:base"))
        .unwrap();
    meta.metadata.insert(
        "stacking_oof_execution".into(),
        serde_json::json!("nested_oof_v1"),
    );
    meta.metadata.insert(
        "stacking_refit_oof".into(),
        serde_json::json!("partitioned_inner_v1"),
    );
    rebuild(&mut case);

    let refit = inner
        .build_inner_fold_set(
            &FoldAssignment {
                fold_id: FoldId::new("stacking.refit").unwrap(),
                train_sample_ids: outer.sample_ids.clone(),
                validation_sample_ids: Vec::new(),
                metadata: BTreeMap::new(),
            },
            &outer.sample_groups,
        )
        .unwrap();
    let state = Arc::new(CallState::default());
    let mut folds = outer.folds.clone();
    for fold in &outer.folds {
        folds.extend(
            outer
                .nested_fold_set(&inner, fold)
                .unwrap()
                .inner_fold_set
                .folds,
        );
    }
    folds.extend(refit.folds.clone());
    *state.scoped_validation_samples.lock().unwrap() = folds
        .into_iter()
        .map(|fold| (fold.fold_id, fold.validation_sample_ids))
        .collect();
    let mut store = InMemoryArtifactStore::new();
    let outcome = run(&case, state.clone(), &provider(&case), &mut store).unwrap();
    assert_eq!(
        TrainingOutcome::from_json(&serde_json::to_string(&outcome).unwrap()).unwrap(),
        outcome
    );
    let refit_ids = refit
        .folds
        .iter()
        .map(|fold| fold.fold_id.clone())
        .collect::<BTreeSet<_>>();
    let full_refit_inner = outcome
        .lineage
        .iter()
        .filter(|record| {
            record.phase == Phase::FitCv
                && record
                    .fold_id
                    .as_ref()
                    .is_some_and(|fold| refit_ids.contains(fold))
        })
        .collect::<Vec<_>>();
    assert_eq!(full_refit_inner.len(), 2);
    assert!(full_refit_inner
        .iter()
        .all(|record| record.node_id == node("transform:snv")));
    for record in &full_refit_inner {
        assert!(state.scoped_calls.lock().unwrap().contains(&(
            record.phase,
            record.node_id.clone(),
            record.fold_id.clone()
        )));
    }
    for mutation in ["missing", "foreign"] {
        let mut forged = outcome.clone();
        let index = forged
            .lineage
            .iter()
            .position(|record| record.record_id == full_refit_inner[0].record_id)
            .unwrap();
        if mutation == "missing" {
            forged.lineage.remove(index);
        } else {
            forged.lineage[index].fold_id =
                Some(FoldId::new("stacking.refit.inner.foreign").unwrap());
        }
        resign_outcome(&mut forged);
        let error =
            TrainingOutcome::from_json(&serde_json::to_string(&forged).unwrap()).unwrap_err();
        assert!(
            error
                .to_string()
                .contains("FIT_CV lineage does not exactly cover closure folds"),
            "{mutation}: {error}"
        );
    }

    let flat = fixture(true, false);
    let mut flat_store = InMemoryArtifactStore::new();
    let flat_outcome = run(
        &flat,
        Arc::new(CallState::default()),
        &provider(&flat),
        &mut flat_store,
    )
    .unwrap();
    assert!(flat_outcome
        .outputs
        .iter()
        .all(|output| !output.artifact_only && output.refit_test_cohort.is_none()));
    assert!(flat_outcome.outputs[0]
        .predictions
        .iter()
        .all(|block| block.partition == PredictionPartition::Final));
    TrainingOutcome::from_json(&serde_json::to_string(&flat_outcome).unwrap()).unwrap();
}

#[test]
fn public_replay_outcome_refuses_training_markers_and_empty_prediction_payload() {
    let case = fixture(true, false);
    let state = Arc::new(CallState::default());
    let mut store = InMemoryArtifactStore::new();
    let source = run(&case, state.clone(), &provider(&case), &mut store).unwrap();
    let controllers = controllers(&case, state, true);
    let request = replay_request(&source, Phase::Predict);
    let envelopes = replay_envelopes_with_relations(&source, &case.relations);
    let replay = execute_attached_training_replay(AttachedTrainingReplayInput {
        source: &source,
        request: &request,
        outcome_id: "replay:training.marker.refusal".into(),
        run_id: RunId::new("run:training.marker.refusal").unwrap(),
        controllers: &controllers,
        data_provider: &provider(&case),
        artifact_store: &store,
        data_envelopes: &envelopes,
        warnings: Vec::new(),
        diagnostics: BTreeMap::new(),
    })
    .unwrap();
    replay.validate().unwrap();
    let cohort = PredictCohort::from_relations(
        PredictCohortRole::ExternalTest,
        SampleRelationSet {
            records: vec![SampleRelation::new(
                ObservationId::new("observation:test").unwrap(),
                sample("sample:test"),
            )],
        },
        vec!["protein".into()],
        "c".repeat(64),
        Some("d".repeat(64)),
    )
    .unwrap();
    for mutation in ["artifact_only", "test_cohort", "empty"] {
        let mut forged = replay.clone();
        match mutation {
            "artifact_only" => forged.outputs[0].artifact_only = true,
            "test_cohort" => forged.outputs[0].refit_test_cohort = Some(cohort.clone()),
            "empty" => {
                forged.outputs[0].predictions.clear();
                forged.outputs[0].observation_predictions.clear();
                forged.outputs[0].aggregated_predictions.clear();
                forged.prediction_block_count = 0;
                forged.observation_prediction_block_count = 0;
                forged.aggregated_prediction_block_count = 0;
            }
            _ => unreachable!(),
        }
        resign_replay_outcome(&mut forged);
        let error = forged.validate().unwrap_err();
        let expected = if mutation == "empty" {
            "contains no prediction block"
        } else {
            "training-only REFIT markers"
        };
        assert!(error.to_string().contains(expected), "{mutation}: {error}");
        assert!(
            TrainingReplayOutcome::from_json(&serde_json::to_string(&forged).unwrap()).is_err()
        );
    }
}

/// XL03 witnesses use genuine native FIT/REFIT and exported states. Core's
/// container round-trip is exercised separately by the public SDK witness;
/// this lane preserves the registry-only Core dev dependency unchanged.
#[cfg(feature = "methods-optimizer-local")]
mod xl03_native_refit_families {
    use super::*;

    fn fixture_for_family(role_pipeline: bool) -> Fixture {
        let mut fixture = fixture(true, false);
        if role_pipeline {
            use_native_pls_phase_profile(&mut fixture, None);
        } else {
            use_portable_methods_pipeline(&mut fixture);
            let registry = derive_host_controller_registry(
                &methods_estimator_host_controller_specs(&methods_runtime()).unwrap(),
            )
            .unwrap();
            let manifest = registry
                .manifests()
                .find(|manifest| manifest.controller_id.as_str() == "controller:n4m.regressor")
                .expect("live manifest exposes the genuine N4ME regressor")
                .clone();
            // No fixture capability injection: V3 admission must be declared
            // by production controller derivation from the native manifest.
            assert!(manifest
                .capabilities
                .contains(&ControllerCapability::SupportsPortableFullRefit));
            let model = fixture.request.graph.nodes.first_mut().unwrap();
            model.operator = Some(serde_json::json!("n4m:models.pls.pls_regression"));
            model.params = BTreeMap::from([
                (
                    "method_id".into(),
                    serde_json::json!("models.pls.pls_regression"),
                ),
                ("n_components".into(), serde_json::json!(1)),
                ("solver".into(), serde_json::json!("nipals")),
                ("center_x".into(), serde_json::json!(true)),
                ("center_y".into(), serde_json::json!(true)),
                ("scale_x".into(), serde_json::json!(true)),
                ("scale_y".into(), serde_json::json!(true)),
            ]);
            model.ports.outputs.clone_from(&manifest.output_ports);
            fixture.request.options.outputs[0].port_name = Some("y_hat".into());
            fixture.request.controller_manifests = vec![manifest];
        }
        give_methods_hpo_four_train_rows(&mut fixture);
        rebuild(&mut fixture);
        for manifest in &fixture.request.controller_manifests {
            assert!(manifest
                .capabilities
                .contains(&ControllerCapability::SupportsPortableFullRefit));
        }
        fixture
    }

    fn native_controllers() -> RuntimeControllerRegistry {
        let mut registry = RuntimeControllerRegistry::new();
        register_methods_native_controllers(&mut registry, methods_runtime()).unwrap();
        registry
    }

    fn cycle(role_pipeline: bool) {
        let family = if role_pipeline {
            "role-pls"
        } else {
            "n4me-pls"
        };
        let fixture = fixture_for_family(role_pipeline);
        let request_before = serde_json::to_vec(&fixture.request).unwrap();
        let mut parent_provider = provider(&fixture);
        parent_provider.methods_pls_enabled = true;
        let parent = {
            let registry = native_controllers();
            execute_training(TrainingExecutionInput {
                request: &fixture.request,
                outcome_id: format!("outcome:xl03.{family}.parent"),
                run_id: RunId::new(format!("run:xl03.{family}.parent")).unwrap(),
                bundle_id: BundleId::new(format!("bundle:xl03.{family}.parent")).unwrap(),
                controllers: &registry,
                data_provider: &parent_provider,
                relations: &fixture.relations,
                training_influence: &fixture.influence,
                artifact_store: &mut InMemoryArtifactStore::new(),
                warnings: Vec::new(),
                diagnostics: BTreeMap::new(),
            })
            .expect("parent executes genuine native CV/SELECT/REFIT")
        }; // Every original controller and its handles are now gone.
        assert!(!parent.oof_averages.is_empty());
        let source_package = parent
            .to_portable_predictor_package(
                format!("package:xl03.{family}.parent"),
                FittedArtifactMode::PortableRequired,
                ArtifactLoadMode::NativePortable,
            )
            .unwrap();
        let source_before = serde_json::to_vec(&source_package).unwrap();
        let recipe = PortableRefitRecipe::derive_from_package(
            &source_package,
            format!("recipe:xl03.{family}"),
        )
        .expect("production capability admits the real native full-refit recipe");
        let mut target_provider = provider(&fixture);
        target_provider.methods_pls_enabled = true;
        for row in target_provider.methods_rows.values_mut() {
            row[0] += 0.25;
            row[1] *= 0.75;
            row[3] = 2.0 * row[3] + 0.3 * row[0] + 1.0;
        }
        let mut target_request = fixture.request.clone();
        for identity in &mut target_request.data_identities {
            identity.data_content_fingerprint = content_hash(
                &serde_json::to_string(
                    &target_provider
                        .methods_rows
                        .iter()
                        .map(|(id, row)| (id, &row[..2]))
                        .collect::<Vec<_>>(),
                )
                .unwrap(),
            );
            identity.target_content_fingerprint = content_hash(
                &serde_json::to_string(
                    &target_provider
                        .methods_rows
                        .iter()
                        .map(|(id, row)| (id, row[3]))
                        .collect::<Vec<_>>(),
                )
                .unwrap(),
            );
            identity.identity_fingerprint = identity.compute_fingerprint().unwrap();
        }
        resign_request(&mut target_request);
        target_provider.identity = Some(target_request.data_identities[0].clone());
        let target_before = serde_json::to_vec(&target_request).unwrap();
        let plan =
            derive_portable_full_refit_target_plan(&recipe, &source_package, &target_request)
                .unwrap();
        let execution = {
            let registry = native_controllers();
            execute_portable_full_refit(PortableFullRefitExecutionInput {
                recipe: &recipe,
                source_package: &source_package,
                target_plan: &plan,
                target_training_request: &target_request,
                target_training_request_fingerprint: target_request.request_fingerprint.clone(),
                target_data_identities: &target_request.data_identities,
                target_training_influence: &fixture.influence,
                run_id: RunId::new(format!("run:xl03.{family}.target")).unwrap(),
                controllers: &registry,
                data_provider: &target_provider,
            })
            .unwrap()
        };
        assert_eq!(execution.results.len(), 1);
        assert!(execution
            .results
            .iter()
            .all(|result| result.lineage.phase == Phase::Refit));
        assert_eq!(execution.refit_artifacts.len(), 1);
        let record = &execution.refit_artifacts[0];
        let raw = &execution.raw_artifact_payloads[&record.artifact.id];
        assert_ne!(
            raw,
            &source_package.execution_bundle.raw_artifact_payloads[&source_package
                .execution_bundle
                .refit_artifacts[0]
                .artifact
                .id],
            "fresh target REFIT must not copy the parent's learned bytes"
        );
        if role_pipeline {
            assert_eq!(record.artifact.kind, "methods_role_pipeline");
            assert_eq!(
                record.artifact.controller_id.as_str(),
                METHODS_NATIVE_REGRESSION_CONTROLLER
            );
            assert_eq!(
                record.artifact.plugin.as_deref(),
                Some("dagml.methods.native.regression")
            );
            assert_eq!(record.artifact.plugin_version.as_deref(), Some("1.0.0"));
            let inspected = inspect_methods_role_pipeline_params(raw, &methods_runtime()).unwrap();
            assert_eq!(
                inspected["steps"][0]["methodId"],
                "models.pls.pls_regression"
            );
            assert_eq!(
                inspected["model_params"],
                serde_json::json!({"n_components":1,"scale":true})
            );
        } else {
            assert!(raw.starts_with(b"N4ME"));
            assert_eq!(record.artifact.abi_major, Some(2));
            assert_eq!(record.artifact.abi_min_minor, Some(13));
            assert!(record.artifact.plugin.is_none());
            assert_eq!(
                record.artifact.controller_id.as_str(),
                "controller:n4m.regressor"
            );
        }
        let child = build_portable_refit_package_v3(PortableRefitPackageV3BuildInput {
            package_id: format!("package:xl03.{family}.child"),
            outcome_id: format!("outcome:xl03.{family}.child"),
            bundle_id: BundleId::new(format!("bundle:xl03.{family}.child")).unwrap(),
            recipe: &recipe,
            source_package: &source_package,
            target_plan: &plan,
            target_training_request: &target_request,
            target_data_identities: &target_request.data_identities,
            target_training_influence: &fixture.influence,
            execution: &execution,
        })
        .unwrap();
        let archive =
            build_archive_v3_native_refit_payloads(format!("archive:xl03.{family}"), &child)
                .unwrap();
        let path = record.artifact.uri.as_deref().unwrap();
        assert_eq!(&archive.members[path], raw);
        let list = if role_pipeline {
            "role_pipelines"
        } else {
            "n4me"
        };
        let reference = &archive.manifest["payloads"]["methods"][list][0];
        let inventory = archive.manifest["member_inventory"]
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["path"] == path)
            .unwrap();
        for key in ["raw_sha256", "semantic_fingerprint", "semantic_profile"] {
            assert_eq!(reference[key], inventory[key]);
        }
        assert_eq!(reference["raw_sha256"], content_hash_bytes(raw));
        let loaded = PortableRefitPackageV3::from_json(
            std::str::from_utf8(&archive.members[ARCHIVE_V3_PACKAGE_MEMBER]).unwrap(),
        )
        .unwrap();
        assert_eq!(loaded, child);
        assert_eq!(
            loaded.outcome.execution_bundle.raw_artifact_payloads,
            execution.raw_artifact_payloads
        );
        let mut replay_request = replay_request(&parent, Phase::Predict);
        replay_request.source_outcome_fingerprint = loaded.outcome.outcome_fingerprint.clone();
        replay_request.request_fingerprint = replay_request.compute_fingerprint().unwrap();
        let replay_before = serde_json::to_vec(&replay_request).unwrap();
        let samples = vec![
            SampleId::new("predict.new.2").unwrap(),
            SampleId::new("predict.new.1").unwrap(),
        ];
        let current_relations = calibration_relations(&samples);
        let mut envelopes = replay_envelopes_with_relations(&parent, &current_relations);
        let key = data_binding_requirement_key(&node("model:base"), "x");
        let x = MethodsPlsMatrix {
            rows: 2,
            cols: 2,
            values: vec![3.25, 8.0, 6.25, 28.0],
        };
        envelopes.get_mut(&key).unwrap().data_content_fingerprint =
            Some(methods_pls_predict_feature_content_fingerprint(&x).unwrap());
        envelopes.get_mut(&key).unwrap().target_content_fingerprint = None;
        let inputs = BTreeMap::from([(
            key,
            MethodsPlsDataset {
                y_validity_masks: None,
                sample_ids: samples.clone(),
                x,
                y: None,
                target_names: vec!["protein".into()],
            },
        )]);
        let replay =
            execute_loaded_methods_portable_refit_replay_v3(MethodsPortableRefitReplayInputV3 {
                package: &loaded,
                request: &replay_request,
                data_envelopes: &envelopes,
                methods_inputs: &inputs,
                runtime: methods_runtime(),
                supplemental_controllers: RuntimeControllerRegistry::new(),
                outcome_id: format!("replay:xl03.{family}"),
                run_id: RunId::new(format!("run:xl03.{family}.predict")).unwrap(),
                warnings: Vec::new(),
                diagnostics: BTreeMap::new(),
            })
            .unwrap();
        replay.validate_against(&loaded, &replay_request).unwrap();
        assert!(replay
            .lineage
            .iter()
            .all(|entry| entry.phase == Phase::Predict));
        assert_eq!(replay.outputs.len(), 1);
        assert_eq!(replay.outputs[0].predictions[0].sample_ids, samples);
        assert_eq!(
            serde_json::to_vec(&fixture.request).unwrap(),
            request_before
        );
        assert_eq!(serde_json::to_vec(&target_request).unwrap(), target_before);
        assert_eq!(serde_json::to_vec(&source_package).unwrap(), source_before);
        assert_eq!(serde_json::to_vec(&replay_request).unwrap(), replay_before);
        let mut forged = loaded.clone();
        forged
            .outcome
            .execution_bundle
            .raw_artifact_payloads
            .get_mut(&record.artifact.id)
            .unwrap()[0] ^= 1;
        assert!(forged.validate().is_err());
        assert!(build_archive_v3_native_refit_payloads("archive:xl03.tampered", &forged).is_err());
        let mut foreign_request = replay_request.clone();
        foreign_request.source_outcome_fingerprint = parent.outcome_fingerprint.clone();
        foreign_request.request_fingerprint = foreign_request.compute_fingerprint().unwrap();
        assert!(execute_loaded_methods_portable_refit_replay_v3(
            MethodsPortableRefitReplayInputV3 {
                package: &loaded,
                request: &foreign_request,
                data_envelopes: &envelopes,
                methods_inputs: &inputs,
                runtime: methods_runtime(),
                supplemental_controllers: RuntimeControllerRegistry::new(),
                outcome_id: "replay:xl03.foreign".into(),
                run_id: RunId::new("run:xl03.foreign").unwrap(),
                warnings: Vec::new(),
                diagnostics: BTreeMap::new(),
            }
        )
        .is_err());
        if let Some(directory) = std::env::var_os("DAGML_XL03_CAPTURE_DIR") {
            let directory = PathBuf::from(directory);
            std::fs::create_dir_all(&directory).unwrap();
            let write = |suffix: &str, value: serde_json::Value| {
                std::fs::write(
                    directory.join(format!("{family}-{suffix}.json")),
                    serde_json::to_vec_pretty(&value).unwrap(),
                )
                .unwrap();
            };
            write(
                "parent-package-v2",
                serde_json::to_value(&source_package).unwrap(),
            );
            write("package-v3", serde_json::to_value(&loaded).unwrap());
            write(
                "target-request",
                serde_json::to_value(&target_request).unwrap(),
            );
            write(
                "replay-request",
                serde_json::to_value(&replay_request).unwrap(),
            );
            write(
                "replay-envelopes",
                serde_json::to_value(&envelopes).unwrap(),
            );
            let inputs_json = inputs.iter().map(|(key, dataset)| {
                dataset.validate("captured PREDICT input", false).unwrap();
                assert!(dataset.y.is_none(), "PREDICT capture must remain target-free");
                (key.clone(), serde_json::json!({
                    "sample_ids": dataset.sample_ids,
                    "x": dataset.x.values.chunks_exact(dataset.x.cols).map(|row| row.to_vec()).collect::<Vec<_>>(),
                    "y": null,
                    "target_names": dataset.target_names,
                }))
            }).collect::<BTreeMap<_, _>>();
            write("replay-inputs", serde_json::to_value(&inputs_json).unwrap());
            write("replay-outcome", serde_json::to_value(&replay).unwrap());
            write("v3-manifest", archive.manifest.clone());
            let write_members = |version: &str, members: &BTreeMap<String, Vec<u8>>| {
                let root = directory.join(format!("{family}-{version}-members"));
                for (relative, bytes) in members {
                    let output = root.join(relative);
                    std::fs::create_dir_all(output.parent().unwrap()).unwrap();
                    std::fs::write(output, bytes).unwrap();
                }
            };
            write_members("v3", &archive.members);
            if role_pipeline {
                // V2's real trained parent is an independent cross-host replay
                // fixture, not an alias of the freshly refitted V3 state.
                let parent_archive = build_archive_v2_native_portable_payloads(
                    "archive:xl03.role-pls.parent",
                    &parent,
                    &source_package,
                )
                .unwrap();
                let parent_request = super::replay_request(&parent, Phase::Predict);
                let parent_replay =
                    execute_loaded_methods_predictor_replay(MethodsPortablePredictorReplayInput {
                        package: &source_package,
                        request: &parent_request,
                        data_envelopes: &envelopes,
                        methods_inputs: &inputs,
                        runtime: methods_runtime(),
                        outcome_id: "replay:xl03.role-pls.parent".into(),
                        run_id: RunId::new("run:xl03.role-pls.parent.predict").unwrap(),
                        warnings: Vec::new(),
                        diagnostics: BTreeMap::new(),
                    })
                    .unwrap();
                assert!(parent_replay
                    .lineage
                    .iter()
                    .all(|entry| entry.phase == Phase::Predict));
                write("v2-manifest", parent_archive.manifest);
                write_members("v2", &parent_archive.members);
                write(
                    "v2-replay-request",
                    serde_json::to_value(parent_request).unwrap(),
                );
                write(
                    "v2-replay-outcome",
                    serde_json::to_value(parent_replay).unwrap(),
                );
            }
            write(
                "oracle-data",
                serde_json::json!({"family":family,
                "X":target_provider.methods_rows.values().map(|row|row[..2].to_vec()).collect::<Vec<_>>(),
                "y":target_provider.methods_rows.values().map(|row|row[3]).collect::<Vec<_>>(),
                "parent_X":parent_provider.methods_rows.values().map(|row|row[..2].to_vec()).collect::<Vec<_>>(),
                "parent_y":parent_provider.methods_rows.values().map(|row|row[3]).collect::<Vec<_>>(),
                "parent_sample_ids":parent_provider.methods_rows.keys().collect::<Vec<_>>(),
                "sample_ids":target_provider.methods_rows.keys().collect::<Vec<_>>(),
                "predict_X":[[3.25,8.0],[6.25,28.0]],"predict_ids":samples,
                "n_components":1,"scale":true}),
            );
        }
    }

    fn content_hash_bytes(bytes: &[u8]) -> String {
        Sha256::digest(bytes)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }

    #[test]
    fn xl03_native_n4me_true_parent_refit_v3_and_cold_replay() {
        cycle(false);
    }

    #[test]
    fn xl03_native_role_pls_true_parent_refit_v3_and_cold_replay() {
        cycle(true);
    }
}

#[cfg(feature = "methods-optimizer-local")]
#[test]
fn native_methods_hpo_chained_resume_binds_immediate_parent_without_nested_packages() {
    let key = "methods_hpo_resumed_from_package_fingerprint";
    let mut parent: Option<PortablePredictorPackage> = None;
    let mut baseline_size = 0;
    for (generation, budget) in (2_u32..=5).enumerate() {
        let mut fixture = fixture(true, false);
        use_native_pls_phase_profile(&mut fixture, Some(budget));
        give_methods_hpo_four_train_rows(&mut fixture);
        methods_hpo_descriptor_mut(&mut fixture)["trials"] = serde_json::json!(budget);
        if let Some(previous) = &parent {
            methods_hpo_descriptor_mut(&mut fixture)["resume_package_json"] =
                serde_json::json!(serde_json::to_string(previous).unwrap());
        }
        rebuild(&mut fixture);
        fixture.request =
            TrainingRequest::from_json(&serde_json::to_string(&fixture.request).unwrap()).unwrap();
        let mut store = InMemoryArtifactStore::new();
        let outcome = run(
            &fixture,
            Arc::new(CallState::default()),
            &provider(&fixture),
            &mut store,
        )
        .unwrap();
        let state = outcome.methods_hpo_resume_state.as_ref().unwrap();
        assert_eq!(state.trial_history_len, budget);
        if let Some(previous) = &parent {
            assert_eq!(
                outcome.execution_bundle.metadata[key],
                serde_json::json!(previous.package_fingerprint)
            );
            let old = previous
                .execution_bundle
                .methods_hpo_resume_state
                .as_ref()
                .unwrap();
            assert_eq!(
                state.completed_proposals[..old.completed_proposals.len()],
                old.completed_proposals
            );
            assert_eq!(
                state.terminal_trials[..old.terminal_trials.len()],
                old.terminal_trials
            );
            assert_eq!(
                state.completed_reports[..old.completed_reports.len()],
                old.completed_reports
            );
        } else {
            assert!(!outcome.execution_bundle.metadata.contains_key(key));
        }
        let package = outcome
            .to_portable_predictor_package(
                format!("predictor:chain.{budget}"),
                FittedArtifactMode::PortableRequired,
                ArtifactLoadMode::NativePortable,
            )
            .unwrap();
        let encoded = serde_json::to_string(&package).unwrap();
        assert!(
            !encoded.contains("resume_package_json"),
            "no parent package bytes in durable child"
        );
        if generation == 0 {
            baseline_size = encoded.len();
        }
        assert!(encoded.len() <= baseline_size * (generation + 1),
            "history must grow linearly: {} bytes at generation {generation}, baseline {baseline_size}", encoded.len());
        let parsed = PortablePredictorPackage::from_json(&encoded).unwrap();
        if parent.is_some() {
            let mut tampered = parsed.clone();
            tampered
                .execution_bundle
                .metadata
                .insert(key.into(), serde_json::json!("b".repeat(64)));
            assert!(
                PortablePredictorPackage::from_json(&serde_json::to_string(&tampered).unwrap())
                    .is_err(),
                "the parent identity belongs to the sealed package preimage"
            );
        }
        // Every segment is cold-loadable with fresh native controllers and without
        // a host-sidecar fallback; PREDICT retains the live model's outputs.
        let source = TrainingOutcome::from_json(&serde_json::to_string(&outcome).unwrap()).unwrap();
        let request = replay_request(&source, Phase::Predict);
        let registry = controllers(&fixture, Arc::new(CallState::default()), true);
        let loaded = parsed
            .clone()
            .load_with(|record| panic!("unexpected host-sidecar artifact {}", record.artifact.id))
            .unwrap();
        let replay = execute_loaded_predictor_replay(LoadedPredictorReplayInput {
            predictor: &loaded,
            request: &request,
            outcome_id: format!("replay:chain.{budget}"),
            run_id: RunId::new(format!("run:chain.{budget}")).unwrap(),
            controllers: &registry,
            data_provider: &provider(&fixture),
            data_envelopes: &replay_envelopes_with_relation(&source, &"a".repeat(64)),
            warnings: Vec::new(),
            diagnostics: BTreeMap::new(),
        })
        .unwrap();
        assert_eq!(
            source.outputs[0].predictions[0].sample_ids,
            replay.outputs[0].predictions[0].sample_ids
        );
        for (a, b) in source.outputs[0].predictions[0]
            .values
            .iter()
            .flatten()
            .zip(replay.outputs[0].predictions[0].values.iter().flatten())
        {
            assert!((a - b).abs() < 1e-12, "cold native model prediction drift");
        }
        parent = Some(parsed);
    }
}

#[cfg(feature = "methods-optimizer-local")]
#[derive(serde::Deserialize)]
struct CoreTransportRoundtrip {
    tampered_member_rejected: bool,
    schema_version: u32,
    oracle_package: String,
    oracle_version: String,
    writer_reference: serde_json::Value,
    loaded_reference: serde_json::Value,
    loaded_is_v2: bool,
    members: BTreeMap<String, Vec<u8>>,
    portable_package: Vec<u8>,
}

#[cfg(feature = "methods-optimizer-local")]
fn core_transport_roundtrip(
    manifest: &serde_json::Value,
    members: &BTreeMap<String, Vec<u8>>,
) -> CoreTransportRoundtrip {
    use std::io::{Read, Write};
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};
    let requires_v3 = manifest["payloads"]["methods"]["n4mm"]
        .as_array()
        .expect("closed native Methods references")
        .iter()
        .any(|reference| reference["format_version"] == serde_json::json!(3));
    let oracle_variable = if requires_v3 {
        "DAG_ML_CURRENT_CORE_ORACLE"
    } else {
        "DAG_ML_HISTORICAL_CORE_ORACLE"
    };
    let binary = std::env::var_os(oracle_variable)
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            assert!(!requires_v3,
                "N4MM v3 requires an explicitly qualified current Core oracle via DAG_ML_CURRENT_CORE_ORACLE; historical Core 0.4.3 cannot read this format");
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(
                "../../tools/historical-core-oracle/target/debug/dag-ml-historical-core-oracle",
            )
        });
    let input = serde_json::to_vec(&serde_json::json!({
        "schema_version": 1, "manifest": manifest,
        "payloads": members.iter().map(|(path, bytes)| serde_json::json!({"path": path, "bytes": bytes})).collect::<Vec<_>>(),
    })).unwrap();
    assert!(
        input.len() <= 16 * 1024 * 1024,
        "trusted fixture exceeds oracle transport bound"
    );
    let mut child = Command::new(&binary)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .unwrap_or_else(|error| {
            panic!(
                "configure/build the explicit Core oracle ({oracle_variable}) first; {}: {error}",
                binary.display()
            )
        });
    child.stdin.take().unwrap().write_all(&input).unwrap();
    // Drain concurrently so a bounded response cannot deadlock a pipe before wait.
    let stdout = child.stdout.take().unwrap();
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout
            .take(16 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .unwrap();
        bytes
    });
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().unwrap() {
            break status;
        }
        if started.elapsed() > Duration::from_secs(30) {
            let _ = child.kill();
            let _ = child.wait();
            panic!("Core oracle exceeded 30 second execution bound");
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    assert!(status.success(), "selected Core oracle failed");
    let output = reader.join().unwrap();
    assert!(
        output.len() <= 16 * 1024 * 1024,
        "historical oracle response exceeds transport bound"
    );
    let response: CoreTransportRoundtrip = serde_json::from_slice(&output).unwrap();
    assert_eq!(response.schema_version, 1);
    assert_eq!(response.oracle_package, "nirs4all");
    assert_eq!(
        response.oracle_version,
        if requires_v3 { "0.4.6" } else { "0.4.3" }
    );
    assert_eq!(
        &response.members, members,
        "historical Core must preserve every witness member byte-for-byte"
    );
    response
}

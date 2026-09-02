// Auto-split from the former monolithic `runtime.rs` (pure refactor).
use super::*;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DataMaterializationRequest {
    pub run_id: RunId,
    pub node_id: NodeId,
    pub input_name: String,
    pub phase: Phase,
    pub variant_id: Option<VariantId>,
    pub fold_id: Option<FoldId>,
    pub binding: crate::data::DataBinding,
    /// The optional, separately attested cohort selected only for a top-level
    /// PREDICT operation.  It is absent for the V1 path and for every phase
    /// that can fit, validate, select, refit, or calibrate a model.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub predict_cohort: Option<crate::data::PredictCohort>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DataProviderViewSpec {
    #[serde(default)]
    pub sample_ids: Option<Vec<SampleId>>,
    pub partition: DataRequestPartition,
    #[serde(default)]
    pub fold_id: Option<FoldId>,
    #[serde(default)]
    pub source_ids: Option<Vec<String>>,
    #[serde(default)]
    pub columns: Option<Vec<String>>,
    pub include_augmented: bool,
    pub include_excluded: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch_view: Option<crate::data::BranchViewPlan>,
    #[serde(default)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

pub const DATA_OUTPUT_PROVENANCE_KEY: &str = "dag_ml_output";
pub const DATA_OUTPUT_PROVENANCE_SCHEMA_VERSION: u32 = 1;
pub const DATA_OUTPUT_PROVENANCE_SCHEMA_ID: &str =
    "https://github.com/GBeurier/dag-ml/schemas/data_output_provenance.v1.schema.json";
pub const NODE_TASK_SCHEMA_VERSION: u32 = 1;
pub const NODE_TASK_SCHEMA_ID: &str =
    "https://github.com/GBeurier/dag-ml/schemas/node_task.v1.schema.json";
pub const NODE_RESULT_SCHEMA_VERSION: u32 = 1;
pub const NODE_RESULT_SCHEMA_ID: &str =
    "https://github.com/GBeurier/dag-ml/schemas/node_result.v1.schema.json";

pub(crate) fn default_data_output_provenance_schema_version() -> u32 {
    DATA_OUTPUT_PROVENANCE_SCHEMA_VERSION
}

impl DataProviderViewSpec {
    pub fn validate(&self) -> Result<()> {
        validate_optional_ids("sample id", &self.sample_ids)?;
        validate_optional_strings("source id", &self.source_ids)?;
        validate_optional_strings("column", &self.columns)?;
        match self.partition {
            DataRequestPartition::FoldTrain | DataRequestPartition::FoldValidation => {
                if self.sample_ids.is_some() && self.fold_id.is_none() {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "data provider view {:?} with explicit sample ids requires a fold id",
                        self.partition
                    )));
                }
            }
            DataRequestPartition::FullTrain | DataRequestPartition::Predict => {
                if self.fold_id.is_some() {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "data provider view {:?} must not carry a fold id",
                        self.partition
                    )));
                }
            }
        }
        for key in self.extra.keys() {
            if key.trim().is_empty() {
                return Err(DagMlError::RuntimeValidation(
                    "data provider view extra contains an empty key".to_string(),
                ));
            }
        }
        if let Some(branch_view) = &self.branch_view {
            branch_view.validate()?;
        }
        self.output_provenance()?;
        Ok(())
    }

    pub fn output_provenance(&self) -> Result<Option<DataOutputProvenance>> {
        let Some(value) = self.extra.get(DATA_OUTPUT_PROVENANCE_KEY) else {
            return Ok(None);
        };
        let provenance: DataOutputProvenance = serde_json::from_value(value.clone())?;
        provenance.validate()?;
        Ok(Some(provenance))
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DataOutputProvenance {
    #[serde(default = "default_data_output_provenance_schema_version")]
    pub schema_version: u32,
    pub producer_node: NodeId,
    pub producer_port: String,
    pub producer_phase: Phase,
    #[serde(default)]
    pub variant_id: Option<VariantId>,
    #[serde(default)]
    pub fold_id: Option<FoldId>,
    #[serde(default)]
    pub shape_plan_fingerprint: Option<String>,
    #[serde(default)]
    pub aggregation_policy_fingerprint: Option<String>,
    #[serde(default)]
    pub feature_namespace: Option<String>,
    #[serde(default)]
    pub feature_schema_fingerprint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub representation_plan: Option<RepresentationPlan>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub representation_replay_manifest: Option<RepresentationReplayManifest>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub representation_compatibility: Option<RepresentationCompatibilityReport>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relation_delta_fingerprint: Option<String>,
    #[serde(default)]
    pub shape_deltas: Vec<ShapeDelta>,
}

impl DataOutputProvenance {
    pub fn validate(&self) -> Result<()> {
        if self.schema_version != DATA_OUTPUT_PROVENANCE_SCHEMA_VERSION {
            return Err(DagMlError::RuntimeValidation(format!(
                "data output provenance for `{}` uses unsupported schema_version {}, expected {}",
                self.producer_node, self.schema_version, DATA_OUTPUT_PROVENANCE_SCHEMA_VERSION
            )));
        }
        if self.producer_port.trim().is_empty() {
            return Err(DagMlError::RuntimeValidation(format!(
                "data output provenance for `{}` has empty producer_port",
                self.producer_node
            )));
        }
        validate_optional_fingerprint(
            "shape_plan_fingerprint",
            &self.shape_plan_fingerprint,
            &self.producer_node,
        )?;
        validate_optional_fingerprint(
            "aggregation_policy_fingerprint",
            &self.aggregation_policy_fingerprint,
            &self.producer_node,
        )?;
        validate_optional_fingerprint(
            "feature_schema_fingerprint",
            &self.feature_schema_fingerprint,
            &self.producer_node,
        )?;
        validate_optional_fingerprint(
            "relation_delta_fingerprint",
            &self.relation_delta_fingerprint,
            &self.producer_node,
        )?;
        if let Some(representation_plan) = &self.representation_plan {
            representation_plan.validate().map_err(|error| {
                DagMlError::RuntimeValidation(format!(
                    "data output provenance for `{}` has invalid representation_plan: {error}",
                    self.producer_node
                ))
            })?;
        }
        if let Some(replay_manifest) = &self.representation_replay_manifest {
            replay_manifest.validate().map_err(|error| {
                DagMlError::RuntimeValidation(format!(
                    "data output provenance for `{}` has invalid representation_replay_manifest: {error}",
                    self.producer_node
                ))
            })?;
        }
        if let Some(report) = &self.representation_compatibility {
            report.validate().map_err(|error| {
                DagMlError::RuntimeValidation(format!(
                    "data output provenance for `{}` has invalid representation_compatibility: {error}",
                    self.producer_node
                ))
            })?;
        }
        if self
            .feature_namespace
            .as_ref()
            .is_some_and(|namespace| namespace.trim().is_empty())
        {
            return Err(DagMlError::RuntimeValidation(format!(
                "data output provenance for `{}` has empty feature_namespace",
                self.producer_node
            )));
        }
        for delta in &self.shape_deltas {
            delta.validate()?;
            if delta.node_id != self.producer_node {
                return Err(DagMlError::RuntimeValidation(format!(
                    "data output provenance for `{}` contains shape delta for `{}`",
                    self.producer_node, delta.node_id
                )));
            }
        }
        if let Some(feature_schema_fingerprint) = &self.feature_schema_fingerprint {
            if let Some(last_feature_delta) = self
                .shape_deltas
                .iter()
                .rev()
                .find(|delta| delta.kind == ShapeDeltaKind::Feature)
            {
                if &last_feature_delta.after_fingerprint != feature_schema_fingerprint {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "data output provenance for `{}` has feature_schema_fingerprint `{feature_schema_fingerprint}` but last feature delta ends at `{}`",
                        self.producer_node, last_feature_delta.after_fingerprint
                    )));
                }
            }
        }
        Ok(())
    }
}

pub(crate) fn validate_optional_fingerprint(
    label: &str,
    fingerprint: &Option<String>,
    producer_node: &NodeId,
) -> Result<()> {
    let Some(fingerprint) = fingerprint else {
        return Ok(());
    };
    if fingerprint.len() != 64 || !fingerprint.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(DagMlError::RuntimeValidation(format!(
            "data output provenance for `{producer_node}` has invalid {label}"
        )));
    }
    Ok(())
}

pub(crate) fn validate_optional_ids<T>(label: &str, values: &Option<Vec<T>>) -> Result<()>
where
    T: Ord + ToString,
{
    let Some(values) = values else {
        return Ok(());
    };
    if values.is_empty() {
        return Err(DagMlError::RuntimeValidation(format!(
            "data provider view {label} list is empty"
        )));
    }
    let mut seen = BTreeSet::new();
    for value in values {
        if !seen.insert(value) {
            return Err(DagMlError::RuntimeValidation(format!(
                "data provider view has duplicate {label} `{}`",
                value.to_string()
            )));
        }
    }
    Ok(())
}

pub(crate) fn validate_optional_strings(label: &str, values: &Option<Vec<String>>) -> Result<()> {
    let Some(values) = values else {
        return Ok(());
    };
    if values.is_empty() {
        return Err(DagMlError::RuntimeValidation(format!(
            "data provider view {label} list is empty"
        )));
    }
    let mut seen = BTreeSet::new();
    for value in values {
        if value.trim().is_empty() {
            return Err(DagMlError::RuntimeValidation(format!(
                "data provider view contains an empty {label}"
            )));
        }
        if !seen.insert(value.as_str()) {
            return Err(DagMlError::RuntimeValidation(format!(
                "data provider view has duplicate {label} `{value}`"
            )));
        }
    }
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DataViewRequest {
    pub run_id: RunId,
    pub node_id: NodeId,
    pub input_name: String,
    pub phase: Phase,
    pub variant_id: Option<VariantId>,
    pub fold_id: Option<FoldId>,
    pub binding: crate::data::DataBinding,
    pub data_handle: HandleRef,
    pub view: DataProviderViewSpec,
    /// The same PREDICT-only authority carried by the materialization
    /// request.  The envelope-attested wrapper compares it exactly before a
    /// host provider can observe a data view.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub predict_cohort: Option<crate::data::PredictCohort>,
}

pub trait RuntimeDataProvider {
    fn materialize(&self, request: &DataMaterializationRequest) -> Result<HandleRef>;
    fn make_view(&self, request: &DataViewRequest) -> Result<HandleRef>;
    /// Attest the exact feature and target content bound to one training input.
    ///
    /// Legacy phase execution may return `None`; the native W1 training
    /// operation requires `Some` and compares it byte-for-byte with the signed
    /// [`TrainingDataIdentity`](crate::training::TrainingDataIdentity).
    fn training_data_identity(
        &self,
        _binding: &DataBinding,
    ) -> Result<Option<crate::training::TrainingDataIdentity>> {
        Ok(None)
    }
    fn coordinator_relations(&self, _binding: &DataBinding) -> Result<Option<SampleRelationSet>> {
        Ok(None)
    }

    /// Return the separately attested cohort that may be consumed by one
    /// top-level PREDICT request. It is unavailable to every phase that can
    /// fit, validate, rank, or calibrate a model.
    fn predict_cohort(
        &self,
        _binding: &DataBinding,
        phase: Phase,
    ) -> Result<Option<crate::data::PredictCohort>> {
        validate_predict_cohort_phase(phase)?;
        Ok(None)
    }

    /// Confirm that this provider can supply the deliberately narrow numeric
    /// view consumed by the portable Methods PLS controller.  The default is a
    /// refusal, so an ordinary data provider can never accidentally expose its
    /// buffers to a native numerical controller.
    fn methods_pls_capability(&self) -> Result<()> {
        Err(DagMlError::RuntimeValidation(
            "runtime data provider does not implement the portable Methods PLS numeric view"
                .to_string(),
        ))
    }

    fn preflight_methods_pls(&self, request: &MethodsPlsDataRequest) -> Result<()> {
        request.validate()?;
        self.methods_pls_capability()
    }

    /// Return provider-selected row-major numeric values for a Methods PLS
    /// invocation.  This is not a raw IO escape hatch: the request carries the
    /// scheduler-created, identity-keyed data views and the provider is solely
    /// responsible for resolving them to rows and targets.
    fn methods_pls_data(&self, _request: &MethodsPlsDataRequest) -> Result<MethodsPlsData> {
        Err(DagMlError::RuntimeValidation(
            "runtime data provider does not implement the portable Methods PLS numeric view"
                .to_string(),
        ))
    }
}

fn validate_predict_cohort_phase(phase: Phase) -> Result<()> {
    if phase != Phase::Predict {
        return Err(DagMlError::RuntimeValidation(format!(
            "predict cohort may be requested only during PREDICT, got {phase:?}"
        )));
    }
    Ok(())
}

/// Row-major `f64` matrix passed from an explicitly capable provider to the
/// portable Methods PLS controller.  It never crosses the public ABI.
#[derive(Clone, Debug, PartialEq)]
pub struct MethodsPlsMatrix {
    pub values: Vec<f64>,
    pub rows: usize,
    pub cols: usize,
}

impl MethodsPlsMatrix {
    pub fn validate(&self, label: &str) -> Result<()> {
        if self.rows == 0
            || self.cols == 0
            || self.rows.checked_mul(self.cols) != Some(self.values.len())
        {
            return Err(DagMlError::RuntimeValidation(format!(
                "portable Methods PLS {label} matrix has invalid row-major dimensions"
            )));
        }
        if self.values.iter().any(|value| !value.is_finite()) {
            return Err(DagMlError::RuntimeValidation(format!(
                "portable Methods PLS {label} matrix contains a non-finite value"
            )));
        }
        Ok(())
    }
}

/// One identity-keyed dataset returned by the portable PLS provider capability.
#[derive(Clone, Debug, PartialEq)]
pub struct MethodsPlsDataset {
    pub sample_ids: Vec<SampleId>,
    pub x: MethodsPlsMatrix,
    /// Targets are required for fitting/CV scoring, but deliberately absent
    /// for production PREDICT.  A predictor must never require labels merely
    /// to materialize an inference cohort.
    pub y: Option<MethodsPlsMatrix>,
    pub target_names: Vec<String>,
}

impl MethodsPlsDataset {
    pub fn validate(&self, label: &str, require_targets: bool) -> Result<()> {
        self.x.validate(&format!("{label}.x"))?;
        if self.sample_ids.len() != self.x.rows {
            return Err(DagMlError::RuntimeValidation(format!(
                "portable Methods PLS {label} rows do not match sample identities"
            )));
        }
        if self.target_names.is_empty()
            || self.target_names.iter().any(|name| name.trim().is_empty())
        {
            return Err(DagMlError::RuntimeValidation(format!(
                "portable Methods PLS {label} has invalid target names"
            )));
        }
        match &self.y {
            Some(y) => {
                y.validate(&format!("{label}.y"))?;
                if self.sample_ids.len() != y.rows || self.target_names.len() != y.cols {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "portable Methods PLS {label} targets do not match sample identities or target names"
                    )));
                }
            }
            None if require_targets => {
                return Err(DagMlError::RuntimeValidation(format!(
                    "portable Methods PLS {label} requires targets for fitting or CV scoring"
                )))
            }
            None => {}
        }
        let unique = self.sample_ids.iter().collect::<BTreeSet<_>>();
        if unique.len() != self.sample_ids.len() {
            return Err(DagMlError::RuntimeValidation(format!(
                "portable Methods PLS {label} contains duplicate sample identities"
            )));
        }
        Ok(())
    }
}

/// Scheduler-owned view selection for a portable Methods PLS operation.
#[derive(Clone, Debug, PartialEq)]
pub struct MethodsPlsDataRequest {
    pub node_id: NodeId,
    pub phase: Phase,
    pub variant_id: Option<VariantId>,
    pub fold_id: Option<FoldId>,
    /// The exact signed data-plan binding selected by the scheduler.  Native
    /// numerical adapters must not manufacture a dataset from sample IDs.
    pub binding: DataBinding,
    /// Complete training identity attested by the provider for `binding`.
    ///
    /// FIT_CV and REFIT require this evidence because they fit or score against
    /// targets. A fresh PREDICT cohort may legitimately be X-only, in which
    /// case the scheduler's replay-envelope path carries the nullable target
    /// evidence and this field is `None`. No synthetic target fingerprint is
    /// permitted to fill that gap.
    pub identity: Option<crate::training::TrainingDataIdentity>,
    pub fit_view: DataProviderViewSpec,
    pub prediction_view: Option<DataProviderViewSpec>,
}

impl MethodsPlsDataRequest {
    pub fn validate(&self) -> Result<()> {
        self.binding.validate()?;
        match &self.identity {
            Some(identity) => {
                identity.validate()?;
                if identity.requirement_key
                    != crate::data::data_binding_requirement_key(
                        &self.binding.node_id,
                        &self.binding.input_name,
                    )
                {
                    return Err(DagMlError::RuntimeValidation(
                        "portable Methods PLS identity is not bound to its data binding"
                            .to_string(),
                    ));
                }
            }
            None if self.phase != Phase::Predict => {
                return Err(DagMlError::RuntimeValidation(
                    "portable Methods PLS FIT_CV/REFIT requires a target-bound training data identity"
                        .to_string(),
                ));
            }
            None => {}
        }
        self.fit_view.validate()?;
        if let Some(view) = &self.prediction_view {
            view.validate()?;
        }
        Ok(())
    }
}

/// Provider response for one PLS fit/predict invocation.
#[derive(Clone, Debug, PartialEq)]
pub struct MethodsPlsData {
    pub fit: MethodsPlsDataset,
    pub prediction: Option<MethodsPlsDataset>,
}

impl MethodsPlsData {
    pub fn validate_for(&self, request: &MethodsPlsDataRequest) -> Result<()> {
        request.validate()?;
        self.fit.validate("fit", request.phase != Phase::Predict)?;
        if let Some(expected_sample_ids) = &request.fit_view.sample_ids {
            if self.fit.sample_ids != *expected_sample_ids {
                return Err(DagMlError::RuntimeValidation(
                    "portable Methods PLS fit rows do not exactly match the scheduler-selected identity view".to_string(),
                ));
            }
        } else if request.phase != Phase::Predict {
            return Err(DagMlError::RuntimeValidation(
                "portable Methods PLS fit view must carry scheduler-selected sample identities"
                    .to_string(),
            ));
        }
        if let Some(prediction) = &self.prediction {
            prediction.validate("prediction", request.phase == Phase::FitCv)?;
            if prediction.sample_ids != request.prediction_view_sample_ids()? {
                return Err(DagMlError::RuntimeValidation(
                    "portable Methods PLS prediction rows do not exactly match the scheduler-selected identity view".to_string(),
                ));
            }
            if prediction.x.cols != self.fit.x.cols
                || prediction.target_names != self.fit.target_names
                || matches!((&prediction.y, &self.fit.y), (Some(left), Some(right)) if left.cols != right.cols)
            {
                return Err(DagMlError::RuntimeValidation(
                    "portable Methods PLS prediction schema differs from fit schema".to_string(),
                ));
            }
        }
        if request.prediction_view.is_some() != self.prediction.is_some() {
            return Err(DagMlError::RuntimeValidation(
                "portable Methods PLS provider did not return exactly the requested prediction view".to_string(),
            ));
        }
        Ok(())
    }
}

/// One host-materialized X-only cohort offered to the native Methods PLS
/// controller for a fresh PREDICT replay.
///
/// The feature-content fingerprint is intentionally carried separately from
/// the numeric matrix: Core binds it to the signed external envelope, while
/// the production IO provider remains the authority that derives it from its
/// source bytes. This runtime layer neither synthesizes targets nor invents a
/// feature-content hash.
pub const METHODS_PLS_PREDICT_CONTENT_PROFILE: &str = "n4a-matrix-f64-le.v1";

/// Compute the published X-only content identity for a Methods PLS cohort.
///
/// The preimage is the ASCII profile plus NUL, two little-endian `u64`
/// dimensions and each finite IEEE-754 `f64` bit-pattern in row-major order.
/// It deliberately does not include sample identities or targets: those have
/// their own signed envelope/relation proofs.
pub fn methods_pls_predict_feature_content_fingerprint(
    matrix: &MethodsPlsMatrix,
) -> Result<String> {
    matrix.validate("PREDICT feature fingerprint")?;
    let rows = u64::try_from(matrix.rows).map_err(|_| {
        DagMlError::RuntimeValidation(
            "portable Methods PLS PREDICT matrix row count does not fit the content identity profile"
                .to_string(),
        )
    })?;
    let cols = u64::try_from(matrix.cols).map_err(|_| {
        DagMlError::RuntimeValidation(
            "portable Methods PLS PREDICT matrix column count does not fit the content identity profile"
                .to_string(),
        )
    })?;
    let mut hasher = Sha256::new();
    hasher.update(METHODS_PLS_PREDICT_CONTENT_PROFILE.as_bytes());
    hasher.update([0]);
    hasher.update(rows.to_le_bytes());
    hasher.update(cols.to_le_bytes());
    for value in &matrix.values {
        hasher.update(value.to_bits().to_le_bytes());
    }
    Ok(format!("{:x}", hasher.finalize()))
}

#[derive(Clone, Debug, PartialEq)]
pub struct MethodsPlsPredictInput {
    /// Must be [`METHODS_PLS_PREDICT_CONTENT_PROFILE`].
    pub data_content_profile: String,
    pub data_content_fingerprint: String,
    pub dataset: MethodsPlsDataset,
}

/// Native, in-memory data provider for target-free Methods PLS PREDICT.
///
/// It is deliberately PREDICT-only: training must use a provider that can
/// produce the complete target-bound [`crate::training::TrainingDataIdentity`]. The provider
/// owns only row-major values already materialized by the upstream IO layer;
/// it delegates data/view handles and envelope identity checks to the normal
/// runtime provider rather than bypassing the scheduler.
#[derive(Debug)]
pub struct MethodsPlsPredictDataProvider {
    inner: EnvelopeAttestedRuntimeDataProvider<crate::data::InMemoryDataProvider>,
    inputs: BTreeMap<String, MethodsPlsPredictInput>,
}

impl MethodsPlsPredictDataProvider {
    pub fn new<I>(
        owner_controller: ControllerId,
        bindings: I,
        envelopes: BTreeMap<String, ExternalDataPlanEnvelope>,
        inputs: BTreeMap<String, MethodsPlsPredictInput>,
    ) -> Result<Self>
    where
        I: IntoIterator<Item = DataBinding>,
    {
        let bindings = bindings.into_iter().collect::<Vec<_>>();
        let expected_keys = bindings
            .iter()
            .map(|binding| data_binding_requirement_key(&binding.node_id, &binding.input_name))
            .collect::<BTreeSet<_>>();
        let input_keys = inputs.keys().cloned().collect::<BTreeSet<_>>();
        if input_keys.is_empty() || !input_keys.is_subset(&expected_keys) {
            return Err(DagMlError::RuntimeValidation(format!(
                "portable Methods PLS PREDICT inputs must name registered runtime bindings (unexpected: [{}])",
                input_keys
                    .difference(&expected_keys)
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(", "),
            )));
        }
        for (key, input) in &inputs {
            input.dataset.validate("predict input", false)?;
            if input.data_content_profile != METHODS_PLS_PREDICT_CONTENT_PROFILE {
                return Err(DagMlError::RuntimeValidation(format!(
                    "portable Methods PLS PREDICT input `{key}` has unsupported feature content profile `{}`",
                    input.data_content_profile,
                )));
            }
            let actual_fingerprint =
                methods_pls_predict_feature_content_fingerprint(&input.dataset.x)?;
            if input.data_content_fingerprint != actual_fingerprint {
                return Err(DagMlError::RuntimeValidation(format!(
                    "portable Methods PLS PREDICT input `{key}` feature content fingerprint does not match its row-major f64 values"
                )));
            }
            if input.dataset.y.is_some() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "portable Methods PLS PREDICT input `{key}` must not carry targets"
                )));
            }
            let envelope = envelopes.get(key).ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "portable Methods PLS PREDICT input `{key}` has no external envelope"
                ))
            })?;
            envelope.validate()?;
            let expected_fingerprint = envelope.data_content_fingerprint.as_deref().ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "portable Methods PLS PREDICT envelope `{key}` has no feature content fingerprint"
                ))
            })?;
            if input.data_content_fingerprint != expected_fingerprint {
                return Err(DagMlError::RuntimeValidation(format!(
                    "portable Methods PLS PREDICT input `{key}` feature content fingerprint does not match its envelope"
                )));
            }
            if envelope.target_content_fingerprint.is_some() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "portable Methods PLS PREDICT input `{key}` requires a target-free envelope"
                )));
            }
        }

        let mut raw = crate::data::InMemoryDataProvider::new(owner_controller);
        for envelope in envelopes.values().cloned() {
            raw.register_envelope(envelope)?;
        }
        let inner = EnvelopeAttestedRuntimeDataProvider::new(raw, bindings, envelopes)?;
        Ok(Self { inner, inputs })
    }

    fn input_for(&self, request: &MethodsPlsDataRequest) -> Result<&MethodsPlsPredictInput> {
        request.validate()?;
        if request.phase != Phase::Predict || request.identity.is_some() {
            return Err(DagMlError::RuntimeValidation(
                "portable Methods PLS target-free provider supports only PREDICT without a training identity"
                    .to_string(),
            ));
        }
        if request.prediction_view.is_some() {
            return Err(DagMlError::RuntimeValidation(
                "portable Methods PLS target-free provider does not support FIT_CV validation views"
                    .to_string(),
            ));
        }
        let key =
            data_binding_requirement_key(&request.binding.node_id, &request.binding.input_name);
        let input = self.inputs.get(&key).ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "portable Methods PLS target-free provider has no input for `{key}`"
            ))
        })?;
        if let Some(expected_sample_ids) = &request.fit_view.sample_ids {
            if input.dataset.sample_ids != *expected_sample_ids {
                return Err(DagMlError::RuntimeValidation(
                    "portable Methods PLS target-free input rows do not match the scheduler-selected identity view"
                        .to_string(),
                ));
            }
        }
        Ok(input)
    }
}

impl RuntimeDataProvider for MethodsPlsPredictDataProvider {
    fn materialize(&self, request: &DataMaterializationRequest) -> Result<HandleRef> {
        self.inner.materialize(request)
    }

    fn make_view(&self, request: &DataViewRequest) -> Result<HandleRef> {
        self.inner.make_view(request)
    }

    fn training_data_identity(
        &self,
        binding: &DataBinding,
    ) -> Result<Option<crate::training::TrainingDataIdentity>> {
        self.inner.training_data_identity(binding)
    }

    fn coordinator_relations(&self, binding: &DataBinding) -> Result<Option<SampleRelationSet>> {
        self.inner.coordinator_relations(binding)
    }

    fn predict_cohort(
        &self,
        binding: &DataBinding,
        phase: Phase,
    ) -> Result<Option<crate::data::PredictCohort>> {
        self.inner.predict_cohort(binding, phase)
    }

    fn methods_pls_capability(&self) -> Result<()> {
        Ok(())
    }

    fn preflight_methods_pls(&self, request: &MethodsPlsDataRequest) -> Result<()> {
        self.input_for(request)?;
        Ok(())
    }

    fn methods_pls_data(&self, request: &MethodsPlsDataRequest) -> Result<MethodsPlsData> {
        let input = self.input_for(request)?;
        Ok(MethodsPlsData {
            fit: input.dataset.clone(),
            prediction: None,
        })
    }
}

impl MethodsPlsDataRequest {
    fn prediction_view_sample_ids(&self) -> Result<Vec<SampleId>> {
        self.prediction_view
            .as_ref()
            .and_then(|view| view.sample_ids.clone())
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(
                    "portable Methods PLS prediction view must carry scheduler-selected sample identities".to_string(),
                )
            })
    }
}

#[derive(Debug)]
struct EnvelopeAttestation {
    binding: DataBinding,
    envelope: ExternalDataPlanEnvelope,
    /// `None` is valid only for a target-free fresh PREDICT envelope. Training
    /// execution requests the identity through `RuntimeDataProvider` and
    /// rejects absence before any numerical controller is invoked.
    identity: Option<crate::training::TrainingDataIdentity>,
}

/// Owns a host data provider while supplying envelope-backed identities at the
/// runtime trust boundary. A complete training identity is available only
/// when the envelope carries feature, target and relation fingerprints.
///
/// Construction validates the complete binding/envelope set before the inner
/// provider can be invoked. Runtime calls are delegated only when their full
/// [`DataBinding`] is field-for-field equal to the binding registered for the
/// rendered V1 requirement key.
#[derive(Debug)]
pub struct EnvelopeAttestedRuntimeDataProvider<P> {
    inner: P,
    attestations: BTreeMap<String, EnvelopeAttestation>,
}

impl<P> EnvelopeAttestedRuntimeDataProvider<P> {
    pub fn new<I>(
        inner: P,
        bindings: I,
        mut envelopes: BTreeMap<String, ExternalDataPlanEnvelope>,
    ) -> Result<Self>
    where
        I: IntoIterator<Item = DataBinding>,
    {
        let mut bindings_by_key: BTreeMap<String, DataBinding> = BTreeMap::new();
        for binding in bindings {
            binding.validate()?;
            let key = data_binding_requirement_key(&binding.node_id, &binding.input_name);
            if let Some(previous) = bindings_by_key.get(&key) {
                let detail = if previous.node_id == binding.node_id
                    && previous.input_name == binding.input_name
                {
                    "duplicates the same coordinates"
                } else {
                    "uses distinct coordinates that collide under the V1 node.input spelling"
                };
                return Err(DagMlError::RuntimeValidation(format!(
                    "data binding requirement key `{key}` {detail}"
                )));
            }
            bindings_by_key.insert(key, binding);
        }

        let expected_keys = bindings_by_key.keys().cloned().collect::<BTreeSet<_>>();
        let actual_keys = envelopes.keys().cloned().collect::<BTreeSet<_>>();
        if expected_keys != actual_keys {
            let missing = expected_keys
                .difference(&actual_keys)
                .cloned()
                .collect::<Vec<_>>();
            let unexpected = actual_keys
                .difference(&expected_keys)
                .cloned()
                .collect::<Vec<_>>();
            return Err(DagMlError::RuntimeValidation(format!(
                "attested data envelopes must exactly cover runtime bindings (missing: [{}]; unexpected: [{}])",
                missing.join(", "),
                unexpected.join(", ")
            )));
        }

        let mut attestations = BTreeMap::new();
        for (key, binding) in bindings_by_key {
            let envelope = envelopes
                .remove(&key)
                .expect("exact key coverage was checked above");
            let identity = if envelope.relation_fingerprint.is_some()
                && envelope.data_content_fingerprint.is_some()
                && envelope.target_content_fingerprint.is_some()
            {
                Some(
                    crate::training::TrainingDataIdentity::from_binding_envelope(
                        &binding, &envelope,
                    )?,
                )
            } else {
                None
            };
            attestations.insert(
                key,
                EnvelopeAttestation {
                    binding,
                    envelope,
                    identity,
                },
            );
        }

        Ok(Self {
            inner,
            attestations,
        })
    }

    pub fn inner(&self) -> &P {
        &self.inner
    }

    pub fn into_inner(self) -> P {
        self.inner
    }

    fn attestation_for_binding(&self, binding: &DataBinding) -> Result<&EnvelopeAttestation> {
        binding.validate()?;
        let key = data_binding_requirement_key(&binding.node_id, &binding.input_name);
        let attestation = self.attestations.get(&key).ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "runtime data binding `{key}` has no registered envelope attestation"
            ))
        })?;
        if attestation.binding != *binding {
            return Err(DagMlError::RuntimeValidation(format!(
                "runtime data binding `{key}` does not exactly match its attested binding"
            )));
        }
        Ok(attestation)
    }

    fn validate_request_binding(
        &self,
        node_id: &NodeId,
        input_name: &str,
        binding: &DataBinding,
    ) -> Result<()> {
        if node_id != &binding.node_id || input_name != binding.input_name {
            return Err(DagMlError::RuntimeValidation(format!(
                "runtime data request coordinates `{node_id}.{input_name}` do not match binding `{}`",
                data_binding_requirement_key(&binding.node_id, &binding.input_name)
            )));
        }
        self.attestation_for_binding(binding)?;
        Ok(())
    }

    fn validate_predict_cohort_request(
        &self,
        binding: &DataBinding,
        phase: Phase,
        supplied: &Option<crate::data::PredictCohort>,
    ) -> Result<()> {
        let attestation = self.attestation_for_binding(binding)?;
        match phase {
            Phase::Predict => {
                if let Some(cohort) = supplied {
                    cohort.validate()?;
                }
                if supplied != &attestation.envelope.predict_cohort {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "PREDICT cohort for runtime binding `{}` does not exactly match its envelope attestation",
                        data_binding_requirement_key(&binding.node_id, &binding.input_name)
                    )));
                }
            }
            _ if supplied.is_some() => {
                return Err(DagMlError::RuntimeValidation(format!(
                    "runtime binding `{}` carries a PREDICT cohort during non-PREDICT phase {phase:?}",
                    data_binding_requirement_key(&binding.node_id, &binding.input_name)
                )));
            }
            _ => {}
        }
        Ok(())
    }
}

impl<P: RuntimeDataProvider> RuntimeDataProvider for EnvelopeAttestedRuntimeDataProvider<P> {
    fn materialize(&self, request: &DataMaterializationRequest) -> Result<HandleRef> {
        self.validate_request_binding(&request.node_id, &request.input_name, &request.binding)?;
        self.validate_predict_cohort_request(
            &request.binding,
            request.phase,
            &request.predict_cohort,
        )?;
        self.inner.materialize(request)
    }

    fn make_view(&self, request: &DataViewRequest) -> Result<HandleRef> {
        request.view.validate()?;
        self.validate_request_binding(&request.node_id, &request.input_name, &request.binding)?;
        self.validate_predict_cohort_request(
            &request.binding,
            request.phase,
            &request.predict_cohort,
        )?;
        self.inner.make_view(request)
    }

    fn training_data_identity(
        &self,
        binding: &DataBinding,
    ) -> Result<Option<crate::training::TrainingDataIdentity>> {
        Ok(self.attestation_for_binding(binding)?.identity.clone())
    }

    fn coordinator_relations(&self, binding: &DataBinding) -> Result<Option<SampleRelationSet>> {
        Ok(self
            .attestation_for_binding(binding)?
            .envelope
            .coordinator_relations
            .clone())
    }

    fn predict_cohort(
        &self,
        binding: &DataBinding,
        phase: Phase,
    ) -> Result<Option<crate::data::PredictCohort>> {
        validate_predict_cohort_phase(phase)?;
        Ok(self
            .attestation_for_binding(binding)?
            .envelope
            .predict_cohort
            .clone())
    }

    fn methods_pls_capability(&self) -> Result<()> {
        self.inner.methods_pls_capability()
    }

    fn preflight_methods_pls(&self, request: &MethodsPlsDataRequest) -> Result<()> {
        request.validate()?;
        self.inner.preflight_methods_pls(request)
    }

    fn methods_pls_data(&self, request: &MethodsPlsDataRequest) -> Result<MethodsPlsData> {
        request.validate()?;
        self.inner.methods_pls_data(request)
    }
}

pub trait RuntimeController: Send + Sync {
    fn controller_id(&self) -> &ControllerId;
    fn invoke(&self, task: &NodeTask) -> Result<NodeResult>;

    /// Export a raw, portable artifact payload after REFIT.  The scheduler
    /// immediately transfers this into the durable bundle; implementations
    /// must not rely on the returned handle surviving a process boundary.
    fn export_artifact_payload(&self, _artifact_id: &ArtifactId) -> Result<Option<Vec<u8>>> {
        Ok(None)
    }

    /// Materialize a durable raw artifact payload in this controller's fresh
    /// process-local runtime.  The payload is owned by the bundle; the
    /// returned handle is deliberately ephemeral and is only valid for the
    /// current replay invocation.  Controllers that do not publish raw
    /// portable artifacts keep the default fail-closed implementation.
    fn hydrate_artifact_payload(
        &self,
        _request: &ArtifactMaterializationRequest,
        _payload: &[u8],
    ) -> Result<HandleRef> {
        Err(DagMlError::RuntimeValidation(format!(
            "runtime controller `{}` cannot hydrate a raw portable artifact payload",
            self.controller_id()
        )))
    }

    /// Release an invocation-local handle previously returned by
    /// [`Self::hydrate_artifact_payload`]. Replay calls this exactly once when
    /// execution finishes or aborts; implementations must accept a handle
    /// that the controller already consumed during successful invocation.
    fn release_hydrated_artifact_payload(&self, _handle: &HandleRef) -> Result<()> {
        Err(DagMlError::RuntimeValidation(format!(
            "runtime controller `{}` cannot release a hydrated raw portable artifact payload",
            self.controller_id()
        )))
    }

    /// Provider-aware execution is opt-in.  Existing controllers retain the
    /// opaque-handle path; native Methods controllers can only receive the
    /// narrow provider capability above when the scheduler has one.
    fn invoke_with_data_provider(
        &self,
        task: &NodeTask,
        _data_provider: &dyn RuntimeDataProvider,
    ) -> Result<NodeResult> {
        self.invoke(task)
    }

    /// Create an execution-local tuner session for one scheduler-owned HPO
    /// campaign. The controller stays `Send + Sync` because it is only a
    /// factory; the returned session has no Send/Sync bound and may therefore
    /// own a thread-affine native context and optimizer.  The scheduler keeps
    /// this session on its calling thread and passes only portable proposal and
    /// evaluation values across the controller boundary.
    fn create_tuner_session(
        &self,
        task: &RuntimeHpoCampaignTask,
        _context: &RuntimeHpoExecutionContext,
    ) -> Result<Box<dyn RuntimeTunerSession>> {
        Err(DagMlError::RuntimeValidation(format!(
            "runtime controller `{}` does not implement an execution-local tuner session for HPO campaign `{}`",
            self.controller_id(), task.operation_id
        )))
    }

    fn invoke_aggregation(
        &self,
        task: &AggregationControllerTask,
    ) -> Result<AggregationControllerResult> {
        Err(DagMlError::RuntimeValidation(format!(
            "runtime controller `{}` does not implement aggregation task `{}`",
            self.controller_id(),
            task.task_id
        )))
    }
}

/// Per-campaign tuner state. Deliberately no `Send` or `Sync` supertrait:
/// libn4m's Context and Optimizer are thread-affine.  The session proposes a
/// portable variant; the scheduler evaluates its FIT_CV/OOF evidence and
/// feeds the scalar intermediate/terminal state back here.  This avoids a
/// controller-owned CV loop and prevents native state from entering a `Send`
/// scheduler worker or registry.
pub trait RuntimeTunerSession {
    /// Return the complete native study history length, including restored
    /// completed, failed and pruned trials. Only the local controller can
    /// attest this opaque optimizer state.
    fn trial_history_len(&self) -> Result<u32>;

    fn ask(&mut self) -> Result<Option<RuntimeHpoProposal>>;

    fn report_intermediate(
        &mut self,
        intermediate: RuntimeHpoIntermediate,
    ) -> Result<RuntimeHpoIntermediateOutcome>;

    fn tell(&mut self, trial_id: i64, terminal: RuntimeHpoTerminal) -> Result<()>;

    /// Return the native optimizer incumbent after scheduler terminalization.
    /// Implementations must derive it from their optimizer's native `best()`;
    /// a coordinator ranking is not an acceptable substitute.
    fn incumbent(&self, variants: &BTreeMap<i64, VariantId>)
        -> Result<Option<RuntimeHpoIncumbent>>;

    /// Return the native trial ledger after terminalization.  This is the
    /// sole allowed observation of native status/intermediate/failure state;
    /// scheduler and bundle code must never decode N4MOPT bytes themselves.
    fn terminal_trial_snapshots(
        &self,
        variants: &BTreeMap<i64, VariantId>,
    ) -> Result<Vec<RuntimeHpoTerminalSnapshot>>;

    /// Export the current durable native checkpoint after all scheduler-owned
    /// trial transitions have completed. The scheduler validates its binding
    /// against the explicit HPO context before exposing it to training.
    fn checkpoint(&self) -> Result<crate::hpo::N4moptCheckpointArtifact>;
}
pub(crate) struct CollectedInputs {
    pub(crate) handles: BTreeMap<String, HandleRef>,
    pub(crate) data_views: BTreeMap<String, DataProviderViewSpec>,
    pub(crate) prediction_inputs: BTreeMap<String, PredictionInputSpec>,
    pub(crate) skip_node: bool,
}

pub(crate) fn data_view_key(input_name: &str) -> String {
    format!("data:{input_name}")
}

pub(crate) fn validation_data_view_key(input_name: &str) -> String {
    format!("{input_name}:validation")
}

pub(crate) fn derive_output_data_views(
    plan: &ExecutionPlan,
    task: &NodeTask,
    result: &NodeResult,
) -> Result<BTreeMap<String, DataProviderViewSpec>> {
    let node = plan
        .graph_plan
        .graph
        .nodes
        .iter()
        .find(|node| node.id == task.node_plan.node_id)
        .expect("execution plan was validated");
    let mut views = BTreeMap::new();
    for port in node
        .ports
        .outputs
        .iter()
        .filter(|port| port.kind == PortKind::Data)
    {
        let Some(handle) = result.outputs.get(&port.name) else {
            continue;
        };
        if !matches!(handle.kind, HandleKind::Data | HandleKind::DataView) {
            return Err(DagMlError::RuntimeValidation(format!(
                "node `{}` emitted data output `{}` with non-data/data-view handle kind {:?}",
                task.node_plan.node_id, port.name, handle.kind
            )));
        }
        if let Some(view) = primary_output_data_view(task) {
            views.insert(
                port.name.clone(),
                output_data_view_for_port(task, result, &port.name, view)?,
            );
        }
        if let Some(validation_view) = validation_output_data_view(task) {
            views.insert(
                validation_data_view_key(&port.name),
                output_data_view_for_port(task, result, &port.name, validation_view)?,
            );
        }
    }
    Ok(views)
}

pub(crate) fn output_data_view_for_port(
    task: &NodeTask,
    result: &NodeResult,
    port_name: &str,
    base_view: &DataProviderViewSpec,
) -> Result<DataProviderViewSpec> {
    let mut view = base_view.clone();
    if let Some(upstream_provenance) = view.extra.remove(DATA_OUTPUT_PROVENANCE_KEY) {
        let provenance: DataOutputProvenance =
            serde_json::from_value(upstream_provenance).map_err(|error| {
                DagMlError::RuntimeValidation(format!(
                    "node `{}` cannot propagate data output `{port_name}` because upstream data output provenance is invalid JSON: {error}",
                    task.node_plan.node_id
                ))
            })?;
        provenance.validate().map_err(|error| {
            DagMlError::RuntimeValidation(format!(
                "node `{}` cannot propagate data output `{port_name}` because upstream data output provenance is invalid: {error}",
                task.node_plan.node_id
            ))
        })?;
    }
    let shape_deltas = result
        .shape_deltas
        .iter()
        .filter(|delta| delta.node_id == task.node_plan.node_id)
        .cloned()
        .collect::<Vec<_>>();
    let mut provenance = DataOutputProvenance {
        schema_version: DATA_OUTPUT_PROVENANCE_SCHEMA_VERSION,
        producer_node: task.node_plan.node_id.clone(),
        producer_port: port_name.to_string(),
        producer_phase: task.phase,
        variant_id: task.variant_id.clone(),
        fold_id: task.fold_id.clone(),
        shape_plan_fingerprint: None,
        aggregation_policy_fingerprint: None,
        feature_namespace: None,
        feature_schema_fingerprint: None,
        representation_plan: None,
        representation_replay_manifest: None,
        representation_compatibility: None,
        relation_delta_fingerprint: None,
        shape_deltas,
    };
    if let Some(shape_plan) = &task.node_plan.shape_plan {
        provenance.shape_plan_fingerprint = Some(stable_json_fingerprint(shape_plan)?);
        provenance.aggregation_policy_fingerprint =
            Some(stable_json_fingerprint(&shape_plan.aggregation_policy)?);
        provenance.feature_namespace = shape_plan.feature_namespace.clone();
        provenance.feature_schema_fingerprint =
            output_feature_schema_fingerprint(shape_plan, result);
    }
    provenance.validate()?;

    view.extra.insert(
        DATA_OUTPUT_PROVENANCE_KEY.to_string(),
        serde_json::to_value(provenance)?,
    );
    view.validate()?;
    Ok(view)
}

pub(crate) fn output_feature_schema_fingerprint(
    shape_plan: &crate::policy::DataModelShapePlan,
    result: &NodeResult,
) -> Option<String> {
    result
        .shape_deltas
        .iter()
        .rev()
        .find(|delta| delta.kind == ShapeDeltaKind::Feature)
        .map(|delta| delta.after_fingerprint.clone())
        .or_else(|| shape_plan.feature_schema_fingerprint.clone())
}

pub(crate) fn primary_output_data_view(task: &NodeTask) -> Option<&DataProviderViewSpec> {
    task.data_views
        .values()
        .find(|view| view.partition != DataRequestPartition::FoldValidation)
        .or_else(|| task.data_views.values().next())
}

pub(crate) fn validation_output_data_view(task: &NodeTask) -> Option<&DataProviderViewSpec> {
    task.data_views
        .values()
        .find(|view| view.partition == DataRequestPartition::FoldValidation)
}

/// Scheduler-selected provider inputs for one materialized data view.
pub(crate) struct DataViewHandleInput<'a> {
    pub(crate) data_handle: &'a HandleRef,
    pub(crate) view: &'a DataProviderViewSpec,
    pub(crate) predict_cohort: Option<&'a crate::data::PredictCohort>,
}

pub(crate) fn make_data_view_handle(
    data_provider: &dyn RuntimeDataProvider,
    ctx: &RunContext,
    node_plan: &NodePlan,
    scope: &PhaseScope,
    binding: &DataBinding,
    input: DataViewHandleInput<'_>,
) -> Result<HandleRef> {
    input.view.validate()?;
    let view_handle = data_provider.make_view(&DataViewRequest {
        run_id: ctx.run_id.clone(),
        node_id: node_plan.node_id.clone(),
        input_name: binding.input_name.clone(),
        phase: scope.phase,
        variant_id: scope.variant_id.clone(),
        fold_id: scope.fold_id.clone(),
        binding: binding.clone(),
        data_handle: input.data_handle.clone(),
        view: input.view.clone(),
        predict_cohort: input.predict_cohort.cloned(),
    })?;
    // A data view is delivered to the controller as a data input, so the
    // provider must return a data-bearing handle. Refuse a model / artifact /
    // prediction / relation handle masquerading as a view across the ABI.
    if !matches!(view_handle.kind, HandleKind::Data | HandleKind::DataView) {
        return Err(DagMlError::RuntimeValidation(format!(
            "node `{}` data view `{}` resolved to a non-data/data-view handle kind {:?}",
            node_plan.node_id, binding.input_name, view_handle.kind
        )));
    }
    Ok(view_handle)
}

pub(crate) fn data_view_for_scope(
    binding: &DataBinding,
    fold_set: Option<&FoldSet>,
    scope: &PhaseScope,
    branch_view: Option<&crate::data::BranchViewPlan>,
    excluded_samples: &BTreeSet<SampleId>,
) -> Result<DataProviderViewSpec> {
    let partition = data_partition_for_scope(binding, scope);
    // During FIT_CV and REFIT this primary view IS the training input; during
    // PREDICT/EXPLAIN (and the planning phases) it is a non-fit read.
    let role = match scope.phase {
        Phase::FitCv | Phase::Refit => DataViewRole::Fit,
        _ => DataViewRole::NonFit,
    };
    data_view_for_partition(
        binding,
        fold_set,
        scope,
        partition,
        branch_view,
        role,
        excluded_samples,
    )
}

/// Bind a separately attested PREDICT cohort to a scheduler-created view.
///
/// This replaces, rather than merges with, ordinary partition-derived sample
/// identities. Those identities are CV-derived and must never expand a
/// held-out external-test cohort. The full cohort travels independently on
/// the provider request, where the envelope-attested wrapper verifies it
/// before host data is materialized or viewed.
pub(crate) fn bind_predict_cohort_to_view(
    view: &mut DataProviderViewSpec,
    cohort: &crate::data::PredictCohort,
) -> Result<()> {
    cohort.validate()?;
    if view.partition != DataRequestPartition::Predict || view.fold_id.is_some() {
        return Err(DagMlError::RuntimeValidation(
            "PREDICT cohort may only bind a top-level Predict data view".to_string(),
        ));
    }
    view.sample_ids = Some(cohort.physical_sample_ids.clone());
    view.validate()
}

pub(crate) fn validation_data_view_for_scope(
    binding: &DataBinding,
    fold_set: Option<&FoldSet>,
    scope: &PhaseScope,
    branch_view: Option<&crate::data::BranchViewPlan>,
    excluded_samples: &BTreeSet<SampleId>,
) -> Result<Option<DataProviderViewSpec>> {
    if scope.phase != Phase::FitCv || scope.fold_id.is_none() {
        return Ok(None);
    }
    let partition = binding.view_policy.predict_partition;
    if partition == data_partition_for_scope(binding, scope) {
        return Ok(None);
    }
    // This is the validation companion read, never the training input.
    data_view_for_partition(
        binding,
        fold_set,
        scope,
        partition,
        branch_view,
        DataViewRole::NonFit,
        excluded_samples,
    )
    .map(Some)
}

#[cfg(test)]
mod envelope_attested_provider_tests {
    use std::cell::Cell;

    use super::*;

    #[derive(Debug, Default)]
    struct ProbeProvider {
        materialize_calls: Cell<usize>,
        make_view_calls: Cell<usize>,
    }

    impl RuntimeDataProvider for ProbeProvider {
        fn materialize(&self, _request: &DataMaterializationRequest) -> Result<HandleRef> {
            self.materialize_calls.set(self.materialize_calls.get() + 1);
            Ok(HandleRef {
                handle: 41,
                kind: HandleKind::Data,
                owner_controller: ControllerId::new("controller:data.probe").unwrap(),
            })
        }

        fn make_view(&self, _request: &DataViewRequest) -> Result<HandleRef> {
            self.make_view_calls.set(self.make_view_calls.get() + 1);
            Ok(HandleRef {
                handle: 42,
                kind: HandleKind::DataView,
                owner_controller: ControllerId::new("controller:data.probe").unwrap(),
            })
        }
    }

    fn complete_envelope() -> ExternalDataPlanEnvelope {
        let mut envelope: ExternalDataPlanEnvelope = serde_json::from_str(include_str!(
            "../../tests/fixtures/package/data/coordinator_data_plan_envelope_sample12.json"
        ))
        .unwrap();
        envelope.data_content_fingerprint = Some("a".repeat(64));
        envelope.target_content_fingerprint = Some("b".repeat(64));
        envelope
    }

    fn inference_predict_cohort(envelope: &ExternalDataPlanEnvelope) -> crate::data::PredictCohort {
        let relations = envelope
            .coordinator_relations
            .clone()
            .expect("complete test envelope carries coordinator relations");
        let physical_sample_ids = relations
            .records
            .iter()
            .map(|record| record.sample_id.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let origin_sample_ids = relations
            .records
            .iter()
            .map(|record| {
                record
                    .origin_sample_id
                    .clone()
                    .unwrap_or_else(|| record.sample_id.clone())
            })
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let mut cohort = crate::data::PredictCohort {
            role: crate::data::PredictCohortRole::Inference,
            physical_sample_ids,
            origin_sample_ids,
            target_names: vec!["y".to_string()],
            relation_fingerprint: relations.fingerprint().unwrap(),
            relations,
            data_content_fingerprint: "c".repeat(64),
            target_content_fingerprint: None,
            cohort_fingerprint: String::new(),
        };
        cohort.cohort_fingerprint = cohort.fingerprint().unwrap();
        cohort
    }

    fn binding_for(
        node_id: &str,
        input_name: &str,
        envelope: &ExternalDataPlanEnvelope,
    ) -> DataBinding {
        DataBinding {
            node_id: NodeId::new(node_id).unwrap(),
            input_name: input_name.to_string(),
            request_id: "request:data.probe".to_string(),
            schema_fingerprint: envelope.schema_fingerprint.clone(),
            plan_fingerprint: envelope.plan_fingerprint.clone(),
            relation_fingerprint: envelope.relation_fingerprint.clone(),
            output_representation: "tabular_numeric".to_string(),
            feature_set_id: Some(input_name.to_string()),
            source_ids: vec!["source:probe".to_string()],
            require_relations: true,
            view_policy: Default::default(),
            metadata: BTreeMap::new(),
        }
    }

    fn envelopes_for(
        binding: &DataBinding,
        envelope: ExternalDataPlanEnvelope,
    ) -> BTreeMap<String, ExternalDataPlanEnvelope> {
        BTreeMap::from([(
            data_binding_requirement_key(&binding.node_id, &binding.input_name),
            envelope,
        )])
    }

    fn materialization_request(binding: &DataBinding) -> DataMaterializationRequest {
        DataMaterializationRequest {
            run_id: RunId::new("run:attested.provider").unwrap(),
            node_id: binding.node_id.clone(),
            input_name: binding.input_name.clone(),
            phase: Phase::Refit,
            variant_id: None,
            fold_id: None,
            binding: binding.clone(),
            predict_cohort: None,
        }
    }

    #[test]
    fn envelope_attested_provider_delegates_and_returns_exact_attestations() {
        let envelope = complete_envelope();
        let binding = binding_for("model:base", "x", &envelope);
        let expected_identity =
            crate::training::TrainingDataIdentity::from_binding_envelope(&binding, &envelope)
                .unwrap();
        let expected_relations = envelope.coordinator_relations.clone();
        let provider = EnvelopeAttestedRuntimeDataProvider::new(
            ProbeProvider::default(),
            vec![binding.clone()],
            envelopes_for(&binding, envelope),
        )
        .unwrap();

        assert_eq!(
            provider.training_data_identity(&binding).unwrap(),
            Some(expected_identity)
        );
        assert_eq!(
            provider.coordinator_relations(&binding).unwrap(),
            expected_relations
        );

        let materialization = materialization_request(&binding);
        let data_handle = provider.materialize(&materialization).unwrap();
        assert_eq!(data_handle.handle, 41);
        let view_handle = provider
            .make_view(&DataViewRequest {
                run_id: materialization.run_id,
                node_id: binding.node_id.clone(),
                input_name: binding.input_name.clone(),
                phase: Phase::Refit,
                variant_id: None,
                fold_id: None,
                binding: binding.clone(),
                data_handle,
                view: DataProviderViewSpec {
                    sample_ids: None,
                    partition: DataRequestPartition::FullTrain,
                    fold_id: None,
                    source_ids: None,
                    columns: None,
                    include_augmented: true,
                    include_excluded: false,
                    branch_view: None,
                    extra: BTreeMap::new(),
                },
                predict_cohort: None,
            })
            .unwrap();
        assert_eq!(view_handle.handle, 42);
        assert_eq!(provider.inner().materialize_calls.get(), 1);
        assert_eq!(provider.inner().make_view_calls.get(), 1);

        let inner = provider.into_inner();
        assert_eq!(inner.materialize_calls.get(), 1);
        assert_eq!(inner.make_view_calls.get(), 1);
    }

    #[test]
    fn envelope_attested_provider_refuses_substituted_or_non_predict_cohorts() {
        let mut envelope = complete_envelope();
        envelope.schema_version = crate::data::EXTERNAL_DATA_PLAN_ENVELOPE_SCHEMA_VERSION_V2;
        let expected = inference_predict_cohort(&envelope);
        envelope.predict_cohort = Some(expected.clone());
        envelope.validate().unwrap();
        let binding = binding_for("model:base", "x", &envelope);
        let provider = EnvelopeAttestedRuntimeDataProvider::new(
            ProbeProvider::default(),
            vec![binding.clone()],
            envelopes_for(&binding, envelope),
        )
        .unwrap();

        let mut request = materialization_request(&binding);
        request.phase = Phase::Predict;
        request.predict_cohort = Some(expected.clone());
        provider.materialize(&request).unwrap();
        assert_eq!(provider.inner().materialize_calls.get(), 1);

        let mut substituted = expected.clone();
        substituted.data_content_fingerprint = "d".repeat(64);
        substituted.cohort_fingerprint = substituted.fingerprint().unwrap();
        request.predict_cohort = Some(substituted);
        let error = provider.materialize(&request).unwrap_err().to_string();
        assert!(error.contains("does not exactly match its envelope attestation"));
        assert_eq!(provider.inner().materialize_calls.get(), 1);

        request.phase = Phase::Refit;
        request.predict_cohort = Some(expected);
        let error = provider.materialize(&request).unwrap_err().to_string();
        assert!(error.contains("during non-PREDICT phase"));
        assert_eq!(provider.inner().materialize_calls.get(), 1);
    }

    #[test]
    fn envelope_attested_provider_preserves_target_free_predict_envelopes() {
        let mut envelope = complete_envelope();
        envelope.target_content_fingerprint = None;
        let binding = binding_for("model:base", "x", &envelope);
        let provider = EnvelopeAttestedRuntimeDataProvider::new(
            ProbeProvider::default(),
            vec![binding.clone()],
            envelopes_for(&binding, envelope.clone()),
        )
        .unwrap();

        // An X-only PREDICT cohort deliberately has no training identity. It
        // remains fully envelope-bound for materialization and relation use;
        // FIT_CV/REFIT reject identity absence in their callers.
        assert_eq!(provider.training_data_identity(&binding).unwrap(), None);
        assert_eq!(
            provider.coordinator_relations(&binding).unwrap(),
            envelope.coordinator_relations
        );
        let mut request = materialization_request(&binding);
        request.phase = Phase::Predict;
        assert_eq!(provider.materialize(&request).unwrap().handle, 41);
    }

    #[test]
    fn envelope_attested_provider_requires_exact_envelope_coverage() {
        let envelope = complete_envelope();
        let binding = binding_for("model:base", "x", &envelope);

        let missing = EnvelopeAttestedRuntimeDataProvider::new(
            ProbeProvider::default(),
            vec![binding.clone()],
            BTreeMap::new(),
        )
        .unwrap_err();
        assert!(missing.to_string().contains("exactly cover"));
        assert!(missing.to_string().contains("model:base.x"));

        let mut unexpected = envelopes_for(&binding, envelope.clone());
        unexpected.insert("model:other.x".to_string(), envelope);
        let extra = EnvelopeAttestedRuntimeDataProvider::new(
            ProbeProvider::default(),
            vec![binding],
            unexpected,
        )
        .unwrap_err();
        assert!(extra.to_string().contains("exactly cover"));
        assert!(extra.to_string().contains("model:other.x"));
    }

    #[test]
    fn envelope_attested_provider_rejects_rendered_key_collisions() {
        let envelope = complete_envelope();
        let left = binding_for("a.b", "c", &envelope);
        let right = binding_for("a", "b.c", &envelope);
        assert_eq!(
            data_binding_requirement_key(&left.node_id, &left.input_name),
            data_binding_requirement_key(&right.node_id, &right.input_name)
        );

        let error = EnvelopeAttestedRuntimeDataProvider::new(
            ProbeProvider::default(),
            vec![left.clone(), right],
            envelopes_for(&left, envelope),
        )
        .unwrap_err();
        assert!(error.to_string().contains("distinct coordinates"));
        assert!(error.to_string().contains("a.b.c"));
    }

    #[test]
    fn envelope_attested_provider_refuses_unattested_binding_before_delegation() {
        let envelope = complete_envelope();
        let binding = binding_for("model:base", "x", &envelope);
        let provider = EnvelopeAttestedRuntimeDataProvider::new(
            ProbeProvider::default(),
            vec![binding.clone()],
            envelopes_for(&binding, envelope),
        )
        .unwrap();
        let mut changed = binding;
        changed.request_id = "request:data.changed".to_string();

        let error = provider
            .materialize(&materialization_request(&changed))
            .unwrap_err();
        assert!(error.to_string().contains("does not exactly match"));
        assert_eq!(provider.inner().materialize_calls.get(), 0);
    }

    #[test]
    fn envelope_attested_provider_marks_incomplete_envelope_as_non_training() {
        let mut envelope = complete_envelope();
        envelope.data_content_fingerprint = None;
        let binding = binding_for("model:base", "x", &envelope);
        let provider = EnvelopeAttestedRuntimeDataProvider::new(
            ProbeProvider::default(),
            vec![binding.clone()],
            envelopes_for(&binding, envelope),
        )
        .unwrap();
        assert_eq!(provider.training_data_identity(&binding).unwrap(), None);
    }

    #[test]
    fn methods_pls_request_allows_target_free_predict_but_not_training() {
        let envelope = complete_envelope();
        let binding = binding_for("model:base", "x", &envelope);
        let predict_view = DataProviderViewSpec {
            sample_ids: Some(vec![SampleId::new("sample:1").unwrap()]),
            partition: DataRequestPartition::Predict,
            fold_id: None,
            source_ids: None,
            columns: None,
            include_augmented: false,
            include_excluded: false,
            branch_view: None,
            extra: BTreeMap::new(),
        };
        let request = MethodsPlsDataRequest {
            node_id: binding.node_id.clone(),
            phase: Phase::Predict,
            variant_id: None,
            fold_id: None,
            binding: binding.clone(),
            identity: None,
            fit_view: predict_view.clone(),
            prediction_view: None,
        };
        request.validate().unwrap();

        let mut refit = request;
        refit.phase = Phase::Refit;
        refit.fit_view.partition = DataRequestPartition::FullTrain;
        let error = refit.validate().unwrap_err();
        assert!(error
            .to_string()
            .contains("FIT_CV/REFIT requires a target-bound training data identity"));
    }

    #[test]
    fn methods_pls_predict_provider_binds_x_only_rows_to_the_envelope() {
        let mut envelope = complete_envelope();
        envelope.target_content_fingerprint = None;
        let binding = binding_for("model:base", "x", &envelope);
        let key = data_binding_requirement_key(&binding.node_id, &binding.input_name);
        let input = MethodsPlsPredictInput {
            data_content_profile: METHODS_PLS_PREDICT_CONTENT_PROFILE.to_string(),
            data_content_fingerprint: methods_pls_predict_feature_content_fingerprint(
                &MethodsPlsMatrix {
                    values: vec![1.0, 2.0],
                    rows: 1,
                    cols: 2,
                },
            )
            .unwrap(),
            dataset: MethodsPlsDataset {
                sample_ids: vec![SampleId::new("sample:1").unwrap()],
                x: MethodsPlsMatrix {
                    values: vec![1.0, 2.0],
                    rows: 1,
                    cols: 2,
                },
                y: None,
                target_names: vec!["protein".to_string()],
            },
        };
        let provider = MethodsPlsPredictDataProvider::new(
            ControllerId::new("controller:data.methods.predict").unwrap(),
            vec![binding.clone()],
            envelopes_for(
                &binding,
                complete_envelope_with_target_free_fingerprint(
                    input.data_content_fingerprint.clone(),
                ),
            ),
            BTreeMap::from([(key, input.clone())]),
        )
        .unwrap();
        let request = MethodsPlsDataRequest {
            node_id: binding.node_id.clone(),
            phase: Phase::Predict,
            variant_id: None,
            fold_id: None,
            binding,
            identity: None,
            fit_view: DataProviderViewSpec {
                sample_ids: Some(input.dataset.sample_ids.clone()),
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
        assert_eq!(
            provider.methods_pls_data(&request).unwrap().fit,
            input.dataset
        );

        let mut wrong_fingerprint = input;
        wrong_fingerprint.data_content_fingerprint = "f".repeat(64);
        let error = MethodsPlsPredictDataProvider::new(
            ControllerId::new("controller:data.methods.predict").unwrap(),
            vec![request.binding.clone()],
            envelopes_for(
                &request.binding,
                complete_envelope_with_target_free_fingerprint(
                    methods_pls_predict_feature_content_fingerprint(&wrong_fingerprint.dataset.x)
                        .unwrap(),
                ),
            ),
            BTreeMap::from([(
                data_binding_requirement_key(&request.binding.node_id, &request.binding.input_name),
                wrong_fingerprint,
            )]),
        )
        .unwrap_err();
        assert!(error.to_string().contains("feature content fingerprint"));
    }

    #[test]
    fn methods_pls_predict_content_profile_matches_the_python_reference_vector() {
        let fingerprint = methods_pls_predict_feature_content_fingerprint(&MethodsPlsMatrix {
            values: vec![1.0, 2.0, 3.0, 4.0],
            rows: 2,
            cols: 2,
        })
        .unwrap();
        assert_eq!(METHODS_PLS_PREDICT_CONTENT_PROFILE, "n4a-matrix-f64-le.v1");
        assert_eq!(
            fingerprint,
            "ca93722602866b81462d63044d1857ea9acb31ee9532e1a891dcb69a2fd41981"
        );
    }

    fn complete_envelope_with_target_free_fingerprint(
        data_content_fingerprint: String,
    ) -> ExternalDataPlanEnvelope {
        let mut envelope = complete_envelope();
        envelope.data_content_fingerprint = Some(data_content_fingerprint);
        envelope.target_content_fingerprint = None;
        envelope
    }
}

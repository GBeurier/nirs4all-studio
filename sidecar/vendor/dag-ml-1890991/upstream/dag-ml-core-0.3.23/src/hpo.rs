//! Native Methods HPO controller.
//!
//! This is deliberately a controller-owned bridge: a study owns exactly one
//! official `n4m::Optimizer`, never accepts a caller supplied optimizer, and
//! does not implement any sampling or pruning algorithm itself.  DAG-ML keeps
//! fold/influence/lineage/score/selection/refit coordination at the evaluator
//! boundary; `libn4m` owns only the optimizer state machine.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::campaign::stable_json_fingerprint;
use crate::canonical::parse_typed_json;
use crate::fold::FoldSet;
use crate::metrics::ScoreSet;
use crate::plan::CampaignSpec;
use crate::runtime::InMemoryLineageRecorder;
use crate::selection::{RefitStrategy, SelectionPolicy};
use crate::training::{TrainingInfluenceKind, TrainingInfluenceManifest};

pub const HPO_MANIFEST_SCHEMA_VERSION: u32 = 1;
pub const N4MOPT_CHECKPOINT_SCHEMA_VERSION: u32 = 1;
pub const N4MOPT_ARTIFACT_KIND: &str = "n4m_optimizer_checkpoint";
pub const N4MOPT_FORMAT: &str = "N4MOPT";
pub const METHODS_ABI_MAJOR: u32 = 2;
pub const METHODS_RUNTIME_ABI_MINOR: u32 = 4;
pub const METHODS_PLS_N4MM_MIN_ABI_MINOR: u32 = 0;
pub const METHODS_N4MOPT_MIN_ABI_MINOR: u32 = 2;
pub const METHODS_IMPORTED_LINEAR_N4MM_MIN_ABI_MINOR: u32 = 3;

const fn methods_abi_major_default() -> u32 {
    METHODS_ABI_MAJOR
}

const fn methods_n4mopt_min_abi_minor_default() -> u32 {
    METHODS_N4MOPT_MIN_ABI_MINOR
}
/// This mirrors the bound enforced by the official Rust binding and native
/// decoder. Check it before any checkpoint is passed to a native loader.
pub const MAX_N4MOPT_CHECKPOINT_BYTES: usize = 64 * 1024 * 1024;

/// Resolve the minimum Methods ABI encoded by an N4MM reference.
///
/// Historical PLS references predate the explicit ABI fields and are known to
/// require only ABI 2.0. Imported-linear/Ridge first appeared in ABI 2.3, so
/// an unversioned Ridge reference is ambiguous and is refused fail-closed.
pub fn methods_n4mm_abi_requirement(
    artifact: &crate::runtime::ArtifactRef,
) -> crate::Result<(u32, u32)> {
    if artifact.kind != "n4m_model"
        || artifact.backend != Some(crate::runtime::ArtifactBackend::Raw)
    {
        return Err(crate::DagMlError::RuntimeValidation(format!(
            "native Methods artifact `{}` must be a raw n4m_model",
            artifact.id
        )));
    }
    let expected_minor = match artifact.controller_id.as_str() {
        METHODS_PLS_CONTROLLER_ID => Some(METHODS_PLS_N4MM_MIN_ABI_MINOR),
        METHODS_RIDGE_CONTROLLER_ID => Some(METHODS_IMPORTED_LINEAR_N4MM_MIN_ABI_MINOR),
        _ => None,
    };
    match (artifact.abi_major, artifact.abi_min_minor, expected_minor) {
        (Some(METHODS_ABI_MAJOR), Some(minor), Some(expected)) if minor == expected => {
            Ok((METHODS_ABI_MAJOR, minor))
        }
        (Some(METHODS_ABI_MAJOR), Some(minor), None) => Ok((METHODS_ABI_MAJOR, minor)),
        (None, None, Some(METHODS_PLS_N4MM_MIN_ABI_MINOR)) => {
            Ok((METHODS_ABI_MAJOR, METHODS_PLS_N4MM_MIN_ABI_MINOR))
        }
        (None, None, _) => Err(crate::DagMlError::RuntimeValidation(format!(
            "native Methods artifact `{}` requires an explicit ABI minimum for controller `{}`",
            artifact.id, artifact.controller_id
        ))),
        (major, minor, expected) => Err(crate::DagMlError::RuntimeValidation(format!(
            "native Methods artifact `{}` declares ABI {:?}.{:?}; controller `{}` requires exactly {}.{}",
            artifact.id,
            major,
            minor,
            artifact.controller_id,
            METHODS_ABI_MAJOR,
            expected.unwrap_or_default()
        ))),
    }
}

pub fn validate_methods_abi_compatibility(
    runtime_major: u32,
    runtime_minor: u32,
    required_major: u32,
    required_min_minor: u32,
) -> crate::Result<()> {
    if runtime_major != required_major || runtime_minor < required_min_minor {
        return Err(crate::DagMlError::RuntimeValidation(format!(
            "Methods runtime ABI {runtime_major}.{runtime_minor} cannot consume payload requiring {required_major}.{required_min_minor}+"
        )));
    }
    Ok(())
}

/// Resume package bytes are transport input for a scheduler campaign, not a
/// semantic predictor/campaign coordinate.  Exclude only that opaque field
/// from HPO provenance so a package can resume the exact same campaign while
/// every graph, fold, controller, study and search-space binding remains
/// attested independently.
pub(crate) fn campaign_provenance_fingerprint(campaign: &CampaignSpec) -> crate::Result<String> {
    let mut canonical = campaign.clone();
    if let Some(serde_json::Value::Object(operation)) =
        canonical.metadata.get_mut("methods_hpo_operation")
    {
        operation.remove("resume_package_json");
        // The requested total is a scheduler budget. It may legitimately grow
        // on resume and is not part of the immutable campaign provenance.
        operation.remove("trials");
    }
    stable_json_fingerprint(&canonical)
}

pub type HpoResult<T> = std::result::Result<T, HpoError>;

/// Native error data is retained verbatim enough for policy/retry decisions;
/// never flatten it into an opaque display string.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HpoNativeError {
    pub status: i32,
    pub kind: String,
    pub message: String,
    pub retryable: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum HpoError {
    MethodsOptimizerFeatureDisabled,
    RuntimeConfiguration {
        reason: String,
    },
    InvalidManifest {
        reason: String,
    },
    InvalidSearchSpace {
        reason: String,
    },
    InvalidTrial {
        reason: String,
    },
    InvalidCheckpoint {
        reason: String,
    },
    CheckpointBindingMismatch {
        reason: String,
    },
    Native {
        operation: String,
        error: HpoNativeError,
    },
    PartialBatch {
        committed: Vec<HpoTrial>,
        error: HpoNativeError,
    },
    Evaluation {
        reason: String,
    },
}

impl std::fmt::Display for HpoError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MethodsOptimizerFeatureDisabled => f.write_str(
                "Methods optimizer support is disabled; enable the published `methods-optimizer` feature",
            ),
            Self::RuntimeConfiguration { reason } => {
                write!(f, "invalid Methods runtime configuration: {reason}")
            }
            Self::InvalidManifest { reason } => write!(f, "invalid HPO manifest: {reason}"),
            Self::InvalidSearchSpace { reason } => write!(f, "invalid HPO search space: {reason}"),
            Self::InvalidTrial { reason } => write!(f, "invalid native HPO trial: {reason}"),
            Self::InvalidCheckpoint { reason } => write!(f, "invalid N4MOPT checkpoint: {reason}"),
            Self::CheckpointBindingMismatch { reason } => write!(f, "checkpoint binding mismatch: {reason}"),
            Self::Native { operation, error } => write!(f, "n4m {operation} failed ({}/{}): {}", error.kind, error.status, error.message),
            Self::PartialBatch { committed, error } => write!(f, "n4m ask_batch committed {} trial(s), then failed ({}/{}): {}", committed.len(), error.kind, error.status, error.message),
            Self::Evaluation { reason } => write!(f, "HPO evaluation failed: {reason}"),
        }
    }
}
impl std::error::Error for HpoError {}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HpoStudyBinding {
    pub controller_id: String,
    pub study_id: String,
    pub search_space_fingerprint: String,
    pub optimizer_fingerprint: String,
}

impl HpoStudyBinding {
    pub fn validate(&self) -> HpoResult<()> {
        for (field, value) in [
            ("controller_id", &self.controller_id),
            ("study_id", &self.study_id),
            ("search_space_fingerprint", &self.search_space_fingerprint),
            ("optimizer_fingerprint", &self.optimizer_fingerprint),
        ] {
            if value.trim().is_empty() {
                return Err(HpoError::InvalidManifest {
                    reason: format!("{field} must not be empty"),
                });
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MethodsHpoControllerManifest {
    pub schema_version: u32,
    pub binding: HpoStudyBinding,
}

impl MethodsHpoControllerManifest {
    pub fn validate(&self) -> HpoResult<()> {
        if self.schema_version != HPO_MANIFEST_SCHEMA_VERSION {
            return Err(HpoError::InvalidManifest {
                reason: format!(
                    "unsupported schema_version {}; expected {HPO_MANIFEST_SCHEMA_VERSION}",
                    self.schema_version
                ),
            });
        }
        self.binding.validate()
    }
}

/// Ordered declaration is intentional: it is part of replay identity and is
/// retained in every trial, unlike a map's lexical order.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum HpoParameter {
    Int {
        name: String,
        low: i64,
        high: i64,
        step: i64,
        log: bool,
    },
    Float {
        name: String,
        low: f64,
        high: f64,
        step: f64,
        log: bool,
    },
    Categorical {
        name: String,
        values: Vec<HpoCategory>,
    },
    Ordinal {
        name: String,
        values: Vec<f64>,
    },
    SortedTuple {
        name: String,
        length: i32,
        low: f64,
        high: f64,
        integer: bool,
    },
}

impl HpoParameter {
    fn name(&self) -> &str {
        match self {
            Self::Int { name, .. }
            | Self::Float { name, .. }
            | Self::Categorical { name, .. }
            | Self::Ordinal { name, .. }
            | Self::SortedTuple { name, .. } => name,
        }
    }
    fn output_names(&self) -> Vec<String> {
        match self {
            Self::SortedTuple { name, length, .. } => (0..*length)
                .map(|index| format!("{name}#{index}"))
                .collect(),
            _ => vec![self.name().to_string()],
        }
    }
    fn validate(&self) -> HpoResult<()> {
        if self.name().trim().is_empty() {
            return Err(HpoError::InvalidSearchSpace {
                reason: "parameter name must not be empty".to_string(),
            });
        }
        match self {
            Self::Int {
                low, high, step, ..
            } if low > high || *step <= 0 => Err(HpoError::InvalidSearchSpace {
                reason: format!(
                    "integer parameter `{}` has invalid bounds or step",
                    self.name()
                ),
            }),
            Self::Float {
                low, high, step, ..
            } if !low.is_finite()
                || !high.is_finite()
                || !step.is_finite()
                || low > high
                || *step < 0.0 =>
            {
                Err(HpoError::InvalidSearchSpace {
                    reason: format!(
                        "float parameter `{}` has invalid bounds or step",
                        self.name()
                    ),
                })
            }
            Self::Categorical { values, .. } if values.is_empty() => {
                Err(HpoError::InvalidSearchSpace {
                    reason: format!("categorical parameter `{}` has no values", self.name()),
                })
            }
            Self::Ordinal { values, .. }
                if values.is_empty() || values.iter().any(|value| !value.is_finite()) =>
            {
                Err(HpoError::InvalidSearchSpace {
                    reason: format!("ordinal parameter `{}` is invalid", self.name()),
                })
            }
            Self::SortedTuple {
                length, low, high, ..
            } if *length <= 0 || !low.is_finite() || !high.is_finite() || low > high => {
                Err(HpoError::InvalidSearchSpace {
                    reason: format!("sorted tuple parameter `{}` is invalid", self.name()),
                })
            }
            _ => Ok(()),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", untagged)]
pub enum HpoCategory {
    String(String),
    Integer(i64),
    Float(f64),
    Boolean(bool),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HpoSearchSpace {
    pub parameters: Vec<HpoParameter>,
}

impl HpoSearchSpace {
    pub fn validate(&self) -> HpoResult<()> {
        if self.parameters.is_empty() {
            return Err(HpoError::InvalidSearchSpace {
                reason: "search space has no parameters".to_string(),
            });
        }
        let mut names = BTreeSet::new();
        for parameter in &self.parameters {
            parameter.validate()?;
            for name in parameter.output_names() {
                if !names.insert(name.clone()) {
                    return Err(HpoError::InvalidSearchSpace {
                        reason: format!("duplicate emitted parameter `{name}`"),
                    });
                }
            }
        }
        Ok(())
    }
    /// TCV1 makes this digest independent of JSON object ordering while
    /// preserving the declared parameter array order.
    pub fn fingerprint(&self) -> HpoResult<String> {
        self.validate()?;
        let json = serde_json::to_string(self).map_err(|error| HpoError::InvalidSearchSpace {
            reason: error.to_string(),
        })?;
        parse_typed_json(&json)
            .and_then(|value| value.fingerprint())
            .map_err(|error| HpoError::InvalidSearchSpace {
                reason: format!("cannot canonically fingerprint search space: {error}"),
            })
    }
}

/// Configuration that creates one official native optimizer. The production
/// binding is dynamically loaded from an explicit caller-supplied library
/// path; it never links to a sibling checkout at build time.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MethodsHpoStudyConfig {
    pub controller_id: String,
    pub study_id: String,
    /// Runtime identity obtained from the ABI-matched Methods deployment.
    /// The current n4m binding validates compatibility during Context creation
    /// but does not expose the negotiated identity as a public accessor.
    pub methods_abi: String,
    pub search_space: HpoSearchSpace,
    pub optimizer: HpoOptimizerConfig,
}

impl MethodsHpoStudyConfig {
    #[cfg(feature = "methods-optimizer")]
    fn methods_abi_identity(&self) -> HpoResult<String> {
        if self.methods_abi.trim().is_empty() {
            return Err(HpoError::InvalidManifest {
                reason: "Methods ABI identity must be supplied by the native controller"
                    .to_string(),
            });
        }
        Ok(self.methods_abi.clone())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HpoOptimizerConfig {
    pub sampler: HpoSampler,
    pub pruner: HpoPruner,
    pub direction: HpoDirection,
    pub metric: HpoMetric,
    pub seed: u64,
    pub n_startup_trials: i32,
    pub max_resource: i32,
    pub reduction_factor: i32,
}

impl HpoOptimizerConfig {
    #[cfg(feature = "methods-optimizer")]
    fn fingerprint(&self) -> HpoResult<String> {
        let json = serde_json::to_string(self).map_err(|error| HpoError::InvalidManifest {
            reason: error.to_string(),
        })?;
        parse_typed_json(&json)
            .and_then(|value| value.fingerprint())
            .map_err(|error| HpoError::InvalidManifest {
                reason: format!("cannot canonically fingerprint optimizer configuration: {error}"),
            })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HpoSampler {
    Random,
    Sobol,
    Lhs,
    Ternary,
    Ga,
    Pso,
    Cmaes,
    Tpe,
    GpEi,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HpoPruner {
    None,
    Median,
    Asha,
    Hyperband,
    Racing,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HpoDirection {
    Auto,
    Minimize,
    Maximize,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HpoMetric {
    Rmse,
    Mse,
    Mae,
    R2,
    Accuracy,
    BalancedAccuracy,
    F1,
    Logloss,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HpoTrialParameter {
    pub name: String,
    pub value: f64,
    /// Retains the native type so parameter projection cannot turn an
    /// integer/category into a floating-point patch.
    #[serde(default)]
    pub native_kind: Option<HpoNativeParameterKind>,
    #[serde(default)]
    pub category_type: Option<HpoCategoryType>,
    #[serde(default)]
    pub integer: bool,
    pub active: bool,
    pub category_index: Option<i32>,
    pub category_label: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HpoNativeParameterKind {
    Int,
    Float,
    LogInt,
    LogFloat,
    Categorical,
    Ordinal,
    SortedTuple,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HpoCategoryType {
    String,
    Integer,
    Float,
    Boolean,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HpoTrialStatus {
    Running,
    Completed,
    Pruned,
    Failed,
    Cancelled,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HpoFailure {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HpoIntermediate {
    pub sequence: i64,
    pub step: i32,
    pub score: f64,
    pub should_prune: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HpoTrial {
    pub id: i64,
    pub ask_sequence: i64,
    pub terminal_sequence: Option<i64>,
    pub parameters: BTreeMap<String, HpoTrialParameter>,
    pub parameter_order: Vec<String>,
    pub status: HpoTrialStatus,
    pub score: Option<f64>,
    pub rung: i32,
    pub duration: f64,
    pub intermediates: Vec<HpoIntermediate>,
    pub failure: Option<HpoFailure>,
}

/// Normalize both sides of a native-ledger comparison through the same strict
/// JSON/TCV1 preimage.  The opaque N4MOPT checkpoint is an independent native
/// serializer; it can restore a binary64 score one ULP away from the Rust JSON
/// spelling without changing any optimizer decision.  Everything except a
/// score remains byte-for-byte structural evidence; score comparisons are
/// deliberately limited to one ULP below.
#[cfg(any(test, feature = "methods-optimizer"))]
fn canonical_hpo_terminal_ledger(trials: Vec<HpoTrial>) -> crate::Result<Vec<HpoTrial>> {
    let json = serde_json::to_string(&trials)?;
    parse_typed_json(&json).map_err(|error| {
        crate::DagMlError::RuntimeValidation(format!(
            "native Methods HPO terminal ledger has no strict TCV1 JSON preimage: {error}"
        ))
    })?;
    Ok(serde_json::from_str(&json)?)
}

#[cfg(any(test, feature = "methods-optimizer"))]
fn scores_within_one_ulp(left: f64, right: f64) -> bool {
    if left == right {
        return true;
    }
    if !left.is_finite() || !right.is_finite() {
        return false;
    }
    let ordered = |value: f64| {
        let bits = value.to_bits();
        if bits & (1_u64 << 63) != 0 {
            (!bits) as i128
        } else {
            (bits | (1_u64 << 63)) as i128
        }
    };
    (ordered(left) - ordered(right)).abs() <= 1
}

#[cfg(any(test, feature = "methods-optimizer"))]
fn optional_scores_within_one_ulp(left: Option<f64>, right: Option<f64>) -> bool {
    match (left, right) {
        (Some(left), Some(right)) => scores_within_one_ulp(left, right),
        (None, None) => true,
        _ => false,
    }
}

#[cfg(any(test, feature = "methods-optimizer"))]
fn hpo_terminal_trials_match(native: &[HpoTrial], persisted: &[HpoTrial]) -> bool {
    native.len() == persisted.len()
        && native.iter().zip(persisted).all(|(native, persisted)| {
            native.id == persisted.id
                && native.ask_sequence == persisted.ask_sequence
                && native.terminal_sequence == persisted.terminal_sequence
                && native.parameters == persisted.parameters
                && native.parameter_order == persisted.parameter_order
                && native.status == persisted.status
                && optional_scores_within_one_ulp(native.score, persisted.score)
                && native.rung == persisted.rung
                && native.duration == persisted.duration
                && native.failure == persisted.failure
                && native.intermediates.len() == persisted.intermediates.len()
                && native
                    .intermediates
                    .iter()
                    .zip(&persisted.intermediates)
                    .all(|(native, persisted)| {
                        native.sequence == persisted.sequence
                            && native.step == persisted.step
                            && native.should_prune == persisted.should_prune
                            && scores_within_one_ulp(native.score, persisted.score)
                    })
        })
}

/// The native optimizer's incumbent, retaining the score returned by its
/// `best` call rather than re-deriving it from a lossy projection.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HpoBestTrial {
    pub trial: HpoTrial,
    pub score: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "snake_case", deny_unknown_fields)]
pub enum HpoEvent {
    Asked {
        trial_id: i64,
    },
    Intermediate {
        trial_id: i64,
        step: i32,
        score: f64,
        should_prune: bool,
    },
    Terminal {
        trial_id: i64,
        status: HpoTrialStatus,
        score: Option<f64>,
        failure: Option<HpoFailure>,
    },
}

/// Explicit evaluator boundary. It exposes DAG-ML's real ownership primitives,
/// not marker enums; the optimizer cannot manufacture folds, scores, lineage,
/// a selection decision, or a refit. Native finetuning remains selection-only.
pub struct HpoEvaluationBoundary<'a> {
    pub folds: &'a FoldSet,
    pub influence: &'a TrainingInfluenceManifest,
    pub lineage: &'a mut InMemoryLineageRecorder,
    pub scores: &'a mut ScoreSet,
    pub selection: &'a SelectionPolicy,
    pub refit_strategy: Option<RefitStrategy>,
}

impl HpoEvaluationBoundary<'_> {
    pub fn validate(&self) -> HpoResult<()> {
        self.folds
            .validate()
            .map_err(|error| HpoError::Evaluation {
                reason: error.to_string(),
            })?;
        self.scores
            .validate()
            .map_err(|error| HpoError::Evaluation {
                reason: error.to_string(),
            })?;
        self.selection
            .validate()
            .map_err(|error| HpoError::Evaluation {
                reason: error.to_string(),
            })?;
        self.influence
            .validate()
            .map_err(|error| HpoError::Evaluation {
                reason: error.to_string(),
            })?;
        if !self
            .influence
            .entries
            .iter()
            .any(|entry| entry.kind == TrainingInfluenceKind::HpoSelection)
        {
            return Err(HpoError::Evaluation {
                reason: "training influence manifest has no hpo_selection entry".to_string(),
            });
        }
        Ok(())
    }
}

pub trait HpoEvaluator {
    fn evaluate(
        &mut self,
        trial: &HpoTrial,
        boundary: &mut HpoEvaluationBoundary<'_>,
    ) -> HpoResult<HpoTerminal>;

    /// Override when evaluation has epochs/resources to report. The default
    /// preserves simple evaluators while allowing native pruning to be decided
    /// by Methods during the trial rather than after a leaked final score.
    fn evaluate_with_reporter(
        &mut self,
        trial: &HpoTrial,
        boundary: &mut HpoEvaluationBoundary<'_>,
        _reporter: &mut dyn HpoIntermediateReporter,
    ) -> HpoResult<HpoTerminal> {
        self.evaluate(trial, boundary)
    }
}

pub trait HpoIntermediateReporter {
    fn report(&mut self, step: i32, score: f64) -> HpoResult<HpoReportOutcome>;
}

#[derive(Clone, Debug, PartialEq)]
pub enum HpoReportOutcome {
    Continue,
    Pruned(HpoTrial),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum HpoTerminal {
    Completed { score: f64 },
    Failed { failure: HpoFailure },
    Pruned { failure: HpoFailure },
    Cancelled { failure: HpoFailure },
}

#[derive(Clone, Debug, PartialEq)]
pub struct HpoBatch {
    pub trials: Vec<HpoTrial>,
    pub native_error: Option<HpoNativeError>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct N4moptCheckpointArtifact {
    pub schema_version: u32,
    pub artifact_kind: String,
    pub format: String,
    #[serde(default = "methods_abi_major_default")]
    pub abi_major: u32,
    #[serde(default = "methods_n4mopt_min_abi_minor_default")]
    pub abi_min_minor: u32,
    pub binding: HpoStudyBinding,
    pub methods_abi: String,
    pub opaque_payload: Vec<u8>,
    pub payload_sha256: String,
}

impl N4moptCheckpointArtifact {
    #[cfg(feature = "methods-optimizer")]
    fn new(
        binding: HpoStudyBinding,
        methods_abi: String,
        opaque_payload: Vec<u8>,
    ) -> HpoResult<Self> {
        let value = Self {
            schema_version: N4MOPT_CHECKPOINT_SCHEMA_VERSION,
            artifact_kind: N4MOPT_ARTIFACT_KIND.to_string(),
            format: N4MOPT_FORMAT.to_string(),
            abi_major: METHODS_ABI_MAJOR,
            abi_min_minor: METHODS_N4MOPT_MIN_ABI_MINOR,
            binding,
            methods_abi,
            payload_sha256: payload_sha256(&opaque_payload),
            opaque_payload,
        };
        value.validate()?;
        Ok(value)
    }
    pub fn validate(&self) -> HpoResult<()> {
        if self.schema_version != N4MOPT_CHECKPOINT_SCHEMA_VERSION
            || self.artifact_kind != N4MOPT_ARTIFACT_KIND
            || self.format != N4MOPT_FORMAT
            || self.abi_major != METHODS_ABI_MAJOR
            || self.abi_min_minor != METHODS_N4MOPT_MIN_ABI_MINOR
        {
            return Err(HpoError::InvalidCheckpoint {
                reason: "checkpoint schema, kind, or format is invalid".to_string(),
            });
        }
        self.binding.validate()?;
        if self.methods_abi.trim().is_empty()
            || self.opaque_payload.is_empty()
            || self.opaque_payload.len() > MAX_N4MOPT_CHECKPOINT_BYTES
        {
            return Err(HpoError::InvalidCheckpoint {
                reason: "checkpoint ABI/payload is invalid or exceeds the maximum size".to_string(),
            });
        }
        if self.payload_sha256 != payload_sha256(&self.opaque_payload) {
            return Err(HpoError::InvalidCheckpoint {
                reason: "checkpoint payload SHA-256 differs from envelope".to_string(),
            });
        }
        Ok(())
    }
}

/// Durable archive-member reference for a Methods-owned N4MOPT payload.
///
/// The inline envelope is for a live study only. Training bundles persist this
/// reference so native checkpoint bytes are a raw archive member rather than
/// JSON-inline-only data owned by DAG-ML.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct N4moptCheckpointReference {
    pub artifact: crate::runtime::ArtifactRef,
    pub binding: HpoStudyBinding,
    pub methods_abi: String,
    #[serde(default = "methods_abi_major_default")]
    pub abi_major: u32,
    #[serde(default = "methods_n4mopt_min_abi_minor_default")]
    pub abi_min_minor: u32,
}

impl N4moptCheckpointReference {
    pub fn validate(&self) -> HpoResult<()> {
        self.binding.validate()?;
        if self.methods_abi.trim().is_empty() {
            return Err(HpoError::InvalidCheckpoint {
                reason: "checkpoint reference has no Methods ABI identity".to_string(),
            });
        }
        if self.abi_major != METHODS_ABI_MAJOR
            || self.abi_min_minor != METHODS_N4MOPT_MIN_ABI_MINOR
            || self.artifact.abi_major != Some(self.abi_major)
            || self.artifact.abi_min_minor != Some(self.abi_min_minor)
        {
            return Err(HpoError::InvalidCheckpoint {
                reason: format!(
                    "checkpoint reference must declare Methods ABI {}.{}+ on both envelope and artifact",
                    METHODS_ABI_MAJOR, METHODS_N4MOPT_MIN_ABI_MINOR
                ),
            });
        }
        self.artifact
            .validate_portable()
            .map_err(|error| HpoError::InvalidCheckpoint {
                reason: format!("checkpoint archive reference is invalid: {error}"),
            })?;
        if self.artifact.kind != N4MOPT_ARTIFACT_KIND
            || self.artifact.controller_id.as_str() != self.binding.controller_id
            || self.artifact.backend != Some(crate::runtime::ArtifactBackend::Raw)
        {
            return Err(HpoError::InvalidCheckpoint {
                reason: "checkpoint reference must be a raw Methods-owned N4MOPT artifact"
                    .to_string(),
            });
        }
        Ok(())
    }
}

fn payload_sha256(payload: &[u8]) -> String {
    format!("{:x}", Sha256::digest(payload))
}

/// A default-build preflight that fails before allocation, host data work, or
/// any attempted replacement optimizer.
pub fn methods_optimizer_preflight() -> HpoResult<()> {
    #[cfg(feature = "methods-optimizer")]
    {
        Ok(())
    }
    #[cfg(not(feature = "methods-optimizer"))]
    {
        Err(HpoError::MethodsOptimizerFeatureDisabled)
    }
}

/// Stable controller identity for the only portable numerical model admitted
/// to the first Methods HPO route.  Other model classes stay host/plugin-owned
/// and are rejected during HPO preflight rather than being silently evaluated
/// by a fixture or a replacement implementation.
pub const METHODS_PLS_CONTROLLER_ID: &str = crate::runtime::NATIVE_PREDICTOR_METHODS_PLS_OWNER;

/// Stable controller identity for the native, prediction-input-only Ridge
/// meta-model used by the R2 nested-stacking route.  This is deliberately
/// separate from [`METHODS_PLS_CONTROLLER_ID`]: Methods HPO V1 remains PLS
/// only, while Ridge consumes scheduler-attested OOF prediction inputs rather
/// than an arbitrary raw feature matrix.
pub const METHODS_RIDGE_CONTROLLER_ID: &str = crate::runtime::NATIVE_PREDICTOR_METHODS_RIDGE_OWNER;

#[cfg(feature = "methods-optimizer")]
/// Inspect complete N4MM bytes and derive their product-safe descriptor V1.
///
/// This is the public attestation route for new publications and historical
/// Archive V2 members that predate an embedded descriptor. The result comes
/// only from Methods' native `n4m_serialization_inspect_model_v1` contract;
/// callers cannot supply JSON metadata or capability claims. Controller,
/// storage algorithm, required capabilities and controller-specific
/// dimensions are checked before a descriptor is returned.
pub fn inspect_methods_native_predictor_descriptor_v1(
    owner_controller: &crate::ControllerId,
    payload: &[u8],
) -> crate::Result<crate::runtime::NativePredictorDescriptorV1> {
    use crate::runtime::{
        NativePredictorDescriptorV1, NativePredictorDimensionsV1, NativePredictorWriterAbiV1,
        NATIVE_PREDICTOR_DESCRIPTOR_SCHEMA_VERSION_V1, NATIVE_PREDICTOR_DESCRIPTOR_TYPE_V1,
        NATIVE_PREDICTOR_FORMAT_N4MM,
    };

    let info = n4m::inspect_n4mm(payload).map_err(|error| {
        crate::DagMlError::RuntimeValidation(format!(
            "native Methods predictor inspection failed: {error}"
        ))
    })?;
    let mut descriptor = NativePredictorDescriptorV1 {
        descriptor_type: NATIVE_PREDICTOR_DESCRIPTOR_TYPE_V1.to_string(),
        schema_version: NATIVE_PREDICTOR_DESCRIPTOR_SCHEMA_VERSION_V1,
        artifact_sha256: format!("{:x}", Sha256::digest(payload)),
        owner_controller: owner_controller.clone(),
        format: NATIVE_PREDICTOR_FORMAT_N4MM.to_string(),
        format_version: info.format_version,
        writer_abi: NativePredictorWriterAbiV1 {
            major: info.writer_abi.0,
            minor: info.writer_abi.1,
            patch: info.writer_abi.2,
        },
        storage_algorithm: info.algorithm,
        capabilities: info.capabilities,
        dimensions: NativePredictorDimensionsV1 {
            training_samples: info.training_samples,
            n_features: info.n_features,
            n_targets: info.n_targets,
            n_components: info.n_components,
        },
        descriptor_fingerprint: String::new(),
    };
    descriptor.descriptor_fingerprint = descriptor.compute_fingerprint()?;
    descriptor.validate()?;
    Ok(descriptor)
}

/// Process-scoped binding to the exact Methods shared library used by native
/// controllers. The official `n4m` binding refuses a second, different
/// library, so a caller must configure this before constructing any Methods
/// controller. Relative paths, PATH lookup, and a sibling/worktree fallback
/// are deliberately not supported.
#[cfg(feature = "methods-optimizer")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MethodsRuntime {
    library_path: std::path::PathBuf,
    abi_major: u32,
    abi_minor: u32,
}

#[cfg(feature = "methods-optimizer")]
impl MethodsRuntime {
    pub fn configure(library_path: impl AsRef<std::path::Path>) -> HpoResult<Self> {
        let library_path = library_path.as_ref();
        if !library_path.is_absolute() {
            return Err(HpoError::RuntimeConfiguration {
                reason: "libn4m path must be absolute".to_string(),
            });
        }
        let canonical = std::fs::canonicalize(library_path).map_err(|error| {
            HpoError::RuntimeConfiguration {
                reason: format!(
                    "cannot resolve libn4m path `{}`: {error}",
                    library_path.display()
                ),
            }
        })?;
        let metadata =
            std::fs::metadata(&canonical).map_err(|error| HpoError::RuntimeConfiguration {
                reason: format!(
                    "cannot inspect libn4m path `{}`: {error}",
                    canonical.display()
                ),
            })?;
        if !metadata.is_file() {
            return Err(HpoError::RuntimeConfiguration {
                reason: format!(
                    "libn4m path `{}` is not a regular file",
                    canonical.display()
                ),
            });
        }
        n4m::configure_library(&canonical).map_err(|error| HpoError::RuntimeConfiguration {
            reason: format!("cannot load libn4m `{}`: {error}", canonical.display()),
        })?;
        // The binding performs the authoritative dynamic-library negotiation.
        // Its published interface is ABI 2.4, which is the capability DAG-ML
        // may safely claim after this preflight succeeds.
        n4m::Context::new().map_err(|error| HpoError::RuntimeConfiguration {
            reason: format!(
                "libn4m `{}` does not satisfy Methods ABI {}.{}: {error}",
                canonical.display(),
                METHODS_ABI_MAJOR,
                METHODS_RUNTIME_ABI_MINOR
            ),
        })?;
        Ok(Self {
            library_path: canonical,
            abi_major: METHODS_ABI_MAJOR,
            abi_minor: METHODS_RUNTIME_ABI_MINOR,
        })
    }

    pub fn library_path(&self) -> &std::path::Path {
        &self.library_path
    }

    fn ensure_n4mm_compatible(&self, artifact: &crate::runtime::ArtifactRef) -> crate::Result<()> {
        let (required_major, required_min_minor) = methods_n4mm_abi_requirement(artifact)?;
        validate_methods_abi_compatibility(
            self.abi_major,
            self.abi_minor,
            required_major,
            required_min_minor,
        )
    }
}

/// Factory controller for the native optimizer.  It is deliberately distinct
/// from the PLS model controller: only this registered tuner controller may
/// create the thread-affine `MethodsHpoStudy` used by training.
#[cfg(feature = "methods-optimizer")]
pub struct MethodsHpoController {
    id: crate::ControllerId,
    _runtime: MethodsRuntime,
}

#[cfg(feature = "methods-optimizer")]
impl MethodsHpoController {
    pub fn new(id: crate::ControllerId, runtime: MethodsRuntime) -> Self {
        Self {
            id,
            _runtime: runtime,
        }
    }
}

#[cfg(feature = "methods-optimizer")]
impl crate::runtime::RuntimeController for MethodsHpoController {
    fn controller_id(&self) -> &crate::ControllerId {
        &self.id
    }

    fn invoke(&self, task: &crate::runtime::NodeTask) -> crate::Result<crate::runtime::NodeResult> {
        Err(crate::DagMlError::RuntimeValidation(format!(
            "Methods HPO controller `{}` is training-owned and cannot execute graph task `{}` directly",
            self.id, task.node_plan.node_id
        )))
    }

    fn create_tuner_session(
        &self,
        task: &crate::runtime::RuntimeHpoCampaignTask,
        context: &crate::runtime::RuntimeHpoExecutionContext,
    ) -> crate::Result<Box<dyn crate::runtime::RuntimeTunerSession>> {
        if task.operation_id != context.operation_id
            || task.controller_id != context.controller_id
            || task.target_node_id != context.target_node_id
            || context.study.controller_id != self.id.as_str()
        {
            return Err(crate::DagMlError::RuntimeValidation(
                "Methods HPO tuner task/context identity mismatch".to_string(),
            ));
        }
        let study = if let Some(checkpoint) = &context.resume_checkpoint {
            MethodsHpoStudy::restore(context.study.clone(), checkpoint)
        } else {
            MethodsHpoStudy::create(context.study.clone())
        }
        .map_err(|error| {
            crate::DagMlError::RuntimeValidation(format!(
                "cannot create controller-owned native Methods HPO study: {error}"
            ))
        })?;
        if context.resume_checkpoint.is_some() {
            let mut native = study.trials().map_err(|error| {
                crate::DagMlError::RuntimeValidation(format!(
                    "cannot attest restored native Methods HPO ledger: {error}"
                ))
            })?;
            native.sort_by_key(|trial| trial.id);
            let native = canonical_hpo_terminal_ledger(native)?;
            let persisted = canonical_hpo_terminal_ledger(
                context
                    .resume_terminal_trials
                    .iter()
                    .map(|snapshot| snapshot.trial.clone())
                    .collect(),
            )?;
            if !hpo_terminal_trials_match(&native, &persisted) {
                return Err(crate::DagMlError::RuntimeValidation(
                    "restored native Methods HPO ledger does not exactly match persisted terminal evidence"
                        .to_string(),
                ));
            }
        }
        Ok(Box::new(MethodsHpoSession {
            study,
            context: context.clone(),
            controller_id: self.id.clone(),
        }))
    }
}

#[cfg(feature = "methods-optimizer")]
struct MethodsHpoSession {
    study: MethodsHpoStudy,
    context: crate::runtime::RuntimeHpoExecutionContext,
    controller_id: crate::ControllerId,
}

#[cfg(feature = "methods-optimizer")]
impl crate::runtime::RuntimeTunerSession for MethodsHpoSession {
    fn trial_history_len(&self) -> crate::Result<u32> {
        let count = self
            .study
            .trials()
            .map_err(|error| crate::DagMlError::RuntimeValidation(error.to_string()))?
            .len();
        u32::try_from(count).map_err(|_| {
            crate::DagMlError::RuntimeValidation(
                "native Methods HPO trial history exceeds u32 budget".to_string(),
            )
        })
    }

    fn ask(&mut self) -> crate::Result<Option<crate::runtime::RuntimeHpoProposal>> {
        let trial = self
            .study
            .ask()
            .map_err(|error| crate::DagMlError::RuntimeValidation(error.to_string()))?;
        if self.context.study.search_space.parameters.len() != 1
            || self.context.parameter_paths.len() != 1
            || self.context.parameter_paths.get("n_components") != Some(&"n_components".to_string())
            || !matches!(self.context.study.search_space.parameters.first(), Some(HpoParameter::Int { name, low: 1, high: 3, step: 1, log: false }) if name == "n_components")
        {
            return Err(crate::DagMlError::RuntimeValidation(
                "Methods HPO v1 accepts only active integer n_components=1..3 mapped directly to the target model".to_string(),
            ));
        }
        let parameter = trial.parameters.get("n_components").ok_or_else(|| {
            crate::DagMlError::RuntimeValidation(
                "native Methods HPO trial omitted active n_components".to_string(),
            )
        })?;
        if !parameter.active
            || !parameter.integer
            || parameter.value.fract() != 0.0
            || !(1.0..=3.0).contains(&parameter.value)
        {
            return Err(crate::DagMlError::RuntimeValidation(
                "native Methods HPO emitted invalid n_components outside V1 integer bounds"
                    .to_string(),
            ));
        }
        let mut variant = self.context.base_variant.clone();
        variant.choices.insert(
            "native_methods_hpo".to_string(),
            crate::generation::GenerationChoice {
                label: format!("trial:{}", trial.id),
                value: serde_json::json!({"trial_id": trial.id}),
                param_overrides: vec![crate::generation::GenerationParamOverride {
                    node_id: self.context.target_node_id.clone(),
                    params: BTreeMap::from([(
                        "n_components".to_string(),
                        serde_json::json!(parameter.value as i64),
                    )]),
                }],
                active_subsequence: None,
            },
        );
        variant.variant_id = crate::VariantId::new(format!("hpo:trial:{}", trial.id))
            .map_err(|error| crate::DagMlError::RuntimeValidation(error.to_string()))?;
        variant.fingerprint = crate::campaign::stable_json_fingerprint(&(
            self.context.base_variant.fingerprint.as_str(),
            &variant.choices,
            trial.id,
        ))?;
        Ok(Some(crate::runtime::RuntimeHpoProposal {
            trial_id: trial.id,
            variant,
        }))
    }

    fn report_intermediate(
        &mut self,
        value: crate::runtime::RuntimeHpoIntermediate,
    ) -> crate::Result<crate::runtime::RuntimeHpoIntermediateOutcome> {
        let pruned = self
            .study
            .report_intermediate(value.trial_id, value.step, value.score)
            .map_err(|error| crate::DagMlError::RuntimeValidation(error.to_string()))?;
        Ok(if pruned {
            crate::runtime::RuntimeHpoIntermediateOutcome::Pruned
        } else {
            crate::runtime::RuntimeHpoIntermediateOutcome::Continue
        })
    }

    fn tell(
        &mut self,
        trial_id: i64,
        terminal: crate::runtime::RuntimeHpoTerminal,
    ) -> crate::Result<()> {
        let terminal = match terminal {
            crate::runtime::RuntimeHpoTerminal::Completed { score } => {
                HpoTerminal::Completed { score }
            }
            crate::runtime::RuntimeHpoTerminal::Failed { failure } => HpoTerminal::Failed {
                failure: HpoFailure {
                    code: failure.code,
                    message: failure.message,
                    retryable: failure.retryable,
                },
            },
        };
        self.study
            .tell(trial_id, terminal)
            .map_err(|error| crate::DagMlError::RuntimeValidation(error.to_string()))?;
        Ok(())
    }

    fn checkpoint(&self) -> crate::Result<N4moptCheckpointArtifact> {
        let checkpoint = self.study.save_checkpoint().map_err(|error| {
            crate::DagMlError::RuntimeValidation(format!(
                "cannot save native Methods HPO checkpoint: {error}"
            ))
        })?;
        checkpoint.validate().map_err(|error| {
            crate::DagMlError::RuntimeValidation(format!(
                "invalid native Methods HPO checkpoint: {error}"
            ))
        })?;
        if checkpoint.binding.controller_id != self.controller_id.as_str()
            || checkpoint.binding.controller_id != self.context.study.controller_id
            || checkpoint.binding.study_id != self.context.study.study_id
            || checkpoint.methods_abi != self.context.study.methods_abi
        {
            return Err(crate::DagMlError::RuntimeValidation(
                "native Methods HPO checkpoint binding/ABI does not match its scheduler context"
                    .to_string(),
            ));
        }
        Ok(checkpoint)
    }

    fn incumbent(
        &self,
        variants: &BTreeMap<i64, crate::VariantId>,
    ) -> crate::Result<Option<crate::runtime::RuntimeHpoIncumbent>> {
        let Some(best) = self.study.best().map_err(|error| {
            crate::DagMlError::RuntimeValidation(format!(
                "cannot read native Methods HPO incumbent: {error}"
            ))
        })?
        else {
            return Ok(None);
        };
        let score = if let Some(persisted) = self
            .context
            .resume_terminal_trials
            .iter()
            .find(|snapshot| snapshot.trial.id == best.trial.id)
        {
            let native = canonical_hpo_terminal_ledger(vec![best.trial.clone()])?;
            let prior = canonical_hpo_terminal_ledger(vec![persisted.trial.clone()])?;
            if !hpo_terminal_trials_match(&native, &prior) {
                return Err(crate::DagMlError::RuntimeValidation(
                    "native Methods HPO incumbent does not match persisted terminal evidence"
                        .to_string(),
                ));
            }
            persisted.trial.score.ok_or_else(|| {
                crate::DagMlError::RuntimeValidation(
                    "persisted Methods HPO incumbent has no terminal score".to_string(),
                )
            })?
        } else {
            best.score
        };
        let variant_id = variants.get(&best.trial.id).cloned().ok_or_else(|| {
            crate::DagMlError::RuntimeValidation(
                "native Methods HPO best() returned a trial without scheduler variant identity"
                    .to_string(),
            )
        })?;
        Ok(Some(crate::runtime::RuntimeHpoIncumbent {
            trial_id: best.trial.id,
            score,
            metric: self.context.selection.metric.name().to_string(),
            direction: self.context.selection.direction,
            variant_id,
        }))
    }

    fn terminal_trial_snapshots(
        &self,
        variants: &BTreeMap<i64, crate::VariantId>,
    ) -> crate::Result<Vec<crate::runtime::RuntimeHpoTerminalSnapshot>> {
        let mut trials = self.study.trials().map_err(|error| {
            crate::DagMlError::RuntimeValidation(format!(
                "cannot read native Methods HPO terminal ledger: {error}"
            ))
        })?;
        trials.sort_by_key(|trial| trial.id);
        if trials.iter().any(|trial| {
            !matches!(
                trial.status,
                HpoTrialStatus::Completed | HpoTrialStatus::Pruned | HpoTrialStatus::Failed
            )
        }) {
            return Err(crate::DagMlError::RuntimeValidation(
                "native Methods HPO trial ledger contains a non-terminal trial".to_string(),
            ));
        }
        let persisted_by_id = self
            .context
            .resume_terminal_trials
            .iter()
            .map(|snapshot| (snapshot.trial.id, snapshot))
            .collect::<BTreeMap<_, _>>();
        trials
            .into_iter()
            .map(|trial| {
                if let Some(persisted) = persisted_by_id.get(&trial.id) {
                    let native = canonical_hpo_terminal_ledger(vec![trial])?;
                    let prior = canonical_hpo_terminal_ledger(vec![persisted.trial.clone()])?;
                    if !hpo_terminal_trials_match(&native, &prior) {
                        return Err(crate::DagMlError::RuntimeValidation(
                            "restored native Methods HPO trial does not match persisted terminal evidence"
                                .to_string(),
                        ));
                    }
                    return Ok((*persisted).clone());
                }
                Ok(crate::runtime::RuntimeHpoTerminalSnapshot {
                    variant_id: variants.get(&trial.id).cloned(),
                    trial,
                })
            })
            .collect()
    }
}

#[cfg(feature = "methods-optimizer")]
mod pls_controller {
    use std::collections::{BTreeMap, BTreeSet};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Mutex;

    use super::*;
    use crate::runtime::{
        ArtifactBackend, ArtifactRef, HandleKind, HandleRef, LineageRecord, MethodsPlsData,
        MethodsPlsDataRequest, NodeResult, NodeTask, PredictionBlock, PredictionInputSpec,
        PredictionPartition, RegressionTargetBlock, RuntimeController, RuntimeDataProvider,
    };
    use crate::{
        ArtifactId, ControllerId, DagMlError, LineageId, Phase, PredictionLevel, PredictionUnitId,
        Result,
    };
    use n4m::{Config, Context, MatrixRef, Model};

    /// Execution-local native PLS controller.  It creates and drops `Context`,
    /// `Config`, and `Model` inside each invocation; the only retained state is
    /// exported N4MM bytes keyed by their durable artifact identity until the
    /// scheduler transfers them into the execution bundle.
    pub struct MethodsPlsController {
        id: ControllerId,
        runtime: MethodsRuntime,
        next_handle: AtomicU64,
        /// Refit export is a one-shot transfer into the bundle.  It is never
        /// consulted by replay and is removed immediately by the scheduler.
        exported_n4mm_by_artifact: Mutex<BTreeMap<ArtifactId, Vec<u8>>>,
        /// Replay hydration creates fresh process-local handles from durable
        /// bundle bytes.  These entries are keyed by invocation-local handle,
        /// not an artifact id or a prior-controller handle map.
        hydrated_n4mm_by_handle: Mutex<BTreeMap<u64, Vec<u8>>>,
    }

    impl MethodsPlsController {
        pub fn new(runtime: MethodsRuntime) -> Self {
            Self {
                id: ControllerId::new(METHODS_PLS_CONTROLLER_ID)
                    .expect("Methods PLS controller id is valid"),
                runtime,
                next_handle: AtomicU64::new(0),
                exported_n4mm_by_artifact: Mutex::new(BTreeMap::new()),
                hydrated_n4mm_by_handle: Mutex::new(BTreeMap::new()),
            }
        }

        /// Test-harness diagnostic for invocation-local payload ownership.
        #[doc(hidden)]
        pub fn hydrated_payload_count(&self) -> Result<usize> {
            self.hydrated_n4mm_by_handle
                .lock()
                .map(|payloads| payloads.len())
                .map_err(|_| {
                    DagMlError::RuntimeValidation(
                        "portable Methods PLS hydrated N4MM lock poisoned".to_string(),
                    )
                })
        }

        fn handle(&self, kind: HandleKind) -> HandleRef {
            HandleRef {
                handle: self.next_handle.fetch_add(1, Ordering::SeqCst) + 1,
                kind,
                owner_controller: self.id.clone(),
            }
        }

        fn request(
            task: &NodeTask,
            provider: &dyn RuntimeDataProvider,
            data_port: &str,
        ) -> Result<MethodsPlsDataRequest> {
            let bindings = task
                .node_plan
                .data_bindings
                .iter()
                .filter(|binding| binding.input_name == data_port)
                .collect::<Vec<_>>();
            let [binding] = bindings.as_slice() else {
                return Err(DagMlError::RuntimeValidation(format!(
                    "portable Methods node `{}` requires exactly one `{data_port}` DataBinding",
                    task.node_plan.node_id,
                )));
            };
            let identity = provider.training_data_identity(binding)?;
            if task.phase != Phase::Predict && identity.is_none() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "portable Methods PLS provider did not attest target-bound DataBinding `{}.{}` for {:?}",
                    binding.node_id, binding.input_name, task.phase
                )));
            }
            let data_view_key = format!("data:{data_port}");
            let fit_view = task.data_views.get(data_port).or_else(|| task.data_views.get(&data_view_key)).cloned().ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "portable Methods node `{}` requires its scheduler-created `{data_port}` data view (available: {:?})",
                    task.node_plan.node_id,
                    task.data_views.keys().collect::<Vec<_>>(),
                ))
            })?;
            let prediction_view = if task.phase == Phase::FitCv {
                let validation_view_key = format!("data:{data_port}:validation");
                let validation_key = format!("{data_port}:validation");
                Some(task.data_views.get(&validation_key).or_else(|| task.data_views.get(&validation_view_key)).cloned().ok_or_else(|| {
                    DagMlError::RuntimeValidation(format!(
                        "portable Methods node `{}` requires its scheduler-created `{data_port}` validation view",
                        task.node_plan.node_id,
                    ))
                })?)
            } else {
                None
            };
            let request = MethodsPlsDataRequest {
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                binding: (*binding).clone(),
                identity,
                fit_view,
                prediction_view,
            };
            request.validate()?;
            Ok(request)
        }

        fn components(task: &NodeTask) -> Result<i32> {
            let value = task.node_plan.params.get("n_components").ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "portable Methods PLS node `{}` requires integer `n_components`",
                    task.node_plan.node_id
                ))
            })?;
            let value = value.as_i64().ok_or_else(|| {
                DagMlError::RuntimeValidation(
                    "portable Methods PLS `n_components` must be an integer".to_string(),
                )
            })?;
            i32::try_from(value)
                .ok()
                .filter(|value| *value > 0)
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation(
                        "portable Methods PLS `n_components` must be a positive i32".to_string(),
                    )
                })
        }

        fn native_error(operation: &str, error: n4m::Error) -> DagMlError {
            DagMlError::RuntimeValidation(format!(
                "portable Methods PLS {operation} failed: {error}"
            ))
        }

        fn fit(task: &NodeTask, data: &MethodsPlsData) -> Result<(Context, Model)> {
            let context =
                Context::new().map_err(|error| Self::native_error("context_create", error))?;
            let mut config =
                Config::new().map_err(|error| Self::native_error("config_create", error))?;
            config
                .set_n_components(Self::components(task)?)
                .map_err(|error| Self::native_error("config_set_n_components", error))?;
            let x = MatrixRef::row_major(&data.fit.x.values, data.fit.x.rows, data.fit.x.cols)
                .map_err(|error| Self::native_error("fit_x_matrix", error))?;
            let targets = data.fit.y.as_ref().ok_or_else(|| {
                DagMlError::RuntimeValidation(
                    "portable Methods PLS fit requires targets".to_string(),
                )
            })?;
            let y = MatrixRef::row_major(&targets.values, targets.rows, targets.cols)
                .map_err(|error| Self::native_error("fit_y_matrix", error))?;
            let model = Model::fit(&context, &config, x, y)
                .map_err(|error| Self::native_error("fit", error))?;
            Ok((context, model))
        }

        fn predict(
            context: &Context,
            model: &Model,
            data: &crate::runtime::MethodsPlsDataset,
        ) -> Result<Vec<Vec<f64>>> {
            let x = MatrixRef::row_major(&data.x.values, data.x.rows, data.x.cols)
                .map_err(|error| Self::native_error("predict_x_matrix", error))?;
            let prediction = model
                .predict(context, x)
                .map_err(|error| Self::native_error("predict", error))?;
            Ok(prediction
                .data
                .chunks(prediction.cols)
                .map(|row| row.to_vec())
                .collect())
        }

        fn result(
            &self,
            task: &NodeTask,
            dataset: &crate::runtime::MethodsPlsDataset,
            values: Vec<Vec<f64>>,
            artifact: Option<(ArtifactRef, HandleRef)>,
            partition: PredictionPartition,
        ) -> Result<NodeResult> {
            let prediction = PredictionBlock {
                prediction_id: Some(format!(
                    "methods-pls:{}:{}:{}",
                    task.node_plan.node_id,
                    task.phase.as_str(),
                    task.fold_id
                        .as_ref()
                        .map(|id| id.as_str())
                        .unwrap_or("full")
                )),
                producer_node: task.node_plan.node_id.clone(),
                producer_port: Some("oof".to_string()),
                partition,
                fold_id: (task.phase == Phase::FitCv)
                    .then(|| task.fold_id.clone())
                    .flatten(),
                sample_ids: dataset.sample_ids.clone(),
                values,
                target_names: dataset.target_names.clone(),
            };
            let regression_targets = if task.phase == Phase::FitCv {
                let targets = dataset.y.as_ref().ok_or_else(|| {
                    DagMlError::RuntimeValidation(
                        "portable Methods PLS FIT_CV requires validation targets".to_string(),
                    )
                })?;
                vec![RegressionTargetBlock {
                    level: PredictionLevel::Sample,
                    unit_ids: dataset
                        .sample_ids
                        .iter()
                        .cloned()
                        .map(PredictionUnitId::Sample)
                        .collect(),
                    values: targets
                        .values
                        .chunks(targets.cols)
                        .map(|row| row.to_vec())
                        .collect(),
                    target_names: dataset.target_names.clone(),
                }]
            } else {
                Vec::new()
            };
            let (artifacts, artifact_handles) = artifact
                .map(|(artifact, handle)| {
                    (
                        vec![artifact.clone()],
                        BTreeMap::from([(artifact.id, handle)]),
                    )
                })
                .unwrap_or_default();
            let artifact_refs = artifacts.clone();
            Ok(NodeResult {
                schema_version: None,
                node_id: task.node_plan.node_id.clone(),
                outputs: BTreeMap::from([("oof".to_string(), self.handle(HandleKind::Prediction))]),
                predictions: vec![prediction],
                observation_predictions: Vec::new(),
                aggregated_predictions: Vec::new(),
                explanations: Vec::new(),
                shape_deltas: Vec::new(),
                artifacts,
                artifact_handles,
                fit_influence_diagnostics: Vec::new(),
                regression_targets,
                lineage: LineageRecord {
                    record_id: LineageId::new(format!(
                        "lineage:methods-pls:{}:{}:{}:{}",
                        task.node_plan.node_id,
                        task.phase.as_str(),
                        task.variant_id
                            .as_ref()
                            .map(|id| id.as_str())
                            .unwrap_or("base"),
                        task.fold_id
                            .as_ref()
                            .map(|id| id.as_str())
                            .unwrap_or("full")
                    ))
                    .expect("valid native PLS lineage id"),
                    run_id: task.run_id.clone(),
                    node_id: task.node_plan.node_id.clone(),
                    phase: task.phase,
                    controller_id: self.id.clone(),
                    controller_version: task.node_plan.controller_version.clone(),
                    variant_id: task.variant_id.clone(),
                    fold_id: task.fold_id.clone(),
                    branch_path: task.branch_path.clone(),
                    input_lineage: Vec::new(),
                    artifact_refs,
                    params_fingerprint: task.node_plan.params_fingerprint.clone(),
                    data_model_shape_fingerprint: None,
                    aggregation_policy_fingerprint: None,
                    seed: task.seed,
                    unsafe_flags: BTreeSet::new(),
                    metrics: BTreeMap::new(),
                    loss_attestations: Vec::new(),
                    early_stopping_records: Vec::new(),
                },
            })
        }
    }

    impl RuntimeController for MethodsPlsController {
        fn controller_id(&self) -> &ControllerId {
            &self.id
        }

        fn export_artifact_payload(&self, artifact_id: &ArtifactId) -> Result<Option<Vec<u8>>> {
            Ok(self
                .exported_n4mm_by_artifact
                .lock()
                .map_err(|_| {
                    DagMlError::RuntimeValidation(
                        "portable Methods PLS N4MM sidecar lock poisoned".to_string(),
                    )
                })?
                .remove(artifact_id))
        }

        fn hydrate_artifact_payload(
            &self,
            request: &crate::runtime::ArtifactMaterializationRequest,
            payload: &[u8],
        ) -> Result<HandleRef> {
            self.runtime.ensure_n4mm_compatible(&request.artifact)?;
            if request.artifact.kind != "n4m_model"
                || request.artifact.backend != Some(ArtifactBackend::Raw)
            {
                return Err(DagMlError::RuntimeValidation(format!(
                    "portable Methods PLS cannot hydrate non-N4MM artifact `{}`",
                    request.artifact.id
                )));
            }
            if format!("{:x}", Sha256::digest(payload))
                != request
                    .artifact
                    .content_fingerprint
                    .as_deref()
                    .unwrap_or_default()
                || request.artifact.size_bytes != Some(payload.len() as u64)
            {
                return Err(DagMlError::RuntimeValidation(format!(
                    "portable Methods PLS payload `{}` does not match its artifact reference",
                    request.artifact.id
                )));
            }
            let inspected = inspect_methods_native_predictor_descriptor_v1(&self.id, payload)?;
            if request
                .artifact
                .native_predictor_descriptor
                .as_ref()
                .is_some_and(|expected| expected != &inspected)
            {
                return Err(DagMlError::RuntimeValidation(format!(
                    "portable Methods PLS payload `{}` does not match its inspected predictor descriptor",
                    request.artifact.id
                )));
            }
            // Import once at hydration time to reject corrupt bytes before any
            // task executes. Prediction imports again into its task-local
            // native context, which avoids retaining native model handles.
            let context = Context::new()
                .map_err(|error| Self::native_error("hydrate_context_create", error))?;
            Model::import_n4mm(&context, payload)
                .map_err(|error| Self::native_error("hydrate_import_n4mm", error))?;
            let handle = self.handle(HandleKind::Model);
            self.hydrated_n4mm_by_handle
                .lock()
                .map_err(|_| {
                    DagMlError::RuntimeValidation(
                        "portable Methods PLS hydrated N4MM lock poisoned".to_string(),
                    )
                })?
                .insert(handle.handle, payload.to_vec());
            Ok(handle)
        }

        fn release_hydrated_artifact_payload(&self, handle: &HandleRef) -> Result<()> {
            if handle.kind != HandleKind::Model || handle.owner_controller != self.id {
                return Err(DagMlError::RuntimeValidation(format!(
                    "portable Methods PLS cannot release foreign hydrated handle {}",
                    handle.handle
                )));
            }
            // Successful PREDICT consumes the entry itself. Replay rollback
            // reaches this same hook before invocation or after an error, so
            // absence is deliberately idempotent rather than an ownership
            // failure.
            self.hydrated_n4mm_by_handle
                .lock()
                .map_err(|_| {
                    DagMlError::RuntimeValidation(
                        "portable Methods PLS hydrated N4MM lock poisoned".to_string(),
                    )
                })?
                .remove(&handle.handle);
            Ok(())
        }

        fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
            Err(DagMlError::RuntimeValidation(format!(
                "portable Methods PLS node `{}` requires a RuntimeDataProvider numeric view",
                task.node_plan.node_id
            )))
        }

        fn invoke_with_data_provider(
            &self,
            task: &NodeTask,
            provider: &dyn RuntimeDataProvider,
        ) -> Result<NodeResult> {
            if task.node_plan.kind != crate::graph::NodeKind::Model {
                return Err(DagMlError::RuntimeValidation(
                    "portable Methods PLS controller only serves model nodes".to_string(),
                ));
            }
            let request = Self::request(task, provider, "x")?;
            provider.preflight_methods_pls(&request)?;
            let data = provider.methods_pls_data(&request)?;
            data.validate_for(&request)?;
            match task.phase {
                Phase::FitCv | Phase::Refit => {
                    let (context, model) = Self::fit(task, &data)?;
                    let prediction_data = data.prediction.as_ref().unwrap_or(&data.fit);
                    let values = Self::predict(&context, &model, prediction_data)?;
                    let artifact = if task.phase == Phase::Refit {
                        let bytes = model
                            .export_n4mm()
                            .map_err(|error| Self::native_error("export_n4mm", error))?;
                        let native_predictor_descriptor =
                            inspect_methods_native_predictor_descriptor_v1(&self.id, &bytes)?;
                        let handle = self.handle(HandleKind::Model);
                        let fingerprint = format!("{:x}", Sha256::digest(&bytes));
                        let id = ArtifactId::new(format!(
                            "artifact:methods-pls:{}:refit",
                            task.node_plan.node_id
                        ))
                        .map_err(|error| DagMlError::RuntimeValidation(error.to_string()))?;
                        self.exported_n4mm_by_artifact
                            .lock()
                            .map_err(|_| {
                                DagMlError::RuntimeValidation(
                                    "portable Methods PLS N4MM sidecar lock poisoned".to_string(),
                                )
                            })?
                            .insert(id.clone(), bytes.clone());
                        Some((
                            ArtifactRef {
                                id,
                                kind: "n4m_model".to_string(),
                                controller_id: self.id.clone(),
                                backend: Some(ArtifactBackend::Raw),
                                // Archive V2 P0 has a closed native Methods namespace.  This
                                // URI is part of the signed portable package, so emitting the
                                // final archive member path here prevents a writer from
                                // translating or duplicating an artifact reference later.
                                uri: Some(format!(
                                    "methods/{}.n4mm",
                                    task.node_plan.node_id.as_str().replace(':', "_")
                                )),
                                content_fingerprint: Some(fingerprint),
                                size_bytes: Some(bytes.len() as u64),
                                plugin: None,
                                plugin_version: None,
                                abi_major: Some(METHODS_ABI_MAJOR),
                                abi_min_minor: Some(METHODS_PLS_N4MM_MIN_ABI_MINOR),
                                native_predictor_descriptor: Some(native_predictor_descriptor),
                            },
                            handle,
                        ))
                    } else {
                        None
                    };
                    let partition = match task.phase {
                        Phase::FitCv => PredictionPartition::Validation,
                        // A REFIT prediction view is an explicitly held-out
                        // output cohort.  Without one, the final model's
                        // full-train output is a Final block and must never be
                        // misdelivered as a stacking test feature.
                        Phase::Refit if data.prediction.is_some() => PredictionPartition::Test,
                        Phase::Refit | Phase::Predict => PredictionPartition::Final,
                        _ => unreachable!("match arm admits only FIT_CV/REFIT"),
                    };
                    self.result(task, prediction_data, values, artifact, partition)
                }
                Phase::Predict => {
                    let artifact = task.artifact_inputs.values().find(|artifact| artifact.controller_id == self.id).ok_or_else(|| DagMlError::RuntimeValidation("portable Methods PLS PREDICT requires its retained N4MM artifact reference".to_string()))?;
                    let handle = task
                        .input_handles
                        .get(&crate::runtime::refit_artifact_input_key(&artifact.artifact.id))
                        .ok_or_else(|| {
                            DagMlError::RuntimeValidation(
                                "portable Methods PLS PREDICT requires a hydrated N4MM runtime handle"
                                    .to_string(),
                            )
                        })?;
                    // This is an invocation-local, one-shot capability.  Do
                    // not retain bundle bytes in a long-lived controller map
                    // after the prediction consuming them has completed.
                    let bytes = self.hydrated_n4mm_by_handle.lock().map_err(|_| DagMlError::RuntimeValidation("portable Methods PLS hydrated N4MM lock poisoned".to_string()))?.remove(&handle.handle).ok_or_else(|| DagMlError::RuntimeValidation("portable Methods PLS PREDICT requires N4MM bytes hydrated from the execution bundle in this controller instance".to_string()))?;
                    let context = Context::new()
                        .map_err(|error| Self::native_error("context_create", error))?;
                    let model = Model::import_n4mm(&context, &bytes)
                        .map_err(|error| Self::native_error("import_n4mm", error))?;
                    let values = Self::predict(&context, &model, &data.fit)?;
                    self.result(task, &data.fit, values, None, PredictionPartition::Final)
                }
                _ => Err(DagMlError::RuntimeValidation(
                    "portable Methods PLS supports FIT_CV, REFIT, and PREDICT only".to_string(),
                )),
            }
        }
    }

    /// Native Ridge meta-model for scheduler-owned nested stacking.
    ///
    /// This controller is intentionally separate from [`MethodsPlsController`]:
    /// its numerical feature matrix is built solely from identity-aligned OOF
    /// predictions delivered in [`NodeTask::prediction_inputs`]. The raw
    /// provider matrix is never read as a Ridge feature, so an upstream raw
    /// data view cannot accidentally bypass the nested-stacking leakage
    /// boundary.
    pub struct MethodsRidgeController {
        id: ControllerId,
        runtime: MethodsRuntime,
        next_handle: AtomicU64,
        exported_n4mm_by_artifact: Mutex<BTreeMap<ArtifactId, Vec<u8>>>,
        hydrated_n4mm_by_handle: Mutex<BTreeMap<u64, Vec<u8>>>,
    }

    type RidgePredictionInputs<'a> = BTreeMap<String, &'a PredictionInputSpec>;

    struct RidgePredictionOutput {
        sample_ids: Vec<crate::SampleId>,
        target_names: Vec<String>,
        values: Vec<Vec<f64>>,
        partition: PredictionPartition,
    }

    impl MethodsRidgeController {
        pub fn new(runtime: MethodsRuntime) -> Self {
            Self {
                id: ControllerId::new(METHODS_RIDGE_CONTROLLER_ID)
                    .expect("Methods Ridge controller id is valid"),
                runtime,
                next_handle: AtomicU64::new(0),
                exported_n4mm_by_artifact: Mutex::new(BTreeMap::new()),
                hydrated_n4mm_by_handle: Mutex::new(BTreeMap::new()),
            }
        }

        fn handle(&self, kind: HandleKind) -> HandleRef {
            HandleRef {
                handle: self.next_handle.fetch_add(1, Ordering::SeqCst) + 1,
                kind,
                owner_controller: self.id.clone(),
            }
        }

        fn lambda(task: &NodeTask) -> Result<f64> {
            let lambda = task
                .node_plan
                .params
                .get("ridge_lambda")
                .and_then(serde_json::Value::as_f64)
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation(format!(
                        "portable Methods Ridge node `{}` requires finite numeric `ridge_lambda`",
                        task.node_plan.node_id
                    ))
                })?;
            if !lambda.is_finite() || lambda < 0.0 {
                return Err(DagMlError::RuntimeValidation(
                    "portable Methods Ridge `ridge_lambda` must be finite and non-negative"
                        .to_string(),
                ));
            }
            Ok(lambda)
        }

        fn feature_matrix(
            specs: &BTreeMap<String, &PredictionInputSpec>,
            sample_ids: &[crate::SampleId],
            expected_partition: PredictionPartition,
            label: &str,
        ) -> Result<crate::runtime::MethodsPlsMatrix> {
            if specs.len() < 2 {
                return Err(DagMlError::RuntimeValidation(format!(
                    "portable Methods Ridge {label} requires OOF predictions from at least two base producers"
                )));
            }
            let mut cols = 0usize;
            for (key, spec) in specs {
                if spec.partition != expected_partition
                    || spec.prediction_level != PredictionLevel::Sample
                    || spec.sample_ids != sample_ids
                    || spec.prediction_width == 0
                    || spec.values.len() != sample_ids.len()
                    || spec.values.iter().any(|row| {
                        row.len() != spec.prediction_width
                            || row.iter().any(|value| !value.is_finite())
                    })
                {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "portable Methods Ridge {label} input `{key}` is not an exact finite sample-level prediction matrix for the scheduler scope"
                    )));
                }
                cols = cols.checked_add(spec.prediction_width).ok_or_else(|| {
                    DagMlError::RuntimeValidation(
                        "portable Methods Ridge feature width overflows usize".to_string(),
                    )
                })?;
            }
            let capacity = sample_ids.len().checked_mul(cols).ok_or_else(|| {
                DagMlError::RuntimeValidation(
                    "portable Methods Ridge feature matrix size overflows usize".to_string(),
                )
            })?;
            let mut values = Vec::with_capacity(capacity);
            for row in 0..sample_ids.len() {
                for spec in specs.values() {
                    values.extend_from_slice(&spec.values[row]);
                }
            }
            let matrix = crate::runtime::MethodsPlsMatrix {
                values,
                rows: sample_ids.len(),
                cols,
            };
            matrix.validate(&format!("Ridge {label} OOF"))?;
            Ok(matrix)
        }

        fn split_prediction_inputs<'a>(
            task: &'a NodeTask,
            suffix: &str,
            output_required: bool,
        ) -> Result<(RidgePredictionInputs<'a>, RidgePredictionInputs<'a>)> {
            let mut fit = BTreeMap::new();
            let mut output = BTreeMap::new();
            for (key, spec) in &task.prediction_inputs {
                if let Some(base) = key.strip_suffix(suffix) {
                    if base.is_empty() || output.insert(base.to_string(), spec).is_some() {
                        return Err(DagMlError::RuntimeValidation(format!(
                            "portable Methods Ridge received duplicate or malformed output OOF input `{key}`"
                        )));
                    }
                // Node identifiers are colon-qualified (`model:base`), so a
                // generic `contains(':')` check would reject every ordinary
                // scheduler key. Only the exact delivery suffix is semantic.
                } else if fit.insert(key.clone(), spec).is_some() {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "portable Methods Ridge received unsupported prediction input `{key}`; expected base keys and `{suffix}` counterparts"
                    )));
                }
            }
            if fit.is_empty()
                || (output_required
                    && fit.keys().collect::<Vec<_>>() != output.keys().collect::<Vec<_>>())
                || (!output.is_empty()
                    && fit.keys().collect::<Vec<_>>() != output.keys().collect::<Vec<_>>())
            {
                return Err(DagMlError::RuntimeValidation(format!(
                    "portable Methods Ridge requires base OOF inputs and, when present, exactly paired `{suffix}` prediction inputs"
                )));
            }
            Ok((fit, output))
        }

        fn predict_only_inputs(task: &NodeTask) -> Result<RidgePredictionInputs<'_>> {
            let mut inputs = BTreeMap::new();
            for (key, spec) in &task.prediction_inputs {
                let Some(base) = key.strip_suffix(":predict") else {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "portable Methods Ridge PREDICT accepts only `:predict` OOF inputs, received `{key}`"
                    )));
                };
                if base.is_empty() || inputs.insert(base.to_string(), spec).is_some() {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "portable Methods Ridge PREDICT received duplicate or malformed OOF input `{key}`"
                    )));
                }
            }
            if inputs.len() < 2 {
                return Err(DagMlError::RuntimeValidation(
                    "portable Methods Ridge PREDICT requires at least two `:predict` OOF inputs"
                        .to_string(),
                ));
            }
            Ok(inputs)
        }

        fn fit(
            task: &NodeTask,
            features: &crate::runtime::MethodsPlsMatrix,
            targets: &crate::runtime::MethodsPlsMatrix,
        ) -> Result<(Context, Model)> {
            let context = Context::new().map_err(|error| {
                MethodsPlsController::native_error("ridge_context_create", error)
            })?;
            let config = Config::new().map_err(|error| {
                MethodsPlsController::native_error("ridge_config_create", error)
            })?;
            let x = MatrixRef::row_major(&features.values, features.rows, features.cols)
                .map_err(|error| MethodsPlsController::native_error("ridge_fit_features", error))?;
            let y = MatrixRef::row_major(&targets.values, targets.rows, targets.cols)
                .map_err(|error| MethodsPlsController::native_error("ridge_fit_targets", error))?;
            let model = Model::fit_ridge(&context, &config, x, y, Self::lambda(task)?)
                .map_err(|error| MethodsPlsController::native_error("ridge_fit", error))?;
            Ok((context, model))
        }

        fn predict(
            context: &Context,
            model: &Model,
            features: &crate::runtime::MethodsPlsMatrix,
        ) -> Result<Vec<Vec<f64>>> {
            let x = MatrixRef::row_major(&features.values, features.rows, features.cols).map_err(
                |error| MethodsPlsController::native_error("ridge_predict_features", error),
            )?;
            let prediction = model
                .predict(context, x)
                .map_err(|error| MethodsPlsController::native_error("ridge_predict", error))?;
            Ok(prediction
                .data
                .chunks(prediction.cols)
                .map(|row| row.to_vec())
                .collect())
        }

        fn result(
            &self,
            task: &NodeTask,
            output: RidgePredictionOutput,
            targets: Option<&crate::runtime::MethodsPlsMatrix>,
            artifact: Option<(ArtifactRef, HandleRef)>,
        ) -> Result<NodeResult> {
            let regression_targets = if task.phase == Phase::FitCv {
                let targets = targets.ok_or_else(|| {
                    DagMlError::RuntimeValidation(
                        "portable Methods Ridge FIT_CV requires validation targets".to_string(),
                    )
                })?;
                vec![RegressionTargetBlock {
                    level: PredictionLevel::Sample,
                    unit_ids: output
                        .sample_ids
                        .iter()
                        .cloned()
                        .map(PredictionUnitId::Sample)
                        .collect(),
                    values: targets
                        .values
                        .chunks(targets.cols)
                        .map(|row| row.to_vec())
                        .collect(),
                    target_names: output.target_names.clone(),
                }]
            } else {
                Vec::new()
            };
            let (artifacts, artifact_handles) = artifact
                .map(|(artifact, handle)| {
                    (
                        vec![artifact.clone()],
                        BTreeMap::from([(artifact.id, handle)]),
                    )
                })
                .unwrap_or_default();
            let artifact_refs = artifacts.clone();
            Ok(NodeResult {
                schema_version: None,
                node_id: task.node_plan.node_id.clone(),
                outputs: BTreeMap::from([("oof".to_string(), self.handle(HandleKind::Prediction))]),
                predictions: vec![PredictionBlock {
                    prediction_id: Some(format!(
                        "methods-ridge:{}:{}:{}",
                        task.node_plan.node_id,
                        task.phase.as_str(),
                        task.fold_id
                            .as_ref()
                            .map(|id| id.as_str())
                            .unwrap_or("full")
                    )),
                    producer_node: task.node_plan.node_id.clone(),
                    producer_port: Some("oof".to_string()),
                    partition: output.partition,
                    fold_id: (task.phase == Phase::FitCv)
                        .then(|| task.fold_id.clone())
                        .flatten(),
                    sample_ids: output.sample_ids,
                    values: output.values,
                    target_names: output.target_names,
                }],
                observation_predictions: Vec::new(),
                aggregated_predictions: Vec::new(),
                explanations: Vec::new(),
                shape_deltas: Vec::new(),
                artifacts,
                artifact_handles,
                fit_influence_diagnostics: Vec::new(),
                regression_targets,
                lineage: LineageRecord {
                    record_id: LineageId::new(format!(
                        "lineage:methods-ridge:{}:{}:{}:{}",
                        task.node_plan.node_id,
                        task.phase.as_str(),
                        task.variant_id
                            .as_ref()
                            .map(|id| id.as_str())
                            .unwrap_or("base"),
                        task.fold_id
                            .as_ref()
                            .map(|id| id.as_str())
                            .unwrap_or("full")
                    ))
                    .expect("valid native Ridge lineage id"),
                    run_id: task.run_id.clone(),
                    node_id: task.node_plan.node_id.clone(),
                    phase: task.phase,
                    controller_id: self.id.clone(),
                    controller_version: task.node_plan.controller_version.clone(),
                    variant_id: task.variant_id.clone(),
                    fold_id: task.fold_id.clone(),
                    branch_path: task.branch_path.clone(),
                    input_lineage: Vec::new(),
                    artifact_refs,
                    params_fingerprint: task.node_plan.params_fingerprint.clone(),
                    data_model_shape_fingerprint: None,
                    aggregation_policy_fingerprint: None,
                    seed: task.seed,
                    unsafe_flags: BTreeSet::new(),
                    metrics: BTreeMap::new(),
                    loss_attestations: Vec::new(),
                    early_stopping_records: Vec::new(),
                },
            })
        }
    }

    impl RuntimeController for MethodsRidgeController {
        fn controller_id(&self) -> &ControllerId {
            &self.id
        }

        fn export_artifact_payload(&self, artifact_id: &ArtifactId) -> Result<Option<Vec<u8>>> {
            Ok(self
                .exported_n4mm_by_artifact
                .lock()
                .map_err(|_| {
                    DagMlError::RuntimeValidation(
                        "portable Methods Ridge N4MM sidecar lock poisoned".to_string(),
                    )
                })?
                .remove(artifact_id))
        }

        fn hydrate_artifact_payload(
            &self,
            request: &crate::runtime::ArtifactMaterializationRequest,
            payload: &[u8],
        ) -> Result<HandleRef> {
            self.runtime.ensure_n4mm_compatible(&request.artifact)?;
            if request.artifact.kind != "n4m_model"
                || request.artifact.backend != Some(ArtifactBackend::Raw)
                || format!("{:x}", Sha256::digest(payload))
                    != request
                        .artifact
                        .content_fingerprint
                        .as_deref()
                        .unwrap_or_default()
                || request.artifact.size_bytes != Some(payload.len() as u64)
            {
                return Err(DagMlError::RuntimeValidation(format!(
                    "portable Methods Ridge payload `{}` does not match its N4MM artifact reference",
                    request.artifact.id
                )));
            }
            let inspected = inspect_methods_native_predictor_descriptor_v1(&self.id, payload)?;
            if request
                .artifact
                .native_predictor_descriptor
                .as_ref()
                .is_some_and(|expected| expected != &inspected)
            {
                return Err(DagMlError::RuntimeValidation(format!(
                    "portable Methods Ridge payload `{}` does not match its inspected predictor descriptor",
                    request.artifact.id
                )));
            }
            let context = Context::new().map_err(|error| {
                MethodsPlsController::native_error("ridge_hydrate_context_create", error)
            })?;
            Model::import_n4mm(&context, payload).map_err(|error| {
                MethodsPlsController::native_error("ridge_hydrate_import_n4mm", error)
            })?;
            let handle = self.handle(HandleKind::Model);
            self.hydrated_n4mm_by_handle
                .lock()
                .map_err(|_| {
                    DagMlError::RuntimeValidation(
                        "portable Methods Ridge hydrated N4MM lock poisoned".to_string(),
                    )
                })?
                .insert(handle.handle, payload.to_vec());
            Ok(handle)
        }

        fn release_hydrated_artifact_payload(&self, handle: &HandleRef) -> Result<()> {
            if handle.kind != HandleKind::Model || handle.owner_controller != self.id {
                return Err(DagMlError::RuntimeValidation(format!(
                    "portable Methods Ridge cannot release foreign hydrated handle {}",
                    handle.handle
                )));
            }
            self.hydrated_n4mm_by_handle
                .lock()
                .map_err(|_| {
                    DagMlError::RuntimeValidation(
                        "portable Methods Ridge hydrated N4MM lock poisoned".to_string(),
                    )
                })?
                .remove(&handle.handle);
            Ok(())
        }

        fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
            Err(DagMlError::RuntimeValidation(format!(
                "portable Methods Ridge node `{}` requires a RuntimeDataProvider numeric view",
                task.node_plan.node_id
            )))
        }

        fn invoke_with_data_provider(
            &self,
            task: &NodeTask,
            provider: &dyn RuntimeDataProvider,
        ) -> Result<NodeResult> {
            if task.node_plan.kind != crate::graph::NodeKind::Model {
                return Err(DagMlError::RuntimeValidation(
                    "portable Methods Ridge controller only serves model nodes".to_string(),
                ));
            }
            // `merge_model` has prediction ports plus the canonical original-data
            // port.  Ridge uses this view only to attest sample identity and
            // targets; its feature matrix is exclusively the declared OOF inputs.
            let request = MethodsPlsController::request(task, provider, "x_original")?;
            provider.preflight_methods_pls(&request)?;
            let data = provider.methods_pls_data(&request)?;
            data.validate_for(&request)?;
            match task.phase {
                Phase::FitCv => {
                    let (fit_specs, validation_specs) =
                        Self::split_prediction_inputs(task, ":outer", true)?;
                    let prediction = data.prediction.as_ref().ok_or_else(|| {
                        DagMlError::RuntimeValidation(
                            "portable Methods Ridge FIT_CV requires a validation data view"
                                .to_string(),
                        )
                    })?;
                    let fit_features = Self::feature_matrix(
                        &fit_specs,
                        &data.fit.sample_ids,
                        PredictionPartition::Validation,
                        "inner FIT_CV",
                    )?;
                    let validation_features = Self::feature_matrix(
                        &validation_specs,
                        &prediction.sample_ids,
                        PredictionPartition::Validation,
                        "outer FIT_CV",
                    )?;
                    let targets = data.fit.y.as_ref().ok_or_else(|| {
                        DagMlError::RuntimeValidation(
                            "portable Methods Ridge FIT_CV requires fitting targets".to_string(),
                        )
                    })?;
                    let validation_targets = prediction.y.as_ref().ok_or_else(|| {
                        DagMlError::RuntimeValidation(
                            "portable Methods Ridge FIT_CV requires validation targets".to_string(),
                        )
                    })?;
                    let (context, model) = Self::fit(task, &fit_features, targets)?;
                    let values = Self::predict(&context, &model, &validation_features)?;
                    Self::result(
                        self,
                        task,
                        RidgePredictionOutput {
                            sample_ids: prediction.sample_ids.clone(),
                            target_names: prediction.target_names.clone(),
                            values,
                            partition: PredictionPartition::Validation,
                        },
                        Some(validation_targets),
                        None,
                    )
                }
                Phase::Refit => {
                    let (fit_specs, refit_specs) =
                        Self::split_prediction_inputs(task, ":refit", false)?;
                    let fit_features = Self::feature_matrix(
                        &fit_specs,
                        &data.fit.sample_ids,
                        PredictionPartition::Validation,
                        "REFIT",
                    )?;
                    let targets = data.fit.y.as_ref().ok_or_else(|| {
                        DagMlError::RuntimeValidation(
                            "portable Methods Ridge REFIT requires targets".to_string(),
                        )
                    })?;
                    let (context, model) = Self::fit(task, &fit_features, targets)?;
                    let (output_ids, values, partition) = if refit_specs.is_empty() {
                        // A normal native full refit has no held-out test
                        // cohort.  Reuse the OOF feature rows only to expose
                        // the final model's training-universe output; they are
                        // never delivered back into FIT_CV or as a test input.
                        (
                            data.fit.sample_ids.clone(),
                            Self::predict(&context, &model, &fit_features)?,
                            PredictionPartition::Final,
                        )
                    } else {
                        let output_ids = refit_specs
                            .values()
                            .next()
                            .expect("paired inputs checked")
                            .sample_ids
                            .clone();
                        let refit_features = Self::feature_matrix(
                            &refit_specs,
                            &output_ids,
                            PredictionPartition::Test,
                            "REFIT output",
                        )?;
                        (
                            output_ids,
                            Self::predict(&context, &model, &refit_features)?,
                            PredictionPartition::Test,
                        )
                    };
                    let bytes = model.export_n4mm().map_err(|error| {
                        MethodsPlsController::native_error("ridge_export_n4mm", error)
                    })?;
                    let native_predictor_descriptor =
                        inspect_methods_native_predictor_descriptor_v1(&self.id, &bytes)?;
                    let id = ArtifactId::new(format!(
                        "artifact:methods-ridge:{}:refit",
                        task.node_plan.node_id
                    ))
                    .map_err(|error| DagMlError::RuntimeValidation(error.to_string()))?;
                    let handle = self.handle(HandleKind::Model);
                    self.exported_n4mm_by_artifact
                        .lock()
                        .map_err(|_| {
                            DagMlError::RuntimeValidation(
                                "portable Methods Ridge N4MM sidecar lock poisoned".to_string(),
                            )
                        })?
                        .insert(id.clone(), bytes.clone());
                    let artifact = ArtifactRef {
                        id,
                        kind: "n4m_model".to_string(),
                        controller_id: self.id.clone(),
                        backend: Some(ArtifactBackend::Raw),
                        uri: Some(format!(
                            "methods/{}.n4mm",
                            task.node_plan.node_id.as_str().replace(':', "_")
                        )),
                        content_fingerprint: Some(format!("{:x}", Sha256::digest(&bytes))),
                        size_bytes: Some(bytes.len() as u64),
                        plugin: None,
                        plugin_version: None,
                        abi_major: Some(METHODS_ABI_MAJOR),
                        abi_min_minor: Some(METHODS_IMPORTED_LINEAR_N4MM_MIN_ABI_MINOR),
                        native_predictor_descriptor: Some(native_predictor_descriptor),
                    };
                    Self::result(
                        self,
                        task,
                        RidgePredictionOutput {
                            sample_ids: output_ids,
                            target_names: data.fit.target_names.clone(),
                            values,
                            partition,
                        },
                        None,
                        Some((artifact, handle)),
                    )
                }
                Phase::Predict => {
                    let predict_specs = Self::predict_only_inputs(task)?;
                    let features = Self::feature_matrix(
                        &predict_specs,
                        &data.fit.sample_ids,
                        PredictionPartition::Final,
                        "PREDICT",
                    )?;
                    let artifact = task.artifact_inputs.values().find(|artifact| artifact.controller_id == self.id).ok_or_else(|| DagMlError::RuntimeValidation("portable Methods Ridge PREDICT requires its retained N4MM artifact reference".to_string()))?;
                    let handle = task.input_handles.get(&crate::runtime::refit_artifact_input_key(&artifact.artifact.id)).ok_or_else(|| DagMlError::RuntimeValidation("portable Methods Ridge PREDICT requires a hydrated N4MM runtime handle".to_string()))?;
                    let bytes = self.hydrated_n4mm_by_handle.lock().map_err(|_| DagMlError::RuntimeValidation("portable Methods Ridge hydrated N4MM lock poisoned".to_string()))?.remove(&handle.handle).ok_or_else(|| DagMlError::RuntimeValidation("portable Methods Ridge PREDICT requires N4MM bytes hydrated from the execution bundle in this controller instance".to_string()))?;
                    let context = Context::new().map_err(|error| {
                        MethodsPlsController::native_error("ridge_predict_context_create", error)
                    })?;
                    let model = Model::import_n4mm(&context, &bytes).map_err(|error| {
                        MethodsPlsController::native_error("ridge_predict_import_n4mm", error)
                    })?;
                    let values = Self::predict(&context, &model, &features)?;
                    Self::result(
                        self,
                        task,
                        RidgePredictionOutput {
                            sample_ids: data.fit.sample_ids.clone(),
                            target_names: data.fit.target_names.clone(),
                            values,
                            partition: PredictionPartition::Final,
                        },
                        None,
                        None,
                    )
                }
                _ => Err(DagMlError::RuntimeValidation(
                    "portable Methods Ridge supports FIT_CV, REFIT, and PREDICT only".to_string(),
                )),
            }
        }
    }

    #[cfg(test)]
    mod ridge_tests {
        use std::collections::BTreeMap;

        use super::*;

        fn sample_ids() -> Vec<crate::SampleId> {
            vec![
                crate::SampleId::new("sample:1").unwrap(),
                crate::SampleId::new("sample:2").unwrap(),
            ]
        }

        fn prediction(values: Vec<Vec<f64>>) -> PredictionInputSpec {
            PredictionInputSpec {
                producer_node: crate::NodeId::new("model:base").unwrap(),
                source_port: "oof".to_string(),
                target_port: "oof".to_string(),
                partition: PredictionPartition::Validation,
                prediction_level: PredictionLevel::Sample,
                fold_id: None,
                fold_ids: Vec::new(),
                unit_ids: Vec::new(),
                sample_ids: sample_ids(),
                values,
                prediction_width: 1,
                target_names: vec!["y".to_string()],
            }
        }

        #[test]
        fn ridge_features_are_stably_ordered_and_identity_aligned() {
            let mut inputs = BTreeMap::new();
            // BTreeMap ordering, rather than host insertion ordering, is part
            // of the portable N4MM coefficient contract.
            inputs.insert(
                "model:z.oof".to_string(),
                prediction(vec![vec![30.0], vec![40.0]]),
            );
            inputs.insert(
                "model:a.oof".to_string(),
                prediction(vec![vec![10.0], vec![20.0]]),
            );

            let refs = inputs
                .iter()
                .map(|(key, spec)| (key.clone(), spec))
                .collect();
            let matrix = MethodsRidgeController::feature_matrix(
                &refs,
                &sample_ids(),
                PredictionPartition::Validation,
                "test",
            )
            .unwrap();
            assert_eq!(matrix.rows, 2);
            assert_eq!(matrix.cols, 2);
            assert_eq!(matrix.values, vec![10.0, 30.0, 20.0, 40.0]);

            let mut misaligned = inputs["model:a.oof"].clone();
            misaligned.sample_ids.reverse();
            let refs = BTreeMap::from([
                ("model:a.oof".to_string(), &misaligned),
                ("model:z.oof".to_string(), &inputs["model:z.oof"]),
            ]);
            assert!(MethodsRidgeController::feature_matrix(
                &refs,
                &sample_ids(),
                PredictionPartition::Validation,
                "test",
            )
            .is_err());
        }
    }
}

#[cfg(feature = "methods-optimizer")]
pub use pls_controller::{MethodsPlsController, MethodsRidgeController};

/// Register the complete native Methods controller set for one process.
///
/// The caller supplies the already-configured runtime and the controller id
/// attested by its native HPO campaign.  Registration is preflighted before
/// mutating the registry, so a duplicate id cannot leave a half-registered
/// Methods runtime behind.  No study, model, or artifact handle is created by
/// this operation.
#[cfg(feature = "methods-optimizer")]
pub fn register_methods_runtime_controllers(
    registry: &mut crate::runtime::RuntimeControllerRegistry,
    hpo_controller_id: crate::ControllerId,
    runtime: MethodsRuntime,
) -> crate::Result<()> {
    let pls_controller_id = crate::ControllerId::new(METHODS_PLS_CONTROLLER_ID)
        .expect("the fixed Methods PLS controller id is valid");
    let ridge_controller_id = crate::ControllerId::new(METHODS_RIDGE_CONTROLLER_ID)
        .expect("the fixed Methods Ridge controller id is valid");
    if hpo_controller_id == pls_controller_id || hpo_controller_id == ridge_controller_id {
        return Err(crate::DagMlError::RuntimeValidation(
            "Methods HPO controller id must differ from the Methods PLS and Ridge controller ids"
                .to_string(),
        ));
    }
    for controller_id in [&pls_controller_id, &ridge_controller_id, &hpo_controller_id] {
        if registry.get(controller_id).is_some() {
            return Err(crate::DagMlError::RuntimeValidation(format!(
                "duplicate runtime controller `{controller_id}`"
            )));
        }
    }
    registry.register(Box::new(MethodsPlsController::new(runtime.clone())))?;
    registry.register(Box::new(MethodsRidgeController::new(runtime.clone())))?;
    registry.register(Box::new(MethodsHpoController::new(
        hpo_controller_id,
        runtime,
    )))?;
    Ok(())
}

#[cfg(feature = "methods-optimizer")]
mod native {
    use super::*;
    use n4m::{
        Category, Direction, Error, ErrorKind, Optimizer, OptimizerOptions, Pruner, Sampler,
        SearchSpace, TrialError, TrialSnapshot, TrialStatus,
    };

    pub(super) struct MethodsHpoStudy {
        manifest: MethodsHpoControllerManifest,
        methods_abi: String,
        _context: n4m::Context,
        optimizer: Optimizer,
        events: Vec<HpoEvent>,
    }

    // This adapter preserves the direct reporter lifecycle for the official
    // binding's focused native tests; production scheduler operation uses the
    // explicit RuntimeTunerSession bridge below instead.
    #[allow(dead_code)]
    struct MethodsHpoReporter<'a> {
        study: &'a mut MethodsHpoStudy,
        trial_id: i64,
        pruned: Option<HpoTrial>,
    }

    impl HpoIntermediateReporter for MethodsHpoReporter<'_> {
        fn report(&mut self, step: i32, score: f64) -> HpoResult<HpoReportOutcome> {
            if self.pruned.is_some() {
                return Err(HpoError::InvalidTrial {
                    reason: "cannot report after native pruning terminalized the trial".to_string(),
                });
            }
            if self.study.report_intermediate(self.trial_id, step, score)? {
                let snapshot = self.study.snapshot_for(self.trial_id)?;
                if snapshot.status != HpoTrialStatus::Pruned {
                    return Err(HpoError::InvalidTrial {
                        reason: "native pruner returned true without a PRUNED snapshot".to_string(),
                    });
                }
                self.pruned = Some(snapshot.clone());
                return Ok(HpoReportOutcome::Pruned(snapshot));
            }
            Ok(HpoReportOutcome::Continue)
        }
    }

    impl MethodsHpoStudy {
        pub(super) fn create(config: MethodsHpoStudyConfig) -> HpoResult<Self> {
            methods_optimizer_preflight()?;
            let methods_abi = config.methods_abi_identity()?;
            let fingerprint = config.search_space.fingerprint()?;
            let optimizer_fingerprint = config.optimizer.fingerprint()?;
            let manifest = MethodsHpoControllerManifest {
                schema_version: HPO_MANIFEST_SCHEMA_VERSION,
                binding: HpoStudyBinding {
                    controller_id: config.controller_id,
                    study_id: config.study_id,
                    search_space_fingerprint: fingerprint,
                    optimizer_fingerprint,
                },
            };
            manifest.validate()?;
            let context =
                n4m::Context::new().map_err(|error| native_error("context_create", error))?;
            let native_space = create_space(&config.search_space)?;
            let options = create_options(&config.optimizer);
            let optimizer = Optimizer::new(&context, &native_space, &options)
                .map_err(|error| native_error("optimizer_create", error))?;
            Ok(Self {
                manifest,
                methods_abi,
                _context: context,
                optimizer,
                events: Vec::new(),
            })
        }
        pub(super) fn restore(
            config: MethodsHpoStudyConfig,
            checkpoint: &N4moptCheckpointArtifact,
        ) -> HpoResult<Self> {
            methods_optimizer_preflight()?;
            let methods_abi = config.methods_abi_identity()?;
            let fingerprint = config.search_space.fingerprint()?;
            let optimizer_fingerprint = config.optimizer.fingerprint()?;
            let binding = HpoStudyBinding {
                controller_id: config.controller_id,
                study_id: config.study_id,
                search_space_fingerprint: fingerprint,
                optimizer_fingerprint,
            };
            checkpoint.validate()?;
            if checkpoint.binding != binding || checkpoint.methods_abi != methods_abi {
                return Err(HpoError::CheckpointBindingMismatch {
                    reason: "study/search-space or Methods ABI differs from checkpoint".to_string(),
                });
            }
            // The official binding performs the N4MOPT envelope preflight and
            // native decoder is the final validator; no local decoder exists.
            let context =
                n4m::Context::new().map_err(|error| native_error("context_create", error))?;
            let optimizer = Optimizer::load_n4mopt(&context, &checkpoint.opaque_payload)
                .map_err(|error| native_error("load_n4mopt", error))?;
            Ok(Self {
                manifest: MethodsHpoControllerManifest {
                    schema_version: HPO_MANIFEST_SCHEMA_VERSION,
                    binding,
                },
                methods_abi,
                _context: context,
                optimizer,
                events: Vec::new(),
            })
        }
        #[allow(dead_code)]
        pub fn manifest(&self) -> &MethodsHpoControllerManifest {
            &self.manifest
        }
        #[allow(dead_code)]
        pub fn events(&self) -> &[HpoEvent] {
            &self.events
        }
        pub fn ask(&mut self) -> HpoResult<HpoTrial> {
            let id = self
                .optimizer
                .ask()
                .and_then(|trial| trial.id())
                .map_err(|error| native_error("ask", error))?;
            let trial = self.snapshot_for(id)?;
            self.events.push(HpoEvent::Asked { trial_id: trial.id });
            Ok(trial)
        }
        #[allow(dead_code)]
        pub fn ask_batch(&mut self, count: i32) -> HpoResult<HpoBatch> {
            match self.optimizer.ask_batch(count) {
                Ok(native_trials) => {
                    let ids = native_trials
                        .iter()
                        .map(|trial| {
                            trial
                                .id()
                                .map_err(|error| native_error("trial_get_id", error))
                        })
                        .collect::<HpoResult<Vec<_>>>()?;
                    let trials = ids
                        .into_iter()
                        .map(|id| self.snapshot_for(id))
                        .collect::<HpoResult<Vec<_>>>()?;
                    for trial in &trials {
                        self.events.push(HpoEvent::Asked { trial_id: trial.id });
                    }
                    Ok(HpoBatch {
                        trials,
                        native_error: None,
                    })
                }
                Err(n4m::AskBatchError::Partial {
                    error,
                    trials: native_trials,
                }) => {
                    let ids = native_trials
                        .iter()
                        .map(|trial| {
                            trial
                                .id()
                                .map_err(|error| native_error("trial_get_id", error))
                        })
                        .collect::<HpoResult<Vec<_>>>()?;
                    let trials = ids
                        .into_iter()
                        .map(|id| self.snapshot_for(id))
                        .collect::<HpoResult<Vec<_>>>()?;
                    for trial in &trials {
                        self.events.push(HpoEvent::Asked { trial_id: trial.id });
                    }
                    Ok(HpoBatch {
                        trials,
                        native_error: Some(to_native_error(error)),
                    })
                }
                Err(n4m::AskBatchError::Error(error)) => Err(native_error("ask_batch", error)),
            }
        }
        pub fn report_intermediate(
            &mut self,
            trial_id: i64,
            step: i32,
            score: f64,
        ) -> HpoResult<bool> {
            if !score.is_finite() {
                return Err(HpoError::InvalidTrial {
                    reason: "intermediate score must be finite".to_string(),
                });
            }
            let should_prune = self
                .optimizer
                .tell_intermediate(trial_id, step, score)
                .map_err(|error| native_error("tell_intermediate", error))?;
            self.events.push(HpoEvent::Intermediate {
                trial_id,
                step,
                score,
                should_prune,
            });
            // libn4m terminalizes a pruned trial as part of the intermediate
            // operation. Calling tell_result(PRUNED) afterwards is invalid.
            if should_prune {
                self.events.push(HpoEvent::Terminal {
                    trial_id,
                    status: HpoTrialStatus::Pruned,
                    score: None,
                    failure: None,
                });
            }
            Ok(should_prune)
        }
        /// Terminalize natively and return the post-`tell` native snapshot.
        /// Returning the pre-tell `RUNNING` proposal would make persistence and
        /// replay lose the terminal sequence/error selected by Methods.
        pub fn tell(&mut self, trial_id: i64, terminal: HpoTerminal) -> HpoResult<HpoTrial> {
            let (status, score, failure) = match terminal {
                HpoTerminal::Completed { score } if score.is_finite() => {
                    (TrialStatus::Completed, score, None)
                }
                HpoTerminal::Completed { .. } => {
                    return Err(HpoError::InvalidTrial {
                        reason: "terminal score must be finite".to_string(),
                    })
                }
                HpoTerminal::Failed { failure } => (TrialStatus::Failed, 0.0, Some(failure)),
                // Native pruning has already terminalized at intermediate
                // reporting time and deliberately rejects a TrialError here.
                HpoTerminal::Pruned { failure } => (TrialStatus::Pruned, 0.0, Some(failure)),
                HpoTerminal::Cancelled { failure } => (TrialStatus::Cancelled, 0.0, Some(failure)),
            };
            let native_failure = matches!(status, TrialStatus::Failed | TrialStatus::Cancelled)
                .then_some(failure.as_ref())
                .flatten()
                .map(|failure| TrialError {
                    code: failure.code.clone(),
                    message: failure.message.clone(),
                    retryable: failure.retryable,
                });
            self.optimizer
                .tell_result(trial_id, status, score, native_failure.as_ref())
                .map_err(|error| native_error("tell_result", error))?;
            let snapshot = self.snapshot_for(trial_id)?;
            self.events.push(HpoEvent::Terminal {
                trial_id,
                status: snapshot.status,
                score: snapshot.score,
                failure: snapshot.failure.clone(),
            });
            Ok(snapshot)
        }
        #[allow(dead_code)]
        pub fn evaluate_one<E: HpoEvaluator>(
            &mut self,
            evaluator: &mut E,
            boundary: &mut HpoEvaluationBoundary<'_>,
        ) -> HpoResult<HpoTrial> {
            boundary.validate()?;
            let trial = self.ask()?;
            let (terminal, pruned) = {
                let mut reporter = MethodsHpoReporter {
                    study: self,
                    trial_id: trial.id,
                    pruned: None,
                };
                let terminal = evaluator.evaluate_with_reporter(&trial, boundary, &mut reporter);
                (terminal, reporter.pruned.take())
            };
            let terminal = match terminal {
                Ok(terminal) => terminal,
                Err(error) => {
                    if pruned.is_some() {
                        // The reporter's native intermediate call already
                        // terminalized the trial; never issue a second tell.
                        return Err(error);
                    }
                    let failure = HpoFailure {
                        code: "HPO_EVALUATION".to_string(),
                        message: error.to_string(),
                        retryable: true,
                    };
                    // Do not strand a native RUNNING trial when the DAG-ML
                    // evaluator itself fails. Preserve the original error.
                    let _ = self.tell(trial.id, HpoTerminal::Failed { failure });
                    return Err(error);
                }
            };
            if let Some(snapshot) = pruned {
                // Pruning is terminalized by tell_intermediate. The evaluator
                // must not turn that native decision into a later tell result.
                return Ok(snapshot);
            }
            self.tell(trial.id, terminal)
        }
        pub fn best(&self) -> HpoResult<Option<HpoBestTrial>> {
            let Some((trial, score)) = self
                .optimizer
                .best()
                .map_err(|error| native_error("best", error))?
            else {
                return Ok(None);
            };
            let id = trial
                .id()
                .map_err(|error| native_error("trial_get_id", error))?;
            self.snapshot_for(id)
                .map(|trial| Some(HpoBestTrial { trial, score }))
        }
        pub fn trials(&self) -> HpoResult<Vec<HpoTrial>> {
            self.optimizer
                .trials(0)
                .map_err(|error| native_error("trials", error))?
                .iter()
                .map(snapshot_trial)
                .collect()
        }
        pub fn save_checkpoint(&self) -> HpoResult<N4moptCheckpointArtifact> {
            let payload = self
                .optimizer
                .save_n4mopt()
                .map_err(|error| native_error("save_n4mopt", error))?;
            if payload.len() > MAX_N4MOPT_CHECKPOINT_BYTES {
                return Err(HpoError::InvalidCheckpoint {
                    reason: "native checkpoint exceeds configured limit".to_string(),
                });
            }
            N4moptCheckpointArtifact::new(
                self.manifest.binding.clone(),
                self.methods_abi.clone(),
                payload,
            )
        }
        fn snapshot_for(&self, id: i64) -> HpoResult<HpoTrial> {
            self.optimizer
                .trials(id)
                .map_err(|error| native_error("trials", error))?
                .into_iter()
                .find(|trial| trial.id == id)
                .ok_or_else(|| HpoError::InvalidTrial {
                    reason: format!("native trial history omitted committed trial `{id}`"),
                })
                .and_then(|trial| snapshot_trial(&trial))
        }
    }

    fn create_space(space: &HpoSearchSpace) -> HpoResult<SearchSpace> {
        let mut result =
            SearchSpace::new().map_err(|error| native_error("search_space_create", error))?;
        for parameter in &space.parameters {
            let call = match parameter {
                HpoParameter::Int {
                    name,
                    low,
                    high,
                    step,
                    log,
                } => result.add_int(name, *low, *high, *step, *log),
                HpoParameter::Float {
                    name,
                    low,
                    high,
                    step,
                    log,
                } => result.add_float(name, *low, *high, *step, *log),
                HpoParameter::Categorical { name, values } => result
                    .add_categorical(name, &values.iter().map(map_category).collect::<Vec<_>>()),
                HpoParameter::Ordinal { name, values } => result.add_ordinal(name, values),
                HpoParameter::SortedTuple {
                    name,
                    length,
                    low,
                    high,
                    integer,
                } => result.add_sorted_tuple(name, *length, *low, *high, *integer),
            };
            call.map_err(|error| native_error("search_space_add", error))?;
        }
        Ok(result)
    }
    fn map_category(value: &HpoCategory) -> Category {
        match value {
            HpoCategory::String(value) => Category::Str(value.clone()),
            HpoCategory::Integer(value) => Category::Int(*value),
            HpoCategory::Float(value) => Category::Float(*value),
            HpoCategory::Boolean(value) => Category::Bool(*value),
        }
    }
    fn create_options(config: &HpoOptimizerConfig) -> OptimizerOptions {
        OptimizerOptions {
            sampler: match config.sampler {
                HpoSampler::Random => Sampler::Random,
                HpoSampler::Sobol => Sampler::Sobol,
                HpoSampler::Lhs => Sampler::Lhs,
                HpoSampler::Ternary => Sampler::Ternary,
                HpoSampler::Ga => Sampler::Ga,
                HpoSampler::Pso => Sampler::Pso,
                HpoSampler::Cmaes => Sampler::Cmaes,
                HpoSampler::Tpe => Sampler::Tpe,
                HpoSampler::GpEi => Sampler::GpEi,
            },
            pruner: match config.pruner {
                HpoPruner::None => Pruner::None,
                HpoPruner::Median => Pruner::Median,
                HpoPruner::Asha => Pruner::Asha,
                HpoPruner::Hyperband => Pruner::Hyperband,
                HpoPruner::Racing => Pruner::Racing,
            },
            direction: match config.direction {
                HpoDirection::Auto => Direction::Auto,
                HpoDirection::Minimize => Direction::Minimize,
                HpoDirection::Maximize => Direction::Maximize,
            },
            metric: match config.metric {
                HpoMetric::Rmse => n4m::Metric::Rmse,
                HpoMetric::Mse => n4m::Metric::Mse,
                HpoMetric::Mae => n4m::Metric::Mae,
                HpoMetric::R2 => n4m::Metric::R2,
                HpoMetric::Accuracy => n4m::Metric::Accuracy,
                HpoMetric::BalancedAccuracy => n4m::Metric::BalancedAccuracy,
                HpoMetric::F1 => n4m::Metric::F1,
                HpoMetric::Logloss => n4m::Metric::Logloss,
            },
            seed: config.seed,
            n_startup_trials: config.n_startup_trials,
            max_resource: config.max_resource,
            reduction_factor: config.reduction_factor,
            ..OptimizerOptions::default()
        }
    }
    fn map_status(value: TrialStatus) -> HpoTrialStatus {
        match value {
            TrialStatus::Running => HpoTrialStatus::Running,
            TrialStatus::Completed => HpoTrialStatus::Completed,
            TrialStatus::Pruned => HpoTrialStatus::Pruned,
            TrialStatus::Failed => HpoTrialStatus::Failed,
            TrialStatus::Cancelled => HpoTrialStatus::Cancelled,
        }
    }
    fn snapshot_trial(value: &TrialSnapshot) -> HpoResult<HpoTrial> {
        let mut parameters = BTreeMap::new();
        for (name, parameter) in &value.parameters {
            parameters.insert(
                name.clone(),
                HpoTrialParameter {
                    name: name.clone(),
                    value: parameter.value,
                    native_kind: Some(map_parameter_kind(parameter.kind)),
                    category_type: parameter.category_type.map(map_category_type),
                    integer: parameter.integer,
                    active: parameter.active,
                    category_index: parameter.category_index,
                    category_label: parameter.category_label.clone(),
                },
            );
        }
        Ok(HpoTrial {
            id: value.id,
            ask_sequence: value.ask_sequence,
            terminal_sequence: value.terminal_sequence,
            parameters,
            parameter_order: value.parameter_order.clone(),
            status: map_status(value.status),
            score: value.score,
            rung: value.rung,
            duration: value.duration,
            intermediates: value
                .intermediates
                .iter()
                .map(|item| HpoIntermediate {
                    sequence: item.sequence,
                    step: item.step,
                    score: item.score,
                    should_prune: item.should_prune,
                })
                .collect(),
            failure: value.error.as_ref().map(|item| HpoFailure {
                code: item.code.clone(),
                message: item.message.clone(),
                retryable: item.retryable,
            }),
        })
    }
    fn map_parameter_kind(value: n4m::ParameterKind) -> HpoNativeParameterKind {
        match value {
            n4m::ParameterKind::Int => HpoNativeParameterKind::Int,
            n4m::ParameterKind::Float => HpoNativeParameterKind::Float,
            n4m::ParameterKind::LogInt => HpoNativeParameterKind::LogInt,
            n4m::ParameterKind::LogFloat => HpoNativeParameterKind::LogFloat,
            n4m::ParameterKind::Categorical => HpoNativeParameterKind::Categorical,
            n4m::ParameterKind::Ordinal => HpoNativeParameterKind::Ordinal,
            n4m::ParameterKind::SortedTuple => HpoNativeParameterKind::SortedTuple,
        }
    }
    fn map_category_type(value: n4m::CategoryType) -> HpoCategoryType {
        match value {
            n4m::CategoryType::Str => HpoCategoryType::String,
            n4m::CategoryType::Int => HpoCategoryType::Integer,
            n4m::CategoryType::Float => HpoCategoryType::Float,
            n4m::CategoryType::Bool => HpoCategoryType::Boolean,
        }
    }
    fn native_error(operation: &str, error: Error) -> HpoError {
        HpoError::Native {
            operation: operation.to_string(),
            error: to_native_error(error),
        }
    }
    fn to_native_error(error: Error) -> HpoNativeError {
        HpoNativeError {
            status: error.status,
            kind: format!("{:?}", error.kind).to_lowercase(),
            retryable: matches!(
                error.kind,
                ErrorKind::OutOfMemory
                    | ErrorKind::BackendUnavailable
                    | ErrorKind::Cancelled
                    | ErrorKind::Io
            ),
            message: error.message,
        }
    }
}

#[cfg(feature = "methods-optimizer")]
use native::MethodsHpoStudy;

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(feature = "methods-optimizer-local")]
    use crate::controller::{
        ArtifactPolicy, ControllerCapability, ControllerFitScope, ControllerManifest,
        ControllerRegistry, RngPolicy,
    };
    #[cfg(feature = "methods-optimizer-local")]
    use crate::graph::{GraphInterface, GraphSpec, NodeKind, NodeSpec, PortSchema};
    #[cfg(feature = "methods-optimizer-local")]
    use crate::metrics::RegressionMetricKind;
    #[cfg(feature = "methods-optimizer-local")]
    use crate::phase::Phase;
    #[cfg(feature = "methods-optimizer-local")]
    use crate::plan::{build_execution_plan, CampaignSpec, ExecutionPlan};

    fn n4mm_ref(controller: &str, abi_min_minor: Option<u32>) -> crate::runtime::ArtifactRef {
        crate::runtime::ArtifactRef {
            id: crate::ArtifactId::new(format!("artifact:{controller}:abi-test")).unwrap(),
            kind: "n4m_model".to_string(),
            controller_id: crate::ControllerId::new(controller).unwrap(),
            backend: Some(crate::runtime::ArtifactBackend::Raw),
            uri: None,
            content_fingerprint: None,
            size_bytes: None,
            plugin: None,
            plugin_version: None,
            abi_major: abi_min_minor.map(|_| METHODS_ABI_MAJOR),
            abi_min_minor,
            native_predictor_descriptor: None,
        }
    }

    #[test]
    fn methods_n4mm_abi_contract_is_capability_derived_and_fail_closed() {
        let historical_pls = n4mm_ref(METHODS_PLS_CONTROLLER_ID, None);
        assert_eq!(
            methods_n4mm_abi_requirement(&historical_pls).unwrap(),
            (METHODS_ABI_MAJOR, METHODS_PLS_N4MM_MIN_ABI_MINOR)
        );
        validate_methods_abi_compatibility(2, 2, 2, 0).unwrap();
        validate_methods_abi_compatibility(2, 3, 2, 0).unwrap();

        let ridge = n4mm_ref(
            METHODS_RIDGE_CONTROLLER_ID,
            Some(METHODS_IMPORTED_LINEAR_N4MM_MIN_ABI_MINOR),
        );
        let requirement = methods_n4mm_abi_requirement(&ridge).unwrap();
        assert!(validate_methods_abi_compatibility(2, 2, requirement.0, requirement.1).is_err());
        validate_methods_abi_compatibility(2, 3, requirement.0, requirement.1).unwrap();

        assert!(
            methods_n4mm_abi_requirement(&n4mm_ref(METHODS_RIDGE_CONTROLLER_ID, None))
                .unwrap_err()
                .to_string()
                .contains("requires an explicit ABI minimum")
        );
        assert!(methods_n4mm_abi_requirement(&n4mm_ref(
            METHODS_PLS_CONTROLLER_ID,
            Some(METHODS_IMPORTED_LINEAR_N4MM_MIN_ABI_MINOR),
        ))
        .is_err());
    }
    #[cfg(feature = "methods-optimizer-local")]
    use crate::runtime::{
        ArtifactBackend, ArtifactMaterializationRequest, ArtifactRef, RuntimeController,
        RuntimeControllerRegistry, RuntimeHpoExecutionContext, RuntimeHpoIntermediate,
        RuntimeHpoIntermediateOutcome, RuntimeHpoProvenance, RuntimeHpoSelectionTarget,
        RuntimeHpoTerminal,
    };

    #[cfg(feature = "methods-optimizer-local")]
    fn native_runtime() -> MethodsRuntime {
        let library_path = std::env::var_os("N4M_LIBRARY_PATH")
            .expect("methods native tests require an explicit N4M_LIBRARY_PATH");
        MethodsRuntime::configure(library_path).expect("configure explicit Methods test runtime")
    }

    #[test]
    fn default_build_refuses_before_any_native_or_host_work() {
        assert_eq!(
            methods_optimizer_preflight(),
            if cfg!(feature = "methods-optimizer") {
                Ok(())
            } else {
                Err(HpoError::MethodsOptimizerFeatureDisabled)
            }
        );
    }

    #[cfg(feature = "methods-optimizer")]
    #[test]
    fn methods_runtime_refuses_relative_library_paths_before_native_loading() {
        assert!(matches!(
            MethodsRuntime::configure("libn4m.so"),
            Err(HpoError::RuntimeConfiguration { reason })
                if reason == "libn4m path must be absolute"
        ));
    }

    #[cfg(feature = "methods-optimizer-local")]
    #[test]
    fn methods_runtime_registers_all_controllers_atomically() {
        let runtime = native_runtime();
        let hpo_id = crate::ControllerId::new("controller:tuner.methods").unwrap();
        let mut registry = RuntimeControllerRegistry::new();

        register_methods_runtime_controllers(&mut registry, hpo_id.clone(), runtime.clone())
            .unwrap();
        let pls_id = crate::ControllerId::new(METHODS_PLS_CONTROLLER_ID).unwrap();
        let ridge_id = crate::ControllerId::new(METHODS_RIDGE_CONTROLLER_ID).unwrap();
        assert!(registry.get(&pls_id).is_some());
        assert!(registry.get(&ridge_id).is_some());
        assert!(registry.get(&hpo_id).is_some());

        let error = register_methods_runtime_controllers(&mut registry, hpo_id.clone(), runtime)
            .unwrap_err();
        assert!(error.to_string().contains("duplicate runtime controller"));
        assert!(registry.get(&pls_id).is_some());
        assert!(registry.get(&ridge_id).is_some());
        assert!(registry.get(&hpo_id).is_some());
    }

    #[cfg(feature = "methods-optimizer-local")]
    #[test]
    fn methods_pls_hydrated_payload_release_is_idempotent_and_handle_local() {
        let runtime = native_runtime();
        let context = n4m::Context::new().unwrap();
        let mut config = n4m::Config::new().unwrap();
        config.set_n_components(1).unwrap();
        let x_values = [1.0, 1.0, 2.0, 4.0, 3.0, 9.0, 4.0, 16.0];
        let y_values = [1.0, 2.0, 3.0, 4.0];
        let x = n4m::MatrixRef::row_major(&x_values, 4, 2).unwrap();
        let y = n4m::MatrixRef::row_major(&y_values, 4, 1).unwrap();
        let payload = n4m::Model::fit(&context, &config, x, y)
            .unwrap()
            .export_n4mm()
            .unwrap();
        let controller = MethodsPlsController::new(runtime);
        let controller_id = controller.controller_id().clone();
        let request = ArtifactMaterializationRequest {
            run_id: crate::RunId::new("run:methods-pls.release").unwrap(),
            bundle_id: crate::BundleId::new("bundle:methods-pls.release").unwrap(),
            node_id: crate::NodeId::new("model:methods-pls").unwrap(),
            phase: Phase::Predict,
            variant_id: None,
            controller_id: controller_id.clone(),
            artifact: ArtifactRef {
                id: crate::ArtifactId::new("artifact:methods-pls.release").unwrap(),
                kind: "n4m_model".to_string(),
                controller_id: controller_id.clone(),
                backend: Some(ArtifactBackend::Raw),
                uri: Some("methods/release.n4mm".to_string()),
                content_fingerprint: Some(format!("{:x}", Sha256::digest(&payload))),
                size_bytes: Some(payload.len() as u64),
                plugin: None,
                plugin_version: None,
                abi_major: Some(METHODS_ABI_MAJOR),
                abi_min_minor: Some(METHODS_PLS_N4MM_MIN_ABI_MINOR),
                native_predictor_descriptor: Some(
                    inspect_methods_native_predictor_descriptor_v1(&controller_id, &payload)
                        .unwrap(),
                ),
            },
            params_fingerprint: "params:methods-pls.release".to_string(),
            training_loss_fingerprint: None,
        };

        let first = controller
            .hydrate_artifact_payload(&request, &payload)
            .unwrap();
        assert_eq!(controller.hydrated_payload_count().unwrap(), 1);
        controller
            .release_hydrated_artifact_payload(&first)
            .unwrap();
        controller
            .release_hydrated_artifact_payload(&first)
            .unwrap();
        assert_eq!(controller.hydrated_payload_count().unwrap(), 0);

        let second = controller
            .hydrate_artifact_payload(&request, &payload)
            .unwrap();
        assert_ne!(first.handle, second.handle);
        controller
            .release_hydrated_artifact_payload(&second)
            .unwrap();
        assert_eq!(controller.hydrated_payload_count().unwrap(), 0);
    }

    #[cfg(feature = "methods-optimizer-local")]
    #[test]
    fn native_predictor_descriptor_binds_pls_and_affine_bytes_fail_closed() {
        let runtime = native_runtime();
        let context = n4m::Context::new().unwrap();
        let mut config = n4m::Config::new().unwrap();
        config.set_n_components(1).unwrap();
        let x_values = [1.0, 1.0, 2.0, 4.0, 3.0, 9.0, 4.0, 16.0];
        let y_values = [1.0, 2.0, 3.0, 4.0];
        let x = n4m::MatrixRef::row_major(&x_values, 4, 2).unwrap();
        let y = n4m::MatrixRef::row_major(&y_values, 4, 1).unwrap();
        let pls_payload = n4m::Model::fit(&context, &config, x, y)
            .unwrap()
            .export_n4mm()
            .unwrap();
        let pls_id = crate::ControllerId::new(METHODS_PLS_CONTROLLER_ID).unwrap();
        let pls_descriptor =
            inspect_methods_native_predictor_descriptor_v1(&pls_id, &pls_payload).unwrap();
        assert_eq!(pls_descriptor.storage_algorithm, 0);
        assert_eq!(
            pls_descriptor.dimensions,
            crate::runtime::NativePredictorDimensionsV1 {
                training_samples: 4,
                n_features: 2,
                n_targets: 1,
                n_components: 1,
            }
        );
        assert_ne!(
            pls_descriptor.capabilities & n4m::SERIALIZED_MODEL_CAPABILITY_PREDICT,
            0
        );

        let coefficients = [2.0, 0.5, -1.0, 3.0];
        let intercept = [1.5, -2.0];
        let affine_payload =
            n4m::Model::import_linear_predictor(&context, 17, 2, 2, &coefficients, &intercept)
                .unwrap()
                .export_n4mm()
                .unwrap();
        let ridge_id = crate::ControllerId::new(METHODS_RIDGE_CONTROLLER_ID).unwrap();
        let ridge_descriptor =
            inspect_methods_native_predictor_descriptor_v1(&ridge_id, &affine_payload).unwrap();
        assert_eq!(ridge_descriptor.storage_algorithm, 11);
        assert_eq!(ridge_descriptor.dimensions.n_components, 0);
        assert_eq!(
            ridge_descriptor.capabilities
                & (n4m::SERIALIZED_MODEL_CAPABILITY_PREDICT
                    | n4m::SERIALIZED_MODEL_CAPABILITY_AFFINE),
            n4m::SERIALIZED_MODEL_CAPABILITY_PREDICT | n4m::SERIALIZED_MODEL_CAPABILITY_AFFINE
        );

        assert!(
            inspect_methods_native_predictor_descriptor_v1(&ridge_id, &pls_payload)
                .unwrap_err()
                .to_string()
                .contains("not product-supported")
        );
        assert!(
            inspect_methods_native_predictor_descriptor_v1(&pls_id, &affine_payload)
                .unwrap_err()
                .to_string()
                .contains("not product-supported")
        );
        let mut tampered = pls_payload.clone();
        let last = tampered.len() - 1;
        tampered[last] ^= 1;
        assert!(inspect_methods_native_predictor_descriptor_v1(&pls_id, &tampered).is_err());

        let request_for =
            |controller_id: crate::ControllerId,
             payload: &[u8],
             descriptor: crate::runtime::NativePredictorDescriptorV1,
             abi_min_minor: u32| ArtifactMaterializationRequest {
                run_id: crate::RunId::new("run:descriptor-test").unwrap(),
                bundle_id: crate::BundleId::new("bundle:descriptor-test").unwrap(),
                node_id: crate::NodeId::new("model:descriptor-test").unwrap(),
                phase: Phase::Predict,
                variant_id: None,
                controller_id: controller_id.clone(),
                artifact: ArtifactRef {
                    id: crate::ArtifactId::new("artifact:descriptor-test").unwrap(),
                    kind: "n4m_model".to_string(),
                    controller_id,
                    backend: Some(ArtifactBackend::Raw),
                    uri: Some("methods/descriptor-test.n4mm".to_string()),
                    content_fingerprint: Some(format!("{:x}", Sha256::digest(payload))),
                    size_bytes: Some(payload.len() as u64),
                    plugin: None,
                    plugin_version: None,
                    abi_major: Some(METHODS_ABI_MAJOR),
                    abi_min_minor: Some(abi_min_minor),
                    native_predictor_descriptor: Some(descriptor),
                },
                params_fingerprint: "a".repeat(64),
                training_loss_fingerprint: None,
            };

        let pls_controller = MethodsPlsController::new(runtime.clone());
        let good_pls = request_for(
            pls_id.clone(),
            &pls_payload,
            pls_descriptor.clone(),
            METHODS_PLS_N4MM_MIN_ABI_MINOR,
        );
        let handle = pls_controller
            .hydrate_artifact_payload(&good_pls, &pls_payload)
            .unwrap();
        pls_controller
            .release_hydrated_artifact_payload(&handle)
            .unwrap();

        let mut wrong_dimensions = pls_descriptor.clone();
        wrong_dimensions.dimensions.n_features += 1;
        wrong_dimensions.descriptor_fingerprint = wrong_dimensions.compute_fingerprint().unwrap();
        let wrong_dimensions_request = request_for(
            pls_id,
            &pls_payload,
            wrong_dimensions,
            METHODS_PLS_N4MM_MIN_ABI_MINOR,
        );
        assert!(pls_controller
            .hydrate_artifact_payload(&wrong_dimensions_request, &pls_payload)
            .unwrap_err()
            .to_string()
            .contains("does not match its inspected predictor descriptor"));

        let ridge_controller = MethodsRidgeController::new(runtime);
        let good_ridge = request_for(
            ridge_id,
            &affine_payload,
            ridge_descriptor,
            METHODS_IMPORTED_LINEAR_N4MM_MIN_ABI_MINOR,
        );
        let ridge_handle = ridge_controller
            .hydrate_artifact_payload(&good_ridge, &affine_payload)
            .unwrap();
        ridge_controller
            .release_hydrated_artifact_payload(&ridge_handle)
            .unwrap();

        let mut future = pls_descriptor;
        future.schema_version = 2;
        future.descriptor_fingerprint = future.compute_fingerprint().unwrap();
        assert!(future
            .validate()
            .unwrap_err()
            .to_string()
            .contains("unsupported native predictor descriptor"));
    }

    fn ledger_trial(score: f64) -> HpoTrial {
        HpoTrial {
            id: 7,
            ask_sequence: 3,
            terminal_sequence: Some(4),
            parameters: BTreeMap::new(),
            parameter_order: Vec::new(),
            status: HpoTrialStatus::Completed,
            score: Some(score),
            rung: 0,
            duration: 0.25,
            intermediates: vec![HpoIntermediate {
                sequence: 2,
                step: 0,
                score,
                should_prune: false,
            }],
            failure: None,
        }
    }

    #[test]
    fn restored_ledger_accepts_only_one_ulp_score_drift_after_tcv1_projection() {
        let native = canonical_hpo_terminal_ledger(vec![ledger_trial(1.0)]).unwrap();
        let mut one_ulp = native.clone();
        one_ulp[0].score = Some(f64::from_bits(1.0_f64.to_bits() + 1));
        one_ulp[0].intermediates[0].score = f64::from_bits(1.0_f64.to_bits() + 1);
        let one_ulp = canonical_hpo_terminal_ledger(one_ulp).unwrap();
        assert!(hpo_terminal_trials_match(&native, &one_ulp));

        let mut two_ulps = native.clone();
        two_ulps[0].score = Some(f64::from_bits(1.0_f64.to_bits() + 2));
        assert!(!hpo_terminal_trials_match(&native, &two_ulps));

        let mut tampered = native.clone();
        tampered[0].score = Some(99.0);
        assert!(!hpo_terminal_trials_match(&native, &tampered));
    }

    #[test]
    fn search_space_digest_is_canonical_and_order_sensitive() {
        let space = HpoSearchSpace {
            parameters: vec![HpoParameter::Int {
                name: "depth".into(),
                low: 1,
                high: 5,
                step: 1,
                log: false,
            }],
        };
        assert_eq!(space.fingerprint().unwrap(), space.fingerprint().unwrap());
        let swapped = HpoSearchSpace {
            parameters: vec![
                HpoParameter::Float {
                    name: "rate".into(),
                    low: 0.1,
                    high: 1.0,
                    step: 0.1,
                    log: false,
                },
                space.parameters[0].clone(),
            ],
        };
        assert_ne!(space.fingerprint().unwrap(), swapped.fingerprint().unwrap());
    }
    #[test]
    fn checkpoint_rejects_oversize_before_native_decoder() {
        let binding = HpoStudyBinding {
            controller_id: "controller:hpo".into(),
            study_id: "study:one".into(),
            search_space_fingerprint: "a".into(),
            optimizer_fingerprint: "b".into(),
        };
        let checkpoint = N4moptCheckpointArtifact {
            schema_version: 1,
            artifact_kind: N4MOPT_ARTIFACT_KIND.into(),
            format: N4MOPT_FORMAT.into(),
            abi_major: METHODS_ABI_MAJOR,
            abi_min_minor: METHODS_N4MOPT_MIN_ABI_MINOR,
            binding,
            methods_abi: "n4m-abi-2.2".into(),
            opaque_payload: vec![0; MAX_N4MOPT_CHECKPOINT_BYTES + 1],
            payload_sha256: "x".into(),
        };
        assert!(matches!(
            checkpoint.validate(),
            Err(HpoError::InvalidCheckpoint { .. })
        ));
    }

    #[test]
    fn historical_n4mopt_defaults_to_first_implemented_abi_and_new_writer_emits_it() {
        let payload = vec![1_u8, 2, 3];
        let historical = serde_json::json!({
            "schema_version": N4MOPT_CHECKPOINT_SCHEMA_VERSION,
            "artifact_kind": N4MOPT_ARTIFACT_KIND,
            "format": N4MOPT_FORMAT,
            "binding": {
                "controller_id": "controller:hpo",
                "study_id": "study:one",
                "search_space_fingerprint": "a",
                "optimizer_fingerprint": "b"
            },
            "methods_abi": "n4m-abi-2.2",
            "opaque_payload": payload,
            "payload_sha256": payload_sha256(&[1, 2, 3])
        });
        let checkpoint: N4moptCheckpointArtifact = serde_json::from_value(historical).unwrap();
        assert_eq!(checkpoint.abi_major, METHODS_ABI_MAJOR);
        assert_eq!(checkpoint.abi_min_minor, METHODS_N4MOPT_MIN_ABI_MINOR);
        checkpoint.validate().unwrap();

        let emitted = serde_json::to_value(checkpoint).unwrap();
        assert_eq!(emitted["abi_major"], METHODS_ABI_MAJOR);
        assert_eq!(emitted["abi_min_minor"], METHODS_N4MOPT_MIN_ABI_MINOR);
    }

    #[cfg(feature = "methods-optimizer-local")]
    fn native_config() -> MethodsHpoStudyConfig {
        MethodsHpoStudyConfig {
            controller_id: "controller:methods-hpo".into(),
            study_id: "study:native-lifecycle".into(),
            methods_abi: "n4m-abi-2.2".into(),
            search_space: HpoSearchSpace {
                parameters: vec![HpoParameter::Int {
                    name: "n_components".into(),
                    low: 1,
                    high: 3,
                    step: 1,
                    log: false,
                }],
            },
            optimizer: HpoOptimizerConfig {
                sampler: HpoSampler::Random,
                pruner: HpoPruner::None,
                direction: HpoDirection::Minimize,
                metric: HpoMetric::Rmse,
                seed: 7,
                n_startup_trials: 1,
                max_resource: 0,
                reduction_factor: 0,
            },
        }
    }

    #[cfg(feature = "methods-optimizer-local")]
    fn native_hpo_manifest(id: &str, kind: NodeKind) -> ControllerManifest {
        ControllerManifest {
            controller_id: crate::ControllerId::new(id).unwrap(),
            controller_version: "native-hpo-test".to_string(),
            operator_kind: kind,
            priority: 0,
            supported_phases: BTreeSet::from([Phase::FitCv]),
            input_ports: Vec::new(),
            output_ports: Vec::new(),
            data_requirements: None,
            capabilities: BTreeSet::from([ControllerCapability::Deterministic]),
            operator_selectors: Vec::new(),
            fit_scope: ControllerFitScope::FoldTrain,
            rng_policy: RngPolicy::UsesCoreSeed,
            artifact_policy: ArtifactPolicy::Serializable,
        }
    }

    #[cfg(feature = "methods-optimizer-local")]
    fn native_hpo_node(id: &str, kind: NodeKind) -> NodeSpec {
        NodeSpec {
            id: crate::NodeId::new(id).unwrap(),
            kind,
            operator: None,
            params: BTreeMap::new(),
            ports: PortSchema {
                inputs: Vec::new(),
                outputs: Vec::new(),
            },
            metadata: BTreeMap::new(),
            seed_label: None,
        }
    }

    #[cfg(feature = "methods-optimizer-local")]
    fn attested_native_hpo_context() -> (
        ExecutionPlan,
        RuntimeHpoExecutionContext,
        crate::runtime::RuntimeHpoCampaignTask,
    ) {
        let target_node_id = crate::NodeId::new("model:methods-pls").unwrap();
        let controller_id = crate::ControllerId::new("controller:methods-hpo").unwrap();
        let mut registry = ControllerRegistry::new();
        registry
            .register(native_hpo_manifest(
                "controller:methods-pls",
                NodeKind::Model,
            ))
            .unwrap();
        let plan = build_execution_plan(
            "plan:methods-hpo-checkpoint",
            GraphSpec {
                id: "graph:methods-hpo-checkpoint".to_string(),
                interface: GraphInterface::default(),
                nodes: vec![native_hpo_node("model:methods-pls", NodeKind::Model)],
                edges: Vec::new(),
                search_space_fingerprint: None,
                metadata: BTreeMap::new(),
            },
            CampaignSpec {
                inner_cv: None,
                id: "campaign:methods-hpo-checkpoint".to_string(),
                root_seed: Some(17),
                leakage_policy: Default::default(),
                aggregation_policy: Default::default(),
                split_invocation: None,
                generation: Default::default(),
                shape_plans: BTreeMap::new(),
                data_bindings: BTreeMap::new(),
                branch_view_plans: Vec::new(),
                metadata: BTreeMap::new(),
            },
            &registry,
        )
        .unwrap();
        let context = RuntimeHpoExecutionContext {
            operation_id: "hpo:methods".to_string(),
            controller_id: controller_id.clone(),
            target_node_id: target_node_id.clone(),
            base_variant: plan.variants[0].clone(),
            trial_budget_total: 2,
            study: native_config(),
            parameter_paths: BTreeMap::from([(
                "n_components".to_string(),
                "n_components".to_string(),
            )]),
            resume_checkpoint: None,
            resume_variants: BTreeMap::new(),
            resume_terminal_trials: Vec::new(),
            selection: RuntimeHpoSelectionTarget {
                producer_node: target_node_id.clone(),
                producer_port: "prediction".to_string(),
                metric: RegressionMetricKind::Rmse,
                direction: HpoDirection::Minimize,
            },
            provenance: RuntimeHpoProvenance {
                graph_fingerprint: plan.graph_fingerprint.clone(),
                campaign_fingerprint: plan.campaign_fingerprint.clone(),
                controller_fingerprint: plan.controller_fingerprint.clone(),
                data_identities_fingerprint: "data-identities:methods-hpo".to_string(),
                fold_set_fingerprint: None,
                training_influence_fingerprint: "influence:methods-hpo".to_string(),
                relation_fingerprint: "relations:methods-hpo".to_string(),
            },
        };
        context.validate_for_plan(&plan).unwrap();
        let task = crate::runtime::RuntimeHpoCampaignTask {
            run_id: crate::RunId::new("run:methods-hpo-checkpoint").unwrap(),
            operation_id: "hpo:methods".to_string(),
            controller_id: controller_id.clone(),
            target_node_id,
            seed: Some(17),
        };
        assert_eq!(task.controller_id, controller_id);
        (plan, context, task)
    }

    #[cfg(feature = "methods-optimizer-local")]
    fn proposal_components(proposal: &crate::runtime::RuntimeHpoProposal) -> i64 {
        let choice = proposal.variant.choices.get("native_methods_hpo").unwrap();
        let override_ = choice.param_overrides.first().unwrap();
        assert_eq!(override_.params.len(), 1);
        override_.params["n_components"].as_i64().unwrap()
    }

    #[cfg(feature = "methods-optimizer-local")]
    fn assert_runtime_refusal(error: crate::DagMlError) {
        assert!(matches!(error, crate::DagMlError::RuntimeValidation(_)));
    }

    #[cfg(feature = "methods-optimizer-local")]
    #[test]
    fn registered_methods_session_checkpoints_restores_and_refuses_tampering() {
        let runtime = native_runtime();
        let (plan, context, task) = attested_native_hpo_context();
        let controller_id = task.controller_id.clone();
        let mut controllers = RuntimeControllerRegistry::new();
        controllers
            .register(Box::new(MethodsHpoController::new(
                controller_id.clone(),
                runtime,
            )))
            .unwrap();
        let controller = controllers.get(&controller_id).unwrap();

        let mut session = controller.create_tuner_session(&task, &context).unwrap();
        let first = session.ask().unwrap().unwrap();
        assert!((1..=3).contains(&proposal_components(&first)));
        assert_eq!(
            session
                .report_intermediate(RuntimeHpoIntermediate {
                    trial_id: first.trial_id,
                    step: 0,
                    score: 1.5,
                })
                .unwrap(),
            RuntimeHpoIntermediateOutcome::Continue
        );
        session
            .tell(first.trial_id, RuntimeHpoTerminal::Completed { score: 1.0 })
            .unwrap();
        let checkpoint = session.checkpoint().unwrap();
        checkpoint.validate().unwrap();
        assert_eq!(checkpoint.binding.controller_id, controller_id.as_str());
        assert_eq!(checkpoint.binding.study_id, context.study.study_id);
        assert_eq!(checkpoint.methods_abi, context.study.methods_abi);

        // Inspect the native N4MOPT trace rather than a synthetic session
        // record: the checkpoint is the only state crossing this boundary.
        let checkpoint_trace = MethodsHpoStudy::restore(context.study.clone(), &checkpoint)
            .unwrap()
            .trials()
            .unwrap();
        assert_eq!(checkpoint_trace.len(), 1);
        assert_eq!(checkpoint_trace[0].id, first.trial_id);
        assert_eq!(checkpoint_trace[0].status, HpoTrialStatus::Completed);
        assert_eq!(checkpoint_trace[0].score, Some(1.0));
        assert_eq!(
            MethodsHpoStudy::restore(context.study.clone(), &checkpoint)
                .unwrap()
                .best()
                .unwrap()
                .unwrap()
                .trial
                .id,
            first.trial_id
        );

        let mut expected = MethodsHpoStudy::restore(context.study.clone(), &checkpoint).unwrap();
        assert_eq!(expected.trials().unwrap(), checkpoint_trace);
        assert_eq!(expected.best().unwrap().unwrap().trial.id, first.trial_id);
        let expected_next = expected.ask().unwrap();
        let mut resumed_context = context.clone();
        resumed_context.resume_checkpoint = Some(checkpoint.clone());
        resumed_context.resume_terminal_trials = vec![crate::runtime::RuntimeHpoTerminalSnapshot {
            trial: checkpoint_trace[0].clone(),
            variant_id: Some(first.variant.variant_id.clone()),
        }];
        resumed_context.validate_for_plan(&plan).unwrap();

        // The persisted terminal ledger is an independent, typed attestation
        // of the opaque native payload.  A modified ledger must be rejected
        // by the controller-owned restore factory, before it can expose an
        // `ask` handle to the scheduler.
        let mut tampered_ledger = resumed_context.clone();
        tampered_ledger.resume_terminal_trials[0].trial.score = Some(99.0);
        let error = match controller.create_tuner_session(&task, &tampered_ledger) {
            Err(error) => error,
            Ok(_) => panic!("tampered restored terminal ledger unexpectedly created a session"),
        };
        assert_runtime_refusal(error);

        let mut resumed = controller
            .create_tuner_session(&task, &resumed_context)
            .unwrap();
        let resumed_next = resumed.ask().unwrap().unwrap();
        assert_eq!(resumed_next.trial_id, expected_next.id);
        assert_eq!(
            proposal_components(&resumed_next),
            expected_next.parameters["n_components"].value as i64
        );
        resumed
            .report_intermediate(RuntimeHpoIntermediate {
                trial_id: resumed_next.trial_id,
                step: 0,
                score: 0.5,
            })
            .unwrap();
        resumed
            .tell(
                resumed_next.trial_id,
                RuntimeHpoTerminal::Completed { score: 0.25 },
            )
            .unwrap();
        let resumed_checkpoint = resumed.checkpoint().unwrap();
        let resumed_trace = MethodsHpoStudy::restore(context.study.clone(), &resumed_checkpoint)
            .unwrap()
            .trials()
            .unwrap();
        assert_eq!(resumed_trace.len(), 2);
        assert_eq!(resumed_trace[1].id, resumed_next.trial_id);
        assert_eq!(resumed_trace[1].status, HpoTrialStatus::Completed);
        assert_eq!(resumed_trace[1].score, Some(0.25));
        assert_eq!(
            MethodsHpoStudy::restore(context.study.clone(), &resumed_checkpoint)
                .unwrap()
                .best()
                .unwrap()
                .unwrap()
                .trial
                .id,
            resumed_next.trial_id
        );

        let mut wrong_abi = resumed_context.clone();
        wrong_abi.study.methods_abi = "n4m-abi-wrong".to_string();
        wrong_abi.validate_for_plan(&plan).unwrap();
        let error = match controller.create_tuner_session(&task, &wrong_abi) {
            Err(error) => error,
            Ok(_) => panic!("mismatched Methods ABI unexpectedly restored a session"),
        };
        assert_runtime_refusal(error);

        let mut wrong_binding = resumed_context.clone();
        wrong_binding
            .resume_checkpoint
            .as_mut()
            .unwrap()
            .binding
            .study_id = "study:wrong-binding".to_string();
        wrong_binding.validate_for_plan(&plan).unwrap();
        let error = match controller.create_tuner_session(&task, &wrong_binding) {
            Err(error) => error,
            Ok(_) => panic!("mismatched checkpoint binding unexpectedly restored a session"),
        };
        assert_runtime_refusal(error);

        let mut wrong_checksum = resumed_context;
        wrong_checksum
            .resume_checkpoint
            .as_mut()
            .unwrap()
            .opaque_payload[0] ^= 1;
        assert_runtime_refusal(wrong_checksum.validate_for_plan(&plan).unwrap_err());
        let error = match controller.create_tuner_session(&task, &wrong_checksum) {
            Err(error) => error,
            Ok(_) => panic!("bad checkpoint checksum unexpectedly restored a session"),
        };
        assert_runtime_refusal(error);
    }

    #[cfg(feature = "methods-optimizer-local")]
    #[test]
    fn real_n4m_lifecycle_batch_trials_best_and_checkpoint() {
        let _runtime = native_runtime();
        let config = native_config();
        let mut study = MethodsHpoStudy::create(config.clone()).unwrap();
        let batch = study.ask_batch(2).unwrap();
        assert_eq!(batch.trials.len(), 2);
        assert!(batch.native_error.is_none());
        assert!(batch.trials.iter().all(|trial| trial.id >= 0));
        assert_eq!(batch.trials[0].parameter_order, vec!["n_components"]);

        study
            .report_intermediate(batch.trials[0].id, 0, 2.0)
            .unwrap();
        study
            .tell(batch.trials[0].id, HpoTerminal::Completed { score: 1.0 })
            .unwrap();
        study
            .tell(
                batch.trials[1].id,
                HpoTerminal::Failed {
                    failure: HpoFailure {
                        code: "EVALUATION_FAILED".into(),
                        message: "controlled test failure".into(),
                        retryable: true,
                    },
                },
            )
            .unwrap();

        let trials = study.trials().unwrap();
        assert_eq!(trials.len(), 2);
        assert_eq!(trials[0].status, HpoTrialStatus::Completed);
        assert_eq!(trials[0].score, Some(1.0));
        assert_eq!(trials[1].status, HpoTrialStatus::Failed);
        assert!(trials[1].failure.as_ref().unwrap().retryable);
        assert_eq!(study.best().unwrap().unwrap().score, 1.0);
        assert!(study
            .events()
            .iter()
            .any(|event| matches!(event, HpoEvent::Intermediate { step: 0, .. })));

        let checkpoint = study.save_checkpoint().unwrap();
        let restored = MethodsHpoStudy::restore(config, &checkpoint).unwrap();
        assert_eq!(restored.trials().unwrap().len(), 2);
    }

    #[cfg(feature = "methods-optimizer-local")]
    #[test]
    fn real_tpe_pruner_failure_trace_and_checkpoint_resume_are_native() {
        let _runtime = native_runtime();
        let mut config = native_config();
        config.optimizer.sampler = HpoSampler::Tpe;
        config.optimizer.pruner = HpoPruner::Median;
        config.optimizer.n_startup_trials = 2;
        config.optimizer.seed = 51;
        let mut study = MethodsHpoStudy::create(config.clone()).unwrap();

        // Exercise a native terminal failure before any candidate scores.  The
        // trace must preserve the structured native failure rather than turn
        // it into a coordinator-side synthetic score.
        let failed = study.ask().unwrap();
        let failed = study
            .tell(
                failed.id,
                HpoTerminal::Failed {
                    failure: HpoFailure {
                        code: "CV_PROVIDER_FAILURE".into(),
                        message: "controlled fold materialization failure".into(),
                        retryable: false,
                    },
                },
            )
            .unwrap();
        assert_eq!(failed.status, HpoTrialStatus::Failed);
        assert_eq!(failed.failure.unwrap().code, "CV_PROVIDER_FAILURE");

        // These three scores model the OOF-CV intermediate produced after
        // each scheduler evaluation. `tell_intermediate` is the only route
        // used for pruning: libn4m terminalizes the bad third candidate as
        // PRUNED, and DAG-ML must not issue a second terminal tell.
        let first = study.ask().unwrap();
        assert!(!study.report_intermediate(first.id, 0, 1.0).unwrap());
        let second = study.ask().unwrap();
        assert!(!study.report_intermediate(second.id, 0, 2.0).unwrap());
        let third = study.ask().unwrap();
        assert!(study.report_intermediate(third.id, 0, 9.0).unwrap());

        let trials = study.trials().unwrap();
        let pruned = trials.iter().find(|trial| trial.id == third.id).unwrap();
        assert_eq!(pruned.status, HpoTrialStatus::Pruned);
        assert!(pruned.terminal_sequence.is_some());
        assert!(pruned
            .intermediates
            .iter()
            .any(|item| item.step == 0 && item.score == 9.0 && item.should_prune));
        assert!(study.events().iter().any(|event| {
            matches!(event, HpoEvent::Terminal { trial_id, status: HpoTrialStatus::Failed, .. } if *trial_id == failed.id)
        }));
        assert!(study.events().iter().any(|event| {
            matches!(event, HpoEvent::Terminal { trial_id, status: HpoTrialStatus::Pruned, .. } if *trial_id == third.id)
        }));

        let checkpoint = study.save_checkpoint().unwrap();
        // The bundle stores the opaque N4MOPT member through serde JSON, so
        // make the resume assertion cross that durable public boundary rather
        // than restoring from the same in-memory envelope.
        let checkpoint: N4moptCheckpointArtifact =
            serde_json::from_str(&serde_json::to_string(&checkpoint).unwrap()).unwrap();
        let mut resumed = MethodsHpoStudy::restore(config, &checkpoint).unwrap();
        for _ in 0..4 {
            let uninterrupted = study.ask().unwrap();
            let restored = resumed.ask().unwrap();
            assert_eq!(uninterrupted.id, restored.id);
            assert_eq!(uninterrupted.parameter_order, restored.parameter_order);
            assert_eq!(uninterrupted.parameters, restored.parameters);
        }
    }

    #[cfg(feature = "methods-optimizer-local")]
    #[test]
    fn malformed_checkpoint_reaches_native_n4mopt_decoder_as_typed_error() {
        let _runtime = native_runtime();
        let config = native_config();
        let study = MethodsHpoStudy::create(config.clone()).unwrap();
        let mut checkpoint = study.save_checkpoint().unwrap();
        checkpoint.opaque_payload[0] ^= 1;
        checkpoint.payload_sha256 = payload_sha256(&checkpoint.opaque_payload);
        assert!(matches!(
            MethodsHpoStudy::restore(config, &checkpoint),
            Err(HpoError::Native { operation, .. }) if operation == "load_n4mopt"
        ));
    }
}

//! Typed metric-provider dispatch shared by native and binding-local implementations.

use std::collections::BTreeSet;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::aggregation::PredictionUnitId;
use crate::criteria::{
    builtin_metric_catalog, fingerprint_without, validate_fingerprint, validate_token,
    CriterionInput, ImplementationCapability, ImplementationDescriptor, ImplementationSemanticKind,
    LearningTaskKind, MetricDecomposition, MetricReduction, MetricReference, PortabilityClass,
    ReplayabilityClass,
};
use crate::error::{DagMlError, Result};
use crate::ids::{FoldId, GroupId, NodeId, ObservationId, SampleId, TargetId, VariantId};
use crate::implementation_registry::LocalImplementationRegistry;
use crate::metrics::{compute_metric_per_target, RegressionMetricKind};
use crate::oof::PredictionPartition;
use crate::policy::PredictionLevel;
use crate::training::PredictionKind;

pub const METRIC_EVALUATION_TASK_SCHEMA_VERSION: u32 = 1;
pub const METRIC_EVALUATION_RESULT_SCHEMA_VERSION: u32 = 1;
pub const METRIC_EVALUATION_TASK_SCHEMA_ID: &str =
    "https://github.com/GBeurier/dag-ml/schemas/metric_evaluation_task.v1.schema.json";
pub const METRIC_EVALUATION_RESULT_SCHEMA_ID: &str =
    "https://github.com/GBeurier/dag-ml/schemas/metric_evaluation_result.v1.schema.json";

const BUILTIN_METRIC_IMPLEMENTATION_VERSION: &str = "metrics-v1";
const BUILTIN_METRIC_IMPLEMENTATION_FINGERPRINT: &str =
    "0aa68bb906c00c9fa433f411f44004d46b5a7f196f9932ca9c313fd184d81d19";

#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(
    rename_all = "snake_case",
    tag = "level",
    content = "id",
    deny_unknown_fields
)]
pub enum MetricUnitId {
    Observation(ObservationId),
    Sample(SampleId),
    Target(TargetId),
    Group(GroupId),
}

impl MetricUnitId {
    pub fn level(&self) -> PredictionLevel {
        match self {
            Self::Observation(_) => PredictionLevel::Observation,
            Self::Sample(_) => PredictionLevel::Sample,
            Self::Target(_) => PredictionLevel::Target,
            Self::Group(_) => PredictionLevel::Group,
        }
    }
}

impl From<&PredictionUnitId> for MetricUnitId {
    fn from(value: &PredictionUnitId) -> Self {
        match value {
            PredictionUnitId::Sample(id) => Self::Sample(id.clone()),
            PredictionUnitId::Target(id) => Self::Target(id.clone()),
            PredictionUnitId::Group(id) => Self::Group(id.clone()),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MetricEvaluationScope {
    pub producer_node: NodeId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub producer_port: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prediction_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variant_id: Option<VariantId>,
    pub partition: PredictionPartition,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fold_id: Option<FoldId>,
    pub level: PredictionLevel,
}

impl MetricEvaluationScope {
    fn validate(&self) -> Result<()> {
        for (label, value) in [
            ("metric producer_port", self.producer_port.as_deref()),
            ("metric prediction_id", self.prediction_id.as_deref()),
        ] {
            if let Some(value) = value {
                validate_token(label, value)?;
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MetricEvaluationTask {
    pub schema_version: u32,
    pub request_id: String,
    pub metric: MetricReference,
    pub task_kind: LearningTaskKind,
    pub prediction_kind: PredictionKind,
    pub scope: MetricEvaluationScope,
    pub unit_ids: Vec<MetricUnitId>,
    pub predictions: Vec<Vec<f64>>,
    pub targets: Vec<Vec<f64>>,
    pub output_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sample_weights: Option<Vec<f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub missing_mask: Option<Vec<Vec<bool>>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_ids: Option<Vec<String>>,
    pub task_fingerprint: String,
}

impl MetricEvaluationTask {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        request_id: impl Into<String>,
        metric: MetricReference,
        task_kind: LearningTaskKind,
        prediction_kind: PredictionKind,
        scope: MetricEvaluationScope,
        unit_ids: Vec<MetricUnitId>,
        predictions: Vec<Vec<f64>>,
        targets: Vec<Vec<f64>>,
        output_ids: Vec<String>,
        sample_weights: Option<Vec<f64>>,
        missing_mask: Option<Vec<Vec<bool>>>,
        group_ids: Option<Vec<String>>,
    ) -> Result<Self> {
        let mut task = Self {
            schema_version: METRIC_EVALUATION_TASK_SCHEMA_VERSION,
            request_id: request_id.into(),
            metric,
            task_kind,
            prediction_kind,
            scope,
            unit_ids,
            predictions,
            targets,
            output_ids,
            sample_weights,
            missing_mask,
            group_ids,
            task_fingerprint: String::new(),
        };
        task.task_fingerprint = task.compute_fingerprint()?;
        task.validate()?;
        Ok(task)
    }

    pub fn from_json(json: &str) -> Result<Self> {
        let task: Self = crate::canonical::deserialize_external_contract(
            json,
            "metric evaluation task",
            DagMlError::CampaignValidation,
        )?;
        task.validate()?;
        Ok(task)
    }

    pub fn compute_fingerprint(&self) -> Result<String> {
        fingerprint_without(self, "task_fingerprint", "metric evaluation task")
    }

    pub fn validate(&self) -> Result<()> {
        if self.schema_version != METRIC_EVALUATION_TASK_SCHEMA_VERSION {
            return task_error(format!(
                "metric evaluation task schema_version {} is unsupported",
                self.schema_version
            ));
        }
        validate_token("metric request_id", &self.request_id)?;
        self.metric.validate()?;
        self.metric.spec.validate_compatibility(
            self.task_kind,
            self.prediction_kind,
            self.scope.level,
        )?;
        self.scope.validate()?;
        let row_count = self.unit_ids.len();
        if row_count == 0 {
            return task_error("metric evaluation task has no units");
        }
        if self
            .unit_ids
            .iter()
            .any(|unit| unit.level() != self.scope.level)
        {
            return task_error("metric evaluation unit level does not match scope");
        }
        if self.unit_ids.iter().collect::<BTreeSet<_>>().len() != row_count {
            return task_error("metric evaluation task contains duplicate unit ids");
        }
        let prediction_width =
            validate_finite_matrix("metric predictions", &self.predictions, row_count)?;
        let target_width = validate_finite_matrix("metric targets", &self.targets, row_count)?;
        if self.output_ids.len() != target_width || self.output_ids.is_empty() {
            return task_error(format!(
                "metric output_ids length {} does not match target width {target_width}",
                self.output_ids.len()
            ));
        }
        let mut outputs = BTreeSet::new();
        for output_id in &self.output_ids {
            validate_token("metric output_id", output_id)?;
            if !outputs.insert(output_id) {
                return task_error(format!("duplicate metric output_id `{output_id}`"));
            }
        }
        if matches!(
            self.prediction_kind,
            PredictionKind::RegressionPoint | PredictionKind::ClassLabel
        ) && prediction_width != target_width
        {
            return task_error(format!(
                "metric prediction width {prediction_width} does not match target width {target_width}"
            ));
        }
        validate_optional_inputs(self, row_count, target_width)?;
        validate_fingerprint("metric evaluation task", &self.task_fingerprint)?;
        let expected = self.compute_fingerprint()?;
        if self.task_fingerprint != expected {
            return task_error(format!(
                "metric evaluation task fingerprint mismatch: declared {}, expected {expected}",
                self.task_fingerprint
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MetricEvaluationValue {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit_id: Option<MetricUnitId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_id: Option<String>,
    pub value: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MetricEvaluationResult {
    pub schema_version: u32,
    pub request_id: String,
    pub semantic_id: String,
    pub semantic_fingerprint: String,
    pub implementation_fingerprint: String,
    pub descriptor_fingerprint: String,
    pub scope: MetricEvaluationScope,
    pub values: Vec<MetricEvaluationValue>,
    pub result_fingerprint: String,
}

impl MetricEvaluationResult {
    pub fn for_task(
        task: &MetricEvaluationTask,
        values: Vec<MetricEvaluationValue>,
    ) -> Result<Self> {
        let mut result = Self {
            schema_version: METRIC_EVALUATION_RESULT_SCHEMA_VERSION,
            request_id: task.request_id.clone(),
            semantic_id: task.metric.spec.metric_id.clone(),
            semantic_fingerprint: task.metric.spec.spec_fingerprint.clone(),
            implementation_fingerprint: task
                .metric
                .implementation
                .implementation_fingerprint
                .clone(),
            descriptor_fingerprint: task.metric.implementation.descriptor_fingerprint.clone(),
            scope: task.scope.clone(),
            values,
            result_fingerprint: String::new(),
        };
        result.result_fingerprint = result.compute_fingerprint()?;
        result.validate_against(task)?;
        Ok(result)
    }

    pub fn from_json_for_task(json: &str, task: &MetricEvaluationTask) -> Result<Self> {
        let result: Self = crate::canonical::deserialize_external_contract(
            json,
            "metric evaluation result",
            DagMlError::RuntimeValidation,
        )?;
        result.validate_against(task)?;
        Ok(result)
    }

    pub fn compute_fingerprint(&self) -> Result<String> {
        fingerprint_without(self, "result_fingerprint", "metric evaluation result")
    }

    pub fn validate_against(&self, task: &MetricEvaluationTask) -> Result<()> {
        task.validate()?;
        if self.schema_version != METRIC_EVALUATION_RESULT_SCHEMA_VERSION {
            return result_error(format!(
                "metric evaluation result schema_version {} is unsupported",
                self.schema_version
            ));
        }
        if self.request_id != task.request_id
            || self.semantic_id != task.metric.spec.metric_id
            || self.semantic_fingerprint != task.metric.spec.spec_fingerprint
            || self.implementation_fingerprint
                != task.metric.implementation.implementation_fingerprint
            || self.descriptor_fingerprint != task.metric.implementation.descriptor_fingerprint
        {
            return result_error("metric provider identity/fingerprint does not match task");
        }
        if self.scope != task.scope {
            return result_error("metric provider result scope does not match task");
        }
        if self.values.is_empty() {
            return result_error("metric provider returned no values");
        }
        if self.values.iter().any(|value| !value.value.is_finite()) {
            return result_error("metric provider returned a non-finite value");
        }
        validate_result_coverage(self, task)?;
        validate_fingerprint("metric evaluation result", &self.result_fingerprint)
            .map_err(|error| DagMlError::RuntimeValidation(error.to_string()))?;
        let expected = self.compute_fingerprint()?;
        if self.result_fingerprint != expected {
            return result_error(format!(
                "metric evaluation result fingerprint mismatch: declared {}, expected {expected}",
                self.result_fingerprint
            ));
        }
        Ok(())
    }

    pub fn aggregate_for_task(&self, task: &MetricEvaluationTask) -> Result<f64> {
        self.validate_against(task)?;
        self.reduce(task)
    }

    fn reduce(&self, task: &MetricEvaluationTask) -> Result<f64> {
        let value = match task.metric.spec.reduction {
            MetricReduction::Global => self.values[0].value,
            MetricReduction::Mean => {
                self.values.iter().map(|value| value.value).sum::<f64>() / self.values.len() as f64
            }
            MetricReduction::Sum => self.values.iter().map(|value| value.value).sum(),
            MetricReduction::WeightedMean => {
                let weights = task.sample_weights.as_ref().ok_or_else(|| {
                    DagMlError::RuntimeValidation(
                        "weighted metric reduction has no sample weights".to_string(),
                    )
                })?;
                let weighted_sum = self
                    .values
                    .iter()
                    .zip(weights)
                    .map(|(value, weight)| value.value * weight)
                    .sum::<f64>();
                weighted_sum / weights.iter().sum::<f64>()
            }
        };
        if !value.is_finite() {
            return result_error("metric reduction produced a non-finite value");
        }
        Ok(value)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct ValidatedMetricEvaluation {
    pub result: MetricEvaluationResult,
    pub aggregate: f64,
}

pub trait MetricProvider: Send + Sync {
    fn evaluate(&self, task: &MetricEvaluationTask) -> Result<MetricEvaluationResult>;
}

#[derive(Default)]
pub struct MetricProviderRegistry {
    providers: LocalImplementationRegistry<Arc<dyn MetricProvider>>,
}

impl MetricProviderRegistry {
    pub fn register(
        &mut self,
        descriptor: ImplementationDescriptor,
        provider: Arc<dyn MetricProvider>,
    ) -> Result<()> {
        descriptor.validate()?;
        if descriptor.semantic_kind != ImplementationSemanticKind::Metric {
            return task_error("metric provider registry rejects non-metric descriptor");
        }
        self.providers.register(descriptor, provider)
    }

    pub fn evaluate(&self, task: &MetricEvaluationTask) -> Result<ValidatedMetricEvaluation> {
        task.validate()?;
        let provider = self.providers.resolve_metric(&task.metric)?;
        let result = provider.evaluate(task)?;
        let aggregate = result.aggregate_for_task(task)?;
        Ok(ValidatedMetricEvaluation { result, aggregate })
    }
}

pub fn builtin_metric_reference(metric: RegressionMetricKind) -> Result<MetricReference> {
    let metric_id = format!("dagml.metric.{}@1", metric.name());
    let spec = builtin_metric_catalog()?
        .remove(&metric_id)
        .ok_or_else(|| {
            DagMlError::CampaignValidation(format!("missing `{metric_id}` catalog entry"))
        })?;
    let implementation = ImplementationDescriptor::new(
        ImplementationSemanticKind::Metric,
        &spec.metric_id,
        &spec.spec_fingerprint,
        "provider:dag-ml-core",
        "binding:rust",
        BUILTIN_METRIC_IMPLEMENTATION_VERSION,
        BUILTIN_METRIC_IMPLEMENTATION_FINGERPRINT,
        BTreeSet::new(),
        BTreeSet::new(),
        BTreeSet::from([ImplementationCapability::Deterministic]),
        PortabilityClass::PortableBuiltIn,
        ReplayabilityClass::Detached,
        None,
    )?;
    let reference = MetricReference {
        spec,
        implementation,
    };
    reference.validate()?;
    Ok(reference)
}

pub fn builtin_metric_registry() -> Result<MetricProviderRegistry> {
    let mut registry = MetricProviderRegistry::default();
    for metric in [
        RegressionMetricKind::Mse,
        RegressionMetricKind::Rmse,
        RegressionMetricKind::Mae,
        RegressionMetricKind::R2,
        RegressionMetricKind::Accuracy,
        RegressionMetricKind::BalancedAccuracy,
    ] {
        let reference = builtin_metric_reference(metric)?;
        registry.register(
            reference.implementation,
            Arc::new(BuiltinMetricProvider { metric }),
        )?;
    }
    Ok(registry)
}

struct BuiltinMetricProvider {
    metric: RegressionMetricKind,
}

impl MetricProvider for BuiltinMetricProvider {
    fn evaluate(&self, task: &MetricEvaluationTask) -> Result<MetricEvaluationResult> {
        let expected_id = format!("dagml.metric.{}@1", self.metric.name());
        if task.metric.spec.metric_id != expected_id {
            return result_error(format!(
                "built-in provider `{}` cannot evaluate `{}`",
                self.metric.name(),
                task.metric.spec.metric_id
            ));
        }
        let predictions = task
            .predictions
            .iter()
            .map(Vec::as_slice)
            .collect::<Vec<_>>();
        let targets = task.targets.iter().map(Vec::as_slice).collect::<Vec<_>>();
        let values =
            compute_metric_per_target(self.metric, task.output_ids.len(), &predictions, &targets)
                .into_iter()
                .zip(&task.output_ids)
                .map(|(value, output_id)| MetricEvaluationValue {
                    unit_id: None,
                    output_id: Some(output_id.clone()),
                    value,
                })
                .collect();
        MetricEvaluationResult::for_task(task, values)
    }
}

fn validate_finite_matrix(label: &str, values: &[Vec<f64>], expected_rows: usize) -> Result<usize> {
    if values.len() != expected_rows {
        return task_error(format!(
            "{label} has {} rows for {expected_rows} units",
            values.len()
        ));
    }
    let width = values.first().map_or(0, Vec::len);
    if width == 0 || values.iter().any(|row| row.len() != width) {
        return task_error(format!("{label} is empty or ragged"));
    }
    if values.iter().flatten().any(|value| !value.is_finite()) {
        return task_error(format!("{label} contains non-finite values"));
    }
    Ok(width)
}

fn validate_optional_inputs(
    task: &MetricEvaluationTask,
    row_count: usize,
    target_width: usize,
) -> Result<()> {
    let required = &task.metric.spec.required_inputs;
    match &task.sample_weights {
        Some(weights) => {
            if !task
                .metric
                .spec
                .capabilities
                .contains(&crate::criteria::MetricCapability::SupportsSampleWeights)
            {
                return task_error("metric task supplies unsupported sample weights");
            }
            if weights.len() != row_count
                || weights
                    .iter()
                    .any(|weight| !weight.is_finite() || *weight < 0.0)
                || weights.iter().sum::<f64>() <= 0.0
            {
                return task_error("metric sample weights are invalid");
            }
        }
        None if required.contains(&CriterionInput::SampleWeight) => {
            return task_error("metric task is missing required sample weights");
        }
        None => {}
    }
    match &task.missing_mask {
        Some(mask) => {
            if !task
                .metric
                .spec
                .capabilities
                .contains(&crate::criteria::MetricCapability::SupportsMissingMask)
            {
                return task_error("metric task supplies unsupported missing mask");
            }
            if mask.len() != row_count || mask.iter().any(|row| row.len() != target_width) {
                return task_error("metric missing mask shape does not match targets");
            }
        }
        None if required.contains(&CriterionInput::MissingMask) => {
            return task_error("metric task is missing required missing mask");
        }
        None => {}
    }
    match &task.group_ids {
        Some(group_ids) => {
            if !required.contains(&CriterionInput::Group) {
                return task_error("metric task supplies undeclared group ids");
            }
            if group_ids.len() != row_count {
                return task_error("metric group_ids length does not match units");
            }
            for group_id in group_ids {
                validate_token("metric group_id", group_id)?;
            }
        }
        None if required.contains(&CriterionInput::Group) => {
            return task_error("metric task is missing required group ids");
        }
        None => {}
    }
    Ok(())
}

fn validate_result_coverage(
    result: &MetricEvaluationResult,
    task: &MetricEvaluationTask,
) -> Result<()> {
    match task.metric.spec.decomposition {
        MetricDecomposition::Global => {
            if result.values.len() != 1
                || result.values[0].unit_id.is_some()
                || result.values[0].output_id.is_some()
            {
                return result_error("global metric provider result has wrong coverage");
            }
        }
        MetricDecomposition::PerOutput => {
            if result.values.len() != task.output_ids.len() {
                return result_error("per-output metric provider result has wrong coverage");
            }
            for (value, output_id) in result.values.iter().zip(&task.output_ids) {
                if value.unit_id.is_some() || value.output_id.as_ref() != Some(output_id) {
                    return result_error("per-output metric provider result has wrong scope/order");
                }
            }
        }
        MetricDecomposition::PerUnit => {
            if result.values.len() != task.unit_ids.len() {
                return result_error("per-unit metric provider result has wrong coverage");
            }
            for (value, unit_id) in result.values.iter().zip(&task.unit_ids) {
                if value.output_id.is_some() || value.unit_id.as_ref() != Some(unit_id) {
                    return result_error("per-unit metric provider result has wrong scope/order");
                }
            }
        }
    }
    Ok(())
}

fn task_error<T>(message: impl Into<String>) -> Result<T> {
    Err(DagMlError::CampaignValidation(message.into()))
}

fn result_error<T>(message: impl Into<String>) -> Result<T> {
    Err(DagMlError::RuntimeValidation(message.into()))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::criteria::{
        ImplementationSemanticKind, MetricCapability, MetricSpec, SemanticSpecKind,
    };
    use crate::selection::MetricObjective;

    fn sample_scope() -> MetricEvaluationScope {
        MetricEvaluationScope {
            producer_node: NodeId::new("model:custom").unwrap(),
            producer_port: Some("prediction".to_string()),
            prediction_id: Some("prediction:validation".to_string()),
            variant_id: None,
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new("fold:0").unwrap()),
            level: PredictionLevel::Sample,
        }
    }

    fn custom_bias_reference() -> MetricReference {
        let spec = MetricSpec::new(
            "example.metric.bias@1",
            SemanticSpecKind::Custom,
            BTreeSet::from([LearningTaskKind::Regression]),
            BTreeSet::from([PredictionKind::RegressionPoint]),
            MetricObjective::Minimize,
            BTreeSet::from([PredictionLevel::Sample]),
            MetricDecomposition::PerUnit,
            MetricReduction::Mean,
            BTreeSet::from([CriterionInput::Target, CriterionInput::Prediction]),
            BTreeSet::from([MetricCapability::Decomposable]),
            json!({}),
        )
        .unwrap();
        let implementation = ImplementationDescriptor::new(
            ImplementationSemanticKind::Metric,
            &spec.metric_id,
            &spec.spec_fingerprint,
            "provider:rust-local",
            "binding:rust",
            "1.0.0",
            "4991854599d650fd613dfd02b10d90a649ad7fec85f20a027d5e7b2a553f628b",
            BTreeSet::new(),
            BTreeSet::new(),
            BTreeSet::from([ImplementationCapability::Deterministic]),
            PortabilityClass::HostLocal,
            ReplayabilityClass::RegistryRequired,
            Some("metric:run-123:bias".to_string()),
        )
        .unwrap();
        MetricReference {
            spec,
            implementation,
        }
    }

    fn custom_task() -> MetricEvaluationTask {
        MetricEvaluationTask::new(
            "metric-request:bias",
            custom_bias_reference(),
            LearningTaskKind::Regression,
            PredictionKind::RegressionPoint,
            sample_scope(),
            vec![
                MetricUnitId::Sample(SampleId::new("sample:0").unwrap()),
                MetricUnitId::Sample(SampleId::new("sample:1").unwrap()),
            ],
            vec![vec![2.0], vec![5.0]],
            vec![vec![1.0], vec![3.0]],
            vec!["target".to_string()],
            None,
            None,
            None,
        )
        .unwrap()
    }

    struct BiasProvider;

    impl MetricProvider for BiasProvider {
        fn evaluate(&self, task: &MetricEvaluationTask) -> Result<MetricEvaluationResult> {
            let values = task
                .unit_ids
                .iter()
                .zip(task.predictions.iter().zip(&task.targets))
                .map(|(unit_id, (prediction, target))| MetricEvaluationValue {
                    unit_id: Some(unit_id.clone()),
                    output_id: None,
                    value: prediction[0] - target[0],
                })
                .collect();
            MetricEvaluationResult::for_task(task, values)
        }
    }

    #[test]
    fn custom_metric_registry_executes_and_reduces_provider_values() {
        let task = custom_task();
        let mut registry = MetricProviderRegistry::default();
        registry
            .register(task.metric.implementation.clone(), Arc::new(BiasProvider))
            .unwrap();
        let evaluation = registry.evaluate(&task).unwrap();
        assert_eq!(evaluation.aggregate, 1.5);
        assert_eq!(evaluation.result.values.len(), 2);
    }

    #[test]
    fn task_rejects_custom_metric_without_objective() {
        let task = custom_task();
        let mut value = serde_json::to_value(task).unwrap();
        value["metric"]["spec"]
            .as_object_mut()
            .unwrap()
            .remove("objective");
        let error = MetricEvaluationTask::from_json(&value.to_string())
            .unwrap_err()
            .to_string();
        assert!(error.contains("objective"));
    }

    #[test]
    fn provider_result_rejects_nonfinite_wrong_scope_coverage_and_fingerprint() {
        let task = custom_task();
        let valid = BiasProvider.evaluate(&task).unwrap();

        let mut nonfinite = valid.clone();
        nonfinite.values[0].value = f64::NAN;
        assert!(nonfinite
            .validate_against(&task)
            .unwrap_err()
            .to_string()
            .contains("non-finite"));

        let mut wrong_scope = valid.clone();
        wrong_scope.scope.partition = PredictionPartition::Test;
        wrong_scope.result_fingerprint = wrong_scope.compute_fingerprint().unwrap();
        assert!(wrong_scope
            .validate_against(&task)
            .unwrap_err()
            .to_string()
            .contains("scope"));

        let mut wrong_coverage = valid.clone();
        wrong_coverage.values.pop();
        wrong_coverage.result_fingerprint = wrong_coverage.compute_fingerprint().unwrap();
        assert!(wrong_coverage
            .validate_against(&task)
            .unwrap_err()
            .to_string()
            .contains("coverage"));

        let mut wrong_fingerprint = valid;
        wrong_fingerprint.implementation_fingerprint = "0".repeat(64);
        wrong_fingerprint.result_fingerprint = wrong_fingerprint.compute_fingerprint().unwrap();
        assert!(wrong_fingerprint
            .validate_against(&task)
            .unwrap_err()
            .to_string()
            .contains("identity/fingerprint"));
    }

    #[test]
    fn built_in_registry_uses_existing_metric_kernel_and_per_output_reduction() {
        let reference = builtin_metric_reference(RegressionMetricKind::Rmse).unwrap();
        let task = MetricEvaluationTask::new(
            "metric-request:rmse",
            reference,
            LearningTaskKind::Regression,
            PredictionKind::RegressionPoint,
            sample_scope(),
            vec![
                MetricUnitId::Sample(SampleId::new("sample:0").unwrap()),
                MetricUnitId::Sample(SampleId::new("sample:1").unwrap()),
            ],
            vec![vec![2.0, 4.0], vec![4.0, 8.0]],
            vec![vec![1.0, 2.0], vec![3.0, 6.0]],
            vec!["a".to_string(), "b".to_string()],
            None,
            None,
            None,
        )
        .unwrap();
        let evaluation = builtin_metric_registry().unwrap().evaluate(&task).unwrap();
        assert_eq!(evaluation.result.values[0].value, 1.0);
        assert_eq!(evaluation.result.values[1].value, 2.0);
        assert_eq!(evaluation.aggregate, 1.5);
    }

    #[test]
    fn registry_rejects_descriptor_substitution_even_with_same_registry_key() {
        let task = custom_task();
        let mut substituted = task.metric.implementation.clone();
        substituted.implementation_version = "2.0.0".to_string();
        substituted.descriptor_fingerprint = substituted.compute_fingerprint().unwrap();
        let mut registry = MetricProviderRegistry::default();
        registry
            .register(substituted, Arc::new(BiasProvider))
            .unwrap();
        assert!(registry
            .evaluate(&task)
            .unwrap_err()
            .to_string()
            .contains("descriptor"));
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    #[test]
    fn published_provider_fixture_matches_rust_task_and_result_contracts() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../examples/fixtures/criteria/metric_provider_contracts.v1.json"
        ))
        .unwrap();
        let task = MetricEvaluationTask::from_json(&fixture["valid"]["task"].to_string()).unwrap();
        let result = MetricEvaluationResult::from_json_for_task(
            &fixture["valid"]["result"].to_string(),
            &task,
        )
        .unwrap();
        assert_eq!(
            result.reduce(&task).unwrap(),
            fixture["valid"]["aggregate"].as_f64().unwrap()
        );

        for case in fixture["invalid"].as_array().unwrap() {
            let document = case["document"].to_string();
            let rejected = match case["contract"].as_str().unwrap() {
                "metric_evaluation_task" => MetricEvaluationTask::from_json(&document).is_err(),
                "metric_evaluation_result" => {
                    MetricEvaluationResult::from_json_for_task(&document, &task).is_err()
                }
                contract => panic!("unknown metric-provider fixture contract `{contract}`"),
            };
            assert!(rejected, "negative case `{}` was accepted", case["id"]);
        }
    }
}

//! Minimal-operator-alias resolution: inferring a step's node kind from the
//! controller registry and rewriting the step accordingly.

use super::*;

pub(crate) const DSL_MINIMAL_OPERATOR_ALIAS: &str = "dsl_minimal_operator_alias";
pub(crate) const DSL_REGISTRY_INFERRED_KIND: &str = "dsl_registry_inferred_kind";
pub(crate) const DSL_COMPAT_ORIGINAL_KEYWORD: &str = "dsl_compat_original_keyword";
pub(crate) fn resolve_step_minimal_aliases(
    step: &mut PipelineDslStep,
    registry: &ControllerRegistry,
) -> Result<()> {
    if let Some(resolved) = resolve_operator_step_minimal_alias(step, registry)? {
        *step = resolved;
    }
    match step {
        PipelineDslStep::Branch(branch) => {
            for branch in &mut branch.branches {
                for child in &mut branch.steps {
                    resolve_step_minimal_aliases(child, registry)?;
                }
            }
        }
        PipelineDslStep::Generator(generator) => {
            for branch in &mut generator.branches {
                for child in &mut branch.steps {
                    resolve_step_minimal_aliases(child, registry)?;
                }
            }
            for stage in &mut generator.stages {
                for branch in &mut stage.branches {
                    for child in &mut branch.steps {
                        resolve_step_minimal_aliases(child, registry)?;
                    }
                }
            }
        }
        PipelineDslStep::Sequential(sequence) => {
            for child in &mut sequence.steps {
                resolve_step_minimal_aliases(child, registry)?;
            }
        }
        _ => {}
    }
    Ok(())
}
pub(crate) fn resolve_operator_step_minimal_alias(
    step: &PipelineDslStep,
    registry: &ControllerRegistry,
) -> Result<Option<PipelineDslStep>> {
    let Some((current_kind, operator_step)) = operator_step_node_kind(step) else {
        return Ok(None);
    };
    if !is_minimal_operator_alias(operator_step) {
        return Ok(None);
    }
    let Some(inferred_kind) = registry.infer_operator_kind(&operator_step.operator)? else {
        return Ok(None);
    };
    if inferred_kind == current_kind {
        return Ok(None);
    }
    let mut resolved = operator_step.clone();
    annotate_registry_inferred_operator_step(&mut resolved, &inferred_kind)?;
    Ok(Some(operator_pipeline_step_for_node_kind(
        inferred_kind,
        resolved,
    )?))
}
pub(crate) fn operator_step_node_kind(
    step: &PipelineDslStep,
) -> Option<(NodeKind, &PipelineDslOperatorStep)> {
    match step {
        PipelineDslStep::Transform(step) => Some((NodeKind::Transform, step)),
        PipelineDslStep::YTransform(step) => Some((NodeKind::YTransform, step)),
        PipelineDslStep::Tag(step) => Some((NodeKind::Tag, step)),
        PipelineDslStep::Exclude(step) => Some((NodeKind::Exclude, step)),
        PipelineDslStep::Filter(step) | PipelineDslStep::SampleFilter(step) => {
            Some((NodeKind::Exclude, step))
        }
        PipelineDslStep::Augmentation(step)
        | PipelineDslStep::FeatureAugmentation(step)
        | PipelineDslStep::SampleAugmentation(step) => Some((NodeKind::Augmentation, step)),
        PipelineDslStep::DataGeneration(step) => Some((NodeKind::Generator, step)),
        PipelineDslStep::Model(step) => Some((NodeKind::Model, step)),
        PipelineDslStep::Tuner(step) => Some((NodeKind::Tuner, step)),
        PipelineDslStep::Chart(step) => Some((NodeKind::Chart, step)),
        _ => None,
    }
}
pub(crate) fn is_minimal_operator_alias(step: &PipelineDslOperatorStep) -> bool {
    step.metadata
        .get(DSL_MINIMAL_OPERATOR_ALIAS)
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
}
pub(crate) fn annotate_registry_inferred_operator_step(
    step: &mut PipelineDslOperatorStep,
    inferred_kind: &NodeKind,
) -> Result<()> {
    if let Some(keyword) = step.metadata.get("dsl_compat_keyword").cloned() {
        step.metadata
            .entry(DSL_COMPAT_ORIGINAL_KEYWORD.to_string())
            .or_insert(keyword);
    }
    step.metadata.insert(
        "dsl_compat_keyword".to_string(),
        serde_json::Value::String(compat_keyword_for_node_kind(inferred_kind)?.to_string()),
    );
    step.metadata.insert(
        DSL_REGISTRY_INFERRED_KIND.to_string(),
        serde_json::to_value(inferred_kind).map_err(|error| {
            DagMlError::GraphValidation(format!(
                "failed to serialize registry-inferred operator kind: {error}"
            ))
        })?,
    );
    Ok(())
}
pub(crate) fn operator_pipeline_step_for_node_kind(
    kind: NodeKind,
    step: PipelineDslOperatorStep,
) -> Result<PipelineDslStep> {
    match kind {
        NodeKind::Transform => Ok(PipelineDslStep::Transform(step)),
        NodeKind::YTransform => Ok(PipelineDslStep::YTransform(step)),
        NodeKind::Tag => Ok(PipelineDslStep::Tag(step)),
        NodeKind::Exclude => Ok(PipelineDslStep::Exclude(step)),
        NodeKind::Augmentation => Ok(PipelineDslStep::Augmentation(step)),
        NodeKind::Generator => Ok(PipelineDslStep::DataGeneration(step)),
        NodeKind::Model => Ok(PipelineDslStep::Model(step)),
        NodeKind::Tuner => Ok(PipelineDslStep::Tuner(step)),
        NodeKind::Chart => Ok(PipelineDslStep::Chart(step)),
        unsupported => Err(DagMlError::GraphValidation(format!(
            "minimal operator alias matched unsupported node kind {:?}; use explicit DSL syntax",
            unsupported
        ))),
    }
}
pub(crate) fn compat_keyword_for_node_kind(kind: &NodeKind) -> Result<&'static str> {
    match kind {
        NodeKind::Transform => Ok("preprocessing"),
        NodeKind::YTransform => Ok("y_processing"),
        NodeKind::Tag => Ok("tag"),
        NodeKind::Exclude => Ok("exclude"),
        NodeKind::Augmentation => Ok("augmentation"),
        NodeKind::Generator => Ok("data_generation"),
        NodeKind::Model => Ok("model"),
        NodeKind::Tuner => Ok("tuner"),
        NodeKind::Chart => Ok("chart"),
        unsupported => Err(DagMlError::GraphValidation(format!(
            "minimal operator alias matched unsupported node kind {:?}; use explicit DSL syntax",
            unsupported
        ))),
    }
}

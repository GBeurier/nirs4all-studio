use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::adapter::{AdapterPath, AdapterRegistry, PlanningPolicy};
use crate::alignment::{alignment_metadata, alignment_mode_from_fusion};
use crate::error::{DataError, Result};
use crate::ids::{RepresentationId, SourceId};
use crate::model::{DatasetSchema, SourceDescriptor};
use crate::plan::{DataPlan, DataPlanStep, DataPlanStepKind, FitScope, PlanIssue};
use crate::ModelInputSpec;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct DataPlanRequest {
    pub id: String,
    #[serde(default)]
    pub source_ids: Option<Vec<SourceId>>,
    #[serde(default)]
    pub planning_policy: PlanningPolicy,
}

impl DataPlanRequest {
    pub fn new(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            source_ids: None,
            planning_policy: PlanningPolicy::default(),
        }
    }
}

struct ResolvedSource<'a> {
    source: &'a SourceDescriptor,
    target_representation: RepresentationId,
    path: AdapterPath,
    issues: Vec<PlanIssue>,
}

pub fn plan_model_input(
    schema: &DatasetSchema,
    model_input: &ModelInputSpec,
    adapters: &AdapterRegistry,
    request: &DataPlanRequest,
) -> Result<DataPlan> {
    schema.validate()?;
    model_input.validate()?;
    validate_request(request)?;

    let candidate_sources = candidate_sources(schema, request)?;
    let mut steps = Vec::new();
    let mut issues = Vec::new();
    let mut output_representation = None;
    let mut adapt_idx = 0usize;
    let mut align_idx = 0usize;

    for port in &model_input.ports {
        let resolved = candidate_sources
            .iter()
            .filter_map(|source| resolve_source(source, port, adapters, &request.planning_policy))
            .collect::<Vec<_>>();

        if resolved.is_empty() {
            if port.optional {
                continue;
            }
            return Err(DataError::Validation(format!(
                "no source can satisfy required model input port `{}`",
                port.name
            )));
        }
        if resolved.len() > 1 && !port.multi_source {
            return Err(DataError::Validation(format!(
                "model input port `{}` accepts one source but {} sources resolved",
                port.name,
                resolved.len()
            )));
        }

        let port_output_representation = resolved[0].target_representation.clone();
        let mut join_inputs = Vec::new();
        for source_plan in resolved {
            issues.extend(source_plan.issues);
            let source_output = source_output_id(&source_plan.source.id);
            steps.push(DataPlanStep {
                kind: DataPlanStepKind::Materialize,
                source_id: Some(source_plan.source.id.clone()),
                adapter_id: None,
                input_representation: None,
                output_representation: Some(source_plan.source.native_representation.id.clone()),
                fit_scope: FitScope::Stateless,
                requires_user_choice: false,
                metadata: BTreeMap::from([(
                    "output".to_string(),
                    serde_json::Value::String(source_output.clone()),
                )]),
            });

            let mut current_output = source_output;
            let mut current_representation = source_plan.source.native_representation.id.clone();
            for adapter in source_plan.path.adapters {
                let step_output = format!("step:adapt:{adapt_idx}");
                steps.push(DataPlanStep {
                    kind: DataPlanStepKind::Adapt,
                    source_id: Some(source_plan.source.id.clone()),
                    adapter_id: Some(adapter.id),
                    input_representation: Some(current_representation),
                    output_representation: Some(adapter.output_representation.clone()),
                    fit_scope: adapter.fit_scope,
                    requires_user_choice: false,
                    metadata: BTreeMap::from([
                        (
                            "input".to_string(),
                            serde_json::Value::String(current_output),
                        ),
                        (
                            "output".to_string(),
                            serde_json::Value::String(step_output.clone()),
                        ),
                    ]),
                });
                current_output = step_output;
                current_representation = adapter.output_representation;
                adapt_idx += 1;
            }
            join_inputs.push(current_output);
        }

        let join_inputs = if join_inputs.len() > 1 {
            let align_output = format!("step:align:{align_idx}");
            let align_input_representation = port_output_representation.clone();
            let alignment_mode = alignment_mode_from_fusion(model_input.default_fusion.as_ref())?;
            steps.push(DataPlanStep {
                kind: DataPlanStepKind::Align,
                source_id: None,
                adapter_id: None,
                input_representation: Some(align_input_representation),
                output_representation: Some(port_output_representation.clone()),
                fit_scope: FitScope::Stateless,
                requires_user_choice: false,
                metadata: alignment_metadata(join_inputs, align_output.clone(), alignment_mode)?,
            });
            align_idx += 1;
            vec![align_output]
        } else {
            join_inputs
        };

        steps.push(DataPlanStep {
            kind: DataPlanStepKind::Join,
            source_id: None,
            adapter_id: None,
            input_representation: Some(port_output_representation.clone()),
            output_representation: Some(port_output_representation.clone()),
            fit_scope: FitScope::Stateless,
            requires_user_choice: false,
            metadata: BTreeMap::from([
                (
                    "inputs".to_string(),
                    serde_json::Value::Array(
                        join_inputs
                            .into_iter()
                            .map(serde_json::Value::String)
                            .collect(),
                    ),
                ),
                (
                    "output".to_string(),
                    serde_json::Value::String(format!("port:{}", port.name)),
                ),
            ]),
        });
        output_representation = Some(port_output_representation);
    }

    let output_representation = output_representation
        .ok_or_else(|| DataError::Validation("model input plan produced no outputs".to_string()))?;
    let plan = DataPlan {
        id: request.id.clone(),
        steps,
        output_representation,
        issues,
    };
    plan.validate()?;
    Ok(plan)
}

fn validate_request(request: &DataPlanRequest) -> Result<()> {
    if request.id.trim().is_empty() {
        return Err(DataError::Validation(
            "data plan request id is empty".to_string(),
        ));
    }
    if let Some(source_ids) = &request.source_ids {
        let mut seen = std::collections::BTreeSet::new();
        for source_id in source_ids {
            if !seen.insert(source_id) {
                return Err(DataError::Validation(format!(
                    "data plan request contains duplicate source `{source_id}`"
                )));
            }
        }
    }
    Ok(())
}

fn candidate_sources<'a>(
    schema: &'a DatasetSchema,
    request: &DataPlanRequest,
) -> Result<Vec<&'a SourceDescriptor>> {
    let mut sources = schema.sources.iter().collect::<Vec<_>>();
    sources.sort_by(|left, right| left.id.cmp(&right.id));
    if let Some(requested) = &request.source_ids {
        let by_id = sources
            .iter()
            .map(|source| (&source.id, *source))
            .collect::<BTreeMap<_, _>>();
        requested
            .iter()
            .map(|source_id| {
                by_id.get(source_id).copied().ok_or_else(|| {
                    DataError::Validation(format!(
                        "data plan request references unknown source `{source_id}`"
                    ))
                })
            })
            .collect()
    } else {
        Ok(sources)
    }
}

fn resolve_source<'a>(
    source: &'a SourceDescriptor,
    port: &crate::InputPortSpec,
    adapters: &AdapterRegistry,
    policy: &PlanningPolicy,
) -> Option<ResolvedSource<'a>> {
    for target_type in &port.accepted_types {
        for target_representation in &port.accepted_representations {
            let known_rank = if target_representation == &source.native_representation.id {
                source.native_representation.rank
            } else {
                crate::builtin_representations()
                    .into_iter()
                    .find(|spec| &spec.id == target_representation)
                    .and_then(|spec| spec.rank)
            };
            if port
                .rank
                .zip(known_rank)
                .is_some_and(|(required, actual)| required != actual)
            {
                continue;
            }
            let mut resolution = adapters.find_path(
                &source.type_id,
                &source.native_representation.id,
                target_type,
                target_representation,
                policy,
            );
            if resolution.requires_user_choice {
                // Keep an inspectable candidate and all choices; materialization
                // already refuses unresolved plans. Never silently drop an
                // ambiguous optional source or hide the solver diagnostics.
                let mut candidate_policy = policy.clone();
                candidate_policy.require_user_choice_on_ambiguity = false;
                resolution.path = adapters
                    .find_path(
                        &source.type_id,
                        &source.native_representation.id,
                        target_type,
                        target_representation,
                        &candidate_policy,
                    )
                    .path;
            }
            if let Some(path) = resolution.path {
                if port.rank.is_some() && known_rank.is_none() {
                    resolution.issues.push(PlanIssue {
                        code: "unverified_rank".into(),
                        message: format!("input port `{}` requires rank {:?}, but representation `{target_representation}` has no declared rank", port.name, port.rank),
                        choices: vec![],
                    });
                }
                return Some(ResolvedSource {
                    source,
                    target_representation: target_representation.clone(),
                    path,
                    issues: resolution.issues,
                });
            }
        }
    }
    None
}

fn source_output_id(source_id: &SourceId) -> String {
    format!("src:{source_id}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapter::AdapterRegistrySpec;
    use crate::ids::{RepresentationId, SourceId, TypeId};
    use crate::plan::DataPlan;

    fn load_schema() -> DatasetSchema {
        serde_json::from_str(include_str!(
            "../../../examples/fixtures/oof_campaign/schema_nir_6_samples.json"
        ))
        .unwrap()
    }

    fn load_model_input() -> ModelInputSpec {
        serde_json::from_str(include_str!(
            "../../../examples/fixtures/oof_campaign/model_input_tabular_numeric.json"
        ))
        .unwrap()
    }

    fn load_registry() -> AdapterRegistry {
        let spec: AdapterRegistrySpec = serde_json::from_str(include_str!(
            "../../../examples/fixtures/oof_campaign/adapter_registry_signal_to_tabular.json"
        ))
        .unwrap();
        AdapterRegistry::from_spec(spec).unwrap()
    }

    #[test]
    fn fixture_plan_matches_expected_json() {
        let plan = plan_model_input(
            &load_schema(),
            &load_model_input(),
            &load_registry(),
            &DataPlanRequest {
                id: "nir-to-tabular".to_string(),
                source_ids: Some(vec![SourceId::new("nir").unwrap()]),
                planning_policy: PlanningPolicy::default(),
            },
        )
        .unwrap();
        let expected: DataPlan = serde_json::from_str(include_str!(
            "../../../examples/fixtures/oof_campaign/expected_data_plan_nir_to_tabular.json"
        ))
        .unwrap();

        assert_eq!(plan, expected);
    }

    #[test]
    fn planner_refuses_missing_required_port_source() {
        let err = plan_model_input(
            &load_schema(),
            &load_model_input(),
            &load_registry(),
            &DataPlanRequest {
                id: "missing-source".to_string(),
                source_ids: Some(vec![SourceId::new("other").unwrap()]),
                planning_policy: PlanningPolicy::default(),
            },
        )
        .unwrap_err();

        assert!(err.to_string().contains("unknown source"));
    }

    #[test]
    fn planner_checks_target_rank_after_adaptation() {
        let mut model = load_model_input();
        model.ports[0].rank = Some(999);
        assert!(plan_model_input(
            &load_schema(),
            &model,
            &load_registry(),
            &DataPlanRequest::new("rank")
        )
        .is_err());
        model.ports[0].rank = Some(2);
        assert!(plan_model_input(
            &load_schema(),
            &model,
            &load_registry(),
            &DataPlanRequest::new("rank")
        )
        .unwrap()
        .issues
        .is_empty());
    }

    #[test]
    fn planner_keeps_each_ports_representation_independent() {
        let schema = load_schema();
        let mut model = load_model_input();
        let source = &schema.sources[0];
        model.ports.insert(
            0,
            crate::InputPortSpec {
                name: "raw".into(),
                accepted_representations: vec![source.native_representation.id.clone()],
                accepted_types: vec![source.type_id.clone()],
                rank: source.native_representation.rank,
                multi_source: false,
                optional: false,
            },
        );
        let plan = plan_model_input(
            &schema,
            &model,
            &load_registry(),
            &DataPlanRequest::new("multi-port"),
        )
        .unwrap();
        plan.validate().unwrap();
        let ports: Vec<_> = plan
            .steps
            .iter()
            .filter(|step| step.kind == DataPlanStepKind::Join)
            .collect();
        assert_ne!(
            ports[0].output_representation,
            ports[1].output_representation
        );
        for port in ports {
            assert_eq!(port.input_representation, port.output_representation);
        }
    }

    #[test]
    fn planner_preserves_ambiguous_adapter_choices() {
        let mut spec: AdapterRegistrySpec = serde_json::from_str(include_str!(
            "../../../examples/fixtures/oof_campaign/adapter_registry_signal_to_tabular.json"
        ))
        .unwrap();
        let mut duplicate = spec.adapters[0].clone();
        duplicate.id.push_str("_alternative");
        spec.adapters.push(duplicate);
        let registry = AdapterRegistry::from_spec(spec).unwrap();
        let plan = plan_model_input(
            &load_schema(),
            &load_model_input(),
            &registry,
            &DataPlanRequest::new("ambiguous"),
        )
        .unwrap();
        assert!(plan.requires_user_choice());
        let issue = plan
            .issues
            .iter()
            .find(|issue| issue.code == "ambiguous_path")
            .unwrap();
        assert_eq!(issue.choices.len(), 2);
    }

    #[test]
    fn planner_emits_alignment_step_for_multi_source_port() {
        let mut schema = load_schema();
        let mut chem = schema.sources[0].clone();
        chem.id = SourceId::new("chem").unwrap();
        chem.name = "Chemistry".to_string();
        chem.type_id = TypeId::new("table").unwrap();
        chem.native_representation.id = RepresentationId::new("tabular_numeric").unwrap();
        chem.native_representation.type_id = TypeId::new("table").unwrap();
        chem.native_representation.container = "dataframe".to_string();
        schema.sources.push(chem);

        let plan = plan_model_input(
            &schema,
            &load_model_input(),
            &load_registry(),
            &DataPlanRequest {
                id: "nir-chem-to-tabular".to_string(),
                source_ids: Some(vec![
                    SourceId::new("nir").unwrap(),
                    SourceId::new("chem").unwrap(),
                ]),
                planning_policy: PlanningPolicy::default(),
            },
        )
        .unwrap();

        let align = plan
            .steps
            .iter()
            .find(|step| step.kind == DataPlanStepKind::Align)
            .expect("multi-source plan should expose an Align step");
        assert_eq!(align.metadata["alignment"], serde_json::json!("left"));
        assert_eq!(align.metadata["output"], serde_json::json!("step:align:0"));
        assert_eq!(
            align.metadata["inputs"].as_array().unwrap().len(),
            2,
            "alignment should receive both source feature streams"
        );

        let join = plan
            .steps
            .iter()
            .find(|step| step.kind == DataPlanStepKind::Join)
            .unwrap();
        assert_eq!(join.metadata["inputs"], serde_json::json!(["step:align:0"]));
    }
}

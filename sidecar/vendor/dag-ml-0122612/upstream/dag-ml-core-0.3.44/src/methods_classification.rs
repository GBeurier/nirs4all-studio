//! Signed class identities for the additive Methods structural profile.
//! No features or fitting enter this module: only labels, folds and predictions.
use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    DagMlError, ExecutionPlan, NodeId, PredictionBlock, PredictionPartition, Result, SampleId,
};

pub const METHODS_RAW_CLASSIFIER: &str = "N4mMultimodalClassifierPipeline";
pub const METHODS_META_CLASSIFIER: &str = "N4mRoleClassifierPipeline";
pub const METHODS_CLASSIFIER_METHOD: &str = "models.classification.pls_logistic";

/// Resolve only the declared classifier parameters, conserving immutable metadata.
pub(crate) fn methods_classifier_recipe(
    operator: &Value,
    params: &BTreeMap<String, Value>,
) -> Result<Value> {
    let raw = operator["type"] == METHODS_RAW_CLASSIFIER;
    let keys = operator.as_object().ok_or_else(|| {
        DagMlError::RuntimeValidation("classifier operator must be an object".into())
    })?;
    if keys.len() != 4 || methods_operator_classification(operator)?.is_none() {
        return refuse("closed signed classifier operator required");
    }
    let (mut recipe, allowed) = if raw {
        if !keys.contains_key("recipe") || !keys.contains_key("source_schemas") {
            return refuse("raw classifier lacks source declarations");
        }
        (
            operator["recipe"].clone(),
            BTreeSet::from([
                "recipe",
                "source_schemas",
                "classification",
                "model__n_components",
                "model__max_iter",
            ]),
        )
    } else {
        if !keys.contains_key("steps") || !keys.contains_key("source_order") {
            return refuse("meta classifier lacks signed branch order");
        }
        let order: Vec<String> = serde_json::from_value(operator["source_order"].clone())?;
        if !(2..=4).contains(&order.len())
            || order.iter().collect::<BTreeSet<_>>().len() != order.len()
            || order
                .iter()
                .any(|name| !["nir", "image", "series", "metadata"].contains(&name.as_str()))
        {
            return refuse(
                "meta classifier needs two to four distinct ordered single-source branches",
            );
        }
        let steps = operator["steps"].as_array().ok_or_else(|| {
            DagMlError::RuntimeValidation("classifier steps must be an array".into())
        })?;
        if steps.len() != 1
            || steps[0].as_object().is_none_or(|step| step.len() != 2)
            || steps[0]["methodId"] != METHODS_CLASSIFIER_METHOD
        {
            return refuse("one native PLS-logistic meta step required");
        }
        (
            operator["steps"].clone(),
            BTreeSet::from(["n_components", "max_iter"]),
        )
    };
    if (raw
        && (recipe.as_object().is_none()
            || recipe["model"].as_object().is_none()
            || recipe["model"]["params"].as_object().is_none()))
        || (!raw
            && (recipe.as_array().is_none_or(|steps| steps.is_empty())
                || recipe[0].as_object().is_none()
                || recipe[0]["params"].as_object().is_none()))
    {
        return refuse("classifier recipe parameters must be objects");
    }
    for (name, value) in params {
        if !allowed.contains(name.as_str()) {
            return refuse("unknown effective classifier parameter");
        }
        if ["recipe", "source_schemas", "classification"].contains(&name.as_str()) {
            if operator.get(name) != Some(value) {
                return refuse("immutable classifier declarations differ from signed operator");
            }
        } else if raw {
            recipe["model"]["params"][name.trim_start_matches("model__")] = value.clone();
        } else {
            recipe[0]["params"][name] = value.clone();
        }
    }
    let parameters = if raw {
        &recipe["model"]["params"]
    } else {
        &recipe[0]["params"]
    };
    if parameters.as_object().is_none_or(|p| p.len() != 2)
        || ["n_components", "max_iter"].iter().any(|name| {
            parameters[*name]
                .as_u64()
                .is_none_or(|n| n == 0 || n > i32::MAX as u64)
        })
    {
        return refuse(
            "PLS-logistic requires closed positive integer component and iteration counts",
        );
    }
    if raw {
        if recipe["model"]["method_id"] != METHODS_CLASSIFIER_METHOD
            || recipe["model"]
                .as_object()
                .is_none_or(|head| head.len() != 2)
        {
            return refuse("native raw PLS-logistic head required");
        }
        crate::methods_multimodal::validate_methods_raw_encoder_profile(
            &recipe,
            &operator["source_schemas"],
        )?;
    }
    Ok(recipe)
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MethodsClassVocabulary {
    pub schema_version: u32,
    pub class_labels: Vec<usize>,
    pub label_names: Vec<Value>,
}

fn refuse<T>(message: &str) -> Result<T> {
    Err(DagMlError::RuntimeValidation(message.into()))
}

fn validate_classifier_buffer(rows: u64, columns: u64) -> Result<()> {
    if rows
        .checked_mul(columns)
        .is_none_or(|size| size > 16_777_216)
    {
        return refuse("native classification one-hot or ordered OOF matrix exceeds the closed 16Mi-cell buffer profile");
    }
    Ok(())
}

pub(crate) fn validate_classifier_working_set(
    rows: u64,
    classes: u64,
    components: u64,
) -> Result<()> {
    let dimension = components
        .checked_add(1)
        .ok_or_else(|| DagMlError::RuntimeValidation("classifier design width overflow".into()))?;
    let hessian_width = classes
        .checked_sub(1)
        .and_then(|count| count.checked_mul(dimension))
        .ok_or_else(|| DagMlError::RuntimeValidation("classifier Hessian width overflow".into()))?;
    for (rows, columns) in [
        (rows, classes),
        (rows, dimension),
        (hessian_width, hessian_width),
    ] {
        validate_classifier_buffer(rows, columns).map_err(|_| {
            DagMlError::RuntimeValidation(
                "PLS-logistic working set exceeds the closed 16777216-element matrix limit".into(),
            )
        })?;
    }
    Ok(())
}

/// A signed proposal domain must be bounded before the optimizer is invoked.
fn classifier_component_bound(declaration: &Value) -> Result<u64> {
    let positive = |value: &Value| {
        value
            .as_u64()
            .filter(|count| *count > 0 && *count <= i32::MAX as u64)
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(
                    "classifier component domains require positive int32 values".into(),
                )
            })
    };
    if let Some(values) = declaration.as_array() {
        if values.len() == 3
            && values[0]
                .as_str()
                .is_some_and(|kind| matches!(kind, "int" | "int_log" | "log_int"))
        {
            let low = positive(&values[1])?;
            let high = positive(&values[2])?;
            if low > high {
                return refuse("classifier component domain is reversed");
            }
            return Ok(high);
        }
        if values.len() == 2 && values[0] == "categorical" {
            return classifier_component_bound(&values[1]);
        }
        return values
            .iter()
            .map(positive)
            .collect::<Result<Vec<_>>>()?
            .into_iter()
            .max()
            .ok_or_else(|| {
                DagMlError::RuntimeValidation("empty classifier component domain".into())
            });
    }
    if let Some(object) = declaration.as_object() {
        let kind = match object.get("type") {
            None => "int",
            Some(value) => value.as_str().ok_or_else(|| {
                DagMlError::RuntimeValidation(
                    "classifier component domain type must be text".into(),
                )
            })?,
        };
        if kind == "categorical" {
            return classifier_component_bound(
                object
                    .get("choices")
                    .or_else(|| object.get("values"))
                    .or_else(|| object.get("options"))
                    .ok_or_else(|| {
                        DagMlError::RuntimeValidation("classifier choices missing".into())
                    })?,
            );
        }
        if !matches!(kind, "int" | "int_log" | "log_int") {
            return refuse("classifier component domain is not integral");
        }
        let low = positive(
            object
                .get("low")
                .or_else(|| object.get("min"))
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation("classifier lower bound missing".into())
                })?,
        )?;
        let high = positive(
            object
                .get("high")
                .or_else(|| object.get("max"))
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation("classifier upper bound missing".into())
                })?,
        )?;
        if low > high
            || object
                .get("step")
                .filter(|step| !step.is_null())
                .is_some_and(|step| step.as_u64().is_none_or(|count| count == 0))
        {
            return refuse("classifier component range or step is invalid");
        }
        return Ok(high);
    }
    refuse("classifier component domain is not bounded")
}

pub(crate) fn validate_methods_classifier_search(
    plan: &ExecutionPlan,
    request: &crate::HostHpoSearchRequest,
) -> Result<()> {
    let graphs = match &request.structural_catalogue {
        Some(catalogue) => catalogue
            .entries
            .iter()
            .map(|entry| (&entry.graph, &entry.parameter_bindings, &entry.target_node))
            .collect::<Vec<_>>(),
        None => vec![(
            &plan.graph_plan.graph,
            &request.parameter_bindings,
            &request.target_node,
        )],
    };
    let contains_classifier = graphs.iter().any(|(graph, _, _)| {
        graph.nodes.iter().any(|node| {
            node.operator.as_ref().is_some_and(|operator| {
                matches!(
                    operator.get("type").and_then(Value::as_str),
                    Some(METHODS_RAW_CLASSIFIER | METHODS_META_CLASSIFIER)
                )
            })
        })
    });
    if !contains_classifier {
        return Ok(());
    }
    let rows = plan
        .fold_set
        .as_ref()
        .ok_or_else(|| {
            DagMlError::RuntimeValidation("classifier search requires signed Train scopes".into())
        })?
        .sample_ids
        .len() as u64;
    let space = request
        .optimizer_descriptor
        .get("space")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            DagMlError::RuntimeValidation(
                "classifier search requires signed bounded component domains".into(),
            )
        })?;
    let forced = request
        .optimizer_descriptor
        .get("force_params")
        .filter(|value| !value.is_null())
        .map(|value| {
            value.as_object().ok_or_else(|| {
                DagMlError::RuntimeValidation(
                    "classifier force_params must be a signed object".into(),
                )
            })
        })
        .transpose()?;
    for (graph, bindings, target) in graphs {
        for node in &graph.nodes {
            let Some(operator) = &node.operator else {
                continue;
            };
            let Some(vocabulary) = methods_operator_classification(operator)? else {
                continue;
            };
            let recipe = methods_classifier_recipe(operator, &node.params)?;
            let raw = operator["type"] == METHODS_RAW_CLASSIFIER;
            let local = if raw {
                "model__n_components"
            } else {
                "n_components"
            };
            let mut bound = if raw {
                recipe["model"]["params"]["n_components"].as_u64()
            } else {
                recipe[0]["params"]["n_components"].as_u64()
            }
            .expect("validated classifier parameter");
            let paths = if bindings.is_empty() && &node.id == target {
                vec![local.to_string()]
            } else {
                bindings
                    .iter()
                    .filter(|(_, binding)| {
                        binding.node_id == node.id && binding.param_path == local
                    })
                    .map(|(path, _)| path.clone())
                    .collect::<Vec<_>>()
            };
            for path in paths {
                let declaration = space.get(&path).ok_or_else(|| {
                    DagMlError::RuntimeValidation(format!(
                        "classifier component domain missing for {path}"
                    ))
                })?;
                bound = bound.max(classifier_component_bound(declaration)?);
                if let Some(value) = forced.and_then(|values| values.get(&path)) {
                    let count = value
                        .as_u64()
                        .filter(|count| *count > 0 && *count <= i32::MAX as u64)
                        .ok_or_else(|| {
                            DagMlError::RuntimeValidation(
                                "classifier forced component count must be positive int32".into(),
                            )
                        })?;
                    bound = bound.max(count);
                }
            }
            validate_classifier_working_set(rows, vocabulary.class_labels.len() as u64, bound)?;
        }
    }
    Ok(())
}

impl MethodsClassVocabulary {
    pub fn validate(&self) -> Result<()> {
        let count = self.class_labels.len();
        if self.schema_version != 1
            || !(2..=65_536).contains(&count)
            || self.class_labels != (0..count).collect::<Vec<_>>()
            || self.label_names.len() != count
        {
            return refuse(
                "Methods classification requires a complete ordered contiguous vocabulary",
            );
        }
        let strings = self
            .label_names
            .iter()
            .all(|v| v.as_str().is_some_and(|s| s.len() <= 1_048_576));
        let integers = self.label_names.iter().all(|v| v.as_i64().is_some());
        if (!strings && !integers)
            || self.label_names.windows(2).any(|pair| {
                if strings {
                    pair[0].as_str() >= pair[1].as_str()
                } else {
                    pair[0].as_i64() >= pair[1].as_i64()
                }
            })
        {
            return refuse(
                "Methods class names must be sorted unique homogeneous strings or int64 values",
            );
        }
        Ok(())
    }

    pub fn probability_names(&self) -> Vec<String> {
        self.class_labels
            .iter()
            .map(|id| format!("class:{id}"))
            .collect()
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ClassificationTargets {
    schema_version: u32,
    class_labels: Vec<usize>,
    label_names: Vec<Value>,
    sample_labels: BTreeMap<SampleId, usize>,
}

impl ClassificationTargets {
    fn vocabulary(&self) -> MethodsClassVocabulary {
        MethodsClassVocabulary {
            schema_version: self.schema_version,
            class_labels: self.class_labels.clone(),
            label_names: self.label_names.clone(),
        }
    }
}

pub fn methods_operator_classification(operator: &Value) -> Result<Option<MethodsClassVocabulary>> {
    if !matches!(
        operator.get("type").and_then(Value::as_str),
        Some(METHODS_RAW_CLASSIFIER | METHODS_META_CLASSIFIER)
    ) {
        return Ok(None);
    }
    let vocabulary: MethodsClassVocabulary =
        serde_json::from_value(operator.get("classification").cloned().ok_or_else(|| {
            DagMlError::RuntimeValidation("Methods classifier lacks its signed vocabulary".into())
        })?)?;
    vocabulary.validate()?;
    Ok(Some(vocabulary))
}

pub(crate) fn classification_for_node(
    plan: &ExecutionPlan,
    node: &NodeId,
) -> Result<Option<MethodsClassVocabulary>> {
    plan.graph_plan
        .graph
        .nodes
        .iter()
        .find(|n| &n.id == node)
        .and_then(|n| n.operator.as_ref())
        .map(methods_operator_classification)
        .transpose()
        .map(Option::flatten)
}

pub(crate) fn classifier_input_nodes(plan: &ExecutionPlan, node: &NodeId) -> Result<Vec<NodeId>> {
    let operator = plan
        .graph_plan
        .graph
        .nodes
        .iter()
        .find(|n| &n.id == node)
        .and_then(|n| n.operator.as_ref())
        .ok_or_else(|| DagMlError::RuntimeValidation("classifier meta operator missing".into()))?;
    let vocabulary = methods_operator_classification(operator)?
        .ok_or_else(|| DagMlError::RuntimeValidation("classifier vocabulary missing".into()))?;
    let order: Vec<String> = serde_json::from_value(operator["source_order"].clone())?;
    let edges = plan
        .graph_plan
        .graph
        .edges
        .iter()
        .filter(|edge| &edge.target.node_id == node)
        .collect::<Vec<_>>();
    if edges.len() != order.len() || !plan.node_plans[node].data_bindings.is_empty() {
        return refuse(
            "classifier meta accepts only its ordered OOF probability branches, never raw views",
        );
    }
    let mut sources = BTreeMap::new();
    for edge in edges {
        let raw = plan
            .graph_plan
            .graph
            .nodes
            .iter()
            .find(|n| n.id == edge.source.node_id)
            .and_then(|n| n.operator.as_ref())
            .ok_or_else(|| {
                DagMlError::RuntimeValidation("classifier base operator missing".into())
            })?;
        let names = raw["recipe"]["source_order"].as_array().ok_or_else(|| {
            DagMlError::RuntimeValidation("classifier branch declaration missing".into())
        })?;
        if raw["type"] != METHODS_RAW_CLASSIFIER
            || !edge.contract.requires_oof
            || edge.source.port_name != "probabilities"
            || methods_operator_classification(raw)?.as_ref() != Some(&vocabulary)
            || names.len() != 1
        {
            return refuse("classifier meta requires class-identical single-source native probability OOF edges");
        }
        let name = names[0].as_str().ok_or_else(|| {
            DagMlError::RuntimeValidation("classifier branch name must be text".into())
        })?;
        if sources
            .insert(name.to_string(), edge.source.node_id.clone())
            .is_some()
        {
            return refuse("classifier source branches must be distinct");
        }
    }
    order
        .iter()
        .map(|source| {
            sources.remove(source).ok_or_else(|| {
                DagMlError::RuntimeValidation(
                    "classifier source order differs from signed incoming branches".into(),
                )
            })
        })
        .collect()
}

/// All scopes come from the native plan, including independent full-REFIT OOF.
/// A caller cannot make a deficient inner scope valid by supplying a flat outer scope.
pub(crate) fn validate_methods_classification_plan(plan: &ExecutionPlan) -> Result<()> {
    let classifiers = plan
        .graph_plan
        .graph
        .nodes
        .iter()
        .filter_map(|node| {
            node.operator
                .as_ref()
                .filter(|op| {
                    matches!(
                        op.get("type").and_then(Value::as_str),
                        Some(METHODS_RAW_CLASSIFIER | METHODS_META_CLASSIFIER)
                    )
                })
                .map(|op| (node, op))
        })
        .collect::<Vec<_>>();
    let evidence = plan.graph_plan.graph.metadata.get("classification_targets");
    if classifiers.is_empty() {
        if evidence.is_some() {
            return refuse("classification targets require active signed Methods classifiers");
        }
        return Ok(());
    }
    let targets: ClassificationTargets =
        serde_json::from_value(evidence.cloned().ok_or_else(|| {
            DagMlError::RuntimeValidation(
                "Methods classifiers require signed train-only class targets".into(),
            )
        })?)?;
    let vocabulary = targets.vocabulary();
    vocabulary.validate()?;
    let folds = plan.fold_set.as_ref().ok_or_else(|| {
        DagMlError::RuntimeValidation("Methods classification requires native grouped folds".into())
    })?;
    if folds.sample_groups.keys().collect::<BTreeSet<_>>()
        != folds.sample_ids.iter().collect::<BTreeSet<_>>()
        || targets.sample_labels.keys().collect::<BTreeSet<_>>()
            != folds.sample_ids.iter().collect::<BTreeSet<_>>()
        || targets
            .sample_labels
            .values()
            .any(|id| !vocabulary.class_labels.contains(id))
    {
        return refuse("classification target evidence must exactly cover the signed Train universe, never Test");
    }
    let nested = crate::runtime::nested_stacking_campaign_plans(plan)?;
    for (node, operator) in classifiers {
        if methods_operator_classification(operator)?.as_ref() != Some(&vocabulary) {
            return refuse("classifier vocabulary differs from signed train-only targets");
        }
        let raw = operator["type"] == METHODS_RAW_CLASSIFIER;
        let node_plan = &plan.node_plans[&node.id];
        let owner = if raw {
            "controller:methods.python.multimodal.classification"
        } else {
            "controller:methods.python.classification"
        };
        if node_plan.controller_id.as_str() != owner {
            return refuse("classifier profile requires its exact implemented native Python owner");
        }
        let features = if raw {
            let source_ids = node_plan
                .data_bindings
                .iter()
                .flat_map(|binding| binding.source_ids.iter().map(String::as_str))
                .collect::<BTreeSet<_>>();
            if source_ids.len() != 4 {
                return refuse(
                    "every classifier raw branch must sign all four raw source identities",
                );
            }
            operator["recipe"]["source_order"]
                .as_array()
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation("raw classifier source order missing".into())
                })?
                .iter()
                .try_fold(0_u64, |width, name| {
                    let source = name.as_str().ok_or_else(|| {
                        DagMlError::RuntimeValidation("raw classifier source name missing".into())
                    })?;
                    let count = match source {
                        "metadata" => 2,
                        "image" | "series" => operator["recipe"]["encoders"][source]
                            ["n_components"]
                            .as_u64()
                            .ok_or_else(|| {
                                DagMlError::RuntimeValidation("classifier PCA count missing".into())
                            })?,
                        _ => operator["source_schemas"][source]["input_shape"]
                            .as_array()
                            .ok_or_else(|| {
                                DagMlError::RuntimeValidation(
                                    "classifier source shape missing".into(),
                                )
                            })?
                            .iter()
                            .try_fold(1_u64, |n, size| {
                                n.checked_mul(size.as_u64().unwrap_or(0)).ok_or_else(|| {
                                    DagMlError::RuntimeValidation(
                                        "classifier feature width overflow".into(),
                                    )
                                })
                            })?,
                    };
                    width.checked_add(count).ok_or_else(|| {
                        DagMlError::RuntimeValidation("classifier feature width overflow".into())
                    })
                })?
        } else {
            classifier_input_nodes(plan, &node.id)?.len() as u64
                * vocabulary.class_labels.len() as u64
        };
        let mut effective_parameters = node_plan.params.clone();
        for variant in &plan.variants {
            let candidate = crate::VariantExecutionSpec::from_plan(variant)
                .effective_params_for_node(&node.id, &node_plan.params)?;
            let candidate_recipe = methods_classifier_recipe(operator, &candidate)?;
            let current_recipe = methods_classifier_recipe(operator, &effective_parameters)?;
            let count = |recipe: &Value| {
                if raw {
                    recipe["model"]["params"]["n_components"].as_u64()
                } else {
                    recipe[0]["params"]["n_components"].as_u64()
                }
            };
            if count(&candidate_recipe) > count(&current_recipe) {
                effective_parameters = candidate;
            }
        }
        let recipe = methods_classifier_recipe(operator, &effective_parameters)?;
        let parameters = if raw {
            &recipe["model"]["params"]
        } else {
            &recipe[0]["params"]
        };
        let method = if raw {
            &operator["recipe"]["model"]["method_id"]
        } else {
            &operator["steps"][0]["methodId"]
        };
        let prefix = if raw { "model__" } else { "" };
        let effective = |name: &str| {
            effective_parameters
                .get(&format!("{prefix}{name}"))
                .unwrap_or(&parameters[name])
                .as_u64()
                .filter(|n| *n > 0)
        };
        if effective("n_components").is_some_and(|count| count > features) {
            return refuse(
                "PLS-logistic components exceed the declared guaranteed encoded feature width",
            );
        }
        if method != METHODS_CLASSIFIER_METHOD
            || !parameters.is_object()
            || parameters.as_object().is_none_or(|p| p.len() != 2)
            || effective("n_components").is_none()
            || effective("max_iter").is_none_or(|n| n > i32::MAX as u64)
        {
            return refuse("closed positive integer PLS-logistic classifier parameters required");
        }
        let mut scopes = vec![folds.sample_ids.as_slice()];
        scopes.extend(
            folds
                .folds
                .iter()
                .map(|fold| fold.train_sample_ids.as_slice()),
        );
        for campaign in nested
            .iter()
            .filter(|campaign| campaign.base_node_ids.contains(&node.id))
        {
            for outer in &campaign.outer_scopes {
                scopes.extend(
                    outer
                        .inner
                        .inner_fold_set
                        .folds
                        .iter()
                        .map(|fold| fold.train_sample_ids.as_slice()),
                );
            }
            if let Some(refit) = &campaign.refit_fold_set {
                scopes.extend(
                    refit
                        .folds
                        .iter()
                        .map(|fold| fold.train_sample_ids.as_slice()),
                );
            }
        }
        for samples in scopes {
            let columns = if raw {
                vocabulary.class_labels.len() as u64
            } else {
                features
            };
            validate_classifier_buffer(samples.len() as u64, columns)?;
            validate_classifier_working_set(
                samples.len() as u64,
                vocabulary.class_labels.len() as u64,
                effective("n_components").expect("validated classifier parameter"),
            )?;
            let classes = samples
                .iter()
                .filter_map(|sample| targets.sample_labels.get(sample))
                .copied()
                .collect::<BTreeSet<_>>();
            if classes != vocabulary.class_labels.iter().copied().collect() {
                return refuse("native classifier training scope is missing a declared class");
            }
            if effective("n_components").is_some_and(|count| count >= samples.len() as u64) {
                return refuse("PLS-logistic components exceed a native training scope");
            }
            if raw {
                for source in ["image", "series"] {
                    if recipe["encoders"].get(source).is_some_and(|encoder| {
                        encoder["n_components"]
                            .as_u64()
                            .is_none_or(|count| count > samples.len() as u64)
                    }) {
                        return refuse(
                            "classifier encoder PCA count exceeds a native training scope",
                        );
                    }
                }
            }
        }
    }
    Ok(())
}

pub(crate) fn validate_methods_classification_block(
    plan: &ExecutionPlan,
    block: &PredictionBlock,
) -> Result<()> {
    let Some(vocabulary) = classification_for_node(plan, &block.producer_node)? else {
        return Ok(());
    };
    block.validate_shape()?;
    match block.producer_port.as_deref() {
        Some("y_hat") if block.target_names == ["y"] => {
            if block.values.iter().any(|row| row.len() != 1 || row[0].fract() != 0.0 || row[0] < 0.0 || row[0] >= vocabulary.class_labels.len() as f64) {
                return refuse("class-label output is outside its signed vocabulary");
            }
        }
        Some("probabilities") if block.target_names == vocabulary.probability_names() => {
            if block.values.iter().any(|row| row.len() != vocabulary.class_labels.len() || row.iter().any(|p| !p.is_finite() || !(0.0..=1.0).contains(p)) || (row.iter().sum::<f64>() - 1.0).abs() > 1e-6) {
                return refuse("signed class probability columns require complete normalized distributions");
            }
        }
        _ => return refuse("classifier prediction port or ordered class-column identity differs from its signed declaration"),
    }
    Ok(())
}

/// Validate complete paired label/distribution surfaces before persistence or OOF joins.
pub(crate) fn validate_methods_classification_result(
    plan: &ExecutionPlan,
    task: &crate::NodeTask,
    result: &crate::NodeResult,
) -> Result<()> {
    let Some(vocabulary) = classification_for_node(plan, &result.node_id)? else {
        return Ok(());
    };
    let targets: ClassificationTargets =
        serde_json::from_value(plan.graph_plan.graph.metadata["classification_targets"].clone())?;
    for target in &result.regression_targets {
        target.validate_shape()?;
        if target.target_names != ["y"]
            || target.level != crate::PredictionLevel::Sample
            || target.validity_masks.is_some()
        {
            return refuse("classifier targets require complete observed sample-level class IDs");
        }
        for (unit, values) in target.unit_ids.iter().zip(&target.values) {
            let crate::PredictionUnitId::Sample(sample) = unit else {
                return refuse("classifier target unit must be a sample");
            };
            if values.len() != 1
                || !values[0].is_finite()
                || values[0].fract() != 0.0
                || values[0] < 0.0
                || values[0] >= vocabulary.class_labels.len() as f64
                || targets
                    .sample_labels
                    .get(sample)
                    .is_some_and(|signed| values[0] != *signed as f64)
                || !result.predictions.iter().any(|block| {
                    block.producer_port.as_deref() == Some("y_hat")
                        && block.sample_ids.contains(sample)
                })
            {
                return refuse("classifier target differs from signed training label or genuine prediction scope");
            }
        }
    }
    if result.predictions.is_empty() {
        let meta = plan
            .graph_plan
            .graph
            .nodes
            .iter()
            .find(|n| n.id == result.node_id)
            .and_then(|n| n.operator.as_ref())
            .is_some_and(|op| op["type"] == METHODS_META_CLASSIFIER);
        if task.phase != crate::Phase::Refit
            || !meta
            || result.artifacts.len() != 1
            || !result.classification_probabilities.is_empty()
            || !result.regression_targets.is_empty()
        {
            return refuse(
                "only a selected OOF classifier REFIT may have an artifact-only surface",
            );
        }
        return Ok(());
    }
    for block in &result.predictions {
        validate_methods_classification_block(plan, block)?;
        if block.producer_port.as_deref() != Some("y_hat") {
            continue;
        }
        let paired = result
            .predictions
            .iter()
            .filter(|p| {
                p.producer_port.as_deref() == Some("probabilities")
                    && p.partition == block.partition
                    && p.fold_id == block.fold_id
            })
            .collect::<Vec<_>>();
        if paired.len() != 1 || paired[0].sample_ids != block.sample_ids {
            return refuse(
                "classifier labels need one distribution with exact ordered sample scope",
            );
        }
        for (label, distribution) in block.values.iter().zip(&paired[0].values) {
            let best = distribution
                .iter()
                .enumerate()
                .max_by(|a, b| a.1.total_cmp(b.1).then_with(|| b.0.cmp(&a.0)))
                .map(|(i, _)| i)
                .expect("validated distribution");
            if label[0] != best as f64 {
                return refuse("class-label output differs from the signed probability argmax");
            }
        }
        if matches!(
            block.partition,
            PredictionPartition::Validation | PredictionPartition::Test
        ) && task.phase != crate::Phase::Predict
        {
            let evidence = result
                .classification_probabilities
                .iter()
                .filter(|p| {
                    p.producer_port.as_deref() == Some("y_hat")
                        && p.partition == block.partition
                        && p.fold_id == block.fold_id
                })
                .collect::<Vec<_>>();
            if evidence.len() != 1
                || evidence[0].sample_ids != block.sample_ids
                || evidence[0].class_labels
                    != vocabulary
                        .class_labels
                        .iter()
                        .map(|id| *id as f64)
                        .collect::<Vec<_>>()
                || evidence[0].values != paired[0].values
            {
                return refuse("class score evidence must exactly attest the signed distribution and class order");
            }
        }
    }
    for distribution in result
        .predictions
        .iter()
        .filter(|p| p.producer_port.as_deref() == Some("probabilities"))
    {
        if result
            .predictions
            .iter()
            .filter(|p| {
                p.producer_port.as_deref() == Some("y_hat")
                    && p.partition == distribution.partition
                    && p.fold_id == distribution.fold_id
            })
            .count()
            != 1
        {
            return refuse("orphan classification probability surface");
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "methods_classification_tests.rs"]
mod tests;

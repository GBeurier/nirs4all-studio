// Auto-split from the former monolithic `runtime.rs` (pure refactor).
use super::*;

pub(crate) const SCORE_METRICS: &[RegressionMetricKind] = &[
    RegressionMetricKind::Mse,
    RegressionMetricKind::Rmse,
    RegressionMetricKind::Mae,
    RegressionMetricKind::R2,
    RegressionMetricKind::Accuracy,
    RegressionMetricKind::BalancedAccuracy,
];

/// Resolve the aggregation contracts that must run after all CV folds have emitted their OOF
/// rows.  A `Target` or `Group` unit is allowed to span folds; aggregating it inside an individual
/// fold would make the score depend on the splitter rather than on the declared semantic unit.
///
/// This is generic runtime machinery.  Hosts only attest relations and choose an existing
/// aggregation policy; no host-side reducer or domain-specific grouping is involved.
pub(crate) fn global_oof_aggregation_specs(
    plan: &ExecutionPlan,
    data_provider: &dyn RuntimeDataProvider,
) -> Result<BTreeMap<NodeId, GlobalOofAggregationSpec>> {
    let mut specs = BTreeMap::new();
    let resources = PhaseScopeResources {
        data_provider: Some(data_provider),
        ..Default::default()
    };
    for (node_id, node_plan) in &plan.node_plans {
        let Some(shape_plan) = &node_plan.shape_plan else {
            continue;
        };
        let policy = &shape_plan.aggregation_policy;
        if matches!(
            policy.aggregation_level,
            PredictionLevel::Observation | PredictionLevel::Sample
        ) || policy.selection_metric_level != policy.aggregation_level
        {
            continue;
        }
        policy.validate()?;
        let relations = coordinator_relations_for_node(node_plan, &resources)?.ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "node `{node_id}` declares global {:?} aggregation but has no relation-attested data binding",
                policy.aggregation_level
            ))
        })?;
        let actual_fingerprint = crate::relation::relation_set_fingerprint(&relations)?;
        for binding in &node_plan.data_bindings {
            if (binding.require_relations || binding.relation_fingerprint.is_some())
                && binding.relation_fingerprint.as_deref() != Some(actual_fingerprint.as_str())
            {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{node_id}` global OOF aggregation relation fingerprint does not match binding `{}`",
                    binding.input_name
                )));
            }
        }
        specs.insert(
            node_id.clone(),
            GlobalOofAggregationSpec {
                policy: policy.clone(),
                relations,
            },
        );
    }
    Ok(specs)
}

/// Add target/group OOF reports after the normal sample-level OOF average has been reassembled.
/// The input average is already identity-checked across folds.  Ground truth is then collapsed only
/// when every member of an aggregate unit has the exact same target vector; averaging or voting
/// labels would be a data transformation, not an attested scoring operation, so it is refused.
pub(crate) fn apply_global_oof_aggregation(
    mut outcome: crate::metrics::CrossFoldValidation,
    specs: &BTreeMap<NodeId, GlobalOofAggregationSpec>,
) -> Result<crate::metrics::CrossFoldValidation> {
    if specs.is_empty() {
        return Ok(outcome);
    }
    let sample_averages = outcome.oof_averages.clone();
    for average in sample_averages {
        if average.predictions.level != PredictionLevel::Sample {
            continue;
        }
        let Some(spec) = specs.get(&average.predictions.producer_node) else {
            continue;
        };
        let sample_ids = average
            .predictions
            .unit_ids
            .iter()
            .map(|unit| match unit {
                PredictionUnitId::Sample(sample_id) => Ok(sample_id.clone()),
                _ => Err(DagMlError::OofValidation(format!(
                    "global OOF average for `{}` is not sample keyed",
                    average.predictions.producer_node
                ))),
            })
            .collect::<Result<Vec<_>>>()?;
        let sample_block = PredictionBlock {
            prediction_id: average.predictions.prediction_id.clone(),
            producer_node: average.predictions.producer_node.clone(),
            producer_port: average.predictions.producer_port.clone(),
            partition: average.predictions.partition.clone(),
            fold_id: average.predictions.fold_id.clone(),
            sample_ids,
            values: average.predictions.values.clone(),
            target_names: average.predictions.target_names.clone(),
        };
        let requested_unit_order = requested_unit_order_for_sample_block(
            spec.policy.aggregation_level,
            &spec.relations,
            &sample_block,
        )?;
        let aggregated = aggregate_sample_predictions_by_unit(
            &sample_block,
            &spec.relations,
            &spec.policy,
            &requested_unit_order,
        )?;
        let targets = aggregate_oof_targets_by_unit(
            &average.y_true,
            &sample_block.sample_ids,
            &spec.relations,
            spec.policy.aggregation_level,
            &requested_unit_order,
        )?;
        outcome.reports.push(score_regression_aggregated_block(
            &aggregated,
            &targets,
            SCORE_METRICS,
        )?);
        outcome.oof_averages.push(OofAverageBlock {
            predictions: aggregated,
            y_true: targets,
        });
    }
    Ok(outcome)
}

fn aggregate_oof_targets_by_unit(
    sample_targets: &RegressionTargetBlock,
    sample_ids: &[SampleId],
    relations: &SampleRelationSet,
    level: PredictionLevel,
    requested_unit_order: &[PredictionUnitId],
) -> Result<RegressionTargetBlock> {
    if sample_targets.level != PredictionLevel::Sample {
        return Err(DagMlError::OofValidation(
            "global OOF aggregation requires sample-level ground truth".to_string(),
        ));
    }
    let mut target_by_sample = BTreeMap::<SampleId, Vec<f64>>::new();
    for (unit, values) in sample_targets.unit_ids.iter().zip(&sample_targets.values) {
        let PredictionUnitId::Sample(sample_id) = unit else {
            return Err(DagMlError::OofValidation(
                "sample-level OOF ground truth contains a non-sample unit".to_string(),
            ));
        };
        if target_by_sample
            .insert(sample_id.clone(), values.clone())
            .is_some()
        {
            return Err(DagMlError::OofValidation(format!(
                "sample-level OOF ground truth duplicates sample `{sample_id}`"
            )));
        }
    }

    let mut target_by_unit = BTreeMap::<PredictionUnitId, Vec<f64>>::new();
    for sample_id in sample_ids {
        let values = target_by_sample.get(sample_id).ok_or_else(|| {
            DagMlError::OofValidation(format!(
                "global OOF aggregation is missing ground truth for sample `{sample_id}`"
            ))
        })?;
        let unit = aggregation_unit_for_sample(level, relations, sample_id)?;
        match target_by_unit.get(&unit) {
            None => {
                target_by_unit.insert(unit, values.clone());
            }
            Some(existing) if existing == values => {}
            Some(_) => {
                return Err(DagMlError::OofValidation(format!(
                    "global OOF aggregate unit `{unit:?}` has conflicting ground truth across member samples"
                )));
            }
        }
    }
    let values = requested_unit_order
        .iter()
        .map(|unit| {
            target_by_unit.get(unit).cloned().ok_or_else(|| {
                DagMlError::OofValidation(format!(
                    "global OOF aggregate unit `{unit:?}` has no member ground truth"
                ))
            })
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(RegressionTargetBlock {
        level,
        unit_ids: requested_unit_order.to_vec(),
        values,
        target_names: sample_targets.target_names.clone(),
    })
}

fn aggregation_unit_for_sample(
    level: PredictionLevel,
    relations: &SampleRelationSet,
    sample_id: &SampleId,
) -> Result<PredictionUnitId> {
    match level {
        PredictionLevel::Sample => Ok(PredictionUnitId::Sample(sample_id.clone())),
        PredictionLevel::Target => relations
            .target_for_sample(sample_id)
            .cloned()
            .map(PredictionUnitId::Target)
            .ok_or_else(|| {
                DagMlError::OofValidation(format!(
                    "sample `{sample_id}` is missing target id for global OOF aggregation"
                ))
            }),
        PredictionLevel::Group => relations
            .group_for_sample(sample_id)
            .cloned()
            .map(PredictionUnitId::Group)
            .ok_or_else(|| {
                DagMlError::OofValidation(format!(
                    "sample `{sample_id}` is missing group id for global OOF aggregation"
                ))
            }),
        PredictionLevel::Observation => Err(DagMlError::OofValidation(
            "global OOF aggregation cannot target observation level".to_string(),
        )),
    }
}

/// True when a Sample-level target block covers EXACTLY the prediction block's samples — the pairing
/// dag-ml's scoring requires (target units == prediction units). Lets one result carry several
/// sample-level blocks (e.g. refit's final-train + final-test), each with its own y_true.
pub(crate) fn sample_targets_match_block(
    block: &PredictionBlock,
    targets: &RegressionTargetBlock,
) -> bool {
    if targets.level != PredictionLevel::Sample || targets.unit_ids.len() != block.sample_ids.len()
    {
        return false;
    }
    let predicted: BTreeSet<&SampleId> = block.sample_ids.iter().collect();
    targets.unit_ids.iter().all(|unit| match unit {
        PredictionUnitId::Sample(sample_id) => predicted.contains(sample_id),
        _ => false,
    })
}

/// Score a result's prediction blocks against the host-supplied `regression_targets` and push the
/// reports into the collector. Native scoring is gated purely on the host emitting targets: a run
/// that emits no `regression_targets` (every existing run) collects nothing, so behavior is
/// unchanged and the campaign fingerprint is untouched. Each Sample prediction block is paired with
/// the target block covering exactly its samples; unmatched blocks are unscored.
pub(crate) fn apply_result_scoring(
    result: &NodeResult,
    collector: &mut Vec<RegressionMetricReport>,
    target_records: &mut Vec<RegressionTargetRecord>,
) -> Result<()> {
    if result.regression_targets.is_empty() {
        return Ok(());
    }
    for block in &result.predictions {
        if let Some(targets) = result
            .regression_targets
            .iter()
            .find(|targets| sample_targets_match_block(block, targets))
        {
            let mut report = score_regression_prediction_block(block, targets, SCORE_METRICS)?;
            report.variant_id = result.lineage.variant_id.clone();
            collector.push(report);
            // Retain y_true (tagged with its variant/fold/partition) so the OOF average can be
            // scored later, per-variant.
            target_records.push(RegressionTargetRecord {
                producer_node: block.producer_node.clone(),
                producer_port: block.producer_port.clone(),
                variant_id: result.lineage.variant_id.clone(),
                partition: block.partition.clone(),
                fold_id: block.fold_id.clone(),
                block: targets.clone(),
            });
        }
    }
    for block in &result.aggregated_predictions {
        if let Some(targets) = result
            .regression_targets
            .iter()
            .find(|targets| targets.level == block.level)
        {
            let mut report = score_regression_aggregated_block(block, targets, SCORE_METRICS)?;
            report.variant_id = result.lineage.variant_id.clone();
            collector.push(report);
        }
    }
    Ok(())
}

pub(crate) fn apply_result_prediction_aggregation(
    plan: &ExecutionPlan,
    controllers: &RuntimeControllerRegistry,
    task: &NodeTask,
    result: &mut NodeResult,
    resources: &PhaseScopeResources<'_>,
) -> Result<()> {
    let has_observation_predictions = !result.observation_predictions.is_empty();
    let has_sample_predictions = !result.predictions.is_empty();
    if !has_observation_predictions && !has_sample_predictions {
        return Ok(());
    }
    let Some(shape_plan) = &task.node_plan.shape_plan else {
        if !has_observation_predictions {
            return Ok(());
        }
        return Err(DagMlError::RuntimeValidation(format!(
            "node `{}` emitted observation predictions but has no data/model shape plan for aggregation",
            task.node_plan.node_id
        )));
    };
    let policy = &shape_plan.aggregation_policy;
    if !policy.store_aggregated_predictions {
        return Ok(());
    }
    if policy.aggregation_level == PredictionLevel::Observation {
        return Ok(());
    }
    if !has_observation_predictions && policy.aggregation_level == PredictionLevel::Sample {
        return Ok(());
    }

    let mut derived_sample_blocks = Vec::new();
    if !result.observation_predictions.is_empty() {
        let relations = coordinator_relations_for_task(task, resources)?;
        let sample_policy = observation_to_sample_policy(policy);
        for block in result.observation_predictions.clone() {
            let requested_sample_order =
                requested_sample_order_for_observation_block(plan, task, &block, &relations)?;
            let sample_block =
                if sample_policy.method == crate::policy::AggregationMethod::CustomController {
                    dispatch_custom_observation_aggregation(
                        plan,
                        controllers,
                        aggregation_task_id(
                            task,
                            &block.producer_node,
                            block.fold_id.as_ref(),
                            "obs_to_sample",
                        ),
                        block,
                        relations.clone(),
                        sample_policy.clone(),
                        requested_sample_order,
                    )?
                } else {
                    aggregate_observation_predictions(
                        &block,
                        &relations,
                        &sample_policy,
                        &requested_sample_order,
                    )?
                };
            derived_sample_blocks.push(sample_block);
        }
    }

    if policy.aggregation_level == PredictionLevel::Sample {
        result.predictions.extend(derived_sample_blocks);
        result.validate_for_task(task)?;
        return Ok(());
    }

    if !result.aggregated_predictions.is_empty() {
        // The controller emitted aggregated blocks itself, bypassing native
        // aggregation. They must still MATCH the node's aggregation policy
        // level — otherwise a block aggregated at the wrong unit level would be
        // accepted and scored against a mismatched policy.
        for block in &result.aggregated_predictions {
            if block.level != policy.aggregation_level {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` emitted aggregated predictions at level {:?} but its aggregation policy is {:?}",
                    task.node_plan.node_id, block.level, policy.aggregation_level
                )));
            }
        }
        result.validate_for_task(task)?;
        return Ok(());
    }

    let relations = coordinator_relations_for_task(task, resources)?;
    let sample_blocks = result
        .predictions
        .iter()
        .cloned()
        .chain(derived_sample_blocks)
        .collect::<Vec<_>>();
    for block in sample_blocks {
        let requested_unit_order =
            requested_unit_order_for_sample_block(policy.aggregation_level, &relations, &block)?;
        let aggregated = if policy.method == crate::policy::AggregationMethod::CustomController {
            dispatch_custom_sample_aggregation(
                plan,
                controllers,
                aggregation_task_id(
                    task,
                    &block.producer_node,
                    block.fold_id.as_ref(),
                    "sample_to_unit",
                ),
                block,
                relations.clone(),
                policy.clone(),
                requested_unit_order,
            )?
        } else {
            aggregate_sample_predictions_by_unit(&block, &relations, policy, &requested_unit_order)?
        };
        result.aggregated_predictions.push(aggregated);
    }
    result.validate_for_task(task)
}

pub(crate) fn observation_to_sample_policy(policy: &AggregationPolicy) -> AggregationPolicy {
    let mut sample_policy = policy.clone();
    sample_policy.aggregation_level = PredictionLevel::Sample;
    sample_policy
}

pub(crate) fn coordinator_relations_for_task(
    task: &NodeTask,
    resources: &PhaseScopeResources<'_>,
) -> Result<SampleRelationSet> {
    coordinator_relations_for_node(&task.node_plan, resources)?.ok_or_else(|| {
        DagMlError::RuntimeValidation(format!(
            "node `{}` needs coordinator relations for prediction aggregation but no matching data provider/envelope carries relations",
            task.node_plan.node_id
        ))
    })
}

pub(crate) fn coordinator_relations_for_edge(
    plan: &ExecutionPlan,
    edge: &EdgeSpec,
    resources: &PhaseScopeResources<'_>,
) -> Result<SampleRelationSet> {
    let target_plan = plan.node_plans.get(&edge.target.node_id).ok_or_else(|| {
        DagMlError::Planning(format!(
            "OOF edge target node `{}` has no node plan",
            edge.target.node_id
        ))
    })?;
    if let Some(relations) = coordinator_relations_for_node(target_plan, resources)? {
        return Ok(relations);
    }

    let source_plan = plan.node_plans.get(&edge.source.node_id).ok_or_else(|| {
        DagMlError::Planning(format!(
            "OOF edge source node `{}` has no node plan",
            edge.source.node_id
        ))
    })?;
    if let Some(relations) = coordinator_relations_for_node(source_plan, resources)? {
        return Ok(relations);
    }

    Err(DagMlError::RuntimeValidation(format!(
        "edge `{}.{}` -> `{}.{}` needs coordinator relations for aggregated OOF validation but neither endpoint has a relation-carrying data binding",
        edge.source.node_id,
        edge.source.port_name,
        edge.target.node_id,
        edge.target.port_name
    )))
}

pub(crate) fn coordinator_relations_for_node(
    node_plan: &NodePlan,
    resources: &PhaseScopeResources<'_>,
) -> Result<Option<SampleRelationSet>> {
    let mut selected: Option<SampleRelationSet> = None;
    for binding in &node_plan.data_bindings {
        if !binding.require_relations && binding.relation_fingerprint.is_none() {
            continue;
        }
        let relations = if let Some(envelopes) = resources.data_envelopes {
            let key = data_binding_requirement_key(&binding.node_id, &binding.input_name);
            match envelopes.get(&key) {
                Some(envelope) => {
                    binding.validate_envelope(envelope)?;
                    envelope.coordinator_relations.clone()
                }
                None => None,
            }
        } else if let Some(data_provider) = resources.data_provider {
            data_provider.coordinator_relations(binding)?
        } else {
            None
        };
        let Some(relations) = relations else {
            // A binding that REQUIRES relations must resolve them. Silently
            // defaulting to empty exclusions (no excluded samples) would let a
            // leakage / branch / exclusion / aggregation policy run without the
            // relation set it depends on, so refuse instead of degrading.
            if binding.require_relations {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` binding `{}` requires coordinator relations but none were resolved",
                    node_plan.node_id, binding.input_name
                )));
            }
            continue;
        };
        if let Some(previous) = &selected {
            if previous != &relations {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` has multiple non-identical coordinator relation sets",
                    node_plan.node_id
                )));
            }
        } else {
            selected = Some(relations);
        }
    }
    Ok(selected)
}

pub(crate) fn requested_sample_order_for_observation_block(
    plan: &ExecutionPlan,
    task: &NodeTask,
    block: &ObservationPredictionBlock,
    relations: &SampleRelationSet,
) -> Result<Vec<SampleId>> {
    if block.partition == PredictionPartition::Validation {
        if let Some(sample_ids) = validation_view_sample_ids(task) {
            return Ok(sample_ids.into_iter().collect());
        }
        if let (Some(fold_set), Some(fold_id)) = (plan.fold_set.as_ref(), block.fold_id.as_ref()) {
            if let Some(fold) = fold_set.folds.iter().find(|fold| &fold.fold_id == fold_id) {
                return Ok(fold.validation_sample_ids.clone());
            }
        }
    }
    first_seen_samples_for_observations(block, relations)
}

pub(crate) fn first_seen_samples_for_observations(
    block: &ObservationPredictionBlock,
    relations: &SampleRelationSet,
) -> Result<Vec<SampleId>> {
    let mut seen = BTreeSet::new();
    let mut sample_order = Vec::new();
    for observation_id in &block.observation_ids {
        let sample_id = relations
            .sample_for_observation(observation_id)
            .ok_or_else(|| {
                DagMlError::OofValidation(format!(
                    "observation prediction `{observation_id}` has no sample relation"
                ))
            })?;
        if seen.insert(sample_id.clone()) {
            sample_order.push(sample_id.clone());
        }
    }
    Ok(sample_order)
}

pub(crate) fn requested_unit_order_for_sample_block(
    level: PredictionLevel,
    relations: &SampleRelationSet,
    block: &PredictionBlock,
) -> Result<Vec<PredictionUnitId>> {
    let mut seen = BTreeSet::new();
    let mut unit_order = Vec::new();
    for sample_id in &block.sample_ids {
        let unit_id = match level {
            PredictionLevel::Sample => PredictionUnitId::Sample(sample_id.clone()),
            PredictionLevel::Target => relations
                .target_for_sample(sample_id)
                .cloned()
                .map(PredictionUnitId::Target)
                .ok_or_else(|| {
                    DagMlError::OofValidation(format!(
                        "sample `{sample_id}` is missing target id for target aggregation"
                    ))
                })?,
            PredictionLevel::Group => relations
                .group_for_sample(sample_id)
                .cloned()
                .map(PredictionUnitId::Group)
                .ok_or_else(|| {
                    DagMlError::OofValidation(format!(
                        "sample `{sample_id}` is missing group id for group aggregation"
                    ))
                })?,
            PredictionLevel::Observation => {
                return Err(DagMlError::OofValidation(
                    "sample prediction aggregation cannot output observation-level predictions"
                        .to_string(),
                ));
            }
        };
        if seen.insert(unit_id.clone()) {
            unit_order.push(unit_id);
        }
    }
    Ok(unit_order)
}

pub(crate) fn aggregation_task_id(
    task: &NodeTask,
    producer_node: &NodeId,
    fold_id: Option<&FoldId>,
    stage: &str,
) -> String {
    let fold = fold_id
        .map(ToString::to_string)
        .unwrap_or_else(|| "nofold".to_string());
    format!(
        "aggregation:{}:{}:{}:{}:{}",
        task.run_id, task.node_plan.node_id, producer_node, fold, stage
    )
}

#[cfg(test)]
mod global_oof_tests {
    use super::*;
    use crate::aggregation::AggregatedPredictionBlock;
    use crate::ids::{ObservationId, TargetId};
    use crate::metrics::CrossFoldValidation;
    use crate::policy::AggregationMethod;
    use crate::relation::SampleRelation;

    fn sid(value: &str) -> SampleId {
        SampleId::new(value).unwrap()
    }

    fn target(value: &str) -> TargetId {
        TargetId::new(value).unwrap()
    }

    fn average(samples: &[(&str, f64, f64)]) -> OofAverageBlock {
        let sample_ids = samples
            .iter()
            .map(|(sample, _, _)| PredictionUnitId::Sample(sid(sample)))
            .collect::<Vec<_>>();
        OofAverageBlock {
            predictions: AggregatedPredictionBlock {
                prediction_id: Some("pred:model:avg".to_string()),
                producer_node: NodeId::new("model:classifier").unwrap(),
                producer_port: Some("prediction".to_string()),
                partition: PredictionPartition::Validation,
                fold_id: Some(FoldId::new("avg").unwrap()),
                level: PredictionLevel::Sample,
                unit_ids: sample_ids.clone(),
                values: samples
                    .iter()
                    .map(|(_, prediction, _)| vec![*prediction])
                    .collect(),
                target_names: vec!["class".to_string()],
            },
            y_true: RegressionTargetBlock {
                level: PredictionLevel::Sample,
                unit_ids: sample_ids,
                values: samples.iter().map(|(_, _, truth)| vec![*truth]).collect(),
                target_names: vec!["class".to_string()],
            },
        }
    }

    fn target_relations() -> SampleRelationSet {
        let mut first =
            SampleRelation::new(ObservationId::new("obs:fold0:s1").unwrap(), sid("sample:1"));
        first.target_id = Some(target("target:positive"));
        let mut second =
            SampleRelation::new(ObservationId::new("obs:fold1:s2").unwrap(), sid("sample:2"));
        second.target_id = Some(target("target:positive"));
        SampleRelationSet {
            records: vec![first, second],
        }
    }

    #[test]
    fn global_oof_vote_reduces_a_target_after_cross_fold_reassembly() {
        // `sample:1` and `sample:2` intentionally represent validation rows from different
        // folds.  The global step receives their already reassembled OOF rows and emits exactly
        // one target-level score, rather than trying to vote inside either fold.
        let specs = BTreeMap::from([(
            NodeId::new("model:classifier").unwrap(),
            GlobalOofAggregationSpec {
                policy: AggregationPolicy {
                    aggregation_level: PredictionLevel::Target,
                    method: AggregationMethod::Vote,
                    selection_metric_level: PredictionLevel::Target,
                    ..AggregationPolicy::default()
                },
                relations: target_relations(),
            },
        )]);
        let outcome = apply_global_oof_aggregation(
            CrossFoldValidation {
                reports: Vec::new(),
                oof_averages: vec![average(&[("sample:1", 1.0, 1.0), ("sample:2", 1.0, 1.0)])],
            },
            &specs,
        )
        .unwrap();
        assert_eq!(outcome.reports.len(), 1);
        assert_eq!(outcome.reports[0].level, PredictionLevel::Target);
        assert_eq!(outcome.reports[0].row_count, 1);
        assert_eq!(outcome.oof_averages.len(), 2);
        assert_eq!(
            outcome.oof_averages[1].predictions.level,
            PredictionLevel::Target
        );
        assert_eq!(outcome.oof_averages[1].predictions.values, vec![vec![1.0]]);
    }

    #[test]
    fn global_oof_aggregation_refuses_conflicting_truth_inside_one_target() {
        let specs = BTreeMap::from([(
            NodeId::new("model:classifier").unwrap(),
            GlobalOofAggregationSpec {
                policy: AggregationPolicy {
                    aggregation_level: PredictionLevel::Target,
                    method: AggregationMethod::Vote,
                    ..AggregationPolicy::default()
                },
                relations: target_relations(),
            },
        )]);
        let error = apply_global_oof_aggregation(
            CrossFoldValidation {
                reports: Vec::new(),
                oof_averages: vec![average(&[("sample:1", 1.0, 1.0), ("sample:2", 1.0, 2.0)])],
            },
            &specs,
        )
        .unwrap_err()
        .to_string();
        assert!(error.contains("conflicting ground truth"), "{error}");
    }
}

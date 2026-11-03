// Auto-split from the former monolithic `runtime.rs` (pure refactor).
use super::*;

pub(crate) const SCORE_METRICS: &[RegressionMetricKind] = &[
    RegressionMetricKind::Mse,
    RegressionMetricKind::Rmse,
    RegressionMetricKind::Mae,
    RegressionMetricKind::R2,
    RegressionMetricKind::Accuracy,
    RegressionMetricKind::BalancedAccuracy,
    RegressionMetricKind::F1,
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
        let policy = if plan.campaign.aggregation_policy.grouping_key.is_some() {
            if !node_plan
                .controller_capabilities
                .contains(&ControllerCapability::EmitsPredictions)
            {
                continue;
            }
            &plan.campaign.aggregation_policy
        } else {
            let Some(shape_plan) = &node_plan.shape_plan else {
                continue;
            };
            &shape_plan.aggregation_policy
        };
        if matches!(
            policy.aggregation_level,
            PredictionLevel::Observation | PredictionLevel::Sample
        ) || policy.selection_metric_level != policy.aggregation_level
        {
            continue;
        }
        policy.validate()?;
        let mut relations = coordinator_relations_for_node(node_plan, &resources)?;
        if relations.is_none() && policy.grouping_key.is_some() {
            for edge in plan
                .graph_plan
                .graph
                .edges
                .iter()
                .filter(|edge| edge.target.node_id == *node_id)
            {
                if let Some(source) = plan.node_plans.get(&edge.source.node_id) {
                    relations = coordinator_relations_for_node(source, &resources)?;
                    if relations.is_some() {
                        break;
                    }
                }
            }
        }
        let mut relations = relations.ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "node `{node_id}` declares global {:?} aggregation but has no relation-attested data binding",
                policy.aggregation_level
            ))
        })?;
        if let Some(units) = experimental_units(plan)? {
            units.validate_relations(&relations)?;
        }
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
        if let Some(units) = experimental_units(plan)? {
            let mut source_plans = vec![node_plan];
            source_plans.extend(
                plan.graph_plan
                    .graph
                    .edges
                    .iter()
                    .filter(|edge| edge.target.node_id == *node_id)
                    .filter_map(|edge| plan.node_plans.get(&edge.source.node_id)),
            );
            for source in source_plans {
                for binding in &source.data_bindings {
                    if let Some(cohort) = data_provider.cv_test_cohort(binding)? {
                        units.validate_test_cohort(&cohort)?;
                        let ids = cohort.physical_sample_ids.iter().collect::<BTreeSet<_>>();
                        relations
                            .records
                            .retain(|record| !ids.contains(&record.sample_id));
                        relations.records.extend(cohort.relations.records);
                    }
                }
            }
            relations.validate()?;
        }
        specs.insert(
            node_id.clone(),
            GlobalOofAggregationSpec {
                class_labels: experimental_units(plan)?.and_then(|units| units.class_labels()),
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
        if spec.policy.grouping_key.is_some()
            && matches!(
                average.predictions.producer_port.as_deref(),
                Some("proba" | "probabilities")
            )
        {
            continue;
        }
        validate_independent_class_predictions(spec, &average.predictions.values)?;
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
        let requested_unit_order = requested_unit_order_for_sample_block_with_key(
            spec.policy.aggregation_level,
            spec.policy.grouping_key.as_ref(),
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
            spec.policy.grouping_key.as_ref(),
            &requested_unit_order,
        )?;
        let report = if let Some(key) = &spec.policy.grouping_key {
            crate::metrics::score_independent_unit_block(&aggregated, &targets, SCORE_METRICS, key)?
        } else {
            score_regression_aggregated_block(&aggregated, &targets, SCORE_METRICS)?
        };
        outcome.reports.push(report);
        if spec.policy.grouping_key.is_none() {
            outcome.oof_averages.push(OofAverageBlock {
                predictions: aggregated,
                y_true: targets,
            });
        }
    }
    Ok(outcome)
}

fn aggregate_oof_targets_by_unit(
    sample_targets: &RegressionTargetBlock,
    sample_ids: &[SampleId],
    relations: &SampleRelationSet,
    level: PredictionLevel,
    grouping_key: Option<&crate::policy::AggregationGroupingKey>,
    requested_unit_order: &[PredictionUnitId],
) -> Result<RegressionTargetBlock> {
    sample_targets.validate_shape()?;
    if grouping_key.is_none() {
        sample_targets.require_complete_targets("global group/target OOF aggregation")?;
    }
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

    let width = sample_targets.values[0].len();
    let rows = sample_targets
        .unit_ids
        .iter()
        .enumerate()
        .map(|(index, id)| (id, index))
        .collect::<BTreeMap<_, _>>();
    let mut target_by_unit = BTreeMap::<PredictionUnitId, Vec<Option<f64>>>::new();
    let grouping_index = grouping_key
        .filter(|_| level == PredictionLevel::Group && !sample_ids.is_empty())
        .map(|key| key.index(relations))
        .transpose()?;
    for sample_id in sample_ids {
        let values = target_by_sample.get(sample_id).ok_or_else(|| {
            DagMlError::OofValidation(format!("missing ground truth for sample `{sample_id}`"))
        })?;
        let row = rows[&PredictionUnitId::Sample(sample_id.clone())];
        let unit =
            aggregation_unit_for_sample(level, relations, sample_id, grouping_index.as_ref())?;
        let observed = target_by_unit
            .entry(unit)
            .or_insert_with(|| vec![None; width]);
        for column in 0..width {
            if sample_targets
                .validity_masks
                .as_ref()
                .is_none_or(|masks| masks[row][column])
            {
                if observed[column].is_some_and(|previous| previous != values[column]) {
                    return Err(DagMlError::OofValidation(
                        "global OOF aggregate unit has conflicting ground truth".into(),
                    ));
                }
                observed[column] = Some(values[column]);
            }
        }
    }
    let selected = requested_unit_order
        .iter()
        .map(|unit| {
            target_by_unit.get(unit).ok_or_else(|| {
                DagMlError::OofValidation("aggregate unit has no member ground truth".into())
            })
        })
        .collect::<Result<Vec<_>>>()?;
    let partial = selected.iter().any(|row| row.iter().any(Option::is_none));
    Ok(RegressionTargetBlock {
        validity_masks: partial.then(|| {
            selected
                .iter()
                .map(|row| row.iter().map(Option::is_some).collect())
                .collect()
        }),
        level,
        unit_ids: requested_unit_order.to_vec(),
        values: selected
            .iter()
            .map(|row| row.iter().map(|value| value.unwrap_or(0.0)).collect())
            .collect(),
        target_names: sample_targets.target_names.clone(),
    })
}

fn aggregation_unit_for_sample(
    level: PredictionLevel,
    relations: &SampleRelationSet,
    sample_id: &SampleId,
    grouping_index: Option<&crate::policy::AggregationGroupIndex<'_>>,
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
        PredictionLevel::Group if grouping_index.is_some() => grouping_index
            .expect("checked index")
            .group_for_sample(sample_id)
            .map(PredictionUnitId::Group),
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
    auxiliary_ports: &BTreeSet<String>,
    collector: &mut Vec<RegressionMetricReport>,
    target_records: &mut Vec<RegressionTargetRecord>,
) -> Result<()> {
    if result.regression_targets.is_empty() {
        return Ok(());
    }
    for block in &result.predictions {
        // Auxiliary Prediction outputs can be consumed by downstream edges,
        // but cannot contribute an independent score or selection candidate.
        if block
            .producer_port
            .as_ref()
            .is_some_and(|port| auxiliary_ports.contains(port))
        {
            continue;
        }
        if let Some(targets) = result
            .regression_targets
            .iter()
            .find(|targets| sample_targets_match_block(block, targets))
        {
            let probability_blocks = result
                .classification_probabilities
                .iter()
                .filter(|candidate| {
                    candidate.producer_node == block.producer_node
                        && candidate.producer_port == block.producer_port
                        && candidate.partition == block.partition
                        && candidate.fold_id == block.fold_id
                        && candidate.sample_ids.iter().collect::<BTreeSet<_>>()
                            == block.sample_ids.iter().collect::<BTreeSet<_>>()
                })
                .collect::<Vec<_>>();
            if probability_blocks.len() > 1 {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` emitted ambiguous classification probability scores",
                    block.producer_node
                )));
            }
            let mut report = if let Some(probabilities) = probability_blocks.first() {
                score_prediction_with_class_probabilities(
                    block,
                    probabilities,
                    targets,
                    SCORE_METRICS,
                )?
            } else {
                score_regression_prediction_block(block, targets, SCORE_METRICS)?
            };
            report.variant_id = result.lineage.variant_id.clone();
            report.target_domain = result.lineage.target_domain.clone();
            if report.target_domain.is_some() {
                report.metrics.retain(|name, _| {
                    matches!(name.as_str(), "accuracy" | "balanced_accuracy" | "f1")
                });
            }
            collector.push(report);
            // Retain y_true (tagged with its variant/fold/partition) so the OOF average can be
            // scored later, per-variant.
            target_records.push(RegressionTargetRecord {
                producer_node: block.producer_node.clone(),
                producer_port: block.producer_port.clone(),
                variant_id: result.lineage.variant_id.clone(),
                partition: block.partition.clone(),
                fold_id: block.fold_id.clone(),
                block: targets.canonicalized()?,
            });
        }
    }
    for block in &result.aggregated_predictions {
        if block
            .producer_port
            .as_ref()
            .is_some_and(|port| auxiliary_ports.contains(port))
        {
            continue;
        }
        let matching_targets = result
            .regression_targets
            .iter()
            .filter(|targets| {
                targets.level == block.level
                    && (block.target_names.is_empty()
                        || targets.target_names.is_empty()
                        || block.target_names == targets.target_names)
                    && targets.unit_ids.iter().collect::<BTreeSet<_>>()
                        == block.unit_ids.iter().collect::<BTreeSet<_>>()
            })
            .collect::<Vec<_>>();
        if let Some(targets) = matching_targets.first() {
            let canonical = targets.canonicalized()?;
            for candidate in matching_targets.iter().skip(1) {
                if candidate.canonicalized()? != canonical {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "node `{}` emitted ambiguous targets for aggregated predictions",
                        block.producer_node
                    )));
                }
            }
            let mut report = score_regression_aggregated_block(block, targets, SCORE_METRICS)?;
            report.variant_id = result.lineage.variant_id.clone();
            report.target_domain = result.lineage.target_domain.clone();
            if report.target_domain.is_some() {
                report.metrics.retain(|name, _| {
                    matches!(name.as_str(), "accuracy" | "balanced_accuracy" | "f1")
                });
            }
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
    for targets in &result.regression_targets {
        targets.require_complete_targets("prediction aggregation")?;
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
    requested_unit_order_for_sample_block_with_key(level, None, relations, block)
}

pub(crate) fn requested_unit_order_for_sample_block_with_key(
    level: PredictionLevel,
    grouping_key: Option<&crate::policy::AggregationGroupingKey>,
    relations: &SampleRelationSet,
    block: &PredictionBlock,
) -> Result<Vec<PredictionUnitId>> {
    let mut seen = BTreeSet::new();
    let mut unit_order = Vec::new();
    let grouping_index = grouping_key
        .filter(|_| level == PredictionLevel::Group && !block.sample_ids.is_empty())
        .map(|key| key.index(relations))
        .transpose()?;
    for sample_id in &block.sample_ids {
        let unit_id =
            aggregation_unit_for_sample(level, relations, sample_id, grouping_index.as_ref())?;
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
                validity_masks: None,
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
                class_labels: None,
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
                class_labels: None,
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

/// Score real per-fold/Test/REFIT blocks at the explicit statistical grain.
/// These reports do not replace the sample-keyed feature/OOF buffers.
pub(crate) fn apply_independent_unit_scope_reports(
    mut outcome: crate::metrics::CrossFoldValidation,
    specs: &BTreeMap<NodeId, GlobalOofAggregationSpec>,
    blocks: &[PredictionBlock],
    targets: &[RegressionTargetRecord],
) -> Result<crate::metrics::CrossFoldValidation> {
    for block in blocks {
        let Some(spec) = specs.get(&block.producer_node) else {
            continue;
        };
        let Some(key) = &spec.policy.grouping_key else {
            continue;
        };
        if matches!(
            block.producer_port.as_deref(),
            Some("proba" | "probabilities")
        ) {
            continue;
        }
        validate_independent_class_predictions(spec, &block.values)?;
        let records = targets
            .iter()
            .filter(|record| {
                record.producer_node == block.producer_node
                    && record.partition == block.partition
                    && record.fold_id == block.fold_id
                    && (record.producer_port.is_none()
                        || record.producer_port == block.producer_port)
            })
            .collect::<Vec<_>>();
        let Some(record) = records.first() else {
            continue;
        }; // target-free PREDICT is never scored
        if records.iter().any(|other| other.block != record.block) {
            return Err(DagMlError::OofValidation(
                "ambiguous independent-unit target provenance".into(),
            ));
        }
        let order = requested_unit_order_for_sample_block_with_key(
            PredictionLevel::Group,
            Some(key),
            &spec.relations,
            block,
        )?;
        let grouped =
            aggregate_sample_predictions_by_unit(block, &spec.relations, &spec.policy, &order)?;
        let truth = aggregate_oof_targets_by_unit(
            &record.block,
            &block.sample_ids,
            &spec.relations,
            PredictionLevel::Group,
            Some(key),
            &order,
        )?;
        let mut report =
            crate::metrics::score_independent_unit_block(&grouped, &truth, SCORE_METRICS, key)?;
        report.variant_id = record.variant_id.clone();
        outcome.reports.push(report);
    }
    Ok(outcome)
}

#[cfg(test)]
mod independent_unit_score_tests {
    use super::*;
    use crate::aggregation::AggregatedPredictionBlock;
    use crate::ids::{GroupId, ObservationId};
    use crate::policy::{AggregationGroupingKey, AggregationMethod};
    use crate::relation::SampleRelation;

    fn fixture(
        classification: bool,
    ) -> (BTreeMap<NodeId, GlobalOofAggregationSpec>, OofAverageBlock) {
        let node = NodeId::new("model:independent.units").unwrap();
        let samples = (1..=4)
            .map(|index| SampleId::new(format!("s{index}")).unwrap())
            .collect::<Vec<_>>();
        let relations = SampleRelationSet {
            records: samples
                .iter()
                .enumerate()
                .map(|(index, id)| {
                    let mut relation = SampleRelation::new(
                        ObservationId::new(format!("obs{index}")).unwrap(),
                        id.clone(),
                    );
                    relation.group_id = Some(GroupId::new("split_same").unwrap());
                    relation.metadata.insert(
                        "independent_unit_id".into(),
                        serde_json::json!(if index < 3 { "unit_a" } else { "unit_b" }),
                    );
                    relation
                })
                .collect(),
        };
        let policy = AggregationPolicy {
            aggregation_level: PredictionLevel::Group,
            selection_metric_level: PredictionLevel::Group,
            method: if classification {
                AggregationMethod::Vote
            } else {
                AggregationMethod::Mean
            },
            grouping_key: Some(AggregationGroupingKey::RelationMetadata {
                key: "independent_unit_id".into(),
            }),
            ..Default::default()
        };
        let ids = samples
            .into_iter()
            .map(PredictionUnitId::Sample)
            .collect::<Vec<_>>();
        let average = OofAverageBlock {
            predictions: AggregatedPredictionBlock {
                prediction_id: Some("prediction:units".into()),
                producer_node: node.clone(),
                producer_port: Some(if classification { "y_hat" } else { "predict" }.into()),
                partition: PredictionPartition::Validation,
                fold_id: Some(FoldId::new("avg").unwrap()),
                level: PredictionLevel::Sample,
                unit_ids: ids.clone(),
                values: if classification {
                    vec![vec![0.0], vec![1.0], vec![0.0], vec![1.0]]
                } else {
                    vec![vec![1.0], vec![3.0], vec![5.0], vec![9.0]]
                },
                target_names: vec!["y".into()],
            },
            y_true: RegressionTargetBlock {
                level: PredictionLevel::Sample,
                unit_ids: ids,
                values: if classification {
                    vec![vec![0.0], vec![0.0], vec![0.0], vec![1.0]]
                } else {
                    vec![vec![1.0], vec![1.0], vec![1.0], vec![9.0]]
                },
                validity_masks: None,
                target_names: vec!["y".into()],
            },
        };
        (
            BTreeMap::from([(
                node,
                GlobalOofAggregationSpec {
                    class_labels: classification.then_some(vec![0.0, 1.0]),
                    policy,
                    relations,
                },
            )]),
            average,
        )
    }

    #[test]
    fn repeated_observations_score_equal_independent_units_and_keep_sample_features() {
        let (specs, average) = fixture(false);
        let raw = average.clone();
        let outcome = apply_global_oof_aggregation(
            crate::metrics::CrossFoldValidation {
                reports: Vec::new(),
                oof_averages: vec![average],
            },
            &specs,
        )
        .unwrap();
        let report = &outcome.reports[0];
        assert_eq!(report.level, PredictionLevel::Group);
        assert_eq!(report.producer_node, raw.predictions.producer_node);
        assert_eq!(report.producer_port.as_deref(), Some("predict"));
        assert_eq!(report.fold_id.as_ref().unwrap().as_str(), "avg");
        assert_eq!(outcome.oof_averages, vec![raw]);
        assert_eq!(report.row_count, 2);
        assert_eq!(report.metrics["mse"], 2.0); // mean of (mean(1,3,5)-1)^2 and (9-9)^2, not row-wise 5
        assert_eq!(
            report.grouping_key,
            specs.values().next().unwrap().policy.grouping_key
        );
        assert!(specs
            .values()
            .next()
            .unwrap()
            .relations
            .records
            .iter()
            .all(|record| record.group_id.as_ref().unwrap().as_str() == "split_same"));
        assert_eq!(
            report
                .clone()
                .into_candidate_score("candidate")
                .unwrap()
                .metadata["grouping_key"]["key"],
            "independent_unit_id"
        );
    }

    #[test]
    fn classification_votes_real_labels_without_reducing_probability_feature_columns() {
        let (specs, average) = fixture(true);
        let mut probabilities = average.clone();
        probabilities.predictions.producer_port = Some("probabilities".into());
        probabilities.predictions.values = vec![
            vec![0.8, 0.2],
            vec![0.3, 0.7],
            vec![0.9, 0.1],
            vec![0.1, 0.9],
        ];
        probabilities.predictions.target_names = vec!["class:0".into(), "class:1".into()];
        let originals = vec![average, probabilities];
        let outcome = apply_global_oof_aggregation(
            crate::metrics::CrossFoldValidation {
                reports: Vec::new(),
                oof_averages: originals.clone(),
            },
            &specs,
        )
        .unwrap();
        assert_eq!(outcome.oof_averages, originals);
        assert_eq!(outcome.reports.len(), 1);
        assert_eq!(outcome.reports[0].producer_port.as_deref(), Some("y_hat"));
        assert_ne!(
            outcome.reports[0].producer_port.as_deref(),
            Some("probabilities")
        );
        assert_eq!(
            outcome.reports[0].grouping_key,
            specs.values().next().unwrap().policy.grouping_key
        );
        for metric in ["accuracy", "balanced_accuracy", "f1"] {
            assert_eq!(outcome.reports[0].metrics[metric], 1.0);
        }
        let mut fractional_label = originals[0].clone();
        fractional_label.predictions.values[0][0] = 1.0 / 3.0;
        assert!(apply_global_oof_aggregation(
            crate::metrics::CrossFoldValidation {
                reports: Vec::new(),
                oof_averages: vec![fractional_label],
            },
            &specs,
        )
        .unwrap_err()
        .to_string()
        .contains("genuine labels"));
    }

    #[test]
    fn group_scoring_preserves_partial_truth_without_averaging_or_fabricating_labels() {
        let (specs, mut average) = fixture(false);
        average.predictions.target_names = vec!["y".into(), "z".into()];
        average.predictions.values = vec![
            vec![1.0, 2.0],
            vec![3.0, 4.0],
            vec![5.0, 6.0],
            vec![9.0, 8.0],
        ];
        average.y_true.target_names = vec!["y".into(), "z".into()];
        average.y_true.values = vec![
            vec![1.0, 0.0],
            vec![1.0, 2.0],
            vec![1.0, 2.0],
            vec![9.0, 0.0],
        ];
        average.y_true.validity_masks = Some(vec![
            vec![true, false],
            vec![true, true],
            vec![true, true],
            vec![true, false],
        ]);
        let outcome = apply_global_oof_aggregation(
            crate::metrics::CrossFoldValidation {
                reports: Vec::new(),
                oof_averages: vec![average.clone()],
            },
            &specs,
        )
        .unwrap();
        assert_eq!(outcome.reports[0].metrics["mse:y"], 2.0);
        assert_eq!(outcome.reports[0].metrics["mse:z"], 4.0);
        assert_eq!(outcome.reports[0].metrics["mse"], 3.0);
        average.y_true.values[2][1] = 3.0;
        assert!(apply_global_oof_aggregation(
            crate::metrics::CrossFoldValidation {
                reports: Vec::new(),
                oof_averages: vec![average]
            },
            &specs
        )
        .unwrap_err()
        .to_string()
        .contains("conflicting ground truth"));
    }

    #[test]
    fn refit_scope_report_uses_real_scope_ids_and_does_not_invent_predictions() {
        let (specs, average) = fixture(false);
        let block = PredictionBlock {
            prediction_id: average.predictions.prediction_id,
            producer_node: average.predictions.producer_node.clone(),
            producer_port: average.predictions.producer_port.clone(),
            partition: PredictionPartition::Final,
            fold_id: None,
            sample_ids: average
                .predictions
                .unit_ids
                .iter()
                .map(|unit| match unit {
                    PredictionUnitId::Sample(id) => id.clone(),
                    _ => unreachable!(),
                })
                .collect(),
            values: average.predictions.values,
            target_names: average.predictions.target_names,
        };
        let truth = RegressionTargetRecord {
            producer_node: block.producer_node.clone(),
            producer_port: block.producer_port.clone(),
            variant_id: None,
            partition: PredictionPartition::Final,
            fold_id: None,
            block: average.y_true,
        };
        let outcome = apply_independent_unit_scope_reports(
            Default::default(),
            &specs,
            std::slice::from_ref(&block),
            std::slice::from_ref(&truth),
        )
        .unwrap();
        assert_eq!(outcome.reports.len(), 1);
        assert_eq!(outcome.reports[0].partition, PredictionPartition::Final);
        assert_eq!(outcome.reports[0].fold_id, None);
        assert_eq!(outcome.reports[0].row_count, 2);
        assert!(outcome.oof_averages.is_empty());
        assert!(apply_independent_unit_scope_reports(
            Default::default(),
            &specs,
            std::slice::from_ref(&block),
            &[]
        )
        .unwrap()
        .reports
        .is_empty());
    }

    #[test]
    fn indexed_statistical_scoring_preserves_reports_with_unselected_relations() {
        let (mut specs, average) = fixture(false);
        let input = crate::metrics::CrossFoldValidation {
            reports: Vec::new(),
            oof_averages: vec![average],
        };
        let expected = apply_global_oof_aggregation(input.clone(), &specs).unwrap();
        specs
            .values_mut()
            .next()
            .unwrap()
            .relations
            .records
            .push(SampleRelation::new(
                ObservationId::new("unselected_observation").unwrap(),
                SampleId::new("unselected_sample").unwrap(),
            ));
        let actual = apply_global_oof_aggregation(input, &specs).unwrap();
        assert_eq!(actual.reports, expected.reports);
        assert_eq!(actual.oof_averages, expected.oof_averages);
    }

    #[test]
    fn indexed_statistical_scoring_keeps_missing_and_conflicting_unit_refusals() {
        for case in ["absent", "missing_metadata", "conflicting_metadata"] {
            let (mut specs, average) = fixture(false);
            let relations = &mut specs.values_mut().next().unwrap().relations;
            let expected = match case {
                "absent" => {
                    relations.records.remove(1);
                    "sample `s2` has no attested relation"
                }
                "missing_metadata" => {
                    relations.records[1].metadata.clear();
                    "sample `s2` has no independent unit metadata"
                }
                "conflicting_metadata" => {
                    let mut duplicate = relations.records[0].clone();
                    duplicate.observation_id =
                        ObservationId::new("conflicting_observation").unwrap();
                    duplicate.metadata.insert(
                        "independent_unit_id".into(),
                        serde_json::json!("different_unit"),
                    );
                    relations.records.push(duplicate);
                    "sample `s1` has conflicting independent units"
                }
                _ => unreachable!(),
            };
            let error = apply_global_oof_aggregation(
                crate::metrics::CrossFoldValidation {
                    reports: Vec::new(),
                    oof_averages: vec![average],
                },
                &specs,
            )
            .unwrap_err()
            .to_string();
            assert!(error.contains(expected), "{case}: {error}");
        }
    }
}

fn validate_independent_class_predictions(
    spec: &GlobalOofAggregationSpec,
    values: &[Vec<f64>],
) -> Result<()> {
    if let Some(classes) = &spec.class_labels {
        if values
            .iter()
            .any(|row| row.len() != 1 || !classes.contains(&row[0]))
        {
            return Err(DagMlError::OofValidation("independent-unit classification requires genuine labels in the signed class vocabulary, not probability features or averaged IDs".into()));
        }
    }
    Ok(())
}

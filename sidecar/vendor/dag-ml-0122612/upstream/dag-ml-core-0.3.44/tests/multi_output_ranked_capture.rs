use dag_ml_core::{select_candidate, CandidateScore, SelectionDecision, SelectionPolicy};
use std::collections::BTreeMap;

fn policy(rank: Option<usize>) -> SelectionPolicy {
    let mut wire = serde_json::json!({"id":"selection:mm09", "metric":{"name":"rmse","objective":"minimize"}, "require_finite":true});
    if let Some(rank) = rank {
        wire["requested_rank"] = serde_json::json!(rank);
    }
    serde_json::from_value(wire).unwrap()
}

fn scores() -> Vec<CandidateScore> {
    [
        ("variant:good", 0.1),
        ("variant:middle", 0.3),
        ("variant:bad", 0.9),
    ]
    .into_iter()
    .map(|(id, score)| CandidateScore {
        candidate_id: id.into(),
        metrics: BTreeMap::from([("rmse".into(), score)]),
        metadata: BTreeMap::new(),
    })
    .collect()
}

#[test]
fn native_requested_rank_retains_complete_ranking_and_original_scores() {
    let winner = select_candidate(&policy(None), &scores()).unwrap();
    let second = select_candidate(&policy(Some(2)), &scores()).unwrap();
    assert_eq!(winner.ranked_candidates, second.ranked_candidates);
    assert_eq!(winner.selected_candidate_id, "variant:good");
    assert_eq!(second.selected_candidate_id, "variant:middle");
    assert_eq!(second.selected_score, 0.3);
    assert_eq!(second.requested_rank, Some(2));
    let restored: SelectionDecision =
        serde_json::from_str(&serde_json::to_string(&second).unwrap()).unwrap();
    assert_eq!(second, restored);
    restored.validate().unwrap();
}

#[test]
fn old_omitted_rank_remains_winner_only_and_omitted_on_wire() {
    let decision = select_candidate(&policy(None), &scores()).unwrap();
    assert!(serde_json::to_value(policy(None))
        .unwrap()
        .get("requested_rank")
        .is_none());
    assert!(serde_json::to_value(&decision)
        .unwrap()
        .get("requested_rank")
        .is_none());
    assert_eq!(
        decision,
        select_candidate(
            &policy(None),
            &scores().into_iter().rev().collect::<Vec<_>>()
        )
        .unwrap()
    );
}

#[test]
fn invalid_rank_is_refused_without_discarding_or_reranking_candidates() {
    for rank in [0, 4, usize::MAX] {
        assert!(select_candidate(&policy(Some(rank)), &scores()).is_err());
    }
    let decision = select_candidate(&policy(Some(2)), &scores()).unwrap();
    let mut changed_id = decision.clone();
    changed_id.selected_candidate_id = "variant:good".into();
    assert!(changed_id.validate().is_err());
    let mut changed_score = decision.clone();
    changed_score.selected_score = 0.1;
    assert!(changed_score.validate().is_err());
    let mut changed_rank = decision;
    changed_rank.requested_rank = Some(3);
    assert!(changed_rank.validate().is_err());
}

#[test]
fn maximized_classifier_rank_is_native_and_finite() {
    let mut policy = policy(Some(2));
    policy.metric.name = "balanced_accuracy".into();
    policy.metric.objective = dag_ml_core::MetricObjective::Maximize;
    let candidates = scores()
        .into_iter()
        .map(|mut item| {
            let score = item.metrics.remove("rmse").unwrap();
            item.metrics.insert("balanced_accuracy".into(), score);
            item
        })
        .collect::<Vec<_>>();
    let decision = select_candidate(&policy, &candidates).unwrap();
    assert_eq!(decision.ranked_candidates[0].candidate_id, "variant:bad");
    assert_eq!(decision.selected_candidate_id, "variant:middle");
    let mut invalid = candidates;
    invalid[0]
        .metrics
        .insert("balanced_accuracy".into(), f64::INFINITY);
    assert!(select_candidate(&policy, &invalid).is_err());
}

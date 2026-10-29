"""Rank only library-projected scores from one captured target protocol."""

import pytest

from api.aggregated_predictions import ChainSummary
from api.native_results_adapter import NativeResultsAdapter, NativeTargetDomainComparisonError


class ProjectedPredictions:
    def __init__(self, rows):
        self.rows = rows

    def filter_predictions(self, load_arrays=False):
        return self.rows


def native_read(score, *, fold="macro", context="exact-sdk-context", config="classifier"):
    rows = [
        {"fold_id": "0", "val_score": 0.7},
        {"fold_id": "1", "val_score": 0.9},
        {"fold_id": fold, "val_score": score},
    ]
    for row in rows:
        row.update(config_name=config, dataset_name="same", model_name="LogisticRegression",
                   metric="balanced_accuracy", task_type="multiclass_classification")
        if context is not None:
            row["result_metadata"] = {"dagml_projection": {"target_domain_context": context}}
    return {"manifest": {"metric": "balanced_accuracy"}, "predictions": ProjectedPredictions(rows)}


def adapter_for(*runs):
    adapter = NativeResultsAdapter.__new__(NativeResultsAdapter)
    adapter._iter_runs = lambda: list(runs)
    return adapter


def test_same_exact_sdk_context_is_ranked_and_preserved_through_pydantic():
    # The opaque value must survive verbatim, rather than being recalculated
    # from a convenient subset of the native fitted-domain evidence.
    context = "a" * 64
    adapter = adapter_for(("first", native_read(.8, context=context)),
                          ("second", native_read(.99, context=context)))
    ranked = adapter.query_top_chains(metric="balanced_accuracy").to_dicts()
    assert [row["run_id"] for row in ranked] == ["second", "first"]
    assert [row["cv_val_score"] for row in ranked] == [.99, .8]
    response = ChainSummary.model_validate(ranked[0]).model_dump()
    assert response["target_domain_context"] == context
    assert response["cv_summary_fold_id"] == "macro"
    assert response["cv_fold_count"] == 2


@pytest.mark.parametrize("other_fold,other_context", [("avg", None), ("macro", "different-recipe-or-fold-domains")])
@pytest.mark.parametrize("score_column", ["cv_val_score", "avg_val_score"])
def test_mixed_native_target_protocols_refused_before_pagination(other_fold, other_context, score_column):
    adapter = adapter_for(("macro", native_read(.8)),
                          ("other", native_read(.99, fold=other_fold, context=other_context)))
    # n=1 cannot hide the incompatible candidate before comparability is checked.
    with pytest.raises(NativeTargetDomainComparisonError, match="Cannot rank results"):
        adapter.query_top_chains(metric="balanced_accuracy", score_column=score_column, n=1)
    # Individual, explicitly selected sources remain inspectable/rankable.
    selected = adapter.query_top_chains(metric="balanced_accuracy", run_id="macro").to_dicts()
    assert len(selected) == 1 and selected[0]["cv_val_score"] == .8


def test_pooled_oof_rankings_keep_existing_behavior_without_macro_context():
    adapter = adapter_for(("first", native_read(.8, fold="avg", context=None)),
                          ("second", native_read(.99, fold="avg", context=None)))
    assert [row["run_id"] for row in adapter.query_top_chains(metric="balanced_accuracy").to_dicts()] == ["second", "first"]


@pytest.mark.parametrize("pooled_fold", ["avg", "w_avg"])
def test_one_variant_cannot_silently_prefer_macro_over_pooled_oof(pooled_fold):
    read = native_read(.8)
    read["predictions"].rows.append({**read["predictions"].rows[-1], "fold_id": pooled_fold})
    adapter = adapter_for(("corrupt", read))
    with pytest.raises(NativeTargetDomainComparisonError, match="mix macrofold and pooled OOF"):
        adapter.query_chain_summaries()


@pytest.mark.parametrize("missing_or_different", [None, "wrong-fold-context", 123, {"hash": "invalid"}])
def test_macro_rows_require_one_exact_sdk_context(missing_or_different):
    read = native_read(.8)
    read["predictions"].rows[0]["result_metadata"]["dagml_projection"]["target_domain_context"] = missing_or_different
    adapter = adapter_for(("corrupt", read))
    with pytest.raises(NativeTargetDomainComparisonError, match="consistent captured SDK context"):
        adapter.query_chain_summaries()


def test_macro_without_any_captured_context_is_refused():
    adapter = adapter_for(("unattested", native_read(.8, context=None)))
    with pytest.raises(NativeTargetDomainComparisonError, match="consistent captured SDK context"):
        adapter.query_top_chains(metric="balanced_accuracy")

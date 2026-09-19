"""The local qualification selector must not hide failures or misspelled IDs."""
import importlib.util
import json
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/qualify-local-catalog.py"


@pytest.fixture
def runner(monkeypatch):
    spec = importlib.util.spec_from_file_location("local_catalog_runner", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr("api.node_registry_loader.load_editor_registry_nodes", lambda: [
        {"id": "model.first", "status": "pending"},
        {"id": "model.other", "status": "pending"},
        {"id": "model.unconfigured", "status": "fixture_required"},
    ])
    monkeypatch.setattr(module, "plan_node", lambda node, profile: dict(node))
    monkeypatch.setattr(module, "composed_cases", lambda: [])
    monkeypatch.setattr(module, "execute_case", lambda case, directory, timeout: {"status": "passed"})
    return module


def test_selected_pass_keeps_global_coverage_incomplete(runner, monkeypatch, tmp_path):
    output = tmp_path / "report.json"
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), "--execute", "--node", "model.first", "--output", str(output)])
    assert runner.main() == 0
    report = json.loads(output.read_text())
    assert report["selected_nodes_qualified"] is True
    assert report["all_nodes_qualified"] is False
    assert report["selected_counts"] == {"passed": 1}
    assert report["counts"]["pending"] == 1


def test_unknown_id_is_rejected_before_execution(runner, monkeypatch, tmp_path):
    output = tmp_path / "report.json"
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), "--execute", "--node", "model.typo", "--output", str(output)])
    with pytest.raises(SystemExit) as error:
        runner.main()
    assert error.value.code == 2
    assert not output.exists()


@pytest.mark.parametrize("selection", [[], ["--node", "model.unconfigured"]])
def test_unqualified_requested_cases_fail(runner, monkeypatch, tmp_path, selection):
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), "--execute", "--output", str(tmp_path / "report.json"), *selection])
    assert runner.main() == 1


@pytest.mark.parametrize("class_path, requires, expected", [
    ("sklearn.neural_network.MLPRegressor", [], "pending"),
    ("sklearn.neural_network.MLPClassifier", [], "pending"),
    ("nirs4all.operators.models.pytorch.NICON", ["torch"], "optional_profile_required"),
])
def test_deep_learning_label_does_not_skip_standard_sklearn(class_path, requires, expected):
    spec = importlib.util.spec_from_file_location("actual_local_catalog_runner", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    result = module.plan_node({"id": "model.fixture", "type": "model", "classPath": class_path,
                               "isDeepLearning": True, "requires": requires}, "cpu")
    assert result["status"] == expected


@pytest.mark.parametrize("status,module,accepted", [
    ("dependency_missing", "aompls", True),
    ("dependency_missing", "unexpected_dependency", False),
    ("failed", "aompls", False),
    ("timeout", None, False),
    ("fixture_required", None, False),
    ("optional_profile_required", None, False),
    ("passed", None, True),
])
def test_policy_only_accepts_reviewed_exact_restrictions(runner, status, module, accepted):
    policy = {"restrictions": {"model.aom": {"status": "dependency_missing", "missing_module": "aompls"}}}
    result = runner.evaluate_policy([{"id": "model.aom", "status": status, "missing_module": module}], policy)
    assert result["passed"] is accepted
    assert all(case["scientifically_qualified"] is False for case in result["accepted_restrictions"])


def test_new_restrictions_and_disappearing_catalog_entries_fail(runner):
    policy = {"restrictions": {"expected": {"status": "unsupported_in_studio"}}}
    result = runner.evaluate_policy([{"id": "new", "status": "optional_profile_required"}], policy)
    assert result["passed"] is False
    assert {row["id"] for row in result["unexpected"]} == {"new", "expected"}


@pytest.mark.parametrize("rule", [{"status": "failed"}, {"status": "timeout"}, {"status": "dependency_missing"}])
def test_policy_cannot_allow_failures_or_unspecified_dependencies(runner, rule):
    with pytest.raises(ValueError):
        runner.evaluate_policy([], {"restrictions": {"node": rule}})


def test_dependency_classification_requires_typed_cause(runner):
    plain = RuntimeError("No module named 'aompls'")
    assert runner.missing_module_from_error(plain) is None
    plain.__cause__ = ModuleNotFoundError("Missing optional backend", name="aompls")
    assert runner.missing_module_from_error(plain) == "aompls"


@pytest.fixture
def score_audit():
    spec = importlib.util.spec_from_file_location("catalog_score_audit", SCRIPT.with_name("audit-local-catalog-results.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def scored_chain(step, *, model="Ridge", helper=False, held_out=True):
    return {"model": model, "pipeline_name": "pipeline_stacking_refit_meta" if helper else "main",
            "model_step_idx": step, "held_out_scores": {"avg_val_score": 0.0} if held_out else {},
            "auxiliary_training_observation": helper}


def test_helper_training_observation_requires_scored_final_predictive_model(score_audit):
    rows = [scored_chain(3), scored_chain(5), scored_chain(2, helper=True, held_out=False)]
    score_audit.validate_predictive_output(rows, ["Ridge"])
    rows[1]["held_out_scores"] = {}
    with pytest.raises(AssertionError, match="Final predictive model"):
        score_audit.validate_predictive_output(rows, ["Ridge"])


def test_other_scored_models_cannot_hide_missing_or_unrelated_output(score_audit):
    with pytest.raises(AssertionError, match="no scored main model"):
        score_audit.validate_predictive_output([scored_chain(5), scored_chain(2, model="PLS", helper=True, held_out=False)], ["Ridge", "PLS"])
    with pytest.raises(AssertionError, match="vanished"):
        score_audit.validate_predictive_output([scored_chain(5)], ["PLS"])
    with pytest.raises(AssertionError, match="no main predictive output"):
        score_audit.validate_predictive_output([scored_chain(2, helper=True, held_out=False)], ["Ridge"])


@pytest.mark.parametrize("value,expected", [(0, True), (0.0, True), (-1.2, True), (None, False),
                                          (float("nan"), False), (float("inf"), False), (False, False)])
def test_numeric_score_audit_keeps_real_zero_and_rejects_missing_nonfinite(score_audit, value, expected):
    assert score_audit.finite(value) is expected


def test_full_gate_success_preserves_explicit_unqualified_limitations(runner, monkeypatch, tmp_path):
    monkeypatch.setattr("api.node_registry_loader.load_editor_registry_nodes", lambda: [
        {"id": "model.first", "status": "pending"},
        {"id": "analysis.only", "status": "unsupported_in_studio"},
    ])
    policy = tmp_path / "policy.json"
    policy.write_text(json.dumps({"restrictions": {"analysis.only": {"status": "unsupported_in_studio"}}}))
    output = tmp_path / "report.json"
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), "--execute", "--output", str(output), "--policy", str(policy)])
    assert runner.main() == 0
    report = json.loads(output.read_text())
    assert report["policy"]["passed"] is True
    assert report["all_nodes_qualified"] is False
    assert report["policy"]["accepted_restrictions"][0]["scientifically_qualified"] is False


@pytest.mark.parametrize("extra", [[], ["--execute", "--node", "model.first"]])
def test_policy_cannot_qualify_inventory_or_partial_catalog(runner, monkeypatch, tmp_path, extra):
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), "--output", str(tmp_path / "report.json"),
                                      "--policy", str(tmp_path / "policy.json"), *extra])
    with pytest.raises(SystemExit) as error:
        runner.main()
    assert error.value.code == 2

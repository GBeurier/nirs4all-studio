#!/usr/bin/env python3
"""Execute the actual Studio palette in isolated installed-Python workers.

No downloads, installation, source-library imports or silent skips. JSON reports
retain every palette entry, including missing fixtures and optional dependencies.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
import signal
import subprocess
import sys
import time
import traceback
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def step(name, kind, class_path, **params):
    return {"id": name, "name": name, "type": kind, "classPath": class_path, "params": params}


def composed_cases():
    """Use the same branch/y-transform/generator shapes as Studio canonical tests."""
    scaler = "sklearn.preprocessing.StandardScaler"
    ridge = {"model": {"class": "sklearn.linear_model.Ridge", "params": {"alpha": 1.0}}}
    folds = {"class": "sklearn.model_selection.KFold", "params": {"n_splits": 2}}
    pls = {"model": {"class": "sklearn.cross_decomposition.PLSRegression", "params": {"n_components": 3}}}
    return [
        {"id": "composed.branch_merge_y", "canonical": [
            {"y_processing": scaler}, {"branch": [[scaler], ["sklearn.preprocessing.MinMaxScaler"]]},
            {"merge": "concat"}, folds, ridge, pls]},
        {"id": "composed.model_sweep", "canonical": [scaler, folds, {"model": {
            "class": "sklearn.linear_model.Ridge", "params": {"alpha": {"_or_": [0.1, 10.0]}}}}]},
        {"id": "composed.classification", "classification": True, "canonical": [
            scaler, {"class": "sklearn.decomposition.PCA", "params": {"n_components": 5}},
            {"class": "sklearn.model_selection.StratifiedKFold", "params": {"n_splits": 2}},
            {"model": {"class": "sklearn.linear_model.LogisticRegression", "params": {"max_iter": 100}}}]},
        {"id": "composed.regression_feature_score", "canonical": [
            {"class": "sklearn.feature_selection.SelectKBest", "params": {"score_func": "sklearn.feature_selection.f_regression", "k": 8}},
            folds, ridge]},
        {"id": "composed.late_failure", "expect_failure": True, "canonical": [scaler, folds, ridge,
            {"model": {"class": "sklearn.cross_decomposition.PLSRegression", "params": {"n_components": 10000}}}]},
    ]


def plan_node(node, profile):
    from api.operator_capabilities import spectral_pipeline_constraint

    result = {"id": node["id"], "type": node.get("type"), "class_path": node.get("classPath"), "node": node}
    constraint = spectral_pipeline_constraint(str(node.get("type", "")), str(node.get("classPath", "")))
    if constraint:
        return {**result, "status": "unsupported_in_studio", "reason": constraint,
                "guard_regression": "tests/test_spectral_pipeline_capabilities.py", "scientifically_executed": False}
    needs_framework = node.get("isDeepLearning") and not str(node.get("classPath", "")).startswith("sklearn.")
    if needs_framework or node.get("requires"):
        allowed = profile == "tabpfn" and "tabpfn" in str(node.get("classPath", "")).lower()
        if not allowed:
            return {**result, "status": "optional_profile_required", "reason": node.get("requires") or "deep-learning runtime"}
    contextual = {"branch.parallel", "branch.source", "merge.sources", "merge.predictions", "container.sample_augmentation",
                  "container.feature_augmentation", "container.sample_filter", "container.concat_transform",
                  "generator.or", "generator.cartesian", "generator.chain", "misc.comment", "misc.chart",
                  "preprocessing.column_transformer", "preprocessing.feature_union", "preprocessing.sparse_coder"}
    if node["id"] in contextual:
        return {**result, "status": "pending", "fixture_context": "explicit compatible child operators or constructor parameters"}
    if node.get("type") in ("flow", "utility"):
        return {**result, "status": "fixture_required", "reason": "Container/keyword requires an explicit composed pipeline; see composed cases, not qualified individually."}
    required = [p["name"] for p in node.get("parameters", []) if p.get("required") and "default" not in p]
    if required:
        return {**result, "status": "fixture_required", "reason": f"User-supplied parameters required: {required}"}
    return {**result, "status": "pending"}



def missing_module_from_error(error):
    """Only classify a real ModuleNotFoundError, never a message substring."""
    seen = set()
    while error is not None and id(error) not in seen:
        seen.add(id(error))
        if isinstance(error, ModuleNotFoundError):
            return error.name
        error = error.__cause__ or error.__context__
    return None


def evaluate_policy(cases, policy):
    """A fixed reviewed allowlist permits limitations, never failed executions."""
    restrictions = policy["restrictions"]
    permitted = {"unsupported_in_studio", "optional_profile_required", "dependency_missing"}
    if any(rule.get("status") not in permitted for rule in restrictions.values()):
        raise ValueError("Catalog policy may not permit failed, timed-out, unconfigured or pending cases")
    if any(rule["status"] == "dependency_missing" and not rule.get("missing_module") for rule in restrictions.values()):
        raise ValueError("An allowed missing dependency must name its exact module")
    unexpected, accepted = [], []
    for case in cases:
        if case["status"] == "passed":
            continue
        expected = restrictions.get(case["id"])
        if expected and all(case.get(key) == value for key, value in expected.items()):
            accepted.append({"id": case["id"], **expected, "scientifically_qualified": False})
        else:
            unexpected.append({"id": case["id"], "status": case["status"], "missing_module": case.get("missing_module")})
    for missing in sorted(set(restrictions) - {case["id"] for case in cases}):
        unexpected.append({"id": missing, "status": "expected_catalog_entry_missing"})
    return {"passed": not unexpected, "unexpected": unexpected, "accepted_restrictions": accepted}


def worker(case_path, output):
    case = json.loads(Path(case_path).read_text())
    report = {"id": case["id"], "status": "failed", "stage": "imports"}
    start = time.monotonic()
    try:
        import nirs4all
        import numpy as np
        from nirs4all.pipeline.storage import WorkspaceStore

        import api.shared  # noqa: F401
        from api import runs
        from api.pipeline_canonical import canonical_to_editor
        from api.results_repository import resolve_results_repository
        from api.workspace.services import _build_results_summary_payload

        distribution = importlib.metadata.distribution("nirs4all")
        report["library"] = {"version": nirs4all.__version__, "path": str(nirs4all.__file__),
                             "installation_origin": json.loads(distribution.read_text("direct_url.json") or "null"),
                             "record_sha256": hashlib.sha256((distribution.read_text("RECORD") or "").encode()).hexdigest()}
        source_digest = hashlib.sha256()
        package_root = Path(nirs4all.__file__).parent
        for source in sorted(package_root.rglob("*.py")):
            source_digest.update(str(source.relative_to(package_root)).encode())
            source_digest.update(source.read_bytes())
        report["library"]["source_tree_sha256"] = source_digest.hexdigest()
        dirty = subprocess.run(["git", "diff", "--binary", "HEAD", "--", "api", "src"], cwd=ROOT, capture_output=True, timeout=10)
        report["studio_dirty_diff_sha256"] = hashlib.sha256(dirty.stdout).hexdigest() if dirty.returncode == 0 else None
        report["studio_source_sha256"] = {
            name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
            for name in ("api/runs.py", "api/pipeline_canonical.py", "api/workspace/services.py", "scripts/qualify-local-catalog.py")
        }
        directory = Path(output).parent
        node = case.get("node", {})
        if node.get("type") in {"model", "preprocessing", "y_processing", "splitting", "filter", "augmentation"}:
            from api.pipeline_canonical import import_operator_class
            # The same import/required-dependency boundary used by preflight;
            # no estimator construction or fit is attempted for missing modules.
            import_operator_class(node["classPath"], allow_callable=node["type"] == "model")
        classification = case.get("classification", False) or bool({"classifier", "classification"} & set(node.get("tags", []))) or any(
            word in str(node.get("classPath", "")).lower() for word in ("classifier", "plsda", "logistic", "discriminant", "stratified"))
        classification = classification or case["id"] in {
            "preprocessing.neighborhood_components_analysis", "preprocessing.generic_univariate_select",
            "preprocessing.select_fdr", "preprocessing.select_fpr", "preprocessing.select_fwe",
            "preprocessing.select_k_best", "preprocessing.select_percentile"}
        multi_target = "multi_task" in case["id"] or case["id"] in {
            "model.classifier_chain", "model.multi_output_classifier", "model.multi_output_regressor",
            "model.regressor_chain", "model.cca", "model.pls_canonical", "preprocessing.plssvd"}
        report["task"] = "classification" if classification else "regression"
        rng = np.random.default_rng(8301)
        feature_count = 12 if case["id"] in {"model.lasso_lars_ic", "model.ransac_regressor"} else 64
        if case["id"] == "preprocessing.kernel_centerer":
            feature_count = 60
        if case["id"] == "model.quadratic_discriminant_analysis":
            feature_count = 4
        if case["id"] == "model.isotonic_regression":
            feature_count = 1
        wavelengths = np.linspace(1000, 2400, feature_count)
        latent = rng.normal(size=(72, 6))
        basis = np.exp(-((wavelengths[None, :] - np.linspace(1100, 2300, 6)[:, None]) / 150) ** 2)
        X = 3 + 0.15 * latent @ basis + rng.normal(0, 0.003, (72, feature_count))
        if case["id"] == "preprocessing.kernel_centerer":
            X = X @ X[:60].T  # Train references only: train60x60/test12x60, never a global72x72 Gram.
        categorical = "categorical_nb" in case["id"] or case["id"] in {"preprocessing.one_hot_encoder", "preprocessing.ordinal_encoder"}
        if categorical:
            X = (X > 3).astype(float)
        if case["id"] == "model.isotonic_regression":
            # Default out_of_bounds=nan requires inference values inside fit support.
            X[0, 0], X[1, 0] = X.min() - 0.01, X.max() + 0.01
        target = latent[:, 0] - 0.3 * latent[:, 1]
        y = (target > np.median(target)).astype(int) if classification else target + 5
        if multi_target:
            second = latent[:, 2] + 0.5 * latent[:, 3]
            y = np.column_stack([y, (second > np.median(second)).astype(int) if classification else second + 3])
        if case["id"] == "preprocessing.missing_indicator":
            X[::3, 0] = np.nan
            X[1::3, 1] = np.nan
        data = directory / "data"
        data.mkdir()
        files = []
        for partition, selection in (("train", slice(0, 60)), ("test", slice(60, 72))):
            for kind, values, header in (("X", X[selection], ";".join(map(str, wavelengths))), ("Y", y[selection], "target;target2" if multi_target else "target")):
                path = data / f"{kind}{partition}.csv"
                np.savetxt(path, values, delimiter=";", header=header, comments="")
                files.append({"path": str(path), "type": kind, "split": partition})
        if case["id"] in {"branch.source", "merge.sources"}:
            for partition, selection in (("train", slice(0, 60)), ("test", slice(60, 72))):
                path = data / f"Xsecond_{partition}.csv"
                np.savetxt(path, X[selection] * 0.7 + 2, delimiter=";", header=";".join(map(str, wavelengths)), comments="")
                files.append({"path": str(path), "type": "X", "split": partition})
        report["fixture"] = {"samples": 72, "features": feature_count, "categorical_X": categorical,
                             "classification_from_registry_tags": classification, "target_columns": 2 if multi_target else 1,
                             "precomputed_kernel_train_references": case["id"] == "preprocessing.kernel_centerer",
                             "sources": 2 if case["id"] in {"branch.source", "merge.sources"} else 1}
        group_by = "group" if node.get("type") == "splitting" and "group" in str(node.get("classPath", "")).lower() else None
        if group_by or case["id"] == "filter.metadata":
            for partition, selection in (("train", slice(0, 60)), ("test", slice(60, 72))):
                metadata_path = data / f"metadata_{partition}.csv"
                np.savetxt(metadata_path, np.array([f"g{i // 6}" for i in range(72)])[selection], delimiter=";", header="group", comments="", fmt="%s")
                files.append({"path": str(metadata_path), "type": "metadata", "split": partition})
        report["fixture"]["group_by"] = group_by
        record = {"id": "catalog", "name": "catalog", "path": str(data), "config": {
            "files": files, "delimiter": ";", "has_header": True, "task_type": report["task"],
            **({"na_policy": "ignore"} if case["id"] == "preprocessing.missing_indicator" else {})}}
        workspace_path = directory / "workspace"
        runs.workspace_manager.get_current_workspace = lambda: SimpleNamespace(path=str(workspace_path), datasets=[record])
        scaler = step("StandardScaler", "preprocessing", "sklearn.preprocessing.StandardScaler")
        folds = step("KFold", "splitting", "sklearn.model_selection.StratifiedKFold" if classification and not multi_target else "sklearn.model_selection.KFold", n_splits=2)
        model = step("model", "model", "sklearn.linear_model.LogisticRegression" if classification else "sklearn.linear_model.Ridge")
        if "canonical" in case:
            steps = canonical_to_editor(case["canonical"])
        else:
            params = {p["name"]: p["default"] for p in node.get("parameters", []) if "default" in p}
            # Explicit cheap-fixture settings; both registry defaults and actual
            # parameters remain in the report. No invalid parameter is discarded.
            limits = {"n_estimators": 8, "n_jobs": 1}
            for key, maximum in limits.items():
                if key in params and isinstance(params[key], (int, float)):
                    params[key] = min(params[key], maximum) if params[key] > 0 else maximum
            estimator_nodes = {"model.classifier_chain", "model.multi_output_classifier", "model.multi_output_regressor",
                               "model.one_vs_one_classifier", "model.one_vs_rest_classifier", "model.output_code_classifier",
                               "model.regressor_chain", "model.fixed_threshold_classifier", "model.self_training_classifier",
                               "model.tuned_threshold_classifier_cv", "preprocessing.rfe", "preprocessing.rfecv",
                               "preprocessing.select_from_model", "preprocessing.sequential_feature_selector"}
            if case["id"] in estimator_nodes:
                params["estimator"] = {"class": "sklearn.linear_model.LogisticRegression" if classification else "sklearn.linear_model.Ridge"}
            if "stacking_" in case["id"] or "voting_" in case["id"]:
                params["estimators"] = [["linear", {"class": "sklearn.linear_model.LogisticRegression" if classification else "sklearn.linear_model.Ridge"}],
                                        ["tree", {"class": "sklearn.tree.DecisionTreeClassifier" if classification else "sklearn.tree.DecisionTreeRegressor", "params": {"max_depth": 2}}]]
            if case["id"] in {"preprocessing.gaussian_random_projection", "preprocessing.sparse_random_projection"}:
                params["n_components"] = 8  # Explicit feasible projection for a 64-band fixture.
            if case["id"] == "splitting.predefined_split":
                params["test_fold"] = [i % 2 for i in range(60)]
            if "tabpfn" in str(node.get("classPath", "")).lower():
                params.update(n_estimators=1, device="cpu", n_jobs=1)
            if case["id"] == "filter.metadata":
                params.update(column="group", values_to_exclude=["g0"])
            if case["id"] == "preprocessing.column_transformer":
                params["transformers"] = [["spectra", {"class": "sklearn.preprocessing.StandardScaler"}, list(range(32))]]
            if case["id"] == "preprocessing.feature_union":
                params["transformer_list"] = [["scale", {"class": "sklearn.preprocessing.StandardScaler"}],
                                             ["minmax", {"class": "sklearn.preprocessing.MinMaxScaler"}]]
            if case["id"] == "preprocessing.sparse_coder":
                params["dictionary"] = np.eye(feature_count).tolist()
            current = {**node, **step(node["name"], node["type"], node["classPath"], **params)}
            report["parameters"] = params
            if node["type"] in {"flow", "utility"}:
                alternate = step("MinMaxScaler", "preprocessing", "sklearn.preprocessing.MinMaxScaler")
                if case["id"] in {"branch.source", "merge.sources"}:
                    source_branch = {"id": "source-branch", "name": "SourceBranch", "type": "flow", "subType": "branch",
                                     "classPath": "source_branch", "params": {"sources": ["source_0", "source_1"]},
                                     "branches": [[scaler], [alternate]]}
                    source_merge = {"id": "source-merge", "name": "MergeSources", "type": "flow", "subType": "merge",
                                    "classPath": "source_merge", "params": {"axis": "features"}}
                    if case["id"] == "branch.source":
                        current["params"]["sources"] = ["source_0", "source_1"]
                        current["branches"] = source_branch["branches"]
                        source_branch = current
                    else:
                        source_merge = current
                    steps = [source_branch, source_merge, folds, model]
                elif case["id"] in {"branch.parallel", "generator.or", "generator.chain", "generator.cartesian"}:
                    current["branches"] = [[scaler], [alternate]]
                    steps = [current]
                    if case["id"] == "branch.parallel":
                        steps += canonical_to_editor([{"merge": "concat"}])
                    steps += [folds, model]
                elif case["id"] == "merge.predictions":
                    steps = [scaler, folds, *canonical_to_editor([
                        {"branch": [[{"model": {"class": "sklearn.linear_model.Ridge"}}],
                                    [{"model": {"class": "sklearn.cross_decomposition.PLSRegression", "params": {"n_components": 2}}}]]}]), current, model]
                else:
                    current["children"] = [scaler, alternate]
                    if case["id"] == "container.sample_augmentation":
                        current["children"] = [step("GaussianAdditiveNoise", "augmentation", "nirs4all.operators.augmentation.GaussianAdditiveNoise")]
                    if case["id"] == "container.sample_filter":
                        current["children"] = [step("YOutlierFilter", "filter", "nirs4all.operators.filters.YOutlierFilter")]
                    steps = [current, folds, model]
            elif node["type"] == "model":
                if case["id"] == "model.meta_model":
                    steps = [scaler, folds, model, step("PLS", "model", "sklearn.cross_decomposition.PLSRegression", n_components=3), current]
                elif case["id"] == "model.isotonic_regression":
                    # CV fold intervals exclude extrema; test the valid train/test
                    # interpolation domain without inventing an extrapolation policy.
                    steps = [scaler, current]
                elif "naive_bayes" in str(node.get("classPath", "")):
                    # Count/categorical likelihoods must not receive centered negatives.
                    steps = [folds, current]
                elif "radius_neighbors" in case["id"]:
                    steps = [step("Normalizer", "preprocessing", "sklearn.preprocessing.Normalizer"), folds, current]
                else:
                    steps = [scaler, folds, current]
            elif node["type"] == "splitting":
                steps = [scaler, current, model]
            else:
                if case["id"] in {"y_processing.integer_k_bins_discretizer", "y_processing.range_discretizer"}:
                    model = step("RandomForestClassifier", "model", "sklearn.ensemble.RandomForestClassifier", n_estimators=8, random_state=42)
                steps = [current, folds, model]
        report["editor_steps"] = steps
        pipeline = runs.PipelineRun(id=case["id"], pipeline_id=case["id"], pipeline_name=case["id"],
                                    model=node.get("name", "composed"), preprocessing="catalog", split_strategy="fixture",
                                    status="running", config={"steps": steps})
        with WorkspaceStore(workspace_path) as store:
            run_id = store.begin_run(case["id"], {}, [{"name": "catalog"}])
        report["stage"] = "studio_training"
        training_error = None
        try:
            outcome = runs._execute_pipeline_training(pipeline, "catalog", str(workspace_path), "catalog", store_run_id=run_id, split_group_by=group_by, engine="legacy")
            report["outcome"] = {key: outcome[key] for key in ("engine", "metrics", "model_path", "store_run_id", "logs")}
        except Exception:
            training_error = traceback.format_exc()
            report["training_error"] = training_error
        report["stage"] = "stored_results"
        with WorkspaceStore(workspace_path) as store:
            rows = store.query_predictions(run_id=run_id).to_dicts()
            report["stored_model_names"] = sorted({row["model_name"] for row in rows})
            measured = 0
            for row in rows:
                saved = store.get_prediction(row["prediction_id"], load_arrays=True)
                if saved.get("y_pred") is None:
                    continue
                predicted = np.asarray(saved["y_pred"]).ravel()
                assert predicted.size and np.isfinite(predicted).all(), "Missing/non-finite saved predictions"
                assert len(predicted) == len(np.asarray(saved["y_true"]).ravel())
                measured += 1
            report["measured_prediction_rows"] = measured
        repository = resolve_results_repository(workspace_path, workspace_store_factory=WorkspaceStore)
        try:
            summary = _build_results_summary_payload(repository, "workspace", [record], n=100)
            report["results_models"] = sorted({row["model_name"] for ds in summary["datasets"] for row in ds["top_chains"]})
        finally:
            repository.close()
        if case.get("expect_failure"):
            assert training_error, "Invalid final model did not fail"
            assert "Ridge" in report["results_models"] and measured > 0, "Late failure lost successful earlier model scores"
        else:
            assert not training_error, training_error
            assert measured and report["results_models"], "Training returned without persisted Results"
        report["status"] = "passed"
    except ModuleNotFoundError as exc:
        report.update(status="dependency_missing", error=str(exc), missing_module=exc.name, traceback=traceback.format_exc())
    except Exception as error:
        report["error"] = traceback.format_exc()
        missing = missing_module_from_error(error)
        if missing:
            report.update(status="dependency_missing", missing_module=missing)
    finally:
        report["duration_seconds"] = time.monotonic() - start
        Path(output).write_text(json.dumps(report, indent=2, default=str))
    return report["status"] == "passed"


def execute_case(case, directory, timeout):
    directory.mkdir()
    source, output = directory / "case.json", directory / "result.json"
    source.write_text(json.dumps(case))
    env = {**os.environ, "NIRS4ALL_CONFIG": str(directory / "config"), "NIRS4ALL_WORKSPACE": str(directory / "workspace"),
           "N4A_ENGINE": "legacy", "HF_HUB_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1", "MPLBACKEND": "Agg",
           "OMP_NUM_THREADS": "1", "OPENBLAS_NUM_THREADS": "1", "MKL_NUM_THREADS": "1", "NUMBA_NUM_THREADS": "1"}
    for key in ("PYTHONPATH", "NIRS4ALL_PYTHON_PATH", "NIRS4ALL_DEFAULT_WORKSPACE"):
        env.pop(key, None)
    with (directory / "process.log").open("wb") as log:
        process = subprocess.Popen([sys.executable, "-I", str(Path(__file__).resolve()), "--worker", str(source), "--output", str(output)],
                                   stdout=log, stderr=subprocess.STDOUT, env=env, start_new_session=os.name != "nt")
        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, timeout=10)
            else:
                os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=10)
            return {"id": case["id"], "status": "timeout", "timeout_seconds": timeout, "log": str(directory / "process.log")}
    return json.loads(output.read_text()) if output.exists() else {"id": case["id"], "status": "worker_failed", "returncode": process.returncode}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--profile", choices=("cpu", "tabpfn"), default="cpu")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--node", action="append", default=[])
    parser.add_argument("--timeout", type=float, default=20)
    parser.add_argument("--workers", type=int, choices=(1, 2), default=2)
    parser.add_argument("--worker", type=Path)
    parser.add_argument("--policy", type=Path, help="Reviewed explicit restrictions for a full CPU qualification gate")
    args = parser.parse_args()
    if args.policy and (args.node or not args.execute):
        parser.error("--policy requires an unrestricted --execute run")
    if args.worker:
        return 0 if worker(args.worker, args.output) else 1
    started_monotonic, started_at = time.monotonic(), time.time()
    from api.node_registry_loader import load_editor_registry_nodes
    nodes = load_editor_registry_nodes()
    cases = [plan_node(node, args.profile) for node in nodes]
    cases += [{**case, "status": "pending", "type": "composed"} for case in composed_cases()]
    requested_ids = set(args.node)
    unknown_ids = requested_ids - {case["id"] for case in cases}
    if unknown_ids:
        parser.error("Unknown catalog node ID(s): " + ", ".join(sorted(unknown_ids)))
    requested_cases = [case for case in cases if not requested_ids or case["id"] in requested_ids]
    environment = {d.metadata["Name"]: d.version for d in importlib.metadata.distributions() if d.metadata.get("Name")}
    report = {"profile": args.profile, "python": sys.executable, "prefix": sys.prefix, "packages": environment,
              "started_at_unix_seconds": started_at,
              "registry_sha256": hashlib.sha256(json.dumps(nodes, sort_keys=True).encode()).hexdigest(),
              "scope": "installed library, real Studio editor/training/results; offline weights only", "cases": cases}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    if args.execute:
        artifacts = args.output.parent / (args.output.stem + "-cases")
        artifacts.mkdir(exist_ok=False)
        selected = [c for c in cases if c["status"] == "pending" and (not args.node or c["id"] in args.node)]
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            pending = {pool.submit(execute_case, case, artifacts / case["id"], args.timeout): case for case in selected}
            for future in as_completed(pending):
                case = pending[future]
                case.update(future.result())
                print(case["id"], case["status"], flush=True)
                args.output.write_text(json.dumps(report, indent=2, default=str))
    report["counts"] = dict(Counter(case["status"] for case in cases))
    report["all_nodes_qualified"] = all(case["status"] == "passed" for case in cases)
    report["selected_node_ids"] = sorted(requested_ids)
    report["selected_counts"] = dict(Counter(case["status"] for case in requested_cases))
    report["selected_nodes_qualified"] = all(case["status"] == "passed" for case in requested_cases)
    report["execution_requested"] = args.execute
    report["duration_seconds"] = time.monotonic() - started_monotonic
    report["finished_at_unix_seconds"] = time.time()
    if args.policy:
        report["policy"] = {"path": str(args.policy), "sha256": hashlib.sha256(args.policy.read_bytes()).hexdigest(),
                            **evaluate_policy(cases, json.loads(args.policy.read_text()))}
    args.output.write_text(json.dumps(report, indent=2, default=str))
    print(json.dumps(report["counts"], sort_keys=True))
    if args.policy:
        return 0 if report["policy"]["passed"] else 1
    return 0 if not args.execute or report["selected_nodes_qualified"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

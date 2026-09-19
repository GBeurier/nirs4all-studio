#!/usr/bin/env python3
"""Readonly check of the actual Results summaries from a completed catalog run."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def finite(value):
    return isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value)


def validate_predictive_output(chains, expected_models):
    assert chains, "No visible Results rows"
    primary = [row for row in chains if not str(row["pipeline_name"]).startswith("pipeline_stacking_refit_")]
    assert primary, "Only helper refits are visible; no main predictive output"
    last_step = max(row["model_step_idx"] for row in primary)
    final_models = [row for row in primary if row["model_step_idx"] == last_step]
    assert final_models and all(row["held_out_scores"] for row in final_models), "Final predictive model lacks held-out scores"
    for row in chains:
        if row["auxiliary_training_observation"]:
            assert any(final["model"] == row["model"] for final in final_models), "Train-only helper has no scored main model"
    visible = {row["model"] for row in chains}
    assert set(expected_models) <= visible, "Model vanished from Results after execution"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    # Imports must never discover or initialize the user's normal app profile.
    isolated = args.output.resolve().with_suffix(".profile")
    os.environ["NIRS4ALL_CONFIG"] = str(isolated / "config")
    os.environ["NIRS4ALL_DEFAULT_WORKSPACE"] = str(isolated / "workspace")
    os.environ["XDG_DATA_HOME"] = str(isolated / "data")
    os.environ.pop("NIRS4ALL_WORKSPACE", None)
    from nirs4all.pipeline.storage import WorkspaceStore

    import api.shared  # noqa: F401
    from api.workspace.services import _build_results_summary_payload

    source = json.loads(args.report.read_text())
    artifacts = args.report.parent / (args.report.stem + "-cases")
    checks = []
    for case in source["cases"]:
        if case["status"] != "passed":
            continue
        directory = artifacts / case["id"]
        checked = {"id": case["id"], "status": "failed"}
        try:
            with WorkspaceStore.open_readonly(directory / "workspace") as store:
                record = {"id": "catalog", "name": "catalog", "path": str(directory / "data"),
                          "config": {"task_type": case["task"]}}
                summary = _build_results_summary_payload(store, "workspace", [record], n=100)
                chains = []
                for dataset in summary["datasets"]:
                    for row in dataset["top_chains"]:
                        numeric = {key: row.get(key) for key in ("avg_val_score", "avg_test_score", "avg_train_score", "final_test_score", "final_train_score") if finite(row.get(key))}
                        assert numeric, f"{row.get('model_name')} has no finite score in its visible Results row"
                        held_out = {key: value for key, value in numeric.items() if key in {"avg_val_score", "avg_test_score", "final_test_score"}}
                        # Every catalog fixture has a separate test partition. A
                        # partially failed pipeline may still have genuine CV scores.
                        auxiliary_training = (row.get("pipeline_name") == "pipeline_stacking_refit_meta"
                                              and row.get("fold_count") == 0 and finite(row.get("final_train_score")))
                        assert held_out or auxiliary_training, f"{row.get('model_name')} has only training scores despite the held-out fixture"
                        assert not row.get("synthetic_refit"), "Results must not manufacture refit scores"
                        raw_chain = store.get_chain(row["chain_id"])
                        chains.append({"model": row["model_name"], "metric": dataset["metric"],
                                       "pipeline_name": row.get("pipeline_name"), "pipeline_id": row.get("pipeline_id"),
                                       "model_step_idx": raw_chain.get("model_step_idx"),
                                       "auxiliary_training_observation": auxiliary_training and not held_out,
                                       "fold_count": row["fold_count"], "scores": numeric,
                                       "held_out_scores": held_out, "chain_id": row["chain_id"]})
                validate_predictive_output(chains, case["results_models"])
                checked.update(status="passed", rows=chains)
        except Exception as error:
            checked["error"] = str(error)
        checks.append(checked)
    completed = [case for case in source["cases"] if "duration_seconds" in case]
    provenance = {}
    for field in ("record_sha256", "source_tree_sha256"):
        provenance[field] = sorted({case["library"][field] for case in completed if case.get("library", {}).get(field)})
    provenance["studio_source_sha256"] = {
        name: sorted({case.get("studio_source_sha256", {}).get(name) for case in completed if case.get("studio_source_sha256", {}).get(name)})
        for name in {name for case in completed for name in case.get("studio_source_sha256", {})}
    }
    output = {"source_report": str(args.report), "source_report_sha256": hashlib.sha256(args.report.read_bytes()).hexdigest(),
              "source_counts": dict(Counter(case["status"] for case in source["cases"])),
              "score_audit_counts": dict(Counter(case["status"] for case in checks)),
              "visible_rows": sum(len(case.get("rows", [])) for case in checks),
              "slowest_cases": [{"id": case["id"], "seconds": case["duration_seconds"], "status": case["status"]}
                                for case in sorted(completed, key=lambda case: case["duration_seconds"], reverse=True)[:15]],
              "timeouts": [case["id"] for case in source["cases"] if case["status"] == "timeout"],
              "provenance": provenance, "cases": checks}
    args.output.write_text(json.dumps(output, indent=2))
    print(json.dumps({key: output[key] for key in ("source_counts", "score_audit_counts", "visible_rows", "slowest_cases", "timeouts")}, indent=2))
    return 0 if checks and all(case["status"] == "passed" for case in checks) else 1


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Generate the Store-v5 fixture and FastAPI oracle for results/summary.

The SQLite database is populated exclusively through WorkspaceStore's public
write API.  The response is then computed by Studio's current
``_build_results_summary_payload`` compatibility helper with ``n=5``.

This is a parity snapshot, not an independent ranking specification. The
Python oracle consumes the owner-defined metric direction for every ranking
stage and the Store query uses ``chain_id`` as its deterministic tie breaker.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch
from uuid import NAMESPACE_URL, uuid5

FIXTURE_DIR = Path(__file__).resolve().parent
STUDIO_ROOT = FIXTURE_DIR.parents[2]
WORKSPACE_ROOT = STUDIO_ROOT.parents[1]
NIRS4ALL_ROOT = WORKSPACE_ROOT / "nirs4all"

for source_root in (STUDIO_ROOT, NIRS4ALL_ROOT):
    source = str(source_root)
    if source not in sys.path:
        sys.path.insert(0, source)

from nirs4all.pipeline.storage.workspace_store import WorkspaceStore  # noqa: E402

from api.workspace.services import _build_results_summary_payload  # noqa: E402

WORKSPACE_ID = "workspace-summary-v5"
LINKED_DATASETS = [
    {
        "id": "dataset-r2-exact",
        "name": "r2 exact",
        "path": "/fixture-data/r2-exact.csv",
        "linked_at": "2026-09-01T00:00:00",
    },
    {
        "id": "dataset-rmse-folder",
        "name": "RMSE friendly name",
        "path": "/fixture-data/spectra_rmse",
        "linked_at": "2026-09-01T00:00:00",
    },
    {
        "id": "dataset-unknown-prefix",
        "name": "Mystery Score",
        "path": "/fixture-data/not-the-prefix",
        "linked_at": "2026-09-01T00:00:00",
    },
]


class _DeterministicUuid4:
    """Stable UUID source while still exercising public ID allocation."""

    def __init__(self) -> None:
        self._counter = 0

    def __call__(self):  # noqa: ANN204 - uuid4-compatible callable
        self._counter += 1
        return uuid5(NAMESPACE_URL, f"nirs4all-summary-fixture-{self._counter:04d}")


def _add_chain(
    store: WorkspaceStore,
    run_id: str,
    *,
    label: str,
    dataset_name: str,
    metric: str,
    cv_val: float | None = None,
    cv_test: float | None = None,
    cv_train: float | None = None,
    final_test: float | None = None,
    final_train: float | None = None,
    final_agg_test: float | None = None,
    best_params: dict | None = None,
) -> str:
    """Add one pipeline/chain and materialize its public summary fields."""
    expanded_config = [
        {"preprocessing": {"name": "SNV"}},
        {
            "model": {
                "class": "sklearn.cross_decomposition.PLSRegression",
                "params": {
                    "n_components": 2,
                    "scale": True,
                    "shared": "pipeline",
                },
            }
        },
    ]
    pipeline_id = store.begin_pipeline(
        run_id,
        name=f"Pipeline {label}",
        expanded_config=expanded_config,
        generator_choices=[],
        dataset_name=dataset_name,
        dataset_hash=f"hash-{label}",
    )
    chain_id = store.save_chain(
        pipeline_id,
        steps=[
            {
                "step_idx": 1,
                "operator_class": "nirs4all.operators.transforms.SNV",
                "params": {},
                "artifact_id": None,
                "stateless": True,
            },
            {
                "step_idx": 2,
                "operator_class": "sklearn.cross_decomposition.PLSRegression",
                "params": {"n_components": 2, "scale": True},
                "artifact_id": None,
                "stateless": False,
            },
        ],
        model_step_idx=2,
        model_class="sklearn.cross_decomposition.PLSRegression",
        preprocessings="SNV",
        fold_strategy="per_fold",
        fold_artifacts={},
        shared_artifacts={},
        dataset_name=dataset_name,
    )

    common = {
        "pipeline_id": pipeline_id,
        "chain_id": chain_id,
        "dataset_name": dataset_name,
        "model_name": label,
        "model_class": "PLSRegression",
        "metric": metric,
        "task_type": "regression",
        "n_samples": 12,
        "n_features": 8,
        "best_params": best_params or {},
        "branch_id": None,
        "branch_name": None,
        "exclusion_count": 0,
        "exclusion_rate": 0.0,
        "preprocessings": "SNV",
    }
    if cv_val is not None or cv_test is not None or cv_train is not None:
        store.save_prediction(
            **common,
            fold_id="fold_0",
            partition="val",
            val_score=cv_val,
            test_score=cv_test,
            train_score=cv_train,
            scores={
                "val": {metric: cv_val},
                "test": {metric: cv_test},
            },
        )
    elif final_test is None:
        # A real CV row whose primary and secondary scalar scores are all NULL.
        store.save_prediction(
            **common,
            fold_id="fold_0",
            partition="val",
            val_score=None,
            test_score=None,
            train_score=None,
            scores={},
        )

    if final_test is not None:
        store.save_prediction(
            **common,
            fold_id="final",
            partition="test",
            val_score=None,
            test_score=final_test,
            train_score=final_train,
            scores={"test": {metric: final_test}, "train": {metric: final_train}},
            refit_context="standalone",
        )

    if final_agg_test is not None:
        store.save_prediction(
            **common,
            fold_id="final_agg",
            partition="test",
            val_score=None,
            test_score=final_agg_test,
            train_score=final_train,
            scores={"test": {metric: final_agg_test}},
            refit_context="standalone",
        )

    store.update_chain_summary(chain_id)
    store.complete_pipeline(
        pipeline_id,
        best_val=cv_val if cv_val is not None else 0.0,
        best_test=final_test if final_test is not None else (cv_test or 0.0),
        metric=metric,
        duration_ms=100,
    )
    return chain_id


def _populate(store: WorkspaceStore) -> None:
    run_id = store.begin_run(
        "results summary parity",
        config={"n": 5},
        datasets=[{"name": item["name"], "path": item["path"]} for item in LINKED_DATASETS],
    )

    # Higher-is-better: ties, a NULL CV score, refit-only, synthetic refit,
    # variant-param merge, and a best final score outside the top-five CV rows.
    _add_chain(store, run_id, label="r2-tie-z", dataset_name="R2 Exact", metric="r2", cv_val=0.95, cv_test=0.94, cv_train=0.98, best_params={"n_components": 7, "shared": "best"})
    _add_chain(store, run_id, label="r2-tie-a", dataset_name="R2 Exact", metric="r2", cv_val=0.95, cv_test=0.93, cv_train=0.97)
    _add_chain(store, run_id, label="r2-third", dataset_name="R2 Exact", metric="r2", cv_val=0.90, cv_test=0.89, cv_train=0.94)
    _add_chain(store, run_id, label="r2-fourth", dataset_name="R2 Exact", metric="r2", cv_val=0.85, cv_test=0.84, cv_train=0.91)
    _add_chain(store, run_id, label="r2-fifth", dataset_name="R2 Exact", metric="r2", cv_val=0.80, cv_test=0.79, cv_train=0.88)
    _add_chain(store, run_id, label="r2-best-final-outside-top5", dataset_name="R2 Exact", metric="r2", cv_val=0.10, cv_test=0.11, cv_train=0.20, final_test=0.99, final_train=1.0)
    _add_chain(store, run_id, label="r2-null-cv", dataset_name="R2 Exact", metric="r2")
    _add_chain(store, run_id, label="r2-refit-only", dataset_name="R2 Exact", metric="r2", final_test=0.77, final_train=0.80, final_agg_test=0.78)

    # Lower-is-better RMSE. Folder-prefix dataset linking is exercised by the
    # stored dataset name starting with the linked path's folder name.
    _add_chain(store, run_id, label="rmse-best", dataset_name="spectra_rmse_augmented", metric="rmse", cv_val=0.10, cv_test=0.11, cv_train=0.08)
    _add_chain(store, run_id, label="rmse-tie-z", dataset_name="spectra_rmse_augmented", metric="rmse", cv_val=0.12, cv_test=0.13, cv_train=0.10)
    _add_chain(store, run_id, label="rmse-tie-a", dataset_name="spectra_rmse_augmented", metric="rmse", cv_val=0.12, cv_test=0.14, cv_train=0.09)
    _add_chain(store, run_id, label="rmse-fourth", dataset_name="spectra_rmse_augmented", metric="rmse", cv_val=0.20, cv_test=0.21, cv_train=0.18)
    _add_chain(store, run_id, label="rmse-fifth", dataset_name="spectra_rmse_augmented", metric="rmse", cv_val=0.30, cv_test=0.31, cv_train=0.28)
    _add_chain(store, run_id, label="rmse-best-final-outside-top5", dataset_name="spectra_rmse_augmented", metric="rmse", cv_val=0.90, cv_test=0.91, cv_train=0.88, final_test=0.05, final_train=0.04)
    _add_chain(store, run_id, label="rmse-null-cv", dataset_name="spectra_rmse_augmented", metric="rmse")
    _add_chain(store, run_id, label="rmse-refit-only", dataset_name="spectra_rmse_augmented", metric="rmse", final_test=0.40, final_train=0.35)

    # The owner-defined default for unknown metrics is higher-is-better and is
    # shared by top-CV and best-final selection.
    for index, score in enumerate((0.10, 0.20, 0.30, 0.40, 0.50, 0.60), start=1):
        _add_chain(
            store,
            run_id,
            label=f"unknown-{index}",
            dataset_name="Mystery Score Batch",
            metric="custom_gain",
            cv_val=score,
            cv_test=score,
            cv_train=score,
        )

    store.complete_run(run_id, {"pipelines": 22})


def generate(output_dir: Path) -> dict:
    """Generate fixture files and return the Python oracle payload."""
    output_dir.mkdir(parents=True, exist_ok=True)
    database_target = output_dir / "workspace_store_v5_summary.sqlite"
    links_target = output_dir / "workspace_store_v5_summary_dataset_links.json"
    response_target = output_dir / "workspace_store_v5_summary.response.json"

    with tempfile.TemporaryDirectory(prefix="n4a-summary-fixture-") as temp_dir:
        workspace_path = Path(temp_dir) / "workspace"
        uuid_source = _DeterministicUuid4()
        with patch("nirs4all.pipeline.storage.workspace_store.uuid4", uuid_source):
            store = WorkspaceStore(workspace_path)
            try:
                _populate(store)
                response = _build_results_summary_payload(
                    store,
                    WORKSPACE_ID,
                    LINKED_DATASETS,
                    n=5,
                )
            finally:
                store.close()

        # Copy only after close so WAL contents have been checkpointed. The
        # standalone fixture intentionally ships without -wal/-shm siblings.
        shutil.copyfile(workspace_path / "store.sqlite", database_target)

    links_payload = {
        "version": "1.0",
        "schema_version": 1,
        "datasets": LINKED_DATASETS,
        "groups": [],
        "last_updated": "2026-09-01T00:00:00",
    }
    links_target.write_text(json.dumps(links_payload, indent=2) + "\n", encoding="utf-8")
    response_target.write_text(json.dumps(response, indent=2) + "\n", encoding="utf-8")
    return response


def replay(output_dir: Path) -> dict:
    """Replay the committed standalone SQLite fixture through the oracle."""
    database_source = output_dir / "workspace_store_v5_summary.sqlite"
    links_document = json.loads((output_dir / "workspace_store_v5_summary_dataset_links.json").read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory(prefix="n4a-summary-replay-") as temp_dir:
        workspace_path = Path(temp_dir) / "workspace"
        workspace_path.mkdir()
        shutil.copyfile(database_source, workspace_path / "store.sqlite")
        store = WorkspaceStore(workspace_path)
        try:
            return _build_results_summary_payload(
                store,
                WORKSPACE_ID,
                links_document["datasets"],
                n=5,
            )
        finally:
            store.close()


def verify(output_dir: Path) -> None:
    """Raise if the static Store and response no longer form an exact pair."""
    expected = json.loads((output_dir / "workspace_store_v5_summary.response.json").read_text(encoding="utf-8"))
    actual = replay(output_dir)
    if actual != expected:
        raise RuntimeError("workspace_store_v5_summary fixture differs from its Python oracle")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, default=FIXTURE_DIR)
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    if args.verify:
        verify(args.output_dir)
    else:
        generate(args.output_dir)


if __name__ == "__main__":
    main()

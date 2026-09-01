"""Parity checks for the public Store-v5 results-summary oracle fixture."""

from __future__ import annotations

import json
import sqlite3
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = ROOT / "sidecar" / "tests" / "fixtures"
GENERATOR_PATH = FIXTURE_DIR / "generate_workspace_store_v5_summary_fixture.py"


def _read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _dataset(payload: dict, name: str) -> dict:
    return next(dataset for dataset in payload["datasets"] if dataset["dataset_name"] == name)


def test_generated_results_summary_matches_committed_python_oracle(tmp_path: Path) -> None:
    subprocess.run(
        [sys.executable, str(GENERATOR_PATH), "--output-dir", str(tmp_path)],
        check=True,
    )
    generated = _read_json(tmp_path / "workspace_store_v5_summary.response.json")
    committed = _read_json(FIXTURE_DIR / "workspace_store_v5_summary.response.json")

    assert generated == committed
    assert (tmp_path / "workspace_store_v5_summary.sqlite").is_file()
    assert not (tmp_path / "workspace_store_v5_summary.sqlite-wal").exists()
    assert not (tmp_path / "workspace_store_v5_summary.sqlite-shm").exists()


def test_committed_store_fixture_replays_exact_results_summary_oracle(tmp_path: Path) -> None:
    subprocess.run(
        [sys.executable, str(GENERATOR_PATH), "--output-dir", str(FIXTURE_DIR), "--verify"],
        check=True,
    )
    actual = _read_json(FIXTURE_DIR / "workspace_store_v5_summary.response.json")

    # Higher/lower metric directions, refit-only rows, best-final rows outside
    # the top-five CV result, and synthetic-final fallback are all observable.
    r2 = _dataset(actual, "R2 Exact")
    assert r2["linked_dataset_id"] == "dataset-r2-exact"
    assert [chain["model_name"] for chain in r2["top_chains"]] == [
        "r2-tie-z",
        "r2-tie-a",
        "r2-third",
        "r2-fourth",
        "r2-fifth",
        "r2-refit-only-second",
        "r2-refit-only",
        "r2-best-final-outside-top5",
    ]
    assert r2["top_chains"][0]["synthetic_refit"] is True
    assert r2["top_chains"][0]["variant_params"] == {
        "n_components": 7,
        "scale": True,
        "shared": "best",
    }
    assert r2["top_chains"][-3]["is_refit_only"] is True
    assert r2["top_chains"][-2]["is_refit_only"] is True
    assert r2["top_chains"][-1]["final_test_score"] == 0.99

    rmse = _dataset(actual, "spectra_rmse_augmented")
    assert rmse["linked_dataset_id"] == "dataset-rmse-folder"
    assert [chain["model_name"] for chain in rmse["top_chains"][:5]] == [
        "rmse-best",
        "rmse-tie-z",
        "rmse-tie-a",
        "rmse-fourth",
        "rmse-fifth",
    ]
    assert rmse["top_chains"][-1]["final_test_score"] == 0.05

    # NULL CV scores are persisted and excluded from the selected top chains.
    database_copy = tmp_path / "workspace_store_v5_summary.sqlite"
    database_copy.write_bytes((FIXTURE_DIR / "workspace_store_v5_summary.sqlite").read_bytes())
    database_uri = f"file:{database_copy}?mode=ro"
    with sqlite3.connect(database_uri, uri=True) as connection:
        null_rows = connection.execute("SELECT model_name, cv_val_score FROM v_chain_summary WHERE model_name LIKE '%null-cv'").fetchall()
        final_ties = connection.execute(
            "SELECT model_name, chain_id FROM chains WHERE model_name LIKE 'r2-best-final%' ORDER BY chain_id ASC"
        ).fetchall()
    assert len(null_rows) == 2
    assert all(row[1] is None for row in null_rows)
    assert final_ties == [
        ("r2-best-final-outside-top5", "175ec185-ffb5-5788-9e51-f6185a2e582c"),
        ("r2-best-final-tie", "3cb8e83e-ae7f-51bd-a20f-fdcfda63a82d"),
    ]
    assert r2["top_chains"][-1]["chain_id"] == final_ties[0][1]

    # The public summary policy applies its higher-is-better default to every
    # ranking stage for an unknown metric.
    unknown = _dataset(actual, "Mystery Score Batch")
    assert unknown["linked_dataset_id"] == "dataset-unknown-prefix"
    assert [chain["model_name"] for chain in unknown["top_chains"]] == [
        "unknown-6",
        "unknown-5",
        "unknown-4",
        "unknown-3",
        "unknown-2",
    ]

    # Top-CV SQL ties follow the owner-defined chain_id ascending tie breaker.
    rmse_ties = rmse["top_chains"][1:3]
    assert rmse_ties[0]["chain_id"] < rmse_ties[1]["chain_id"]

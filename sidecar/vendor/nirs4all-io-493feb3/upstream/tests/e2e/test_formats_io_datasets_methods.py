# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Ecosystem E2E entrypoint for the formats -> io -> datasets -> methods scenario."""

from __future__ import annotations

import json
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import numpy as np

import nirs4all_io as nio

SCENARIO_ID = "e2e-formats-io-datasets-methods-language-bindings"
REFERENCE_CASES: tuple[tuple[str, dict[str, Any]], ...] = (
    (
        "io_single_source_split",
        {
            "blocks": ("X",),
            "sample_of": {"o1": "s1", "o2": "s2", "o3": "s3"},
            "targets": {"Moisture": "numeric"},
            "extra_meta": ("site",),
            "split": {"o1": "cal", "o2": "val", "o3": "test"},
        },
    ),
    (
        "io_multi_source",
        {
            "blocks": ("X1", "X2"),
            "sample_of": {"o1": "s1", "o2": "s2", "o3": "s3"},
            "targets": {"Moisture": "numeric"},
            "extra_meta": ("site", "batch"),
        },
    ),
)


def _workspace_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _datasets_root() -> Path:
    root = _workspace_root() / "nirs4all-datasets"
    if not root.exists():
        raise FileNotFoundError(f"missing sibling repository: {root}")
    return root


def _import_nirs4all_datasets() -> Any:
    datasets_root = _datasets_root()
    datasets_src = datasets_root / "src"
    if str(datasets_src) not in sys.path:
        sys.path.insert(0, str(datasets_src))
    import nirs4all_datasets as n4ad

    return n4ad


def _write_v2_leaf(
    leaf: Path,
    *,
    blocks: Sequence[str],
    sample_of: dict[str, str],
    targets: dict[str, str],
    extra_meta: Sequence[str] = (),
    split: dict[str, str] | None = None,
) -> None:
    """Write a small schema-2.0 leaf, then let nirs4all-datasets canonicalize it."""
    leaf.mkdir(parents=True, exist_ok=True)
    observations = tuple(sample_of)

    spectral_blocks = []
    for block_index, block_id in enumerate(blocks):
        rows = []
        for row_index, observation_id in enumerate(observations):
            base = 0.1 * (block_index + 1) + 0.01 * row_index
            rows.append(f"{observation_id};{base:.6f};{base + 0.1:.6f};{base + 0.2:.6f}")
        (leaf / f"{block_id}.csv").write_text(
            "observation_id;1100;1102;1104\n" + "\n".join(rows) + "\n",
            encoding="utf-8",
        )
        spectral_blocks.append(
            {
                "block_id": block_id,
                "x_file": f"{block_id}.csv",
                "instrument_name": f"inst_{block_id}",
                "axis_unit": "nm",
                "axis_min": "1100",
                "axis_max": "1104",
                "n_rows": len(observations),
                "n_spectral_variables": 3,
            }
        )

    y_header = ["observation_id", *targets]
    y_rows = []
    for row_index, observation_id in enumerate(observations):
        cells = [observation_id]
        for target_type in targets.values():
            if target_type != "numeric":
                raise ValueError("this E2E fixture only emits numeric targets")
            cells.append(f"{10.0 + row_index:.6f}")
        y_rows.append(";".join(cells))
    (leaf / "Y.csv").write_text(";".join(y_header) + "\n" + "\n".join(y_rows) + "\n", encoding="utf-8")

    metadata_columns = ["dataset_id", "observation_id", "sample_id"]
    if split is not None:
        metadata_columns.append("split_original")
    metadata_columns.extend(extra_meta)
    metadata_rows = []
    for row_index, observation_id in enumerate(observations):
        cells = [leaf.name, observation_id, sample_of[observation_id]]
        if split is not None:
            cells.append(split[observation_id])
        for column_index, _name in enumerate(extra_meta):
            cells.append(f"m{column_index + 1}_{row_index + 1}")
        metadata_rows.append(";".join(cells))
    (leaf / "M.csv").write_text(";".join(metadata_columns) + "\n" + "\n".join(metadata_rows) + "\n", encoding="utf-8")

    card = {
        "dataset_id": leaf.name,
        "dataset_name": leaf.name.replace("_", " ").title(),
        "spectral_organization": {
            "organization_type": "multi_block" if len(blocks) > 1 else "single_block",
            "alignment_level": "sample",
            "n_blocks": len(blocks),
        },
        "spectral_blocks": spectral_blocks,
        "target_summary": {
            "target_variables": list(targets),
            "target_types": {name: "regression" for name in targets},
        },
        "metadata_fields_summary": {"m_fields": metadata_columns},
        "split_summary": {
            "original_split_available": split is not None,
            "split_should_be_preserved_not_applied": True,
        },
        "license_summary": {
            "public_release_allowed": True,
            "license_name": "CC-BY-4.0",
            "rights_notes": "synthetic deterministic E2E fixture",
        },
        "source_summary": {"source_name": "NIRS4ALL E2E fixture", "source_url": "https://example.invalid/nirs4all-e2e"},
        "detected_sources": [{"url": "https://example.invalid/nirs4all-e2e"}],
        "associated_publications": [{"doi": "10.5281/zenodo.1", "title": "NIRS4ALL E2E fixture"}],
    }
    (leaf / "dataset_card.json").write_text(json.dumps(card, sort_keys=True), encoding="utf-8")


def _build_reference_dataset(n4ad: Any, registry_root: Path, name: str, options: dict[str, Any]) -> Any:
    from nirs4all_datasets.bootstrap import build_descriptor_from_card
    from nirs4all_datasets.dataset import NirsDataset
    from nirs4all_datasets.organize import organize

    source_leaf = registry_root / "sources" / name
    _write_v2_leaf(source_leaf, **options)
    descriptor, _ = build_descriptor_from_card(source_leaf)
    result = organize(source_leaf, descriptor, registry_root / "datasets")
    assert result.dataset_id == name
    assert (result.dataset_dir / "canonical" / "dataset.json").exists()

    # Smoke the public entry point too; a catalog-free NirsDataset is then used
    # below so the IO bridge remains independent from catalog lookup policy.
    assert hasattr(n4ad, "NirsDataset")
    return NirsDataset(result.dataset_dir, descriptor)


def _expected_metadata(reference: Any) -> tuple[list[str], np.ndarray | None]:
    frames: list[Any] = []
    metadata = reference.metadata()
    split = reference.split()
    if metadata is not None:
        frames.append(metadata)
    if split is not None:
        frames.append(split)
    if not frames:
        return [], None

    combined = frames[0]
    for frame in frames[1:]:
        combined = combined.merge(frame, on="sample_id", how="outer", validate="1:1")

    sample_order = [str(value) for value in reference.sample_ids().tolist()]
    aligned = combined.set_index("sample_id").loc[sample_order]
    return aligned.columns.tolist(), aligned.to_numpy()


def _validate_reference_dataset(reference: Any) -> dict[str, Any]:
    package = nio.load(reference, target="dataset_package")
    summary = nio.describe_dataset_package(reference)
    assembled = package.to_assembled()
    manifest = package.manifest()

    assert package.name == reference.id
    assert isinstance(summary, dict)
    assert summary["name"] == reference.id
    assert summary["manifest"]["root"] == manifest.root
    assert set(assembled.blocks) == {"train"}
    assert summary["identity"]["row_position_fallback"] == package.row_position_fallback.to_dict()
    assert len(package.row_position_fallback.fingerprint) == 64
    assert package.row_position_fallback.reason

    block = assembled.blocks["train"]
    sample_order = [str(value) for value in reference.sample_ids().tolist()]
    assert block.n_samples == len(sample_order)
    # DatasetPackage v3 deliberately extends each partition descriptor with the
    # ordered source ids. This is an incompatible canonical-wire change from v2,
    # not a fallback-compatible omission: relations and feature blocks need the
    # same source identity on both sides of this E2E bridge.
    assert summary["schema_version"] == 3
    assert summary["partitions"] == {
        "train": {"n_samples": len(sample_order), "source_ids": list(reference.sources())}
    }
    assert len(block.X) == len(reference.sources())

    for index, source_id in enumerate(reference.sources()):
        expected_x = reference.x(source=source_id)
        expected_wavelengths = reference.wavelengths(source_id)
        np.testing.assert_allclose(block.X[index], expected_x, rtol=1e-6, atol=1e-8)
        np.testing.assert_allclose(
            np.asarray(block.feature_headers[index], dtype=float),
            expected_wavelengths,
            rtol=1e-9,
            atol=1e-12,
            equal_nan=True,
        )

    expected_y = reference.y()
    assert expected_y is not None
    expected_y_aligned = expected_y.set_index("sample_id").loc[sample_order, block.y_headers]
    np.testing.assert_allclose(block.y, expected_y_aligned.to_numpy(), rtol=1e-6, atol=1e-8)

    expected_metadata_columns, expected_metadata_values = _expected_metadata(reference)
    if expected_metadata_values is None:
        assert block.metadata is None
    else:
        assert block.metadata is not None
        # v2 assembled artifacts preserve declared identity as aligned metadata;
        # check the catalog's original values, not a row-position reconstruction.
        provenance = summary["identity"]["provenance"]
        assert provenance["sample_id"] == "sample_id"
        assert provenance["observation_id"] == "observation_id"
        identity_columns: list[str] = []
        identity_value_columns: list[np.ndarray] = []
        for source_index, source_id in enumerate(reference.sources()):
            # Joined secondary blocks retain their source-qualified identity
            # columns; only the primary block owns the unqualified names.
            prefix = "" if source_index == 0 else f"{source_id}__"
            identity_columns.extend([f"{prefix}sample_id", f"{prefix}observation_id"])
            identity_value_columns.extend(
                [
                    reference.sample_ids(source_id).astype(str),
                    reference.observation_ids(source_id).astype(str),
                ]
            )
        identity_values = np.column_stack(identity_value_columns)
        assert block.metadata.columns.tolist() == identity_columns + expected_metadata_columns
        np.testing.assert_array_equal(
            block.metadata.to_numpy(),
            np.column_stack([identity_values, expected_metadata_values]),
        )

    expected_payload_count = len(block.X) + 1 + (0 if block.metadata is None else 1) + (0 if block.weights is None else 1)
    assert len(manifest.entries) == expected_payload_count
    dense_x = np.concatenate([np.asarray(matrix, dtype=np.float64) for matrix in block.X], axis=1)
    y = np.asarray(block.y, dtype=np.float64)
    assert y.ndim == 2 and y.shape[1] >= 1
    assert dense_x.shape[0] == y.shape[0] == block.n_samples
    assert np.isfinite(dense_x).all()
    assert np.isfinite(y[:, 0]).all()

    return {
        "dataset_id": reference.id,
        "sources": reference.sources(),
        "summary": summary,
        "payload_ids": [entry.id for entry in manifest.entries],
        "target_headers": list(block.y_headers),
        "metadata_columns": [] if block.metadata is None else block.metadata.columns.tolist(),
        "web_core_fixture": {
            "schema": "n4a.io.web_core_fixture.v1",
            "dataset_id": reference.id,
            "feature_policy": "single_source" if len(block.X) == 1 else "dense_fused_sources",
            "source_count": len(block.X),
            "feature_block_shapes": [[int(matrix.shape[0]), int(matrix.shape[1])] for matrix in block.X],
            "manifest_root": manifest.root,
            "rows": int(dense_x.shape[0]),
            "cols": int(dense_x.shape[1]),
            "target_header": str(block.y_headers[0]),
            "X": dense_x.tolist(),
            "y": y[:, 0].tolist(),
        },
    }


def test_assemble_reference_datasets(artifacts_dir: Path) -> None:
    n4ad = _import_nirs4all_datasets()
    registry_root = artifacts_dir / "generated-nirs4all-datasets"

    validated = [
        _validate_reference_dataset(_build_reference_dataset(n4ad, registry_root, name, options))
        for name, options in REFERENCE_CASES
    ]

    out = artifacts_dir / "assembled-datasets.json"
    out.write_text(
        json.dumps(
            {
                "scenario": SCENARIO_ID,
                "workspace_root": str(_workspace_root()),
                "datasets_code_root": str(_datasets_root()),
                "generated_registry_root": str(registry_root),
                "datasets": validated,
            },
            ensure_ascii=True,
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    assert out.exists()

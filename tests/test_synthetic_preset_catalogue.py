"""The Rust UI catalogue and diagnostic backend share the exact V0.9.1 data."""
import hashlib
import json
from pathlib import Path


def test_shared_catalogue_matches_the_immutable_pre_migration_reference():
    root = Path(__file__).resolve().parents[1]
    actual = json.loads((root / "api/synthetic_datasets.json").read_text())
    # Independently extracted from the six literal SyntheticPresetInfo calls
    # in tag 0.9.1, api/datasets.py. No Git history is needed in a source tarball.
    digest = hashlib.sha256(json.dumps(actual, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    assert digest == "e44e7aad0524a6ec721cc9ceaf47055e762bb4f9a18e08a61488878475e4e038"


def test_diagnostic_backend_consumes_the_same_catalogue():
    import asyncio

    from api.datasets import get_synthetic_presets

    actual = asyncio.run(get_synthetic_presets())
    expected = json.loads((Path(__file__).resolve().parents[1] / "api/synthetic_datasets.json").read_text())
    assert {"presets": [preset.model_dump() for preset in actual["presets"]]} == expected

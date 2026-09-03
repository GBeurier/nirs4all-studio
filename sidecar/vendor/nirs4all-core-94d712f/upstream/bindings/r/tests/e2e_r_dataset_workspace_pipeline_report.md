# R Dataset/Workspace/Pipeline E2E Coverage

This lane now checks the provider/dataset/IO payload invariants, writes
`workspace.n4a.json` and `pipeline.n4a.json`, reopens both artifacts, reruns the
saved pipeline, and verifies the reproduced split, targets, RMSE values, and
predictions.

When `tests/parity/expected/portable_python_oracle.json` is present, the same R
pipeline artifact is also executed on the Python oracle dataset and compared
against the `portable_methods_pipeline` oracle case.

Remaining gap: the existing Python oracle covers the synthetic portable parity
dataset. It does not yet include an oracle generated from the provider-backed
dataset assembled by `scripts/e2e/prepare_r_dataset_io_pipeline.py`, so that
dataset is checked for provenance hashes, shape, finite targets/features, split
roundtrip, RMSE roundtrip, and prediction reproducibility rather than direct
Python-oracle prediction equality.

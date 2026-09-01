# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Cross-language golden parity (EPIC 12.3): the pyo3 binding's to_spec / infer
output, canonicalized, is byte-identical to the committed contract goldens — the
same goldens the Rust facade and Python MVP reproduce. This proves the binding is
on the byte-for-byte contract, not merely functional."""
import json
from pathlib import Path

import nirs4all_io as nio

CONTRACT = Path(__file__).resolve().parents[3] / "tests/goldens/contract"
CORPUS = CONTRACT / "corpus"


def canonical(obj) -> str:
    # The canonical-JSON wire contract (bindings/SPEC.md §2): 2-space indent,
    # sorted keys, ": " after keys, non-ASCII verbatim, finite-only, trailing \n.
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n"


def golden(name: str) -> str:
    return (CONTRACT / name).read_text()


def test_to_spec_dir_is_byte_identical_to_golden():
    # Directory inputs produce relative filenames (no abspath), so no path
    # normalization is needed — a direct byte comparison.
    for case, gold in [
        ("train_test", "ts_dir_train_test.to_spec.canonical"),
        ("x_y_separate", "ts_dir_x_y.to_spec.canonical"),
    ]:
        spec = nio.to_spec(str(CORPUS / case))
        assert canonical(spec) == golden(gold), f"to_spec parity drift for {case}"


def test_infer_dir_is_byte_identical_to_golden():
    base = str(CONTRACT)  # the resolved abspath prefix the goldens normalize to <CORPUS>
    for case, gold in [
        ("single_combined", "inf_single_combined.infer.canonical"),
        ("train_test", "inf_train_test.infer.canonical"),
        ("x_y_separate", "inf_x_y_separate.infer.canonical"),
    ]:
        plan = nio.infer(str(CORPUS / case))
        produced = canonical(plan).replace(f"{base}/", "<CORPUS>/").replace(base, "<CORPUS>")
        assert produced == golden(gold), f"infer parity drift for {case}"

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


def _normalize_contract_paths(payload: str, base: str | Path = CONTRACT) -> str:
    base_text = str(base)
    escaped_base = base_text.replace("\\", "\\\\")
    for prefix in (escaped_base, base_text):
        payload = payload.replace(f"{prefix}\\\\", "<CORPUS>/")
        payload = payload.replace(f"{prefix}/", "<CORPUS>/")
        payload = payload.replace(prefix, "<CORPUS>")
    return payload.replace("\\\\", "/")


def test_contract_path_normalization_handles_windows_json_escapes():
    base = r"D:\a\nirs4all-io\nirs4all-io\tests\goldens\contract"
    payload = (
        '{"ref": "'
        r"D:\\a\\nirs4all-io\\nirs4all-io\\tests\\goldens\\contract\\corpus\\single_combined"
        '"}'
    )
    assert _normalize_contract_paths(payload, base) == '{"ref": "<CORPUS>/corpus/single_combined"}'


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
    for case, gold in [
        ("single_combined", "inf_single_combined.infer.canonical"),
        ("train_test", "inf_train_test.infer.canonical"),
        ("x_y_separate", "inf_x_y_separate.infer.canonical"),
    ]:
        plan = nio.infer(str(CORPUS / case))
        produced = _normalize_contract_paths(canonical(plan))
        assert produced == golden(gold), f"infer parity drift for {case}"

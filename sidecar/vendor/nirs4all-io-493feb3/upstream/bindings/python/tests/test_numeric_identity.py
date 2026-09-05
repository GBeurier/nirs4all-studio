# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Installed native wheel regressions: identities cross the real file loader."""
import pytest

import nirs4all_io as nio


def _spec(left, right):
    return {
        "sample_index": {"by": "id", "key": "sid"},
        "sources": [
            {"id": "x", "role": "mixed", "input": str(left), "key": "sid",
             "columns": [{"role": "features", "select": ["1000"]}]},
            {"id": "y", "role": "targets", "input": str(right), "key": "sid",
             "columns": [{"role": "targets", "select": ["y"]}],
             "join": {"left": "x", "right": "y", "left_on": "sid", "right_on": "sid",
                      "how": "1:1", "coverage": "complete"}},
        ],
    }


def test_native_csv_refuses_mismatched_large_integer_identity(tmp_path):
    left, right = tmp_path / "x.csv", tmp_path / "y.csv"
    left.write_text("sid;1000\n9007199254740992;1.5\n", encoding="utf-8")
    right.write_text("sid;y\n9007199254740993;42\n", encoding="utf-8")
    with pytest.raises(ValueError, match="coverage 'complete'"):
        nio.load(_spec(left, right))


@pytest.mark.parametrize("file_format", ["csv", "parquet"])
def test_native_tabular_large_ids_preserve_target_alignment(tmp_path, file_format):
    left, right = tmp_path / f"x.{file_format}", tmp_path / f"y.{file_format}"
    ids = [2**53, 2**53 + 1, 2**63 - 1, -(2**63)]
    if file_format == "csv":
        left.write_text("sid;1000\n" + "".join(f"{identity};{index + 1}\n" for index, identity in enumerate(ids)), encoding="utf-8")
        right.write_text("sid;y\n" + "".join(f"{identity};{target}\n" for identity, target in zip(ids[::-1], [40, 30, 20, 10], strict=True)), encoding="utf-8")
    else:
        pa = pytest.importorskip("pyarrow")
        pq = pytest.importorskip("pyarrow.parquet")
        pq.write_table(pa.table({"sid": pa.array(ids, type=pa.int64()), "1000": [1., 2., 3., 4.]}), left)
        pq.write_table(pa.table({"sid": pa.array(ids[::-1], type=pa.int64()), "y": [40., 30., 20., 10.]}), right)
    full = nio.assembled_full(_spec(left, right))
    block = next(iter(full["blocks"].values()))
    assert block["y"] == {"n_rows": 4, "n_cols": 1, "data": [10., 20., 30., 40.]}

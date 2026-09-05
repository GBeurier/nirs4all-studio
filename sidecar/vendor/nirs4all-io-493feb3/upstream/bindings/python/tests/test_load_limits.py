"""Resource-policy tests against the installed native wheel, using tiny inputs."""
import gzip
import zipfile

import pytest

import nirs4all_io as nio


@pytest.mark.parametrize("suffix", [".csv", ".csv.gz", ".csv.zip"])
def test_read_and_decompression_limits_are_host_configurable(tmp_path, suffix):
    data = b"a;b\n1;2\n3;4\n"
    path = tmp_path / ("x" + suffix)
    if suffix.endswith(".gz"):
        path.write_bytes(gzip.compress(data))
    elif suffix.endswith(".zip"):
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("x.csv", data)
    else:
        path.write_bytes(data)
    expected = nio.load(path)
    with pytest.raises(ValueError, match="limit"):
        nio.load(path, limits={"max_decoded_file_bytes": 5})
    assert nio.load(path, limits={"max_decoded_file_bytes": 100}) == expected
    assert nio.load(path, limits="unlimited") == expected
    with pytest.raises(ValueError, match="budget"):
        nio.load(path, target="dataset_package", limits={"max_rows": 1})
    with pytest.raises(ValueError, match="limit"):
        nio.load(path, limits={"max_row": 1})


def test_parquet_shape_and_decoded_limits_preserve_projection(tmp_path):
    import pyarrow as pa
    import pyarrow.parquet as pq
    path = tmp_path / "x.parquet"
    pq.write_table(pa.table({"a": [1., 2.], "b": [3., 4.]}), path)
    expected = nio.load(path)
    for limits in [{"max_rows": 1}, {"max_columns": 1}, {"max_cells": 3}, {"max_decoded_file_bytes": 1}]:
        with pytest.raises(ValueError, match="limit"):
            nio.load(path, limits=limits)
    assert nio.load(path, limits="unlimited") == expected
    spec = {"sources": [{"id": "x", "role": "features", "input": str(path), "params": {"format": {"columns": ["a"]}}}]}
    assert nio.load(spec, limits={"max_columns": 1})["blocks"]["train"]["n_samples"] == 2

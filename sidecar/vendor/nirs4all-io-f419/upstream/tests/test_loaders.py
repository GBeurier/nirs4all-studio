# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Tests for tabular loaders: per-format reads, NA policy, dtypes, param precedence."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from nirs4all_io.materialize import (
    NAError,
    apply_na_policy,
    coerce_numeric,
    effective_params,
    encode_categorical,
    infer_dtypes,
    read_table,
)
from nirs4all_io.spec import LoadingParams
from nirs4all_io.spec.dataset_spec import NaConfig
from nirs4all_io.spec.enums import FillMethod, HeaderUnit, NaPolicy


# --------------------------------------------------------------------------- #
# Per-format reading                                                          #
# --------------------------------------------------------------------------- #
def _formats_sample(relative: str) -> Path:
    workspace_root = next(
        (
            parent
            for parent in Path(__file__).resolve().parents
            if (parent / "nirs4all-formats").is_dir()
        ),
        None,
    )
    if workspace_root is None:
        pytest.skip("nirs4all-formats sibling repository not available")
    sample = workspace_root / "nirs4all-formats" / relative
    if not sample.exists():
        pytest.skip(f"nirs4all-formats sample not available: {relative}")
    return sample


def test_read_csv_semicolon_with_header(tmp_path):
    p = tmp_path / "data.csv"
    p.write_text("400;401;y\n0.1;0.2;1.0\n0.3;0.4;2.0\n", encoding="utf-8")
    table = read_table(p, LoadingParams(delimiter=";"))
    assert table.headers == ["400", "401", "y"]
    assert table.df.shape == (2, 3)
    assert table.dtypes == ["numeric", "numeric", "numeric"]


def test_read_csv_comma_decimal(tmp_path):
    p = tmp_path / "fr.csv"
    p.write_text("a;b\n1,5;2,5\n", encoding="utf-8")
    table = read_table(p, LoadingParams(delimiter=";", decimal_separator=","))
    assert table.df.iloc[0, 0] == 1.5


def test_read_numpy_npy(tmp_path):
    p = tmp_path / "x.npy"
    np.save(p, np.arange(12, dtype=float).reshape(4, 3))
    table = read_table(p)
    assert table.df.shape == (4, 3)
    assert table.headers == ["0", "1", "2"]
    assert table.header_unit == "index"


def test_read_parquet(tmp_path):
    p = tmp_path / "t.parquet"
    pd.DataFrame({"400": [0.1, 0.2], "y": [1, 2]}).to_parquet(p)
    table = read_table(p)
    assert list(table.df.columns) == ["400", "y"]


def test_read_excel(tmp_path):
    p = tmp_path / "book.xlsx"
    pd.DataFrame({"a": [1, 2], "b": [3, 4]}).to_excel(p, index=False)
    table = read_table(p)
    assert table.df.shape == (2, 2)


@pytest.mark.formats
def test_read_vendor_formats_recordset_strips_provenance_metadata():
    pytest.importorskip("nirs4all_formats")
    sample = _formats_sample("samples/jcamp_dx/BRUKAFFN.DX")

    table = read_table(sample)

    assert table.df.shape[0] == 1
    assert table.df.shape[1] > 1000
    assert table.header_unit == "nm"
    assert "sample_id" not in table.headers
    assert not any(header.startswith("nirs4all_formats.") for header in table.headers)
    assert all(header.startswith("x_") for header in table.headers)
    assert set(table.dtypes) == {"numeric"}


@pytest.mark.formats
def test_read_vendor_formats_preserves_explicit_header_unit():
    pytest.importorskip("nirs4all_formats")
    sample = _formats_sample("samples/jcamp_dx/BRUKAFFN.DX")

    table = read_table(sample, LoadingParams(header_unit=HeaderUnit.CM_1))

    assert table.header_unit == "cm-1"


# --------------------------------------------------------------------------- #
# NA policy                                                                   #
# --------------------------------------------------------------------------- #
def _na_df():
    return pd.DataFrame({"a": [1.0, np.nan, 3.0], "b": [4.0, 5.0, 6.0]})


def test_na_abort_raises():
    with pytest.raises(NAError, match="abort"):
        apply_na_policy(_na_df(), NaConfig(policy=NaPolicy.ABORT))


def test_na_auto_is_abort():
    with pytest.raises(NAError):
        apply_na_policy(_na_df(), NaConfig(policy=NaPolicy.AUTO))


def test_na_remove_sample():
    out, report = apply_na_policy(_na_df(), NaConfig(policy=NaPolicy.REMOVE_SAMPLE))
    assert len(out) == 2
    assert report["na_samples"] == 1


def test_na_remove_feature():
    out, report = apply_na_policy(_na_df(), NaConfig(policy=NaPolicy.REMOVE_FEATURE))
    assert list(out.columns) == ["b"]
    assert report["removed_features"] == ["a"]


def test_na_replace_value_and_mean():
    out_v, _ = apply_na_policy(_na_df(), NaConfig(policy=NaPolicy.REPLACE, fill_method=FillMethod.VALUE, fill_value=0.0))
    assert out_v.loc[1, "a"] == 0.0
    out_m, _ = apply_na_policy(_na_df(), NaConfig(policy=NaPolicy.REPLACE, fill_method=FillMethod.MEAN, fill_per_column=True))
    assert out_m.loc[1, "a"] == 2.0  # mean of [1,3]


def test_na_ignore_preserves():
    out, report = apply_na_policy(_na_df(), NaConfig(policy=NaPolicy.IGNORE))
    assert out.isna().any().any()
    assert report["na_preserved"] is True


def test_na_csv_via_read_table_default_ignores_when_set(tmp_path):
    p = tmp_path / "na.csv"
    p.write_text("a;b\n1;\n2;3\n", encoding="utf-8")
    table = read_table(p, LoadingParams(delimiter=";", na=NaConfig(policy=NaPolicy.IGNORE)))
    assert table.na_report["na_detected"] is True


# --------------------------------------------------------------------------- #
# dtype inference, param precedence, coercion                                 #
# --------------------------------------------------------------------------- #
def test_infer_dtypes_mixed():
    df = pd.DataFrame({"num": [1.0, 2.0], "txt": ["a", "b"], "flag": [True, False]})
    assert infer_dtypes(df) == ["numeric", "string", "bool"]


def test_effective_params_source_wins():
    glob = LoadingParams(delimiter=";", encoding="utf-8", has_header=True)
    src = LoadingParams(delimiter=",")
    eff = effective_params(glob, src)
    assert eff.delimiter == ","  # source overrides
    assert eff.encoding == "utf-8"  # falls through from global
    assert eff.has_header is True


def test_coerce_numeric_to_float32():
    df = pd.DataFrame({"a": ["1", "2"], "b": ["3.5", "x"]})
    arr = coerce_numeric(df)
    assert arr.dtype == np.float32
    assert np.isnan(arr[1, 1])  # "x" -> NaN


def test_encode_categorical_auto_factorizes_strings():
    codes, mapping = encode_categorical(pd.Series(["red", "green", "red"]), "auto")
    assert list(codes) == [0, 1, 0]
    assert mapping["categories"] == ["red", "green"]


def test_encode_categorical_numeric_passthrough():
    codes, mapping = encode_categorical(pd.Series([1.0, 2.0]), "auto")
    assert mapping is None
    assert list(codes) == [1.0, 2.0]

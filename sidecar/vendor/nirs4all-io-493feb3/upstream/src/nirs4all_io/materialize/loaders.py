# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Tabular loaders + NA policy + param precedence (Epic 4.1a / 4.2).

Copied and re-orchestrated from ``nirs4all`` ``data/loaders/*`` and
``data/loaders/base.py::apply_na_policy`` (COPY_PROVENANCE #5/#6); io stays
self-contained (no nirs4all import). A loader reads a file into a pandas
``DataFrame`` with string column names and pandas-inferred dtypes; column-role
numeric coercion / categorical encoding happen later (at role split). Vendor
spectroscopy files are decoded through ``nirs4all-formats`` — never reparsed here.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from ..spec.dataset_spec import LoadingParams, NaConfig
from ..spec.enums import FillMethod, NaPolicy, SpecError

_CSV_EXTS = {".csv", ".tsv", ".txt"}
_CSV_COMPOUND = (".csv.gz", ".csv.zip")
_NA_VALUES = ["NA", "N/A", ""]
_VENDOR_HINT_EXTS = {".0", ".1", ".2", ".dx", ".jdx", ".spc", ".spa", ".asd", ".sed", ".sig", ".sli", ".0a"}
_VENDOR_META_COLUMNS = {"sample_id"}
_VENDOR_META_PREFIXES = ("nirs4all_formats.",)
_VENDOR_FEATURE_PREFIX = "x_"


class NAError(SpecError):
    """NA values were found and the policy is 'abort'."""


class LoaderError(SpecError):
    """A file could not be read by any loader."""


@dataclass
class LoadedTable:
    df: pd.DataFrame
    headers: list[str]
    header_unit: str
    dtypes: list[str]  # per column: "numeric" | "string" | "datetime" | "bool"
    na_report: dict[str, Any] = field(default_factory=dict)
    source: str = ""


# --------------------------------------------------------------------------- #
# Param precedence (global -> source); source wins on explicitly-set fields    #
# --------------------------------------------------------------------------- #
def _merge_na(base: NaConfig, over: NaConfig) -> NaConfig:
    """Field-wise NA merge: the source configures NA but inherits unset fill bits."""
    if over.policy is NaPolicy.AUTO and over.fill_method is None:
        return base
    return NaConfig(
        policy=over.policy if over.policy is not NaPolicy.AUTO else base.policy,
        fill_method=over.fill_method or base.fill_method,
        fill_value=over.fill_value if over.fill_value is not None else base.fill_value,
        fill_per_column=over.fill_per_column,
    )


def effective_params(global_params: LoadingParams | None, source_params: LoadingParams | None) -> LoadingParams:
    """Merge global and source loading params (source wins on set fields)."""
    base = global_params or LoadingParams()
    over = source_params or LoadingParams()
    na = _merge_na(base.na, over.na)
    fmt_values = {**base.format.values, **over.format.values}
    from ..spec.dataset_spec import FormatParams

    merged = LoadingParams(
        delimiter=over.delimiter or base.delimiter,
        decimal_separator=over.decimal_separator or base.decimal_separator,
        has_header=over.has_header if over.has_header is not None else base.has_header,
        header_unit=over.header_unit or base.header_unit,
        signal_type=over.signal_type or base.signal_type,
        encoding=over.encoding or base.encoding,
        na=na,
        categorical=over.categorical or base.categorical,
        format=FormatParams(values=fmt_values),
    )
    return merged


# --------------------------------------------------------------------------- #
# NA policy (ported from nirs4all base.py::apply_na_policy)                    #
# --------------------------------------------------------------------------- #
def apply_na_policy(df: pd.DataFrame, na: NaConfig) -> tuple[pd.DataFrame, dict[str, Any]]:
    policy = NaPolicy.ABORT if na.policy is NaPolicy.AUTO else na.policy
    na_mask = df.isna()
    na_any_row = na_mask.any(axis=1)
    na_any_col = na_mask.any(axis=0)
    report: dict[str, Any] = {
        "strategy": policy.value,
        "na_detected": bool(na_any_row.any()),
        "na_count": int(na_mask.to_numpy().sum()),
        "na_samples": int(na_any_row.sum()),
        "na_features": int(na_any_col.sum()),
        "removed_samples": [],
        "removed_features": [],
        "fill_method": None,
        "na_preserved": False,
    }
    if not report["na_detected"]:
        return df, report

    if policy is NaPolicy.ABORT:
        first_row = df.index[na_any_row][0]
        first_col = df.loc[first_row].isna().idxmax()
        raise NAError(f"NA values detected and na_policy is 'abort'. First NA in column '{first_col}' (row: {first_row}).")
    if policy is NaPolicy.REMOVE_SAMPLE:
        report["removed_samples"] = df.index[na_any_row].tolist()
        return df[~na_any_row].copy().reset_index(drop=True), report
    if policy is NaPolicy.REMOVE_FEATURE:
        removed = df.columns[na_any_col].tolist()
        report["removed_features"] = removed
        return df.drop(columns=removed), report
    if policy is NaPolicy.REPLACE:
        method = na.fill_method or FillMethod.VALUE
        report["fill_method"] = method.value
        return _fill(df, na, method), report
    # IGNORE
    report["na_preserved"] = True
    return df, report


def _fill(df: pd.DataFrame, na: NaConfig, method: FillMethod) -> pd.DataFrame:
    numeric = df.select_dtypes(include="number").columns
    if method is FillMethod.VALUE:
        return df.fillna(na.fill_value if na.fill_value is not None else 0.0)
    if method is FillMethod.MEAN:
        return df.fillna(df[numeric].mean()) if na.fill_per_column else df.fillna(float(np.nanmean(df[numeric].to_numpy(dtype=float))))
    if method is FillMethod.MEDIAN:
        return df.fillna(df[numeric].median()) if na.fill_per_column else df.fillna(float(np.nanmedian(df[numeric].to_numpy(dtype=float))))
    if method is FillMethod.FORWARD_FILL:
        return df.ffill(axis=1)
    return df.bfill(axis=1)


# --------------------------------------------------------------------------- #
# dtype inference                                                             #
# --------------------------------------------------------------------------- #
def infer_dtypes(df: pd.DataFrame) -> list[str]:
    out: list[str] = []
    for col in df.columns:
        dt = df[col].dtype
        if pd.api.types.is_bool_dtype(dt):
            out.append("bool")
        elif pd.api.types.is_numeric_dtype(dt):
            out.append("numeric")
        elif pd.api.types.is_datetime64_any_dtype(dt):
            out.append("datetime")
        else:
            out.append("string")
    return out


# --------------------------------------------------------------------------- #
# Per-format readers                                                          #
# --------------------------------------------------------------------------- #
def _ext(path: Path) -> str:
    low = path.name.lower()
    for compound in _CSV_COMPOUND + (".tar.gz",):
        if low.endswith(compound):
            return compound
    return path.suffix.lower()


def _read_csv(path: Path, params: LoadingParams) -> tuple[pd.DataFrame, str]:
    delimiter = params.delimiter or ";"
    decimal = params.decimal_separator or "."
    has_header = True if params.has_header is None else params.has_header
    encoding = params.encoding or "utf-8"
    fmt = params.format.values
    kwargs: dict[str, Any] = {
        "sep": delimiter,
        "decimal": decimal,
        "header": 0 if has_header else None,
        "na_values": _NA_VALUES,
        "keep_default_na": True,
        "skip_blank_lines": True,
        "engine": "python",
    }
    if fmt.get("usecols") is not None:
        kwargs["usecols"] = fmt["usecols"]
    compression = "gzip" if path.name.lower().endswith(".gz") else "zip" if path.name.lower().endswith(".zip") else None
    if compression:
        kwargs["compression"] = compression
    try:
        df = pd.read_csv(path, encoding=encoding, **kwargs)
    except UnicodeDecodeError:
        df = pd.read_csv(path, encoding="latin-1", **kwargs)
    except Exception:
        kwargs["engine"] = "c"
        df = pd.read_csv(path, encoding=encoding, **kwargs)
    df.columns = [str(c) for c in df.columns]
    header_unit = params.header_unit.value if params.header_unit else ("text" if has_header else "index")
    return df, header_unit


def _read_numpy(path: Path, params: LoadingParams) -> tuple[pd.DataFrame, str]:
    fmt = params.format.values
    obj = np.load(path, allow_pickle=bool(fmt.get("allow_pickle", False)))
    if path.suffix.lower() == ".npz":
        key = fmt.get("key") or fmt.get("variable")
        arr = obj[key] if key else obj[list(obj.keys())[0]]
    else:
        arr = obj
    arr = np.asarray(arr)
    arr = arr.reshape(-1, 1) if arr.ndim == 1 else arr.reshape(arr.shape[0], -1)
    unit = params.header_unit.value if params.header_unit else "index"
    headers = [str(i) for i in range(arr.shape[1])] if unit == "index" else [f"feature_{i}" for i in range(arr.shape[1])]
    return pd.DataFrame(arr, columns=headers), unit


def _read_parquet(path: Path, params: LoadingParams) -> tuple[pd.DataFrame, str]:
    fmt = params.format.values
    read_kwargs: dict[str, Any] = {}
    if fmt.get("columns") is not None:
        read_kwargs["columns"] = fmt["columns"]
    df = pd.read_parquet(path, **read_kwargs)
    df.columns = [str(c) for c in df.columns]
    return df, params.header_unit.value if params.header_unit else "text"


def _read_excel(path: Path, params: LoadingParams) -> tuple[pd.DataFrame, str]:
    fmt = params.format.values
    has_header = True if params.has_header is None else params.has_header
    kwargs: dict[str, Any] = {"sheet_name": fmt.get("sheet_name", 0), "header": 0 if has_header else None}
    if fmt.get("usecols") is not None:
        kwargs["usecols"] = fmt["usecols"]
    if fmt.get("skiprows") is not None:
        kwargs["skiprows"] = fmt["skiprows"]
    df = pd.read_excel(path, **kwargs)
    if isinstance(df, dict):
        df = next(iter(df.values()))
    df.columns = [str(c) for c in df.columns]
    return df, params.header_unit.value if params.header_unit else "text"


def _read_vendor(path: Path, params: LoadingParams) -> tuple[pd.DataFrame, str]:
    """Decode a vendor spectroscopy file through nirs4all-formats (never reparsed here)."""
    try:
        import nirs4all_formats as nfmt  # lazy: optional dependency
    except ImportError as exc:  # pragma: no cover - depends on optional install
        raise LoaderError(f"reading vendor file {path.name!r} requires the 'nirs4all-formats' package (pip install nirs4all-io[formats])") from exc

    open_recordset = getattr(nfmt, "open_recordset", None)
    if not callable(open_recordset):
        raise LoaderError("installed 'nirs4all-formats' package does not expose open_recordset()")
    try:
        records = open_recordset(str(path))
    except Exception as exc:
        raise LoaderError(f"nirs4all-formats could not read vendor file {path.name!r}: {exc}") from exc
    if not hasattr(records, "to_pandas"):
        raise LoaderError("nirs4all-formats open_recordset() returned an object without to_pandas()")

    df = records.to_pandas()
    df.columns = [str(c) for c in df.columns]
    spectral_cols = [c for c in df.columns if c.startswith(_VENDOR_FEATURE_PREFIX)]
    if not spectral_cols:
        spectral_cols = [
            c
            for c in df.columns
            if c not in _VENDOR_META_COLUMNS
            and not any(c.startswith(prefix) for prefix in _VENDOR_META_PREFIXES)
            and pd.api.types.is_numeric_dtype(df[c])
        ]
    if not spectral_cols:
        raise LoaderError(f"nirs4all-formats produced no spectral columns for {path.name!r}")
    df = df.loc[:, spectral_cols].copy()
    unit = params.header_unit.value if params.header_unit else "nm"
    return df, unit


def read_table(path: str | Path, params: LoadingParams | None = None) -> LoadedTable:
    """Read a tabular/vendor file into a :class:`LoadedTable` (dtypes + NA policy applied)."""
    path = Path(path)
    params = params or LoadingParams()
    if not path.exists():
        raise LoaderError(f"file not found: {path}")
    ext = _ext(path)
    if ext in _CSV_EXTS or ext in _CSV_COMPOUND or (ext in {".gz", ".zip"} and ".csv" in path.name.lower()):
        df, unit = _read_csv(path, params)
    elif ext in {".npy", ".npz"}:
        df, unit = _read_numpy(path, params)
    elif ext in {".parquet", ".pq"}:
        df, unit = _read_parquet(path, params)
    elif ext in {".xlsx", ".xls", ".xlsm"}:
        df, unit = _read_excel(path, params)
    elif ext in _VENDOR_HINT_EXTS:
        df, unit = _read_vendor(path, params)
    else:
        # unknown extension: try CSV (nirs4all fallback), then vendor formats.
        try:
            df, unit = _read_csv(path, params)
        except Exception:
            df, unit = _read_vendor(path, params)
    df, na_report = apply_na_policy(df, params.na)
    return LoadedTable(df=df, headers=list(df.columns), header_unit=unit, dtypes=infer_dtypes(df), na_report=na_report, source=str(path))


# --------------------------------------------------------------------------- #
# Role coercion helpers (used by the builder when splitting columns by role)  #
# --------------------------------------------------------------------------- #
def coerce_numeric(df: pd.DataFrame) -> np.ndarray:
    """Coerce a (feature) frame to a float32 matrix (non-numeric -> NaN)."""
    numeric = df.apply(lambda s: pd.to_numeric(s, errors="coerce"))
    return numeric.to_numpy(dtype=np.float32)


def encode_categorical(series: pd.Series, mode: str) -> tuple[pd.Series, dict | None]:
    """Encode a target column. 'auto' factorizes non-numeric columns; else numeric coercion."""
    numeric = pd.to_numeric(series, errors="coerce")
    is_objectish = not pd.api.types.is_numeric_dtype(series.dtype)
    treat_categorical = mode == "auto" and is_objectish and numeric.isna().sum() > series.isna().sum()
    if treat_categorical:
        codes, categories = pd.factorize(series.astype(str))
        return pd.Series(codes, index=series.index), {"categories": list(categories)}
    return numeric, None

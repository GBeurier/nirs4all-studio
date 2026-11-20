"""Public nirs4all-datasets import: public-only owner calls and faithful Parquet export."""

from __future__ import annotations

import sys
import tempfile
import types
from enum import Enum
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

import api.library_public_datasets as adapter


class Tier(Enum):
    PUBLIC = "public"
    PRIVATE = "private"


class FakeDataset:
    """Owner NirsDataset surface: per-source parquet-like frames plus a variables table."""

    def __init__(self, dataset_id, sources, variables=None, *, declared=(), join_key="sample_id",
                 axis_units=None, tier=Tier.PUBLIC, splits=()):
        self.id, self.tier, self._sources, self._variables = dataset_id, tier, sources, variables
        self._join_key, self._axis_units = join_key, axis_units or {}
        self.descriptor = SimpleNamespace(
            variables=[SimpleNamespace(name=name, role=role, type=SimpleNamespace(value=kind), unit=unit)
                       for name, role, kind, unit in declared],
            sources=[SimpleNamespace(source_id=sid, axis_unit=SimpleNamespace(value=self._axis_units.get(sid, "nm")))
                     for sid in sources],
            splits=[SimpleNamespace(name=name) for name in splits])

    def sources(self):
        return list(self._sources)

    def _features(self, source):
        return [c for c in self._sources[source].columns if c not in ("observation_id", "sample_id")]

    def x(self, source):
        return self._sources[source][self._features(source)].to_numpy(dtype="float32")

    def observation_ids(self, source):
        return self._sources[source]["observation_id"].astype(str).to_numpy()

    def sample_ids(self, source):
        return self._sources[source]["sample_id"].astype(str).to_numpy()

    def _select(self, role):
        if self._variables is None:
            return None
        names = [v.name for v in self.descriptor.variables if v.role == role and v.name in self._variables]
        if not names:
            return None
        return self._variables[[c for c in ("observation_id", "sample_id") if c in self._variables] + names]

    def y(self):
        return self._select("target")

    def metadata(self):
        return self._select("metadata")

    def to_io_spec(self, *, source, split):
        assert split is None, "native splits must not be bridged/applied"
        spec = {"id": source, "columns": [{"role": "ignore", "select": ["observation_id", "sample_id"]},
                                          {"role": "features", "select": self._features(source)}],
                "params": {"header_unit": self._axis_units.get(source, "nm")}}
        sources = [spec]
        if self._variables is not None:
            sources.append({"id": "variables", "key": self._join_key})
        return {"name": self.id, "sources": sources}


def install_bank(monkeypatch, entries, datasets):
    """Install a fake owner module; record every root and get() call."""
    calls = {"list": [], "get": []}
    bank = types.ModuleType("nirs4all_datasets")
    bank.__version__ = "9.9.9"

    def list_(root=".", **filters):
        assert filters == {"tier": "public"}
        assert Path(root).is_absolute() and Path(root).is_dir() and not any(Path(root).iterdir())
        calls["list"].append(root)
        return entries

    def get(name, *, root, cache_dir):
        calls["get"].append((name, root, cache_dir))
        return datasets[name]

    bank.list, bank.get = list_, get
    monkeypatch.setitem(sys.modules, "nirs4all_datasets", bank)
    return calls


def entry(dataset_id, sources=("X",), tier="public", **extra):
    return {"id": dataset_id, "name": f"{dataset_id} name", "tier": tier, "domain": "grain", "spectro_family": "NIR",
            "n_samples": None, "n_features_total": 3, "n_targets": 1, "n_sources": len(sources),
            "source_ids": list(sources), "license": "CC-BY-4.0", "targets": ["protein"], **extra}


def spectra(rows, wavelengths=("1100", "1102.5", "1105")):
    frame = pd.DataFrame(rows, columns=["observation_id", "sample_id", *wavelengths])
    frame[list(wavelengths)] = frame[list(wavelengths)].astype("float32")
    return frame


@pytest.fixture
def no_inspection(monkeypatch):
    seen = {}

    def inspect(output_dir, name, config, export):
        seen.update(output_dir=output_dir, config=config)
        return {"success": True, "summary": {"num_samples": export["rows"]}}

    monkeypatch.setattr(adapter, "_inspect", inspect)
    return seen


def request(tmp_path, dataset_id, **extra):
    stage = Path(tempfile.mkdtemp(dir=tmp_path))
    return {"dataset_id": dataset_id, "output_dir": str(stage), "cache_dir": str(tmp_path / "cache"), **extra}


def test_catalogue_lists_only_public_entries_from_an_isolated_owner_root(monkeypatch):
    calls = install_bank(monkeypatch, [entry("pub"), entry("hidden", tier="private"), {"tier": "public"}], {})
    result = adapter.catalogue({})
    assert result["version"] == "9.9.9"
    assert [item["id"] for item in result["datasets"]] == ["pub"]
    assert result["datasets"][0] == {
        "id": "pub", "name": "pub name", "domain": "grain", "spectro_family": "NIR", "n_samples": None,
        "n_features_total": 3, "n_targets": 1, "n_sources": 1, "source_ids": ["X"], "license": "CC-BY-4.0",
        "targets": ["protein"]}
    assert calls["list"] and calls["list"][0] != "."
    with pytest.raises(ValueError):
        adapter.catalogue({"root": "/"})


@pytest.mark.parametrize("dataset_id", ["hidden", "unknown"])
def test_import_refuses_non_public_ids_before_owner_download(monkeypatch, tmp_path, dataset_id):
    calls = install_bank(monkeypatch, [entry("pub"), entry("hidden", tier="private")], {})
    with pytest.raises(ValueError, match="not in the public catalogue"):
        adapter.import_dataset(request(tmp_path, dataset_id))
    assert calls["get"] == []


@pytest.mark.parametrize("extra", [{"tier": "private"}, {"root": "/"}, {"token": "x"}])
def test_import_refuses_client_roots_tiers_and_credentials(monkeypatch, tmp_path, extra):
    calls = install_bank(monkeypatch, [entry("pub")], {})
    with pytest.raises(ValueError):
        adapter.import_dataset(request(tmp_path, "pub", **extra))
    with pytest.raises(ValueError, match="absolute output_dir"):
        adapter.import_dataset({"dataset_id": "pub", "output_dir": "relative", "cache_dir": str(tmp_path)})
    assert calls["get"] == []


def test_owner_result_must_match_the_public_entry(monkeypatch, tmp_path, no_inspection):
    source = spectra([["o1", "s1", 1, 2, 3]])
    install_bank(monkeypatch, [entry("pub")], {"pub": FakeDataset("pub", {"X": source}, tier=Tier.PRIVATE)})
    with pytest.raises(ValueError, match="does not match"):
        adapter.import_dataset(request(tmp_path, "pub"))


def test_multisource_requires_an_explicit_known_source(monkeypatch, tmp_path, no_inspection):
    sources = {"X1": spectra([["o1", "s1", 1, 2, 3], ["o2", "s2", 4, 5, 6]]),
               "X2": spectra([["p1", "s1", 7, 8], ["p2", "s1", 9, 10], ["p3", "s2", 11, 12]], ("4000", "3998"))}
    dataset = FakeDataset("multi", sources, axis_units={"X2": "cm-1"})
    calls = install_bank(monkeypatch, [entry("multi", sources=("X1", "X2"))], {"multi": dataset})
    with pytest.raises(ValueError, match="choose one of: X1, X2"):
        adapter.import_dataset(request(tmp_path, "multi"))
    with pytest.raises(ValueError, match="Unknown source"):
        adapter.import_dataset(request(tmp_path, "multi", source_id="X3"))
    assert calls["get"] == []

    result = adapter.import_dataset(request(tmp_path, "multi", source_id="X2"))
    stage = Path(no_inspection["output_dir"])
    x = pd.read_parquet(stage / "X.parquet")
    assert list(x.columns) == ["4000", "3998"] and x.shape == (3, 2)
    assert result["config"]["header_unit"] == "cm-1"
    assert result["name"] == "multi name (X2)"
    assert result["provenance"]["source_id"] == "X2"
    assert result["provenance"]["available_sources"] == ["X1", "X2"]
    # Repeated s1 spectra keep sample identity for grouping; no variables were fabricated.
    assert result["config"]["aggregation"] == {"enabled": True, "column": "sample_id", "method": "mean"}
    assert sorted(p.name for p in stage.iterdir()) == ["M.parquet", "X.parquet", "provenance.json"]
    assert list(pd.read_parquet(stage / "M.parquet").columns) == ["sample_id", "observation_id"]
    assert result["config"]["targets"] == [] and result["config"]["task_type"] == "auto"


def test_single_source_defaults_and_keeps_y_and_metadata_absent(monkeypatch, tmp_path, no_inspection):
    install_bank(monkeypatch, [entry("one")], {"one": FakeDataset("one", {"X": spectra([["o1", "s1", 1, 2, 3]])})})
    result = adapter.import_dataset(request(tmp_path, "one"))
    assert [f["type"] for f in result["config"]["files"]] == ["X", "metadata"]
    assert result["config"]["aggregation"]["enabled"] is False
    assert "default_target" not in result["config"]


def test_export_joins_shuffled_repeated_identities_and_preserves_literals(monkeypatch, tmp_path, no_inspection):
    # Spectra order differs from the variables table; s1 is measured twice;
    # "NA" is a real sample identifier; o-missing has no variables row at all.
    source = spectra([
        ["None", "s2", 0.1, 0.2, 0.3],
        ["o1a", "s1", 1.1, 1.2, np.nan],
        ["o-na", "NA", 2.1, 2.2, 2.3],
        ["o1b", "s1", 3.1, 3.2, 3.3],
        ["o-missing", "s9", 4.1, 4.2, 4.3],
    ])
    variables = pd.DataFrame({
        "sample_id": ["NA", "s1", "s2"],
        "protein": [12.5, np.nan, 9.25],
        "variety": ["NA", "durum", None],
        "count": pd.Series([3, 4, 5], dtype="int64"),
        "site": ["", "None", "NA"],
        "batch": ["b2", "b1", "b1"],
    })
    declared = [("protein", "target", "numeric", "%"), ("variety", "target", "categorical", None),
                ("count", "target", "numeric", None), ("site", "metadata", "text", None),
                ("batch", "metadata", "categorical", None)]
    dataset = FakeDataset("grain", {"X": source}, variables, declared=declared, splits=("original",))
    install_bank(monkeypatch, [entry("grain")], {"grain": dataset})

    result = adapter.import_dataset(request(tmp_path, "grain"))
    stage = Path(no_inspection["output_dir"])
    x = pd.read_parquet(stage / "X.parquet")
    y = pd.read_parquet(stage / "Y.parquet")
    m = pd.read_parquet(stage / "M.parquet")

    # Spectra: owner row order, original axis strings, float32 bit-exact, NaN kept.
    assert list(x.columns) == ["1100", "1102.5", "1105"]
    assert all(dtype == np.float32 for dtype in x.dtypes)
    np.testing.assert_array_equal(x.to_numpy(), dataset.x("X"))
    assert list(m["observation_id"]) == ["None", "o1a", "o-na", "o1b", "o-missing"]
    assert list(m["sample_id"]) == ["s2", "s1", "NA", "s1", "s9"]

    # Variables follow each spectrum's sample identity, never row position.
    assert list(y.columns) == ["protein", "variety", "count"]
    assert y["protein"].tolist()[0] == 9.25 and y["protein"].tolist()[2] == 12.5
    assert np.isnan(y["protein"][1]) and np.isnan(y["protein"][3]) and np.isnan(y["protein"][4])
    assert y["variety"].tolist()[1:4] == ["durum", "NA", "durum"]
    assert pd.isna(y["variety"][0]) and pd.isna(y["variety"][4])
    assert str(y["count"].dtype) == "Int64" and y["count"].tolist()[:4] == [5, 4, 3, 4] and pd.isna(y["count"][4])
    assert m["site"].tolist()[:4] == ["NA", "None", "", "None"] and pd.isna(m["site"][4])
    assert m["batch"].tolist()[:4] == ["b1", "b1", "b2", "b1"]

    config = result["config"]
    assert all(Path(f["path"]).parent == stage for f in config["files"])
    assert [(f["type"], Path(f["path"]).name, f["split"]) for f in config["files"]] == [
        ("X", "X.parquet", "train"), ("Y", "Y.parquet", "train"), ("metadata", "M.parquet", "train")]
    assert config["na_policy"] == "ignore" and config["global_params"]["na_policy"] == "ignore"
    assert config["header_unit"] == "nm"
    assert config["targets"] == [
        {"column": "protein", "type": "regression", "is_default": True, "unit": "%"},
        {"column": "variety", "type": "binary_classification", "is_default": False},
        {"column": "count", "type": "regression", "is_default": False}]
    assert config["task_type"] == "auto" and config["default_target"] == "protein"
    assert config["aggregation"] == {"enabled": True, "column": "sample_id", "method": "mean"}
    provenance = result["provenance"]
    assert provenance["native_splits"] == ["original"] and provenance["native_splits_applied"] is False
    assert provenance["rows"] == 5 and provenance["unique_samples"] == 4 and provenance["join_key"] == "sample_id"
    assert any("1 of 5 spectra have no targets row" in warning for warning in provenance["warnings"])
    assert any("mix regression and classification" in warning for warning in provenance["warnings"])


def test_observation_grain_variables_join_by_observation_id(monkeypatch, tmp_path, no_inspection):
    source = spectra([["o1", "s1", 1, 2, 3], ["o2", "s1", 4, 5, 6]])
    variables = pd.DataFrame({"observation_id": ["o2", "o1"], "sample_id": ["s1", "s1"], "moisture": [2.0, 1.0]})
    dataset = FakeDataset("obs", {"X": source}, variables, declared=[("moisture", "target", "numeric", None)],
                          join_key="observation_id")
    install_bank(monkeypatch, [entry("obs")], {"obs": dataset})
    adapter.import_dataset(request(tmp_path, "obs"))
    assert pd.read_parquet(Path(no_inspection["output_dir"]) / "Y.parquet")["moisture"].tolist() == [1.0, 2.0]


def test_ambiguous_variables_identity_is_refused(monkeypatch, tmp_path, no_inspection):
    source = spectra([["o1", "s1", 1, 2, 3]])
    variables = pd.DataFrame({"sample_id": ["s1", "s1"], "protein": [1.0, 2.0]})
    dataset = FakeDataset("dup", {"X": source}, variables, declared=[("protein", "target", "numeric", None)])
    install_bank(monkeypatch, [entry("dup")], {"dup": dataset})
    with pytest.raises(ValueError, match="not unique per sample_id"):
        adapter.import_dataset(request(tmp_path, "dup"))


def test_real_studio_configure_and_preview_read_back_the_export(monkeypatch, tmp_path):
    pytest.importorskip("nirs4all.api.dataset_inspection")
    source = spectra([
        ["o3", "s3", 3.0, 3.5, np.nan],
        ["o1a", "s1", 1.0, 1.5, 1.75],
        ["o2", "NA", 2.0, 2.5, 2.75],
        ["o1b", "s1", 1.1, 1.6, 1.85],
    ])
    variables = pd.DataFrame({"sample_id": ["s1", "NA", "s3"], "protein": [10.5, np.nan, 12.25],
                              "site": ["NA", "", "None"]})
    declared = [("protein", "target", "numeric", None), ("site", "metadata", "text", None)]
    install_bank(monkeypatch, [entry("real")], {"real": FakeDataset("real", {"X": source}, variables, declared=declared)})

    result = adapter.import_dataset(request(tmp_path, "real"))
    summary = result["inspection"]["summary"]
    assert result["inspection"]["success"] is True
    assert (summary["num_samples"], summary["num_features"], summary["n_sources"]) == (4, 3, 1)
    assert (summary["train_samples"], summary["test_samples"]) == (4, 0)
    assert summary["has_targets"] is True and summary["header_unit"] == "nm"
    assert summary["metadata_columns"] == ["sample_id", "observation_id", "site"]
    assert "spectra_preview" not in result["inspection"]
    distribution = result["inspection"]["target_distributions"]["target_0"]
    assert distribution["type"] == "regression" and distribution["missing_count"] == 1

    # The library loader reads the same rows, NaN target and literal metadata.
    from nirs4all.api.dataset_inspection import load_dataset_for_analysis

    from api.library_documents import configure_dataset

    stage = Path(result["config"]["files"][0]["path"]).parent
    configured = configure_dataset({"record": {"path": str(stage), "name": result["name"], "config": result["config"]}})
    dataset, _ = load_dataset_for_analysis(configured)
    y = np.asarray(dataset.y({})).reshape(-1)
    np.testing.assert_allclose(y[[0, 1, 3]], [12.25, 10.5, 10.5])
    assert np.isnan(y[2])
    metadata = dataset.metadata()
    assert list(metadata["observation_id"]) == ["o3", "o1a", "o2", "o1b"]
    assert list(metadata["site"]) == ["None", "NA", "", "NA"]

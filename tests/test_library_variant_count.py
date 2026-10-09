"""Native variant counting delegates editor generators without expanding models."""
from __future__ import annotations

import pytest

from api.library_documents import adapt_document
from api.pipeline_canonical import canonical_to_editor


def test_real_cartesian_generator_count_and_breakdown_do_not_fit(monkeypatch):
    from sklearn.cross_decomposition import PLSRegression

    monkeypatch.setattr(PLSRegression, "fit", lambda *args, **kwargs: pytest.fail("Counting must not fit a model"))
    canonical = [{"_or_": [{"class": "sklearn.preprocessing.StandardScaler"}, {"class": "sklearn.preprocessing.MinMaxScaler"}]},
                 {"model": {"class": "sklearn.cross_decomposition.PLSRegression", "params": {"n_components": {"_or_": [1, 2, 3]}}}}]
    steps = canonical_to_editor(canonical)
    response = adapt_document("pipeline.count_variants", {"steps": steps})
    assert response["count"] == 6
    assert [response["breakdown"][step["id"]]["count"] for step in steps] == [2, 3]
    assert response["warning"] is None
    assert set(response) == {"count", "breakdown", "warning"}


def test_empty_pipeline_has_one_variant_and_no_breakdown():
    assert adapt_document("pipeline.count_variants", {"steps": []}) == {"count": 1, "breakdown": {}, "warning": None}


@pytest.mark.parametrize("payload", [{}, {"steps": "bad"}, {"steps": [None]}, {"steps": [], "workspace_path": "/outside"},
                                    {"steps": [], "query": "count=1"}, {"steps": [{}] * 257}])
def test_variant_count_rejects_incomplete_or_extra_authority_fields(payload):
    with pytest.raises(ValueError, match="Variant count requires only"):
        adapt_document("pipeline.count_variants", payload)


def test_large_owner_search_space_is_counted_without_expansion_and_warns():
    canonical = [{"model": {"class": "sklearn.cross_decomposition.PLSRegression", "params": {
        "n_components": {"_or_": list(range(1, 102))}, "max_iter": {"_or_": list(range(100, 201))}}}}]
    response = adapt_document("pipeline.count_variants", {"steps": canonical_to_editor(canonical)})
    assert response["count"] == 10201
    assert response["warning"].startswith("Large search space: 10,201 variants.")


def test_variant_count_rejects_unauthorized_operator_instead_of_claiming_one():
    from nirs4all.api.studio_scientific import StudioScientificJobError

    with pytest.raises(StudioScientificJobError):
        adapt_document("pipeline.count_variants", {"steps": [{"id": "unsafe", "type": "model", "name": "Unsafe", "classPath": "os.system", "params": {}}]})

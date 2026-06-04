from api.system import _build_operator_availability_response


def test_operator_availability_response_reports_live_catalog():
    response = _build_operator_availability_response(
        {
            "preprocessing": [
                {
                    "name": "StandardScaler",
                    "display_name": "Standard Scaler",
                    "category": "scaling",
                    "source": "sklearn",
                }
            ],
            "augmentation": [],
            "splitting": [
                {
                    "name": "KFold",
                    "category": "kfold",
                    "source": "sklearn",
                }
            ],
            "filter": [],
        }
    )

    assert response["available"] is True
    assert response["status"] == "available"
    assert response["total"] == 2
    assert response["counts"] == {
        "preprocessing": 1,
        "augmentation": 0,
        "splitting": 1,
        "filter": 0,
    }
    assert response["reference"]["totalNodes"] == 2
    assert response["reference"]["nodes"][0]["name"] == "StandardScaler"
    assert response["operators"]["splitting"] == ["KFold"]


def test_operator_availability_response_degrades_for_empty_catalog():
    response = _build_operator_availability_response({})

    assert response["available"] is False
    assert response["status"] == "degraded"
    assert response["total"] == 0
    assert response["reference"]["totalNodes"] == 0
    assert response["reference"]["nodes"] == []
    assert "No operators discovered" in response["reason"]


def test_operator_availability_response_degrades_for_introspection_error():
    response = _build_operator_availability_response(
        {},
        error="Operator catalog introspection failed: RuntimeError",
    )

    assert response["available"] is False
    assert response["status"] == "degraded"
    assert response["reason"] == "Operator catalog introspection failed: RuntimeError"

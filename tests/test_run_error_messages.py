from api.runs import _format_pipeline_failure


def test_format_pipeline_failure_rewrites_nan_transform_error():
    message = (
        "Pipeline step 1 failed: Step execution failed: Transform 'SavitzkyGolay' "
        "received NaN input. Set na_policy on this step or handle NAs upstream."
    )

    formatted = _format_pipeline_failure(RuntimeError(message))

    assert formatted.startswith("SavitzkyGolay cannot run")
    assert "missing values" in formatted
    assert "NA Handling" in formatted


def test_format_pipeline_failure_keeps_unknown_error():
    message = "Unexpected training failure"

    assert _format_pipeline_failure(RuntimeError(message)) == message


def test_format_pipeline_failure_rewrites_pls_components_error():
    message = (
        "Pipeline step 4 failed: Step execution failed: Invalid hyperparameters for "
        "PLSRegression with current dataset: `n_components` upper bound is 1. "
        "Got 15 instead. Reduce `n_components`."
    )

    formatted = _format_pipeline_failure(RuntimeError(message))

    assert formatted.startswith("PLSRegression n_components is too high")
    assert "allows at most 1" in formatted
    assert "asks for 15" in formatted


def test_format_pipeline_failure_rewrites_inconsistent_sample_counts():
    message = (
        "Pipeline step 5 failed: Step execution failed: "
        "Found input variables with inconsistent numbers of samples: [377, 3770]"
    )

    formatted = _format_pipeline_failure(RuntimeError(message))

    assert formatted.startswith("The X and Y files do not contain the same number of samples")
    assert "377, 3770" in formatted
    assert "target row" in formatted

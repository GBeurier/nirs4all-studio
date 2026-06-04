from api.spectra import _find_missing_dataset_files, _iter_dataset_file_paths


def test_iter_dataset_file_paths_includes_single_and_multi_source_paths():
    paths = _iter_dataset_file_paths(
        {
            "train_x": ["/tmp/x1.csv", "/tmp/x2.csv"],
            "train_y": "/tmp/y.csv",
            "train_x_params": {"delimiter": ","},
            "name": "dataset",
        }
    )

    assert paths == ["/tmp/x1.csv", "/tmp/x2.csv", "/tmp/y.csv"]


def test_find_missing_dataset_files_ignores_existing_files(tmp_path):
    existing = tmp_path / "x.csv"
    existing.write_text("a,b\n1,2\n", encoding="utf-8")
    missing = tmp_path / "missing.csv"

    result = _find_missing_dataset_files(
        {
            "train_x": str(existing),
            "train_y": str(missing),
        }
    )

    assert result == [str(missing)]

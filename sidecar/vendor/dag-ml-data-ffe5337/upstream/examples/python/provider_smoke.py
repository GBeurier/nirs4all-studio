from __future__ import annotations

import argparse
import json

from dag_ml_data_provider import InMemoryProvider


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--lib",
        default=None,
        help="path to the C ABI cdylib; discovered automatically (env "
        "DAG_ML_DATA_CAPI_LIB / Cargo target dir) when omitted",
    )
    parser.add_argument("--envelope", required=True)
    parser.add_argument("--request", required=True)
    args = parser.parse_args()

    target_tables = [
        {
            "target_id": "y",
            "values": [
                {"sample_id": "S001", "value": 42.0},
                {"sample_id": "S002", "value": 7.0},
            ],
        }
    ]
    f64_feature_matrices = [
        {
            "feature_set_id": "x",
            "representation_id": "tabular_numeric",
            "feature_names": ["f0", "f1"],
            "observation_ids": [
                "obs.S001.base",
                "obs.S001.rep1",
                "obs.S001.aug0",
                "obs.S002.base",
            ],
            "values": [1.0, 10.0, 2.0, 20.0, 3.0, 30.0, 4.0, 40.0],
        }
    ]
    with InMemoryProvider.from_files(
        args.envelope,
        library_path=args.lib,
        target_tables=target_tables,
        f64_feature_matrices=f64_feature_matrices,
    ) as provider:
        manifests = provider.feature_buffer_manifests()
        data_handle = provider.materialize_file(args.request)
        data_manifests = provider.data_feature_buffer_manifests(data_handle)
        view_handle = provider.make_view(
            data_handle,
            {"sample_ids": ["S002", "S001"], "columns": ["f1"], "include_augmented": False},
        )
        identity = provider.view_identity(view_handle)
        targets = provider.target_values(view_handle, "y")
        features = provider.feature_values(view_handle, "x")
        tensor = provider.feature_tensor(view_handle, {"feature_set_id": "x", "policy": {"emit_mask": True}})

        assert [row["observation_id"] for row in identity] == [
            "obs.S002.base",
            "obs.S001.base",
            "obs.S001.rep1",
        ]
        assert targets == [
            {"sample_id": "S002", "target_id": "y", "value": 7.0},
            {"sample_id": "S001", "target_id": "y", "value": 42.0},
        ]
        assert features == [
            {
                "observation_id": "obs.S002.base",
                "sample_id": "S002",
                "features": {"f1": 40.0},
            },
            {
                "observation_id": "obs.S001.base",
                "sample_id": "S001",
                "features": {"f1": 10.0},
            },
            {
                "observation_id": "obs.S001.rep1",
                "sample_id": "S001",
                "features": {"f1": 20.0},
            },
        ]
        assert tensor["abi_version"] == 1
        assert tensor["shape"] == [3, 1]
        assert tensor["values"] == [40.0, 10.0, 20.0]
        assert tensor["presence_mask"] == [True, True, True]
        assert tensor["feature_names"] == ["f1"]
        assert manifests[0]["feature_set_id"] == "x"
        assert manifests[0]["row_count"] == 4
        assert manifests[0]["feature_count"] == 2
        assert len(manifests[0]["buffer_fingerprint"]) == 64
        assert data_manifests[0]["feature_set_id"] == "x"
        assert data_manifests[0]["source_ids"] == ["nir"]

        provider.release(view_handle)
        provider.release(data_handle)

    print(
        json.dumps(
            {
                "identity_rows": len(identity),
                "target_rows": len(targets),
                "feature_rows": len(features),
                "feature_buffers": len(manifests),
                "data_feature_buffers": len(data_manifests),
                "tensor_values": len(tensor["values"]),
                "observations": [row["observation_id"] for row in identity],
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()

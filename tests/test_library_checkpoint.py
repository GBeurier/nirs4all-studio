"""Checkpoint exports preserve selected payloads through Core's real writer."""
import base64
import hashlib
import json

import pytest

from api.library_checkpoint import checkpoint_export


def opened_export(tmp_path, document):
    import nirs4all_core as core

    response = checkpoint_export(document)
    path = tmp_path / "download.n4a"
    path.write_bytes(base64.b64decode(response["content_base64"]))
    return core.open_n4a_file(path)


def test_recipe_selection_does_not_include_unselected_data(tmp_path):
    recipe = {"pipeline": ["sklearn.preprocessing.StandardScaler"]}
    with opened_export(tmp_path, {"sections": {"recipe": recipe}}) as archive:
        assert json.loads(archive.member("checkpoint/recipe.json")) == recipe
        manifest = json.loads(archive.manifest_bytes())
        assert manifest["entrypoints"] == []
        assert {member["path"] for member in manifest["members"]} == {"checkpoint/recipe.json", "checkpoint/manifest.json"}


def test_source_files_keep_exact_bytes_and_archive_relative_configuration(tmp_path):
    path = tmp_path / "X.csv"
    payload = b"1100;1200\n1.123456789012345;NA\n"
    path.write_bytes(payload)
    with opened_export(tmp_path, {"sections": {"dataset": {"name": "spectra"}}, "dataset_config": {"train_x": str(path)}}) as archive:
        member = "dataset/inputs/0/X.csv"
        assert archive.member(member) == payload
        assert json.loads(archive.member("dataset/config.json"))["train_x"] == member


def test_model_entrypoint_and_original_payload_are_retained(tmp_path):
    from nirs4all.pipeline.dagml.host_container import BUNDLE_CONTENT_TYPE, BUNDLE_MANIFEST_MEMBER, HostMember, write_host_container

    source = tmp_path / "model.n4a"
    original = b'{"model":"captured"}'
    write_host_container(source, [HostMember(BUNDLE_MANIFEST_MEMBER, original, "model", BUNDLE_CONTENT_TYPE)])
    with opened_export(tmp_path, {"sections": {"model": True, "results": {"score": 0.8}}, "bundle_path": str(source),
                                  "archive_fingerprint": "sha256:" + hashlib.sha256(source.read_bytes()).hexdigest()}) as archive:
        assert archive.member(BUNDLE_MANIFEST_MEMBER) == original
        manifest = json.loads(archive.manifest_bytes())
        assert manifest["entrypoints"][0]["id"] == "host-predict"
        assert json.loads(archive.member("checkpoint/results.json")) == {"score": 0.8}


def test_empty_selection_is_rejected():
    with pytest.raises(ValueError, match="Choose at least one"):
        checkpoint_export({"sections": {}})

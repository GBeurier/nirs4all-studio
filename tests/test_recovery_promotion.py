"""Exercise the exact inline promotion guard without creating a release."""

import copy
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
import yaml

WORKFLOW = Path(__file__).resolve().parents[1] / ".github/workflows/release-unified.yml"


@pytest.fixture
def promotion():
    steps = yaml.safe_load(WORKFLOW.read_text())["jobs"]["promote"]["steps"]
    step = next(item for item in steps if item.get("id") == "published")
    code = step["run"].split("python3 - <<'PYCODE'\n", 1)[1].rsplit("\nPYCODE", 1)[0]
    namespace = {"__name__": "promotion_under_test"}
    exec(compile(code, str(WORKFLOW), "exec"), namespace)
    return namespace, steps


@pytest.fixture
def publication(tmp_path):
    expected, downloaded = tmp_path / "expected", tmp_path / "downloaded"
    expected.mkdir()
    downloaded.mkdir()
    reports = [{"platform": "win32", "arch": "x64", "success": True}, {"platform": "darwin", "arch": "arm64", "success": True}]
    contents = {
        "installer.exe": b"qualified installer bytes",
        "installer.exe.sha256": b"qualified sidecar bytes\n",
        "qualification.json": json.dumps(reports).encode(),
        "library-provenance.json": b'{"source_commit":"qualified", "wheel_sha256":"known"}',
    }
    assets = []
    for name, data in contents.items():
        (expected / name).write_bytes(data)
        (downloaded / name).write_bytes(data)
        assets.append({"name": name, "state": "uploaded", "size": len(data), "digest": "sha256:" + hashlib.sha256(data).hexdigest()})
    return {"tag_name": "0.11.10", "draft": False, "prerelease": False, "assets": assets}, expected, downloaded


def refresh_asset(release, downloaded, name):
    asset = next(item for item in release["assets"] if item["name"] == name)
    data = (downloaded / name).read_bytes()
    asset.update(size=len(data), digest="sha256:" + hashlib.sha256(data).hexdigest())


def test_published_assets_verified_without_writing(promotion, publication):
    namespace, _ = promotion
    release, expected, downloaded = publication
    before = {item: item.read_bytes() for root in (expected, downloaded) for item in root.iterdir()}
    namespace["verify_published_assets"](release, expected, downloaded)
    assert all(item.read_bytes() == data for item, data in before.items())


def test_evidence_json_order_is_semantic_but_fields_remain_exact(promotion, publication):
    namespace, _ = promotion
    release, expected, downloaded = publication
    reports = json.loads((downloaded / "qualification.json").read_text())
    (downloaded / "qualification.json").write_text(json.dumps(list(reversed(reports)), indent=2))
    refresh_asset(release, downloaded, "qualification.json")
    namespace["verify_published_assets"](release, expected, downloaded)
    reports[0]["success"] = False
    (downloaded / "qualification.json").write_text(json.dumps(reports))
    refresh_asset(release, downloaded, "qualification.json")
    with pytest.raises(AssertionError, match="evidence differs"):
        namespace["verify_published_assets"](release, expected, downloaded)


@pytest.mark.parametrize("name", ["installer.exe", "installer.exe.sha256", "library-provenance.json"])
def test_changed_publication_is_rejected_even_with_matching_remote_digest(promotion, publication, name):
    namespace, _ = promotion
    release, expected, downloaded = publication
    (downloaded / name).write_bytes(b'{"changed":true}' if name.endswith(".json") else b"changed bytes")
    refresh_asset(release, downloaded, name)
    with pytest.raises(AssertionError, match="differs|differ"):
        namespace["verify_published_assets"](release, expected, downloaded)


@pytest.mark.parametrize("change", ["missing", "duplicate", "truncated", "digest", "draft", "prerelease"])
def test_incomplete_or_untrusted_publication_is_rejected(promotion, publication, change):
    namespace, _ = promotion
    release, expected, downloaded = publication
    if change == "missing":
        release["assets"].pop()
    elif change == "duplicate":
        release["assets"].append(copy.deepcopy(release["assets"][0]))
    elif change == "truncated":
        (downloaded / "installer.exe").write_bytes(b"truncated")
    elif change == "digest":
        release["assets"][0]["digest"] = "sha256:incorrect"
    else:
        release[change] = True
    with pytest.raises(AssertionError):
        namespace["verify_published_assets"](release, expected, downloaded)


@pytest.mark.parametrize("annotated", [False, True])
def test_remote_tag_resolves_exact_qualified_commit(promotion, annotated):
    namespace, _ = promotion
    endpoints = []

    def lookup(endpoint):
        endpoints.append(endpoint)
        if annotated and "/git/ref/" in endpoint:
            return {"object": {"type": "tag", "sha": "annotation"}}
        return {"object": {"type": "commit", "sha": "qualified"}}

    namespace["github_json"] = lookup
    namespace["verify_tag"]("owner/repo", "0.11.10", "qualified")
    assert endpoints[0] == "repos/owner/repo/git/ref/tags/0.11.10"
    with pytest.raises(AssertionError, match="does not identify"):
        namespace["verify_tag"]("owner/repo", "0.11.10", "different")


def test_only_release_not_found_is_treated_as_absent(promotion, monkeypatch):
    namespace, _ = promotion
    for status in (404, 403):
        monkeypatch.setattr(namespace["subprocess"], "run", lambda *args, **kwargs: SimpleNamespace(returncode=1, stdout=json.dumps({"status": status})))
        if status == 404:
            assert namespace["github_json"]("repos/owner/repo/releases/tags/0.11.10", allow_missing=True) is None
        else:
            with pytest.raises(RuntimeError, match="403"):
                namespace["github_json"]("repos/owner/repo/releases/tags/0.11.10", allow_missing=True)


def test_existing_release_skips_all_publication_mutations_and_never_retargets(promotion):
    _, steps = promotion
    guard_index = next(index for index, step in enumerate(steps) if step.get("id") == "published")
    mutations = steps[guard_index + 1:]
    assert len(mutations) == 3
    assert all(step["if"] == "steps.published.outputs.exists != 'true'" for step in mutations)
    command = mutations[-1]["run"]
    assert "--verify-tag" in command and "--target" not in command
    checkout = next(step for step in steps if step.get("uses") == "actions/checkout@v4")
    assert checkout["with"]["ref"] == "${{ steps.qualified.outputs.source_sha }}"
    receipt_gate = next(step for step in steps if step.get("name") == "Verify installed-platform receipts and prepare installer checksums")
    assert "len(reports) == 4" in receipt_gate["run"]
    assert "r['scope'] == 'installed_application'" in receipt_gate["run"]
    assert "r['migration'] == {'status': 'not_requested'}" in receipt_gate["run"]
    installer = yaml.safe_load(WORKFLOW.read_text())["jobs"]["installer"]
    smoke = next(step for step in installer["steps"] if step.get("name") == "Smoke-test the installed application and restart persistence")
    assert "recovery-qualify-installer.cjs" in smoke["run"]
    assert "--previous-version" not in smoke["run"]
    assert "build/recovery-library.json" in receipt_gate["run"]

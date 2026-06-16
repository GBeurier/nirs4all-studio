"""Tests for the macOS ditto extraction preference in the update downloader."""

import api.update_downloader as update_downloader


def _downloader():
    return update_downloader.UpdateDownloader(download_url="https://example.invalid/App.zip", expected_size=1)


def test_ditto_returns_false_when_unavailable(monkeypatch, tmp_path):
    monkeypatch.setattr(update_downloader.shutil, "which", lambda _name: None)
    assert _downloader()._extract_zip_via_ditto(tmp_path / "App.zip", tmp_path / "stage") is False


def test_ditto_runs_with_expected_args(monkeypatch, tmp_path):
    calls: list[list[str]] = []
    monkeypatch.setattr(update_downloader.shutil, "which", lambda _name: "/usr/bin/ditto")

    def fake_run(args, **_kwargs):
        calls.append(args)
        return object()

    monkeypatch.setattr(update_downloader.subprocess, "run", fake_run)

    archive = tmp_path / "App.zip"
    target = tmp_path / "stage"
    assert _downloader()._extract_zip_via_ditto(archive, target) is True
    assert calls == [["/usr/bin/ditto", "-x", "-k", "--rsrc", str(archive), str(target)]]


def test_ditto_falls_back_and_cleans_partial_output(monkeypatch, tmp_path):
    monkeypatch.setattr(update_downloader.shutil, "which", lambda _name: "/usr/bin/ditto")

    def fake_run(args, **_kwargs):
        raise update_downloader.subprocess.CalledProcessError(1, args)

    monkeypatch.setattr(update_downloader.subprocess, "run", fake_run)

    # Simulate ditto having extracted some entries before failing.
    target = tmp_path / "stage"
    target.mkdir()
    (target / "partial-entry").write_text("half-extracted")

    assert _downloader()._extract_zip_via_ditto(tmp_path / "App.zip", target) is False
    # The staging dir is wiped + recreated so the zipfile fallback starts clean.
    assert target.is_dir()
    assert not (target / "partial-entry").exists()

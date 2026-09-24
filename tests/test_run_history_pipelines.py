"""Historical pipeline discovery for the explicit Python diagnostic backend."""

from types import SimpleNamespace

from api import runs


def test_history_pipeline_discovery_keeps_newest_unique_executable_config(monkeypatch):
    steps = [{"type": "model", "name": "PLS", "params": {"n_components": 2}}]

    def entry(run_id, date, name, config):
        pipeline = SimpleNamespace(config=config, pipeline_name=name)
        dataset = SimpleNamespace(pipelines=[pipeline])
        return SimpleNamespace(id=run_id, created_at=date, completed_at=None, datasets=[dataset])

    monkeypatch.setattr(runs, "_runs", {
        "old": entry("old", "2026-09-01", "Old", {"name": "Old", "steps": steps}),
        "new": entry("new", "2026-09-02", "New", {"name": "New", "steps": steps}),
        "invalid": entry("invalid", "2026-09-03", "Invalid", {"steps": "not steps"}),
    })

    first = runs._list_historical_pipeline_configs()
    second = runs._list_historical_pipeline_configs()
    assert first == second
    assert len(first) == 1
    assert first[0]["name"] == "New"
    assert first[0]["source"] == "history"
    assert first[0]["steps"] == steps

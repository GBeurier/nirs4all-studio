# Integration Tests for nirs4all webapp

Comprehensive integration tests for the pipeline execution flow, covering the complete lifecycle from frontend submission through backend processing and WebSocket updates.

## Test Structure

```
tests/integration/
├── __init__.py                 # Package info and usage docs
├── conftest.py                 # Fixtures for workspace, datasets, mocks
├── websocket_utils.py          # WebSocket testing utilities
├── test_quick_run_flow.py      # End-to-end quick run tests
├── test_run_errors.py          # Error handling and validation tests
└── test_run_lifecycle.py       # Run lifecycle (stop, pause, retry) tests
```

## Running Tests

### Quick CI Mode (Mocked nirs4all)
```bash
# Run all integration tests with mocked nirs4all (~2 min)
pytest tests/integration/ -v -m "not integration_full"

# Run specific test file
pytest tests/integration/test_quick_run_flow.py -v
```

### Full Integration Mode (Real nirs4all)
```bash
# Run with real nirs4all library (~5+ min)
pytest tests/integration/ -v -m integration_full
```

### Run with Coverage
```bash
pytest tests/integration/ --cov=api --cov-report=html
```

## Test Categories

### test_quick_run_flow.py
Tests the complete pipeline execution lifecycle:
- Quick run creation and validation
- Run object structure verification
- HTTP polling for completion
- WebSocket progress updates
- Metrics extraction and validation
- Run persistence (manifest files)
- Server restart persistence
- Multi-pipeline experiments

### test_run_errors.py
Tests error handling:
- 404 errors: missing pipeline/dataset/run
- 409 errors: no workspace selected
- 422 errors: validation failures (cv_folds, required fields)
- Execution failures: nirs4all errors
- Partial failures in experiments
- State transition errors

### test_run_lifecycle.py
Tests run lifecycle operations:
- Stop/cancel running runs
- Pause/resume runs
- Retry failed runs
- Delete runs
- Model export verification
- Concurrent run handling
- Run statistics

## Fixtures

### Core Fixtures (conftest.py)
- `client`: Basic FastAPI test client
- `test_workspace`: Empty temp workspace structure
- `workspace_with_data`: Workspace with sample dataset + pipelines
- `workspace_client`: Client with workspace pre-selected

### Mock Fixtures
- `mock_nirs4all`: Fast mock for CI testing
- `mock_nirs4all_failure`: Mock that simulates training failure
- `slow_mock_nirs4all`: Mock with delay for stop/pause testing

### WebSocket Fixtures
- `ws_message_collector`: Factory for WebSocket message collection

## Custom Markers

```python
@pytest.mark.integration_full  # Requires real nirs4all
@pytest.mark.websocket         # Involves WebSocket communication
@pytest.mark.slow              # Long-running test
@pytest.mark.timeout(60)       # Custom timeout
```

## Adding New Tests

### Test Template
```python
import pytest
from fastapi.testclient import TestClient
from .websocket_utils import RunProgressTracker

class TestNewFeature:
    """Test description."""

    @pytest.mark.timeout(60)
    def test_feature_works(
        self,
        workspace_client: TestClient,
        mock_nirs4all,
    ):
        """Test that feature works correctly."""
        # Create a run
        response = workspace_client.post("/api/runs/quick", json={
            "pipeline_id": "test_pls",
            "dataset_id": "test_dataset",
            "cv_folds": 3,
        })

        if response.status_code not in (200, 201):
            pytest.skip(f"Run creation failed: {response.json()}")

        run_id = response.json()["id"]

        # Wait for completion
        tracker = RunProgressTracker(workspace_client, run_id)
        status = tracker.poll_until_complete(timeout=30.0)

        assert status == "completed"
```

### WebSocket Testing
```python
def test_websocket_updates(self, workspace_client, mock_nirs4all):
    response = workspace_client.post("/api/runs/quick", json={...})
    run_id = response.json()["id"]

    with workspace_client.websocket_connect(f"/ws/job/{run_id}") as ws:
        messages = []
        while True:
            data = ws.receive_json()
            messages.append(data)
            if data["type"] in ("job_completed", "job_failed"):
                break

        assert any(m["type"] == "job_progress" for m in messages)
```

## CI/CD Integration

### GitHub Actions Example
```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - name: Install dependencies
        run: |
          pip install -r requirements.txt
          pip install -r requirements-test.txt
      - name: Run integration tests
        run: pytest tests/integration/ -v -m "not integration_full"
```

## Troubleshooting

### Tests Skipping
If tests skip with "Quick run creation failed":
- Ensure workspace_client fixture is used (not plain client)
- Check that test_dataset and test_pls pipeline exist in workspace

### WebSocket Tests Timing Out
- Increase timeout: `@pytest.mark.timeout(120)`
- Check mock_nirs4all is being used (not real training)

### Dataset Not Found
- The workspace fixture creates dataset configuration in workspace.json
- Verify `_get_dataset_config()` can find the dataset by ID

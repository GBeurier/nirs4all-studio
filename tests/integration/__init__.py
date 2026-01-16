"""
Integration tests for nirs4all webapp.

This package contains comprehensive integration tests that validate
the complete pipeline execution flow from frontend submission
through backend processing and WebSocket updates.

Test categories:
- test_quick_run_flow.py: End-to-end quick run tests
- test_run_errors.py: Error handling and validation tests
- test_run_lifecycle.py: Run lifecycle (stop, pause, retry) tests
- test_websocket_flow.py: WebSocket message sequence tests

Run all integration tests:
    pytest tests/integration/ -v

Run with real nirs4all (slow):
    pytest tests/integration/ -v -m integration_full

Run with mocked nirs4all (fast, CI-friendly):
    pytest tests/integration/ -v -m "not integration_full"
"""

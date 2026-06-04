# nirs4all Studio documentation

nirs4all Studio is the desktop and web interface for building, running, and
reviewing Near-Infrared Spectroscopy analysis workflows. It combines a React
application, a FastAPI backend, and the `nirs4all` Python library behind a
workspace-oriented user experience.

This documentation is organized around the work people actually do with the
application:

- create or select a workspace
- link and validate datasets
- design pipelines in the visual editor
- run experiments and monitor progress
- review results, predictions, and analysis views
- package, release, and maintain the desktop application

## What nirs4all Studio does

nirs4all Studio is an orchestration layer. It does not own the scientific
algorithms. NIRS parsing, preprocessing, model training, prediction,
explainability, synthetic spectra generation, and workspace storage are
delegated to the `nirs4all` Python library.

The Studio repository owns:

- the web UI and desktop shell
- HTTP and WebSocket routing
- workspace selection and linked workspace state
- dataset linking and preview workflows
- pipeline serialization for the UI
- job orchestration and progress reporting
- release packaging and application update UX

## Main surfaces

| Surface | Purpose |
| --- | --- |
| Dashboard | Recent activity, workspace state, and quick access to common flows. |
| Datasets | Link, inspect, group, refresh, and configure datasets. |
| Playground | Explore preprocessing and visualization choices interactively. |
| Pipelines | Manage saved pipelines, presets, favorites, import, and export. |
| Pipeline Editor | Build trainable NIRS workflows with validation and custom nodes. |
| Runs | Launch, pause, resume, retry, stop, and inspect execution progress. |
| Results | Review completed experiment outputs and model metrics. |
| Predictions | Inspect prediction chains and sample-level output arrays. |
| Analysis | PCA, t-SNE, UMAP, wavelength importance, transfer analysis, and SHAP-oriented views. |
| Synthesis | Generate synthetic spectra for development and validation workflows. |
| Settings | Workspaces, dependencies, updates, diagnostics consent, language, and system status. |

## Recommended reading

Start with [Install and Run](getting-started/installation.md) if you want to use
the application locally. Start with [Development Setup](getting-started/development.md)
if you are changing the code.

For architecture work, read [Architecture](development/architecture.md) first,
then the relevant backend, frontend, Electron, or release page.

For API consumers, use [API Overview](reference/api.md). The live FastAPI schema
is available at `/docs` when the backend is running.

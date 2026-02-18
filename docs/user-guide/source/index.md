# nirs4all Studio User Guide

Welcome to the **nirs4all Studio** user guide! This documentation will help you get the most out of the application for Near-Infrared Spectroscopy (NIRS) data analysis.

nirs4all Studio is a desktop and web application that lets you import spectral data, build analysis pipelines visually, run experiments, and explore results — all without writing code.

---

::::{grid} 2
:gutter: 3

:::{grid-item-card} Getting Started
:link: getting-started/index
:link-type: doc

New to nirs4all Studio? Start here. Learn how to install, set up your first workspace, and run your first experiment.
:::

:::{grid-item-card} Tutorials
:link: tutorials/index
:link-type: doc

Step-by-step guided walkthroughs that teach you the core workflows, from data import to model analysis.
:::

:::{grid-item-card} How-To Guides
:link: how-to/index
:link-type: doc

Practical recipes for specific tasks: importing data, building pipelines, running experiments, and more.
:::

:::{grid-item-card} Reference
:link: reference/index
:link-type: doc

Detailed descriptions of every page, feature, and option in the application.
:::

::::

---

```{toctree}
:maxdepth: 2
:caption: Getting Started
:hidden:

getting-started/index
getting-started/installation
getting-started/first-launch
getting-started/interface-tour
getting-started/quickstart
```

```{toctree}
:maxdepth: 2
:caption: Tutorials
:hidden:

tutorials/index
tutorials/first-experiment
tutorials/compare-preprocessing
tutorials/build-advanced-pipeline
tutorials/batch-predictions
tutorials/analyze-model-performance
tutorials/synthetic-data-testing
```

```{toctree}
:maxdepth: 2
:caption: How-To Guides
:hidden:

how-to/index
how-to/datasets/import-csv
how-to/datasets/import-excel
how-to/datasets/import-matlab
how-to/datasets/import-folder
how-to/datasets/batch-scan
how-to/datasets/organize-groups
how-to/datasets/edit-config
how-to/datasets/inspect-data
how-to/pipelines/create-pipeline
how-to/pipelines/use-preset
how-to/pipelines/add-preprocessing
how-to/pipelines/add-model
how-to/pipelines/add-splitter
how-to/pipelines/use-branching
how-to/pipelines/use-generators
how-to/pipelines/import-export
how-to/pipelines/manage-library
how-to/experiments/launch-experiment
how-to/experiments/monitor-progress
how-to/experiments/stop-experiment
how-to/experiments/review-logs
how-to/results/view-scores
how-to/results/compare-chains
how-to/results/aggregated-results
how-to/results/export-predictions
how-to/results/manage-predictions
how-to/results/export-model
how-to/explore/playground-basics
how-to/explore/compare-steps
how-to/explore/reference-datasets
how-to/explore/export-to-editor
how-to/explore/inspector-basics
how-to/explore/inspector-views
how-to/lab/generate-synthetic
how-to/lab/transfer-analysis
how-to/lab/shap-importance
how-to/settings/change-theme
how-to/settings/manage-workspaces
how-to/settings/data-defaults
how-to/settings/language
how-to/settings/troubleshooting
```

```{toctree}
:maxdepth: 2
:caption: Reference
:hidden:

reference/index
reference/interface/sidebar
reference/interface/keyboard-shortcuts
reference/interface/themes-density
reference/datasets-page
reference/dataset-detail-page
reference/pipelines-page
reference/pipeline-editor-page
reference/node-catalog
reference/experiment-wizard
reference/run-progress-page
reference/history-page
reference/results-page
reference/aggregated-results-page
reference/predictions-page
reference/playground-page
reference/inspector-page
reference/synthesis-page
reference/transfer-page
reference/shap-page
reference/settings-page
reference/workspace-concept
reference/supported-formats
reference/glossary
```

```{toctree}
:maxdepth: 1
:caption: Appendix
:hidden:

appendix/faq
appendix/changelog
appendix/known-issues
```

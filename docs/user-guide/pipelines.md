# Pipelines

Pipelines describe the preprocessing, splitting, modeling, and evaluation flow
that nirs4all Studio sends to the `nirs4all` library.

## Pipeline library

The **Pipelines** page supports:

- saved user pipelines
- preset pipelines
- favorites
- search and sorting
- grid and list views
- import and export
- clone and delete actions

Use **New pipeline** to open the editor from an empty pipeline. Use a preset
when you want a known structure as a starting point.

## Pipeline editor

The editor is a visual builder backed by the node registry in `src/data/nodes`.
Common node categories include:

| Category | Examples |
| --- | --- |
| Preprocessing | SNV, MSC, smoothing, derivatives, scaling, baseline correction. |
| Splitting | train/test split, k-fold, grouped splitters, nirs4all splitters. |
| Models | PLS variants, linear models, SVM, ensembles, deep learning nodes. |
| Generators | OR, range, and Cartesian expansion for search spaces. |
| Branching | branch and merge structures. |
| Y processing | target scaling and transformations. |
| Augmentation | feature and signal augmentation steps. |

## Validation

Validation runs at several levels:

- parameter type and range checks
- required parameter checks
- step structure checks
- pipeline-level ordering and compatibility checks
- shape propagation where enough information is available

Fix validation errors before launching a run. Warnings usually indicate a
pipeline that can run but deserves review.

## Search spaces

The editor supports generator-style configuration for controlled pipeline
expansion:

- OR generators choose among alternatives
- range generators create parameter sweeps
- Cartesian generators combine several search dimensions

Use **count variants** or validation before running large searches.

## Dataset binding

Pipelines can be edited independently of a dataset, but many validations need a
dataset binding to infer shapes, target types, and fold structure. Bind a
dataset before final run validation.

## Import and export

Pipeline export serializes the Studio pipeline definition. It is useful for:

- sharing a pipeline between users
- preserving a baseline before editing
- reproducing a run setup

Imported pipelines should be validated before execution because node
availability depends on the installed app and library versions.

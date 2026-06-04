# Custom nodes

Custom nodes let users add Python operators to the pipeline editor without
modifying the built-in registry.

## Use cases

- proprietary preprocessing methods
- organization-approved model wrappers
- domain-specific transformations
- external package operators that follow compatible constructor and call
  patterns

## Node types

| Type | Typical use |
| --- | --- |
| preprocessing | Transform spectral matrices. |
| processing | Feature extraction and intermediate operations. |
| splitting | Cross-validation and train/test partitioning. |
| model | Estimators and predictors. |
| metrics | Evaluation metrics. |

## Class path

Custom nodes reference Python classes by import path:

```text
package.module.ClassName
```

Examples:

```text
sklearn.preprocessing.StandardScaler
nirs4all.operators.preprocessing.SNV
mycompany.transforms.CustomDetrend
```

## Package allowlist

Custom node package access is controlled by the workspace custom node settings.
Default safe packages include `nirs4all`, `sklearn`, `scipy`, `numpy`, and
`pandas`. Admin or workspace settings can allow additional packages.

## Parameter definitions

Supported parameter types:

| Type | UI |
| --- | --- |
| `int` | numeric input |
| `float` | numeric input |
| `bool` | switch |
| `string` | text input |
| `select` | dropdown |

Include sensible defaults and descriptions. Validation is much better when
numeric min/max and select options are explicit.

## Storage and sharing

Custom node definitions can live in:

| Scope | Use |
| --- | --- |
| user/custom | Personal nodes in browser or app state. |
| workspace | Shared project nodes stored with workspace settings. |
| admin | Organization-level approved nodes. |

Workspace nodes are better for team reproducibility because the definitions
travel with the workspace.

## Import and export

Custom nodes can be imported and exported as JSON. Validate imported nodes
before using them in production pipelines, especially when they reference
packages outside the default allowlist.

## Troubleshooting

| Error | Check |
| --- | --- |
| Package not in allowlist | Add the top-level package to custom node settings. |
| Invalid ID format | Use a namespaced snake-case ID such as `custom.my_scaler`. |
| Import failure | Confirm the package is installed in the backend Python environment. |
| Node does not appear | Refresh the editor and verify custom nodes are enabled. |
| Execution failure | Check constructor parameters, task compatibility, and backend logs. |

# Developer Guide: Adding New Node Types

This guide explains how to add new builtin node types to the nirs4all Pipeline Editor. For creating custom nodes via the UI, see [developer_guide_custom_nodes.md](developer_guide_custom_nodes.md).

## Overview

Node definitions are stored as JSON files organized by category. The Pipeline Editor uses these definitions to:

1. Display nodes in the node palette
2. Render parameter inputs in the configuration panel
3. Validate parameter values
4. Export to nirs4all pipeline format

## Directory Structure

```
src/data/nodes/
├── definitions/
│   ├── preprocessing/     # Preprocessing nodes
│   │   ├── nirs-core.json
│   │   ├── derivatives.json
│   │   ├── smoothing.json
│   │   └── ...
│   ├── models/            # Model nodes
│   │   ├── pls.json
│   │   ├── sklearn.json
│   │   └── ...
│   ├── splitting/         # Cross-validation splitters
│   ├── generators/        # Generator nodes (_or_, _range_, etc.)
│   ├── branching/         # Branch, merge nodes
│   ├── filters/           # Sample/feature filters
│   ├── augmentation/      # Data augmentation
│   ├── y-processing/      # Target variable processing
│   └── misc/              # Comments, charts, etc.
├── types.ts               # TypeScript types
├── NodeRegistry.ts        # Runtime registry
└── index.ts               # Public API
```

## Step 1: Choose the Right Category

Determine which category your node belongs to:

| Category | Type Value | Use Case |
|----------|------------|----------|
| Preprocessing | `preprocessing` | Feature/spectrum transformations |
| Model | `model` | Regression, classification models |
| Splitting | `splitting` | Cross-validation strategies |
| Y-Processing | `y_processing` | Target variable transformations |
| Generator | `generator` | Parameter sweeps, variants |
| Branch | `branch` | Parallel pipeline branches |
| Filter | `filter` | Sample/feature selection |
| Augmentation | `augmentation` | Data augmentation |

## Step 2: Create the Node Definition

### Basic Node Structure

```json
{
  "id": "preprocessing.my_transform",
  "name": "MyTransform",
  "type": "preprocessing",
  "classPath": "nirs4all.operators.transforms.MyTransform",
  "description": "Short description for tooltips",
  "longDescription": "Extended documentation with usage details.",
  "category": "My Category",
  "tags": ["tag1", "tag2"],
  "source": "nirs4all",
  "parameters": []
}
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique identifier: `type.snake_case_name` |
| `name` | `string` | Display name (usually PascalCase) |
| `type` | `NodeType` | Category type |
| `description` | `string` | Short description (< 100 chars) |
| `source` | `"nirs4all" \| "sklearn" \| "custom"` | Origin library |
| `parameters` | `ParameterDefinition[]` | Parameter list |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `classPath` | `string` | Full Python import path |
| `category` | `string` | Subcategory for grouping |
| `tags` | `string[]` | Searchable keywords |
| `aliases` | `string[]` | Alternative names |
| `longDescription` | `string` | Extended docs |
| `isAdvanced` | `boolean` | Hide in basic mode |
| `isExperimental` | `boolean` | Show warning badge |
| `isDeprecated` | `boolean` | Show deprecation notice |
| `deprecationMessage` | `string` | Migration guidance |
| `legacyClassPaths` | `string[]` | Previous paths (backwards compat) |

## Step 3: Define Parameters

### Parameter Types

| Type | UI Component | Description |
|------|--------------|-------------|
| `int` | Number input | Integer values |
| `float` | Number input | Decimal values |
| `bool` | Switch | True/false toggle |
| `string` | Text input | Text values |
| `select` | Dropdown | Fixed options |
| `array` | Multi-input | List of values |
| `object` | JSON editor | Complex objects |

### Basic Parameter

```json
{
  "name": "n_components",
  "type": "int",
  "default": 10,
  "min": 1,
  "max": 100,
  "description": "Number of components to keep"
}
```

### Parameter with Constraints

```json
{
  "name": "alpha",
  "type": "float",
  "default": 1.0,
  "min": 0.0,
  "max": 10.0,
  "step": 0.01,
  "required": true,
  "description": "Regularization strength"
}
```

### Select Parameter

```json
{
  "name": "kernel",
  "type": "select",
  "default": "rbf",
  "options": [
    { "value": "rbf", "label": "RBF (Gaussian)" },
    { "value": "linear", "label": "Linear" },
    { "value": "poly", "label": "Polynomial" }
  ],
  "description": "Kernel function for SVM"
}
```

### Advanced Parameter

```json
{
  "name": "verbose",
  "type": "bool",
  "default": false,
  "isAdvanced": true,
  "description": "Enable verbose logging"
}
```

### Conditional Parameter

Show parameter only when another parameter has a specific value:

```json
{
  "name": "degree",
  "type": "int",
  "default": 3,
  "min": 1,
  "max": 10,
  "dependsOn": "kernel",
  "dependsOnValue": "poly",
  "description": "Polynomial degree (only for poly kernel)"
}
```

### Sweepable Parameter

Enable parameter sweeps (for grid search):

```json
{
  "name": "n_components",
  "type": "int",
  "default": 10,
  "min": 1,
  "max": 50,
  "sweepable": true,
  "sweepPresets": [
    {
      "label": "1-30 by 5",
      "type": "range",
      "values": { "from": 1, "to": 30, "step": 5 }
    },
    {
      "label": "Common values",
      "type": "choices",
      "values": [5, 10, 15, 20]
    }
  ]
}
```

## Step 4: Add to the Category Index

Edit the category's `index.ts` to include your JSON file:

```typescript
// src/data/nodes/definitions/preprocessing/index.ts
import nirsCore from './nirs-core.json';
import derivatives from './derivatives.json';
import myCategory from './my-category.json';  // Add this
import type { NodeDefinition } from '../../types';

const preprocessingNodes: NodeDefinition[] = [
  ...(nirsCore as NodeDefinition[]),
  ...(derivatives as NodeDefinition[]),
  ...(myCategory as NodeDefinition[]),  // Add this
];

export default preprocessingNodes;
```

## Step 5: Add Category Configuration (if new category)

If you're adding a new subcategory, update `src/data/nodes/categories/`:

```typescript
// src/data/nodes/categories/preprocessing.ts
export const preprocessingCategories: SubcategoryConfig[] = [
  { id: 'nirs-core', label: 'NIRS Core', displayOrder: 1 },
  { id: 'derivatives', label: 'Derivatives', displayOrder: 2 },
  { id: 'my-category', label: 'My Category', displayOrder: 10 },  // Add this
];
```

## Step 6: Test Your Node

### Verify JSON Schema

Run the schema validation:

```bash
npm run validate-nodes
```

### Check UI Rendering

1. Start the dev server: `npm run dev`
2. Open the Pipeline Editor
3. Find your node in the palette
4. Drag it to the canvas
5. Select it and verify parameters render correctly

### Test Export

1. Add your node to a pipeline
2. Configure parameters
3. Export to YAML
4. Verify the output matches nirs4all format

## Complete Example

Here's a complete example of adding a new preprocessing node:

### 1. Create JSON Definition

```json
// src/data/nodes/definitions/preprocessing/nirs-core.json
[
  // ... existing nodes
  {
    "id": "preprocessing.spectral_pca",
    "name": "SpectralPCA",
    "type": "preprocessing",
    "classPath": "nirs4all.operators.transforms.SpectralPCA",
    "description": "PCA-based spectral decomposition",
    "longDescription": "Applies Principal Component Analysis for dimensionality reduction while preserving spectral variance.",
    "category": "NIRS Core",
    "tags": ["pca", "dimensionality", "reduction", "decomposition"],
    "source": "nirs4all",
    "parameters": [
      {
        "name": "n_components",
        "type": "int",
        "default": 10,
        "min": 1,
        "max": 100,
        "description": "Number of principal components to keep",
        "sweepable": true,
        "sweepPresets": [
          {
            "label": "5-50 by 5",
            "type": "range",
            "values": { "from": 5, "to": 50, "step": 5 }
          }
        ]
      },
      {
        "name": "whiten",
        "type": "bool",
        "default": false,
        "description": "Apply whitening to decorrelate components",
        "isAdvanced": true
      },
      {
        "name": "svd_solver",
        "type": "select",
        "default": "auto",
        "options": [
          { "value": "auto", "label": "Auto" },
          { "value": "full", "label": "Full SVD" },
          { "value": "arpack", "label": "ARPACK (sparse)" },
          { "value": "randomized", "label": "Randomized" }
        ],
        "description": "SVD solver algorithm",
        "isAdvanced": true
      }
    ],
    "supportsParameterSweeps": true,
    "supportsStepGenerator": true
  }
]
```

### 2. Verify Export Format

When exported, this node produces:

```yaml
- SpectralPCA:
    n_components: 10
    whiten: false
    svd_solver: auto
```

## Advanced Features

### Container Nodes

For nodes that contain child steps:

```json
{
  "id": "branching.sample_augmentation",
  "name": "SampleAugmentation",
  "type": "sample_augmentation",
  "isContainer": true,
  "containerType": "children",
  "description": "Apply augmentation to individual samples"
}
```

### Generator Nodes

For nodes that create parameter variations:

```json
{
  "id": "generator.or",
  "name": "_or_",
  "type": "generator",
  "generatorKind": "or",
  "isContainer": true,
  "containerType": "branches",
  "defaultBranches": 2,
  "description": "Try each variant separately"
}
```

### Deep Learning Models

```json
{
  "id": "model.nicon",
  "name": "NICON",
  "type": "model",
  "isDeepLearning": true,
  "supportsFinetuning": true,
  "parameters": [
    // ... training parameters
  ]
}
```

## Validation Rules

The following validation rules apply to node definitions:

1. **ID Format**: Must be `type.snake_case_name`
2. **Unique ID**: No duplicates across all definitions
3. **Required Fields**: id, name, type, description, source, parameters
4. **Parameter Names**: Must be snake_case
5. **Numeric Constraints**: min ≤ default ≤ max
6. **Select Options**: Required for `select` type parameters

## Troubleshooting

### Node Not Appearing

1. Check JSON syntax (use a JSON validator)
2. Verify the file is imported in the category's `index.ts`
3. Check browser console for import errors

### Parameters Not Rendering

1. Verify parameter `type` is valid
2. Check for missing `options` on `select` types
3. Ensure `dependsOn` references an existing parameter

### Export Issues

1. Verify `classPath` matches nirs4all
2. Check parameter `name` matches Python argument
3. Test with nirs4all CLI

## Related Documentation

- [types.ts](../src/data/nodes/types.ts) - TypeScript type definitions
- [NodeRegistry.ts](../src/data/nodes/NodeRegistry.ts) - Runtime registry
- [node_specifications.md](node_specifications.md) - Original specifications
- [developer_guide_custom_nodes.md](developer_guide_custom_nodes.md) - Custom nodes via UI

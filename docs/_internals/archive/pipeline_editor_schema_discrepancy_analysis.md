# Pipeline Editor Schema Discrepancy Analysis

## Executive Summary

This document analyzes the fundamental misalignment between the current pipeline editor implementation and the actual nirs4all pipeline schema. The editor was designed around a simplified node-based model that doesn't capture the full complexity of nirs4all's powerful pipeline DSL.

**Date**: January 4, 2026
**Status**: Analysis Complete - Action Required

---

## Part 1: Core Architecture Problems

### 1.1 Fundamental Schema Mismatch

The nirs4all pipeline uses a **dict-based DSL with special keywords** that provides:
- **Wrapper keywords**: `model`, `y_processing`, `preprocessing`, `sample_augmentation`, `feature_augmentation`, etc.
- **Step-level modifiers**: `name`, `finetune_params`, `train_params`, `action`, `_range_`, `_or_`, `_grid_`
- **Container operators**: Operators with nested children (`branch`, `merge`, `concat_transform`, etc.)

The current editor treats everything as **flat nodes with params** which loses:
- The distinction between wrapper keywords and actual operator classes
- Step-level metadata (custom names, finetune_params at step level)
- The container nature of certain step types

### 1.2 The Two Types of Steps in nirs4all

| Category | Description | nirs4all Format | Current Editor Support |
|----------|-------------|-----------------|------------------------|
| **Simple Operators** | Sklearn transformers, splitters, basic transforms | `{"class": "..."}` or just class name | ✅ Works |
| **Wrapped Operators** | Operators wrapped in keywords with metadata | `{"model": {...}, "name": "...", "finetune_params": {...}}` | ⚠️ Partial |
| **Container Operators** | Operators with nested children | `{"sample_augmentation": {"transformers": [...], "count": 2}}` | ❌ Broken |

---

## Part 2: Detailed Step-by-Step Analysis

### 2.1 Simple Steps (Working)

These are correctly handled:

```yaml
# nirs4all
- class: sklearn.preprocessing.MinMaxScaler

# Editor representation → correct
{
  type: "preprocessing",
  name: "MinMaxScaler",
  params: {}
}
```

### 2.2 Model Steps with Metadata (Partially Working)

**nirs4all format:**
```json
{
  "model": {
    "class": "sklearn.cross_decomposition.PLSRegression",
    "params": {"n_components": 10}
  },
  "name": "PLS-Custom-Name",
  "finetune_params": {
    "n_trials": 50,
    "approach": "single",
    "model_params": {"n_components": {"type": "int", "low": 1, "high": 30}}
  },
  "train_params": {
    "epochs": 100,
    "batch_size": 32
  }
}
```

**Current editor issues:**
- ✅ `finetuneConfig` exists but maps to `finetune_params.model_params` correctly
- ❌ `train_params` at step level not properly handled (confused with training config)
- ❌ `name` is used as `customName` but not properly exported
- ❌ `finetune_params.train_params` (for neural networks) not supported

### 2.3 Sample Augmentation (BROKEN)

**nirs4all format:**
```json
{
  "sample_augmentation": {
    "transformers": [
      {"class": "nirs4all.operators.transforms.Rotate_Translate", "params": {"p_range": 1.0}},
      {"class": "nirs4all.operators.transforms.GaussianAdditiveNoise", "params": {"sigma": 0.003}}
    ],
    "count": 2,
    "selection": "random",
    "random_state": 42
  }
}
```

**Current editor problems:**
1. Treats it as a node with flat params (`count`, `selection`)
2. `transformers` array shown as read-only list - **cannot add/edit/remove transformers**
3. **Not rendered as a container** with nested children that can be drop targets
4. Missing transformer configuration UI entirely

**Required fix:**
- Render as **collapsible container** like branch/generator
- Each transformer is a **nested step** that can be edited
- Add drop zone inside to add new transformers
- Preserve transformer order (drag-to-reorder)

### 2.4 Feature Augmentation (BROKEN)

**nirs4all format (with generator):**
```json
{
  "feature_augmentation": {
    "_or_": [
      {"class": "nirs4all.operators.transforms.StandardNormalVariate"},
      {"class": "nirs4all.operators.transforms.FirstDerivative"},
      {"class": "nirs4all.operators.transforms.MSC"}
    ],
    "pick": [1, 2],
    "count": 5
  },
  "action": "extend"
}
```

**Or simple list format:**
```json
{
  "feature_augmentation": [
    {"class": "nirs4all.operators.transforms.SNV"},
    {"class": "nirs4all.operators.transforms.FirstDerivative"}
  ],
  "action": "replace"
}
```

**Current problems:**
1. `action` is shown in params but should be a top-level step property
2. `_or_` with `pick`/`count` generator keywords not editable
3. Transform list is read-only
4. **Not a container** - should allow adding/editing transforms

### 2.5 Concat Transform (BROKEN)

**nirs4all format:**
```json
{
  "concat_transform": [
    {"class": "sklearn.decomposition.PCA", "params": {"n_components": 20}},
    {"class": "sklearn.decomposition.TruncatedSVD", "params": {"n_components": 15}}
  ]
}
```

**Current problems:**
1. Shows branches summary as read-only
2. Cannot add/edit/remove transforms inside
3. Should be a **container with nested steps**

### 2.6 Branch (Partially Working)

**nirs4all format (named branches):**
```json
{
  "branch": {
    "snv_pls": [
      {"class": "nirs4all.operators.transforms.SNV"},
      {"model": {"class": "sklearn.cross_decomposition.PLSRegression"}}
    ],
    "msc_rf": [
      {"class": "nirs4all.operators.transforms.MSC"},
      {"model": {"class": "sklearn.ensemble.RandomForestRegressor"}}
    ]
  }
}
```

**Current implementation:**
- ✅ Branches rendered correctly with nested steps
- ✅ Drop zones inside branches work
- ❌ **Named branches** (dict keys like "snv_pls") not supported - only indexed arrays
- ❌ Branch metadata (names) stored in separate `branchMetadata` array but not synced

### 2.7 Merge with Complex Selection (BROKEN)

**nirs4all format:**
```json
{
  "merge": {
    "predictions": [
      {"branch": 0, "select": "best", "metric": "rmse"},
      {"branch": 1, "select": "all"},
      {"branch": 2, "select": {"top_k": 2}, "metric": "r2"}
    ],
    "features": [0],
    "output_as": "features",
    "on_missing": "warn"
  }
}
```

**Current problems:**
1. Only simple merge modes supported (`Concatenate`, `Mean`, `Stacking`)
2. Complex `predictions` selection not editable
3. Per-branch selection (`best`, `all`, `top_k`) not supported
4. `output_as` and `on_missing` not configurable

### 2.8 Generator Steps with Parameters (Partially Working)

**nirs4all format:**
```json
{
  "model": {"class": "sklearn.cross_decomposition.PLSRegression"},
  "_range_": [2, 15, 3],
  "param": "n_components"
}
```

**Or step-level _or_:**
```json
{
  "_or_": [
    {"class": "nirs4all.operators.transforms.SNV"},
    {"class": "nirs4all.operators.transforms.MSC"}
  ],
  "count": 2
}
```

**Current problems:**
1. `_range_`, `_log_range_`, `_grid_` on steps not properly handled
2. Generator options (`count`, `pick`, `arrange`) attached to wrong place
3. `param` keyword for specifying which parameter to sweep not supported

### 2.9 Finetune with train_params (BROKEN)

**nirs4all format for neural networks:**
```json
{
  "model": {
    "function": "nirs4all.operators.models.tensorflow.nicon.customizable_nicon"
  },
  "name": "NICON-Tuned",
  "finetune_params": {
    "n_trials": 10,
    "sample": "hyperband",
    "model_params": {
      "filters_1": [8, 16, 32],
      "dropout_rate": {"type": "float", "low": 0.1, "high": 0.5}
    },
    "train_params": {
      "epochs": {"type": "int", "low": 5, "high": 50},
      "batch_size": [16, 32, 64]
    }
  },
  "train_params": {
    "epochs": 100,
    "batch_size": 32
  }
}
```

**Current problems:**
1. `finetune_params.train_params` (tunable training params) not supported
2. `train_params` at step level (default training config) confused with `trainingConfig`
3. `function` instead of `class` for function-based models not handled
4. Array values in model_params (like `[8, 16, 32]`) not supported - only dict configs

---

## Part 3: Component-by-Component Fix Recommendations

### 3.1 Types Changes Required (`types.ts`)

```typescript
// ADD: New unified step-level config
export interface StepMetadata {
  customName?: string;           // "name" in nirs4all
  trainParams?: TrainParams;     // Step-level train_params (defaults)
  action?: "extend" | "add" | "replace";  // For augmentation steps
}

// FIX: FinetuneConfig to include train_params tuning
export interface FinetuneConfig {
  enabled: boolean;
  n_trials: number;
  timeout?: number;
  approach: "grouped" | "individual" | "single" | "cross";
  eval_mode: "best" | "mean";
  sample?: "grid" | "random" | "hyperband";
  model_params: FinetuneParamConfig[];
  train_params?: FinetuneParamConfig[];  // ADD: For neural network training param tuning
}

// ADD: Proper train params structure
export interface TrainParams {
  epochs?: number;
  batch_size?: number;
  learning_rate?: number;
  patience?: number;
  verbose?: number;
  [key: string]: unknown;  // Allow arbitrary params
}

// FIX: Container steps need children array
export interface PipelineStep {
  // ... existing fields ...

  // Container children (for sample_augmentation, feature_augmentation, concat_transform)
  children?: PipelineStep[];

  // Named branches support (dict with string keys)
  namedBranches?: Record<string, PipelineStep[]>;

  // Step-level metadata
  stepMetadata?: StepMetadata;

  // Function-based operators (e.g., nicon)
  functionPath?: string;

  // Generator on step (not in branches)
  stepGenerator?: {
    type: "_range_" | "_log_range_" | "_grid_" | "_or_";
    values: number[] | unknown[];
    param?: string;  // Which param the generator affects
    pick?: number | [number, number];
    arrange?: number | [number, number];
    count?: number;
  };
}
```

### 3.2 TreeNode Changes

**Container Step Rendering:**

```typescript
// TreeNode.tsx - Add container types to branch-like rendering
const CONTAINER_TYPES: StepType[] = [
  "branch",
  "generator",
  "sample_augmentation",
  "feature_augmentation",
  "concat_transform",
  "sample_filter"
];

function TreeNode({ step, ... }) {
  const isContainer = CONTAINER_TYPES.includes(step.type);

  // Render children for container types
  if (isContainer && step.children?.length) {
    return (
      <div>
        {/* Node itself */}
        {nodeContent}

        {/* Children container with drop zone */}
        <div className="ml-4 border-l-2 border-dashed">
          <ChildrenDropZone stepId={step.id} path={path} />
          {step.children.map((child, i) => (
            <TreeNode key={child.id} step={child} ... />
          ))}
        </div>
      </div>
    );
  }

  return nodeContent;
}
```

### 3.3 StepConfigPanel Changes

**For Container Steps:**

```typescript
// Instead of read-only lists, render editable child steps
function SampleAugmentationStepContent({ step, onUpdate }) {
  const handleAddTransformer = (transform: PipelineStep) => {
    onUpdate(step.id, {
      children: [...(step.children || []), transform]
    });
  };

  const handleRemoveTransformer = (childId: string) => {
    onUpdate(step.id, {
      children: step.children?.filter(c => c.id !== childId)
    });
  };

  return (
    <div>
      {/* Container params (count, selection, etc.) */}
      <ContainerParams step={step} onUpdate={onUpdate} />

      {/* Editable transformer list */}
      <TransformerList
        transformers={step.children}
        onAdd={handleAddTransformer}
        onRemove={handleRemoveTransformer}
        onUpdate={(childId, updates) => {
          // Update specific child
        }}
      />
    </div>
  );
}
```

### 3.4 Backend Conversion Changes (`pipelines.py`, `nirs4all_adapter.py`)

**Export to nirs4all format:**

```python
def step_to_nirs4all(step: dict) -> dict:
    """Convert frontend step to nirs4all format."""
    step_type = step.get("type")

    # Container types need special handling
    if step_type == "sample_augmentation":
        transformers = []
        for child in step.get("children", []):
            transformers.append(child_to_transformer(child))

        return {
            "sample_augmentation": {
                "transformers": transformers,
                "count": step.get("params", {}).get("count", 1),
                "selection": step.get("params", {}).get("selection", "random"),
                "random_state": step.get("params", {}).get("random_state", 42),
            }
        }

    if step_type == "feature_augmentation":
        children = step.get("children", [])
        transforms = [child_to_transformer(c) for c in children]

        result = {"feature_augmentation": transforms}

        # Handle generator options
        if step.get("stepGenerator"):
            gen = step["stepGenerator"]
            result["feature_augmentation"] = {
                "_or_": transforms,
                "pick": gen.get("pick"),
                "count": gen.get("count"),
            }

        # Add action
        if step.get("stepMetadata", {}).get("action"):
            result["action"] = step["stepMetadata"]["action"]

        return result

    if step_type == "model":
        result = build_model_step(step)

        # Add step-level train_params (defaults)
        if step.get("stepMetadata", {}).get("trainParams"):
            result["train_params"] = step["stepMetadata"]["trainParams"]

        return result

    # ... handle other types
```

---

## Part 4: Implementation Priority

### Phase 1: Critical Container Fixes (High Priority)

| Component | Issue | Effort | Impact |
|-----------|-------|--------|--------|
| `sample_augmentation` | Not a container, can't edit transformers | Medium | **Critical** |
| `feature_augmentation` | Read-only, no _or_/pick support | Medium | **Critical** |
| `concat_transform` | Read-only branches | Low | High |
| `sample_filter` | Read-only filters | Low | Medium |

### Phase 2: Model Configuration Fixes (High Priority)

| Component | Issue | Effort | Impact |
|-----------|-------|--------|--------|
| `finetune_params.train_params` | Not supported | Medium | **Critical** |
| Step-level `train_params` | Confused with training config | Low | High |
| `function` vs `class` | Function-based models broken | Low | Medium |
| Model `name` export | customName not exported | Low | Medium |

### Phase 3: Advanced Features (Medium Priority)

| Component | Issue | Effort | Impact |
|-----------|-------|--------|--------|
| Named branches | Dict keys for branch names | Medium | Medium |
| Complex merge | `predictions` selection | High | Medium |
| Step-level generators | `_range_`/`_grid_` on steps | Medium | Medium |
| Generator `param` keyword | Which param to sweep | Low | Medium |

### Phase 4: Polish (Lower Priority)

| Component | Issue | Effort | Impact |
|-----------|-------|--------|--------|
| Branch metadata sync | Names can desync | Low | Low |
| Disabled step visual | No visual indicator | Low | Low |
| Real-time validation | Backend only | Medium | Medium |

---

## Part 5: Immediate Action Items

### Action 1: Create Container Step Base Component

Create a reusable `ContainerStepNode` that:
- Renders the step header with expand/collapse
- Shows a drop zone for children
- Recursively renders children with full editing support
- Handles add/remove/reorder of children

### Action 2: Refactor StepConfigPanel

Split into:
- `SimpleStepConfig` - For transforms, splitters, etc.
- `ModelStepConfig` - With finetuning, training tabs
- `ContainerStepConfig` - For sample_augmentation, etc. with children editor
- `BranchStepConfig` - For branch/generator with nested pipelines

### Action 3: Fix Backend Conversion

Update `nirs4all_adapter.py`:
- Proper export of container steps with children
- Support for `finetune_params.train_params`
- Support for function-based operators
- Step-level generator syntax

### Action 4: Update Import Logic

When loading samples:
- Parse `sample_augmentation.transformers` → `children`
- Parse `feature_augmentation._or_` → `stepGenerator` + `children`
- Parse `concat_transform` list → `children`
- Parse model `train_params` → `stepMetadata.trainParams`

---

## Appendix A: Complete Step Type Classification

| nirs4all Keyword | Step Type | Is Container | Children Location | Special Props |
|------------------|-----------|--------------|-------------------|---------------|
| `class` (transform) | preprocessing | No | - | - |
| `class` (splitter) | splitting | No | - | group column |
| `y_processing` | y_processing | No | - | - |
| `model` | model | No | - | name, finetune_params, train_params |
| `branch` | branch | Yes | branches (array/dict) | named branches |
| `_or_` | generator | Yes | branches | pick, arrange, count |
| `_cartesian_` | generator | Yes | branches | - |
| `sample_augmentation` | sample_augmentation | **Yes** | transformers | count, selection |
| `feature_augmentation` | feature_augmentation | **Yes** | list or _or_ | action, pick, count |
| `sample_filter` | sample_filter | **Yes** | filters | mode, report |
| `concat_transform` | concat_transform | **Yes** | list of transforms | - |
| `merge` | merge | No* | - | predictions, features, output_as |
| `chart_2d`/`chart_y` | chart | No | - | include/highlight excluded |
| `_comment` | comment | No | - | text |

*Note: `merge` is not a container but has complex configuration

---

## Appendix B: Example Conversions

### Sample Augmentation

**nirs4all:**
```json
{
  "sample_augmentation": {
    "transformers": [
      {"class": "nirs4all.operators.transforms.Rotate_Translate", "params": {"p_range": 1.0}},
      {"class": "nirs4all.operators.transforms.GaussianAdditiveNoise", "params": {"sigma": 0.003}}
    ],
    "count": 2,
    "selection": "random"
  }
}
```

**Frontend (FIXED):**
```typescript
{
  id: "step-1",
  type: "sample_augmentation",
  name: "SampleAugmentation",
  params: {
    count: 2,
    selection: "random"
  },
  children: [
    {
      id: "child-1",
      type: "augmentation",
      name: "Rotate_Translate",
      params: { p_range: 1.0 },
      classPath: "nirs4all.operators.transforms.Rotate_Translate"
    },
    {
      id: "child-2",
      type: "augmentation",
      name: "GaussianAdditiveNoise",
      params: { sigma: 0.003 },
      classPath: "nirs4all.operators.transforms.GaussianAdditiveNoise"
    }
  ]
}
```

### Model with Full Finetuning

**nirs4all:**
```json
{
  "model": {"function": "nirs4all.operators.models.tensorflow.nicon.customizable_nicon"},
  "name": "NICON-Tuned",
  "finetune_params": {
    "n_trials": 10,
    "sample": "hyperband",
    "model_params": {
      "filters_1": [8, 16, 32],
      "dropout_rate": {"type": "float", "low": 0.1, "high": 0.5}
    },
    "train_params": {
      "epochs": {"type": "int", "low": 5, "high": 50},
      "batch_size": [16, 32, 64]
    }
  },
  "train_params": {"epochs": 100, "batch_size": 32}
}
```

**Frontend (FIXED):**
```typescript
{
  id: "step-1",
  type: "model",
  name: "nicon",
  functionPath: "nirs4all.operators.models.tensorflow.nicon.customizable_nicon",
  params: {},
  stepMetadata: {
    customName: "NICON-Tuned",
    trainParams: { epochs: 100, batch_size: 32 }
  },
  finetuneConfig: {
    enabled: true,
    n_trials: 10,
    sample: "hyperband",
    model_params: [
      { name: "filters_1", type: "categorical", choices: [8, 16, 32] },
      { name: "dropout_rate", type: "float", low: 0.1, high: 0.5 }
    ],
    train_params: [
      { name: "epochs", type: "int", low: 5, high: 50 },
      { name: "batch_size", type: "categorical", choices: [16, 32, 64] }
    ]
  }
}
```

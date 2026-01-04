# nirs4all Pipeline Architecture Research

## Executive Summary

This document provides a comprehensive analysis of the nirs4all pipeline architecture, step types, controllers, and configurations. It serves as the foundation for redesigning the pipeline editor.

---

## Table of Contents

1. [Pipeline Execution Architecture](#1-pipeline-execution-architecture)
2. [Step Types Taxonomy](#2-step-types-taxonomy)
3. [Controller Registry Pattern](#3-controller-registry-pattern)
4. [Complete Step Type Reference](#4-complete-step-type-reference)
5. [Container Steps (Nested Children)](#5-container-steps-nested-children)
6. [Special Keywords Reference](#6-special-keywords-reference)
7. [Generator Syntax](#7-generator-syntax)
8. [Step Configuration Schema](#8-step-configuration-schema)
9. [Model Training Parameters](#9-model-training-parameters)
10. [Special Handling Requirements](#10-special-handling-requirements)

---

## 1. Pipeline Execution Architecture

### Core Components

```
PipelineRunner (main entry point)
    ├── PipelineOrchestrator (execution orchestration)
    │   ├── StepParser (step normalization)
    │   ├── StepRunner (step execution)
    │   └── ControllerRegistry (step dispatch)
    ├── Predictor (prediction mode)
    ├── Explainer (SHAP explanations)
    └── Retrainer (model retraining)
```

### Execution Flow

1. Pipeline definition (list of steps) is parsed by `StepParser`
2. Each step is normalized to `ParsedStep` dataclass
3. `ControllerRegistry` finds matching controller by priority
4. Controller's `execute()` method processes the step
5. Context is updated and passed to next step

### ParsedStep Structure

```python
@dataclass
class ParsedStep:
    operator: Any           # Deserialized operator instance
    keyword: str            # Step keyword (e.g., 'model', 'branch')
    step_type: StepType     # WORKFLOW, SERIALIZED, SUBPIPELINE, DIRECT
    original_step: Any      # Original step configuration
    metadata: Dict[str, Any]
    force_layout: Optional[str]  # Optional data layout override
```

---

## 2. Step Types Taxonomy

### Categories Overview

| Category | Description | Container? | Examples |
|----------|-------------|------------|----------|
| **Transforms** | Feature preprocessing | No | `SNV`, `MSC`, `PCA`, `MinMaxScaler` |
| **Y-Processing** | Target scaling | No | `StandardScaler`, `QuantileTransformer` |
| **Splitters** | Data partitioning | No | `KFold`, `ShuffleSplit`, `SPXY` |
| **Models** | ML training | No | `PLSRegression`, `RandomForest`, `Ridge` |
| **Meta-Models** | Stacking | No | `MetaModel(Ridge())` |
| **Branches** | Parallel execution | **Yes** | `branch`, `source_branch` |
| **Merge** | Branch combination | **Yes** (receives) | `merge`, `merge_sources` |
| **Augmentation** | Data enhancement | **Yes** | `feature_augmentation`, `sample_augmentation` |
| **Filters** | Sample exclusion | No | `sample_filter`, `outlier_excluder` |
| **Partitioners** | Sample splitting | **Yes** | `metadata_partitioner`, `sample_partitioner` |
| **Concat** | Feature concatenation | **Yes** | `concat_transform` |
| **Charts** | Visualization | No | Various chart operators |

### Step Type Hierarchy

```
Simple Operators (leaf nodes)
├── TransformerMixin (preprocessing)
├── CV Splitters (data partitioning)
├── Models (training)
└── Filters (sample exclusion)

Container Operators (nested children)
├── branch (parallel sub-pipelines)
├── source_branch (per-source pipelines)
├── feature_augmentation (parallel feature transforms)
├── sample_augmentation (augmentation transforms)
├── concat_transform (multiple transforms to concat)
├── metadata_partitioner (per-metadata-value branches)
├── sample_partitioner (outlier-based branches)
└── merge (collects from branches)
```

---

## 3. Controller Registry Pattern

### Controller Base Class

```python
class OperatorController(ABC):
    priority: int = 100  # Lower = higher priority

    @classmethod
    @abstractmethod
    def matches(cls, step: Any, operator: Any, keyword: str) -> bool:
        """Check if controller handles this step"""

    @classmethod
    def use_multi_source(cls) -> bool:
        """Whether controller supports multi-source datasets"""
        return False

    @classmethod
    def supports_prediction_mode(cls) -> bool:
        """Whether controller runs during prediction"""
        return False

    @abstractmethod
    def execute(
        self,
        step_info: ParsedStep,
        dataset: SpectroDataset,
        context: ExecutionContext,
        runtime_context: RuntimeContext,
        source: int = -1,
        mode: str = "train",
        loaded_binaries: Optional[List[Tuple[str, Any]]] = None,
        prediction_store: Optional[Any] = None
    ) -> Tuple[ExecutionContext, StepOutput]:
        """Execute the step"""
```

### Controller Priority Order

| Priority | Controller | Notes |
|----------|------------|-------|
| 5 | `BranchController` | Container: parallel branches |
| 5 | `MergeController` | Container: exits branch mode |
| 5 | `SourceBranchController` | Container: per-source |
| 5 | `YTransformerMixinController` | Target processing |
| 5 | `MetaModelController` | Stacking meta-learner |
| 5 | `SampleFilterController` | Sample exclusion |
| 6 | `SklearnModelController` | ML models |
| 10 | `TransformerMixinController` | Preprocessing |
| 10 | `CrossValidatorController` | CV splitters |
| 10 | `FeatureAugmentationController` | Feature augmentation |
| 10 | `SampleAugmentationController` | Sample augmentation |
| 10 | `ConcatAugmentationController` | Concat transform |
| 15 | `BaseModelController` (abstract) | Base for models |

---

## 4. Complete Step Type Reference

### 4.1 Transformers (`preprocessing`)

**Keyword**: Direct or `preprocessing`

**Controller**: `TransformerMixinController`

**Matches**: Any `sklearn.base.TransformerMixin`

**Configuration Formats**:

```python
# Direct instance
MinMaxScaler()

# Class serialization
{"class": "sklearn.preprocessing.MinMaxScaler", "params": {...}}

# With keyword
{"preprocessing": MinMaxScaler()}

# With fit_on_all option
{"preprocessing": StandardScaler(), "fit_on_all": True}
```

**Built-in nirs4all Transforms**:
- `SNV` (StandardNormalVariate)
- `MSC` (MultiplicativeScatterCorrection)
- `FirstDerivative`, `SecondDerivative`
- `SavitzkyGolay`
- `Detrend`
- `Wavelet`
- `Rotate_Translate`
- `GaussianAdditiveNoise`
- Many more in `nirs4all.operators.transforms`

---

### 4.2 Y-Processing (`y_processing`)

**Keyword**: `y_processing`

**Controller**: `YTransformerMixinController`

**Configuration Formats**:

```python
# Single transformer
{"y_processing": StandardScaler()}

# Chained transformers
{"y_processing": [StandardScaler(), QuantileTransformer(n_quantiles=30)]}

# Serialized
{"y_processing": {"class": "sklearn.preprocessing.StandardScaler"}}
```

**Special Behavior**:
- Transforms target values instead of features
- Fits on train targets, transforms all
- Supports chained transforms (applied sequentially)

---

### 4.3 Splitters (CV/Train-Test Split)

**Keyword**: Direct or `split`

**Controller**: `CrossValidatorController`

**Matches**: Any object with `split(X, ...)` method

**Configuration Formats**:

```python
# Direct instance
KFold(n_splits=5, shuffle=True)

# Serialized
{"class": "sklearn.model_selection.KFold", "params": {"n_splits": 5}}

# With group forcing
{"split": KFold(n_splits=5), "force_group": "sample_id"}
```

**Built-in Splitters**:
- sklearn: `KFold`, `StratifiedKFold`, `ShuffleSplit`, `GroupKFold`
- nirs4all: `SPXYGFold`, `KennardStone`, `SPXY`

**Special Parameters**:
- `force_group`: Column name for group-aware splitting
- `aggregation`: How to aggregate group features (`"mean"`, `"median"`)

---

### 4.4 Models (`model`)

**Keyword**: `model`

**Controllers**:
- `SklearnModelController` (sklearn-compatible)
- `TensorFlowModelController` (Keras/TF)
- `PyTorchModelController` (PyTorch)
- `AutoGluonModelController` (AutoGluon)

**Configuration Formats**:

```python
# Simple
{"model": PLSRegression(n_components=10)}

# With name
{"model": PLSRegression(10), "name": "PLS-10"}

# Serialized
{"model": {"class": "sklearn.cross_decomposition.PLSRegression", "params": {...}}}

# With finetune
{
    "model": PLSRegression(),
    "name": "PLS-Tuned",
    "finetune_params": {...}
}

# With train_params (for neural networks)
{
    "model": {...},
    "train_params": {"epochs": 100, "batch_size": 32}
}
```

---

### 4.5 Meta-Models (`MetaModel`)

**Keyword**: `model` with `MetaModel` operator

**Controller**: `MetaModelController`

**Configuration**:

```python
{
    "model": {
        "class": "nirs4all.operators.models.MetaModel",
        "params": {
            "model": Ridge(alpha=0.5),
            "source_models": "all"  # or explicit list
        }
    },
    "name": "Meta-Ridge"
}
```

**Special Behavior**:
- Collects OOF predictions from previous models
- Trains meta-learner on stacked predictions
- Handles cross-branch stacking

---

### 4.6 Branch (`branch`) - CONTAINER

**Keyword**: `branch`

**Controller**: `BranchController`

**Configuration Formats**:

```python
# Named branches (dict)
{
    "branch": {
        "snv_path": [SNV(), PLSRegression(10)],
        "msc_path": [MSC(), RandomForest()]
    }
}

# Anonymous branches (list of lists)
{
    "branch": [
        [SNV(), PLSRegression(10)],
        [MSC(), RandomForest()]
    ]
}

# Generator syntax
{
    "branch": {"_or_": [SNV(), MSC(), Detrend()]}
}
```

**Nested Structure**:
```yaml
branch:
  branch_name:
    - step1  # Transform
    - step2  # Transform
    - model: {...}  # Model
```

**Special Behavior**:
- Creates independent execution contexts per branch
- Steps after branch execute on ALL branches
- Must be followed by `merge` to exit branch mode

---

### 4.7 Source Branch (`source_branch`) - CONTAINER

**Keyword**: `source_branch`

**Controller**: `SourceBranchController`

**Configuration**:

```python
# Per-source pipelines
{
    "source_branch": {
        "NIR": [SNV(), SavitzkyGolay()],
        "markers": [VarianceThreshold(), MinMaxScaler()]
    }
}

# Auto mode (empty pipeline per source)
{"source_branch": "auto"}

# List syntax (index-based)
{
    "source_branch": [
        [MinMaxScaler()],      # source 0
        [PCA(20), MinMaxScaler()]  # source 1
    ]
}
```

**Special Behavior**:
- For multi-source datasets only
- Each source processed independently
- Different preprocessing per source

---

### 4.8 Merge (`merge`, `merge_sources`, `merge_predictions`) - CONTAINER (receives)

**Keyword**: `merge`, `merge_sources`, `merge_predictions`

**Controller**: `MergeController`

**Configuration Formats**:

```python
# Simple string mode
{"merge": "features"}      # Collect features from branches
{"merge": "predictions"}   # Collect OOF predictions
{"merge": "all"}           # Both features and predictions

# Advanced dict mode
{
    "merge": {
        "predictions": [
            {"branch": 0, "select": "best", "metric": "rmse"},
            {"branch": 1, "select": {"top_k": 2}, "metric": "r2"},
            {"branch": 2, "select": "all"}
        ],
        "features": [0],  # Include features from branch 0
        "output_as": "features",  # or "sources", "dict"
        "on_missing": "warn"  # or "error"
    }
}

# Source merge (for multi-source)
{"merge_sources": "concat"}  # or "stack", "dict"
```

**Special Parameters**:
- `output_as`: `"features"` (concat), `"sources"` (preserve), `"dict"` (multi-input)
- `on_missing`: `"error"` or `"warn"`
- `unsafe`: Disable OOF reconstruction (data leakage warning)

---

### 4.9 Feature Augmentation (`feature_augmentation`) - CONTAINER

**Keyword**: `feature_augmentation`

**Controller**: `FeatureAugmentationController`

**Configuration**:

```python
{
    "feature_augmentation": [
        SNV(),
        MSC(),
        SavitzkyGolay(window_length=11)
    ],
    "action": "extend"  # or "add", "replace"
}
```

**Action Modes**:
- `"extend"` (default): Add new processings. Linear growth.
- `"add"`: Chain on ALL existing. Keep originals. Multiplicative with originals.
- `"replace"`: Chain on ALL existing. Discard originals. Multiplicative.

---

### 4.10 Sample Augmentation (`sample_augmentation`) - CONTAINER

**Keyword**: `sample_augmentation`

**Controller**: `SampleAugmentationController`

**Configuration**:

```python
# Standard mode
{
    "sample_augmentation": {
        "transformers": [
            Rotate_Translate(p_range=1.0),
            GaussianAdditiveNoise(sigma=0.003)
        ],
        "count": 2,
        "selection": "random",  # or "all"
        "random_state": 42
    }
}

# Balanced mode (for imbalanced datasets)
{
    "sample_augmentation": {
        "transformers": [...],
        "balance": "y",  # or metadata column
        "target_size": 100,  # or "max_factor": 3.0
        "bins": 10  # for regression tasks
    }
}
```

**Training-Only**: Does not run in prediction mode.

---

### 4.11 Concat Transform (`concat_transform`) - CONTAINER

**Keyword**: `concat_transform`

**Controller**: `ConcatAugmentationController`

**Configuration**:

```python
{
    "concat_transform": [
        PCA(n_components=50),
        TruncatedSVD(n_components=30)
    ]
}
```

**Behavior**: Applies each transform, concatenates outputs horizontally.

---

### 4.12 Sample Filter (`sample_filter`)

**Keyword**: `sample_filter`

**Controller**: `SampleFilterController`

**Configuration**:

```python
{
    "sample_filter": {
        "filters": [
            YOutlierFilter(method="iqr", threshold=1.5),
            XOutlierFilter(method="mahalanobis")
        ],
        "mode": "any",  # or "all"
        "report": True,
        "cascade_to_augmented": True
    }
}
```

**Training-Only**: Does not run in prediction mode.

---

### 4.13 Metadata Partitioner (`metadata_partitioner`) - CONTAINER

**Keyword**: `branch` with `by: "metadata_partitioner"`

**Controller**: `MetadataPartitionerController`

**Configuration**:

```python
{
    "branch": [PLS(5), RF(100)],
    "by": "metadata_partitioner",
    "column": "site",
    "cv": ShuffleSplit(n_splits=3),
    "min_samples": 20,
    "group_values": {"others": ["C", "D", "E"]}
}
```

**Special Behavior**:
- Creates DISJOINT branches (non-overlapping samples)
- Each sample in exactly ONE branch
- Requires special merge handling

---

### 4.14 Outlier Excluder (`outlier_excluder`) - CONTAINER

**Keyword**: `branch` with `by: "outlier_excluder"`

**Controller**: `OutlierExcluderController`

**Configuration**:

```python
{
    "branch": {
        "by": "outlier_excluder",
        "strategies": [
            None,  # No exclusion (baseline)
            {"method": "isolation_forest", "contamination": 0.05},
            {"method": "mahalanobis", "threshold": 3.0}
        ]
    }
}
```

---

## 5. Container Steps (Nested Children)

### Summary Table

| Step Type | Keyword | Children Location | Child Type |
|-----------|---------|-------------------|------------|
| `branch` | `branch` | Dict values or list items | List of steps |
| `source_branch` | `source_branch` | Dict values | List of steps |
| `feature_augmentation` | `feature_augmentation` | List items | Transforms |
| `sample_augmentation` | `sample_augmentation.transformers` | List items | Transforms |
| `concat_transform` | `concat_transform` | List items | Transforms |
| `metadata_partitioner` | `branch` + `by` | `branch` list | Steps |
| `outlier_excluder` | `branch.strategies` | List items | Strategy configs |

### Nested Structure Examples

```yaml
# Branch with nested models
branch:
  pls_path:
    - class: nirs4all.operators.transforms.SNV
    - model:
        class: sklearn.cross_decomposition.PLSRegression
        params: {n_components: 10}
      name: PLS-10
      finetune_params:
        n_trials: 20
        model_params:
          n_components: {type: int, low: 5, high: 20}

# Feature augmentation with concat
feature_augmentation:
  - class: nirs4all.operators.transforms.SNV
  - concat_transform:
      - class: sklearn.decomposition.PCA
        params: {n_components: 50}
      - class: sklearn.decomposition.TruncatedSVD
        params: {n_components: 30}
```

---

## 6. Special Keywords Reference

### Step-Level Keywords

| Keyword | Description | Valid For |
|---------|-------------|-----------|
| `model` | Model operator | Model steps |
| `preprocessing` | Transform operator | Transform steps |
| `y_processing` | Target transform | Y-transform steps |
| `branch` | Branch definitions | Branch containers |
| `source_branch` | Per-source pipelines | Multi-source datasets |
| `merge` | Branch merge config | After branch |
| `feature_augmentation` | Feature transforms | Augmentation |
| `sample_augmentation` | Sample transforms | Augmentation |
| `concat_transform` | Concat transforms | Feature concat |
| `sample_filter` | Filter config | Sample filtering |
| `split` | CV splitter | Data splitting |

### Configuration Keywords

| Keyword | Description | Example |
|---------|-------------|---------|
| `name` | Custom step name | `"name": "PLS-10-SNV"` |
| `params` | Operator parameters | `"params": {"n_components": 10}` |
| `finetune_params` | Hyperparameter tuning | See [Section 9](#9-model-training-parameters) |
| `train_params` | Training parameters | `"train_params": {"epochs": 100}` |
| `fit_on_all` | Fit on all data | `"fit_on_all": true` |
| `force_layout` | Force data layout | `"force_layout": "3d"` |
| `action` | Augmentation action | `"action": "extend"` |
| `by` | Partitioner type | `"by": "metadata_partitioner"` |

---

## 7. Generator Syntax

### Generator Keywords

| Keyword | Description | Example |
|---------|-------------|---------|
| `_or_` | Choice from alternatives | `{"_or_": [SNV(), MSC()]}` |
| `_range_` | Numeric sequence | `{"_range_": [1, 10, 2]}` |
| `_log_range_` | Log-spaced sequence | `{"_log_range_": [0.001, 100, 5]}` |
| `_grid_` | Grid search | `{"_grid_": {"a": [1,2], "b": [3,4]}}` |
| `_zip_` | Parallel iteration | `{"_zip_": {"a": [1,2], "b": [3,4]}}` |
| `count` | Limit expansions | `{"_or_": [...], "count": 3}` |
| `pick` | Combinations (unordered) | `{"_or_": [...], "pick": 2}` |
| `arrange` | Permutations (ordered) | `{"_or_": [...], "arrange": 2}` |
| `param` | Target parameter | `{"_range_": [...], "param": "n_components"}` |

### Generator Examples

```python
# Parameter sweep
{
    "model": PLSRegression(),
    "_range_": [2, 15, 3],
    "param": "n_components"
}
# Generates: PLS(2), PLS(5), PLS(8), PLS(11), PLS(14)

# Preprocessing alternatives
{
    "_or_": [
        {"class": "nirs4all.operators.transforms.SNV"},
        {"class": "nirs4all.operators.transforms.MSC"},
        {"class": "nirs4all.operators.transforms.Detrend"}
    ],
    "count": 2  # Pick 2 randomly
}

# Grid search
{
    "model": RandomForestRegressor(),
    "_grid_": {
        "n_estimators": [50, 100, 200],
        "max_depth": [5, 10, 15]
    }
}
# Generates: 9 models (3×3 grid)
```

---

## 8. Step Configuration Schema

### Complete Step Schema

```typescript
interface PipelineStep {
  // === Operator Definition (ONE of these) ===
  class?: string;              // "sklearn.preprocessing.MinMaxScaler"
  function?: string;           // "nirs4all.operators.models.nicon"
  model?: OperatorDef;         // Model operator
  preprocessing?: OperatorDef; // Transform operator
  y_processing?: OperatorDef | OperatorDef[];  // Target transform(s)
  branch?: BranchDef;          // Branch definition
  source_branch?: SourceBranchDef;
  merge?: MergeDef;
  feature_augmentation?: OperatorDef[];
  sample_augmentation?: SampleAugConfig;
  concat_transform?: OperatorDef[];
  sample_filter?: FilterConfig;
  split?: OperatorDef;

  // === Parameters ===
  params?: Record<string, any>;      // Operator params
  train_params?: TrainParams;        // Training params (NN)
  finetune_params?: FinetuneParams;  // Hyperparameter tuning

  // === Metadata ===
  name?: string;           // Custom step name
  fit_on_all?: boolean;    // Fit on all data
  force_layout?: "2d" | "2d_interleaved" | "3d" | "3d_transpose";

  // === Generators ===
  "_or_"?: any[];
  "_range_"?: [number, number, number?];
  "_log_range_"?: [number, number, number];
  "_grid_"?: Record<string, any[]>;
  param?: string;
  count?: number;
  pick?: number;
  arrange?: number;
}

interface OperatorDef {
  class?: string;
  function?: string;
  params?: Record<string, any>;
  // Runtime instance (internal)
  _runtime_instance?: any;
}

interface BranchDef {
  // Named branches
  [branchName: string]: PipelineStep[];
  // Or list of anonymous branches
  // Or generator syntax
}

interface MergeDef {
  // String mode
  // "features" | "predictions" | "all"

  // Or detailed config
  predictions?: PredictionMergeConfig[];
  features?: number[];
  output_as?: "features" | "sources" | "dict";
  on_missing?: "error" | "warn";
  unsafe?: boolean;
}
```

---

## 9. Model Training Parameters

### `finetune_params` Schema

```typescript
interface FinetuneParams {
  n_trials: number;              // Number of Optuna trials
  approach: "single" | "cross";  // Single model or per-fold
  eval_mode: "best" | "mean";    // Evaluation strategy
  sample: "random" | "grid" | "hyperband";  // Sampling strategy
  verbose?: number;

  model_params: {
    [paramName: string]: ParamSpec | any[];
  };

  train_params?: {               // For neural networks
    [paramName: string]: ParamSpec | any[];
  };
}

interface ParamSpec {
  type: "int" | "float" | "categorical";
  low?: number;
  high?: number;
  log?: boolean;      // Log scale
  choices?: any[];    // For categorical
}
```

### `train_params` Schema (Neural Networks)

```typescript
interface TrainParams {
  epochs?: number;
  batch_size?: number;
  verbose?: number;

  // TensorFlow-specific
  callbacks?: any[];
  validation_split?: number;

  // PyTorch-specific
  learning_rate?: number;
  optimizer?: string;

  // Common
  n_jobs?: number;
  reset_gpu?: boolean;
}
```

---

## 10. Special Handling Requirements

### 10.1 Editor Considerations by Step Type

| Step Type | Editor Needs |
|-----------|--------------|
| Transforms | Simple operator picker, param editor |
| Y-Processing | Supports list (chained transforms) |
| Splitters | Group-aware options (`force_group`) |
| Models | `name`, `finetune_params`, `train_params` |
| Branch | Nested step editor (recursive), multiple named branches |
| Merge | Complex config editor (predictions per branch) |
| Feature/Sample Augmentation | List of transforms + action mode |
| Concat Transform | List of transforms |
| Partitioners | Metadata column picker, strategy config |

### 10.2 Validation Rules

1. **Branch/Merge Pairing**: `branch` must eventually be followed by `merge`
2. **Model Required**: Pipeline should contain at least one model step
3. **Splitter Placement**: CV splitter should come before model steps
4. **Source Branch**: Only valid for multi-source datasets
5. **Meta-Model**: Requires previous models in pipeline
6. **Generator Syntax**: Valid only in specific contexts (branch, augmentation)

### 10.3 Serialization Formats

The editor must support both:
1. **Instance format** (for runtime): `PLSRegression(n_components=10)`
2. **Serialized format** (for storage): `{"class": "...", "params": {...}}`

### 10.4 Step Categories for UI Grouping

```typescript
const STEP_CATEGORIES = {
  preprocessing: ["SNV", "MSC", "SavitzkyGolay", "PCA", "MinMaxScaler", ...],
  splitting: ["KFold", "ShuffleSplit", "SPXYGFold", "KennardStone", ...],
  models: ["PLSRegression", "Ridge", "RandomForest", "XGBoost", ...],
  augmentation: ["feature_augmentation", "sample_augmentation", "concat_transform"],
  flow: ["branch", "merge", "source_branch", "metadata_partitioner"],
  filtering: ["sample_filter", "outlier_excluder"],
  targets: ["y_processing"]
};
```

---

## Appendix: Controller File Locations

| Controller | Location |
|------------|----------|
| `TransformerMixinController` | `controllers/transforms/transformer.py` |
| `YTransformerMixinController` | `controllers/transforms/y_transformer.py` |
| `CrossValidatorController` | `controllers/splitters/split.py` |
| `SklearnModelController` | `controllers/models/sklearn_model.py` |
| `MetaModelController` | `controllers/models/meta_model.py` |
| `BranchController` | `controllers/data/branch.py` |
| `MergeController` | `controllers/data/merge.py` |
| `SourceBranchController` | `controllers/data/source_branch.py` |
| `FeatureAugmentationController` | `controllers/data/feature_augmentation.py` |
| `SampleAugmentationController` | `controllers/data/sample_augmentation.py` |
| `ConcatAugmentationController` | `controllers/data/concat_transform.py` |
| `SampleFilterController` | `controllers/data/sample_filter.py` |
| `OutlierExcluderController` | `controllers/data/outlier_excluder.py` |
| `MetadataPartitionerController` | `controllers/data/metadata_partitioner.py` |

---

*Document generated: January 2026*
*Based on nirs4all version 0.6.x*

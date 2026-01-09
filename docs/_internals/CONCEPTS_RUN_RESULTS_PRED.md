# nirs4all Core Concepts

> A comprehensive guide to understanding Runs, Pipelines, Results, and Predictions in nirs4all

## Overview

nirs4all is built around a clear hierarchy of concepts that flow from experiment design to actionable predictions. Understanding these concepts is essential for effectively using both the library and the webapp.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                  RUN                                        │
│  (Collection of Pipeline Templates × Collection of Datasets)                │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                           RESULTS                                     │ │
│  │  (All Expanded Pipeline Configs × All Datasets)                       │ │
│  │                                                                       │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐ │ │
│  │  │                      PREDICTIONS                                 │ │ │
│  │  │  (Model outputs per partition per fold)                          │ │ │
│  │  └─────────────────────────────────────────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Pipeline and Pipeline Template

### Pipeline Definition

A **Pipeline** is a concrete, fully-specified sequence of steps that can be executed directly. It contains no generators or ambiguity—every step is a specific operator with specific parameters.

```python
# A concrete pipeline - ready to execute
pipeline = [
    MinMaxScaler(),
    SNV(),
    PLSRegression(n_components=10),
]
```

### Pipeline Template Definition

A **Pipeline Template** is a pipeline definition that may contain generators—syntax elements that expand into multiple concrete pipelines:

- **Generators**: Expand into multiple configurations
  - `_or_`: Alternative operators (e.g., `{"_or_": [SNV, MSC, Detrend]}`)
  - `_range_`: Parameter sweeps (e.g., `{"_range_": [1, 20, 1], "param": "n_components"}`)
- **Branches**: Parallel processing paths
- **Standard steps**: Preprocessing, models, splitters

### Example

```python
# A pipeline template with generators
pipeline_template = [
    {"_or_": [SNV(), MSC(), Detrend()]},              # 3 alternatives
    {"_range_": [5, 15, 5], "param": "n_components"}, # 3 values: 5, 10, 15
    PLSRegression(),
]
# This template expands to 3 × 3 = 9 concrete pipelines

# A concrete pipeline (no generators) is also a valid template
# It simply expands to 1 pipeline (itself)
simple_pipeline = [MinMaxScaler(), PLSRegression(n_components=5)]
# Expands to 1 pipeline
```

### Template vs Pipeline

| Aspect | Pipeline | Pipeline Template |
|--------|----------|-------------------|
| Generators | None | May contain `_or_`, `_range_`, etc. |
| Expansion | N/A | Expands to N concrete pipelines |
| Executability | Directly executable | Requires expansion first |
| Storage | Part of result manifest | Should be saved before expansion |

### Key Properties

| Property | Description |
|----------|-------------|
| `steps` | List of step definitions (may contain generators) |
| `name` | Optional human-readable name |
| `description` | Optional description of the experiment intent |
| `expansion_count` | Number of concrete pipelines this template produces |
| `created_at` | Timestamp when the template was created |

### Storage Recommendation

Pipeline templates **SHOULD be serialized and stored before expansion**. This enables:
- Reproducibility of the full experiment
- Understanding user intent vs. execution details
- Re-running with modified datasets
- Sharing experiment designs

**Proposed storage location**: `workspace/runs/<run_id>/templates/<template_id>.yaml`

---

## 2. Run

### Definition

A **Run** represents a complete experiment session. It is the **Cartesian product** of:
- **One or more Pipeline Templates** (or concrete Pipelines)
- **One or more Datasets**

A Run generates Results for every combination of expanded pipeline configurations and datasets.

### Formula

```
Run = [Pipeline Templates] × [Datasets]
    = [Σ Expanded Pipelines from all Templates] × [All Datasets]
    = Results
```

### Key Insight

A Run is **not limited to a single pipeline template**. Users can:
- Run multiple unrelated pipelines in one session
- Compare different model families (e.g., PLS vs RF vs Neural Networks)
- Test both simple and complex pipelines together
- Mix templates with generators and concrete pipelines

### Examples

```python
# Example 1: Single template, multiple datasets
result = nirs4all.run(
    pipeline=[
        {"_or_": [SNV(), MSC()]},
        PLSRegression(n_components=10),
    ],  # 1 template → 2 configs
    dataset=["wheat.csv", "corn.csv", "soy.csv"],  # 3 datasets
)
# Produces: 2 × 3 = 6 Results

# Example 2: Multiple templates, single dataset
result = nirs4all.run(
    pipeline=[
        # Template 1: PLS variants
        [{"_or_": [SNV(), MSC()]}, PLSRegression(n_components=10)],
        # Template 2: Random Forest
        [MinMaxScaler(), RandomForestRegressor(n_estimators=100)],
        # Template 3: Simple baseline
        [StandardScaler(), Ridge()],
    ],  # 3 templates → 2 + 1 + 1 = 4 configs
    dataset="wheat.csv",  # 1 dataset
)
# Produces: 4 × 1 = 4 Results

# Example 3: Multiple templates, multiple datasets (full Cartesian)
result = nirs4all.run(
    pipeline=[
        [{"_or_": [SNV(), MSC()]}, {"_range_": [5, 15, 5], "param": "n_components"}, PLSRegression()],
        [MinMaxScaler(), RandomForestRegressor()],
    ],  # 2 templates → (2×3) + 1 = 7 configs
    dataset=["wheat.csv", "corn.csv"],  # 2 datasets
)
# Produces: 7 × 2 = 14 Results
```

### Key Properties

| Property | Description |
|----------|-------------|
| `id` / `uid` | Unique identifier for the run |
| `name` | Human-readable name (e.g., "Protein Optimization v2") |
| `pipeline_templates` | List of original unexpanded pipeline definitions |
| `total_pipeline_configs` | Sum of all expanded pipelines from all templates |
| `datasets` | List of dataset metadata objects (see Dataset Metadata section) |
| `created_at` | When the run was initiated |
| `started_at` | When execution began |
| `completed_at` | When execution finished |
| `status` | queued, running, completed, failed, paused |
| `config` | Run-level configuration (CV strategy, random seed, etc.) |

### Dataset Metadata in Runs

Runs store **complete dataset metadata**, not just file paths. This enables:
- **Automatic dataset discovery** when linking workspaces in the webapp
- **Reproducibility** even if files are moved or renamed
- **Portability** of workspaces between machines
- **Validation** of dataset integrity before re-running

#### Dataset Metadata Structure

Each dataset in a run includes:

| Property | Description |
|----------|-------------|
| `name` | Human-readable name (e.g., "Wheat Protein 2025") |
| `path` | Original file path at run time |
| `hash` | Content hash for integrity verification |
| `task_type` | regression, classification, multiclass |
| `n_samples` | Number of samples in the dataset |
| `n_features` | Number of spectral features |
| `y_columns` | List of target column names |
| `y_stats` | Statistics per target (min, max, mean, std) |
| `wavelength_range` | Spectral range [min, max] if available |
| `wavelength_unit` | nm, cm⁻¹, etc. |
| `metadata` | Additional user-defined properties |
| `created_at` | When dataset was first used |
| `version` | Dataset version hash for change tracking |

#### Example Dataset Entry in Run Manifest

```yaml
datasets:
  - name: "Wheat Protein 2025"
    path: "/data/wheat_protein.csv"
    hash: "sha256:abc123def456..."
    task_type: "regression"
    n_samples: 500
    n_features: 2100
    y_columns: ["protein", "moisture"]
    y_stats:
      protein:
        min: 8.2
        max: 16.5
        mean: 12.3
        std: 1.8
      moisture:
        min: 10.1
        max: 15.2
        mean: 12.8
        std: 1.2
    wavelength_range: [400, 2500]
    wavelength_unit: "nm"
    metadata:
      source: "Lab A"
      collection_date: "2025-01"
      instrument: "NIRFlex N-500"
    created_at: "2025-01-08T10:00:00Z"
    version: "v1_abc123"
```

#### Webapp Auto-Discovery Flow

When a user links a workspace in the webapp:

```
1. Scan workspace for run manifests
   └── workspace/runs/*/run_manifest.yaml

2. Extract dataset metadata from each run
   └── Collect unique datasets by hash

3. Auto-create dataset entries in webapp
   ├── Use stored name, task_type, stats
   ├── Check if path still valid
   │   ├── Valid: Link directly
   │   └── Missing: Mark as "needs path update"
   └── Preserve all metadata

4. User can update paths for missing files
   └── Metadata (n_samples, y_stats, etc.) preserved
```

#### Path Resolution Strategy

When dataset files are missing:

| Scenario | Behavior |
|----------|----------|
| Path valid | Use as-is |
| Path invalid, hash matches elsewhere | Auto-relocate |
| Path invalid, no hash match | Prompt user for new path |
| User provides new path | Validate hash matches |
| Hash mismatch | Warn user, offer to create new version |

```python
# Webapp path resolution logic
def resolve_dataset_path(dataset_meta, workspace_path):
    original_path = Path(dataset_meta["path"])

    if original_path.exists():
        return original_path, "valid"

    # Try relative to workspace
    relative = workspace_path / original_path.name
    if relative.exists() and hash_file(relative) == dataset_meta["hash"]:
        return relative, "relocated"

    # Search workspace for matching hash
    for candidate in workspace_path.rglob("*.csv"):
        if hash_file(candidate) == dataset_meta["hash"]:
            return candidate, "found_by_hash"

    return None, "missing"
```

### Run States

```
┌─────────┐    ┌─────────┐    ┌───────────┐
│ queued  │───▶│ running │───▶│ completed │
└─────────┘    └────┬────┘    └───────────┘
                    │
                    ▼
               ┌────────┐
               │ failed │
               └────────┘
```

### Storage Structure

```
workspace/runs/<run_id>/
├── run_manifest.yaml              # Run metadata
├── templates/                     # All pipeline templates
│   ├── template_001.yaml          # First template (before expansion)
│   ├── template_002.yaml          # Second template
│   └── ...
├── expanded_pipelines.yaml        # All generated pipeline configurations
└── results/
    ├── <dataset_1>/
    │   ├── <pipeline_config_1>/
    │   ├── <pipeline_config_2>/
    │   └── ...
    └── <dataset_2>/
        └── ...
```

---

## 3. Result

### Definition

A **Result** is the outcome of executing one specific (expanded) pipeline configuration on one dataset. It represents the evaluation of a complete processing chain.

### Formula

```
Result = 1 Dataset + 1 Pipeline Configuration
```

### Key Insight

Even if a pipeline is complex (with branches, multiple models, stacking), a Result is always tied to exactly **one dataset** and **one pipeline configuration**. The complexity lives within the pipeline, not across datasets or across pipelines.

### Relationship to Run

A Run produces many Results:

```
Run with:
  - 3 pipeline templates → expand to 10 total configs
  - 4 datasets

Produces: 10 × 4 = 40 Results
```

Each Result knows:
- Which Run it belongs to (`run_id`)
- Which template it came from (`template_id`)
- Which specific expanded config it represents (`pipeline_config_id`)
- Which dataset it was executed on (`dataset`)

### Example

```python
# From a run with 2 templates (7 total configs) × 2 datasets = 14 results
# Each result looks like:

result = {
    "run_id": "2025-01-08_ProteinSweep_abc123",
    "template_id": "template_001",
    "dataset": "wheat.csv",
    "pipeline_config": "SNV + PLS(n_components=10)",
    "pipeline_config_id": "0003_SNV_PLS_nc10_def456",
    "best_score": 0.967,
    "best_model": "PLSRegression",
    "metric": "r2",
    "predictions": [...]
}
```

### Key Properties

| Property | Description |
|----------|-------------|
| `id` | Unique identifier |
| `run_id` | Parent run reference |
| `template_id` | Which template this config came from |
| `dataset` | The dataset used |
| `pipeline_config` | Human-readable description of the config |
| `pipeline_config_id` | Unique ID for this specific config |
| `best_score` | Best metric value among all predictions |
| `best_model` | Model that achieved the best score |
| `metric` | The metric used for comparison (r2, rmse, accuracy, etc.) |
| `task_type` | regression, classification, multiclass |
| `n_samples` | Number of samples processed |
| `n_features` | Number of features after preprocessing |
| `predictions` | List of all predictions generated |

### Best Score Calculation

The `best_score` of a Result is determined by:
1. Collecting all Predictions from all models in the pipeline
2. Using the validation score (or test score if no validation)
3. Selecting the best according to the metric (max for r2/accuracy, min for rmse/mae)

```python
# Pseudocode
best_prediction = max(
    result.predictions,
    key=lambda p: p.val_score if metric.higher_is_better else -p.val_score
)
result.best_score = best_prediction.val_score
result.best_model = best_prediction.model_name
```

---

## 4. Prediction

### Definition

A **Prediction** is the output of a specific model for a specific partition (train/val/test) within a cross-validation fold. It is the most granular unit of evaluation.

### Formula

```
Prediction = Model + Preprocessing Chain + Partition + Fold
```

### Components

```
┌────────────────────────────────────────────────────────────┐
│                       PREDICTION                           │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ Preprocessing Chain                                   │ │
│  │ SNV → MinMaxScaler → PCA(n_components=10)            │ │
│  └──────────────────────────────────────────────────────┘ │
│                          │                                 │
│                          ▼                                 │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ Model                                                 │ │
│  │ PLSRegression(n_components=15)                        │ │
│  └──────────────────────────────────────────────────────┘ │
│                          │                                 │
│                          ▼                                 │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ Output                                                │ │
│  │ y_true: [3.2, 4.1, 2.8, ...]                         │ │
│  │ y_pred: [3.1, 4.3, 2.9, ...]                         │ │
│  │ partition: "test"                                     │ │
│  │ fold_id: "0"                                          │ │
│  └──────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

### Key Properties

| Property | Description |
|----------|-------------|
| `id` | Unique identifier |
| `result_id` | Parent result reference |
| `run_id` | Grandparent run reference |
| `pipeline_uid` | Pipeline configuration identifier |
| `model_name` | Human-readable model name (e.g., "PLS-10") |
| `model_classname` | Full class path (e.g., "sklearn.cross_decomposition.PLSRegression") |
| `preprocessings` | String describing the preprocessing chain |
| `partition` | "train", "val", or "test" |
| `fold_id` | Cross-validation fold identifier |
| `train_score` | Score on training data |
| `val_score` | Score on validation data |
| `test_score` | Score on test/holdout data |
| `metric` | Metric name (r2, rmse, accuracy, etc.) |
| `y_true` | Ground truth values (reference to stored array) |
| `y_pred` | Predicted values (reference to stored array) |
| `y_proba` | Predicted probabilities (for classification) |
| `sample_indices` | Which samples were used |
| `best_params` | Hyperparameters of the model |
| `branch_id` | If from a branch, which branch |
| `branch_name` | Human-readable branch name |

### Partition Types

| Partition | Description |
|-----------|-------------|
| `train` | Training data within a fold |
| `val` | Validation data within a fold (for CV) |
| `test` | Held-out test set (never seen during training) |

### Score Hierarchy

```
Prediction.train_score  →  Score on training samples (may overfit)
Prediction.val_score    →  Score on validation samples (CV fold)
Prediction.test_score   →  Score on held-out test set (final evaluation)
```

---

## 5. Relationships and Hierarchy

### Complete Hierarchy

```
Session (optional workspace context)
└── Run
    ├── Pipeline Templates[] (one or more recipes)
    │   ├── Template 1 → expands to N₁ configs
    │   ├── Template 2 → expands to N₂ configs
    │   └── Template 3 → expands to N₃ configs
    ├── Dataset Collection (one or more datasets)
    │   ├── Dataset A
    │   ├── Dataset B
    │   └── Dataset C
    └── Results[] (N₁+N₂+N₃) × 3 = total results
        ├── Result (Dataset A + Config from Template 1)
        │   └── Predictions[]
        │       ├── Prediction (Model 1, Fold 0, train)
        │       ├── Prediction (Model 1, Fold 0, val)
        │       ├── Prediction (Model 1, Fold 0, test)
        │       └── ...
        ├── Result (Dataset A + Config from Template 2)
        │   └── Predictions[]
        ├── Result (Dataset B + Config from Template 1)
        │   └── Predictions[]
        └── ... (all combinations)
```

### Cardinality

```
1 Run
├── T Pipeline Templates → Σᵢ Nᵢ = Total Expanded Pipeline Configs
├── M Datasets
└── (Σᵢ Nᵢ) × M Results
    └── Each Result → K Predictions (models × folds × partitions)
```

### Example Numbers

For a run with:
- 2 pipeline templates:
  - Template 1: expands to 6 configs (2 preprocessings × 3 n_components values)
  - Template 2: 1 concrete pipeline (no expansion)
- 4 datasets
- 5-fold cross-validation
- Each pipeline has 1 model (average)

```
Total configs = 6 + 1 = 7
Results = 7 × 4 = 28 results
Predictions per result = 1 model × 5 folds × 3 partitions = 15
Total predictions = 28 × 15 = 420 predictions
```

### Visual: Run Expansion

```
                        RUN
                         │
        ┌────────────────┼────────────────┐
        │                │                │
   Template 1       Template 2       Template 3
   (2 configs)      (1 config)       (4 configs)
        │                │                │
        └────────────────┼────────────────┘
                         │
              7 total pipeline configs
                         │
         ┌───────────────┼───────────────┐
         │               │               │
     Dataset A       Dataset B       Dataset C
         │               │               │
    7 results       7 results       7 results
         │               │               │
         └───────────────┼───────────────┘
                         │
                   21 total results
```

---

## 6. Naming Conventions

### Run Naming

```
<YYYY-MM-DD>_<Name>_<hash>
2025-01-08_ProteinSweep_b42ddc
```

- `YYYY-MM-DD`: Date of creation
- `Name`: Descriptive name from user or auto-generated
- `hash`: Short hash for uniqueness

### Template Naming (within a Run)

```
template_<NNN>
template_001
template_002
```

Or user-provided names:
```
pls_variants
rf_baseline
neural_network
```

### Pipeline Config Naming

```
<NNN>_<preprocessing_chain>_<model>_<key_params>_<hash>
0001_SNV_PLS_nc10_abc123
0002_MSC_PLS_nc10_def456
0003_MinMax_RF_ne100_gh789
```

### Prediction Naming

```
<model_name>_<fold>_<partition>
PLSRegression_fold0_val
```

---

## 7. Storage Architecture

### Recommended Directory Structure

```
workspace/
├── runs/
│   └── <run_id>/
│       ├── run_manifest.yaml              # Run metadata
│       ├── templates/                     # Pipeline templates
│       │   ├── template_001.yaml          # Original template 1
│       │   ├── template_002.yaml          # Original template 2
│       │   └── template_001.json          # JSON for webapp
│       ├── expanded_pipelines.yaml        # All generated configs
│       └── results/
│           └── <dataset>/
│               └── <pipeline_config>/
│                   ├── manifest.yaml      # Result manifest
│                   └── artifacts/         # Model files
│
├── binaries/
│   └── <dataset>/
│       └── <artifact_hash>.joblib         # Content-addressed storage
│
├── predictions/
│   └── <dataset>.meta.parquet             # Prediction metadata
│
└── arrays/
    └── <array_id>.npy                     # Stored y_true, y_pred arrays
```

### Workspace-Level Dataset Registry

In addition to storing dataset metadata in run manifests, the workspace maintains a **dataset registry** that aggregates all known datasets:

```
workspace/
├── datasets.yaml                          # Dataset registry
├── runs/...
└── ...
```

#### datasets.yaml
```yaml
schema_version: "1.0"
datasets:
  - id: "ds_wheat_v1"
    name: "Wheat Protein 2025"
    current_path: "/data/wheat.csv"        # May be updated by user
    original_path: "/data/wheat.csv"       # Path when first added
    hash: "sha256:abc123def456789..."
    status: "valid"                        # valid, missing, hash_mismatch
    task_type: "regression"
    n_samples: 500
    n_features: 2100
    y_columns: ["protein"]
    y_stats:
      protein: {min: 8.2, max: 16.5, mean: 12.3, std: 1.8}
    wavelength_range: [400, 2500]
    wavelength_unit: "nm"
    metadata:
      source: "Lab A"
      instrument: "NIRFlex N-500"
    first_used: "2025-01-08T10:00:00Z"
    last_used: "2025-01-15T14:30:00Z"
    run_count: 5                           # Number of runs using this dataset
    versions:
      - version: "v1_abc123"
        hash: "sha256:abc123def456789..."
        created_at: "2025-01-08T10:00:00Z"
        n_samples: 500

  - id: "ds_corn_v1"
    name: "Corn Starch Analysis"
    current_path: null                     # File missing
    original_path: "/data/corn.csv"
    hash: "sha256:def456gh789abc..."
    status: "missing"
    # ... other properties preserved
```

#### Auto-Discovery When Linking Workspace

When the webapp links a new workspace:

```python
# Webapp workspace linking logic
async def link_workspace(workspace_path: str):
    """Link workspace and auto-discover datasets."""

    # 1. Check for existing dataset registry
    registry_path = workspace_path / "datasets.yaml"
    if registry_path.exists():
        datasets = load_yaml(registry_path)
    else:
        datasets = {"datasets": []}

    # 2. Scan all run manifests for dataset metadata
    for run_manifest in workspace_path.glob("runs/*/run_manifest.yaml"):
        manifest = load_yaml(run_manifest)
        for dataset_meta in manifest.get("datasets", []):
            existing = find_by_hash(datasets, dataset_meta["hash"])

            if existing:
                # Update last_used, run_count
                existing["last_used"] = manifest["created_at"]
                existing["run_count"] += 1
            else:
                # Add new dataset to registry
                datasets["datasets"].append({
                    "id": generate_dataset_id(dataset_meta),
                    **dataset_meta,
                    "status": "unknown",
                    "run_count": 1,
                })

    # 3. Validate paths and update status
    for dataset in datasets["datasets"]:
        path, status = resolve_dataset_path(dataset, workspace_path)
        dataset["status"] = status
        if path:
            dataset["current_path"] = str(path)

    # 4. Save updated registry
    save_yaml(registry_path, datasets)

    # 5. Return datasets for webapp display
    return datasets
```

#### Webapp Dataset States

| Status | Icon | Description | User Action |
|--------|------|-------------|-------------|
| `valid` | ✅ | File exists, hash matches | None needed |
| `missing` | ⚠️ | File not found | Update path |
| `hash_mismatch` | ❌ | File found but content changed | Create new version or accept |
| `relocated` | 🔄 | File found at different path | Confirm auto-update |

#### Dataset Path Update UI

```
┌─────────────────────────────────────────────────────────────────┐
│ Dataset: Wheat Protein 2025                                     │
│ Status: ⚠️ Missing                                              │
│                                                                 │
│ Original path: /data/wheat.csv                                 │
│                                                                 │
│ Properties (preserved from run data):                          │
│   • Samples: 500                                                │
│   • Features: 2100                                              │
│   • Target: protein (8.2 - 16.5)                               │
│   • Wavelength: 400-2500 nm                                    │
│                                                                 │
│ [Browse for file...]  [Search workspace]                       │
│                                                                 │
│ ┌──────────────────────────────────────────────────────────┐   │
│ │ /new/location/wheat_protein_2025.csv                     │   │
│ └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│ [Validate & Update]  [Skip for now]                            │
└─────────────────────────────────────────────────────────────────┘
```

### Manifest Files

#### run_manifest.yaml
```yaml
schema_version: "1.0"
uid: "abc123"
name: "Protein Optimization"
description: "Compare PLS, RF, and NN on protein datasets"
created_at: "2025-01-08T10:30:00Z"
status: completed
completed_at: "2025-01-08T11:45:00Z"

# Multiple templates
templates:
  - id: "template_001"
    name: "PLS Variants"
    file: "templates/template_001.yaml"
    expansion_count: 6
  - id: "template_002"
    name: "Random Forest"
    file: "templates/template_002.yaml"
    expansion_count: 1
  - id: "template_003"
    name: "Neural Network"
    file: "templates/template_003.yaml"
    expansion_count: 4

total_pipeline_configs: 11  # 6 + 1 + 4

# Full dataset metadata for auto-discovery
datasets:
  - name: "Wheat Protein 2025"
    path: "/data/wheat.csv"
    hash: "sha256:abc123def456789..."
    task_type: "regression"
    n_samples: 500
    n_features: 2100
    y_columns: ["protein"]
    y_stats:
      protein: {min: 8.2, max: 16.5, mean: 12.3, std: 1.8}
    wavelength_range: [400, 2500]
    wavelength_unit: "nm"
    metadata:
      source: "Lab A"
      instrument: "NIRFlex N-500"
    version: "v1_abc123"

  - name: "Corn Starch Analysis"
    path: "/data/corn.csv"
    hash: "sha256:def456gh789abc..."
    task_type: "regression"
    n_samples: 350
    n_features: 2100
    y_columns: ["starch", "protein"]
    y_stats:
      starch: {min: 60.0, max: 75.0, mean: 68.5, std: 3.2}
      protein: {min: 7.0, max: 12.0, mean: 9.5, std: 1.1}
    wavelength_range: [400, 2500]
    wavelength_unit: "nm"
    metadata:
      source: "Lab B"
      instrument: "FOSS XDS"
    version: "v1_def456"

config:
  cv_folds: 5
  cv_strategy: kfold
  random_state: 42

summary:
  total_results: 22  # 11 configs × 2 datasets
  completed_results: 22
  failed_results: 0
  best_result:
    dataset: "wheat"
    template: "template_001"
    pipeline_config: "SNV_PLS_nc15"
    score: 0.972
    metric: r2
```

#### template_001.yaml (Pipeline Template)
```yaml
schema_version: "1.0"
id: "template_001"
name: "PLS Variants"
description: "Explore preprocessing and n_components for PLS"
created_at: "2025-01-08T10:30:00Z"

steps:
  - class: sklearn.preprocessing.MinMaxScaler
  - _or_:
      - class: nirs4all.operators.SNV
      - class: nirs4all.operators.MSC
  - _range_: [5, 15, 5]
    param: n_components
  - class: sklearn.cross_decomposition.PLSRegression

expansion_count: 6  # 2 × 3
```

#### result_manifest.yaml
```yaml
schema_version: "2.0"
uid: "def456"
run_id: "abc123"
template_id: "template_001"
dataset: "wheat"
pipeline_config: "SNV_PLS_nc15"
pipeline_config_id: "0003_SNV_PLS_nc15_gh789"
created_at: "2025-01-08T10:31:00Z"

generator_choices:
  - {_or_: "nirs4all.operators.SNV"}
  - {_range_: 15}

best_score: 0.972
best_model: "PLSRegression"
metric: "r2"
task_type: "regression"
n_samples: 500
n_features: 1024
predictions_count: 15

artifacts:
  schema_version: "2.0"
  items:
    - name: "SNV_1"
      path: "artifacts/SNV_abc123.joblib"
    - name: "PLSRegression_fold0"
      path: "artifacts/PLS_gh789.joblib"

predictions: [...]
```

---

## 8. Performance Optimization: Parquet Embedded Summary

### Problem Statement

When loading the Predictions page in the webapp, the current approach requires:
1. Scanning all `.meta.parquet` files in the workspace
2. Loading full DataFrames (10k+ rows per dataset)
3. Computing aggregations client-side
4. Loading data in batches with a `while(hasMore)` loop

This results in **2-5 second load times** for workspaces with large prediction histories.

### Solution: Parquet File-Level Metadata

Parquet files support **custom metadata** stored in the file footer. This metadata can be read **without scanning any row data**, providing instant access to pre-computed summaries.

```
┌─────────────────────────────────────────┐
│         wheat.meta.parquet              │
├─────────────────────────────────────────┤
│  Row Group 1 (rows 0-10000)             │  ← NOT read for summary
│  Row Group 2 (rows 10001-12450)         │  ← NOT read for summary
├─────────────────────────────────────────┤
│  FOOTER (~1KB)                          │
│  ├── Schema                             │  ← Always read
│  └── Custom Metadata (key-value)        │
│      {                                  │
│        "n4a_summary": "{...JSON...}"    │  ← YOUR SUMMARY HERE!
│      }                                  │
└─────────────────────────────────────────┘
```

**Read time for metadata only**: ~2-5ms (vs 100-500ms for full scan)

### Summary Schema

The embedded summary contains pre-computed aggregations:

```json
{
  "n4a_version": "1.0",
  "generated_at": "2025-01-09T10:30:00Z",
  "dataset_name": "wheat",
  "total_predictions": 12450,

  "stats": {
    "val_score": {
      "min": 0.72,
      "max": 0.97,
      "mean": 0.89,
      "std": 0.08,
      "quartiles": [0.82, 0.89, 0.94]
    },
    "test_score": {
      "min": 0.68,
      "max": 0.95,
      "mean": 0.86,
      "std": 0.09,
      "quartiles": [0.79, 0.86, 0.92]
    }
  },

  "facets": {
    "models": [
      {"name": "PLSRegression", "count": 5000, "avg_val_score": 0.91},
      {"name": "RandomForest", "count": 4200, "avg_val_score": 0.87},
      {"name": "XGBoost", "count": 3250, "avg_val_score": 0.89}
    ],
    "partitions": [
      {"name": "train", "count": 4150},
      {"name": "val", "count": 4150},
      {"name": "test", "count": 4150}
    ],
    "folds": ["0", "1", "2", "3", "4"],
    "n_configs": 45,
    "n_runs": 3
  },

  "runs": [
    {
      "id": "2025-01-09_ProteinSweep_abc123",
      "name": "Protein Sweep",
      "n_predictions": 6200,
      "best_val_score": 0.97
    },
    {
      "id": "2025-01-08_BaselineTest_def456",
      "name": "Baseline Test",
      "n_predictions": 6250,
      "best_val_score": 0.92
    }
  ],

  "top_predictions": [
    {
      "id": "pred_abc123",
      "model_name": "PLSRegression",
      "config_name": "SNV_PLS_15",
      "val_score": 0.97,
      "test_score": 0.95,
      "fold_id": "2"
    },
    {
      "id": "pred_def456",
      "model_name": "RandomForest",
      "config_name": "MSC_RF_100",
      "val_score": 0.96,
      "test_score": 0.94,
      "fold_id": "0"
    }
  ]
}
```

### Implementation: nirs4all Library

#### Writing with Embedded Summary

```python
# nirs4all/data/_predictions/storage.py

import pyarrow.parquet as pq
import json

def save_parquet_with_summary(self, meta_path: Path) -> None:
    """Save parquet with embedded summary metadata."""

    # Compute summary while data is in memory (zero extra cost)
    df = self._df
    summary = {
        "n4a_version": "1.0",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "dataset_name": df["dataset_name"].unique().to_list()[0] if "dataset_name" in df.columns else None,
        "total_predictions": len(df),
        "stats": self._compute_score_stats(df),
        "facets": self._compute_facets(df),
        "runs": self._compute_run_summaries(df),
        "top_predictions": self._compute_top_predictions(df, n=10),
    }

    # Convert Polars DataFrame to PyArrow Table
    table = df.to_arrow()

    # Embed summary in file metadata
    existing_meta = table.schema.metadata or {}
    new_meta = {
        **existing_meta,
        b"n4a_summary": json.dumps(summary).encode("utf-8"),
    }
    table = table.replace_schema_metadata(new_meta)

    # Write parquet file
    pq.write_table(table, str(meta_path))


def _compute_score_stats(self, df: pl.DataFrame) -> dict:
    """Compute statistics for score columns."""
    stats = {}
    for col in ["val_score", "test_score", "train_score"]:
        if col in df.columns:
            values = df[col].drop_nulls()
            if len(values) > 0:
                stats[col] = {
                    "min": float(values.min()),
                    "max": float(values.max()),
                    "mean": float(values.mean()),
                    "std": float(values.std()),
                    "quartiles": [
                        float(values.quantile(0.25)),
                        float(values.quantile(0.50)),
                        float(values.quantile(0.75)),
                    ],
                }
    return stats


def _compute_facets(self, df: pl.DataFrame) -> dict:
    """Compute faceted counts."""
    facets = {}

    # Models with counts and avg scores
    if "model_name" in df.columns:
        model_stats = (
            df.group_by("model_name")
            .agg([
                pl.count().alias("count"),
                pl.col("val_score").mean().alias("avg_val_score"),
            ])
            .sort("count", descending=True)
        )
        facets["models"] = [
            {
                "name": row["model_name"],
                "count": row["count"],
                "avg_val_score": round(row["avg_val_score"], 4) if row["avg_val_score"] else None,
            }
            for row in model_stats.iter_rows(named=True)
        ]

    # Partitions
    if "partition" in df.columns:
        partition_counts = df.group_by("partition").count().sort("partition")
        facets["partitions"] = [
            {"name": row["partition"], "count": row["count"]}
            for row in partition_counts.iter_rows(named=True)
        ]

    # Folds
    if "fold_id" in df.columns:
        facets["folds"] = df["fold_id"].unique().sort().to_list()

    # Counts
    facets["n_configs"] = df["config_name"].n_unique() if "config_name" in df.columns else 0
    facets["n_runs"] = df["run_id"].n_unique() if "run_id" in df.columns else 0

    return facets


def _compute_top_predictions(self, df: pl.DataFrame, n: int = 10) -> list:
    """Get top N predictions by validation score."""
    if "val_score" not in df.columns:
        return []

    top = df.sort("val_score", descending=True).head(n)
    return [
        {
            "id": row.get("id"),
            "model_name": row.get("model_name"),
            "config_name": row.get("config_name"),
            "val_score": round(row.get("val_score", 0), 4),
            "test_score": round(row.get("test_score", 0), 4) if row.get("test_score") else None,
            "fold_id": row.get("fold_id"),
        }
        for row in top.iter_rows(named=True)
    ]
```

#### Reading Summary Only (Instant)

```python
# nirs4all/data/_predictions/storage.py

import pyarrow.parquet as pq
import json
from typing import Optional

@classmethod
def read_summary_only(cls, parquet_path: Path) -> Optional[dict]:
    """
    Read ONLY the summary metadata from parquet file.

    This reads just the file footer (~1KB), not the row data.
    Time: ~2-5ms for any file size.

    Args:
        parquet_path: Path to .meta.parquet file

    Returns:
        Summary dict if present, None otherwise
    """
    try:
        parquet_file = pq.ParquetFile(str(parquet_path))
        metadata = parquet_file.schema_arrow.metadata

        if metadata and b"n4a_summary" in metadata:
            return json.loads(metadata[b"n4a_summary"].decode("utf-8"))

        return None
    except Exception:
        return None


@classmethod
def read_all_summaries(cls, workspace_path: Path) -> list:
    """
    Read summaries from all parquet files in workspace.

    Time: ~10-50ms for entire workspace (vs 2-5s for full scan)
    """
    summaries = []

    for parquet_file in workspace_path.glob("*.meta.parquet"):
        summary = cls.read_summary_only(parquet_file)
        if summary:
            summary["source_file"] = str(parquet_file)
            summaries.append(summary)

    return summaries
```

### Implementation: Webapp Backend

#### New Endpoint: Instant Summary

```python
# api/workspace.py

import pyarrow.parquet as pq
import json

@router.get("/workspaces/{workspace_id}/predictions/summary")
async def get_predictions_summary(workspace_id: str):
    """
    Get aggregated prediction summary from parquet metadata.

    This endpoint reads ONLY file footers, not row data.
    Response time: ~10-50ms for any workspace size.
    """
    try:
        ws = workspace_manager._find_linked_workspace(workspace_id)
        if not ws:
            raise HTTPException(status_code=404, detail="Workspace not found")

        workspace_path = Path(ws.path)
        summaries = []

        # Read only metadata from each parquet file
        for parquet_file in workspace_path.glob("*.meta.parquet"):
            try:
                pf = pq.ParquetFile(str(parquet_file))
                metadata = pf.schema_arrow.metadata

                if metadata and b"n4a_summary" in metadata:
                    summary = json.loads(metadata[b"n4a_summary"].decode("utf-8"))
                    summary["dataset"] = parquet_file.stem.replace(".meta", "")
                    summaries.append(summary)
                else:
                    # Fallback: file has no summary, include minimal info
                    summaries.append({
                        "dataset": parquet_file.stem.replace(".meta", ""),
                        "total_predictions": pf.metadata.num_rows,
                        "has_summary": False,
                    })
            except Exception as e:
                print(f"Error reading {parquet_file}: {e}")
                continue

        # Aggregate across all datasets
        total_predictions = sum(s.get("total_predictions", 0) for s in summaries)

        # Merge model stats across datasets
        all_models = {}
        for s in summaries:
            for model in s.get("facets", {}).get("models", []):
                name = model["name"]
                if name not in all_models:
                    all_models[name] = {"name": name, "count": 0, "total_score": 0, "score_count": 0}
                all_models[name]["count"] += model["count"]
                if model.get("avg_val_score"):
                    all_models[name]["total_score"] += model["avg_val_score"] * model["count"]
                    all_models[name]["score_count"] += model["count"]

        # Compute weighted averages
        models = []
        for m in all_models.values():
            models.append({
                "name": m["name"],
                "count": m["count"],
                "avg_val_score": round(m["total_score"] / m["score_count"], 4) if m["score_count"] > 0 else None,
            })
        models.sort(key=lambda x: x["count"], reverse=True)

        # Collect all runs
        all_runs = []
        for s in summaries:
            all_runs.extend(s.get("runs", []))

        return {
            "total_predictions": total_predictions,
            "total_datasets": len(summaries),
            "datasets": summaries,
            "models": models,
            "runs": all_runs,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to read predictions summary: {str(e)}"
        )


# Existing endpoint: full data (called only when drilling down)
@router.get("/workspaces/{workspace_id}/predictions/data")
async def get_workspace_predictions_data(
    workspace_id: str,
    limit: int = 50,  # Reduced default - summary provides overview
    offset: int = 0,
    dataset: Optional[str] = None,
    model: Optional[str] = None,
    partition: Optional[str] = None,
):
    """
    Get prediction row data with server-side filtering and pagination.

    Called only when user drills into details or applies filters.
    """
    # ... existing implementation with added filters ...
```

### Implementation: Webapp Frontend

#### Two-Phase Loading Pattern

```typescript
// src/pages/Predictions.tsx

interface PredictionSummary {
  total_predictions: number;
  total_datasets: number;
  datasets: DatasetSummary[];
  models: ModelSummary[];
  runs: RunSummary[];
}

interface DatasetSummary {
  dataset: string;
  total_predictions: number;
  stats: {
    val_score: ScoreStats;
    test_score: ScoreStats;
  };
  facets: {
    models: ModelFacet[];
    partitions: PartitionFacet[];
  };
  top_predictions: TopPrediction[];
}

export default function Predictions() {
  // Phase 1: Summary (instant)
  const [summary, setSummary] = useState<PredictionSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  // Phase 2: Detail data (lazy, on-demand)
  const [detailData, setDetailData] = useState<PredictionRecord[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  // Load summary on mount (instant)
  useEffect(() => {
    loadSummary();
  }, []);

  const loadSummary = async () => {
    setSummaryLoading(true);
    try {
      const workspaces = await getLinkedWorkspaces();
      const active = workspaces.workspaces.find(w => w.is_active);
      if (active) {
        // This is instant (~10-50ms)
        const summaryData = await getN4AWorkspacePredictionsSummary(active.id);
        setSummary(summaryData);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSummaryLoading(false);
    }
  };

  // Load details only when user requests them
  const loadDetails = async (filters?: FilterOptions) => {
    setDetailLoading(true);
    try {
      // Server-side filtered and paginated
      const data = await getN4AWorkspacePredictionsData(activeWorkspace.id, {
        limit: 50,
        offset: 0,
        ...filters,
      });
      setDetailData(data.records);
      setShowDetails(true);
    } finally {
      setDetailLoading(false);
    }
  };

  // Render dashboard from summary (instant)
  if (summaryLoading) {
    return <Skeleton />;
  }

  return (
    <div>
      {/* Stats cards - rendered from summary (instant) */}
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard title="Total Predictions" value={summary.total_predictions} />
        <StatCard title="Datasets" value={summary.total_datasets} />
        <StatCard title="Models" value={summary.models.length} />
        <StatCard title="Runs" value={summary.runs.length} />
      </div>

      {/* Model breakdown from summary */}
      <Card>
        <CardHeader>Models Performance</CardHeader>
        <CardContent>
          {summary.models.map(model => (
            <div key={model.name}>
              {model.name}: {model.count} predictions, avg R² = {model.avg_val_score}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Top predictions from summary */}
      <Card>
        <CardHeader>Top Predictions</CardHeader>
        <CardContent>
          {summary.datasets.flatMap(d => d.top_predictions).slice(0, 10).map(pred => (
            <TopPredictionRow key={pred.id} prediction={pred} />
          ))}
        </CardContent>
      </Card>

      {/* Detail table - loaded on demand */}
      <Card>
        <CardHeader>
          <Button onClick={() => loadDetails()}>
            {showDetails ? "Refresh" : "View All Predictions"}
          </Button>
        </CardHeader>
        {showDetails && (
          <CardContent>
            {detailLoading ? (
              <Skeleton />
            ) : (
              <PredictionTable
                data={detailData}
                onPageChange={(page) => loadDetails({ offset: page * 50 })}
              />
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
```

### Performance Comparison

| Metric | Before (Full Scan) | After (Embedded Summary) |
|--------|-------------------|--------------------------|
| **Initial page load** | 2-5 seconds | **~50ms** |
| **Dashboard stats** | Computed client-side | **Instant** (pre-computed) |
| **Memory usage** | 10k+ records in browser | Summary only (~5KB) |
| **Detail drill-down** | Already loaded | 50-100ms (on demand) |
| **Network transfer** | ~500KB-2MB | **~5KB** (summary) |

### Key Benefits

| Benefit | Description |
|---------|-------------|
| **No extra files** | Summary embedded in parquet, not a separate cache |
| **Always in sync** | Summary computed at save time, never stale |
| **Zero maintenance** | No cache invalidation, no rebuild triggers |
| **Portable** | Copy the parquet, summary comes with it |
| **Backward compatible** | Old files work (just slower), new files are fast |
| **Graceful fallback** | If no summary, use full scan |

### Migration Strategy

1. **New predictions**: Automatically include summary metadata
2. **Existing files**: Summary added on next save/update
3. **Webapp**: Check for summary, fallback to full scan if missing
4. **Optional CLI**: `nirs4all workspace rebuild-summaries` to backfill

```python
# CLI command to rebuild summaries for existing parquet files
# nirs4all/cli/workspace.py

@click.command()
@click.argument("workspace_path", type=click.Path(exists=True))
def rebuild_summaries(workspace_path: str):
    """Rebuild embedded summaries for all parquet files in workspace."""
    workspace = Path(workspace_path)

    for parquet_file in workspace.glob("*.meta.parquet"):
        click.echo(f"Processing {parquet_file.name}...")

        # Load data
        df = pl.read_parquet(parquet_file)

        # Save with summary
        storage = PredictionStorage()
        storage._df = df
        storage.save_parquet_with_summary(parquet_file)

        click.echo(f"  ✓ Added summary ({len(df)} predictions)")

    click.echo("Done!")
```

---

## 9. UI/UX Mapping

### Webapp Pages

| Concept | Primary Page | Purpose |
|---------|--------------|---------|
| Run | `/runs` | View all runs, their templates, datasets, status |
| Run (create) | `/runs/new` | Configure new run: select templates + datasets |
| Results | `/results` | Browse results grouped by run, template, or dataset |
| Predictions | `/predictions` | Detailed prediction analysis, charts |
| Pipeline Editor | `/pipelines/editor` | Create/edit pipeline templates |
| Template Library | `/pipelines/library` | Manage saved templates |

### Dashboard Widgets

| Widget | Shows |
|--------|-------|
| Active Runs | Running experiments with progress |
| Recent Results | Latest completed results with scores |
| Best Models | Top performing model+dataset combinations |
| Template Usage | Which templates are used most |

### Run Creation Flow

```
1. Select Pipeline Templates
   ┌────────────────────────────────────────────────┐
   │ [✓] PLS Variants (expands to 6 configs)       │
   │ [✓] Random Forest Baseline (1 config)         │
   │ [ ] Neural Network (4 configs)                │
   │                                                │
   │ Total: 7 pipeline configurations              │
   └────────────────────────────────────────────────┘

2. Select Datasets
   ┌────────────────────────────────────────────────┐
   │ [✓] wheat.csv                                 │
   │ [✓] corn.csv                                  │
   │ [✓] soy.csv                                   │
   │                                                │
   │ Total: 3 datasets                             │
   └────────────────────────────────────────────────┘

3. Configure Run
   ┌────────────────────────────────────────────────┐
   │ Run Name: Protein Sweep v3                    │
   │ CV Folds: 5                                   │
   │ CV Strategy: KFold                            │
   │                                                │
   │ Preview: 7 configs × 3 datasets = 21 results  │
   └────────────────────────────────────────────────┘

4. Launch
   → Creates run with 21 results to compute
```

---

## 10. API Design

### Endpoints Hierarchy

```
/api/runs
├── GET    /                       # List all runs
├── POST   /                       # Create new run
├── GET    /:runId                 # Get run details
├── GET    /:runId/templates       # Get all templates in run
├── GET    /:runId/results         # Get all results for run
├── POST   /:runId/pause           # Pause running run
├── POST   /:runId/resume          # Resume paused run
├── DELETE /:runId                 # Delete run and results

/api/templates
├── GET    /                       # List saved templates
├── POST   /                       # Save new template
├── GET    /:templateId            # Get template details
├── GET    /:templateId/preview    # Preview expansion without running

/api/results
├── GET    /                       # List all results (with filters)
├── GET    /:resultId              # Get result details
├── GET    /:resultId/predictions  # Get predictions for result
├── GET    /by-dataset/:datasetId  # Results for a dataset
├── GET    /by-template/:templateId # Results from a template

/api/predictions
├── GET    /                       # List predictions (paginated)
├── GET    /:predictionId          # Get prediction details
├── GET    /:predictionId/data     # Get y_true, y_pred arrays
└── GET    /compare                # Compare multiple predictions
```

### Query Parameters

```
# Runs
GET /api/runs?status=running
GET /api/runs?dataset=wheat

# Results
GET /api/results?run_id=abc123
GET /api/results?template_id=template_001
GET /api/results?dataset=wheat&metric=r2&min_score=0.9
GET /api/results?model_type=PLS&sort=best_score&order=desc

# Predictions
GET /api/predictions?result_id=def456
GET /api/predictions?partition=test&fold_id=0
```

---

## 11. Future Enhancements

### 1. Template Versioning

Track changes to pipeline templates over time:
```yaml
pipeline_template:
  version: 3
  parent_version: 2
  changes: "Added SG preprocessing option"
```

### 2. Run Comparison

Compare multiple runs side-by-side:
```python
nirs4all.compare_runs(["run_001", "run_002"])
```

### 3. Template Composition

Build templates from other templates:
```python
preprocessing_template = [{"_or_": [SNV(), MSC()]}]
model_template = [PLSRegression()]

combined = nirs4all.compose_templates(
    preprocessing_template,
    model_template
)
```

### 4. Prediction Aggregation

Aggregate predictions across folds for final reporting:
```python
result.aggregate_predictions(method="mean")  # or "vote" for classification
```

### 5. Lineage Tracking

Track the full lineage from raw data to prediction:
```
Dataset → Run → Template → Result → Prediction → Deployed Model
```

### 6. Automatic Run Naming

Generate meaningful names from content:
```
"PLS + RF on Wheat, Corn (7 variants × 2 datasets)"
```

---

## Summary

| Concept | Scope | Contains | Stored In |
|---------|-------|----------|-----------|
| Pipeline Template | Recipe | Steps with optional generators | `templates/<id>.yaml` |
| Run | Experiment | Templates[] × Datasets[] → Results | `run_manifest.yaml` |
| Result | Evaluation | 1 Dataset + 1 Config → Predictions | `manifest.yaml` |
| Prediction | Output | Model + Partition + Scores | `.meta.parquet` |

### Key Formula

```
Run = [Pipeline Templates] × [Datasets] = Results

Where:
  - Each Template expands to N concrete pipeline configs
  - Total configs = Σ expansion_count for all templates
  - Total Results = Total configs × Number of datasets
```

Understanding this hierarchy is key to:
- Designing effective experiments with multiple approaches
- Navigating the webapp efficiently
- Debugging unexpected results
- Sharing and reproducing experiments

---

# Implementation Gap Analysis

This section analyzes the discrepancies between the conceptual model described above and the current implementation in both nirs4all (library) and nirs4all_webapp.

## Current State Overview

### nirs4all Library (Current Implementation)

| Concept | Implemented? | Details |
|---------|--------------|---------|
| Pipeline Template | ⚠️ Partial | Templates expanded immediately by `PipelineConfigs`. Original **not saved**. |
| Multiple Templates | ❌ Not Implemented | `nirs4all.run()` accepts one pipeline, not a list of templates |
| Run | ❌ Not Implemented | No "Run" entity. Executes pipelines directly without container. |
| Result | ⚠️ Implicit | Written as per-dataset manifests in `workspace/runs/<dataset>/<config_id>/` |
| Prediction | ✅ Implemented | Stored in `.meta.parquet` files with rich metadata |

### nirs4all_webapp (Current Implementation)

| Concept | Implemented? | Details |
|---------|--------------|---------|
| Run (UI types) | ⚠️ Partial | Types in `types/runs.ts` support multiple datasets, but not multiple templates |
| Run Discovery | ❌ Wrong Source | Reads from `.meta.parquet` not manifest files, loses run context |
| Results View | ❌ Not Implemented | No dedicated results page, mixed into runs |
| Predictions View | ✅ Implemented | Reads from parquet, displays well |

---

## Gap #1: Pipeline Templates Not Saved

### Problem

The `PipelineConfigs` class expands generators immediately upon initialization:

```python
# nirs4all/pipeline/config/pipeline_config.py
class PipelineConfigs:
    def __init__(self, definition, ...):
        self.steps = self._load_steps(definition)
        # ... expansion happens here ...
        if self._has_gen_keys(self.steps):
            expanded_with_choices = expand_spec_with_choices(self.steps)
            self.steps = [config for config, choices in expanded_with_choices]
```

The original template (with `_or_`, `_range_`) is lost after expansion.

### Impact

- Cannot reproduce the exact experiment intent
- Cannot show users what they originally specified
- Cannot re-run with different datasets
- Webapp cannot display "original template" vs "expanded variants"

### Proposed Fix

```python
# In PipelineConfigs.__init__:
self.original_template = copy.deepcopy(definition)  # Save before expansion
self.template_hash = hash_pipeline_template(definition)
```

And save to workspace:
```yaml
# workspace/runs/<run_id>/templates/template_001.yaml
schema_version: "1.0"
id: "template_001"
name: "PLS Preprocessing Sweep"
created_at: "2025-01-08T10:00:00Z"
template_hash: "abc123def456"
steps:
  - class: sklearn.preprocessing.MinMaxScaler
  - _or_:
      - class: nirs4all.operators.SNV
      - class: nirs4all.operators.MSC
  - _range_: [5, 15, 5]
    param: n_components
  - class: sklearn.cross_decomposition.PLSRegression
expansion_count: 6
```

---

## Gap #2: No Support for Multiple Templates

### Problem

The current `nirs4all.run()` API accepts a single pipeline:

```python
# Current API
result = nirs4all.run(
    pipeline=[...],  # Single pipeline or template
    dataset=[...],
)
```

Users cannot pass multiple templates to compare different approaches in one run.

### Impact

- Users must run experiments separately for different model families
- Cannot easily compare PLS vs RF vs NN in one session
- Results are fragmented across multiple "runs"

### Proposed Fix

Extend API to accept list of templates:

```python
# New API (backward compatible)
result = nirs4all.run(
    pipeline=[
        # Can be a single template (current behavior)
        [SNV(), PLSRegression()],

        # Or multiple templates
        [{"_or_": [SNV(), MSC()]}, PLSRegression()],
        [MinMaxScaler(), RandomForestRegressor()],
    ],
    dataset=["wheat.csv", "corn.csv"],
)
```

Detection logic:
```python
def _is_list_of_templates(pipeline):
    """Check if pipeline is a list of templates or a single template."""
    if not isinstance(pipeline, list):
        return False
    if len(pipeline) == 0:
        return False
    # If first element is a list, it's multiple templates
    # If first element is a step/dict, it's a single template
    return isinstance(pipeline[0], list)
```

---

## Gap #3: No "Run" Entity

### Problem

In nirs4all, execution flows directly from `PipelineConfigs` + `DatasetConfigs` through the orchestrator. There's no persistent "Run" object that groups all related executions.

```python
# nirs4all/pipeline/execution/orchestrator.py
for config in dataset_configs.configs:
    for (steps, config_name, gen_choices) in zip(...):
        # Execute directly, no run container
        executor.execute(steps, config_name, dataset, ...)
```

### Impact

- No way to track which executions belong together
- Cannot restart/resume a failed multi-template run
- Cannot compare "runs" with different configurations
- Webapp has to infer runs from file system structure

### Current Workaround (Webapp)

The webapp infers runs from parquet data:

```python
# api/workspace.py get_workspace_runs()
for config_name in df["config_name"].dropna().unique():
    all_runs.append({
        "id": str(config_name),
        "name": str(config_name),
        "dataset": dataset_name,  # Only ONE dataset per "run"
        ...
    })
```

This produces **one "run" per dataset × config**, not **one run per experiment session**.

### Proposed Fix

Add a `Run` class to nirs4all:

```python
# New file: nirs4all/pipeline/run.py
class Run:
    def __init__(
        self,
        pipeline_templates: List[List[Any]],  # Multiple templates
        datasets: List[str],
        name: str = None,
        description: str = None,
    ):
        self.id = generate_run_id()
        self.name = name or self._generate_name()
        self.pipeline_templates = pipeline_templates
        self.datasets = datasets
        self.created_at = datetime.now(timezone.utc)
        self.status = "pending"

    def execute(self, **kwargs):
        """Execute all templates on all datasets."""
        self._save_run_manifest()
        self._save_templates()

        for template_idx, template in enumerate(self.pipeline_templates):
            pipeline_config = PipelineConfigs(template)
            # Execute on all datasets
            for dataset in self.datasets:
                ...
```

Update API call:

```python
# nirs4all.run() should return Run object, not just Predictions
result = nirs4all.run(
    pipeline=[template1, template2, template3],
    dataset=["wheat", "corn", "soy"],
    name="My Experiment",
)
# result.run_id → "2025-01-08_MyExperiment_abc123"
# result.templates → List of original templates
# result.results → List[Result] (one per config × dataset)
```

---

## Gap #4: Manifest Structure Doesn't Match Concepts

### Current Structure

```
workspace/runs/<dataset>/<config_id>/
└── manifest.yaml
```

The manifest is per **dataset × expanded_pipeline**, which maps to a "Result" in our terminology. There's no run-level or template-level grouping.

### Problems

1. **No run-level manifest**: Cannot find all results from the same run
2. **No template tracking**: Don't know which template a config came from
3. **Config ID is ambiguous**: `0001_PLS_abc123` is a result, not a run
4. **Generator choices stored but not the template**: `generator_choices` are stored but original template isn't

### Proposed Structure

```
workspace/
├── runs/
│   └── <run_id>/                          # NEW: Run-level directory
│       ├── run_manifest.yaml              # Run metadata
│       ├── templates/                     # NEW: Templates directory
│       │   ├── template_001.yaml          # Original template 1
│       │   └── template_002.yaml          # Original template 2
│       └── results/
│           └── <dataset>/
│               └── <pipeline_config>/
│                   └── manifest.yaml      # Result manifest
```

---

## Gap #5: Webapp Reads Wrong Data Source

### Problem

The webapp's `get_workspace_runs()` endpoint reads from `.meta.parquet` files:

```python
# api/workspace.py
parquet_files = list(workspace_path.glob("*.meta.parquet"))
for parquet_file in parquet_files:
    df = pd.read_parquet(parquet_file, columns=[...])
    for config_name in df["config_name"].dropna().unique():
        # Creates one "run" per config_name per parquet file
```

This produces **per-dataset pseudo-runs** rather than actual experiment sessions.

### Impact

- User sees: 228 "runs" (one per dataset × config combination)
- User should see: ~10 runs (grouped by experiment session)
- Each "run" shows only 1 dataset instead of all datasets in the experiment
- Templates are invisible

### Proposed Fix

1. **Short-term**: Read manifest.yaml files and group by timestamp/hash
2. **Long-term**: Read run_manifest.yaml files created by nirs4all

```python
# Short-term fix for api/workspace.py
async def get_workspace_runs(workspace_id: str):
    # Look for run manifests first
    run_manifests = list(workspace_path.glob("runs/*/run_manifest.yaml"))

    if run_manifests:
        # New format: read run manifests
        for manifest_path in run_manifests:
            manifest = yaml.safe_load(manifest_path.read_text())
            runs.append({
                "id": manifest["uid"],
                "name": manifest["name"],
                "templates": manifest["templates"],
                "datasets": [d["name"] for d in manifest["datasets"]],
                ...
            })
    else:
        # Legacy format: group results by timestamp
        ...
```

---

## Gap #6: Type Mismatch Between Concepts and Code

### Frontend Types (types/runs.ts)

```typescript
interface Run {
  id: string;
  name: string;
  datasets: DatasetRun[];  // Multiple datasets ✓
  status: RunStatus;
  // Missing: templates[]
}
```

The frontend types need to be extended for multiple templates.

### Proposed Type Updates

```typescript
// types/runs.ts - Updated

interface PipelineTemplate {
  id: string;
  name: string;
  expansion_count: number;
  steps?: unknown[];  // For display
}

interface Run {
  id: string;
  name: string;
  description?: string;
  templates: PipelineTemplate[];  // NEW: Multiple templates
  datasets: DatasetRun[];
  total_configs: number;  // Sum of all template expansions
  status: RunStatus;
  created_at: string;
  ...
}

interface DatasetRun {
  dataset_id: string;
  dataset_name: string;
  pipelines: PipelineRun[];  // Results for this dataset
}

interface PipelineRun {
  id: string;
  template_id: string;  // NEW: Which template this came from
  pipeline_name: string;
  model: string;
  metrics?: RunMetrics;
}

// Rename DiscoveredRun to DiscoveredResult
interface DiscoveredResult {
  id: string;
  run_id: string;
  template_id: string;
  pipeline_config_id: string;
  dataset: string;
  ...
}
```

---

## Gap #7: Missing Result Concept in UI

### Problem

The webapp has:
- `/runs` page → Shows pseudo-runs (actually results grouped by name)
- `/predictions` page → Shows individual predictions

Missing:
- `/results` page → Should show results (1 dataset + 1 pipeline config)

### Proposed Navigation

```
Runs page (experiment sessions)
└── Run: "Protein Sweep v2" (created 2025-01-08)
    ├── Templates: [PLS Variants (6), RF Baseline (1)]
    ├── Datasets: wheat, corn, soy
    └── Results: 21 total, best R²=0.972 on wheat

Results page (per-dataset, per-config outcomes)
├── Filters: [Run ▼] [Template ▼] [Dataset ▼] [Model ▼]
└── Results table:
    | Template    | Dataset | Config        | Model | R² | RMSE |
    | PLS Vars    | wheat   | SNV_PLS_15   | PLS   | 0.97 | 0.12 |
    | PLS Vars    | wheat   | MSC_PLS_10   | PLS   | 0.95 | 0.15 |
    | RF Baseline | wheat   | MinMax_RF    | RF    | 0.89 | 0.25 |
    | PLS Vars    | corn    | SNV_PLS_15   | PLS   | 0.91 | 0.22 |
    ...

Predictions page (model outputs)
├── Filters: [Result ▼] [Fold ▼] [Partition ▼]
└── Prediction details with y_true vs y_pred charts
```

---

## Gap #8: Limited Dataset Metadata in Runs

### Problem

Current run manifests only store minimal dataset information:
- Path
- Name (often just filename)
- Hash (sometimes)

The nirs4all library doesn't capture rich dataset metadata at run time, making it impossible to:
- Auto-discover datasets when linking workspaces
- Preserve dataset properties when files are moved
- Validate dataset integrity across machines

### Impact

- **Webapp linking**: Users must manually re-add all datasets when linking a workspace
- **Portability**: Moving workspaces between machines breaks dataset references
- **Reproducibility**: Cannot verify the same data was used across runs
- **Usability**: Users lose context about datasets if files are reorganized

### Proposed Fix

#### 1. Library: Capture Dataset Metadata at Run Time

```python
# nirs4all/data/dataset.py
class SpectroDataset:
    def get_metadata(self) -> dict:
        """Extract full metadata for storage in run manifest."""
        return {
            "name": self.name or self._infer_name(),
            "path": str(self.source_path),
            "hash": self._compute_hash(),
            "task_type": self.task_type,
            "n_samples": len(self),
            "n_features": self.X.shape[1] if self.X is not None else 0,
            "y_columns": list(self.y.columns) if hasattr(self.y, 'columns') else ["y"],
            "y_stats": self._compute_y_stats(),
            "wavelength_range": self._get_wavelength_range(),
            "wavelength_unit": self.wavelength_unit,
            "metadata": self.user_metadata,
            "version": self._compute_version_hash(),
        }

    def _compute_y_stats(self) -> dict:
        """Compute statistics for each target column."""
        if self.y is None:
            return {}
        stats = {}
        y_df = pd.DataFrame(self.y)
        for col in y_df.columns:
            stats[str(col)] = {
                "min": float(y_df[col].min()),
                "max": float(y_df[col].max()),
                "mean": float(y_df[col].mean()),
                "std": float(y_df[col].std()),
            }
        return stats
```

#### 2. Library: Store Rich Metadata in Manifests

```python
# nirs4all/pipeline/manifest_manager.py
class ManifestManager:
    def create_run_manifest(self, datasets: List[SpectroDataset], ...):
        """Create run manifest with full dataset metadata."""
        return {
            "schema_version": "2.0",
            "uid": self.run_id,
            # ...
            "datasets": [ds.get_metadata() for ds in datasets],
        }
```

#### 3. Webapp: Auto-Discover from Run Manifests

```python
# api/workspace.py
async def discover_datasets_from_runs(workspace_path: Path) -> List[dict]:
    """Extract unique datasets from all run manifests."""
    datasets_by_hash = {}

    for manifest_path in workspace_path.glob("runs/*/run_manifest.yaml"):
        manifest = yaml.safe_load(manifest_path.read_text())

        for ds in manifest.get("datasets", []):
            hash_key = ds.get("hash")
            if hash_key and hash_key not in datasets_by_hash:
                datasets_by_hash[hash_key] = {
                    **ds,
                    "discovered_from": str(manifest_path),
                    "status": validate_path(ds.get("path")),
                }

    return list(datasets_by_hash.values())
```

#### 4. Webapp: Create Dataset Registry

```python
# api/workspace.py
async def sync_dataset_registry(workspace_id: str):
    """Sync dataset registry with run manifests."""
    workspace = get_workspace(workspace_id)

    # Load existing registry
    registry = load_dataset_registry(workspace.path)

    # Discover from runs
    discovered = await discover_datasets_from_runs(workspace.path)

    # Merge (preserve user path updates)
    for ds in discovered:
        existing = registry.get_by_hash(ds["hash"])
        if existing:
            existing.update_usage(ds)
        else:
            registry.add(ds)

    # Save and return
    registry.save()
    return registry.to_api_response()
```

### Benefits

| Benefit | Description |
|---------|-------------|
| **Zero-config linking** | Datasets auto-appear when workspace is linked |
| **Preserved metadata** | Stats, targets, wavelengths survive file moves |
| **Path flexibility** | Users can update paths while keeping identity |
| **Cross-machine portability** | Share workspace, datasets discovered automatically |
| **Integrity validation** | Hash verification ensures same data across runs |

---

## Implementation Roadmap

> **Updated based on Design Review (2026-01-09)** - incorporates findings from code analysis comparing this design against actual implementations.

### Phase 0: Performance Optimization (Priority)

> **Recommended to implement first** - provides immediate UX improvement with minimal changes.

#### 0.1 Embedded Summary in Parquet (nirs4all)

1. **Add embedded summary to parquet saves**
   - Modify `PredictionStorage.save_parquet()` to compute and embed summary
   - Add `_compute_score_stats()`, `_compute_facets()`, `_compute_top_predictions()` methods
   - ⚠️ **REVIEW:** Use `top_k()` instead of `sort().head()` for O(n log k) vs O(n log n)
   - ⚠️ **REVIEW:** Expand summary schema to include `task_types`, `date_range`, `metrics_used`

2. **Add summary reader**
   - Implement `PredictionStorage.read_summary_only(path)` using PyArrow
   - Reads only parquet footer (~1KB), not row data
   - Returns summary dict or None if not present

3. **🆕 Incremental summary maintenance** (from review)
   - Implement `IncrementalSummary` class with Welford's algorithm
   - Use min-heap for top-k tracking (O(log k) per add)
   - Summary save becomes O(1) serialization instead of O(n) recomputation

#### 0.2 Concurrent Parquet Scanning (webapp)

4. **New webapp endpoint with concurrent I/O**
   - `GET /workspaces/{id}/predictions/summary` - instant aggregated stats
   - ⚠️ **REVIEW:** Use `ThreadPoolExecutor` for concurrent footer reads (7.5x speedup)
   - ⚠️ **REVIEW:** Add mtime-based caching to avoid re-reading unchanged files
   - Aggregates across datasets for dashboard display

#### 0.3 Virtual Scrolling Frontend (webapp)

5. **🆕 True lazy loading** (from review - replaces "Two-phase frontend loading")
   - Use `@tanstack/react-virtual` for virtual scrolling
   - Use `useInfiniteQuery` for server-side pagination
   - ⚠️ **REVIEW:** Do NOT accumulate all data client-side (defeats optimization)
   - Server-side filtering with Polars predicate pushdown

6. **Migration CLI (optional)**
   - `nirs4all workspace rebuild-summaries <path>` to backfill existing files
   - Graceful fallback: if no summary, use full scan

**Expected Impact** (updated from review):
| Metric | Before | After |
|--------|--------|-------|
| Initial page load | 2-5s | **~200ms** |
| Network transfer | 500KB-2MB | ~5KB |
| Memory usage | 10k+ records | **5MB** (vs 150MB) |
| Time to interaction | 15s | **200ms** |

---

### Phase 1: Library Changes (nirs4all)

#### 1.1 Template Preservation

1. **Save pipeline templates before expansion**
   - Modify `PipelineConfigs` to store `original_template` (deep copy before expansion)
   - ⚠️ **REVIEW:** Note that `generator_choices` is already preserved - this adds full template
   - Save to `templates/<id>.yaml` in run directory

#### 1.2 Multiple Template Support

2. **🆕 Support multiple templates with explicit syntax** (from review)
   - ⚠️ **REVIEW:** Use explicit `templates=` parameter, NOT inference from list structure
   - Fragile detection like `isinstance(pipeline[0], list)` fails on edge cases
   ```python
   # Recommended API
   nirs4all.run(
       templates=[template1, template2],  # Explicit key
       dataset=[...],
   )
   ```

#### 1.3 Run Entity

3. **Add Run entity**
   - Create `Run` class in `nirs4all/pipeline/run.py`
   - Generate unique run_id
   - Track all templates and datasets

4. **🆕 Define metric metadata** (from review)
   ```python
   METRIC_METADATA = {
       "r2": {"higher_is_better": True, "optimal": 1.0},
       "rmse": {"higher_is_better": False, "optimal": 0.0},
       "accuracy": {"higher_is_better": True, "optimal": 1.0},
       "mae": {"higher_is_better": False, "optimal": 0.0},
   }
   ```

#### 1.4 Manifest Structure

5. **Create run-level manifest**
   - ⚠️ **REVIEW:** Consider splitting into normalized files to avoid god object:
     - `run.yaml` - core metadata only
     - `templates.yaml` - template references
     - `config.yaml` - execution configuration
     - `summary.yaml` - updated post-execution
   - Include references to all templates
   - Update with status and results on completion

6. **Link results to runs and templates**
   - Add `run_id` and `template_id` fields to result manifests

#### 1.5 Dataset Metadata

7. **Capture rich dataset metadata**
   - Add `SpectroDataset.get_metadata()` method
   - Compute y_stats, wavelength_range, content hash
   - ⚠️ **REVIEW:** Must include `file_size` for path resolution optimization
   - ⚠️ **REVIEW:** Optionally include `quick_hash` (header+footer hash)
   ```yaml
   datasets:
     - name: "Wheat Protein 2025"
       path: "/data/wheat.csv"
       hash: "sha256:abc123..."
       file_size: 52428800      # CRITICAL for path resolution
       quick_hash: "a1b2c3d4"   # Optional: fast filtering
   ```

---

### Phase 2: Backend Changes (nirs4all_webapp)

#### 2.1 Workspace Scanning

1. **Update workspace scanning**
   - Look for `run_manifest.yaml` files first
   - ⚠️ **REVIEW:** Unify the TWO discovery paths (parquet vs manifest) to avoid inconsistency
   - Parse template information
   - Fall back to result grouping for legacy data

2. **Add proper API endpoints**
   ```
   GET /api/runs              → List runs with template info
   GET /api/runs/:id          → Run details + templates + results
   GET /api/templates         → List saved templates
   GET /api/results           → List results (with filters)
   ```

3. **Update types**
   - Add `templates` field to Run responses
   - Rename `DiscoveredRun` → `DiscoveredResult`

#### 2.2 Dataset Management

4. **Implement dataset auto-discovery**
   - Extract datasets from run manifests on workspace link
   - ⚠️ **REVIEW:** Use reference-based design, not data duplication:
     ```yaml
     # run_manifest.yaml - reference only
     datasets:
       - ref: "ds_wheat_v1"  # Points to registry
     ```
   - Create/update `datasets.yaml` registry (single source of truth)
   - ⚠️ **REVIEW:** Add file locking to prevent race conditions:
     ```python
     import fcntl
     with open(registry_path, 'r+') as f:
         fcntl.flock(f, fcntl.LOCK_EX)
         # ... read, modify, write ...
     ```
   - API endpoint: `POST /api/workspaces/:id/sync-datasets`

5. **🆕 Efficient path resolution** (from review)
   - Multi-stage filtering:
     1. Check original path (instant)
     2. Check common relative locations (instant)
     3. Filter by file size (instant) - requires `file_size` in manifest
     4. Filter by quick hash (fast - ~1ms per file)
     5. Verify with full hash (slow - only 0-2 candidates)
   - ⚠️ **REVIEW:** Do NOT scan all CSVs with full hash (50+ second bottleneck)
   - API endpoint: `PATCH /api/datasets/:id/path`

---

### Phase 3: Frontend Changes (nirs4all_webapp)

1. **Update Runs page**
   - Show templates included in each run
   - Display total configs as sum of template expansions

2. **Update Run creation**
   - Allow selecting multiple templates
   - Show combined expansion count

3. **Add Results page**
   - Filterable table of all results
   - Filter by run, template, dataset, model type

4. **Update navigation**
   - Clear hierarchy: Runs → Results → Predictions
   - Templates as first-class concept

---

### Phase 4: Migration & Compatibility

1. **Legacy data support**
   - Scanner reconstructs runs from existing manifests
   - Group by timestamp + template similarity
   - Infer templates from generator_choices

2. **🆕 Schema migration strategy** (from review)
   - Define upgrade path from v1 manifests to v2
   - Handle parquet files without embedded summaries (graceful fallback)
   - Validate and fill missing fields with defaults

3. **🆕 Backward compatibility guarantees** (from review)
   - Old library versions can read new manifests (ignore unknown fields)
   - New library versions can read old manifests (fill defaults)
   - Document breaking changes in CHANGELOG

4. **Documentation**
   - Update user guide with new concepts
   - Add migration guide for existing workspaces

---

### 🆕 Phase 5: Robustness (from review)

> **New phase added based on design review findings**

#### 5.1 Error Recovery

1. **Add checkpoint system**
   - Record completed results in manifest during execution
   - Support resuming from last successful checkpoint
   - Mark partial runs with appropriate status

2. **Partial run handling**
   ```yaml
   # run_manifest.yaml
   status: "partial"
   checkpoints:
     - result_id: "result_001"
       completed_at: "2025-01-09T10:00:00Z"
     - result_id: "result_002"
       completed_at: "2025-01-09T10:05:00Z"
   resume_from: "result_002"
   ```

#### 5.2 Concurrent Run Handling

3. **Resource locking**
   - Prevent conflicts when multiple runs access same dataset
   - Queue mechanism for shared resources
   - Conflict resolution for parquet updates (append vs replace)

#### 5.3 State Machine Formalization

4. **Formalize run state transitions**
   ```python
   VALID_TRANSITIONS = {
       "queued": ["running", "cancelled"],
       "running": ["completed", "failed", "paused"],
       "paused": ["running", "cancelled"],
       "failed": ["queued"],  # retry
       "completed": [],  # terminal
       "cancelled": [],  # terminal
   }
   ```

---

## Quick Reference: What Needs to Change

> **Updated based on Design Review (2026-01-09)** - items marked with ⚠️ are from code review findings.

| Component | File | Change |
|-----------|------|--------|
| **Phase 0: Performance** | | |
| Embedded summary | `_predictions/storage.py` | Add `save_parquet_with_summary()` |
| Summary reader | `_predictions/storage.py` | Add `read_summary_only()` |
| Score stats | `_predictions/storage.py` | Add `_compute_score_stats()` ⚠️ Use `top_k()` |
| ⚠️ Incremental summary | `_predictions/storage.py` | Add `IncrementalSummary` class (Welford + heap) |
| Summary endpoint | `api/workspace.py` | Add `GET /predictions/summary` ⚠️ concurrent I/O |
| ⚠️ Virtual scrolling | `Predictions.tsx` | Use `@tanstack/react-virtual` + `useInfiniteQuery` |
| Rebuild CLI | `cli/workspace.py` | Add `rebuild-summaries` command |
| **Phase 1: nirs4all** | | |
| Save template | `pipeline_config.py` | Store `original_template` |
| ⚠️ Multiple templates | `api/run.py` | Use explicit `templates=` parameter (not inference) |
| Run class | `run.py` (new) | Create Run entity |
| ⚠️ Metric metadata | `metrics.py` (new) | Define `METRIC_METADATA` with `higher_is_better` |
| Run manifest | `manifest_manager.py` | Add `create_run()` ⚠️ consider normalized files |
| Result manifest | `manifest_manager.py` | Add `run_id`, `template_id` fields |
| Dataset metadata | `data/dataset.py` | Add `get_metadata()` method |
| ⚠️ File size | `data/dataset.py` | Include `file_size` in metadata (critical) |
| Y statistics | `data/dataset.py` | Compute min/max/mean/std per target |
| Content hash | `data/dataset.py` | Compute SHA256 + optional quick_hash |
| **Phase 2: nirs4all_webapp** | | |
| Backend types | `workspace.py` | Add Run + template scanning |
| ⚠️ Unified scanning | `workspace.py` | Merge parquet + manifest discovery paths |
| API endpoints | `runs.py` | Return templates in runs |
| Dataset discovery | `workspace.py` | Extract datasets from run manifests |
| ⚠️ Dataset registry | `workspace.py` | Reference-based design + file locking |
| ⚠️ Path resolution | `datasets.py` | Multi-stage: size → quick_hash → full_hash |
| Frontend types | `runs.ts` | Add `templates[]` to Run |
| Dataset types | `datasets.ts` | Add status, version fields |
| Runs page | `Runs.tsx` | Show templates per run |
| Run creation | `NewRun.tsx` | Select multiple templates |
| Results page | `Results.tsx` (new) | Add results view |
| Dataset status | `Datasets.tsx` | Show missing/valid status, path update UI |
| **Phase 4: Migration** | | |
| ⚠️ Schema migration | `manifest_manager.py` | v1 → v2 upgrade path |
| ⚠️ Backward compat | All manifests | Ignore unknown fields, fill defaults |
| **Phase 5: Robustness** | | |
| ⚠️ Checkpoints | `manifest_manager.py` | Record progress, support resume |
| ⚠️ Resource locking | `workspace.py` | Prevent concurrent run conflicts |
| ⚠️ State machine | `run.py` | Formalize `VALID_TRANSITIONS` |

---

# Design Review Notes

> **Reviewed:** 2026-01-09 | **Reviewer:** Claude Code Analysis

This section documents the results of an independent code review comparing this design document against the actual nirs4all and nirs4all_webapp implementations.

## Overall Assessment

**Verdict:** The design is **fundamentally sound** and correctly identifies the major architectural gaps. The concept hierarchy (Run → Result → Prediction) is well-defined and the Parquet embedded summary optimization is an excellent approach.

**However**, several refinements are needed before implementation.

---

## Inconsistencies with Actual Implementation

### Gap #1: "Pipeline Templates Not Saved" - Partially Incorrect

**Document claims:** "The original template (with `_or_`, `_range_`) is lost after expansion."

**Reality:** The library DOES preserve generator choices:
```python
# pipeline_config.py - actual implementation
self.generator_choices = [choices for config, choices in expanded_with_choices]
```

And manifests store `generator_choices`:
```yaml
generator_choices:
  - {_or_: "nirs4all.operators.SNV"}
  - {_range_: 15}
```

**What IS actually missing:** The full unexpanded template structure is not stored. Only the choices are recorded, not the complete template with all alternatives. Reconstruction is possible but imperfect.

**Action:** Update Gap #1 to be more precise - it's about "full template preservation" not "generator choices".

---

### Gap #5: "Webapp Reads Wrong Data Source" - Accurate but Incomplete

**Reality:** The document correctly identifies the parquet-based discovery but misses that there are **TWO discovery paths**:

1. `get_workspace_runs()` in `workspace.py:1517-1594` - reads parquet directly
2. `WorkspaceScanner.discover_runs()` in `workspace_manager.py:187-222` - scans manifest.yaml files

This **dual-path confusion** should be highlighted as a separate issue, as it creates potential inconsistencies.

---

### Gap #8: "Limited Dataset Metadata in Runs" - Partially Outdated

**Reality:** Phase 7 already added `dataset_info` to manifests:
```python
# manifest_manager.py (actual)
"dataset_info": {path: str, hash: str, version_at_run: int}
```

The proposed rich metadata structure is more comprehensive and valuable, but the gap description should acknowledge existing functionality.

---

## Logical Errors Requiring Correction

### 1. Multiple Templates Detection - Ambiguous Logic

**Location:** Lines 1851-1860

**Problem:** The proposed detection is fragile:
```python
def _is_list_of_templates(pipeline):
    return isinstance(pipeline[0], list)  # FRAGILE!
```

**Failure cases:**
- `[[SNV(), PLS()]]` - Single template wrapped → false positive
- `[{"branch": [[A], [B]]}]` - Branch syntax → false positive
- `[MinMaxScaler, [1,2,3]]` - Mixed types → ambiguous

**Recommended fix:** Use explicit syntax:
```python
nirs4all.run(
    templates=[  # Explicit "templates" key
        [SNV(), PLS()],
        [MSC(), RF()],
    ],
    dataset=[...]
)
```

### 2. Dataset Registry Race Condition

**Location:** Lines 714-759

**Problem:** The `link_workspace()` function modifies registry without locking. If a run completes during linking, data could be lost.

**Recommended fix:** Add file locking:
```python
import fcntl
with open(registry_path, 'r+') as f:
    fcntl.flock(f, fcntl.LOCK_EX)
    # ... read, modify, write ...
```

### 3. Best Score Calculation - Metric Direction

**Location:** Lines 400-415

**Problem:** `metric.higher_is_better` is used but never defined. Different metrics need different comparisons.

**Recommended fix:** Define metric metadata:
```python
METRIC_METADATA = {
    "r2": {"higher_is_better": True},
    "rmse": {"higher_is_better": False},
    "accuracy": {"higher_is_better": True},
    "mae": {"higher_is_better": False},
}
```

### 4. Summary Schema - Missing Critical Fields

**Location:** Lines 966-1043

**Missing data for dashboard use cases:**
- `task_types` distribution (regression vs classification counts)
- `date_range` (earliest/latest prediction timestamps)
- `metric_types` used across predictions
- `branch_counts` for branching pipeline analysis

---

## Antipatterns to Address

### 1. God Object: Run Manifest

**Location:** Lines 797-874

The proposed `run_manifest.yaml` contains too many responsibilities (metadata, templates, datasets, config, summary). This will cause:
- Large files slow to parse
- Frequent partial updates
- Merge conflicts in concurrent scenarios

**Recommended:** Split into normalized files:
```
workspace/runs/<run_id>/
├── run.yaml           # Core metadata only
├── templates.yaml     # Template references
├── datasets.yaml      # Dataset metadata
├── config.yaml        # Execution configuration
└── summary.yaml       # Updated post-execution
```

### 2. Duplicate Data Storage

**Location:** Lines 661-710

Dataset metadata stored in THREE places:
1. Per-run in `run_manifest.yaml`
2. Workspace-level in `datasets.yaml`
3. In the original dataset file

**Recommended:** Use reference-based design:
```yaml
# run_manifest.yaml - reference only
datasets:
  - ref: "ds_wheat_v1"  # Reference to registry
```

### 3. Synchronous Batch Loading (Frontend)

**Location:** Lines 1372-1409

The proposed frontend still accumulates ALL predictions before showing UI, defeating the summary optimization purpose.

**Recommended:** True lazy loading with virtual scrolling using `@tanstack/react-virtual` and `useInfiniteQuery`.

---

## Critical Bottlenecks Identified

### 1. Sequential Parquet Scanning

**Impact:** 600ms for 200 files (sequential) vs 80ms (concurrent) - 7.5x speedup possible

**Solution:** Use `ThreadPoolExecutor` for concurrent footer reads with mtime-based caching.

### 2. Hash Computation on Path Resolution

**Impact:** 50+ seconds for large workspaces scanning all CSV files

**Solution:** Multi-stage filtering:
1. Check original path (instant)
2. Size-based filtering (instant) - **requires storing `file_size` in manifest**
3. Quick hash (header+footer) filtering (fast)
4. Full hash verification (only 0-2 files)

**Critical:** Manifests MUST store `file_size` for this optimization.

### 3. Full DataFrame Sort for Top-K

**Impact:** O(n log n) for full sort vs O(n log k) for top-k selection

**Solution:** Use Polars `top_k()` method instead of `sort().head()`.

### 4. Summary Recomputation on Every Save

**Impact:** 5 seconds per save for 1M predictions

**Solution:** Maintain `IncrementalSummary` class using Welford's algorithm for running statistics and a min-heap for top-k tracking. Save becomes O(1) serialization instead of O(n) recomputation.

---

## Missing Considerations

### 1. Error Recovery Strategy

Not addressed:
- What happens if a run fails mid-execution?
- How to resume from last successful result?
- How to mark partial runs?

**Recommendation:** Add checkpoint system to manifests.

### 2. Concurrent Run Handling

Not addressed:
- Multiple runs on same dataset simultaneously?
- Locking/queuing for shared resources?
- Conflict resolution for parquet updates?

### 3. Backward Compatibility

Schema versions mentioned but no migration strategy:
- How to upgrade v1 manifests to v2?
- How to handle parquet files without embedded summaries?
- Graceful handling of missing fields?

---

## Priority Actions

### High Priority (Fix Before Implementation)

| Issue | Action |
|-------|--------|
| Template detection ambiguity | Use explicit `templates=` parameter |
| Race condition in registry | Add file locking |
| Duplicate data storage | Use reference-based design |
| Sequential parquet scanning | Add concurrent I/O |
| Store file_size in manifests | Required for path resolution optimization |

### Medium Priority (Address During Implementation)

| Issue | Action |
|-------|--------|
| Missing summary fields | Expand schema with task_types, date_range |
| God object manifest | Split into normalized files |
| Frontend batch loading | Implement virtual scrolling |
| Hash computation bottleneck | Size-filter first |

### Low Priority (Future Enhancement)

| Issue | Action |
|-------|--------|
| Content-addressable templates | Implement after core |
| Incremental summaries | Optimization pass |
| Run lineage tracking | Phase 2 feature |

---

## Conclusion

This design document provides a solid foundation for evolving the nirs4all ecosystem. The core concepts are well-defined and the identified gaps are real. With the corrections noted above, particularly around:

1. **Explicit multi-template syntax** (not inference)
2. **Reference-based data storage** (not duplication)
3. **File size storage** for path resolution
4. **Concurrent I/O** for parquet scanning
5. **Incremental statistics** for summary maintenance

...the implementation should proceed smoothly and result in a performant, maintainable system.

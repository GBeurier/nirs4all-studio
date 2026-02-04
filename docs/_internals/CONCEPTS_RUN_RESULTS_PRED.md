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

### Workspace Structure

All structured data is stored in a single DuckDB database. Binary artifacts are stored in a flat content-addressed directory.

```
workspace/
├── store.duckdb                        # All metadata, configs, logs, chains, predictions
│                                        # Tables: runs, pipelines, chains,
│                                        # predictions, prediction_arrays, artifacts, logs
│
├── artifacts/                           # Flat content-addressed binaries
│   ├── ab/abc123def456.joblib
│   └── cd/cde789012345.joblib
│
└── exports/                             # User-triggered exports (on demand)
```

### Dataset Discovery

Dataset metadata is stored in the `runs` table's `datasets` JSON column. When the webapp links a workspace, it queries the store:

```python
from nirs4all.pipeline.storage import WorkspaceStore

store = WorkspaceStore(workspace_path)

# List all runs with dataset metadata
runs = store.list_runs()

# Query predictions across datasets
top = store.top_predictions(n=10, metric="val_score")
```

#### Webapp Dataset States

| Status | Description | User Action |
|--------|-------------|-------------|
| `valid` | File exists, hash matches | None needed |
| `missing` | File not found at stored path | Update path |
| `hash_mismatch` | File found but content changed | Create new version or accept |

### DuckDB Tables

All data previously stored in YAML manifest files is now in DuckDB tables:

#### runs table
```sql
-- Each run is a row in the runs table
SELECT run_id, name, status, config, datasets, summary, created_at
FROM runs
WHERE status = 'completed';
```

The `config` column (JSON) stores run-level configuration (CV strategy, random seed, etc.).
The `datasets` column (JSON) stores full dataset metadata for each dataset used in the run.

#### pipelines table
```sql
-- Each expanded pipeline config is a row
SELECT pipeline_id, run_id, name, expanded_config, generator_choices,
       dataset_name, dataset_hash, best_val, best_test, metric
FROM pipelines
WHERE run_id = 'abc123';
```

#### chains table
```sql
-- Each preprocessing-to-model chain
SELECT chain_id, pipeline_id, steps, model_step_idx, model_class,
       preprocessings, fold_artifacts, shared_artifacts
FROM chains
WHERE pipeline_id = 'def456';
```

#### predictions table
```sql
-- Each prediction (model + fold + partition)
SELECT prediction_id, pipeline_id, chain_id, dataset_name,
       model_name, model_class, fold_id, partition,
       val_score, test_score, train_score
FROM predictions
WHERE dataset_name = 'wheat' AND partition = 'val'
ORDER BY val_score ASC
LIMIT 10;
```

---

## 8. Performance: DuckDB Store Queries

### Overview

With DuckDB-backed storage, all prediction queries are instant SQL operations on `store.duckdb`. No filesystem scanning, no Parquet file loading, no client-side aggregation.

```python
from nirs4all.pipeline.storage import WorkspaceStore

store = WorkspaceStore(workspace_path)

# Instant: top predictions across all datasets
top = store.top_predictions(n=10, metric="val_score")

# Instant: filtered query
preds = store.query_predictions(dataset_name="wheat", partition="val", limit=50)

# Instant: run listing
runs = store.list_runs(status="completed")
```

### Webapp Backend Integration

The webapp backend queries `store.duckdb` directly through `WorkspaceStore` methods:

```python
# api/workspace.py

from nirs4all.pipeline.storage import WorkspaceStore

@router.get("/workspaces/{workspace_id}/predictions/summary")
async def get_predictions_summary(workspace_id: str):
    """Instant prediction summary from DuckDB."""
    ws = workspace_manager._find_linked_workspace(workspace_id)
    store = WorkspaceStore(Path(ws.path) / "workspace")

    top = store.top_predictions(n=10, metric="val_score")
    runs = store.list_runs(status="completed")

    return {
        "top_predictions": top.to_dicts(),
        "runs": runs.to_dicts(),
    }

@router.get("/workspaces/{workspace_id}/predictions/data")
async def get_workspace_predictions_data(
    workspace_id: str, limit: int = 50, offset: int = 0,
    dataset: str | None = None, model: str | None = None,
    partition: str | None = None,
):
    """Paginated prediction query from DuckDB."""
    store = WorkspaceStore(Path(ws.path) / "workspace")
    preds = store.query_predictions(
        dataset_name=dataset, model_class=model,
        partition=partition, limit=limit, offset=offset,
    )
    return {"records": preds.to_dicts(), "total": len(preds)}
```

### Webapp Frontend

The frontend uses TanStack Query to call backend endpoints. All aggregation happens server-side in DuckDB:

```typescript
// src/pages/Predictions.tsx
const { data: summary } = useQuery({
  queryKey: ["predictions", "summary", workspaceId],
  queryFn: () => api.get(`/workspaces/${workspaceId}/predictions/summary`),
});

const { data: details } = useQuery({
  queryKey: ["predictions", "data", workspaceId, filters],
  queryFn: () => api.get(`/workspaces/${workspaceId}/predictions/data`, { params: filters }),
  enabled: showDetails,  // Lazy: only fetched when user drills in
});
```

### Performance

| Metric | Legacy (Parquet scan) | DuckDB Store |
|--------|----------------------|--------------|
| **Initial page load** | 2-5 seconds | **< 50ms** |
| **Dashboard stats** | Client-side aggregation | **Server-side SQL** |
| **Memory (browser)** | 10k+ records loaded | Summary only |
| **Filtered queries** | Full scan + client filter | **Indexed SQL** |
| **Network transfer** | ~500KB-2MB | **~5KB** (paginated) |

### Key Benefits

| Benefit | Description |
|---------|-------------|
| **Single source of truth** | All data in `store.duckdb`, no separate caches |
| **Always in sync** | Data written during training, no rebuild needed |
| **SQL queries** | Flexible filtering, sorting, aggregation |
| **Zero-copy Arrow** | DuckDB returns Polars DataFrames via Arrow transfer |
| **Indexed** | Key columns indexed for fast lookups |

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
| Pipeline Template | Recipe | Steps with optional generators | `library/templates/<id>.json` |
| Run | Experiment | Templates[] × Datasets[] → Results | `store.duckdb` (runs table) |
| Pipeline | Execution | 1 Dataset + 1 Config → Predictions | `store.duckdb` (pipelines table) |
| Prediction | Output | Model + Partition + Scores | `store.duckdb` (predictions table) |

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
| Run | ✅ Implemented | `WorkspaceStore.begin_run()` / `complete_run()` in `store.duckdb` |
| Pipeline | ✅ Implemented | `WorkspaceStore.begin_pipeline()` / `complete_pipeline()` in `store.duckdb` |
| Prediction | ✅ Implemented | Stored in `store.duckdb` predictions table with rich metadata |

### nirs4all_webapp (Current Implementation)

| Concept | Implemented? | Details |
|---------|--------------|---------|
| Run (UI types) | ⚠️ Partial | Types in `types/runs.ts` support multiple datasets, but not multiple templates |
| Run Discovery | ✅ Implemented | Queries `store.duckdb` runs table via `WorkspaceStore.list_runs()` |
| Results View | ❌ Not Implemented | No dedicated results page, mixed into runs |
| Predictions View | ✅ Implemented | Queries `store.duckdb` predictions table, displays well |

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

> **RESOLVED by DuckDB migration.** All structured data is now in `store.duckdb` with proper relational tables: `runs`, `pipelines`, `chains`, `predictions`. Run-level and pipeline-level grouping are first-class entities. See Section 7 for the current workspace structure.

---

## Gap #5: Webapp Reads Wrong Data Source

> **RESOLVED by DuckDB migration.** The webapp now queries `store.duckdb` via `WorkspaceStore.list_runs()` and `WorkspaceStore.query_predictions()`. Runs are first-class entities in the `runs` table with proper grouping. No more Parquet scanning or manifest file discovery.

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

> **PARTIALLY RESOLVED by DuckDB migration.** The `runs` table stores a `datasets` JSON column with dataset metadata (name, path, hash). The `predictions` table stores `dataset_name`, `n_samples`, `n_features` per prediction. Rich dataset metadata (wavelength range, y_stats) can be stored in the `runs.datasets` JSON field. The webapp queries this data directly from `store.duckdb` without needing separate discovery or registry files.

---

## Implementation Roadmap

> **Updated based on Design Review (2026-01-09)** - incorporates findings from code analysis comparing this design against actual implementations.

### Phase 0: Performance Optimization (Priority)

> **RESOLVED by DuckDB migration.** All performance concerns around Parquet scanning, client-side aggregation, and summary recomputation are eliminated by using DuckDB as the single storage backend. `WorkspaceStore.top_predictions()` and `WorkspaceStore.query_predictions()` return instant results via SQL queries with indexed columns. The webapp backend delegates all queries to `WorkspaceStore` methods. The frontend uses TanStack Query with server-side pagination.

---

### Phase 1: Library Changes (nirs4all)

> **PARTIALLY RESOLVED by DuckDB migration.** The Run entity is now implemented as a row in the `runs` table of `store.duckdb`, created by `WorkspaceStore.begin_run()`. Pipelines, chains, and predictions are stored in their respective tables with proper foreign key relationships. Manifest files (YAML) have been replaced entirely by DuckDB tables.

**Remaining items:**

#### 1.1 Template Preservation

1. **Save pipeline templates before expansion**
   - Modify `PipelineConfigs` to store `original_template` (deep copy before expansion)
   - Note: `generator_choices` is already preserved in `pipelines.generator_choices` JSON column

#### 1.2 Multiple Template Support

2. **Support multiple templates with explicit syntax**
   - Use explicit `templates=` parameter, NOT inference from list structure
   ```python
   nirs4all.run(
       templates=[template1, template2],  # Explicit key
       dataset=[...],
   )
   ```

#### 1.3 Dataset Metadata

3. **Capture rich dataset metadata in `runs.datasets` JSON**
   - Add `SpectroDataset.get_metadata()` method
   - Store in `runs.datasets` JSON column via `WorkspaceStore.begin_run()`

---

### Phase 2: Backend Changes (nirs4all_webapp)

> **PARTIALLY RESOLVED by DuckDB migration.** The webapp backend now queries `store.duckdb` via `WorkspaceStore` for all run, pipeline, and prediction data. No more Parquet scanning or manifest file discovery. The dual-path confusion (parquet vs manifest) is eliminated.

**Remaining items:**

#### 2.1 API Endpoints

1. **Ensure proper API endpoints use WorkspaceStore**
   ```
   GET /api/runs              → store.list_runs()
   GET /api/runs/:id          → store.get_run(run_id)
   GET /api/predictions       → store.query_predictions(**filters)
   GET /api/templates         → PipelineLibrary.list_templates()
   ```

#### 2.2 Dataset Management

2. **Dataset auto-discovery from store.duckdb**
   - Extract unique datasets from `runs.datasets` JSON and `predictions.dataset_name`
   - API endpoint: `POST /api/workspaces/:id/sync-datasets`

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

> **RESOLVED by DuckDB migration.** Legacy manifests and Parquet files are no longer used. The DuckDB schema is created automatically on first use. Old workspaces need to be re-run to populate the new `store.duckdb`.

---

### 🆕 Phase 5: Robustness (from review)

> **PARTIALLY RESOLVED by DuckDB migration.** Run and pipeline status tracking is now built into `store.duckdb`. `WorkspaceStore.begin_run()` creates a run with status "running", `complete_run()` marks it "completed", `fail_run()` marks it "failed". Similarly for pipelines. DuckDB's ACID properties handle concurrent writes.

#### 5.1 Error Recovery (remaining)

1. **Checkpoint / resume support**
   - Query `store.duckdb` for completed pipelines within a failed run
   - Resume from the last successful pipeline

#### 5.2 Concurrent Run Handling

3. **Resource locking**
   - Prevent conflicts when multiple runs access same dataset
   - Queue mechanism for shared resources
   - DuckDB handles concurrent writes with ACID transactions

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

| Component | File | Change | Status |
|-----------|------|--------|--------|
| **Phase 0: Performance** | | | |
| DuckDB store queries | `pipeline/storage/workspace_store.py` | `top_predictions()`, `query_predictions()` | DONE |
| Webapp summary endpoint | `api/workspace.py` | Delegate to `WorkspaceStore` | DONE |
| Virtual scrolling | `Predictions.tsx` | Use TanStack Query + server pagination | TODO |
| **Phase 1: nirs4all** | | | |
| Run entity | `pipeline/storage/workspace_store.py` | `begin_run()` / `complete_run()` | DONE |
| Pipeline entity | `pipeline/storage/workspace_store.py` | `begin_pipeline()` / `complete_pipeline()` | DONE |
| Save template | `pipeline_config.py` | Store `original_template` before expansion | TODO |
| Multiple templates | `api/run.py` | Use explicit `templates=` parameter | TODO |
| Dataset metadata | `data/dataset.py` | Add `get_metadata()` for `runs.datasets` JSON | TODO |
| **Phase 2: nirs4all_webapp** | | | |
| Backend queries | `api/workspace.py` | Use `WorkspaceStore` for all queries | DONE |
| API endpoints | `runs.py` | `store.list_runs()`, `store.get_run()` | DONE |
| Frontend types | `runs.ts` | Add `templates[]` to Run | TODO |
| Results page | `Results.tsx` (new) | Add results view | TODO |
| **Phase 3: Frontend** | | | |
| Runs page | `Runs.tsx` | Show templates per run | TODO |
| Run creation | `NewRun.tsx` | Select multiple templates | TODO |
| **Phase 4: Migration** | | | |
| DuckDB schema | Auto-created on first use | No migration needed | DONE |
| **Phase 5: Robustness** | | | |
| Run status tracking | `workspace_store.py` | `begin_run`/`complete_run`/`fail_run` | DONE |
| Resume support | `workspace_store.py` | Query completed pipelines in failed run | TODO |

---

# Design Review Notes

> **Reviewed:** 2026-01-09 | **Reviewer:** Claude Code Analysis

This section documents the results of an independent code review comparing this design document against the actual nirs4all and nirs4all_webapp implementations.

## Overall Assessment

**Verdict:** The design is **fundamentally sound** and correctly identifies the major architectural gaps. The concept hierarchy (Run → Pipeline → Prediction) is well-defined. Many gaps identified here have been **resolved by the DuckDB storage migration** (Phases 0, 4, 5 largely complete).

**Remaining refinements** are primarily around template preservation and multi-template support.

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

### Gap #5: "Webapp Reads Wrong Data Source" - RESOLVED

> **Resolved by DuckDB migration.** The webapp now has a single discovery path: query `store.duckdb` via `WorkspaceStore`. The dual-path confusion (parquet vs manifest) is eliminated.

---

### Gap #8: "Limited Dataset Metadata in Runs" - Partially Resolved

> **Partially resolved by DuckDB migration.** The `runs` table stores a `datasets` JSON column with dataset metadata. The `predictions` table stores `dataset_name`, `n_samples`, `n_features`. Rich metadata (y_stats, wavelength_range) can be added to the `runs.datasets` JSON field.

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

### 1. God Object: Run Manifest - RESOLVED

> **Resolved by DuckDB migration.** Data is now normalized across relational tables (`runs`, `pipelines`, `chains`, `predictions`, `artifacts`, `logs`). No single manifest file. Each table has a focused responsibility.

### 2. Duplicate Data Storage - RESOLVED

> **Resolved by DuckDB migration.** Dataset metadata stored once in `runs.datasets` JSON. Predictions reference datasets by `dataset_name`. No separate registry files needed.

### 3. Synchronous Batch Loading (Frontend)

**Location:** Lines 1372-1409

The proposed frontend still accumulates ALL predictions before showing UI, defeating the summary optimization purpose.

**Recommended:** True lazy loading with virtual scrolling using `@tanstack/react-virtual` and `useInfiniteQuery`.

---

## Critical Bottlenecks Identified

> **All bottlenecks RESOLVED by DuckDB migration:**
>
> 1. **Sequential Parquet Scanning** -- Eliminated. Single `store.duckdb` file with indexed SQL queries.
> 2. **Hash Computation on Path Resolution** -- Dataset info stored in `runs.datasets` JSON column.
> 3. **Full DataFrame Sort for Top-K** -- DuckDB uses `ORDER BY ... LIMIT` with efficient query planning.
> 4. **Summary Recomputation on Every Save** -- No summaries needed. Data is written once during training; queries are instant SQL.

---

## Missing Considerations

### 1. Error Recovery Strategy

> **Partially resolved.** `WorkspaceStore.fail_run()` and `fail_pipeline()` mark failed entities. Completed pipelines within a failed run are preserved in `store.duckdb`. Resume support (re-running only failed pipelines) is a remaining TODO.

### 2. Concurrent Run Handling

> **Partially resolved.** DuckDB provides ACID transactions, so concurrent writes to `store.duckdb` are safe. Resource locking for shared datasets during training remains a TODO.

### 3. Backward Compatibility

> **Resolved by clean break.** The DuckDB migration is a clean break from the legacy file-based storage. Old workspaces need to be re-run. No migration from v1 manifests/Parquet files.

---

## Priority Actions

### Remaining Priority Actions

| Priority | Issue | Action | Status |
|----------|-------|--------|--------|
| High | Template preservation | Save original template before expansion | TODO |
| High | Multi-template support | Explicit `templates=` parameter | TODO |
| Medium | Rich dataset metadata | `SpectroDataset.get_metadata()` for `runs.datasets` JSON | TODO |
| Medium | Frontend virtual scrolling | TanStack Query + server pagination | TODO |
| Medium | Results page | Dedicated results view in webapp | TODO |
| Low | Resume support | Re-run only failed pipelines | TODO |
| Low | Run lineage tracking | Template versioning | TODO |

> **Note:** Many previously high-priority items (Parquet scanning, manifest god object, duplicate data storage, race conditions) were **resolved by the DuckDB storage migration**.

---

## Conclusion

This design document provides a solid foundation for evolving the nirs4all ecosystem. The core concepts are well-defined and the identified gaps are real. The **DuckDB storage migration** resolved the majority of storage, performance, and data consistency issues:

1. **Single source of truth** -- All data in `store.duckdb` (no manifests, no Parquet files, no registry files)
2. **Relational data model** -- Runs, pipelines, chains, predictions in normalized tables
3. **Instant queries** -- SQL with indexes instead of filesystem scanning
4. **ACID transactions** -- Safe concurrent writes
5. **Content-addressed artifacts** -- Deduplication with ref_count garbage collection

**Remaining work** focuses on:
1. **Template preservation** before expansion
2. **Multi-template support** with explicit API syntax
3. **Rich dataset metadata** in `runs.datasets` JSON
4. **Frontend improvements** (virtual scrolling, results page)

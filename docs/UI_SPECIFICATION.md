# nirs4all Webapp - UI Specification Document

> **Document Purpose**: This document describes the current state of the nirs4all webapp UI.
> Use annotations (marked with `[TODO]`, `[CHANGE]`, `[REMOVE]`, `[ADD]`) to specify desired modifications.
> The goal is to evolve this into a proper specification through your feedback.

---

## Table of Contents

1. [Overview](#overview)
2. [Navigation Structure](#navigation-structure)
3. [Pages Description](#pages-description)
   - [Dashboard](#1-dashboard)
   - [Datasets](#2-datasets)
   - [Playground](#3-playground)
   - [Pipelines](#4-pipelines)
   - [Pipeline Editor](#5-pipeline-editor)
   - [Runs](#6-runs)
   - [New Experiment](#7-new-experiment)
   - [Results](#8-results)
   - [Predictions](#9-predictions)
   - [Analysis](#10-analysis)
   - [Settings](#11-settings)
4. [User Workflows](#user-workflows)
5. [UI Components](#ui-components)
6. [Known Issues](#known-issues)
7. [Your Annotations](#your-annotations)

---

## Overview

### Current Vision
The webapp is a desktop-first application for NIRS data analysis. It wraps the `nirs4all` Python library with a visual interface for:
- **Data Management**: Loading and organizing spectral datasets
- **Exploration**: Visualizing and preprocessing spectra interactively
- **Pipeline Building**: Creating ML pipelines visually (drag-and-drop)
- **Training**: Running experiments with multiple datasets and pipelines
- **Analysis**: Viewing results, predictions, and model comparisons

### Current Tech Stack
| Layer | Technology |
|-------|------------|
| Frontend | React 19 + TypeScript + Vite |
| UI Library | Tailwind CSS + shadcn/ui |
| State | TanStack Query (API) + Local State |
| Backend | FastAPI + nirs4all Python library |
| Desktop | PyWebView (optional) |

<!--
[ANNOTATION SPACE]
What is the core problem the webapp should solve?
Who is the primary user? (researcher, technician, data scientist?)
What is the main workflow you envision?
-->

---

## Navigation Structure

### Current Sidebar Organization

```
┌──────────────────────────┐
│       NIRS4ALL           │
│       NIRS Analysis      │
├──────────────────────────┤
│ MAIN                     │
│   📊 Dashboard           │
│   💾 Datasets            │
│   🧪 Playground          │
├──────────────────────────┤
│ WORKFLOW                 │
│   🔀 Pipelines           │
│   ➕ New Pipeline        │
│   ▶️ Runs                │
├──────────────────────────┤
│ ANALYSIS                 │
│   📈 Results             │
│   🎯 Predictions         │
│   🧫 Analysis            │
├──────────────────────────┤
│   ⚙️ Settings            │
└──────────────────────────┘
```

### Page Routes
| Route | Page | Purpose |
|-------|------|---------|
| `/` | Dashboard | Entry point, overview |
| `/datasets` | Datasets | Manage spectral data |
| `/playground` | Playground | Explore & preprocess interactively |
| `/pipelines` | Pipelines | Pipeline library |
| `/pipelines/new` | Pipeline Editor | Create new pipeline |
| `/pipelines/:id` | Pipeline Editor | Edit existing pipeline |
| `/runs` | Runs | View running/completed experiments |
| `/runs/new` | New Experiment | Launch new experiment wizard |
| `/results` | Results | Aggregated metrics |
| `/predictions` | Predictions | Individual prediction records |
| `/analysis` | Analysis | Advanced analysis tools |
| `/settings` | Settings | App configuration |

<!--
[ANNOTATION SPACE]
Exerything's good for now
-->

---

## Pages Description

### 1. Dashboard

**Current Purpose**: Welcome screen showing overview statistics and quick actions.

**Current Features**:
- Welcome header with "nirs4all" branding
- **Stats Cards**: 4 cards showing:
  - Datasets (linked count)
  - Pipelines (saved count)
  - Experiments (completed count)
  - Avg. R² (best models metric)
- **Quick Actions**: 4 buttons linking to:
  - Load Dataset → `/datasets`
  - Build Pipeline → `/pipelines/new`
  - Playground → `/playground`
  - View Results → `/results`
- **Recent Experiments**: List of 3 most recent runs with status/metrics

**Current Behavior**:
- Loads data from API on mount
- Shows loading skeletons while fetching
- Shows empty state if no experiments yet

<!--
[ANNOTATION SPACE]
    Avg R² is useless
    Load dataset in dev mode should allow to open a synthetic regression and a synthetic classification dataset (250, 2500), generated with nirs4all synthesis tools and with repetitions, metadata etc.
-->

---

### 2. Datasets

**Current Purpose**: Manage spectral datasets linked to the workspace.

**Current Features**:
- **Header**: Title + "Groups" button + "Add Dataset" button
- **Stats Row**: 4 cards showing Total Datasets, Total Samples, Avg Features, Groups
- **Search & Filter Bar**:
  - Text search
  - Filter by group
  - Grid/List view toggle
  - Refresh button
- **Dataset Cards/List**: Each dataset shows:
  - Name, path
  - Number of samples/features
  - Target variable (if detected)
  - Group assignment (badge)
  - Actions: Preview, Edit, Delete, Refresh
- **Modals**:
  - Add Dataset: Browse for folder path
  - Edit Dataset: Configure column mappings, target, etc.
  - Groups: Create/rename/delete groups, manage dataset assignments

**Current Behavior**:
- Datasets are "linked" (not copied) from filesystem
- Config stored in workspace metadata
- Groups allow organizing datasets by project/type

<!--
[ANNOTATION SPACE]
Add dataset modal should be transformed in complex wizard to handle the complexity of nirs4all loading data capabilities (look the nirs4all rtd)
Dataset should be versionned (with a hash). A user can refresh a dataset (in case of new data) or relink it (when changing machine or folder, etc.)
Dataset can have multiple targets, but when executing pipeline it's possible to use just one.
Also in pipeline editor, a dataset can be chosen (temporarily) to allow presizing of fits based on real data (sample count and feature count in particular)
-->

---

### 3. Playground

**Current Purpose**: Interactive exploration and preprocessing of spectral data.

**Current Features**:
- **Sidebar (Left)**:
  - Data source selector (File, Demo, Workspace dataset)
  - Operator palette (preprocessing, splitting, filter operators)
  - Active pipeline (list of applied operators)
  - Undo/Redo controls
  - Export options (to Pipeline Editor, JSON, CSV)
- **Main Canvas (Center/Right)**:
  - **Visualizations**:
    - Spectra chart (raw and/or processed)
    - Y-value histogram
    - PCA/UMAP scatter plots
    - Fold distribution (when splitter applied)
    - Repetitions distances
  - **Controls**:
    - Step comparison slider (see intermediate states)
    - Chart toolbar (zoom, reset, export)
    - Sample selection tools

**Current Behavior**:
- Operators applied via backend (`/api/playground/execute`)
- Real-time updates with debouncing
- Can export pipeline to Pipeline Editor
- Can import pipeline from Pipeline Editor
- Supports Kennard-Stone, SPXY, and other splitters

**Visualizations Available**:
| Chart | Description |
|-------|-------------|
| SpectraChart | Line chart of spectra (all or subset) |
| YHistogram | Distribution of target values |
| PCAPlot | 2D/3D PCA scatter |
| DimensionReductionChart | UMAP visualization |
| FoldDistributionChart | Samples colored by fold |
| ScatterPlot3D | 3D interactive scatter |

<!--
[ANNOTATION SPACE]
- Pipeline (if compatible - no branchings) can be imported/exported between pipeline editor and playground (if models exists, they are just removed in playground)
- The core of this is the easy interactions with data. It means, optimization of dataviz, UX for interactions, clear intent in menus and choice.

Each view has specifities but all the view are connected to the same selection model. A selection in a view select in all views. Selection can be multiple.

DEtails on views:
- Spectra: can be seen before and after. Before is by defaut raw but can be any step in the pipeline. After is the last step active. Spectra can display one or the other or both (check).
Spectra should have many mode of visualization (described in docs I think): with quantile area, selected, median, median per quantile, per group, per metadata column, etc.... and colored by y / metadata / partitions, selection, outliers, etc. The spectra should have a complex popup settings for choice of visualization
- target is an histogram that disaply Y in many ways. It can also disaply folds and partitions, color by metadata, etc. Same as spectra.
- PCA/UMP display the projection of either before/after/both in PCA(99.9) or UMAP. User can choose the components visibles (2 in 2D view, 3 in 3D view). Coloring and display is the same as others (selected, metadata, y, outliers, etc.)
- Fold is stacked bar plot or bar plot or ridged that shows paritions train/test/val/fold_val/fold_train etc.... Coloration same as others. No before after, just the result of the split
- Difference; for dataset with repetition, the diff repetition is a scatter plot to display distance between repetitions. X = index of sample. Y a point per repetitions depending on distance to a reference (one rep, mean, median, global mean, from PCA, etc.) with a given metric (euclidian, malahanobis....) The idea here is to have a powerful tool to explore variability between repetition. And if it's easy UX speaking, between samples.
-->

---

### 4. Pipelines

**Current Purpose**: Library of saved pipelines (presets and user-created).

**Current Features**:
- **Header**: Title, stats, Import button, New Pipeline button
- **Toolbar**:
  - Search input
  - Tabs: All, Favorites, My Pipelines, Presets, History
  - Sort dropdown (Last Modified, Name, Most Runs, Most Steps)
  - Grid/List view toggle
- **Pipeline Cards**: Each shows:
  - Name, description/summary
  - Step count by type (preprocessing, splitting, model)
  - Tags (if any)
  - Favorite star
  - Actions: Edit, Duplicate, Delete, Export
- **Preset Selector**: Grid of template pipelines

**Current Behavior**:
- Pipelines stored in workspace
- Can mark favorites
- Can import/export JSON
- Creating from preset clones it

<!--
[ANNOTATION SPACE]
    The idea here is to display presets, favorites and save pipeline to use in editor or directly.
    The list can be shown also to show all pipelines created (before generations not all generated pipelines)
-->

---

### 5. Pipeline Editor

**Current Purpose**: Visual pipeline construction (drag-and-drop).

**Current Features**:
- **Header Toolbar**:
  - Back button, Pipeline name (editable)
  - Step type badges (preprocessing, splitting, model counts)
  - Variant count (how many pipeline combinations)
  - Unsaved indicator
  - Undo/Redo
  - Settings popover (global seed)
  - Keyboard shortcuts button
  - Command palette button
  - Favorite toggle
  - More actions menu (Export JSON, Import, Load samples, Clear)
  - Save button
  - "Use in Experiment" button
- **Left Panel (Step Palette)**:
  - Searchable list of available operators
  - Grouped by category (Preprocessing, Splitting, Models, etc.)
  - Drag to add to pipeline
- **Center Panel (Pipeline Tree)**:
  - Visual representation of pipeline structure
  - Supports linear sequences
  - Supports branches (alternatives, parallel paths)
  - Supports generators (_or_, _range_, _log_range_)
  - Drop zones for reordering
  - Select step to configure
- **Right Panel (Configuration)**:
  - Selected step's parameters
  - Type-specific renderers
  - Parameter sweeps (ranges, alternatives)
  - Validation messages

**Current Behavior**:
- Keyboard navigation (Tab between panels)
- Command palette (Ctrl+K)
- Undo/Redo history
- Persists state locally
- Can load sample pipelines
- Exports to nirs4all format

**Advanced Features**:
- Branches: Parallel preprocessing paths
- Generators: Parameter sweeps (_range_, _or_)
- Merge: Combine branch outputs (stacking)
- Variant counting: Shows total pipeline combinations

<!--
[ANNOTATION SPACE]
Pipeline Editor:
    The operator list is incomplete and not valid totally. All operators should be take from a list of possible operators defining editable params and their default values and potentially ranges. For models or other complex note, the definition should also include possible finetuning parameters and their default values, complete finetuning presets, etc.
    Also there many redondant component which should be factorized. Some div are useless and a little UI polish can be done.
-->

---

### 6. Runs

**Current Purpose**: Track and manage experiment executions.

**Current Features**:
- **Header**: Title + "New Run" button
- **Stats Row**: 5 cards (Running, Queued, Completed, Failed, Total Pipelines)
- **Search Input**
- **Run Cards**: Expandable cards showing:
  - Run name, status icon
  - Dataset count, pipeline count, model count
  - Started time, duration
  - Actions: Pause, Stop (if running), View Results, Retry (if failed)
  - **Expanded View**:
    - Per-dataset breakdown
    - Per-pipeline progress bars
    - Metrics (R², RMSE) when complete
    - Error messages when failed

**Current Behavior**:
- Currently uses mock data
- Hierarchical view: Run → Datasets → Pipelines
- Real-time progress (when connected)

<!--
[ANNOTATION SPACE]
Metrics should be adapted to problem (classif / reg)
The current mini foldable dashboard on a run is fundamental and should be enhanced.
-->

---

### 7. New Experiment

**Current Purpose**: Wizard to configure and launch a new experiment.

**Current Features**:
- **Step Indicator**: 4-step progress bar
  1. Select Datasets
  2. Select Pipelines
  3. Configure
  4. Launch
- **Step 1 (Datasets)**:
  - Search input
  - Checkable list of linked datasets
  - Shows samples, features, target per dataset
- **Step 2 (Pipelines)**:
  - Search input
  - Filter (All, Favorites, Presets)
  - Checkable list of pipelines
  - Shows step summary per pipeline
- **Step 3 (Configure)**:
  - Experiment name (required)
  - Description (optional)
  - CV strategy dropdown
  - Number of folds
  - Shuffle toggle
  - Summary card (total runs = datasets × pipelines)
- **Step 4 (Launch)**:
  - Confirmation view
  - Launch button

**Current Behavior**:
- Wizard flow with Back/Next navigation
- Validates each step before proceeding
- Currently uses mock data

<!--
[ANNOTATION SPACE]
New Experiment:
- Is 4 steps too many?
- Should datasets and pipelines be combined?
- What configuration options are missing?
- Should CV be per-pipeline or experiment-wide?
-->

---

### 8. Results

**Current Purpose**: View aggregated model performance metrics.

**Current Features**:
- **Header**: Title + Export button
- **Filters**: Search, Group by dropdown, Filters button
- **Metrics Summary**: 5 cards (R², RMSE, MAE, RPD, nRMSE)
- **Empty State**: Placeholder waiting for completed runs

**Current Behavior**:
- Currently skeleton/empty state only
- Designed to show aggregated metrics across experiments

<!--
[ANNOTATION SPACE]
Results:
- What should the results view actually show?
- Should it be a comparison table? Charts? Both?
- What grouping makes sense? (by dataset, model, pipeline?)
- What export formats are needed?
-->

---

### 9. Predictions

**Current Purpose**: Browse individual prediction records.

**Current Features**:
- **Header**: Title + Export + Delete buttons
- **Filters**: Search, Filters button
- **Stats**: 4 cards (Total Predictions, Datasets, Models, Pipelines)
- **Empty State**: Placeholder

**Current Behavior**:
- Currently skeleton/empty state only
- Designed to show sample-level predictions

<!--
[ANNOTATION SPACE]
Predictions:
- Is this page needed?
- Should it be merged with Results?
- What per-sample information is useful?
- Should it show prediction plots (measured vs predicted)?
-->

---

### 10. Analysis

**Current Purpose**: Advanced analysis tools for spectral data.

**Current Features**:
- **Header**: Title
- **Tool Cards**: Grid of 4 analysis tools:
  - PCA Analysis (available)
  - Variable Importance (available)
  - Model Comparison (available)
  - Residual Analysis (beta)
- **Quick Start**: Explanation card
- **Empty State**: Requires completed runs

**Current Behavior**:
- Tool cards are clickable but tools not fully implemented
- Designed as entry point to advanced analyses

<!--
[ANNOTATION SPACE]
This feature is for now optionnal, we'll discuss details later.
Analysis:
- Are these the right analysis tools?
- Should PCA/UMAP be here or in Playground? > BOTH
- What else is needed? (outlier detection? SHAP? wavelength selection?)
- Should this page exist separately?
-->

---

### 11. Settings

**Current Purpose**: Application configuration.

**Current Features**:
- **Workspace Card**:
  - Path input (read-only)
  - Browse button
  - Status indicator
- **Appearance Card**:
  - Theme toggle (Light, Dark, System)
- **Advanced Card**:
  - Backend URL (disabled)
  - Clear Cache button
  - Reset to Defaults button
- **App Info**: Version and copyright

**Current Behavior**:
- Theme persisted to localStorage
- Workspace selection via native dialog

<!--
[ANNOTATION SPACE]
Settings:
- Should this be merged with Dashboard?
- What settings are actually needed?
- Should there be per-workspace settings?
- Is theme selection important?
-->

---

## User Workflows

### Current Implied Workflow

```
1. Set Workspace (Settings or first-run)
           ↓
2. Link Datasets (Datasets page)
           ↓
3. Explore Data (Playground) ←─────┐
           ↓                       │
4. Build Pipeline (Pipeline Editor)│
           ↓                       │
5. Run Experiment (Runs/New)       │
           ↓                       │
6. View Results (Results)          │
           ↓                       │
7. Refine Pipeline ────────────────┘
```

### Alternative Workflow A: Quick Exploration
```
1. Load Demo Data (Playground)
2. Try operators interactively
3. Export to Pipeline Editor
4. Save pipeline
```

### Alternative Workflow B: Batch Training
```
1. Link multiple datasets
2. Select multiple pipelines (or presets)
3. Run experiment
4. Compare results
```

<!--
[ANNOTATION SPACE]
Workflows:
- What is the PRIMARY workflow you want?
- Should there be a "guided" first-time experience?
- What's the balance between exploration and production?
- Are there workflows you want that don't exist?
-->

---

## UI Components

### Design Language
- **Glass morphism**: Cards with blur effects
- **Teal/Cyan accent**: Primary color theme
- **Dark/Light modes**: Full support
- **Animations**: Framer Motion transitions

### Shared Components
| Component | Usage |
|-----------|-------|
| Card | Container for content sections |
| Button | Actions (primary, secondary, ghost) |
| Input | Text fields |
| Select | Dropdowns |
| Badge | Status indicators, tags |
| Tooltip | Hover help |
| Dialog/Sheet | Modals and slide-overs |
| Tabs | Content switching |
| Collapsible | Expandable sections |

<!--
[ANNOTATION SPACE]
UI:
- Is the visual style appropriate?
- Are there usability issues?
- Should there be more guidance/help?
- Are there accessibility concerns?
-->

---

## Known Issues

From your Roadmap.md:

| Area | Issue |
|------|-------|
| Dashboard | "Think it as settings more than dashboard or simply remove" |
| Settings | "Configure correctly workspace" / "Add space occupied" |
| Pipeline Builder | "REFACTOR - LOT OF REDUNDANCIES" |
| Pipeline Builder | "Extend generators to match all in nirs4all" |
| Pipeline Builder | "Seed is misplaced" |
| Playground | "Operators all over (augmentations in preprocessing)" |
| Playground | "Refresh crash when option is empty" |
| Pipelines | "Update to see saved/presets/etc." |
| Global | "Add locales (fr, de, en, ci)" |

---

## Your Annotations

Use this section to add your overall vision and priorities.

### Vision Statement
<!-- What should this app BE? What feeling should users have? -->
```
[YOUR VISION HERE]


```

### Priority Changes
<!-- What are the TOP 3 changes you want? -->
```
1. [CHANGE 1]

2. [CHANGE 2]

3. [CHANGE 3]
```

### Pages to Remove/Merge
<!-- Which pages don't add value? -->
```
[YOUR INPUT]


```

### Missing Features
<!-- What's critically missing? -->
```
[YOUR INPUT]


```

### Target User
<!-- Who is this for? -->
```
[YOUR INPUT]


```

### Workflow Simplification
<!-- How should the main workflow feel? -->
```
[YOUR INPUT]


```

---

## Next Steps

1. **Review this document** and add annotations where indicated
2. **Mark with `[TODO]`** anything that needs discussion
3. **Mark with `[REMOVE]`** anything that should be deleted
4. **Mark with `[CHANGE: ...]`** anything that needs modification
5. **Mark with `[ADD: ...]`** anything missing
6. Once annotated, we can produce a proper specification

---

*Document generated: 2026-01-06*
*Based on codebase analysis of nirs4all_webapp*

# Pipeline Editor Page

The Pipeline Editor is the visual drag-and-drop builder for creating and editing analysis pipelines. It uses a three-panel layout to give you simultaneous access to the step palette, the pipeline structure, and step configuration.

```{figure} ../_images/pipelines/pe-overview.png
:alt: Pipeline Editor overview
:width: 100%

The Pipeline Editor showing the Step Palette (left), Pipeline Tree (center), and Configuration Panel (right).
```

---

## Toolbar

The toolbar runs across the top of the editor.

| Control | Description |
|---------|-------------|
| **Back link** | Returns to the Pipelines page. |
| **Pipeline name** | Editable text input for the pipeline name. |
| **Save** | Saves the current pipeline to the workspace. Disabled when there are no unsaved changes. |
| **Undo / Redo** | Step-level undo and redo for all editing actions. |
| **Variant count badge** | Displays the total number of pipeline variants that generators will produce. Color-coded: green (low), amber (moderate), red (high). |
| **Favorite toggle** | Star icon to mark the pipeline as a favorite. |
| **Use in Experiment** | Navigates to the {doc}`experiment-wizard` with this pipeline pre-selected. |
| **More menu** | Dropdown with additional actions: Load Sample, Import, Export (JSON/YAML), Delete, Keyboard Shortcuts, Dataset Binding. |

---

## Step Palette (left panel)

The left panel lists all available pipeline nodes organized by category. Drag a node from the palette onto the Pipeline Tree to add it.

| Category | Contents |
|----------|----------|
| **NIRS Core** | SNV, MSC, EMSC, Detrend, SavitzkyGolay, FirstDerivative, SecondDerivative |
| **Baseline** | BaselineCorrection, ASLSBaseline, AirPLS, ArPLS, SNIP, RollingBall, ModPoly, IModPoly |
| **Scaling** | StandardScaler, MinMaxScaler, RobustScaler, MaxAbsScaler |
| **Derivatives** | SavitzkyGolay, FirstDerivative, SecondDerivative |
| **Filters** | YOutlierFilter, XOutlierFilter, SpectralQualityFilter, HighLeverageFilter, MetadataFilter |
| **Splitting** | KFold, StratifiedKFold, RepeatedKFold, ShuffleSplit, LeaveOneOut, GroupKFold, KennardStone, SPXY, and more |
| **Models** | PLSRegression, Ridge, Lasso, ElasticNet, SVR, SVC, RandomForest, XGBoost, LightGBM, CNN1D, LSTM, Transformer, and more |
| **Augmentation** | GaussianAdditiveNoise, MultiplicativeNoise, BaselineShift, WavelengthShift, and more |
| **Branching** | ParallelBranch, SourceBranch |
| **Merge** | MergePredictions, MergeSources |
| **Generators** | ChooseOne (`_or_`), Cartesian (`_cartesian_`), Range (`_range_`) |
| **Y Processing** | Target scaling transforms (StandardScaler, MinMaxScaler applied to y) |

Each palette item shows its name, a brief description, and a category color badge. A search input at the top of the palette filters nodes by name or tag.

---

## Pipeline Tree (center panel)

The center panel displays the pipeline as a visual tree structure. Steps are shown as connected nodes from top to bottom.

| Feature | Description |
|---------|-------------|
| **Tree layout** | Steps appear as nodes connected by vertical lines. Branch nodes expand horizontally to show parallel paths. |
| **Drag to reorder** | Drag a step node up or down to change its position in the sequence. |
| **Click to select** | Clicking a node selects it and opens its configuration in the right panel. |
| **Context menu** | Right-click a node to access: Duplicate, Delete, Move Up, Move Down, Wrap in Generator. |
| **Drop zones** | When dragging from the palette, highlighted drop zones appear between existing steps to indicate valid insertion points. |
| **Generator badges** | Nodes inside a generator (`_or_`, `_range_`, `_cartesian_`) show a badge indicating the generator type and variant count. |
| **Validation indicators** | Warning and error icons appear on nodes that have validation issues (e.g., missing required parameters, invalid combinations). |

---

## Configuration Panel (right panel)

When a step is selected in the tree, the right panel shows its editable parameters.

| Element | Description |
|---------|-------------|
| **Node name and type** | Header showing the selected node's name, category badge, and source (nirs4all, sklearn, etc.). |
| **Parameters** | Type-specific controls for each parameter: number inputs, dropdowns, toggles, text fields. |
| **Sweep toggles** | Parameters marked as sweepable show a sweep icon. Clicking it configures a parameter sweep (range or discrete values). |
| **Advanced section** | Some nodes have advanced parameters collapsed by default. Expand to access them. |
| **Finetune toggle** | Parameters marked as finetunable show an Optuna icon. Enables hyperparameter optimization for that parameter during training. |
| **Description** | Each parameter shows its description on hover or below the input. |

---

## Validation

The editor performs real-time validation and displays feedback inline:

| Rule | Severity | Message |
|------|----------|---------|
| Pipeline must contain at least one model | Error | No model step found in the pipeline. |
| Pipeline must contain a splitter | Warning | No cross-validation splitter found. |
| Merge requires a preceding branch | Error | Merge step has no corresponding branch. |
| Generator must contain at least two items | Warning | Generator contains fewer than 2 variants. |
| Duplicate step types | Warning | Multiple steps of the same type detected. |
| Parameter out of range | Error | Value is outside the allowed range. |

Errors prevent saving; warnings allow saving but are highlighted.

---

## Finetuning overlay

When a pipeline contains finetunable parameters, the **Finetuning** panel (accessible from the toolbar or a dedicated button) shows a summary of all parameters configured for Optuna optimization, with their search ranges and distributions.

---

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+S` | Save pipeline |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `Delete` | Delete selected step |
| `Ctrl+D` | Duplicate selected step |
| `Ctrl+K` | Open command palette |

:::{seealso}
- {doc}`node-catalog` -- Detailed reference for every pipeline node
- {doc}`pipelines-page` -- Managing saved pipelines
- {doc}`experiment-wizard` -- Launching experiments with pipelines
:::

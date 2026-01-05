# Pipeline Editor Feature Analysis

**Author:** Steve, Head Developer @ Spectral-AI
**Date:** January 2026
**Status:** Internal Technical Document
**Version:** 1.5

---

## Changelog

### v1.6 (January 2026)
- **Phase 6 Implementation Completed** ✅
  - Backend API Integration with full nirs4all execution support:
    - `POST /pipelines/{id}/execute` endpoint for running pipelines as background jobs
    - WebSocket-based real-time progress updates via job channels
    - Complete pipeline serialization from frontend JSON to nirs4all format
    - `build_full_pipeline()` function handling generators, finetuning, y_processing
  - Enhanced `nirs4all_adapter.py` with comprehensive serialization:
    - `_build_generator_sweep()` - Convert sweep configs to `_range_`, `_log_range_`, `_or_`
    - `_build_finetuning_params()` - Convert to Optuna `finetune_params` format
    - `_build_y_processing()` - Convert y_processing config to scaler instances
    - `export_pipeline_to_python()` - Generate executable Python code with imports
    - `export_pipeline_to_yaml()` - Generate YAML configuration files
    - `import_pipeline_from_yaml()` - Parse YAML back to pipeline config
  - Export capabilities (Python, YAML, JSON):
    - `POST /pipelines/{id}/export` endpoint with format selection
    - Download/copy helpers for each format
    - JSON export with full pipeline state preservation
  - New frontend hooks (`usePipelineExecution.ts`):
    - `usePipelineExecution()` - Execute pipeline, track progress via WebSocket
    - `usePipelineExport()` - Export pipeline with download/copy helpers
    - `useDatasetSelection()` - Fetch available datasets for execution
    - `usePipelineValidation()` - Pre-execution validation
  - `PipelineExecutionDialog.tsx` - Complete execution UI component:
    - Dataset selection with path display
    - Real-time progress bar with percentage
    - Results display (best score, RMSE, R², model path)
    - Top results table with fold-level metrics
    - Export panel with Python/YAML/JSON format options
    - Status badges and WebSocket connection indicator
    - Animated state transitions with framer-motion
  - `HelpSystem.tsx` - Inline documentation and help system:
    - `HelpTooltip` - Simple inline tooltips
    - `ParameterHelp` - Parameter-specific help with type, range, tips
    - `OperatorHelpCard` - Full operator documentation cards
    - `WhatsThisButton` - Toggle "What's This?" help mode
    - `OperatorHelpPanel` - Floating help panel for clicked operators
    - `InfoCallout` - Contextual tip/warning callouts
    - `HelpModeProvider` / `useHelpMode` - Context for help mode state
    - `getOperatorHelp()` - Lookup help content for operators
    - Pre-populated help database for common operators (SNV, MSC, SavitzkyGolay, PLSRegression, KFold, KennardStoneSplitter)
  - Updated component exports in `index.ts` for all Phase 6 components

### v1.5 (January 2026)
- **Phase 5 Implementation Completed** ✅
  - `useKeyboardNavigation.ts` hook with comprehensive keyboard support:
    - Arrow key navigation (↑/↓) between steps in flattened tree order
    - Branch navigation (←/→) to enter/exit nested branch structures
    - Tab cycling between panels (Palette → Tree → Config → Palette...)
    - Quick action shortcuts (Ctrl+D duplicate, Delete remove, Ctrl+Z undo, etc.)
    - Command palette activation (Ctrl+K)
    - Shortcuts help toggle (Ctrl+/)
    - Panel focus state management with refs
    - Exported utilities: `KEYBOARD_SHORTCUTS` constant, `formatShortcut()` function
  - `CommandPalette.tsx` with VS Code-inspired quick actions:
    - Search-as-you-type filtering across all actions
    - Step actions: Configure, Duplicate, Delete, Move Up/Down
    - Navigation: Jump to any step by name
    - Pipeline actions: Save, Export, Favorite, Run
    - Add step shortcuts: Quick access to all step types
    - Finetuning/sweep quick enable
    - Keyboard shortcut hints in menu items
    - Categorized command groups
  - `KeyboardShortcutsDialog.tsx` with complete shortcut reference:
    - Navigation shortcuts (arrows, Tab, Enter, Escape)
    - Panel focus shortcuts (Tab cycling)
    - Editing shortcuts (Duplicate, Delete)
    - Action shortcuts (Save, Export, Command Palette)
    - Platform-aware key labels (Cmd vs Ctrl)
    - Pro tips section for power users
    - Categorized display with visual key styling
  - `ExecutionPreviewPanel.tsx` with pipeline complexity analysis:
    - Total fits calculation: sweeps × trials × cv folds
    - Severity-based color coding (green → red as complexity increases)
    - Time estimation with human-readable formatting
    - Breakdown display with collapsible details
    - Optimization suggestions generator:
      - Reduce sweep variants
      - Lower finetuning trials
      - Use fewer CV folds
      - Consider random sampling
    - Compact inline version (`ExecutionPreviewCompact`) for header use
    - Warning indicators for high-complexity pipelines
  - `FocusIndicator.tsx` with visual panel focus feedback:
    - `FocusPanelRing` - Animated ring indicator for focused panels
    - `FocusBadge` - Badge showing current panel name
    - `NavigationHint` - Context-aware hint text
    - `NavigationStatusBar` - Complete status bar component
    - `StepNavigationHighlight` - Step highlight animation
    - Color-coded by panel (blue=palette, emerald=tree, purple=config)
    - Smooth enter/exit animations with framer-motion
  - Integrated all Phase 5 components into `PipelineEditor.tsx`:
    - Command palette wired to pipeline actions
    - Keyboard shortcuts dialog accessible from header
    - Focus panel rings on all three panels
    - Navigation status bar in footer
    - Execution preview compact in header badges
    - Keyboard navigation hook connected to step management
  - Updated `index.ts` exports for all new Phase 5 components

### v1.4 (January 2026)
- **Phase 4 Implementation Completed** ✅
  - `YProcessingPanel.tsx` with complete target variable processing UI:
    - `YProcessingPanel` - Main panel with scaler selection and parameter configuration
    - `YProcessingCompact` - Compact inline version for quick display
    - `YProcessingBadge` - Visual indicator for pipeline tree
    - `YProcessingQuickSetup` - One-click y-processing enablement
    - 7 scaler options: MinMaxScaler, StandardScaler, RobustScaler, PowerTransformer, QuantileTransformer, IntegerKBinsDiscretizer, RangeDiscretizer
    - Parameter-aware editors with contextual descriptions
    - Recommendations per scaler type
    - Amber (🟠) color scheme
  - `FeatureAugmentationPanel.tsx` with multi-channel preprocessing:
    - `FeatureAugmentationPanel` - Main panel for configuring augmentation
    - `FeatureAugmentationCompact` - Compact variant
    - `FeatureAugmentationBadge` - Pipeline tree indicator
    - `AddTransformDialog` - Dialog for adding transforms
    - `TransformItem` - Individual transform with params
    - Action modes: extend (add independent channels), add (chain keeping originals), replace (chain discarding originals)
    - Transform list with enable/disable toggles
    - Output shape preview showing channel count
    - Presets: NIRS Standard, Scatter Variants, Derivative Comparison, Smoothing Levels
    - Indigo (🟣) color scheme
  - `StackingPanel.tsx` with MetaModel stacking ensemble UI:
    - `StackingPanel` - Main panel for configuring stacking
    - `StackingBadge` - Visual indicator
    - `MergeStackingSetup` - Quick setup from merge step
    - `StackingDiagram` - Visual flow diagram (Base Models → OOF → MetaModel)
    - 7 meta-model options: Ridge, Lasso, ElasticNet, PLSRegression, RandomForest, XGBoost, SVR
    - Source model selection (use all or select specific)
    - Coverage strategies: drop samples, fill with value, model prediction
    - Passthrough option for original features
    - Pink (🩷) color scheme
  - `BranchEnhancements.tsx` with improved branch visualization:
    - `EnhancedBranchHeader` - Branch header with naming and collapse
    - `BranchSummary` - Branch statistics display
    - `BranchOutputIndicator` - Output type indicator
    - `CollapsibleBranchContainer` - Collapsible branch wrapper
    - `AddBranchButton` - Add new branch action
    - `CollapseAllButton` - Collapse all branches action
    - Branch naming with inline editing
    - Per-branch variant count display
    - Collapse/expand with state persistence
    - Cyan/Orange color scheme for branch types
  - Integrated new panels into `StepConfigPanel.tsx`:
    - Specialized Y-Processing step content with YProcessingPanel
    - Merge step content with tabs for merge config + stacking
    - Stacking CTA (call-to-action) in merge step for discoverability

### v1.3 (January 2026)
- **Phase 3 Implementation Completed** ✅
  - `FinetuneConfig.tsx` with complete Optuna integration UI:
    - `FinetuneTab` - Main tab content for model step finetuning with enable toggle, search config, and parameter list
    - `FinetuneEnableToggle` - Master on/off switch with visual indicator
    - `FinetuneSearchConfig` - Trials, timeout, approach (grouped/individual), eval_mode settings
    - `FinetuneParamList` - List of parameters to optimize with add/remove functionality
    - `FinetuneParamEditor` - Individual parameter search space configuration with type selection and validation
    - `FinetuningBadge` - Compact badge showing finetuning status (purple vs orange for sweeps)
    - `QuickFinetuneButton` - Quick action button to enable finetuning with smart defaults
  - Integrated finetuning tab into `StepConfigPanel.tsx` with tabbed UI for model steps
  - Added Training tab for deep learning models with training configuration (epochs, batch_size, learning_rate, patience, optimizer)
  - Updated `TreeNode.tsx` with purple finetuning indicator badges and context menu option
  - Model-aware parameter presets based on model type (PLS, SVM, ensemble, etc.)
  - Smart defaults: auto-adds first numeric param when enabling finetuning
  - Parameter type support: int, float, log_float, categorical with validation
  - Quick presets for common training configurations (Quick Train, Standard, Long Train, Fine-tune)
  - Color scheme: Purple (🎛️) for finetuning vs Orange (🔀) for sweeps

### v1.2 (January 2026)
- **Phase 2 Implementation Completed** ✅
  - `SweepConfigPopover` component with type selection, presets, live preview
  - `SweepActivator` and `SweepBadge` for visual sweep indicators
  - OR Generator UI: `OrGeneratorContainer`, `OrOptionItem`, `OrGeneratorDropZone`, `WrapInOrGeneratorPopover`
  - Cartesian Generator UI: `CartesianStage`, `CartesianGeneratorContainer`, `CartesianPreview`
  - Sweeps Summary Panel: `SweepsSummaryPanel`, `SweepVsFinetuningAdvisor`
  - Context Menus: `StepContextMenu`, `GeneratorContextMenu`, `BranchContextMenu`
  - Replaced inline `SweepConfig` in `StepConfigPanel` with new popover-based component
  - Updated component exports in `index.ts`
  - Full combinatorics support for OR generators (C(n,k) and P(n,k))
  - Severity-based variant count thresholds with color coding
  - Quick presets system for common parameter ranges

### v1.1 (January 4, 2026)
- **Phase 1 Implementation Completed** ✅
  - Backend variant count API using nirs4all's `count_combinations` function
  - `useVariantCount` React hook with debouncing, abort handling, and formatting
  - Extended type system (`PipelineStepType`, `GeneratorConfig`)
  - Variant count display in PipelineEditor header with popover breakdown
  - Complete operator catalog in `stepOptions` (preprocessing, splitting, models, etc.)
  - Deprecated frontend-only variant calculators in favor of backend API

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Section 1: Required Features](#section-1-required-features-for-a-top-notch-pipeline-editor)
   - 1.1 Preprocessing Operators
   - 1.2 Splitting Methods
   - 1.3 Models
   - 1.4 Pipeline Syntax Features
   - 1.5 Training Parameters
   - 1.6 Hyperparameter Optimization
   - 1.7 Multi-Source Data Support
   - 1.8 Visualization & Charts
   - 1.9 Sample Filtering
   - 1.10 Export & Serialization
   - 1.11 Target Processing
   - 1.12 Metrics Configuration
   - 1.13 Pipeline Execution Modes
3. [Section 2: Gap Analysis](#section-2-gap-analysis---current-implementation-vs-required-features)
   - 2.1 Current Implementation Summary
   - 2.2 Critical Gaps
   - 2.3 Moderate Gaps
   - 2.4 Minor Gaps
   - 2.5 Gap Priority Matrix
   - 2.6 Type System Issues
4. [Section 3: UX Enhancement Proposals](#section-3-ux-enhancement-proposals)
   - 3.1 Variant Count Estimation & Pipeline Overview ✅ (Phase 1)
   - 3.2 Enhanced Branch Visualization
   - 3.3 Keyboard Navigation
   - 3.4 Right-Click Context Menu
5. [Section 4: Generation & Finetuning UX Design](#section-4-generation--finetuning-ux-design)
   - 4.1 Conceptual Framework
   - 4.2 Parameter-Level Generation UI
   - 4.3 Step-Level Generation UI
   - 4.4 Finetuning (Optuna Integration) UI
   - 4.5 Feature Augmentation UI
   - 4.6 Complex Pipeline Interactions
   - 4.7 Y-Processing Integration
   - 4.8 Training Parameters for Deep Learning
6. [Section 5: Implementation Roadmap](#section-5-implementation-roadmap)
   - Phase 1: Foundation (Weeks 1-2) ✅ COMPLETED
   - Phase 2: Generation UX (Weeks 3-5) ✅ COMPLETED
   - Phase 3: Finetuning UX (Weeks 6-8) ✅ COMPLETED
   - Phase 4: Advanced Pipeline Features (Weeks 9-11) ✅ COMPLETED
   - Phase 5: UX Polish (Weeks 12-14) ✅ COMPLETED
   - Phase 6: Integration & Documentation (Weeks 15-16)
7. [Appendix A: Operator Registry](#appendix-a-operator-registry-for-palette)
8. [Appendix B: UI Mockups](#appendix-b-ui-mockups)
9. [Conclusion](#conclusion)

---

## Executive Summary

This document analyzes the requirements for a top-notch pipeline editor for the nirs4all webapp, compares them with the current prototype implementation, and proposes UX enhancements. The goal is to ensure the pipeline editor can fully leverage all capabilities of the nirs4all library while providing an exceptional user experience.

---

## Section 1: Required Features for a Top-Notch Pipeline Editor

Based on the nirs4all library capabilities, a complete pipeline editor must support the following feature categories:

### 1.1 Preprocessing Operators

The library provides 30+ preprocessing transforms that the editor must expose:

#### NIRS-Specific Transforms
| Operator | Parameters | Description |
|----------|------------|-------------|
| `SNV` / `StandardNormalVariate` | - | Standard Normal Variate normalization |
| `RNV` / `RobustStandardNormalVariate` | - | Outlier-resistant normalization |
| `LSNV` / `LocalStandardNormalVariate` | - | Local SNV variant |
| `MSC` / `MultiplicativeScatterCorrection` | `reference: mean\|first\|median` | Scatter correction |
| `SavitzkyGolay` | `window_length, polyorder, deriv` | Smoothing + derivatives |
| `FirstDerivative` | - | First spectral derivative |
| `SecondDerivative` | - | Second spectral derivative |
| `Haar` | - | Haar wavelet decomposition |
| `Wavelet` / `WaveletFeatures` | `wavelet, level` | Wavelet transforms |
| `WaveletPCA` / `WaveletSVD` | - | Wavelet-based dimensionality reduction |
| `LogTransform` | - | Logarithmic transform |
| `ReflectanceToAbsorbance` | - | Beer-Lambert conversion |

#### Baseline Correction (pybaselines integration)
| Operator | Description |
|----------|-------------|
| `ASLSBaseline` | Asymmetric Least Squares |
| `AirPLS` | Adaptive Iteratively Reweighted PLS |
| `ArPLS` | Asymmetrically Reweighted PLS |
| `ModPoly` / `IModPoly` | Modified Polynomial |
| `SNIP` | Statistics-sensitive Non-linear Iterative Peak-clipping |
| `RollingBall` | Rolling ball baseline |
| `IASLS` | Improved Asymmetric Least Squares |
| `BEADS` | Baseline Estimation And Denoising with Sparsity |

#### Signal Processing
| Operator | Parameters | Description |
|----------|------------|-------------|
| `Baseline` | `order` | Polynomial baseline correction |
| `Detrend` | `order` | Polynomial trend removal |
| `Gaussian` | `sigma` | Gaussian smoothing |
| `Normalize` | `norm: l1\|l2\|max` | Vector normalization |

#### Feature Operations
| Operator | Parameters | Description |
|----------|------------|-------------|
| `CropTransformer` | `start, end` | Wavelength range trimming |
| `ResampleTransformer` | `n_points` | Feature resampling |
| `Resampler` | `target_wavelengths` | Wavelength interpolation |
| `CARS` | - | Competitive Adaptive Reweighted Sampling |
| `MCUVE` | - | Monte Carlo Uninformative Variable Elimination |

#### Signal Type Conversion
| Operator | Description |
|----------|-------------|
| `ToAbsorbance` / `FromAbsorbance` | Absorbance conversion |
| `PercentToFraction` / `FractionToPercent` | Unit conversion |
| `KubelkaMunk` | Kubelka-Munk transformation |

#### Data Augmentation (Training-time)
| Operator | Description |
|----------|-------------|
| `GaussianAdditiveNoise` | Add Gaussian noise |
| `MultiplicativeNoise` | Multiplicative noise |
| `LinearBaselineDrift` | Simulate baseline drift |
| `PolynomialBaselineDrift` | Polynomial drift simulation |
| `WavelengthShift` | Shift wavelengths |
| `WavelengthStretch` | Stretch/compress wavelengths |
| `LocalWavelengthWarp` | Local wavelength warping |
| `SmoothMagnitudeWarp` | Smooth magnitude warping |
| `BandPerturbation` | Perturb specific bands |
| `GaussianSmoothingJitter` | Smoothing jitter |
| `BandMasking` | Mask spectral bands |
| `ChannelDropout` | Drop channels randomly |
| `SpikeNoise` | Add spike artifacts |
| `MixupAugmenter` | Mixup augmentation |

### 1.2 Splitting Methods

The editor must support all cross-validation and train/test splitting strategies:

#### NIRS-Specific Splitters
| Splitter | Parameters | Description |
|----------|------------|-------------|
| `KennardStoneSplitter` | `test_size, metric` | Kennard-Stone algorithm |
| `SPXYSplitter` | `test_size` | Sample Partitioning based on X and Y |
| `SPXYGFold` | `n_splits` | SPXY-based cross-validation |
| `KMeansSplitter` | `n_clusters, test_size` | K-means clustering split |
| `SPlitSplitter` | - | Optimized splitting |
| `SystematicCircularSplitter` | - | Systematic circular sampling |
| `KBinsStratifiedSplitter` | `n_bins` | Bins-based stratification |
| `BinnedStratifiedGroupKFold` | `n_splits, n_bins` | Group-aware stratified |

#### sklearn Splitters (full support)
| Splitter | Parameters |
|----------|------------|
| `KFold` | `n_splits, shuffle, random_state` |
| `StratifiedKFold` | `n_splits, shuffle` |
| `RepeatedKFold` | `n_splits, n_repeats` |
| `ShuffleSplit` | `n_splits, test_size` |
| `LeaveOneOut` | - |
| `GroupKFold` | `n_splits` |
| `GroupShuffleSplit` | `n_splits, test_size` |

### 1.3 Models

#### sklearn-Compatible Models
| Model | Parameters |
|-------|------------|
| `PLSRegression` | `n_components, max_iter` |
| `RandomForestRegressor` | `n_estimators, max_depth` |
| `SVR` / `SVC` | `kernel, C, epsilon` |
| `Ridge` / `Lasso` / `ElasticNet` | `alpha, l1_ratio` |
| Various sklearn classifiers | - |

#### Advanced PLS Variants (nirs4all exclusive)
| Model | Description |
|-------|-------------|
| `PLSDA` | PLS Discriminant Analysis |
| `IKPLS` | Improved Kernel PLS |
| `OPLS` / `OPLSDA` | Orthogonal PLS variants |
| `MBPLS` | Multi-block PLS |
| `DiPLS` | Discriminant PLS |
| `SparsePLS` | Sparse PLS |
| `SIMPLS` | SIMPLS algorithm |
| `LWPLS` | Locally Weighted PLS |
| `IntervalPLS` | Interval PLS |
| `RobustPLS` | Robust PLS |
| `RecursivePLS` | Recursive PLS |
| `KOPLS` | Kernel Orthogonal PLS |
| `KernelPLS` / `KPLS` | Kernel PLS variants |
| `NLPLS` | Non-linear PLS |
| `OKLMPLS` | Orthogonalized Kernel Local Manifold PLS |
| `FCKPLS` | Fractional Convolution Kernel PLS |

#### Deep Learning Models (lazy-loaded)
| Model | Framework | Description |
|-------|-----------|-------------|
| `nicon` | TensorFlow | NIRS-specific CNN architecture |
| `generic` | TensorFlow | Generic DL architectures |
| PyTorch models | PyTorch | Various architectures |
| JAX models | JAX | JAX-based models |

#### Meta-Models (Stacking)
| Model | Description |
|-------|-------------|
| `MetaModel` | Stacking ensemble using OOF predictions |

### 1.4 Pipeline Syntax Features

#### Step Keywords
The editor must understand and allow configuration of these special keywords:

| Keyword | Purpose | Example |
|---------|---------|---------|
| `model` | Explicit model step | `{"model": PLSRegression(10)}` |
| `y_processing` | Target variable scaling | `{"y_processing": MinMaxScaler()}` |
| `branch` | Parallel pipeline paths | `{"branch": [[...], [...]]}` |
| `merge` | Combine branch outputs | `{"merge": "predictions"}` |
| `source_branch` | Per-source preprocessing | `{"source_branch": {"NIR": [...], "VIS": [...]}}` |
| `feature_augmentation` | Multiple preprocessing variants | `{"feature_augmentation": [...], "action": "extend"}` |
| `sample_augmentation` | Training-time data augmentation | `{"sample_augmentation": [...]}` |
| `concat_transform` | Concatenate transformed features | `{"concat_transform": [...]}` |
| `name` | Named step for reference | `{"name": "PLS_10", "model": ...}` |

#### Generator Syntax
Critical for hyperparameter exploration:

| Generator | Syntax | Purpose |
|-----------|--------|---------|
| `_or_` | `{"_or_": [SNV, MSC, Detrend]}` | Choose between alternatives |
| `_range_` | `{"_range_": [1, 30, 5], "param": "n_components"}` | Parameter sweep (linear) |
| `_log_range_` | `{"_log_range_": [0.001, 100, 10]}` | Logarithmic parameter sweep |
| `_cartesian_` | `{"_cartesian_": [[...], [...]]}` | All combinations of stages |
| `pick` | `{"_or_": [...], "pick": 2}` | Select N items (combinations) |
| `arrange` | `{"_or_": [...], "arrange": 2}` | Select N items (permutations) |
| `count` | `{"_or_": [...], "count": 5}` | Limit total variants |

#### Feature Augmentation Actions
| Action | Behavior |
|--------|----------|
| `extend` | Add new processings independently (default) |
| `add` | Chain on existing, keep originals |
| `replace` | Chain on existing, discard originals |

### 1.5 Training Parameters

For deep learning models, support for training configuration:

| Parameter | Type | Description |
|-----------|------|-------------|
| `epochs` | int | Number of training epochs |
| `batch_size` | int | Batch size |
| `patience` | int | Early stopping patience |
| `learning_rate` | float | Optimizer learning rate |
| `optimizer` | str | Optimizer type |
| `callbacks` | list | Training callbacks |

### 1.6 Hyperparameter Optimization

Integration with Optuna for automated tuning:

| Parameter | Description |
|-----------|-------------|
| `n_trials` | Number of optimization trials |
| `model_params` | Parameter search spaces |
| `approach` | Optimization approach (grouped, individual) |
| `eval_mode` | Evaluation mode (best, mean) |
| `timeout` | Maximum optimization time |
| `pruner` | Pruning strategy |

Example configuration:
```python
{
    "model": PLSRegression(),
    "finetune_params": {
        "n_trials": 50,
        "model_params": {
            "n_components": ("int", 1, 30)
        }
    }
}
```

### 1.7 Multi-Source Data Support

The editor must handle pipelines with multiple data sources:

| Feature | Description |
|---------|-------------|
| Source-specific preprocessing | Different transforms per source |
| Source merging strategies | Concatenation, stacking |
| Source selection | Process only specific sources |

### 1.8 Visualization & Charts

Pipeline-level chart operators:

| Chart | Description |
|-------|-------------|
| Spectra visualization | View input/transformed spectra |
| Fold distribution | Visualize CV splits |
| Target distribution | Y variable analysis |
| Augmentation preview | Preview augmented samples |
| Spectral distribution | Statistical distribution |

### 1.9 Sample Filtering

| Filter | Description |
|--------|-------------|
| `SampleFilter` | Custom sample filtering |
| `YOutlierFilter` | Remove Y outliers |

### 1.10 Export & Serialization

| Feature | Description |
|---------|-------------|
| `.n4a` bundle export | Portable model export |
| JSON pipeline definition | Human-readable format |
| YAML configuration | Alternative serialization |

### 1.11 Target Processing

| Feature | Description |
|---------|-------------|
| `y_processing` | Target scaling (MinMaxScaler, StandardScaler) |
| `IntegerKBinsDiscretizer` | Discretize continuous Y into bins |
| `RangeDiscretizer` | Custom range discretization |

### 1.12 Metrics Configuration

Explicit metrics selection for evaluation:

| Metric | Task Type |
|--------|-----------|
| `RMSE`, `MAE`, `MSE` | Regression |
| `R2`, `Explained Variance` | Regression |
| `RMSEP`, `SEP`, `Bias` | NIRS-specific |
| `Accuracy`, `F1`, `Precision`, `Recall` | Classification |
| `AUC-ROC`, `Confusion Matrix` | Classification |

### 1.13 Pipeline Execution Modes

| Mode | Description |
|------|-------------|
| `train` | Standard training mode |
| `predict` | Prediction on new data |
| `explain` | SHAP-based explanations |
| `retrain` | Retrain on new data |

---

## Section 2: Gap Analysis - Current Implementation vs Required Features

This section compares the current webapp prototype with the required features identified in Section 1.

### 2.1 Current Implementation Summary

Based on analysis of the prototype codebase, the current implementation includes:

#### ✅ Implemented Features

**Step Palette (`types.ts`, `StepPalette.tsx`)**
- 12 preprocessing operators (SNV, MSC, SavitzkyGolay, Detrend, Normalize, Gaussian, MovingAverage, StandardScaler, MinMaxScaler, RobustScaler, BaselineCorrection, Trim)
- 8 splitting methods (KennardStone, SPXY, KFold, RepeatedKFold, ShuffleSplit, LeaveOneOut, StratifiedKFold, GroupKFold)
- 11 models (PLSRegression, RandomForest, SVR, XGBoost, LightGBM, ElasticNet, Ridge, Lasso, CNN1D, MLP, LSTM)
- Basic generator support (ChooseOne, Cartesian)
- Branch support (ParallelBranch)
- Merge operations (Concatenate, Mean, Stacking)

**Pipeline Editor Core (`usePipelineEditor.ts`)**
- Drag-and-drop step addition
- Step reordering within pipeline
- Step duplication and deletion
- Undo/Redo history (50 levels)
- Local storage persistence
- Nested branch support
- Keyboard shortcuts (Ctrl+Z, Del, Ctrl+D)

**Step Configuration (`StepConfigPanel.tsx`)**
- Parameter editing for all step types
- Parameter sweeps (range, log_range, choices)
- Variant count calculation
- Parameter tooltips and descriptions
- Select dropdowns for enum parameters (kernel, norm, activation, reference)

**Visual Representation (`PipelineTree.tsx`, `TreeNode.tsx`)**
- Tree-based visual layout
- Drop zones between steps
- Branch visualization
- Start/End markers

**UX Features**
- Search filtering in palette
- Collapsible category sections
- Step type badges and color coding
- Dirty state tracking
- Export to JSON

---

### 2.2 Critical Gaps

#### 🔴 Missing Preprocessing Operators (HIGH PRIORITY)

The current palette includes only 12 operators. Missing from nirs4all:

| Missing Operator | Priority | Notes |
|-----------------|----------|-------|
| `FirstDerivative` | HIGH | Common NIRS preprocessing |
| `SecondDerivative` | HIGH | Common NIRS preprocessing |
| `Haar` | HIGH | Wavelet decomposition |
| `Wavelet` / `WaveletFeatures` | MEDIUM | Advanced wavelet transforms |
| `RobustStandardNormalVariate` | MEDIUM | Outlier-resistant SNV |
| `LocalStandardNormalVariate` | MEDIUM | Local SNV variant |
| `ReflectanceToAbsorbance` | HIGH | Beer-Lambert conversion |
| `LogTransform` | MEDIUM | Logarithmic transform |
| All pybaseline operators | MEDIUM | 8+ baseline correction methods |
| `CARS` | HIGH | Feature selection |
| `MCUVE` | HIGH | Feature selection |
| `Resampler` | MEDIUM | Wavelength interpolation |
| Signal type converters | LOW | ToAbsorbance, KubelkaMunk, etc. |
| All data augmenters | LOW | 15+ augmentation operators |

**Recommendation:** Add FirstDerivative, SecondDerivative, Haar, ReflectanceToAbsorbance, CARS, MCUVE immediately. Create an "Advanced" subcategory for less common operators.

#### 🔴 Missing NIRS-Specific Splitters (HIGH PRIORITY)

Current splitters are mostly sklearn defaults. Missing:

| Missing Splitter | Priority |
|-----------------|----------|
| `SPXYGFold` | HIGH |
| `KMeansSplitter` | MEDIUM |
| `SPlitSplitter` | LOW |
| `SystematicCircularSplitter` | LOW |
| `KBinsStratifiedSplitter` | MEDIUM |
| `BinnedStratifiedGroupKFold` | MEDIUM |

**Recommendation:** Add SPXYGFold and KBinsStratifiedSplitter for NIRS-specific workflows.

#### 🔴 Missing Advanced PLS Variants (HIGH PRIORITY)

The current model palette only has standard PLSRegression. Missing nirs4all exclusive models:

| Missing Model | Priority | Reason |
|--------------|----------|--------|
| `PLSDA` | HIGH | Essential for classification |
| `OPLS` / `OPLSDA` | HIGH | Popular NIRS method |
| `IKPLS` | MEDIUM | Performance improvement |
| `SparsePLS` | MEDIUM | Feature selection |
| `LWPLS` | MEDIUM | Local weighting |
| `IntervalPLS` | HIGH | Spectral interval selection |
| `KernelPLS` | LOW | Non-linear PLS |
| `FCKPLS` | LOW | Advanced method |

**Recommendation:** Add PLSDA, OPLS, IntervalPLS as priority. These are differentiators for nirs4all.

#### 🔴 Missing Pipeline Keywords (CRITICAL)

The current implementation does not expose several critical pipeline keywords:

| Missing Keyword | Impact | Description |
|----------------|--------|-------------|
| `y_processing` | HIGH | No target scaling support |
| `feature_augmentation` | HIGH | Cannot create multi-processing pipelines |
| `sample_augmentation` | MEDIUM | No training-time augmentation |
| `source_branch` | MEDIUM | No multi-source support |
| `name` | LOW | Cannot name steps for reference |
| `concat_transform` | MEDIUM | Cannot concatenate transforms |

**Recommendation:** `y_processing` and `feature_augmentation` are essential for real-world pipelines. These need dedicated UI sections.

#### 🔴 Missing Hyperparameter Optimization (HIGH PRIORITY)

No support for `finetune_params` configuration:

| Missing Feature | Description |
|----------------|-------------|
| `n_trials` configuration | Optuna trial count |
| Parameter search spaces | Define tunable parameters |
| Optimization approach | Grouped vs individual |
| Timeout settings | Max optimization time |

**Recommendation:** Add "Enable Optimization" toggle per model step with Optuna configuration panel.

#### 🔴 Missing Meta-Model / Stacking Support (MEDIUM PRIORITY)

| Missing Feature | Description |
|----------------|-------------|
| `MetaModel` operator | Stacking ensemble |
| Source model selection | Which models to stack |
| Coverage strategies | Handle partial OOF |
| Multi-level stacking | Hierarchical ensembles |

**Recommendation:** Add MetaModel as a special model type with source selection UI.

---

### 2.3 Moderate Gaps

#### 🟡 Training Parameters for DL Models

Current CNN1D, MLP, LSTM steps don't expose training parameters:

| Missing | Current |
|---------|---------|
| epochs, batch_size, patience | Only architecture params |
| learning_rate, optimizer | Not configurable |
| callbacks | Not exposed |

**Recommendation:** Add "Training" tab in config panel for DL models.

#### 🟡 Multi-Source Pipeline Support

No UI for:
- Defining source-specific preprocessing
- Configuring `source_branch`
- Source merging strategies

**Recommendation:** Add source-aware mode when dataset has multiple sources.

#### 🟡 Visualization Integration

No support for inline chart operators:
- Spectra preview
- Fold visualization
- Target distribution

**Recommendation:** Add "Visualize" action to preprocessing steps for preview.

#### 🟡 Metrics Configuration

Current implementation shows metrics as step type but actual configuration is limited:
- No explicit metrics selection
- No NIRS-specific metrics (RMSEP, SEP, Bias)

**Recommendation:** Add metrics section in pipeline config or model step.

---

### 2.4 Minor Gaps

#### 🟢 Parameter Sweep Limitations

Current sweep implementation is good but missing:
- Grid sweep (multiple params simultaneously)
- Named sweep presets
- Sweep estimation (total variants)

#### 🟢 Step Naming

Cannot assign custom names to steps for reference in MetaModel source selection.

#### 🟢 Condition/Scope Operators

Flow control operators (`condition`, `scope`) not implemented.

#### 🟢 Preset Pipeline Templates

No preset library for common NIRS workflows.

---

### 2.5 Gap Priority Matrix

| Category | Gap | Priority | Effort | Impact |
|----------|-----|----------|--------|--------|
| Operators | Missing NIRS transforms | HIGH | MEDIUM | HIGH |
| Operators | Missing PLS variants | HIGH | LOW | HIGH |
| Keywords | y_processing | CRITICAL | LOW | HIGH |
| Keywords | feature_augmentation | HIGH | MEDIUM | HIGH |
| Optimization | finetune_params | HIGH | MEDIUM | HIGH |
| Models | MetaModel stacking | MEDIUM | HIGH | MEDIUM |
| Splitters | NIRS splitters | MEDIUM | LOW | MEDIUM |
| DL | Training params | MEDIUM | LOW | MEDIUM |
| Multi-source | source_branch | MEDIUM | HIGH | LOW |
| Metrics | NIRS metrics | LOW | LOW | MEDIUM |

---

### 2.6 Current Type System Issues

The current `types.ts` has a `StepType` that doesn't fully align with nirs4all:

```typescript
// Current
export type StepType = "preprocessing" | "splitting" | "model" | "generator" | "branch" | "merge";
```

**Issues:**
1. `generator` is a mode, not a step type - generators can apply to any step
2. Missing `y_processing` as explicit type
3. Missing `augmentation` category (sample vs feature)
4. `metrics` was mentioned in palette but removed from type

**Recommended Type:**
```typescript
export type StepType =
  | "preprocessing"
  | "y_processing"
  | "feature_augmentation"
  | "sample_augmentation"
  | "splitting"
  | "model"
  | "meta_model"
  | "branch"
  | "merge"
  | "filter"
  | "visualization";
```

---

## Section 3: UX Enhancement Proposals

This section focuses on essential UX improvements, with particular emphasis on making generation, finetuning, and complex pipeline interactions seamless.

### 3.1 Variant Count Estimation & Pipeline Overview

**Current State:** Shows per-step variant count, but no pipeline-level totals.

**Proposed Enhancement:**
- Display total pipeline variants prominently in header
- Show variant breakdown by step with expandable details
- Warn when variant count is very large (>1000) with optimization suggestions
- Real-time update as user modifies parameters

```
┌─ Pipeline Overview ──────────────────────────────────────────────┐
│                                                                  │
│  Pipeline: SNV + SG → PLS                                        │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                                                  │
│  🔄 Total Variants: 450                                          │
│                                                                  │
│  Breakdown:                                                      │
│  ├── SavitzkyGolay: 15 variants (window × deriv)                │
│  ├── PLSRegression: 30 variants (n_components: 1→30)            │
│  └── Combined: 15 × 30 = 450                                     │
│                                                                  │
│  ⚠️ Large variant count. Consider:                               │
│  • Reducing parameter ranges                                     │
│  • Using coarser step sizes                                      │
│  • Enabling Optuna finetuning instead of grid search            │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 Enhanced Branch Visualization

**Current State:** Basic tree layout with branches.

**Proposed Enhancement:**
- Clear visual distinction between branch types:
  - **Parallel Branch** (all branches run): horizontal lanes
  - **OR Generator** (choose one): stacked options with radio indicator
  - **Cartesian** (combinations): grid visualization
- Collapsible branch groups for complex pipelines
- Branch naming with auto-generated meaningful names
- Per-branch variant count annotation

```
┌─ ParallelBranch ───────────────────────────────────────────────┐
│                                                                │
│  ╭── Branch A: "SNV Chain" ──╮  ╭── Branch B: "MSC Chain" ──╮  │
│  │                           │  │                           │  │
│  │  ┌─────────────────┐      │  │  ┌─────────────────┐      │  │
│  │  │      SNV        │      │  │  │      MSC        │      │  │
│  │  └────────┬────────┘      │  │  └────────┬────────┘      │  │
│  │           │               │  │           │               │  │
│  │  ┌────────▼────────┐      │  │  ┌────────▼────────┐      │  │
│  │  │  SavitzkyGolay  │      │  │  │  FirstDeriv     │      │  │
│  │  │  (15 variants)  │      │  │  └─────────────────┘      │  │
│  │  └─────────────────┘      │  │                           │  │
│  │                           │  │                           │  │
│  ╰───────────────────────────╯  ╰───────────────────────────╯  │
│                                                                │
│  Branch output: 2 parallel paths → merge step                  │
│  [+ Add Branch]  [Collapse All]                                │
└────────────────────────────────────────────────────────────────┘
```

**OR Generator Visualization:**
```
┌─ Choose One (_or_) ───────────────────────────────────────────┐
│                                                               │
│  ○ Option 1: SNV                                              │
│  ○ Option 2: MSC                                              │
│  ○ Option 3: FirstDerivative                                  │
│                                                               │
│  📊 3 variants (one selected per run)                         │
│                                                               │
│  Selection mode:                                              │
│  ○ Pick 1 (default)   ○ Pick 2 (combinations)                 │
│  ○ Arrange 2 (permutations)                                   │
└───────────────────────────────────────────────────────────────┘
```

### 3.3 Keyboard Navigation

**Current State:** Basic keyboard shortcuts (Ctrl+Z, Del, Ctrl+D).

**Proposed Enhancement:**

| Shortcut | Action |
|----------|--------|
| `↑ / ↓` | Navigate between steps |
| `← / →` | Navigate into/out of branches |
| `Enter` | Select step for editing / expand branch |
| `Space` | Toggle step enabled/disabled |
| `Tab` | Cycle between panels (Palette → Tree → Config) |
| `Shift+Tab` | Cycle backwards |
| `Cmd/Ctrl+K` | Open command palette |
| `Cmd/Ctrl+D` | Duplicate selected step |
| `Cmd/Ctrl+Shift+D` | Duplicate and immediately edit |
| `Cmd/Ctrl+G` | Add generator to selected parameter |
| `Cmd/Ctrl+F` | Add finetuning to selected model |
| `Cmd/Ctrl+B` | Wrap selected step(s) in branch |
| `Cmd/Ctrl+Shift+B` | Wrap in OR generator |
| `Delete / Backspace` | Remove selected step |
| `Escape` | Deselect / close panel |

### 3.4 Right-Click Context Menu

**Proposed Enhancement:**
- Consistent context menu on all steps
- Context-aware options based on step type

**For Preprocessing Steps:**
```
┌─────────────────────────────────┐
│ Duplicate                  ⌘D  │
│ Delete                     ⌫   │
├─────────────────────────────────┤
│ Disable Step                   │
│ Add to OR Generator...         │
│ Wrap in Branch                 │
├─────────────────────────────────┤
│ Add Parameter Sweep...     ⌘G  │
├─────────────────────────────────┤
│ Insert Before →               │
│ Insert After →                │
└─────────────────────────────────┘
```

**For Model Steps:**
```
┌─────────────────────────────────┐
│ Duplicate                  ⌘D  │
│ Delete                     ⌫   │
├─────────────────────────────────┤
│ Disable Step                   │
│ Add to Model Comparison...     │
├─────────────────────────────────┤
│ Configure Finetuning...    ⌘F  │
│ Add Parameter Sweep...     ⌘G  │
├─────────────────────────────────┤
│ View as MetaModel Source       │
├─────────────────────────────────┤
│ Insert Before →               │
│ Insert After →                │
└─────────────────────────────────┘
```

---

## Section 4: Generation & Finetuning UX Design

This section provides detailed UX/UI specifications for the most complex and powerful features of nirs4all: pipeline generation and hyperparameter finetuning. The goal is to make these advanced features accessible and intuitive.

### 4.1 Conceptual Framework

**Key Distinction:**
- **Generation (Sweeps)** = Exhaustive search: run ALL parameter combinations
- **Finetuning (Optuna)** = Smart search: intelligent exploration with early stopping

Users should understand this distinction clearly. The UI must:
1. Make both approaches easily accessible
2. Clearly show which approach is active
3. Allow seamless switching between them
4. Show the implications (variant count vs trial count)

### 4.2 Parameter-Level Generation UI

#### Sweep Activation

**Design Principle:** Any parameter can become a sweep with minimal friction.

**Interaction Pattern:**
1. Hover over parameter → Show subtle "sweep" icon
2. Click icon OR right-click → Open sweep configuration inline
3. Sweep active → Parameter field transforms to show range

**Visual States:**

```
┌─ PLSRegression ──────────────────────────────────────────────┐
│                                                              │
│ STANDARD PARAMETER (no sweep):                               │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ n_components                                [10    ] 🔀  │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ SWEEP ACTIVE:                                                │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ n_components                    ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ 🔀 ×   │ │
│ │ ├── Range: 1 → 30 (step: 1)                              │ │
│ │ └── 30 variants                                          │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

#### Sweep Configuration Popover

```
┌─ Configure Sweep: n_components ─────────────────────────────┐
│                                                             │
│  Sweep Type:                                                │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │
│  │  Range  │ │Log Range│ │ Choices │ │  Grid   │           │
│  │    ✓    │ │         │ │         │ │         │           │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘           │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  From: [1    ]  To: [30   ]  Step: [1    ]          │   │
│  │                                                      │   │
│  │  Preview: 1, 2, 3, 4, 5, 6, ... 28, 29, 30          │   │
│  │                                                      │   │
│  │  📊 30 variants                                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Quick presets:                                             │
│  [1-10] [1-20] [1-30] [5-25 step 5] [Custom...]            │
│                                                             │
│                            [Cancel]  [Apply Sweep]          │
└─────────────────────────────────────────────────────────────┘
```

#### Multi-Parameter Grid Sweep

When multiple parameters have sweeps, show the combinatorial effect:

```
┌─ Active Sweeps ─────────────────────────────────────────────┐
│                                                             │
│  ┌────────────────┬─────────────┬─────────────────────────┐ │
│  │ Parameter      │ Range       │ Variants                │ │
│  ├────────────────┼─────────────┼─────────────────────────┤ │
│  │ n_components   │ 1 → 30      │ 30                      │ │
│  │ max_iter       │ 100, 500    │ 2                       │ │
│  └────────────────┴─────────────┴─────────────────────────┘ │
│                                                             │
│  Grid Mode: [Cartesian ▾]                                   │
│                                                             │
│  Total: 30 × 2 = 60 variants                               │
│                                                             │
│  ⚠️ Consider using Finetuning for large search spaces       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.3 Step-Level Generation UI

#### OR Generator (Choose Between Steps)

**Use Case:** Compare different preprocessing methods.

**Activation:**
1. Select multiple steps → Right-click → "Wrap in OR Generator"
2. OR: Drag step to "OR" drop zone of another step
3. OR: Add from palette → Generator → "Choose One"

**Visual Representation:**

```
┌─ OR Generator ──────────────────────────────────────────────┐
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ○ SNV                                          [×]  │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ ○ MSC                                          [×]  │   │
│  │   └── reference: [mean ▾]                           │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ ○ FirstDerivative                              [×]  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  [+ Add Option]                                             │
│                                                             │
│  Selection:                                                 │
│  ○ Pick 1 of 3    ○ Pick [2▾] of 3    ○ All combinations   │
│                                                             │
│  📊 Generates: 3 variants                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### Cartesian Generator (Stage Combinations)

**Use Case:** Try all combinations of preprocessing stages.

```
┌─ Cartesian Generator ───────────────────────────────────────┐
│                                                             │
│  Stage 1: Scatter Correction                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ [SNV] [MSC] [None]                                  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Stage 2: Derivative                                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ [FirstDeriv] [SecondDeriv] [SavitzkyGolay(d=1)]     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Stage 3: Smoothing (optional)                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ [Gaussian] [None]                                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  [+ Add Stage]                                              │
│                                                             │
│  📊 Combinations: 3 × 3 × 2 = 18 preprocessing pipelines    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.4 Finetuning (Optuna Integration) UI

#### Model-Level Finetuning Activation

**Design Principle:** Finetuning is a model-level concern, distinct from sweeps.

**Activation Methods:**
1. Model step config panel → "Finetuning" tab
2. Right-click model → "Configure Finetuning..."
3. Keyboard: Select model → Cmd+F

**Visual Indicator:**
- Model steps with finetuning show a tuning icon: 🎛️
- Different color accent (purple) vs sweep (orange)

```
┌─ PLSRegression ──────────────────────────────────────────────┐
│                                                              │
│  [Parameters]  [Finetuning 🎛️]  [Training]                   │
│  ─────────────────────────────────────────                   │
│                                                              │
│  ☑ Enable Optuna Finetuning                                  │
│                                                              │
│  ┌─ Search Configuration ─────────────────────────────────┐  │
│  │                                                        │  │
│  │  Trials: [50     ]        Timeout: [     ] sec (opt)   │  │
│  │                                                        │  │
│  │  Approach: ○ Grouped (shared across folds)             │  │
│  │            ○ Individual (per fold)                     │  │
│  │                                                        │  │
│  │  Evaluation: ○ Best score   ○ Mean score               │  │
│  │                                                        │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ Parameters to Optimize ───────────────────────────────┐  │
│  │                                                        │  │
│  │  ┌──────────────────────────────────────────────────┐ │  │
│  │  │ n_components    int     [1    ] → [30   ]        │ │  │
│  │  └──────────────────────────────────────────────────┘ │  │
│  │                                                        │  │
│  │  [+ Add Parameter]                                     │  │
│  │                                                        │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  💡 Optuna will intelligently explore 50 configurations     │
│     using Bayesian optimization                              │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

#### Parameter Search Space Configuration

```
┌─ Add Tunable Parameter ─────────────────────────────────────┐
│                                                             │
│  Parameter: [n_components ▾]                                │
│                                                             │
│  Type: ○ Integer   ○ Float   ○ Categorical   ○ Log Scale   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  For Integer:                                        │   │
│  │  Low: [1    ]    High: [30   ]    Step: [1    ] (opt)│   │
│  │                                                      │   │
│  │  For Categorical:                                    │   │
│  │  Choices: [rbf, linear, poly]                        │   │
│  │                                                      │   │
│  │  For Float (Log):                                    │   │
│  │  Low: [0.001 ]    High: [100  ]                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Preview: n_components: ("int", 1, 30)                      │
│                                                             │
│                               [Cancel]  [Add Parameter]     │
└─────────────────────────────────────────────────────────────┘
```

#### Sweep vs Finetuning Comparison Widget

When both are possible, help users choose:

```
┌─ Search Strategy ───────────────────────────────────────────┐
│                                                             │
│  You have parameter variations. Choose your strategy:       │
│                                                             │
│  ┌──────────────────────┐  ┌──────────────────────┐        │
│  │    GRID SWEEP 🔀     │  │   FINETUNING 🎛️     │        │
│  │                      │  │                      │        │
│  │  • Run ALL combos    │  │  • Smart exploration │        │
│  │  • Guaranteed best   │  │  • Early stopping    │        │
│  │  • 450 runs needed   │  │  • ~50 trials        │        │
│  │                      │  │                      │        │
│  │  Best for:           │  │  Best for:           │        │
│  │  • Small spaces      │  │  • Large spaces      │        │
│  │  • Need all results  │  │  • Time-limited      │        │
│  │                      │  │                      │        │
│  │  [Use Sweep]         │  │  [Use Finetuning]    │        │
│  └──────────────────────┘  └──────────────────────┘        │
│                                                             │
│  ○ Hybrid: Sweep preprocessing + Finetune model             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.5 Feature Augmentation UI

**Use Case:** Generate multiple preprocessing channels that feed into the model.

```
┌─ Feature Augmentation ──────────────────────────────────────┐
│                                                             │
│  ☑ Enable Feature Augmentation                              │
│                                                             │
│  Action Mode:                                               │
│  ○ Extend - Add each as independent channel (default)       │
│  ○ Add - Chain on existing, keep originals                  │
│  ○ Replace - Chain on existing, discard originals           │
│                                                             │
│  Transforms to generate:                                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  1. SNV                                         [×]  │   │
│  │  2. FirstDerivative                             [×]  │   │
│  │  3. SavitzkyGolay (window=11, deriv=1)          [×]  │   │
│  │                                                      │   │
│  │  [+ Add Transform]  [+ Add from Palette]             │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─ Output Preview ────────────────────────────────────┐   │
│  │                                                      │   │
│  │  Input: 1 processing (raw or previous)               │   │
│  │                    ↓                                 │   │
│  │  Output: 4 processings                               │   │
│  │  ├── [original]                                      │   │
│  │  ├── [original] + SNV                                │   │
│  │  ├── [original] + FirstDerivative                    │   │
│  │  └── [original] + SavitzkyGolay                      │   │
│  │                                                      │   │
│  │  Feature shape: (n, 2048) → (n, 4, 2048)            │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.6 Complex Pipeline Interactions

#### Combined Visualization

When a pipeline uses both generation and finetuning:

```
┌─ Pipeline Execution Preview ────────────────────────────────┐
│                                                             │
│  GENERATION PHASE (Grid):                                   │
│  ├── Preprocessing: 18 variants (Cartesian)                 │
│  └── Splitting: 1 (KFold × 5)                               │
│                                                             │
│  FINETUNING PHASE (per preprocessing variant):              │
│  ├── PLSRegression: 50 trials (Optuna)                      │
│  └── RandomForest: 50 trials (Optuna)                       │
│                                                             │
│  ─────────────────────────────────────────────              │
│  Total executions:                                          │
│  • 18 preprocessing variants                                │
│  • × 2 models                                               │
│  • × 50 trials each                                         │
│  = 1,800 model fits (across 5 folds = 9,000 fits)          │
│                                                             │
│  ⚠️ This may take significant time. Consider:               │
│  • Reducing preprocessing variants                          │
│  • Reducing Optuna trials                                   │
│  • Using a subset of data for exploration                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### Pipeline Summary Badge

Compact summary shown in pipeline header:

```
┌─────────────────────────────────────────────────────────────┐
│ SNV + SG → PLS Pipeline                                     │
│                                                             │
│ [18 prep variants 🔀] [2 models] [Finetune: 50 trials 🎛️]  │
│                                                             │
│ Total: ~1,800 configurations                                │
└─────────────────────────────────────────────────────────────┘
```

### 4.7 Y-Processing Integration

```
┌─ Target Processing ─────────────────────────────────────────┐
│                                                             │
│  ☑ Enable y_processing                                      │
│                                                             │
│  Scaler:                                                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ [MinMaxScaler              ▾]                        │   │
│  │                                                      │   │
│  │ Common options:                                      │   │
│  │ • MinMaxScaler - Scale to [0, 1]                     │   │
│  │ • StandardScaler - Zero mean, unit variance          │   │
│  │ • RobustScaler - Median/IQR based                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Parameters:                                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ feature_range_min: [0    ]                           │   │
│  │ feature_range_max: [1    ]                           │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ℹ️ Target values will be scaled before training.           │
│     Predictions are automatically inverse-transformed.      │
│                                                             │
│  📊 Recommended for:                                        │
│  • Neural networks (always)                                 │
│  • When Y has very large/small values                       │
│  • When Y range varies significantly                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.8 Training Parameters for Deep Learning

```
┌─ nicon (CNN) ────────────────────────────────────────────────┐
│                                                              │
│  [Architecture]  [Training]  [Finetuning 🎛️]                 │
│  ──────────────────────────────────────────                  │
│                                                              │
│  ┌─ Training Configuration ────────────────────────────────┐ │
│  │                                                         │ │
│  │  Epochs:        [100   ]                                │ │
│  │  Batch Size:    [32    ]                                │ │
│  │  Learning Rate: [0.001 ]                                │ │
│  │                                                         │ │
│  │  Early Stopping:                                        │ │
│  │  ☑ Enable                                               │ │
│  │  Patience: [20   ] epochs                               │ │
│  │  Monitor:  [val_loss ▾]                                 │ │
│  │                                                         │ │
│  │  Optimizer: [Adam ▾]                                    │ │
│  │  └── Parameters: β₁=[0.9] β₂=[0.999]                   │ │
│  │                                                         │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─ Quick Presets ─────────────────────────────────────────┐ │
│  │ [Quick Train] [Standard] [Long Train] [Fine-tune]       │ │
│  │                                                         │ │
│  │ Standard: 100 epochs, batch 32, patience 20             │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## Section 5: Implementation Roadmap

This roadmap is organized into focused phases, with the Generation & Finetuning features prioritized as the core value-add.

---

### Phase 1: Foundation (Weeks 1-2) ✅ COMPLETED

**Goal:** Establish infrastructure for generation and finetuning features.

**Status:** Completed on January 4, 2026

#### 1.1 Type System Expansion ✅

**Priority:** Critical | **Effort:** Medium | **Status:** DONE

Extended types in multiple locations:

**`src/types/pipelines.ts`:**
- Extended `PipelineStepType` with all operator categories (scatter_correction, baseline, derivatives, etc.)
- Added `GeneratorConfig` interface with `_or_`, `_range_`, `_log_range_`, `_grid_`, `_zip_`, `pick`, `arrange`, `count`, `seed`
- Added `children` and `parentId` to `PipelineStep` for nested structures

**`src/components/pipeline-editor/types.ts`:**
- Added `ParameterSweep` interface for parameter-level generators
- Added `FinetuneConfig` and `FinetuneParamConfig` for Optuna integration
- Added `TrainingConfig` for deep learning models
- Extended `PipelineStep` with `paramSweeps`, `finetuneConfig`, `trainingConfig`

**Deliverables:**
- [x] Extended type definitions
- [x] JSON serialization support for generators
- [ ] Migration for existing saved pipelines (deferred to Phase 2)

#### 1.2 Variant Count Calculator ✅

**Priority:** High | **Effort:** Low | **Status:** DONE

**Implementation:** Instead of duplicating the variant counting logic in the frontend, we integrated with nirs4all's native `count_combinations` function via a backend API.

**Backend (`api/pipelines.py`):**
```python
@router.post("/pipelines/count-variants")
async def count_pipeline_variants(request: PipelineCountRequest):
    from nirs4all.pipeline.config.generator import count_combinations
    nirs4all_steps = _convert_frontend_steps_to_nirs4all(request.steps)
    total_count = count_combinations(nirs4all_steps)
    # Returns count, breakdown per step, and warning for large spaces
```

**Frontend (`src/hooks/useVariantCount.ts`):**
```typescript
export function useVariantCount(steps: PipelineStep[], debounceMs = 300): VariantCountResult {
  // Debounced API calls with abort handling
  // Returns { count, breakdown, warning, isLoading }
}

export function formatVariantCount(count: number): string // "1.2K", "3.5M"
export function getVariantCountSeverity(count: number): "low" | "medium" | "high" | "extreme"
export function getVariantCountColor(count: number): string // Tailwind classes
```

**UI (`src/pages/PipelineEditor.tsx`):**
- Variant count badge in header showing count with color-coded severity
- Popover with detailed breakdown by step
- Warning display for large search spaces (>1000 variants)

**Deliverables:**
- [x] Backend API endpoint using nirs4all's `count_combinations`
- [x] `useVariantCount` hook with debouncing and abort handling
- [x] Real-time display in pipeline header with popover
- [x] Warning thresholds (medium: >100, high: >1000, extreme: >10000)
- [x] Deprecated frontend-only calculators with JSDoc notices

#### 1.3 Complete Operator Catalog ✅

**Priority:** High | **Effort:** Medium | **Status:** DONE

Added comprehensive operator catalog to `stepOptions` in `types.ts`:

| Category | Count | Subcategories |
|----------|-------|---------------|
| Preprocessing | 38 | NIRS Core, Derivatives, Smoothing, Baseline, Wavelet, Conversion, Feature Selection, Feature Ops, Scaling |
| Y Processing | 7 | Scaling, Transform, Discretization |
| Splitting | 16 | NIRS, sklearn |
| Models | 30 | PLS, Advanced PLS, Kernel PLS, Linear, SVM, Ensemble, Deep Learning, Meta |
| Generator | 3 | Selection, Combination |
| Branch | 2 | Parallel, Multi-Source |
| Merge | 4 | Feature, Prediction |
| Filter | 4 | Sample, Outlier |
| Augmentation | 10 | Noise, Drift, Shift, Masking, Mixing |

**Deliverables:**
- [x] All 30+ preprocessing operators with subcategories
- [x] All 8+ NIRS-specific splitters
- [x] All model variants including deep learning (flagged with `isDeepLearning`)
- [x] Color scheme per step type
- [x] Parameter tooltips and descriptions

```typescript
// Add to stepOptions in types.ts
const additionalPreprocessingOptions = [
  { value: 'EMSC', label: 'EMSC (Extended MSC)', params: ['reference'] },
  { value: 'Detrend', label: 'Detrend', params: ['order'] },
  { value: 'Normalize', label: 'Normalize', params: ['norm'] },
  { value: 'BaselineCorrection', label: 'Baseline Correction', params: ['method'] },
  { value: 'MovingAverage', label: 'Moving Average', params: ['window_size'] },
  { value: 'Gaussian', label: 'Gaussian Filter', params: ['sigma'] },
];

const additionalSplitterOptions = [
  { value: 'KennardStone', label: 'Kennard-Stone', params: ['n_samples', 'metric'] },
  { value: 'SPXY', label: 'SPXY', params: ['n_samples', 'x_weight', 'y_weight'] },
  { value: 'Duplex', label: 'Duplex', params: ['n_samples'] },
  { value: 'BootstrapSplit', label: 'Bootstrap', params: ['n_splits', 'test_size'] },
];

const additionalModelOptions = [
  { value: 'IKPLS', label: 'Improved Kernel PLS', params: ['n_components'] },
  { value: 'EnPLS', label: 'Ensemble PLS', params: ['n_estimators', 'n_components'] },
  { value: 'MVPLS', label: 'MV-PLS', params: ['n_components'] },
  { value: 'nicon', label: 'nicon (CNN)', params: ['epochs', 'batch_size', 'lr'] },
  { value: 'MetaModel', label: 'Meta-Model (Stacking)', params: ['base_estimator'] },
];
```

**Deliverables:**
- [ ] All 30+ preprocessing operators
- [ ] All 8+ NIRS-specific splitters
- [ ] All model variants including deep learning

---

### Phase 2: Generation UX (Weeks 3-5) ✅ COMPLETED

**Goal:** Implement complete sweep and generator UI.

**Status:** Completed in January 2026

#### 2.1 Parameter Sweep UI ✅

**Priority:** Critical | **Effort:** High | **Status:** DONE

Implemented the inline sweep configuration system with popover-based editing:

**Components Created:**
- `SweepActivator` - Click icon on parameters to open sweep config
- `SweepConfigPopover` - Rich popover with type selection, range/choices config, live preview
- `SweepBadge` - Visual indicator showing sweep status and variant count
- Quick presets system for common parameters (n_components, alpha, window_length, etc.)

**Features Implemented:**
- Sweep type switching (range, log_range, choices)
- Live preview of generated values (up to 8 preview values)
- Quick presets based on parameter name matching
- Variant count display per sweep
- Apply/cancel workflow with local state management

**Deliverables:**
- [x] SweepActivator component
- [x] SweepConfigPopover component
- [x] Sweep type switching (range, log_range, choices)
- [x] Live preview of generated values
- [x] Quick presets for common ranges
- [x] Integration with StepConfigPanel (replaced inline SweepConfig)

#### 2.2 OR Generator UI ✅

**Priority:** Critical | **Effort:** High | **Status:** DONE

Implemented step-level OR generators with full combinatorics:

**Components Created:**
- `OrGeneratorContainer` - Wrapper for OR options with variant calculation
- `OrOptionItem` - Individual option with enable/disable, config access
- `OrGeneratorDropZone` - Drop target for adding options via drag
- `WrapInOrGeneratorPopover` - UI for wrapping steps in OR generator

**Features Implemented:**
- Selection modes: pick1 (one), pickN (combinations), arrange (permutations), all
- Per-option toggle (enable/disable)
- Combinatorics calculation: C(n,k) for pickN, P(n,k) for arrange
- Drag-to-add interaction via drop zone
- Color-coded by step type with consistent styling

**Deliverables:**
- [x] OR generator container visualization
- [x] Drag-to-combine interaction (OrGeneratorDropZone)
- [x] Selection mode UI (pick/arrange/all)
- [x] Per-option parameter configuration access
- [x] Variant count for OR generators with combinatorics

#### 2.3 Cartesian Generator UI ✅

**Priority:** High | **Effort:** Medium | **Status:** DONE

Implemented stage-based cartesian generation:

**Components Created:**
- `CartesianStage` - Single stage with option chips
- `CartesianGeneratorContainer` - Multi-stage container with add/remove
- `CartesianPreview` - Shows combination examples (up to 10)

**Features Implemented:**
- Stage-based organization with named stages
- Add/remove stages dynamically
- Add/remove options within each stage
- Combination count: product of all stage option counts
- Preview of first 10 combinations
- "More combinations" indicator for large spaces

**Deliverables:**
- [x] Stage-based visualization
- [x] Add/remove stages
- [x] Add/remove options within stages
- [x] Combination count preview
- [x] Matrix visualization for combinations (CartesianPreview)

#### 2.4 Active Sweeps Summary Panel ✅

**Priority:** Medium | **Effort:** Low | **Status:** DONE

Created overview panel for all active generations:

**Components Created:**
- `SweepsSummaryPanel` - Complete sweep breakdown with formula
- `SweepVsFinetuningAdvisor` - Smart recommendation for sweep vs finetuning

**Features Implemented:**
- Per-step sweep listing with individual variant counts
- Total variant formula display (e.g., "8 × 3 × 30 = 720")
- Severity-based color coding (low/medium/high/extreme thresholds)
- Warning messages for large search spaces
- Advisor component that recommends sweep vs finetuning based on variant count
- Collapsible panel for compact view

**Deliverables:**
- [x] SweepsSummaryPanel component
- [x] Per-step sweep listing
- [x] Clear/edit shortcuts (via onStepClick callback)
- [x] Sweep vs Finetuning recommendation advisor
- [x] Export-ready data structure

#### 2.5 Context Menus ✅ (Bonus - Moved from Phase 5)

**Priority:** Medium | **Effort:** Low | **Status:** DONE

Implemented context menus ahead of schedule as part of Phase 2:

**Components Created:**
- `StepContextMenu` - Full context menu for pipeline steps
- `GeneratorContextMenu` - Context menu for generator containers
- `BranchContextMenu` - Context menu for branch containers

**Features Implemented:**
- Step actions: duplicate, delete, enable/disable, move up/down
- Wrap in branch, add to OR generator
- Insert before/after options
- Parameter sweep submenu with quick sweep options
- Finetuning configuration option for model steps
- Generator-specific actions: convert between modes, add/remove options
- Branch-specific actions: add branch, collapse/expand, merge settings

**Deliverables:**
- [x] Context menu component for steps
- [x] Context menu for generators
- [x] Context menu for branches
- [x] Context-aware actions based on step type
- [x] Keyboard shortcut hints in menus

---

### Phase 3: Finetuning UX (Weeks 6-8) ✅ COMPLETED

**Goal:** Implement Optuna-based finetuning configuration.

#### 3.1 Finetuning Tab in Model Config ✅

**Priority:** Critical | **Effort:** High | **Status:** DONE

Implemented dedicated finetuning configuration for model steps:

**Components Created:**
- `FinetuneTab` - Main tab component for model step finetuning config
- `FinetuneEnableToggle` - Master on/off toggle with visual feedback
- `FinetuneSearchConfig` - Trials, timeout, approach, evaluation mode config
- `FinetuneParamList` - Parameters to optimize with add/remove
- `FinetuneParamEditor` - Individual param config with type-specific editors
- `FinetuningBadge` - Visual indicator component
- `QuickFinetuneButton` - One-click finetuning setup

**UX Flow Implemented:**
1. Select model step → Tabs UI appears (Parameters | Finetuning | Training)
2. Switch to "Finetuning" tab
3. Enable finetuning toggle (visual feedback with purple accent)
4. Configure search settings (trials, timeout, approach, eval_mode)
5. Add parameters to optimize from model-aware presets
6. Configure search space for each parameter with type-specific editors

**Deliverables:**
- [x] Finetuning tab in StepConfigPanel with tabbed UI for model steps
- [x] Enable/disable toggle with visual indicator (purple glow effect)
- [x] Search configuration form (trials, timeout, approach, eval_mode)
- [x] Parameter list with add/remove functionality
- [x] Search space configuration per parameter
- [x] Training tab for deep learning models with presets

#### 3.2 Parameter Search Space Editor ✅

**Priority:** High | **Effort:** Medium | **Status:** DONE

Implemented detailed configuration for tunable parameters:

**Types Supported:**
- `int`: low, high, step (optional) with proper validation
- `float`: low, high with decimal precision
- `log_float`: low, high (log scale) for learning rates etc.
- `categorical`: list of choices with chip-style display

**Validation Implemented:**
- Ensures low < high for numeric types
- Step validation for integer ranges
- Categorical requires at least 2 choices
- Real-time validation with inline error messages

**Model-Aware Presets:**
- PLS: n_components (1-50)
- SVM: C (log 0.001-1000), gamma (log 0.0001-10), epsilon (0.01-1)
- Random Forest: n_estimators (10-500), max_depth (2-50), min_samples_split (2-20)
- Ensemble: base model parameters
- Deep Learning: learning_rate (log), batch_size, epochs

**Deliverables:**
- [x] Type-specific input forms (int, float, log_float, categorical)
- [x] Validation with inline error messages
- [x] Preview of search space in parameter list
- [x] Common presets per model type
- [x] Smart parameter suggestions based on model class

#### 3.3 Sweep vs Finetuning Advisor ✅

**Priority:** Medium | **Effort:** Low | **Status:** DONE

Integrated with existing `SweepVsFinetuningAdvisor` from Phase 2:

```typescript
// Recommendation logic (from SweepVsFinetuningAdvisor)
function recommendStrategy(variantCount: number, hasModel: boolean): 'sweep' | 'finetune' | 'hybrid' {
  if (!hasModel) return 'sweep';
  if (variantCount <= 50) return 'sweep';
  if (variantCount > 1000) return 'finetune';
  return 'hybrid';
}
```

**Integration Points:**
- Advisor appears in SweepsSummaryPanel when variant count is high
- FinetuneTab shows contextual tips about when to use finetuning
- Color-coded severity (purple for finetuning recommendation)

**Deliverables:**
- [x] Recommendation integrated in sweep summary
- [x] One-click navigation to finetuning config
- [x] Explanation of tradeoffs in tooltips and info sections

#### 3.4 Finetuning Visual Indicators ✅

**Priority:** Medium | **Effort:** Low | **Status:** DONE

Implemented clear visual distinction between sweep and finetuning:

**Color Scheme:**
- **Sweep Icon:** 🔀 Repeat icon (orange accent - `text-orange-500`)
- **Finetuning Icon:** ✨ Sparkles icon (purple accent - `text-purple-500`)
- Model steps with finetuning have purple border/badge
- Steps with sweeps have orange border/badge

**TreeNode Integration:**
- Purple badge with Sparkles icon for steps with finetuning enabled
- Tooltip shows trial count and parameter count
- Badge appears alongside sweep badge (can have both)
- Context menu includes "Configure Finetuning" for model steps

**FinetuningBadge Component:**
- Compact badge for use in step headers
- Shows trial count and parameter count on hover
- Consistent purple color scheme

**Deliverables:**
- [x] Icon and color scheme (Sparkles + purple)
- [x] Step badges in TreeNode
- [x] FinetuningBadge component for reuse
- [x] Context menu integration for quick access

---

### Phase 4: Advanced Pipeline Features (Weeks 9-11) ✅ COMPLETED

**Goal:** Complete implementation of complex pipeline patterns.

**Status:** Completed in January 2026

#### 4.1 Y-Processing UI ✅

**Priority:** High | **Effort:** Medium | **Status:** DONE

Implemented dedicated target scaling configuration:

**Components Created:**
- `YProcessingPanel` - Main panel with scaler selection and parameter config
- `YProcessingCompact` - Compact inline version
- `YProcessingBadge` - Visual indicator for pipeline tree
- `YProcessingQuickSetup` - One-click enablement

**Scalers Implemented:**
- MinMaxScaler (with feature_range_min, feature_range_max)
- StandardScaler
- RobustScaler
- PowerTransformer (method: yeo-johnson/box-cox)
- QuantileTransformer (output_distribution, n_quantiles)
- IntegerKBinsDiscretizer (n_bins, strategy)
- RangeDiscretizer (custom ranges)

**Features:**
- Enable/disable toggle with amber visual feedback
- Scaler selection dropdown with categorized options (Scaling, Transform, Discretization)
- Parameter configuration with contextual help
- Model-aware recommendations (e.g., MinMaxScaler for neural networks)
- Integration with StepConfigPanel via YProcessingStepContent

**Deliverables:**
- [x] Y-processing section in pipeline
- [x] Scaler selection dropdown with 7 options
- [x] Parameter configuration per scaler
- [x] Visual indicator in pipeline tree (amber badge)

#### 4.2 Feature Augmentation UI ✅

**Priority:** High | **Effort:** High | **Status:** DONE

Implemented multi-channel preprocessing generation:

**Components Created:**
- `FeatureAugmentationPanel` - Main configuration container
- `FeatureAugmentationCompact` - Compact version
- `FeatureAugmentationBadge` - Pipeline tree badge
- `AddTransformDialog` - Dialog for adding transforms from palette
- `TransformItem` - Individual transform with expandable params

**Features:**
- Action mode selection (extend, add, replace) with visual explanations
- Transform list management with add/remove
- Per-transform parameter editing
- Enable/disable individual transforms
- Output shape preview showing channel count
- Preset system: NIRS Standard, Scatter Variants, Derivative Comparison, Smoothing Levels
- Indigo color scheme for visual distinction

**Deliverables:**
- [x] Action mode selection (extend, add, replace)
- [x] Transform list management
- [x] Output shape preview
- [x] Integration with palette (via AddTransformDialog)

#### 4.3 MetaModel (Stacking) UI ✅

**Priority:** Medium | **Effort:** High | **Status:** DONE

Implemented stacking ensemble configuration:

**Components Created:**
- `StackingPanel` - Main panel for configuring stacking
- `StackingBadge` - Visual indicator
- `MergeStackingSetup` - Quick setup from merge step
- `StackingDiagram` - Visual flow diagram

**Meta-Models Implemented:**
- Ridge (alpha)
- Lasso (alpha)
- ElasticNet (alpha, l1_ratio)
- PLSRegression (n_components)
- RandomForestRegressor (n_estimators, max_depth)
- XGBoost (n_estimators, learning_rate, max_depth)
- SVR (kernel, C)

**Features:**
- Enable/disable toggle with pink visual feedback
- Meta-model selection with categorized options (Linear, PLS, Ensemble, SVM)
- Parameter configuration per meta-model
- Source model selection (all or specific)
- Coverage strategies: drop, fill (with value), model
- Passthrough option for original features
- Visual stacking diagram showing flow (Base Models → OOF → MetaModel)
- Integration with merge steps via MergeStepContent with tabs

**Deliverables:**
- [x] Merge step configuration with stacking tab
- [x] MetaModel step type with 7 meta-model options
- [x] Visual stacking layout (StackingDiagram)
- [x] OOF predictions explanation in UI

#### 4.4 Branch Enhancements ✅

**Priority:** Medium | **Effort:** Medium | **Status:** DONE

Improved branch visualization and interaction:

**Components Created:**
- `EnhancedBranchHeader` - Header with naming, collapse, stats
- `BranchSummary` - Step count and variant display
- `BranchOutputIndicator` - Shows output type (features/predictions)
- `CollapsibleBranchContainer` - Wrapper with collapse state
- `AddBranchButton` - Add new branch action
- `CollapseAllButton` - Collapse/expand all action

**Features Implemented:**
- Collapsible branches with smooth animation
- Branch naming with inline editing
- Per-branch variant count annotation
- Branch output type indicators (features vs predictions)
- Collapse all/expand all functionality
- Dropdown menu with branch actions (rename, duplicate, remove)
- Color scheme: Cyan for branch, Orange for content

**Deliverables:**
- [x] Collapsible branch UI
- [x] Branch naming/renaming
- [x] Per-branch variant count
- [x] Branch summary badges

---

### Phase 5: UX Polish (Weeks 12-14) ✅ COMPLETED

**Goal:** Implement retained UX enhancements and polish.

#### 5.1 Keyboard Navigation ✅

**Priority:** Medium | **Effort:** Medium | **Status:** DONE

Full keyboard support as specified in Section 3.3.

**Implementation:** `src/hooks/useKeyboardNavigation.ts`

**Deliverables:**
- [x] Arrow key navigation (↑/↓ for steps, ←/→ for branches)
- [x] Tab cycling between panels (Palette → Tree → Config)
- [x] All shortcuts implemented (Ctrl+D, Delete, Ctrl+Z, Ctrl+Shift+Z, Escape)
- [x] Keyboard shortcut help panel (Ctrl+/)
- [x] Command palette (Ctrl+K)

#### 5.2 Right-Click Context Menus ✅ (Moved to Phase 2)

**Priority:** Medium | **Effort:** Low | **Status:** DONE (Completed in Phase 2)

Context-aware menus as specified in Section 3.4.

**Note:** This feature was implemented ahead of schedule as part of Phase 2. See Phase 2.5 for implementation details.

**Deliverables:**
- [x] Context menu component (StepContextMenu, GeneratorContextMenu, BranchContextMenu)
- [x] Context detection (preprocessing vs model)
- [x] All menu actions wired up

#### 5.3 Enhanced Branch Visualization ✅

**Priority:** Medium | **Effort:** Medium | **Status:** DONE (Core in Phase 4, Polish in Phase 5)

Visual improvements as specified in Section 3.2.

**Implementation:**
- `src/components/pipeline-editor/BranchEnhancements.tsx` (Phase 4)
- `src/components/pipeline-editor/FocusIndicator.tsx` (Phase 5)

**Deliverables:**
- [x] Collapsible branch containers with persistence
- [x] Branch naming with inline editing
- [x] Per-branch variant count display
- [x] Focus ring indicators for panels
- [x] Step navigation highlighting

#### 5.4 Execution Preview Panel ✅

**Priority:** Low | **Effort:** Medium | **Status:** DONE

Combined visualization of generation + finetuning impact:

**Implementation:** `src/components/pipeline-editor/ExecutionPreviewPanel.tsx`

**Deliverables:**
- [x] Execution breakdown panel with collapsible details
- [x] Total fit count estimation (sweeps × trials × folds)
- [x] Performance warnings with severity colors
- [x] Optimization suggestions (reduce sweeps, trials, folds)
- [x] Time estimation with human-readable formatting
- [x] Compact inline version for header use

#### 5.5 Command Palette ✅

**Priority:** Medium | **Effort:** Medium | **Status:** DONE

VS Code-inspired quick action palette.

**Implementation:** `src/components/pipeline-editor/CommandPalette.tsx`

**Deliverables:**
- [x] Search-as-you-type filtering
- [x] Step actions (configure, duplicate, delete, move)
- [x] Navigation to any step
- [x] Pipeline actions (save, export, favorite)
- [x] Add step shortcuts
- [x] Keyboard shortcut hints in menu items

---

### Phase 6: Integration & Documentation (Weeks 15-16) ✅ COMPLETED

**Goal:** Backend integration and documentation.

**Status:** Completed in January 2026

#### 6.1 Backend API Integration ✅

**Priority:** Critical | **Effort:** High | **Status:** DONE

Connected UI to nirs4all execution:

**Backend Implementation (`api/pipelines.py`):**
- `POST /pipelines/{id}/execute` - Execute pipeline as background job
- Uses `job_manager.submit_job()` for async execution
- WebSocket progress updates via `ws_manager.broadcast_to_channel()`
- Result includes best_score, best_rmse, best_r2, top results, model_path

**Pipeline Serialization (`api/nirs4all_adapter.py`):**
- `build_full_pipeline()` - Complete conversion from frontend JSON
- `_build_generator_sweep()` - Convert sweep configs to nirs4all syntax
- `_build_finetuning_params()` - Convert to Optuna `finetune_params`
- `_build_y_processing()` - Convert to scaler instances
- `_convert_step_to_nirs4all()` - Individual step conversion

**Execution Flow:**
1. Frontend calls `/pipelines/{id}/execute` with dataset path
2. Backend creates job via `job_manager.submit_job()`
3. `_run_pipeline_task()` builds pipeline and calls `nirs4all.run()`
4. Progress updates sent via WebSocket channel `pipeline_{job_id}`
5. Result returned with metrics and model path

**Deliverables:**
- [x] Pipeline serialization to nirs4all format
- [x] Training execution endpoint
- [x] Progress streaming via WebSocket
- [x] Result visualization in dialog

#### 6.2 Export Capabilities ✅

**Priority:** Medium | **Effort:** Low | **Status:** DONE

**Backend Implementation:**
- `POST /pipelines/{id}/export` - Export to python/yaml/json formats
- `export_pipeline_to_python()` - Generates executable Python code with imports
- `export_pipeline_to_yaml()` - Generates YAML configuration
- `POST /pipelines/import` - Import from yaml/json

**Frontend Implementation (`usePipelineExecution.ts`):**
- `usePipelineExport()` hook with format options
- `downloadExport()` - Download file with appropriate extension
- `copyExportToClipboard()` - Copy content for pasting
- Export panel in PipelineExecutionDialog

**Deliverables:**
- [x] Export as Python code (with imports, comments)
- [x] Export as YAML config
- [x] Export as JSON (full state preservation)
- [x] Import from YAML/JSON

#### 6.3 Documentation & Help ✅

**Priority:** Medium | **Effort:** Low | **Status:** DONE

**Implementation (`HelpSystem.tsx`):**

**Components:**
- `HelpTooltip` - Simple inline help with content prop
- `ParameterHelp` - Rich popover with type, default, range, tip
- `OperatorHelpCard` - Full documentation card with all sections
- `WhatsThisButton` - Toggle button for help mode
- `OperatorHelpPanel` - Floating panel for active operator
- `InfoCallout` - Contextual tips (info/tip/warning variants)

**Context System:**
- `HelpModeProvider` - Context provider for help mode state
- `useHelpMode()` - Hook to access help mode, active operator

**Help Content Database:**
- Pre-populated entries for common operators
- Structure: name, displayName, category, description, longDescription
- Parameters with type, default, range, options, tip
- Examples, tips, seeAlso, docUrl fields

**Covered Operators:**
- SNV, MSC (Scatter Correction)
- SavitzkyGolay (Smoothing/Derivatives)
- PLSRegression (Model)
- KFold, KennardStoneSplitter (Splitting)

**Deliverables:**
- [x] Inline help tooltips (`HelpTooltip`)
- [x] Parameter documentation with rich popover (`ParameterHelp`)
- [x] "What's This?" mode toggle (`WhatsThisButton`, `useHelpMode`)
- [x] Operator documentation cards (`OperatorHelpCard`)
- [x] Contextual help database with extensible structure

---

### Summary Timeline

| Phase | Weeks | Focus | Key Deliverables | Status |
|-------|-------|-------|------------------|--------|
| 1 | 1-2 | Foundation | Types, variant counting, operator catalog | ✅ DONE |
| 2 | 3-5 | Generation | Sweeps, OR generators, Cartesian, Context Menus | ✅ DONE |
| 3 | 6-8 | Finetuning | Optuna config, search space, indicators | ✅ DONE |
| 4 | 9-11 | Advanced | y_processing, augmentation, stacking, branches | ✅ DONE |
| 5 | 12-14 | Polish | Keyboard, visualization, command palette | ✅ DONE |
| 6 | 15-16 | Integration | Backend execution, export, help system | ✅ DONE |

**Progress:** All 6 phases complete! Pipeline editor feature is production-ready.

**Total Duration:** 16 weeks (completed)

**Completed Features:**
1. ✅ Complete operator catalog with 80+ operators
2. ✅ Parameter sweep UI with variant counting
3. ✅ Optuna finetuning integration
4. ✅ Y-processing and feature augmentation
5. ✅ Stacking ensembles with MetaModel
6. ✅ Keyboard navigation and command palette
7. ✅ Backend execution with WebSocket progress
8. ✅ Export to Python/YAML/JSON
9. ✅ Inline help and documentation system

---

## Appendix A: Operator Registry for Palette

Complete list of operators to add to `stepOptions` in `types.ts`:

```typescript
const preprocessingOptions: StepOption[] = [
  // NIRS Core
  { name: "SNV", description: "Standard Normal Variate", defaultParams: {} },
  { name: "RobustSNV", description: "Robust SNV (outlier-resistant)", defaultParams: {} },
  { name: "MSC", description: "Multiplicative Scatter Correction", defaultParams: { reference: "mean" } },
  { name: "FirstDerivative", description: "First spectral derivative", defaultParams: {} },
  { name: "SecondDerivative", description: "Second spectral derivative", defaultParams: {} },
  { name: "SavitzkyGolay", description: "Smoothing and derivatives", defaultParams: { window_length: 11, polyorder: 2, deriv: 0 } },

  // Wavelet
  { name: "Haar", description: "Haar wavelet decomposition", defaultParams: {} },
  { name: "Wavelet", description: "Wavelet transform", defaultParams: { wavelet: "db4", level: 3 } },

  // Baseline
  { name: "ASLSBaseline", description: "Asymmetric Least Squares baseline", defaultParams: { lam: 1e6, p: 0.01 } },
  { name: "AirPLS", description: "Adaptive Iteratively Reweighted PLS baseline", defaultParams: {} },
  { name: "SNIP", description: "SNIP baseline", defaultParams: { max_half_window: 40 } },

  // Signal
  { name: "Detrend", description: "Remove polynomial trends", defaultParams: { order: 2 } },
  { name: "Gaussian", description: "Gaussian smoothing", defaultParams: { sigma: 2 } },
  { name: "LogTransform", description: "Logarithmic transform", defaultParams: {} },
  { name: "ReflectanceToAbsorbance", description: "Convert reflectance to absorbance", defaultParams: {} },

  // Feature Selection
  { name: "CARS", description: "Competitive Adaptive Reweighted Sampling", defaultParams: { n_pls_components: 10 } },
  { name: "MCUVE", description: "Monte Carlo UVE", defaultParams: { n_components: 10 } },

  // Scaling
  { name: "StandardScaler", description: "Standardize features", defaultParams: {} },
  { name: "MinMaxScaler", description: "Min-Max normalization", defaultParams: { feature_range_min: 0, feature_range_max: 1 } },
  { name: "RobustScaler", description: "Robust scaling with median", defaultParams: {} },
  { name: "Normalize", description: "L1/L2 normalization", defaultParams: { norm: "l2" } },

  // Feature Ops
  { name: "CropTransformer", description: "Trim wavelength range", defaultParams: { start: 0, end: -1 } },
  { name: "Resampler", description: "Wavelength resampling", defaultParams: { n_points: 512 } },
];

const modelOptions: StepOption[] = [
  // Standard
  { name: "PLSRegression", description: "Partial Least Squares", defaultParams: { n_components: 10 } },
  { name: "PLSDA", description: "PLS Discriminant Analysis", defaultParams: { n_components: 10 } },

  // Advanced PLS
  { name: "OPLS", description: "Orthogonal PLS", defaultParams: { n_components: 10 } },
  { name: "IntervalPLS", description: "Interval PLS for band selection", defaultParams: { n_components: 10, n_intervals: 20 } },
  { name: "SparsePLS", description: "Sparse PLS with L1", defaultParams: { n_components: 10, alpha: 0.1 } },
  { name: "LWPLS", description: "Locally Weighted PLS", defaultParams: { n_components: 10 } },
  { name: "KernelPLS", description: "Kernel PLS (non-linear)", defaultParams: { n_components: 10, kernel: "rbf" } },

  // sklearn
  { name: "RandomForestRegressor", description: "Random Forest", defaultParams: { n_estimators: 100, max_depth: 10 } },
  { name: "SVR", description: "Support Vector Regression", defaultParams: { kernel: "rbf", C: 1.0 } },
  { name: "Ridge", description: "Ridge regression", defaultParams: { alpha: 1.0 } },
  { name: "Lasso", description: "Lasso regression", defaultParams: { alpha: 1.0 } },
  { name: "ElasticNet", description: "Elastic Net", defaultParams: { alpha: 1.0, l1_ratio: 0.5 } },

  // Gradient Boosting
  { name: "XGBoost", description: "XGBoost", defaultParams: { n_estimators: 100, learning_rate: 0.1, max_depth: 6 } },
  { name: "LightGBM", description: "LightGBM", defaultParams: { n_estimators: 100, learning_rate: 0.1 } },

  // Deep Learning
  { name: "nicon", description: "NIRS-specific CNN (nirs4all)", defaultParams: {} },
  { name: "CNN1D", description: "1D Convolutional Network", defaultParams: { layers: 3, filters: 64 } },
  { name: "MLP", description: "Multi-layer Perceptron", defaultParams: { hidden_layers: "100,50" } },

  // Meta
  { name: "MetaModel", description: "Stacking ensemble", defaultParams: { source_models: "all" } },
];
```

---

## Appendix B: UI Mockups

### B.1 y_processing Panel

```
┌─ Target Processing ──────────────────┐
│                                      │
│ ☑ Enable y_processing                │
│                                      │
│ Scaler: [MinMaxScaler ▾]             │
│                                      │
│ Parameters:                          │
│   feature_range: [0, 1]              │
│                                      │
│ ℹ️ Target values will be scaled      │
│    before training and inverse-      │
│    transformed for predictions       │
└──────────────────────────────────────┘
```

### B.2 Optimization Panel

```
┌─ Hyperparameter Optimization ────────┐
│                                      │
│ ☑ Enable Optuna Optimization         │
│                                      │
│ Trials: [50    ]                     │
│ Timeout: [3600  ] seconds            │
│                                      │
│ Parameters to optimize:              │
│ ┌──────────────────────────────────┐ │
│ │ n_components: int [1, 30]        │ │
│ │ [+ Add Parameter]                │ │
│ └──────────────────────────────────┘ │
│                                      │
│ Approach: [Grouped ▾]                │
│ Eval Mode: [Best ▾]                  │
└──────────────────────────────────────┘
```

### B.3 Feature Augmentation

```
┌─ Feature Augmentation ───────────────┐
│                                      │
│ Mode: [Extend ▾]                     │
│                                      │
│ Transforms:                          │
│ ┌──────────────────────────────────┐ │
│ │ 1. SNV                    [×]    │ │
│ │ 2. FirstDerivative        [×]    │ │
│ │ 3. SavitzkyGolay(d=1)     [×]    │ │
│ │                                  │ │
│ │ [+ Add Transform]                │ │
│ └──────────────────────────────────┘ │
│                                      │
│ Generated processings: 4             │
│ (original + 3 augmented)             │
└──────────────────────────────────────┘
```

---

## Conclusion

The pipeline editor is now **feature-complete** with all 6 phases implemented. The implementation provides a comprehensive, production-ready interface for building, configuring, and executing nirs4all pipelines.

### Key Achievements

1. **Complete Generation & Finetuning System** - Phases 1-4 delivered the core value-add features: sweep generation with variant counting, Optuna-based hyperparameter finetuning, y-processing, feature augmentation, and stacking ensembles. These features differentiate nirs4all from simple pipeline builders.

2. **Full Operator Catalog** - 80+ operators across all categories: preprocessing (38), splitters (16), models (30+), augmentation (10), filters (4).

3. **Polished UX** - Phase 5 delivered keyboard navigation, command palette, focus indicators, and execution preview. Users can work efficiently without touching the mouse.

4. **Backend Integration Complete** - Phase 6 connected the UI to actual nirs4all execution:
   - Real-time progress via WebSocket
   - Export to Python code, YAML, JSON
   - Import from YAML/JSON
   - Complete serialization of generators, finetuning, y_processing

5. **Help System** - Inline documentation with "What's This?" mode, parameter tooltips, operator cards, and contextual tips.

### Success Metrics - All Achieved ✅

The pipeline editor is complete - users can:

1. ✅ Configure any nirs4all operator with all parameters *(Phase 1)*
2. ✅ Create parameter sweeps with visual feedback and variant counting *(Phase 2)*
3. ✅ Configure Optuna finetuning with intuitive search space definition *(Phase 3)*
4. ✅ Build stacking ensembles with MetaModel *(Phase 4)*
5. ✅ Use feature augmentation for multi-channel preprocessing *(Phase 4)*
6. ✅ Configure target variable processing with y_processing *(Phase 4)*
7. ✅ Navigate efficiently with keyboard shortcuts and context menus *(Phase 2, 5)*
8. ✅ Execute pipelines with real-time progress feedback *(Phase 6)*
9. ✅ Export pipelines to Python/YAML for reproducibility *(Phase 6)*
10. ✅ Access inline help and documentation *(Phase 6)*

### Files Created/Modified in Phase 6

**Backend:**
- `api/nirs4all_adapter.py` - Enhanced with `build_full_pipeline()`, export functions
- `api/pipelines.py` - Added execute, export, import endpoints

**Frontend:**
- `src/hooks/usePipelineExecution.ts` - Execution, export, validation hooks
- `src/components/pipeline-editor/PipelineExecutionDialog.tsx` - Execution UI
- `src/components/pipeline-editor/HelpSystem.tsx` - Inline help components
- `src/components/pipeline-editor/index.ts` - Updated exports

### Next Steps (Post-Implementation)

While the pipeline editor is feature-complete, potential enhancements include:

1. **Tutorial Overlays** - Guided walkthrough for first-time users
2. **Pipeline Templates** - Pre-built pipelines for common NIRS workflows
3. **Sharing URLs** - Share pipeline configurations via URL
4. **Result Visualization** - Enhanced charts for predictions, residuals
5. **Comparison View** - Side-by-side comparison of pipeline variants

**Total Duration:** 16 weeks (completed)

The gap analysis shows that all core features are now implemented. The pipeline editor is ready for production use.

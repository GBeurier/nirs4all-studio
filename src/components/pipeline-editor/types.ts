/**
 * Pipeline Editor Types
 * Tree-based pipeline structure with support for nested branches and generators
 *
 * Aligned with nirs4all library capabilities:
 * - 30+ preprocessing operators including NIRS-specific transforms
 * - Advanced PLS variants (OPLS, PLSDA, SparsePLS, etc.)
 * - Hyperparameter optimization via Optuna (finetuning)
 * - Parameter sweeps for exhaustive grid search
 * - Multi-source data support
 * - Target (y) processing
 */

export type StepType =
  | "preprocessing"
  | "y_processing"        // Target variable scaling/processing
  | "splitting"
  | "model"
  | "generator"
  | "branch"
  | "merge"
  | "filter"              // Sample filtering (outliers, conditions)
  | "augmentation";       // Sample augmentation (training-time)

// Generator types for step-level generators
export type GeneratorKind = "or" | "cartesian";

// Parameter sweep types for parameter-level generators
export type SweepType = "range" | "log_range" | "grid" | "or";

// Parameter sweep configuration
export interface ParameterSweep {
  type: SweepType;
  // For range/log_range
  from?: number;
  to?: number;
  step?: number;
  count?: number; // For log_range or limiting
  // For or (discrete choices)
  choices?: (string | number | boolean)[];
  // For grid (multiple params - used at step level)
  gridParams?: Record<string, (string | number | boolean)[]>;
}

// Finetuning parameter search space types
export type FinetuneParamType = "int" | "float" | "categorical" | "log_float";

// Individual parameter search space for Optuna
export interface FinetuneParamConfig {
  name: string;
  type: FinetuneParamType;
  low?: number;           // For int, float, log_float
  high?: number;          // For int, float, log_float
  step?: number;          // Optional step for int
  choices?: (string | number)[];  // For categorical
}

// Optuna finetuning configuration
export interface FinetuneConfig {
  enabled: boolean;
  n_trials: number;
  timeout?: number;       // Max optimization time in seconds
  approach: "grouped" | "individual";  // Shared across folds vs per-fold
  eval_mode: "best" | "mean";          // Score evaluation mode
  model_params: FinetuneParamConfig[];
}

// Training parameters for deep learning models
export interface TrainingConfig {
  epochs: number;
  batch_size: number;
  learning_rate: number;
  patience?: number;      // Early stopping patience
  optimizer: "adam" | "sgd" | "rmsprop" | "adamw";
  callbacks?: string[];   // Training callbacks
}

export interface PipelineStep {
  id: string;
  type: StepType;
  name: string;
  params: Record<string, string | number | boolean>;
  // Parameter sweeps: which params have generators attached
  paramSweeps?: Record<string, ParameterSweep>;
  // For branching steps: list of parallel pipelines
  branches?: PipelineStep[][];
  // Branch metadata (names, collapsed state)
  branchMetadata?: {
    name?: string;
    isCollapsed?: boolean;
  }[];
  // For generator steps (OR, Cartesian): child steps/options
  generatorKind?: GeneratorKind;
  generatorOptions?: {
    pick?: number | [number, number]; // Combinations
    arrange?: number | [number, number]; // Permutations
    count?: number; // Limit variants
  };
  // Finetuning configuration (for model steps)
  finetuneConfig?: FinetuneConfig;
  // Training configuration (for deep learning models)
  trainingConfig?: TrainingConfig;
  // Y-Processing configuration (for pipeline-level target scaling)
  yProcessingConfig?: {
    enabled: boolean;
    scaler: string;
    params: Record<string, string | number | boolean>;
  };
  // Feature augmentation configuration
  featureAugmentationConfig?: {
    enabled: boolean;
    action: "extend" | "add" | "replace";
    transforms: {
      id: string;
      name: string;
      params: Record<string, string | number | boolean>;
      enabled: boolean;
    }[];
  };
  // Stacking/MetaModel configuration (for merge steps)
  stackingConfig?: {
    enabled: boolean;
    metaModel: string;
    metaModelParams: Record<string, string | number | boolean>;
    sourceModels: string[];
    coverageStrategy: "drop" | "fill" | "model";
    fillValue?: number;
    useOriginalFeatures: boolean;
    passthrough: boolean;
  };
  // Step enabled/disabled state
  enabled?: boolean;
  // Custom step name for reference in MetaModel
  customName?: string;
  // Tags for categorization
  tags?: string[];
}

export interface StepOption {
  name: string;
  description: string;
  defaultParams: Record<string, string | number | boolean>;
  defaultBranches?: PipelineStep[][];
  generatorKind?: GeneratorKind;
  category?: string;        // Subcategory for palette organization
  isDeepLearning?: boolean; // Flag for DL models (show training config)
  isAdvanced?: boolean;     // Flag for advanced/expert options
  tags?: string[];          // Searchable tags
}

export interface StepCategory {
  type: StepType;
  label: string;
  options: StepOption[];
}

export interface SavedPipeline {
  id: string;
  name: string;
  description?: string;
  steps: PipelineStep[];
  category: "user" | "preset" | "shared";
  isFavorite: boolean;
  tags: string[];
  created_at: string;
  last_modified: string;
  run_count?: number;
  last_run_status?: "success" | "failed" | "running";
}

// DnD Types
export type DragItemType = "palette-item" | "pipeline-step";

export interface DragData {
  type: DragItemType;
  stepType?: StepType;
  option?: StepOption;
  stepId?: string;
  step?: PipelineStep;
  sourcePath?: string[]; // Path to the step in the tree (for nested branches)
}

export interface DropIndicator {
  path: string[]; // Path to the parent container
  index: number; // Insert position
  position: "before" | "after" | "inside"; // Where relative to the target
}

// Utility to calculate sweep variant count
/**
 * @deprecated Use the `useVariantCount` hook instead, which calls the nirs4all
 * backend API for accurate variant counting. This local calculation is kept
 * for offline/fallback scenarios but may not match nirs4all's actual behavior.
 * @see useVariantCount from '@/hooks/useVariantCount'
 */
export function calculateSweepVariants(sweep: ParameterSweep): number {
  switch (sweep.type) {
    case "range":
      if (sweep.from !== undefined && sweep.to !== undefined) {
        const step = sweep.step ?? 1;
        return Math.max(1, Math.floor((sweep.to - sweep.from) / step) + 1);
      }
      return 0;
    case "log_range":
      return sweep.count ?? 5;
    case "or":
      return sweep.choices?.length ?? 0;
    case "grid":
      if (sweep.gridParams) {
        return Object.values(sweep.gridParams).reduce(
          (acc, vals) => acc * vals.length, 1
        );
      }
      return 0;
    default:
      return 0;
  }
}

// Calculate total variants for a step (product of all param sweeps)
/**
 * @deprecated Use the `useVariantCount` hook instead, which calls the nirs4all
 * backend API for accurate variant counting. This local calculation is kept
 * for offline/fallback scenarios but may not match nirs4all's actual behavior.
 * @see useVariantCount from '@/hooks/useVariantCount'
 */
export function calculateStepVariants(step: PipelineStep): number {
  let variants = 1;

  // Parameter-level sweeps
  if (step.paramSweeps && Object.keys(step.paramSweeps).length > 0) {
    variants = Object.values(step.paramSweeps).reduce(
      (acc, sweep) => acc * calculateSweepVariants(sweep), 1
    );
  }

  // Generator options (OR with pick/arrange)
  if (step.generatorKind === "or" && step.branches) {
    const branchCount = step.branches.length;
    const pick = step.generatorOptions?.pick;

    if (typeof pick === "number" && pick > 0) {
      // Combinations: C(n, k)
      variants *= binomialCoefficient(branchCount, pick);
    } else {
      // Default: pick 1
      variants *= branchCount;
    }
  } else if (step.generatorKind === "cartesian" && step.branches) {
    // Cartesian: product of all stage options
    variants *= step.branches.reduce((acc, stage) => acc * Math.max(1, stage.length), 1);
  }

  return variants;
}

// Calculate binomial coefficient C(n, k) for pick combinations
function binomialCoefficient(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;

  let result = 1;
  for (let i = 0; i < k; i++) {
    result = result * (n - i) / (i + 1);
  }
  return Math.round(result);
}

// Calculate total pipeline variants (recursive through all steps)
/**
 * @deprecated Use the `useVariantCount` hook instead, which calls the nirs4all
 * backend API for accurate variant counting. This local calculation is kept
 * for offline/fallback scenarios but may not match nirs4all's actual behavior.
 * @see useVariantCount from '@/hooks/useVariantCount'
 */
export function calculatePipelineVariants(steps: PipelineStep[]): number {
  let totalVariants = 1;

  for (const step of steps) {
    // Skip disabled steps
    if (step.enabled === false) continue;

    // Step-level variants (parameter sweeps + generator)
    totalVariants *= calculateStepVariants(step);

    // Recurse into branches for parallel execution (non-generator branches)
    if (step.type === "branch" && step.branches && !step.generatorKind) {
      // For parallel branches, variants are multiplied from each branch
      for (const branch of step.branches) {
        totalVariants *= calculatePipelineVariants(branch);
      }
    }

    // For generators, we already counted in calculateStepVariants
    // but we need to multiply by variants WITHIN each branch
    if (step.generatorKind && step.branches) {
      // Each branch's internal variants contribute
      let maxBranchVariants = 0;
      for (const branch of step.branches) {
        const branchVariants = calculatePipelineVariants(branch);
        maxBranchVariants = Math.max(maxBranchVariants, branchVariants);
      }
      // For OR: we run one branch at a time, so variants are additive not multiplicative
      // For Cartesian: still multiplicative within each stage combination
      if (step.generatorKind === "or" && maxBranchVariants > 1) {
        // OR generator: the max internal variants matters
        totalVariants *= maxBranchVariants;
      }
    }
  }

  return totalVariants;
}

// Get detailed variant breakdown for display
/**
 * @deprecated Use the `useVariantCount` hook's `breakdown` property instead,
 * which calls the nirs4all backend API for accurate variant counting.
 * @see useVariantCount from '@/hooks/useVariantCount'
 */
export interface VariantBreakdown {
  stepId: string;
  stepName: string;
  stepType: StepType;
  variants: number;
  sweeps: { param: string; count: number; display: string }[];
  children?: VariantBreakdown[];
}

export function getVariantBreakdown(steps: PipelineStep[]): VariantBreakdown[] {
  return steps
    .filter(step => step.enabled !== false)
    .map(step => {
      const sweeps = step.paramSweeps
        ? Object.entries(step.paramSweeps).map(([param, sweep]) => ({
            param,
            count: calculateSweepVariants(sweep),
            display: formatSweepDisplay(sweep),
          }))
        : [];

      const breakdown: VariantBreakdown = {
        stepId: step.id,
        stepName: step.name,
        stepType: step.type,
        variants: calculateStepVariants(step),
        sweeps,
      };

      // Add children for branches
      if (step.branches) {
        breakdown.children = step.branches.flatMap((branch, idx) =>
          getVariantBreakdown(branch).map(b => ({
            ...b,
            stepName: `${step.generatorKind === "cartesian" ? "Stage" : "Branch"} ${idx + 1}: ${b.stepName}`
          }))
        );
      }

      return breakdown;
    });
}

// Step options configuration (for component library)
// Organized by category with subcategories for better UX
export const stepOptions: Record<StepType, StepOption[]> = {
  preprocessing: [
    // === NIRS-Specific Transforms ===
    { name: "SNV", description: "Standard Normal Variate normalization", defaultParams: {}, category: "NIRS Core" },
    { name: "RobustSNV", description: "Outlier-resistant SNV (RNV)", defaultParams: {}, category: "NIRS Core" },
    { name: "LocalSNV", description: "Local Standard Normal Variate (LSNV)", defaultParams: {}, category: "NIRS Core" },
    { name: "MSC", description: "Multiplicative Scatter Correction", defaultParams: { reference: "mean" }, category: "NIRS Core" },
    { name: "EMSC", description: "Extended Multiplicative Scatter Correction", defaultParams: { reference: "mean" }, category: "NIRS Core" },

    // === Derivatives & Smoothing ===
    { name: "SavitzkyGolay", description: "Smoothing and derivatives", defaultParams: { window_length: 11, polyorder: 2, deriv: 0 }, category: "Derivatives" },
    { name: "FirstDerivative", description: "First spectral derivative", defaultParams: {}, category: "Derivatives" },
    { name: "SecondDerivative", description: "Second spectral derivative", defaultParams: {}, category: "Derivatives" },
    { name: "Gaussian", description: "Gaussian smoothing filter", defaultParams: { sigma: 2 }, category: "Smoothing" },
    { name: "MovingAverage", description: "Moving average smoothing", defaultParams: { window_size: 5 }, category: "Smoothing" },

    // === Baseline Correction ===
    { name: "Detrend", description: "Remove polynomial trends", defaultParams: { order: 2 }, category: "Baseline" },
    { name: "BaselineCorrection", description: "Polynomial baseline correction", defaultParams: { order: 2 }, category: "Baseline" },
    { name: "ASLSBaseline", description: "Asymmetric Least Squares baseline", defaultParams: { lam: 1e6, p: 0.01 }, category: "Baseline" },
    { name: "AirPLS", description: "Adaptive Iteratively Reweighted PLS baseline", defaultParams: { lam: 1e5 }, category: "Baseline" },
    { name: "ArPLS", description: "Asymmetrically Reweighted PLS baseline", defaultParams: { lam: 1e5 }, category: "Baseline" },
    { name: "SNIP", description: "Statistics-sensitive Non-linear Iterative Peak-clipping", defaultParams: { max_half_window: 40 }, category: "Baseline" },
    { name: "RollingBall", description: "Rolling ball baseline", defaultParams: { half_window: 25 }, category: "Baseline" },
    { name: "ModPoly", description: "Modified Polynomial baseline", defaultParams: { poly_order: 2 }, category: "Baseline" },
    { name: "IModPoly", description: "Improved Modified Polynomial baseline", defaultParams: { poly_order: 2 }, category: "Baseline" },

    // === Wavelet Transforms ===
    { name: "Haar", description: "Haar wavelet decomposition", defaultParams: {}, category: "Wavelet" },
    { name: "Wavelet", description: "Wavelet transform", defaultParams: { wavelet: "db4", level: 3 }, category: "Wavelet" },
    { name: "WaveletPCA", description: "Wavelet-based dimensionality reduction", defaultParams: { n_components: 10 }, category: "Wavelet" },

    // === Signal Type Conversion ===
    { name: "ReflectanceToAbsorbance", description: "Convert reflectance to absorbance (Beer-Lambert)", defaultParams: {}, category: "Conversion" },
    { name: "LogTransform", description: "Logarithmic transform", defaultParams: {}, category: "Conversion" },
    { name: "ToAbsorbance", description: "Convert to absorbance", defaultParams: {}, category: "Conversion" },
    { name: "FromAbsorbance", description: "Convert from absorbance", defaultParams: {}, category: "Conversion" },
    { name: "KubelkaMunk", description: "Kubelka-Munk transformation", defaultParams: {}, category: "Conversion" },

    // === Feature Selection ===
    { name: "CARS", description: "Competitive Adaptive Reweighted Sampling", defaultParams: { n_pls_components: 10, n_sampling_runs: 50 }, category: "Feature Selection" },
    { name: "MCUVE", description: "Monte Carlo Uninformative Variable Elimination", defaultParams: { n_components: 10, n_iterations: 100 }, category: "Feature Selection" },
    { name: "VIP", description: "Variable Importance in Projection", defaultParams: { n_components: 10, threshold: 1.0 }, category: "Feature Selection" },

    // === Feature Operations ===
    { name: "CropTransformer", description: "Trim wavelength range", defaultParams: { start: 0, end: -1 }, category: "Feature Ops" },
    { name: "Resampler", description: "Wavelength resampling/interpolation", defaultParams: { n_points: 512 }, category: "Feature Ops" },
    { name: "Normalize", description: "L1/L2/Max normalization", defaultParams: { norm: "l2" }, category: "Normalization" },

    // === Scaling (sklearn) ===
    { name: "StandardScaler", description: "Standardize to zero mean, unit variance", defaultParams: {}, category: "Scaling" },
    { name: "MinMaxScaler", description: "Min-Max normalization to [0,1]", defaultParams: { feature_range_min: 0, feature_range_max: 1 }, category: "Scaling" },
    { name: "RobustScaler", description: "Robust scaling with median/IQR", defaultParams: {}, category: "Scaling" },
    { name: "MaxAbsScaler", description: "Scale by maximum absolute value", defaultParams: {}, category: "Scaling" },
  ],

  y_processing: [
    // Target variable scaling/processing
    { name: "MinMaxScaler", description: "Scale target to [0,1] range", defaultParams: { feature_range_min: 0, feature_range_max: 1 }, category: "Scaling" },
    { name: "StandardScaler", description: "Standardize target (zero mean, unit variance)", defaultParams: {}, category: "Scaling" },
    { name: "RobustScaler", description: "Robust target scaling (median/IQR)", defaultParams: {}, category: "Scaling" },
    { name: "PowerTransformer", description: "Power transformation (Yeo-Johnson)", defaultParams: { method: "yeo-johnson" }, category: "Transform" },
    { name: "QuantileTransformer", description: "Transform to uniform/normal distribution", defaultParams: { output_distribution: "uniform", n_quantiles: 1000 }, category: "Transform" },
    { name: "IntegerKBinsDiscretizer", description: "Discretize continuous Y into bins", defaultParams: { n_bins: 5, strategy: "quantile" }, category: "Discretization" },
    { name: "RangeDiscretizer", description: "Custom range discretization", defaultParams: { ranges: "0,10,20,30" }, category: "Discretization" },
  ],

  splitting: [
    // === NIRS-Specific Splitters ===
    { name: "KennardStone", description: "Kennard-Stone representative sampling", defaultParams: { test_size: 0.2, metric: "euclidean" }, category: "NIRS" },
    { name: "SPXY", description: "Sample Partitioning based on X and Y", defaultParams: { test_size: 0.2 }, category: "NIRS" },
    { name: "SPXYGFold", description: "SPXY-based cross-validation", defaultParams: { n_splits: 5 }, category: "NIRS" },
    { name: "KMeansSplitter", description: "K-means clustering based split", defaultParams: { n_clusters: 5, test_size: 0.2 }, category: "NIRS" },
    { name: "SPlitSplitter", description: "Optimized splitting algorithm", defaultParams: { test_size: 0.2 }, category: "NIRS" },
    { name: "KBinsStratifiedSplitter", description: "Bins-based stratification for regression", defaultParams: { n_bins: 5, test_size: 0.2 }, category: "NIRS" },
    { name: "BinnedStratifiedGroupKFold", description: "Group-aware binned stratified K-fold", defaultParams: { n_splits: 5, n_bins: 5 }, category: "NIRS" },
    { name: "SystematicCircularSplitter", description: "Systematic circular sampling", defaultParams: { test_size: 0.2 }, category: "NIRS" },

    // === sklearn Standard Splitters ===
    { name: "KFold", description: "K-fold cross validation", defaultParams: { n_splits: 5, shuffle: true, random_state: 42 }, category: "sklearn" },
    { name: "RepeatedKFold", description: "Repeated K-fold CV", defaultParams: { n_splits: 5, n_repeats: 3, random_state: 42 }, category: "sklearn" },
    { name: "ShuffleSplit", description: "Random repeated train/test splits", defaultParams: { n_splits: 10, test_size: 0.2, random_state: 42 }, category: "sklearn" },
    { name: "StratifiedKFold", description: "Stratified K-fold CV (classification)", defaultParams: { n_splits: 5, shuffle: true, random_state: 42 }, category: "sklearn" },
    { name: "LeaveOneOut", description: "Leave-one-out cross validation", defaultParams: {}, category: "sklearn" },
    { name: "GroupKFold", description: "Group-aware K-fold", defaultParams: { n_splits: 5 }, category: "sklearn" },
    { name: "GroupShuffleSplit", description: "Group-aware shuffle split", defaultParams: { n_splits: 5, test_size: 0.2 }, category: "sklearn" },
  ],

  model: [
    // === Standard PLS ===
    { name: "PLSRegression", description: "Partial Least Squares Regression", defaultParams: { n_components: 10, max_iter: 500 }, category: "PLS" },
    { name: "PLSDA", description: "PLS Discriminant Analysis (classification)", defaultParams: { n_components: 10 }, category: "PLS" },

    // === Advanced PLS Variants (nirs4all exclusive) ===
    { name: "OPLS", description: "Orthogonal PLS (removes orthogonal variation)", defaultParams: { n_components: 10 }, category: "Advanced PLS" },
    { name: "OPLSDA", description: "Orthogonal PLS-DA (classification)", defaultParams: { n_components: 10 }, category: "Advanced PLS" },
    { name: "IKPLS", description: "Improved Kernel PLS (faster)", defaultParams: { n_components: 10 }, category: "Advanced PLS" },
    { name: "SparsePLS", description: "Sparse PLS with L1 regularization", defaultParams: { n_components: 10, alpha: 0.1 }, category: "Advanced PLS" },
    { name: "LWPLS", description: "Locally Weighted PLS", defaultParams: { n_components: 10, n_neighbors: 50 }, category: "Advanced PLS" },
    { name: "IntervalPLS", description: "Interval PLS for spectral band selection", defaultParams: { n_components: 10, n_intervals: 20 }, category: "Advanced PLS" },
    { name: "RobustPLS", description: "Robust PLS (outlier resistant)", defaultParams: { n_components: 10 }, category: "Advanced PLS" },
    { name: "SIMPLS", description: "SIMPLS algorithm", defaultParams: { n_components: 10 }, category: "Advanced PLS" },
    { name: "DiPLS", description: "Discriminant PLS", defaultParams: { n_components: 10 }, category: "Advanced PLS" },
    { name: "RecursivePLS", description: "Recursive PLS (adaptive)", defaultParams: { n_components: 10 }, category: "Advanced PLS" },

    // === Kernel PLS Variants ===
    { name: "KernelPLS", description: "Kernel PLS (non-linear)", defaultParams: { n_components: 10, kernel: "rbf", gamma: 1.0 }, category: "Kernel PLS" },
    { name: "KOPLS", description: "Kernel Orthogonal PLS", defaultParams: { n_components: 10, kernel: "rbf" }, category: "Kernel PLS" },
    { name: "NLPLS", description: "Non-linear PLS", defaultParams: { n_components: 10 }, category: "Kernel PLS" },
    { name: "FCKPLS", description: "Fractional Convolution Kernel PLS", defaultParams: { n_components: 10 }, category: "Kernel PLS" },

    // === sklearn Regressors ===
    { name: "Ridge", description: "Ridge regression (L2)", defaultParams: { alpha: 1.0 }, category: "Linear" },
    { name: "Lasso", description: "Lasso regression (L1)", defaultParams: { alpha: 1.0 }, category: "Linear" },
    { name: "ElasticNet", description: "Elastic Net (L1+L2)", defaultParams: { alpha: 1.0, l1_ratio: 0.5 }, category: "Linear" },
    { name: "SVR", description: "Support Vector Regression", defaultParams: { kernel: "rbf", C: 1.0, epsilon: 0.1 }, category: "SVM" },
    { name: "SVC", description: "Support Vector Classification", defaultParams: { kernel: "rbf", C: 1.0 }, category: "SVM" },

    // === Ensemble Models ===
    { name: "RandomForestRegressor", description: "Random Forest Regressor", defaultParams: { n_estimators: 100, max_depth: 10, random_state: 42 }, category: "Ensemble" },
    { name: "RandomForestClassifier", description: "Random Forest Classifier", defaultParams: { n_estimators: 100, max_depth: 10, random_state: 42 }, category: "Ensemble" },
    { name: "XGBoost", description: "XGBoost Gradient Boosting", defaultParams: { n_estimators: 100, learning_rate: 0.1, max_depth: 6 }, category: "Ensemble" },
    { name: "LightGBM", description: "LightGBM Gradient Boosting", defaultParams: { n_estimators: 100, learning_rate: 0.1, num_leaves: 31 }, category: "Ensemble" },

    // === Deep Learning ===
    { name: "nicon", description: "NIRS-specific CNN (nirs4all native)", defaultParams: {}, category: "Deep Learning", isDeepLearning: true },
    { name: "CNN1D", description: "1D Convolutional Network", defaultParams: { layers: 3, filters: 64, kernel_size: 5, dropout: 0.2 }, category: "Deep Learning", isDeepLearning: true },
    { name: "MLP", description: "Multi-layer Perceptron", defaultParams: { hidden_layers: "100,50", activation: "relu", dropout: 0.2 }, category: "Deep Learning", isDeepLearning: true },
    { name: "LSTM", description: "Long Short-Term Memory", defaultParams: { units: 64, layers: 2, dropout: 0.2 }, category: "Deep Learning", isDeepLearning: true },
    { name: "Transformer", description: "Transformer architecture", defaultParams: { n_heads: 4, n_layers: 2, d_model: 64 }, category: "Deep Learning", isDeepLearning: true },

    // === Meta-Models ===
    { name: "MetaModel", description: "Stacking ensemble using OOF predictions", defaultParams: { base_estimator: "Ridge" }, category: "Meta" },
  ],

  generator: [
    {
      name: "ChooseOne",
      description: "Choose between step alternatives (_or_)",
      defaultParams: {},
      defaultBranches: [[], [], []],
      generatorKind: "or",
      category: "Selection"
    },
    {
      name: "ChooseN",
      description: "Choose N options (combinations)",
      defaultParams: { pick: 2 },
      defaultBranches: [[], [], [], []],
      generatorKind: "or",
      category: "Selection"
    },
    {
      name: "Cartesian",
      description: "All combinations of stages (_cartesian_)",
      defaultParams: {},
      defaultBranches: [[], []],
      generatorKind: "cartesian",
      category: "Combination"
    },
  ],

  branch: [
    {
      name: "ParallelBranch",
      description: "Execute multiple pipelines in parallel",
      defaultParams: {},
      defaultBranches: [[], []],
      category: "Parallel"
    },
    {
      name: "SourceBranch",
      description: "Per-source preprocessing (multi-source data)",
      defaultParams: {},
      defaultBranches: [[], []],
      category: "Multi-Source"
    },
  ],

  merge: [
    { name: "Concatenate", description: "Concatenate features from branches", defaultParams: { axis: 1 }, category: "Feature" },
    { name: "Mean", description: "Average predictions from branches", defaultParams: {}, category: "Prediction" },
    { name: "Stacking", description: "Stack predictions for meta-model", defaultParams: {}, category: "Prediction" },
    { name: "Voting", description: "Voting ensemble (classification)", defaultParams: { voting: "soft" }, category: "Prediction" },
  ],

  filter: [
    { name: "SampleFilter", description: "Filter samples by condition", defaultParams: { condition: "" }, category: "Sample" },
    { name: "YOutlierFilter", description: "Remove Y outliers", defaultParams: { method: "iqr", threshold: 1.5 }, category: "Outlier" },
    { name: "XOutlierFilter", description: "Remove X outliers (Mahalanobis)", defaultParams: { threshold: 3.0 }, category: "Outlier" },
    { name: "HotellingT2Filter", description: "Hotelling T² outlier detection", defaultParams: { alpha: 0.05 }, category: "Outlier" },
  ],

  augmentation: [
    // Training-time data augmentation
    { name: "GaussianNoise", description: "Add Gaussian noise", defaultParams: { std: 0.01 }, category: "Noise" },
    { name: "MultiplicativeNoise", description: "Multiplicative noise", defaultParams: { std: 0.01 }, category: "Noise" },
    { name: "SpikeNoise", description: "Add spike artifacts", defaultParams: { probability: 0.1, magnitude: 0.1 }, category: "Noise" },
    { name: "LinearBaselineDrift", description: "Simulate linear baseline drift", defaultParams: { max_slope: 0.001 }, category: "Drift" },
    { name: "PolynomialBaselineDrift", description: "Polynomial baseline drift", defaultParams: { order: 2, max_magnitude: 0.01 }, category: "Drift" },
    { name: "WavelengthShift", description: "Shift wavelength axis", defaultParams: { max_shift: 2 }, category: "Shift" },
    { name: "WavelengthStretch", description: "Stretch/compress wavelengths", defaultParams: { max_factor: 0.01 }, category: "Shift" },
    { name: "BandMasking", description: "Randomly mask spectral bands", defaultParams: { n_bands: 3, max_width: 10 }, category: "Masking" },
    { name: "ChannelDropout", description: "Drop random channels", defaultParams: { dropout_rate: 0.05 }, category: "Masking" },
    { name: "Mixup", description: "Mixup augmentation", defaultParams: { alpha: 0.2 }, category: "Mixing" },
  ],
};

export const stepTypeLabels: Record<StepType, string> = {
  preprocessing: "Preprocessing",
  y_processing: "Target Processing",
  splitting: "Splitting",
  model: "Models",
  generator: "Generators",
  branch: "Branching",
  merge: "Merge",
  filter: "Filters",
  augmentation: "Augmentation",
};

// Color configurations for step types
export const stepColors: Record<StepType, {
  border: string;
  bg: string;
  hover: string;
  selected: string;
  text: string;
  active: string;
  gradient: string;
}> = {
  preprocessing: {
    border: "border-blue-500/30",
    bg: "bg-blue-500/5",
    hover: "hover:bg-blue-500/10 hover:border-blue-500/50",
    selected: "bg-blue-500/10 border-blue-500/100",
    text: "text-blue-500",
    active: "ring-blue-500 border-blue-500",
    gradient: "from-blue-500/20 to-blue-500/5",
  },
  y_processing: {
    border: "border-amber-500/30",
    bg: "bg-amber-500/5",
    hover: "hover:bg-amber-500/10 hover:border-amber-500/50",
    selected: "bg-amber-500/10 border-amber-500/100",
    text: "text-amber-500",
    active: "ring-amber-500 border-amber-500",
    gradient: "from-amber-500/20 to-amber-500/5",
  },
  splitting: {
    border: "border-purple-500/30",
    bg: "bg-purple-500/5",
    hover: "hover:bg-purple-500/10 hover:border-purple-500/50",
    selected: "bg-purple-500/10 border-purple-500/100",
    text: "text-purple-500",
    active: "ring-purple-500 border-purple-500",
    gradient: "from-purple-500/20 to-purple-500/5",
  },
  model: {
    border: "border-emerald-500/30",
    bg: "bg-emerald-500/5",
    hover: "hover:bg-emerald-500/10 hover:border-emerald-500/50",
    selected: "bg-emerald-500/10 border-emerald-500/100",
    text: "text-emerald-500",
    active: "ring-emerald-500 border-emerald-500",
    gradient: "from-emerald-500/20 to-emerald-500/5",
  },
  generator: {
    border: "border-orange-500/30",
    bg: "bg-orange-500/5",
    hover: "hover:bg-orange-500/10 hover:border-orange-500/50",
    selected: "bg-orange-500/10 border-orange-500/100",
    text: "text-orange-500",
    active: "ring-orange-500 border-orange-500",
    gradient: "from-orange-500/20 to-orange-500/5",
  },
  branch: {
    border: "border-cyan-500/30",
    bg: "bg-cyan-500/5",
    hover: "hover:bg-cyan-500/10 hover:border-cyan-500/50",
    selected: "bg-cyan-500/10 border-cyan-500/100",
    text: "text-cyan-500",
    active: "ring-cyan-500 border-cyan-500",
    gradient: "from-cyan-500/20 to-cyan-500/5",
  },
  merge: {
    border: "border-pink-500/30",
    bg: "bg-pink-500/5",
    hover: "hover:bg-pink-500/10 hover:border-pink-500/50",
    selected: "bg-pink-500/10 border-pink-500/100",
    text: "text-pink-500",
    active: "ring-pink-500 border-pink-500",
    gradient: "from-pink-500/20 to-pink-500/5",
  },
  filter: {
    border: "border-rose-500/30",
    bg: "bg-rose-500/5",
    hover: "hover:bg-rose-500/10 hover:border-rose-500/50",
    selected: "bg-rose-500/10 border-rose-500/100",
    text: "text-rose-500",
    active: "ring-rose-500 border-rose-500",
    gradient: "from-rose-500/20 to-rose-500/5",
  },
  augmentation: {
    border: "border-indigo-500/30",
    bg: "bg-indigo-500/5",
    hover: "hover:bg-indigo-500/10 hover:border-indigo-500/50",
    selected: "bg-indigo-500/10 border-indigo-500/100",
    text: "text-indigo-500",
    active: "ring-indigo-500 border-indigo-500",
    gradient: "from-indigo-500/20 to-indigo-500/5",
  },
};

// Utility to generate unique IDs
export function generateStepId(): string {
  return `step-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Utility to create a step from an option
export function createStepFromOption(type: StepType, option: StepOption): PipelineStep {
  return {
    id: generateStepId(),
    type,
    name: option.name,
    params: { ...option.defaultParams },
    branches: option.defaultBranches
      ? JSON.parse(JSON.stringify(option.defaultBranches))
      : undefined,
    generatorKind: option.generatorKind,
  };
}

// Deep clone a step (including branches and sweeps)
export function cloneStep(step: PipelineStep): PipelineStep {
  return {
    ...step,
    id: generateStepId(),
    params: { ...step.params },
    paramSweeps: step.paramSweeps
      ? JSON.parse(JSON.stringify(step.paramSweeps))
      : undefined,
    branches: step.branches?.map(branch =>
      branch.map(s => cloneStep(s))
    ),
    generatorOptions: step.generatorOptions
      ? { ...step.generatorOptions }
      : undefined,
  };
}

// Format sweep for display
export function formatSweepDisplay(sweep: ParameterSweep): string {
  switch (sweep.type) {
    case "range":
      return `${sweep.from}→${sweep.to}${sweep.step && sweep.step !== 1 ? ` (step ${sweep.step})` : ""}`;
    case "log_range":
      return `log(${sweep.from}→${sweep.to})`;
    case "or":
      if (sweep.choices && sweep.choices.length <= 3) {
        return sweep.choices.join(" | ");
      }
      return `${sweep.choices?.length ?? 0} choices`;
    case "grid":
      return "grid";
    default:
      return "sweep";
  }
}

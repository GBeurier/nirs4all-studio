/**
 * Pipeline Editor Types
 * Tree-based pipeline structure with support for nested branches
 */

export type StepType = "preprocessing" | "splitting" | "model" | "metrics" | "branch" | "merge";

export interface PipelineStep {
  id: string;
  type: StepType;
  name: string;
  params: Record<string, string | number | boolean>;
  branches?: PipelineStep[][]; // For branching steps: list of parallel pipelines
}

export interface StepOption {
  name: string;
  description: string;
  defaultParams: Record<string, string | number | boolean>;
  defaultBranches?: PipelineStep[][];
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

// Step options configuration (for component library)
export const stepOptions: Record<StepType, StepOption[]> = {
  preprocessing: [
    { name: "SNV", description: "Standard Normal Variate", defaultParams: {} },
    { name: "MSC", description: "Multiplicative Scatter Correction", defaultParams: { reference: "mean" } },
    { name: "SavitzkyGolay", description: "Smoothing and derivatives", defaultParams: { window: 11, polyorder: 2, deriv: 1 } },
    { name: "Detrend", description: "Remove polynomial trends", defaultParams: { order: 2 } },
    { name: "Normalize", description: "L1/L2 normalization", defaultParams: { norm: "l2" } },
    { name: "Gaussian", description: "Gaussian smoothing", defaultParams: { sigma: 2 } },
    { name: "MovingAverage", description: "Moving average smoothing", defaultParams: { window: 5 } },
    { name: "StandardScaler", description: "Standardize features", defaultParams: {} },
    { name: "MinMaxScaler", description: "Min-Max normalization", defaultParams: { feature_range_min: 0, feature_range_max: 1 } },
    { name: "RobustScaler", description: "Robust scaling with median", defaultParams: {} },
    { name: "BaselineCorrection", description: "Remove baseline drift", defaultParams: { method: "polynomial", order: 2 } },
    { name: "Trim", description: "Trim wavelength range", defaultParams: { start: 0, end: -1 } },
  ],
  splitting: [
    { name: "KennardStone", description: "Representative sampling", defaultParams: { test_size: 0.2 } },
    { name: "SPXY", description: "Sample set partitioning", defaultParams: { test_size: 0.2 } },
    { name: "KFold", description: "K-fold cross validation", defaultParams: { n_splits: 5, shuffle: true } },
    { name: "RepeatedKFold", description: "Repeated K-fold CV", defaultParams: { n_splits: 5, n_repeats: 3 } },
    { name: "ShuffleSplit", description: "Random repeated splits", defaultParams: { n_splits: 10, test_size: 0.2 } },
    { name: "LeaveOneOut", description: "Leave-one-out CV", defaultParams: {} },
    { name: "StratifiedKFold", description: "Stratified K-fold CV", defaultParams: { n_splits: 5, shuffle: true } },
    { name: "GroupKFold", description: "Group-aware K-fold", defaultParams: { n_splits: 5 } },
  ],
  model: [
    { name: "PLSRegression", description: "Partial Least Squares", defaultParams: { n_components: 10, max_iter: 500 } },
    { name: "RandomForest", description: "Random Forest regressor", defaultParams: { n_estimators: 100, max_depth: 10, random_state: 42 } },
    { name: "SVR", description: "Support Vector Regression", defaultParams: { kernel: "rbf", C: 1.0, epsilon: 0.1 } },
    { name: "XGBoost", description: "Gradient Boosting", defaultParams: { n_estimators: 100, learning_rate: 0.1, max_depth: 6 } },
    { name: "LightGBM", description: "Light Gradient Boosting", defaultParams: { n_estimators: 100, learning_rate: 0.1, num_leaves: 31 } },
    { name: "ElasticNet", description: "Elastic Net regression", defaultParams: { alpha: 1.0, l1_ratio: 0.5 } },
    { name: "Ridge", description: "Ridge regression", defaultParams: { alpha: 1.0 } },
    { name: "Lasso", description: "Lasso regression", defaultParams: { alpha: 1.0 } },
    { name: "CNN1D", description: "1D Convolutional Network", defaultParams: { layers: 3, filters: 64, kernel_size: 5, dropout: 0.2 } },
    { name: "MLP", description: "Multi-layer Perceptron", defaultParams: { hidden_layers: "100,50", activation: "relu" } },
    { name: "LSTM", description: "Long Short-Term Memory", defaultParams: { units: 64, layers: 2, dropout: 0.2 } },
  ],
  metrics: [
    { name: "RMSE", description: "Root Mean Squared Error", defaultParams: {} },
    { name: "R2", description: "Coefficient of Determination", defaultParams: {} },
    { name: "MAE", description: "Mean Absolute Error", defaultParams: {} },
    { name: "RPD", description: "Ratio of Performance to Deviation", defaultParams: {} },
    { name: "RPIQ", description: "Ratio of Performance to IQ", defaultParams: {} },
    { name: "Bias", description: "Systematic error (bias)", defaultParams: {} },
    { name: "SEP", description: "Standard Error of Prediction", defaultParams: {} },
    { name: "nRMSE", description: "Normalized RMSE", defaultParams: { normalization: "range" } },
  ],
  branch: [
    {
      name: "ParallelBranch",
      description: "Execute steps in parallel",
      defaultParams: {},
      defaultBranches: [[], []] // Start with 2 empty branches
    },
  ],
  merge: [
    { name: "Concatenate", description: "Concatenate features", defaultParams: { axis: 1 } },
    { name: "Mean", description: "Average predictions", defaultParams: {} },
    { name: "Stacking", description: "Stack predictions", defaultParams: {} },
  ],
};

export const stepTypeLabels: Record<StepType, string> = {
  preprocessing: "Preprocessing",
  splitting: "Splitting",
  model: "Models",
  metrics: "Metrics",
  branch: "Branching",
  merge: "Merge",
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
  metrics: {
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
  };
}

// Deep clone a step (including branches)
export function cloneStep(step: PipelineStep): PipelineStep {
  return {
    ...step,
    id: generateStepId(),
    params: { ...step.params },
    branches: step.branches?.map(branch =>
      branch.map(s => cloneStep(s))
    ),
  };
}

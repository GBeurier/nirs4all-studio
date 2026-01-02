/**
 * Pipeline Editor Types
 * Based on spectral-workbench with additions from nirs4all_ui
 */

export type StepType = "preprocessing" | "splitting" | "model" | "metrics" | "branch" | "merge";

export interface PipelineStep {
  id: string;
  type: StepType;
  name: string;
  params: Record<string, string | number | boolean>;
  branches?: PipelineStep[][]; // For branching steps: list of pipelines
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
  branch: "Flow Control",
  merge: "Flow Control",
};

// Color configurations for step types
export const stepColors: Record<StepType, { border: string; bg: string; hover: string; text: string; active: string }> = {
  preprocessing: {
    border: "border-blue-500/30",
    bg: "bg-blue-500/5",
    hover: "hover:bg-blue-500/10 hover:border-blue-500/50",
    text: "text-blue-500",
    active: "ring-blue-500 border-blue-500",
  },
  splitting: {
    border: "border-purple-500/30",
    bg: "bg-purple-500/5",
    hover: "hover:bg-purple-500/10 hover:border-purple-500/50",
    text: "text-purple-500",
    active: "ring-purple-500 border-purple-500",
  },
  model: {
    border: "border-primary/30",
    bg: "bg-primary/5",
    hover: "hover:bg-primary/10 hover:border-primary/50",
    text: "text-primary",
    active: "ring-primary border-primary",
  },
  metrics: {
    border: "border-orange-500/30",
    bg: "bg-orange-500/5",
    hover: "hover:bg-orange-500/10 hover:border-orange-500/50",
    text: "text-orange-500",
    active: "ring-orange-500 border-orange-500",
  },
  branch: {
    border: "border-slate-500/30",
    bg: "bg-slate-500/5",
    hover: "hover:bg-slate-500/10 hover:border-slate-500/50",
    text: "text-slate-500",
    active: "ring-slate-500 border-slate-500",
  },
  merge: {
    border: "border-slate-500/30",
    bg: "bg-slate-500/5",
    hover: "hover:bg-slate-500/10 hover:border-slate-500/50",
    text: "text-slate-500",
    active: "ring-slate-500 border-slate-500",
  },
};

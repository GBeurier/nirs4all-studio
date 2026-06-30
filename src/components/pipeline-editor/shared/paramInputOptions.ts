// Parameter info/tooltips for common parameters
export const parameterInfo: Record<string, string> = {
  n_components: "Number of components/latent variables to use",
  n_estimators: "Number of trees in the ensemble",
  max_depth: "Maximum depth of trees",
  learning_rate: "Step size for gradient descent optimization",
  test_size: "Proportion of data to use for testing (0.0-1.0)",
  n_splits: "Number of folds for cross-validation",
  random_state: "Random seed for reproducibility",
  window_length: "Size of the moving window (must be odd)",
  window: "Size of the moving window (must be odd)",
  window_size: "Size of the moving window",
  polyorder: "Polynomial order for fitting",
  deriv: "Derivative order (0=smoothing, 1=first, 2=second)",
  sigma: "Standard deviation for Gaussian kernel",
  order: "Polynomial order for baseline/detrending",
  lam: "Smoothing parameter (lambda) - higher = smoother baseline",
  p: "Asymmetry parameter (0 to 1) - lower emphasizes troughs",
  C: "Regularization parameter (higher = less regularization)",
  epsilon: "Epsilon in epsilon-SVR model",
  kernel: "Kernel type for SVM (rbf, linear, poly)",
  gamma: "Kernel coefficient for rbf/poly/sigmoid",
  alpha: "Regularization strength",
  l1_ratio: "L1 ratio for Elastic Net (0=L2, 1=L1)",
  shuffle: "Whether to shuffle data before splitting",
  n_repeats: "Number of times to repeat cross-validation",
};

// Select options for known parameter types
export const selectOptions: Record<string, Array<{ value: string; label: string }>> = {
  kernel: [
    { value: "rbf", label: "RBF (Radial Basis Function)" },
    { value: "linear", label: "Linear" },
    { value: "poly", label: "Polynomial" },
    { value: "sigmoid", label: "Sigmoid" },
  ],
  norm: [
    { value: "l1", label: "L1 (Manhattan)" },
    { value: "l2", label: "L2 (Euclidean)" },
    { value: "max", label: "Max" },
  ],
  activation: [
    { value: "relu", label: "ReLU" },
    { value: "tanh", label: "Tanh" },
    { value: "sigmoid", label: "Sigmoid" },
    { value: "leaky_relu", label: "Leaky ReLU" },
  ],
  reference: [
    { value: "mean", label: "Mean Spectrum" },
    { value: "first", label: "First Spectrum" },
    { value: "median", label: "Median Spectrum" },
  ],
};

// Keys that should render as select inputs
export const selectParamKeys = new Set(Object.keys(selectOptions));

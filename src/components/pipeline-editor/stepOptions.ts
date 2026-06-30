import type {
  StepOption,
  StepType,
} from "./types";

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

  filter: [
    { name: "SampleFilter", description: "Filter samples by condition", defaultParams: { condition: "" }, category: "Sample" },
    { name: "YOutlierFilter", description: "Remove Y outliers", defaultParams: { method: "iqr", threshold: 1.5 }, category: "Outlier" },
    { name: "XOutlierFilter", description: "Remove X outliers (Mahalanobis)", defaultParams: { threshold: 3.0 }, category: "Outlier" },
    { name: "HotellingT2Filter", description: "Hotelling T² outlier detection", defaultParams: { alpha: 0.05 }, category: "Outlier" },
    { name: "SpectralQualityFilter", description: "Filter by spectral quality metrics", defaultParams: { max_nan_ratio: 0.1, max_zero_ratio: 0.3 }, category: "Quality" },
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
    { name: "Rotate_Translate", description: "Rotation and translation augmentation", defaultParams: { p_range: 1.0, y_factor: 2.0 }, category: "Transform" },
    { name: "GaussianAdditiveNoise", description: "Gaussian additive noise", defaultParams: { sigma: 0.005 }, category: "Noise" },
  ],

  flow: [
    // Branching
    {
      name: "ParallelBranch",
      description: "Execute multiple pipelines in parallel",
      defaultParams: {},
      defaultBranches: [[], []],
      category: "Branching"
    },
    {
      name: "SourceBranch",
      description: "Per-source preprocessing (multi-source data)",
      defaultParams: {},
      defaultBranches: [[], []],
      category: "Branching"
    },
    // Merging
    { name: "Concatenate", description: "Concatenate features from branches", defaultParams: { axis: 1 }, category: "Merging" },
    { name: "Mean", description: "Average predictions from branches", defaultParams: {}, category: "Merging" },
    { name: "Stacking", description: "Stack predictions for meta-model", defaultParams: {}, category: "Merging" },
    { name: "Voting", description: "Voting ensemble (classification)", defaultParams: { voting: "soft" }, category: "Merging" },
    // Augmentation Containers
    { name: "SampleAugmentation", description: "Training-time sample augmentation with multiple transformers", defaultParams: { count: 2, selection: "random" }, category: "Augmentation Containers" },
    { name: "FeatureAugmentation", description: "Feature-level augmentation with multiple transforms", defaultParams: { action: "extend" }, category: "Augmentation Containers" },
    // Filter Containers
    { name: "SampleFilter", description: "Composite filter with multiple criteria", defaultParams: { mode: "any", report: true }, category: "Filter Containers" },
    // Feature Concatenation
    { name: "ConcatTransform", description: "Concatenate features from multiple transformation branches", defaultParams: {}, category: "Feature Concatenation" },
    // Sequential
    { name: "Sequential", description: "Group steps to execute in sequence (equivalent to [...] in nirs4all)", defaultParams: {}, category: "Sequential" },
    // Generators
    {
      name: "Or",
      description: "Choose from alternatives with pick/arrange (_or_)",
      defaultParams: {},
      defaultBranches: [[], [], []],
      generatorKind: "or",
      category: "Generators"
    },
    {
      name: "Cartesian",
      description: "Cartesian product of stages (_cartesian_)",
      defaultParams: {},
      defaultBranches: [[], []],
      generatorKind: "cartesian",
      category: "Generators"
    },
    {
      name: "Grid",
      description: "Grid search over parameter values (_grid_)",
      defaultParams: {},
      defaultBranches: [[], []],
      generatorKind: "grid",
      category: "Generators"
    },
    {
      name: "Zip",
      description: "Parallel parameter iteration (_zip_)",
      defaultParams: {},
      generatorKind: "zip",
      category: "Generators"
    },
    {
      name: "Chain",
      description: "Ordered sequence of configurations (_chain_)",
      defaultParams: {},
      defaultBranches: [[], [], []],
      generatorKind: "chain",
      category: "Generators"
    },
    {
      name: "Sample",
      description: "Sample values from a distribution (_sample_)",
      defaultParams: {},
      generatorKind: "sample",
      category: "Generators"
    },
  ],

  utility: [
    // Charts
    { name: "chart_2d", description: "2D spectrum visualization", defaultParams: {}, category: "Visualization" },
    { name: "chart_y", description: "Y distribution visualization", defaultParams: {}, category: "Visualization" },
    // Comments
    { name: "Comment", description: "Non-functional comment for documentation", defaultParams: { text: "" }, category: "Documentation" },
  ],
};

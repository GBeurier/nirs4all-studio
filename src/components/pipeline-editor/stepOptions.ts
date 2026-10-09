import i18n from "i18next";
import type {
  StepOption,
  StepType,
} from "./types";

type StepOptionSeed = Omit<StepOption, "description">;

// Step options configuration (for component library)
// Organized by category with subcategories for better UX.
// Descriptions are localised: each option's `description` is resolved at read
// time from `pipelineEditor.stepOptions.<type>.<name>`. `category` is kept as a
// stable identifier (also used for grouping logic) and `name` is the class id.
const stepOptionSeeds: Record<StepType, StepOptionSeed[]> = {
  preprocessing: [
    // === NIRS-Specific Transforms ===
    { name: "SNV", defaultParams: {}, category: "NIRS Core" },
    { name: "RobustSNV", defaultParams: {}, category: "NIRS Core" },
    { name: "LocalSNV", defaultParams: {}, category: "NIRS Core" },
    { name: "MSC", defaultParams: { reference: "mean" }, category: "NIRS Core" },
    { name: "EMSC", defaultParams: { reference: "mean" }, category: "NIRS Core" },

    // === Derivatives & Smoothing ===
    { name: "SavitzkyGolay", defaultParams: { window_length: 11, polyorder: 2, deriv: 0 }, category: "Derivatives" },
    { name: "FirstDerivative", defaultParams: {}, category: "Derivatives" },
    { name: "SecondDerivative", defaultParams: {}, category: "Derivatives" },
    { name: "Gaussian", defaultParams: { sigma: 2 }, category: "Smoothing" },
    { name: "MovingAverage", defaultParams: { window_size: 5 }, category: "Smoothing" },

    // === Baseline Correction ===
    { name: "Detrend", defaultParams: { order: 2 }, category: "Baseline" },
    { name: "BaselineCorrection", defaultParams: { order: 2 }, category: "Baseline" },
    { name: "ASLSBaseline", defaultParams: { lam: 1e6, p: 0.01 }, category: "Baseline" },
    { name: "AirPLS", defaultParams: { lam: 1e5 }, category: "Baseline" },
    { name: "ArPLS", defaultParams: { lam: 1e5 }, category: "Baseline" },
    { name: "SNIP", defaultParams: { max_half_window: 40 }, category: "Baseline" },
    { name: "RollingBall", defaultParams: { half_window: 25 }, category: "Baseline" },
    { name: "ModPoly", defaultParams: { poly_order: 2 }, category: "Baseline" },
    { name: "IModPoly", defaultParams: { poly_order: 2 }, category: "Baseline" },

    // === Wavelet Transforms ===
    { name: "Haar", defaultParams: {}, category: "Wavelet" },
    { name: "Wavelet", defaultParams: { wavelet: "db4", level: 3 }, category: "Wavelet" },
    { name: "WaveletPCA", defaultParams: { n_components: 10 }, category: "Wavelet" },

    // === Signal Type Conversion ===
    { name: "ReflectanceToAbsorbance", defaultParams: {}, category: "Conversion" },
    { name: "LogTransform", defaultParams: {}, category: "Conversion" },
    { name: "ToAbsorbance", defaultParams: {}, category: "Conversion" },
    { name: "FromAbsorbance", defaultParams: {}, category: "Conversion" },
    { name: "KubelkaMunk", defaultParams: {}, category: "Conversion" },

    // === Feature Selection ===
    { name: "CARS", defaultParams: { n_pls_components: 10, n_sampling_runs: 50 }, category: "Feature Selection" },
    { name: "MCUVE", defaultParams: { n_components: 10, n_iterations: 100 }, category: "Feature Selection" },
    { name: "VIP", defaultParams: { n_components: 10, threshold: 1.0 }, category: "Feature Selection" },

    // === Feature Operations ===
    { name: "CropTransformer", defaultParams: { start: 0, end: -1 }, category: "Feature Ops" },
    { name: "Resampler", defaultParams: { n_points: 512 }, category: "Feature Ops" },
    { name: "Normalize", defaultParams: { norm: "l2" }, category: "Normalization" },

    // === Scaling (sklearn) ===
    { name: "StandardScaler", defaultParams: {}, category: "Scaling" },
    { name: "MinMaxScaler", defaultParams: { feature_range_min: 0, feature_range_max: 1 }, category: "Scaling" },
    { name: "RobustScaler", defaultParams: {}, category: "Scaling" },
    { name: "MaxAbsScaler", defaultParams: {}, category: "Scaling" },
  ],

  y_processing: [
    // Target variable scaling/processing
    { name: "MinMaxScaler", defaultParams: { feature_range_min: 0, feature_range_max: 1 }, category: "Scaling" },
    { name: "StandardScaler", defaultParams: {}, category: "Scaling" },
    { name: "RobustScaler", defaultParams: {}, category: "Scaling" },
    { name: "PowerTransformer", defaultParams: { method: "yeo-johnson" }, category: "Transform" },
    { name: "QuantileTransformer", defaultParams: { output_distribution: "uniform", n_quantiles: 1000 }, category: "Transform" },
    { name: "IntegerKBinsDiscretizer", defaultParams: { n_bins: 5, strategy: "quantile" }, category: "Discretization" },
    { name: "RangeDiscretizer", defaultParams: { ranges: "0,10,20,30" }, category: "Discretization" },
  ],

  splitting: [
    // === NIRS-Specific Splitters ===
    { name: "KennardStone", defaultParams: { test_size: 0.2, metric: "euclidean" }, category: "NIRS" },
    { name: "SPXY", defaultParams: { test_size: 0.2 }, category: "NIRS" },
    { name: "SPXYGFold", defaultParams: { n_splits: 5 }, category: "NIRS" },
    { name: "KMeansSplitter", defaultParams: { n_clusters: 5, test_size: 0.2 }, category: "NIRS" },
    { name: "SPlitSplitter", defaultParams: { test_size: 0.2 }, category: "NIRS" },
    { name: "KBinsStratifiedSplitter", defaultParams: { n_bins: 5, test_size: 0.2 }, category: "NIRS" },
    { name: "BinnedStratifiedGroupKFold", defaultParams: { n_splits: 5, n_bins: 5 }, category: "NIRS" },
    { name: "SystematicCircularSplitter", defaultParams: { test_size: 0.2 }, category: "NIRS" },

    // === sklearn Standard Splitters ===
    { name: "KFold", defaultParams: { n_splits: 5, shuffle: true, random_state: 42 }, category: "sklearn" },
    { name: "RepeatedKFold", defaultParams: { n_splits: 5, n_repeats: 3, random_state: 42 }, category: "sklearn" },
    { name: "ShuffleSplit", defaultParams: { n_splits: 10, test_size: 0.2, random_state: 42 }, category: "sklearn" },
    { name: "StratifiedKFold", defaultParams: { n_splits: 5, shuffle: true, random_state: 42 }, category: "sklearn" },
    { name: "LeaveOneOut", defaultParams: {}, category: "sklearn" },
    { name: "GroupKFold", defaultParams: { n_splits: 5 }, category: "sklearn" },
    { name: "GroupShuffleSplit", defaultParams: { n_splits: 5, test_size: 0.2 }, category: "sklearn" },
  ],

  model: [
    // === Standard PLS ===
    { name: "PLSRegression", defaultParams: { n_components: 10, max_iter: 500 }, category: "PLS" },
    { name: "PLSDA", defaultParams: { n_components: 10 }, category: "PLS" },

    // === Advanced PLS Variants (nirs4all exclusive) ===
    { name: "OPLS", defaultParams: { n_components: 10 }, category: "Advanced PLS" },
    { name: "OPLSDA", defaultParams: { n_components: 10 }, category: "Advanced PLS" },
    { name: "IKPLS", defaultParams: { n_components: 10 }, category: "Advanced PLS" },
    { name: "SparsePLS", defaultParams: { n_components: 10, alpha: 0.1 }, category: "Advanced PLS" },
    { name: "LWPLS", defaultParams: { n_components: 10, n_neighbors: 50 }, category: "Advanced PLS" },
    { name: "IntervalPLS", defaultParams: { n_components: 10, n_intervals: 20 }, category: "Advanced PLS" },
    { name: "RobustPLS", defaultParams: { n_components: 10 }, category: "Advanced PLS" },
    { name: "SIMPLS", defaultParams: { n_components: 10 }, category: "Advanced PLS" },
    { name: "DiPLS", defaultParams: { n_components: 10 }, category: "Advanced PLS" },
    { name: "RecursivePLS", defaultParams: { n_components: 10 }, category: "Advanced PLS" },

    // === Kernel PLS Variants ===
    { name: "KernelPLS", defaultParams: { n_components: 10, kernel: "rbf", gamma: 1.0 }, category: "Kernel PLS" },
    { name: "KOPLS", defaultParams: { n_components: 10, kernel: "rbf" }, category: "Kernel PLS" },
    { name: "NLPLS", defaultParams: { n_components: 10 }, category: "Kernel PLS" },
    { name: "FCKPLS", defaultParams: { n_components: 10 }, category: "Kernel PLS" },

    // === sklearn Regressors ===
    { name: "Ridge", defaultParams: { alpha: 1.0 }, category: "Linear" },
    { name: "Lasso", defaultParams: { alpha: 1.0 }, category: "Linear" },
    { name: "ElasticNet", defaultParams: { alpha: 1.0, l1_ratio: 0.5 }, category: "Linear" },
    { name: "SVR", defaultParams: { kernel: "rbf", C: 1.0, epsilon: 0.1 }, category: "SVM" },
    { name: "SVC", defaultParams: { kernel: "rbf", C: 1.0 }, category: "SVM" },

    // === Ensemble Models ===
    { name: "RandomForestRegressor", defaultParams: { n_estimators: 100, max_depth: 10, random_state: 42 }, category: "Ensemble" },
    { name: "RandomForestClassifier", defaultParams: { n_estimators: 100, max_depth: 10, random_state: 42 }, category: "Ensemble" },
    { name: "XGBoost", defaultParams: { n_estimators: 100, learning_rate: 0.1, max_depth: 6 }, category: "Ensemble" },
    { name: "LightGBM", defaultParams: { n_estimators: 100, learning_rate: 0.1, num_leaves: 31 }, category: "Ensemble" },

    // === Deep Learning ===
    { name: "nicon", defaultParams: {}, category: "Deep Learning", isDeepLearning: true },
    { name: "CNN1D", defaultParams: { layers: 3, filters: 64, kernel_size: 5, dropout: 0.2 }, category: "Deep Learning", isDeepLearning: true },
    { name: "MLP", defaultParams: { hidden_layers: "100,50", activation: "relu", dropout: 0.2 }, category: "Deep Learning", isDeepLearning: true },
    { name: "LSTM", defaultParams: { units: 64, layers: 2, dropout: 0.2 }, category: "Deep Learning", isDeepLearning: true },
    { name: "Transformer", defaultParams: { n_heads: 4, n_layers: 2, d_model: 64 }, category: "Deep Learning", isDeepLearning: true },

    // === Meta-Models ===
    { name: "MetaModel", defaultParams: { base_estimator: "Ridge" }, category: "Meta" },
  ],

  filter: [
    { name: "SampleFilter", defaultParams: { condition: "" }, category: "Sample" },
    { name: "YOutlierFilter", defaultParams: { method: "iqr", threshold: 1.5 }, category: "Outlier" },
    { name: "XOutlierFilter", defaultParams: { threshold: 3.0 }, category: "Outlier" },
    { name: "HotellingT2Filter", defaultParams: { alpha: 0.05 }, category: "Outlier" },
    { name: "SpectralQualityFilter", defaultParams: { max_nan_ratio: 0.1, max_zero_ratio: 0.3 }, category: "Quality" },
  ],

  augmentation: [
    // Training-time data augmentation
    { name: "GaussianNoise", defaultParams: { std: 0.01 }, category: "Noise" },
    { name: "MultiplicativeNoise", defaultParams: { std: 0.01 }, category: "Noise" },
    { name: "SpikeNoise", defaultParams: { probability: 0.1, magnitude: 0.1 }, category: "Noise" },
    { name: "LinearBaselineDrift", defaultParams: { max_slope: 0.001 }, category: "Drift" },
    { name: "PolynomialBaselineDrift", defaultParams: { order: 2, max_magnitude: 0.01 }, category: "Drift" },
    { name: "WavelengthShift", defaultParams: { max_shift: 2 }, category: "Shift" },
    { name: "WavelengthStretch", defaultParams: { max_factor: 0.01 }, category: "Shift" },
    { name: "BandMasking", defaultParams: { n_bands: 3, max_width: 10 }, category: "Masking" },
    { name: "ChannelDropout", defaultParams: { dropout_rate: 0.05 }, category: "Masking" },
    { name: "Mixup", defaultParams: { alpha: 0.2 }, category: "Mixing" },
    { name: "Rotate_Translate", defaultParams: { p_range: 1.0, y_factor: 2.0 }, category: "Transform" },
    { name: "GaussianAdditiveNoise", defaultParams: { sigma: 0.005 }, category: "Noise" },
  ],

  flow: [
    // Branching
    {
      name: "ParallelBranch",
      defaultParams: {},
      defaultBranches: [[], []],
      category: "Branching"
    },
    {
      name: "SourceBranch",
      defaultParams: {},
      defaultBranches: [[], []],
      category: "Branching"
    },
    // Merging
    { name: "Concatenate", defaultParams: { axis: 1 }, category: "Merging" },
    { name: "Mean", defaultParams: {}, category: "Merging" },
    { name: "Stacking", defaultParams: {}, category: "Merging" },
    { name: "Voting", defaultParams: { voting: "soft" }, category: "Merging" },
    // Augmentation Containers
    { name: "SampleAugmentation", defaultParams: { count: 2, selection: "random" }, category: "Augmentation Containers" },
    { name: "FeatureAugmentation", defaultParams: { action: "extend" }, category: "Augmentation Containers" },
    // Filter Containers
    { name: "SampleFilter", defaultParams: { mode: "any", report: true }, category: "Filter Containers" },
    // Feature Concatenation
    { name: "ConcatTransform", defaultParams: {}, category: "Feature Concatenation" },
    // Sequential
    { name: "Sequential", defaultParams: {}, category: "Sequential" },
    // Generators
    {
      name: "Or",
      defaultParams: {},
      defaultBranches: [[], [], []],
      generatorKind: "or",
      category: "Generators"
    },
    {
      name: "Cartesian",
      defaultParams: {},
      defaultBranches: [[], []],
      generatorKind: "cartesian",
      category: "Generators"
    },
    {
      name: "Grid",
      defaultParams: {},
      defaultBranches: [[], []],
      generatorKind: "grid",
      category: "Generators"
    },
    {
      name: "Zip",
      defaultParams: {},
      generatorKind: "zip",
      category: "Generators"
    },
    {
      name: "Chain",
      defaultParams: {},
      defaultBranches: [[], [], []],
      generatorKind: "chain",
      category: "Generators"
    },
    {
      name: "Sample",
      defaultParams: {},
      generatorKind: "sample",
      category: "Generators"
    },
  ],

  utility: [
    // Charts
    { name: "chart_2d", defaultParams: {}, category: "Visualization" },
    { name: "chart_y", defaultParams: {}, category: "Visualization" },
    // Comments
    { name: "Comment", defaultParams: { text: "" }, category: "Documentation" },
  ],
};

function withLocalizedDescription(type: StepType, option: StepOptionSeed): StepOption {
  const key = `pipelineEditor.stepOptions.${type}.${option.name}`;
  return Object.defineProperty({ ...option }, "description", {
    get: () => i18n.t(key),
    enumerable: true,
    configurable: true,
  }) as StepOption;
}

export const stepOptions = Object.fromEntries(
  (Object.entries(stepOptionSeeds) as Array<[StepType, StepOptionSeed[]]>).map(
    ([type, options]) => [type, options.map((option) => withLocalizedDescription(type, option))],
  ),
) as Record<StepType, StepOption[]>;

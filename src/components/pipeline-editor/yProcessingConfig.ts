export interface YProcessingConfig {
  enabled: boolean;
  scaler: string;
  params: Record<string, unknown>;
}

export const Y_PROCESSING_OPTIONS = [
  {
    name: "MinMaxScaler",
    description: "Scale target to [0,1] range",
    category: "Scaling",
    defaultParams: { feature_range_min: 0, feature_range_max: 1 },
    paramDescriptions: {
      feature_range_min: "Minimum value after scaling",
      feature_range_max: "Maximum value after scaling",
    },
    recommendations: ["Neural networks", "When Y varies significantly"],
    icon: "📊",
  },
  {
    name: "StandardScaler",
    description: "Standardize to zero mean, unit variance",
    category: "Scaling",
    defaultParams: {},
    paramDescriptions: {},
    recommendations: ["Most regression models", "Default choice"],
    icon: "📈",
  },
  {
    name: "RobustScaler",
    description: "Robust scaling using median and IQR",
    category: "Scaling",
    defaultParams: {},
    paramDescriptions: {},
    recommendations: ["Data with outliers", "Robust preprocessing chains"],
    icon: "🛡️",
  },
  {
    name: "PowerTransformer",
    description: "Apply power transformation (Yeo-Johnson)",
    category: "Transform",
    defaultParams: { method: "yeo-johnson" },
    paramDescriptions: {
      method: "Transformation method (yeo-johnson works with negative values)",
    },
    recommendations: ["Skewed distributions", "Making data more Gaussian"],
    icon: "⚡",
  },
  {
    name: "QuantileTransformer",
    description: "Transform to uniform or normal distribution",
    category: "Transform",
    defaultParams: { output_distribution: "uniform", n_quantiles: 1000 },
    paramDescriptions: {
      output_distribution: "Target distribution (uniform or normal)",
      n_quantiles: "Number of quantiles to compute",
    },
    recommendations: ["Non-linear relationships", "Complex distributions"],
    icon: "🔔",
  },
  {
    name: "IntegerKBinsDiscretizer",
    description: "Discretize continuous Y into bins",
    category: "Discretization",
    defaultParams: { n_bins: 5, strategy: "quantile" },
    paramDescriptions: {
      n_bins: "Number of bins to create",
      strategy: "Binning strategy (uniform, quantile, kmeans)",
    },
    recommendations: ["Converting regression to classification", "Ordinal targets"],
    icon: "📦",
  },
  {
    name: "RangeDiscretizer",
    description: "Custom range-based discretization",
    category: "Discretization",
    defaultParams: { ranges: "0,10,20,30" },
    paramDescriptions: {
      ranges: "Comma-separated range boundaries",
    },
    recommendations: ["Domain-specific thresholds", "Custom class definitions"],
    icon: "🎯",
  },
];

export function defaultYProcessingConfig(): YProcessingConfig {
  return {
    enabled: false,
    scaler: "MinMaxScaler",
    params: { feature_range_min: 0, feature_range_max: 1 },
  };
}

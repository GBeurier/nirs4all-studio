export interface YProcessingConfig {
  enabled: boolean;
  scaler: string;
  params: Record<string, unknown>;
}

export const Y_PROCESSING_OPTIONS = [
  {
    name: "MinMaxScaler",
    descriptionKey: "pipelineEditor.yProcessing.options.MinMaxScaler.description",
    category: "Scaling",
    defaultParams: { feature_range_min: 0, feature_range_max: 1 },
    paramDescriptionKeys: {
      feature_range_min: "pipelineEditor.yProcessing.paramDescription.feature_range_min",
      feature_range_max: "pipelineEditor.yProcessing.paramDescription.feature_range_max",
    },
    recommendationKeys: ["pipelineEditor.yProcessing.recommendation.neuralNetworks", "pipelineEditor.yProcessing.recommendation.wideRange"],
    icon: "📊",
  },
  {
    name: "StandardScaler",
    descriptionKey: "pipelineEditor.yProcessing.options.StandardScaler.description",
    category: "Scaling",
    defaultParams: {},
    paramDescriptionKeys: {},
    recommendationKeys: ["pipelineEditor.yProcessing.recommendation.mostRegression", "pipelineEditor.yProcessing.recommendation.defaultChoice"],
    icon: "📈",
  },
  {
    name: "RobustScaler",
    descriptionKey: "pipelineEditor.yProcessing.options.RobustScaler.description",
    category: "Scaling",
    defaultParams: {},
    paramDescriptionKeys: {},
    recommendationKeys: ["pipelineEditor.yProcessing.recommendation.withOutliers", "pipelineEditor.yProcessing.recommendation.robustChains"],
    icon: "🛡️",
  },
  {
    name: "PowerTransformer",
    descriptionKey: "pipelineEditor.yProcessing.options.PowerTransformer.description",
    category: "Transform",
    defaultParams: { method: "yeo-johnson" },
    paramDescriptionKeys: {
      method: "pipelineEditor.yProcessing.paramDescription.method",
    },
    recommendationKeys: ["pipelineEditor.yProcessing.recommendation.skewed", "pipelineEditor.yProcessing.recommendation.moreGaussian"],
    icon: "⚡",
  },
  {
    name: "QuantileTransformer",
    descriptionKey: "pipelineEditor.yProcessing.options.QuantileTransformer.description",
    category: "Transform",
    defaultParams: { output_distribution: "uniform", n_quantiles: 1000 },
    paramDescriptionKeys: {
      output_distribution: "pipelineEditor.yProcessing.paramDescription.output_distribution",
      n_quantiles: "pipelineEditor.yProcessing.paramDescription.n_quantiles",
    },
    recommendationKeys: ["pipelineEditor.yProcessing.recommendation.nonLinear", "pipelineEditor.yProcessing.recommendation.complexDistributions"],
    icon: "🔔",
  },
  {
    name: "IntegerKBinsDiscretizer",
    descriptionKey: "pipelineEditor.yProcessing.options.IntegerKBinsDiscretizer.description",
    category: "Discretization",
    defaultParams: { n_bins: 5, strategy: "quantile" },
    paramDescriptionKeys: {
      n_bins: "pipelineEditor.yProcessing.paramDescription.n_bins",
      strategy: "pipelineEditor.yProcessing.paramDescription.strategy",
    },
    recommendationKeys: ["pipelineEditor.yProcessing.recommendation.regressionToClassification", "pipelineEditor.yProcessing.recommendation.ordinalTargets"],
    icon: "📦",
  },
  {
    name: "RangeDiscretizer",
    descriptionKey: "pipelineEditor.yProcessing.options.RangeDiscretizer.description",
    category: "Discretization",
    defaultParams: { ranges: "0,10,20,30" },
    paramDescriptionKeys: {
      ranges: "pipelineEditor.yProcessing.paramDescription.ranges",
    },
    recommendationKeys: ["pipelineEditor.yProcessing.recommendation.domainThresholds", "pipelineEditor.yProcessing.recommendation.customClasses"],
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

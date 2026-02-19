/**
 * SHAP Analysis types for nirs4all webapp.
 *
 * These types match the API response models defined in api/shap.py
 */

// ============= Request Types =============

export type ExplainerType = 'auto' | 'tree' | 'kernel' | 'linear';
export type BinAggregation = 'sum' | 'sum_abs' | 'mean' | 'mean_abs';
export type Partition = 'train' | 'test' | 'all';

export interface ShapComputeRequest {
  chain_id?: string;
  bundle_path?: string;
  dataset_id: string;
  partition: Partition;
  explainer_type: ExplainerType;
  n_samples?: number | null;
  n_background: number;
  bin_size: number;
  bin_stride: number;
  bin_aggregation: BinAggregation;
}

export interface RebinRequest {
  bin_size: number;
  bin_stride: number;
  bin_aggregation: BinAggregation;
}

// ============= Response Types =============

export interface FeatureImportance {
  feature_idx: number;
  feature_name: string;
  wavelength: number | null;
  importance: number;
}

export interface BinnedImportanceData {
  bin_centers: number[];
  bin_values: number[];
  bin_ranges: [number, number][];
  bin_size: number;
  bin_stride: number;
  aggregation: string;
}

export interface ShapComputeResponse {
  job_id: string;
  status: string;
  message: string;
}

export interface ShapResultsResponse {
  job_id: string;
  model_id: string;
  dataset_id: string;
  explainer_type: string;
  n_samples: number;
  n_features: number;
  base_value: number;
  execution_time_ms: number;
  feature_importance: FeatureImportance[];
  wavelengths: number[];
  mean_abs_shap: number[];
  mean_spectrum: number[];
  binned_importance: BinnedImportanceData;
  sample_indices: number[];
}

export interface SpectralImportanceData {
  wavelengths: number[];
  mean_spectrum: number[];
  mean_abs_shap: number[];
  binned_importance: BinnedImportanceData;
}

export interface SpectralDetailData {
  wavelengths: number[];
  mean_spectrum: number[];
  mean_abs_shap: number[];
  n_samples: number;
}

export interface ScatterData {
  y_true: number[];
  y_pred: number[];
  sample_indices: number[];
  residuals: number[];
}

export interface BeeswarmPoint {
  sample_idx: number;
  shap_value: number;
  feature_value: number;
}

export interface BeeswarmBin {
  label: string;
  center: number;
  start_wavelength: number;
  end_wavelength: number;
  points: BeeswarmPoint[];
}

export interface BeeswarmDataResponse {
  bins: BeeswarmBin[];
  base_value: number;
}

export interface FeatureContribution {
  feature_name: string;
  wavelength: number | null;
  shap_value: number;
  feature_value: number;
  cumulative: number;
}

export interface SampleExplanationResponse {
  sample_idx: number;
  predicted_value: number;
  base_value: number;
  contributions: FeatureContribution[];
}

export interface AvailableChain {
  chain_id: string;
  dataset_name: string;
  model_class: string;
  model_name: string;
  preprocessings: string;
  run_id: string;
  metric: string;
  cv_val_score: number | null;
  final_test_score: number | null;
  cv_fold_count: number;
  has_refit: boolean;
}

export interface DatasetChains {
  dataset_name: string;
  metric: string;
  task_type: string | null;
  chains: AvailableChain[];
}

export interface AvailableBundle {
  bundle_path: string;
  display_name: string;
  dataset_name: string;
}

export interface AvailableModelsResponse {
  datasets: DatasetChains[];
  bundles: AvailableBundle[];
}

export interface ExplainerTypeInfo {
  name: string;
  display_name: string;
  description: string;
  recommended_for: string[];
}

export interface ShapConfigResponse {
  explainer_types: ExplainerTypeInfo[];
  default_bin_size: number;
  default_bin_stride: number;
  aggregation_methods: string[];
  shap_available: boolean;
}

// ============= UI State Types =============

export type ShapTab = 'spectral' | 'beeswarm' | 'waterfall' | 'ranking';

// ============= Chart Data Types =============

export interface SpectralChartData {
  wavelength: number;
  absorbance: number;
  importance: number;
}

export interface SpectralBandData {
  start: number;
  end: number;
  importance: number;
  normalizedImportance: number;
}

export interface BeeswarmChartData {
  bins: Array<{
    label: string;
    points: Array<{
      x: number;
      y: number;
      color: number;
      sampleIdx: number;
    }>;
  }>;
}

export interface WaterfallBarData {
  name: string;
  value: number;
  cumulative: number;
  direction: 'positive' | 'negative';
  isBase?: boolean;
  isFinal?: boolean;
}

export interface ImportanceBarData {
  featureName: string;
  wavelength: number | null;
  importance: number;
  rank: number;
}

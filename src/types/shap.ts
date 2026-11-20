/**
 * SHAP Analysis types for nirs4all webapp.
 *
 * These types match the API response models defined in api/shap.py
 */

// ============= Request Types =============

/** Python `shap` selectors, plus the native (nirs4all-methods) model-agnostic explainers. */
export type ExplainerType = 'auto' | 'tree' | 'kernel' | 'linear' | 'permutation' | 'exact' | 'lime' | 'occlusion';
/** `python`: the `shap` package; `native`: the nirs4all-methods kernels (as in Web). */
export type ShapEngine = 'python' | 'native';
export type ShapBaseline = 'background' | 'mean';
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
  /** Native engine only (`methods`); omitted for the Python `shap` engine. */
  explainer_backend?: 'shap' | 'methods';
  baseline?: ShapBaseline;
  group_width?: number;
  n_permutations?: number;
  seed?: number;
  /** Replaces `partition` when present: background candidates and explained samples. */
  subsets?: { background: ShapSubset; explained: ShapSubset };
}

/** A row matches when its metadata value is one of `values`. */
export interface ShapSubsetFilter {
  column: string;
  values: (string | number | boolean | null)[];
}

/** One partition narrowed by metadata filters (combined with AND). */
export interface ShapSubset {
  partition: Partition;
  filters: ShapSubsetFilter[];
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
  axis_unit?: string | null;
  job_id: string;
  model_id: string;
  dataset_id: string;
  explainer_type: string;
  explainer_backend?: 'shap' | 'methods';
  /** False for LIME and occlusion: attributions do not sum to the prediction. */
  additive?: boolean;
  n_samples: number;
  /** Attributed columns: input features, or contiguous feature groups (native engine). */
  n_features: number;
  /** Input features of the explained model, when attributions are grouped. */
  n_input_features?: number;
  /** Shared expected value; null for non-additive explainers (one local intercept per row). */
  base_value: number | null;
  /** Rows passed to the SHAP engine with metadata subsets; the background is drawn among all of them. */
  background_pool?: { background_candidates: number; explained_outside_background: number } | null;
  execution_time_ms: number;
  feature_importance: FeatureImportance[];
  wavelengths: number[];
  mean_abs_shap: number[];
  mean_spectrum: number[];
  binned_importance: BinnedImportanceData;
  sample_indices: number[];
}

export interface SpectralImportanceData {
  axis_unit?: string | null;
  wavelengths: number[];
  mean_spectrum: number[];
  mean_abs_shap: number[];
  binned_importance: BinnedImportanceData;
}

export interface SpectralDetailData {
  axis_unit?: string | null;
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
  axis_unit?: string | null;
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
  axis_unit?: string | null;
  sample_idx: number;
  predicted_value: number;
  base_value: number;
  contributions: FeatureContribution[];
}

export interface AvailableChain {
  chain_id: string;
  dataset_name: string;
  linked_dataset_id?: string | null;
  dataset_link_status?: 'linked' | 'unresolved';
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
  linked_dataset_id?: string | null;
  dataset_link_status?: 'linked' | 'unresolved';
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

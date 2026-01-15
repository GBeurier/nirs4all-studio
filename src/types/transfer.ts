/**
 * Transfer Analysis types for nirs4all webapp.
 *
 * These types match the API response models defined in api/transfer.py
 */

// ============= Request Types =============

export interface PreprocessingStep {
  name: string;
  params?: Record<string, unknown>;
}

export interface PreprocessingConfig {
  mode: 'preset' | 'manual';
  preset?: 'fast' | 'balanced' | 'thorough' | 'full';
  manual_steps?: string[];
}

export interface TransferAnalysisRequest {
  dataset_ids: string[];
  preprocessing: PreprocessingConfig;
  n_components?: number;
  knn?: number;
}

// ============= Response Types =============

export interface DatasetPairDistance {
  dataset_1: string;
  dataset_2: string;
  centroid_dist_raw: number;
  centroid_dist_pp: number;
  centroid_improvement: number; // Percentage
  spread_dist_raw: number;
  spread_dist_pp: number;
  spread_improvement: number;
  subspace_angle_raw?: number | null;
  subspace_angle_pp?: number | null;
}

export interface PreprocessingRankingItem {
  preproc: string;
  display_name: string;
  avg_distance: number;
  reduction_pct: number;
  raw_distance: number;
}

export interface PCACoordinate {
  sample_index: number;
  dataset: string;
  x: number; // PC1
  y: number; // PC2
  z?: number | null; // PC3 (optional)
}

export interface MetricConvergenceItem {
  preproc: string;
  metric: string;
  var_raw: number;
  var_pp: number;
  convergence: number; // Positive = variance reduced
}

export interface DatasetInfo {
  id: string;
  name: string;
  n_samples: number;
  n_features: number;
}

export interface TransferAnalysisSummary {
  best_preprocessing: string;
  best_reduction_pct: number;
  n_datasets: number;
  n_preprocessings: number;
  n_pairs: number;
}

export interface TransferAnalysisResponse {
  success: boolean;
  execution_time_ms: number;

  // Distance matrices per preprocessing
  distance_matrices: Record<string, DatasetPairDistance[]>;

  // Preprocessing ranking by metric
  preprocessing_ranking: Record<string, PreprocessingRankingItem[]>;

  // PCA coordinates for visualization
  pca_coordinates: Record<string, PCACoordinate[]>;

  // Metric convergence data
  metric_convergence: MetricConvergenceItem[];

  // Summary and metadata
  summary: TransferAnalysisSummary;
  datasets: DatasetInfo[];
  preprocessings: string[];
}

// ============= Preset Types =============

export interface TransferPresetInfo {
  name: string;
  description: string;
  config: Record<string, unknown>;
}

// ============= Preprocessing Option Types =============

export interface PreprocessingOptionInfo {
  name: string;
  display_name: string;
  category: string;
  description: string;
  default_params?: Record<string, unknown>;
}

// ============= UI State Types =============

export type TransferMetricType = 'centroid' | 'spread';

export interface TransferAnalysisState {
  selectedDatasets: string[];
  preprocessingConfig: PreprocessingConfig;
  nComponents: number;
  knn: number;
  results: TransferAnalysisResponse | null;
  isLoading: boolean;
  error: string | null;

  // UI state
  activePreprocessing: string | null;
  selectedMetric: TransferMetricType;
  activeTab: 'summary' | 'distances' | 'pca' | 'metrics';
}

// ============= Chart Data Types =============

export interface HeatmapCell {
  x: string;
  y: string;
  value: number;
  improvement?: number;
}

export interface RankingBarData {
  preproc: string;
  displayName: string;
  reductionPct: number;
  rawDistance: number;
  ppDistance: number;
}

export interface ScatterPoint {
  x: number;
  y: number;
  dataset: string;
  sampleIndex: number;
}

export interface ConvergenceBarData {
  preproc: string;
  convergence: number;
  varRaw: number;
  varPp: number;
}

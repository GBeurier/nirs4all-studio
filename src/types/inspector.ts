/**
 * Inspector — TypeScript types for Phases 1–5.
 *
 * Prediction Explorer & Model Performance Analyzer types:
 * chain summaries, scatter/histogram/rankings/heatmap/candlestick data,
 * branch comparison, branch topology, fold stability,
 * confusion matrix, robustness radar, metric correlation,
 * preprocessing impact, hyperparameter sensitivity, bias-variance,
 * learning curve, expression-based grouping, groups, filters,
 * color config, selection tools, and panel definitions.
 */

import type { ContinuousPalette, CategoricalPalette } from '@/lib/playground/colorConfig';

// ============= Panel Types =============

export type InspectorPanelType =
  | 'scatter' | 'residuals' | 'rankings' | 'histogram' | 'heatmap' | 'candlestick'
  | 'branch_comparison' | 'branch_topology' | 'fold_stability'
  | 'confusion' | 'robustness' | 'correlation'
  | 'preprocessing_impact' | 'hyperparameter' | 'bias_variance' | 'learning_curve';

export type InspectorViewState = 'visible' | 'hidden' | 'maximized' | 'minimized';

// ============= Selection Tool Types (Phase 3) =============

export type InspectorSelectionToolMode = 'click' | 'box' | 'lasso';

export interface InspectorSavedSelection {
  id: string;
  name: string;
  chain_ids: string[];
  createdAt: string;
  color?: string;
}

// ============= Chain Summary (from backend) =============

export interface InspectorChainSummary {
  chain_id: string;
  run_id: string;
  pipeline_id: string;
  model_class: string;
  model_name: string | null;
  preprocessings: string | null;
  branch_path: unknown;
  source_index: number | null;
  metric: string | null;
  task_type: string | null;
  dataset_name: string | null;
  best_params: Record<string, unknown> | null;
  cv_val_score: number | null;
  cv_test_score: number | null;
  cv_train_score: number | null;
  cv_fold_count: number;
  final_test_score: number | null;
  final_train_score: number | null;
  pipeline_status: string | null;
}

// ============= API Responses =============

export interface InspectorDataResponse {
  chains: InspectorChainSummary[];
  total: number;
  available_metrics: string[];
  available_models: string[];
  available_datasets: string[];
  available_runs: string[];
  generated_at: string;
}

export interface ScatterPoint {
  chain_id: string;
  model_class: string;
  model_name: string | null;
  preprocessings: string | null;
  y_true: number[];
  y_pred: number[];
  sample_indices: number[] | null;
  fold_id: string | null;
  score: number | null;
}

export interface ScatterResponse {
  points: ScatterPoint[];
  partition: string;
  total_samples: number;
}

export interface HistogramBin {
  bin_start: number;
  bin_end: number;
  count: number;
  chain_ids: string[];
}

export interface HistogramResponse {
  bins: HistogramBin[];
  score_column: string;
  total_chains: number;
  min_score: number | null;
  max_score: number | null;
  mean_score: number | null;
}

export interface RankingRow {
  rank: number;
  chain_id: string;
  model_class: string;
  model_name: string | null;
  preprocessings: string | null;
  cv_val_score: number | null;
  cv_test_score: number | null;
  cv_train_score: number | null;
  final_test_score: number | null;
  final_train_score: number | null;
  cv_fold_count: number;
  dataset_name: string | null;
  best_params: Record<string, unknown> | null;
}

export interface RankingsResponse {
  rankings: RankingRow[];
  total: number;
  score_column: string;
  sort_ascending: boolean;
}

// ============= Heatmap (Phase 2) =============

export interface HeatmapRequest {
  run_id?: string;
  dataset_name?: string;
  x_variable: string;
  y_variable: string;
  score_column: string;
  aggregate: 'best' | 'mean' | 'median' | 'worst';
}

export interface HeatmapCell {
  x_label: string;
  y_label: string;
  value: number | null;
  count: number;
  chain_ids: string[];
}

export interface HeatmapResponse {
  cells: HeatmapCell[];
  x_labels: string[];
  y_labels: string[];
  x_variable: string;
  y_variable: string;
  score_column: string;
  min_value: number | null;
  max_value: number | null;
}

// ============= Candlestick / Box Plot (Phase 2) =============

export interface CandlestickRequest {
  run_id?: string;
  dataset_name?: string;
  category_variable: string;
  score_column: string;
}

export interface CandlestickCategory {
  label: string;
  min: number;
  q25: number;
  median: number;
  q75: number;
  max: number;
  mean: number;
  count: number;
  outlier_values: number[];
  chain_ids: string[];
}

export interface CandlestickResponse {
  categories: CandlestickCategory[];
  category_variable: string;
  score_column: string;
}

// ============= Request Types =============

export interface ScatterRequest {
  chain_ids: string[];
  partition: string;
}

export interface InspectorDataFilters {
  run_id?: string;
  dataset_name?: string;
  model_class?: string;
}

// ============= Filter Types (Phase 2) =============

export type InspectorOutlierFilter = 'all' | 'hide' | 'only';
export type InspectorSelectionFilter = 'all' | 'selected' | 'unselected';

export interface InspectorFilterState {
  taskType: string;
  scoreRange: [number, number] | null;
  outlier: InspectorOutlierFilter;
  selection: InspectorSelectionFilter;
}

// ============= Color Types (Phase 2) =============

export type InspectorColorMode = 'group' | 'score' | 'dataset' | 'model_class';

export interface InspectorColorConfig {
  mode: InspectorColorMode;
  continuousPalette: ContinuousPalette;
  categoricalPalette: CategoricalPalette;
  unselectedOpacity: number;
  highlightSelection: boolean;
  highlightHover: boolean;
}

export const DEFAULT_INSPECTOR_COLOR_CONFIG: InspectorColorConfig = {
  mode: 'group',
  continuousPalette: 'viridis',
  categoricalPalette: 'default',
  unselectedOpacity: 0.25,
  highlightSelection: true,
  highlightHover: true,
};

// ============= Group Builder =============

export interface InspectorGroup {
  id: string;
  label: string;
  color: string;
  chain_ids: string[];
}

export type GroupByVariable =
  | 'model_class'
  | 'preprocessings'
  | 'dataset_name'
  | 'task_type';

export type GroupMode = 'by_variable' | 'by_range' | 'by_top_k' | 'by_branch' | 'by_expression';

export interface GroupByRangeConfig {
  column: ScoreColumn;
  binCount: number;
}

export interface GroupByTopKConfig {
  scoreColumn: ScoreColumn;
  k: number;
  ascending?: boolean;
}

// ============= Color Palette =============

export const INSPECTOR_GROUP_COLORS = [
  '#0d9488', // teal-600
  '#2563eb', // blue-600
  '#d97706', // amber-600
  '#e11d48', // rose-600
  '#7c3aed', // violet-600
  '#059669', // emerald-600
  '#ea580c', // orange-600
  '#0284c7', // sky-600
  '#db2777', // pink-600
  '#65a30d', // lime-600
] as const;

// ============= Score Column Options =============

export type ScoreColumn =
  | 'cv_val_score'
  | 'cv_test_score'
  | 'cv_train_score'
  | 'final_test_score'
  | 'final_train_score';

export const SCORE_COLUMNS: { value: ScoreColumn; label: string }[] = [
  { value: 'cv_val_score', label: 'CV Val Score' },
  { value: 'cv_test_score', label: 'CV Test Score' },
  { value: 'cv_train_score', label: 'CV Train Score' },
  { value: 'final_test_score', label: 'Final Test Score' },
  { value: 'final_train_score', label: 'Final Train Score' },
];

// ============= Branch Comparison (Phase 3) =============

export interface BranchComparisonRequest {
  run_id?: string;
  dataset_name?: string;
  score_column: string;
}

export interface BranchComparisonEntry {
  branch_path: string;
  label: string;
  mean: number;
  std: number;
  min: number;
  max: number;
  ci_lower: number;
  ci_upper: number;
  count: number;
  chain_ids: string[];
}

export interface BranchComparisonResponse {
  branches: BranchComparisonEntry[];
  score_column: string;
  total_chains: number;
}

// ============= Branch Topology (Phase 3) =============

export interface TopologyNode {
  id: string;
  label: string;
  type: 'transform' | 'splitter' | 'model' | 'merge' | 'branch' | 'data';
  depth: number;
  branch_path: number[];
  metrics?: {
    mean_score: number | null;
    chain_count: number;
  };
  children?: TopologyNode[];
  chain_ids?: string[];
}

export interface BranchTopologyRequest {
  pipeline_id: string;
  score_column?: string;
}

export interface BranchTopologyResponse {
  nodes: TopologyNode[];
  pipeline_id: string;
  pipeline_name: string;
  has_stacking: boolean;
  has_branches: boolean;
  max_depth: number;
}

// ============= Fold Stability (Phase 3) =============

export interface FoldScoreEntry {
  chain_id: string;
  model_class: string;
  preprocessings: string | null;
  fold_id: string;
  fold_index: number;
  score: number;
}

export interface FoldStabilityRequest {
  chain_ids: string[];
  score_column: string;
  partition: string;
}

export interface FoldStabilityResponse {
  entries: FoldScoreEntry[];
  fold_ids: string[];
  score_column: string;
  total_chains: number;
}

// ============= Confusion Matrix (Phase 4) =============

export interface ConfusionMatrixRequest {
  chain_ids: string[];
  partition: string;
  normalize?: 'none' | 'row' | 'column' | 'all';
}

export interface ConfusionMatrixCell {
  true_label: string;
  pred_label: string;
  count: number;
  normalized: number | null;
}

export interface ConfusionMatrixResponse {
  cells: ConfusionMatrixCell[];
  labels: string[];
  total_samples: number;
  partition: string;
  normalize: string;
}

// ============= Robustness Radar (Phase 4) =============

export interface RobustnessRequest {
  chain_ids: string[];
  score_column: string;
  partition: string;
}

export interface RobustnessAxis {
  name: string;
  label: string;
  value: number;
  raw_value: number;
  description: string;
}

export interface RobustnessEntry {
  chain_id: string;
  model_class: string;
  preprocessings: string | null;
  axes: RobustnessAxis[];
}

export interface RobustnessResponse {
  entries: RobustnessEntry[];
  axis_names: string[];
  score_column: string;
}

// ============= Metric Correlation (Phase 4) =============

export interface MetricCorrelationRequest {
  run_id?: string;
  dataset_name?: string;
  metrics?: string[];
  method?: 'pearson' | 'spearman';
}

export interface CorrelationCell {
  metric_x: string;
  metric_y: string;
  coefficient: number | null;
  count: number;
}

export interface MetricCorrelationResponse {
  cells: CorrelationCell[];
  metrics: string[];
  method: string;
  total_chains: number;
}

// ============= Expression-Based Grouping (Phase 5) =============

export type ExpressionField = keyof InspectorChainSummary;

export type ExpressionOperator =
  | 'eq' | 'neq'
  | 'contains' | 'not_contains'
  | 'gt' | 'lt' | 'gte' | 'lte';

export type ExpressionCombinator = 'AND' | 'OR';

export interface ExpressionRule {
  id: string;
  field: ExpressionField;
  operator: ExpressionOperator;
  value: string;
}

export interface ExpressionGroup {
  id: string;
  label: string;
  combinator: ExpressionCombinator;
  rules: ExpressionRule[];
}

export interface GroupByExpressionConfig {
  groups: ExpressionGroup[];
}

// ============= Preprocessing Impact (Phase 5) =============

export interface PreprocessingImpactRequest {
  run_id?: string;
  dataset_name?: string;
  score_column: string;
}

export interface PreprocessingImpactEntry {
  step_name: string;
  impact: number;
  mean_with: number;
  mean_without: number;
  count_with: number;
  count_without: number;
}

export interface PreprocessingImpactResponse {
  entries: PreprocessingImpactEntry[];
  score_column: string;
  total_chains: number;
}

// ============= Hyperparameter Sensitivity (Phase 5) =============

export interface HyperparameterRequest {
  run_id?: string;
  dataset_name?: string;
  param_name: string;
  score_column: string;
}

export interface HyperparameterPoint {
  chain_id: string;
  param_value: number;
  score: number;
  model_class: string;
}

export interface HyperparameterResponse {
  points: HyperparameterPoint[];
  param_name: string;
  score_column: string;
  available_params: string[];
}

// ============= Bias-Variance Decomposition (Phase 5) =============

export interface BiasVarianceRequest {
  chain_ids: string[];
  score_column: string;
  group_by?: string;
}

export interface BiasVarianceEntry {
  group_label: string;
  bias_squared: number;
  variance: number;
  total_error: number;
  n_chains: number;
  n_folds: number;
  n_samples: number;
  chain_ids: string[];
}

export interface BiasVarianceResponse {
  entries: BiasVarianceEntry[];
  score_column: string;
  group_by: string;
}

// ============= Learning Curve (Phase 5) =============

export interface LearningCurveRequest {
  run_id?: string;
  dataset_name?: string;
  score_column: string;
  model_class?: string;
}

export interface LearningCurvePoint {
  train_size: number;
  train_mean: number;
  train_std: number;
  val_mean: number;
  val_std: number;
  count: number;
}

export interface LearningCurveResponse {
  points: LearningCurvePoint[];
  score_column: string;
  has_multiple_sizes: boolean;
}

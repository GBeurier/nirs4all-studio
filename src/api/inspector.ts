/**
 * Inspector API client functions.
 */

import { api } from './client';
import type {
  InspectorDataResponse,
  InspectorDataFilters,
  ScatterRequest,
  ScatterResponse,
  HistogramResponse,
  RankingsResponse,
  HeatmapRequest,
  HeatmapResponse,
  CandlestickRequest,
  CandlestickResponse,
  BranchComparisonRequest,
  BranchComparisonResponse,
  BranchTopologyResponse,
  FoldStabilityRequest,
  FoldStabilityResponse,
  ConfusionMatrixRequest,
  ConfusionMatrixResponse,
  RobustnessRequest,
  RobustnessResponse,
  MetricCorrelationRequest,
  MetricCorrelationResponse,
  PreprocessingImpactRequest,
  PreprocessingImpactResponse,
  HyperparameterRequest,
  HyperparameterResponse,
  BiasVarianceRequest,
  BiasVarianceResponse,
  LearningCurveRequest,
  LearningCurveResponse,
} from '@/types/inspector';

/**
 * Load chain summaries and metadata for the Inspector.
 * Supports multi-value filters via repeated query params.
 */
export async function getInspectorData(
  filters?: InspectorDataFilters
): Promise<InspectorDataResponse> {
  const params = new URLSearchParams();
  if (filters?.run_ids) {
    for (const id of filters.run_ids) params.append('run_id', id);
  }
  if (filters?.dataset_names) {
    for (const name of filters.dataset_names) params.append('dataset_name', name);
  }
  if (filters?.model_classes) {
    for (const mc of filters.model_classes) params.append('model_class', mc);
  }
  if (filters?.preprocessings) {
    for (const p of filters.preprocessings) params.append('preprocessings', p);
  }
  if (filters?.task_type) params.set('task_type', filters.task_type);
  if (filters?.metric) params.set('metric', filters.metric);
  const qs = params.toString();
  return api.get<InspectorDataResponse>(`/inspector/data${qs ? `?${qs}` : ''}`);
}

/**
 * Get scatter data (y_true vs y_pred) for selected chains.
 */
export async function getScatterData(
  request: ScatterRequest
): Promise<ScatterResponse> {
  return api.post<ScatterResponse>('/inspector/scatter', request);
}

/**
 * Get score distribution histogram bins.
 */
export async function getHistogramData(params: {
  run_id?: string[];
  dataset_name?: string[];
  score_column?: string;
  n_bins?: number;
}): Promise<HistogramResponse> {
  const qs = new URLSearchParams();
  if (params.run_id) {
    for (const id of params.run_id) qs.append('run_id', id);
  }
  if (params.dataset_name) {
    for (const name of params.dataset_name) qs.append('dataset_name', name);
  }
  if (params.score_column) qs.set('score_column', params.score_column);
  if (params.n_bins) qs.set('n_bins', String(params.n_bins));
  const query = qs.toString();
  return api.get<HistogramResponse>(`/inspector/histogram${query ? `?${query}` : ''}`);
}

/**
 * Get rankings data (sorted chain summaries with rank).
 */
export async function getRankingsData(params: {
  run_id?: string[];
  dataset_name?: string[];
  score_column?: string;
  sort_ascending?: boolean;
  limit?: number;
  offset?: number;
}): Promise<RankingsResponse> {
  const qs = new URLSearchParams();
  if (params.run_id) {
    for (const id of params.run_id) qs.append('run_id', id);
  }
  if (params.dataset_name) {
    for (const name of params.dataset_name) qs.append('dataset_name', name);
  }
  if (params.score_column) qs.set('score_column', params.score_column);
  if (params.sort_ascending !== undefined) qs.set('sort_ascending', String(params.sort_ascending));
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  const query = qs.toString();
  return api.get<RankingsResponse>(`/inspector/rankings${query ? `?${query}` : ''}`);
}

/**
 * Get performance heatmap data (score at intersection of 2 variables).
 */
export async function getHeatmapData(
  request: HeatmapRequest
): Promise<HeatmapResponse> {
  return api.post<HeatmapResponse>('/inspector/heatmap', request);
}

/**
 * Get candlestick / box-plot statistics per category.
 */
export async function getCandlestickData(
  request: CandlestickRequest
): Promise<CandlestickResponse> {
  return api.post<CandlestickResponse>('/inspector/candlestick', request);
}

/**
 * Get branch comparison data (mean + CI per branch).
 */
export async function getBranchComparisonData(
  request: BranchComparisonRequest
): Promise<BranchComparisonResponse> {
  return api.post<BranchComparisonResponse>('/inspector/branch-comparison', request);
}

/**
 * Get branch topology data (pipeline DAG structure).
 */
export async function getBranchTopologyData(
  params: { pipeline_id: string; score_column?: string }
): Promise<BranchTopologyResponse> {
  const qs = new URLSearchParams();
  qs.set('pipeline_id', params.pipeline_id);
  if (params.score_column) qs.set('score_column', params.score_column);
  return api.get<BranchTopologyResponse>(`/inspector/branch-topology?${qs}`);
}

/**
 * Get fold stability data (per-fold scores for selected chains).
 */
export async function getFoldStabilityData(
  request: FoldStabilityRequest
): Promise<FoldStabilityResponse> {
  return api.post<FoldStabilityResponse>('/inspector/fold-stability', request);
}

/**
 * Get confusion matrix for classification chains.
 */
export async function getConfusionMatrixData(
  request: ConfusionMatrixRequest
): Promise<ConfusionMatrixResponse> {
  return api.post<ConfusionMatrixResponse>('/inspector/confusion', request);
}

/**
 * Get robustness radar data (multi-dimensional robustness profile).
 */
export async function getRobustnessData(
  request: RobustnessRequest
): Promise<RobustnessResponse> {
  return api.post<RobustnessResponse>('/inspector/robustness', request);
}

/**
 * Get metric correlation matrix.
 */
export async function getMetricCorrelationData(
  request: MetricCorrelationRequest
): Promise<MetricCorrelationResponse> {
  return api.post<MetricCorrelationResponse>('/inspector/correlation', request);
}

/**
 * Get preprocessing step impact analysis.
 */
export async function getPreprocessingImpactData(
  request: PreprocessingImpactRequest
): Promise<PreprocessingImpactResponse> {
  return api.post<PreprocessingImpactResponse>('/inspector/preprocessing-impact', request);
}

/**
 * Get hyperparameter sensitivity scatter data.
 */
export async function getHyperparameterData(
  request: HyperparameterRequest
): Promise<HyperparameterResponse> {
  return api.post<HyperparameterResponse>('/inspector/hyperparameter', request);
}

/**
 * Get bias-variance decomposition data.
 */
export async function getBiasVarianceData(
  request: BiasVarianceRequest
): Promise<BiasVarianceResponse> {
  return api.post<BiasVarianceResponse>('/inspector/bias-variance', request);
}

/**
 * Get learning curve data by training set size.
 */
export async function getLearningCurveData(
  request: LearningCurveRequest
): Promise<LearningCurveResponse> {
  return api.post<LearningCurveResponse>('/inspector/learning-curve', request);
}

/**
 * Inspector TanStack Query hooks for data fetching.
 */

import { useQuery } from '@tanstack/react-query';
import {
  getScatterData, getHistogramData, getRankingsData, getHeatmapData, getCandlestickData,
  getBranchComparisonData, getBranchTopologyData, getFoldStabilityData,
  getConfusionMatrixData, getRobustnessData, getMetricCorrelationData,
  getPreprocessingImpactData, getHyperparameterData, getBiasVarianceData, getLearningCurveData,
} from '@/api/inspector';
import type {
  ScatterRequest, HeatmapRequest, CandlestickRequest, BranchComparisonRequest, FoldStabilityRequest,
  ConfusionMatrixRequest, RobustnessRequest, MetricCorrelationRequest,
  PreprocessingImpactRequest, HyperparameterRequest, BiasVarianceRequest, LearningCurveRequest,
} from '@/types/inspector';

/**
 * Fetch scatter data (y_true vs y_pred) for selected chains.
 */
export function useInspectorScatter(request: ScatterRequest | null) {
  return useQuery({
    queryKey: ['inspector', 'scatter', request],
    queryFn: () => getScatterData(request!),
    enabled: !!request && request.chain_ids.length > 0,
    staleTime: 60_000,
  });
}

/**
 * Fetch score distribution histogram.
 */
export function useInspectorHistogram(params: {
  run_id?: string[];
  dataset_name?: string[];
  score_column?: string;
  n_bins?: number;
} | null) {
  return useQuery({
    queryKey: ['inspector', 'histogram', params],
    queryFn: () => getHistogramData(params!),
    enabled: !!params,
    staleTime: 30_000,
  });
}

/**
 * Fetch rankings data.
 */
export function useInspectorRankings(params: {
  run_id?: string[];
  dataset_name?: string[];
  score_column?: string;
  sort_ascending?: boolean;
  limit?: number;
  offset?: number;
} | null) {
  return useQuery({
    queryKey: ['inspector', 'rankings', params],
    queryFn: () => getRankingsData(params!),
    enabled: !!params,
    staleTime: 30_000,
  });
}

/**
 * Fetch performance heatmap data.
 */
export function useInspectorHeatmap(request: HeatmapRequest | null) {
  return useQuery({
    queryKey: ['inspector', 'heatmap', request],
    queryFn: () => getHeatmapData(request!),
    enabled: !!request,
    staleTime: 30_000,
  });
}

/**
 * Fetch candlestick / box-plot data.
 */
export function useInspectorCandlestick(request: CandlestickRequest | null) {
  return useQuery({
    queryKey: ['inspector', 'candlestick', request],
    queryFn: () => getCandlestickData(request!),
    enabled: !!request,
    staleTime: 30_000,
  });
}

/**
 * Fetch branch comparison data (mean + CI per branch).
 */
export function useInspectorBranchComparison(request: BranchComparisonRequest | null) {
  return useQuery({
    queryKey: ['inspector', 'branch-comparison', request],
    queryFn: () => getBranchComparisonData(request!),
    enabled: !!request,
    staleTime: 30_000,
  });
}

/**
 * Fetch branch topology data (pipeline DAG structure).
 */
export function useInspectorBranchTopology(params: { pipeline_id: string; score_column?: string } | null) {
  return useQuery({
    queryKey: ['inspector', 'branch-topology', params],
    queryFn: () => getBranchTopologyData(params!),
    enabled: !!params,
    staleTime: 60_000,
  });
}

/**
 * Fetch fold stability data (per-fold scores).
 */
export function useInspectorFoldStability(request: FoldStabilityRequest | null) {
  return useQuery({
    queryKey: ['inspector', 'fold-stability', request],
    queryFn: () => getFoldStabilityData(request!),
    enabled: !!request && request.chain_ids.length > 0,
    staleTime: 60_000,
  });
}

/**
 * Fetch confusion matrix data (classification only).
 */
export function useInspectorConfusionMatrix(request: ConfusionMatrixRequest | null) {
  return useQuery({
    queryKey: ['inspector', 'confusion', request],
    queryFn: () => getConfusionMatrixData(request!),
    enabled: !!request && request.chain_ids.length > 0,
    staleTime: 60_000,
  });
}

/**
 * Fetch robustness radar data (multi-dimensional robustness profile).
 */
export function useInspectorRobustness(request: RobustnessRequest | null) {
  return useQuery({
    queryKey: ['inspector', 'robustness', request],
    queryFn: () => getRobustnessData(request!),
    enabled: !!request && request.chain_ids.length > 0,
    staleTime: 60_000,
  });
}

/**
 * Fetch metric correlation matrix.
 */
export function useInspectorMetricCorrelation(request: MetricCorrelationRequest | null) {
  return useQuery({
    queryKey: ['inspector', 'correlation', request],
    queryFn: () => getMetricCorrelationData(request!),
    enabled: !!request,
    staleTime: 30_000,
  });
}

/**
 * Fetch preprocessing impact analysis.
 */
export function useInspectorPreprocessingImpact(request: PreprocessingImpactRequest | null) {
  return useQuery({
    queryKey: ['inspector', 'preprocessing-impact', request],
    queryFn: () => getPreprocessingImpactData(request!),
    enabled: !!request,
    staleTime: 30_000,
  });
}

/**
 * Fetch hyperparameter sensitivity scatter data.
 */
export function useInspectorHyperparameter(request: HyperparameterRequest | null) {
  return useQuery({
    queryKey: ['inspector', 'hyperparameter', request],
    queryFn: () => getHyperparameterData(request!),
    enabled: !!request,
    staleTime: 30_000,
  });
}

/**
 * Fetch bias-variance decomposition data.
 */
export function useInspectorBiasVariance(request: BiasVarianceRequest | null) {
  return useQuery({
    queryKey: ['inspector', 'bias-variance', request],
    queryFn: () => getBiasVarianceData(request!),
    enabled: !!request && request.chain_ids.length > 0,
    staleTime: 60_000,
  });
}

/**
 * Fetch learning curve data by training set size.
 */
export function useInspectorLearningCurve(request: LearningCurveRequest | null) {
  return useQuery({
    queryKey: ['inspector', 'learning-curve', request],
    queryFn: () => getLearningCurveData(request!),
    enabled: !!request,
    staleTime: 30_000,
  });
}

/**
 * InspectorCanvas — Main visualization area with responsive grid of panels.
 *
 * Manages data fetching for panels and renders the grid layout.
 * Residuals panel shares scatter data. All other panels fetch lazily when visible.
 */

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useInspectorView } from '@/context/InspectorViewContext';
import { useInspectorData } from '@/context/InspectorDataContext';
import { useInspectorSelection } from '@/context/InspectorSelectionContext';
import { useInspectorFilter } from '@/context/InspectorFilterContext';
import {
  useInspectorScatter,
  useInspectorHistogram,
  useInspectorRankings,
  useInspectorHeatmap,
  useInspectorCandlestick,
  useInspectorBranchComparison,
  useInspectorBranchTopology,
  useInspectorFoldStability,
  useInspectorConfusionMatrix,
  useInspectorRobustness,
  useInspectorMetricCorrelation,
  useInspectorPreprocessingImpact,
  useInspectorHyperparameter,
  useInspectorBiasVariance,
  useInspectorLearningCurve,
} from '@/hooks/useInspectorData';
import { InspectorPanel } from './InspectorPanel';
import { InspectorToolbar } from './InspectorToolbar';
import { PredVsObsChart } from './visualizations/PredVsObsChart';
import { ResidualsChart } from './visualizations/ResidualsChart';
import { ScoreHistogram } from './visualizations/ScoreHistogram';
import { RankingsTable } from './visualizations/RankingsTable';
import { PerformanceHeatmap } from './visualizations/PerformanceHeatmap';
import { CandlestickChart } from './visualizations/CandlestickChart';
import { BranchComparisonChart } from './visualizations/BranchComparisonChart';
import { BranchTopologyDiagram } from './visualizations/BranchTopologyDiagram';
import { FoldStabilityChart } from './visualizations/FoldStabilityChart';
import { ConfusionMatrixChart } from './visualizations/ConfusionMatrixChart';
import { RobustnessRadar } from './visualizations/RobustnessRadar';
import { MetricCorrelation } from './visualizations/MetricCorrelation';
import { PreprocessingImpact } from './visualizations/PreprocessingImpact';
import { HyperparameterSensitivity } from './visualizations/HyperparameterSensitivity';
import { BiasVariance } from './visualizations/BiasVariance';
import { LearningCurve } from './visualizations/LearningCurve';
import type { InspectorPanelType } from '@/types/inspector';

export function InspectorCanvas() {
  const {
    panelStates,
    maximizedPanel,
    isPanelVisible,
    maximizePanel,
    minimizePanel,
    restorePanel,
    togglePanel,
    visibleCount,
  } = useInspectorView();

  const {
    chains,
    groups,
    filters,
    scoreColumn,
    partition,
    totalChains,
  } = useInspectorData();

  const { selectedChains, selectedCount } = useInspectorSelection();
  const { filteredChainIds } = useInspectorFilter();

  // Hyperparameter panel state
  const [selectedHyperParam, setSelectedHyperParam] = useState<string>('');

  // Determine which chains to show scatter data for
  const scatterChainIds = useMemo(() => {
    if (selectedChains.size > 0) {
      // Intersect selection with filtered chains
      const ids: string[] = [];
      for (const id of selectedChains) {
        if (filteredChainIds.has(id)) ids.push(id);
      }
      return ids;
    }
    // If no selection, show top 10 filtered chains by default
    const arr = Array.from(filteredChainIds);
    return arr.slice(0, 10);
  }, [selectedChains, filteredChainIds]);

  // Scatter data (POST with chain_ids) — shared by scatter + residuals panels
  const scatterRequest = useMemo(() => {
    const needsScatter = isPanelVisible('scatter') || isPanelVisible('residuals');
    if (!needsScatter || scatterChainIds.length === 0) return null;
    return { chain_ids: scatterChainIds, partition };
  }, [isPanelVisible, scatterChainIds, partition]);

  const { data: scatterData, isLoading: scatterLoading } = useInspectorScatter(scatterRequest);

  // Histogram data
  const histogramParams = useMemo(() => {
    if (!isPanelVisible('histogram') || chains.length === 0) return null;
    return {
      run_id: filters.run_ids,
      dataset_name: filters.dataset_names,
      score_column: scoreColumn,
    };
  }, [isPanelVisible, chains.length, filters, scoreColumn]);

  const { data: histogramData, isLoading: histogramLoading } = useInspectorHistogram(histogramParams);

  // Rankings data
  const rankingsParams = useMemo(() => {
    if (!isPanelVisible('rankings') || chains.length === 0) return null;
    return {
      run_id: filters.run_ids,
      dataset_name: filters.dataset_names,
      score_column: scoreColumn,
    };
  }, [isPanelVisible, chains.length, filters, scoreColumn]);

  const { data: rankingsData, isLoading: rankingsLoading } = useInspectorRankings(rankingsParams);

  // Heatmap data (lazy: only when panel visible)
  const heatmapParams = useMemo(() => {
    if (!isPanelVisible('heatmap') || chains.length === 0) return null;
    return {
      run_id: filters.run_ids,
      dataset_name: filters.dataset_names,
      x_variable: 'model_class',
      y_variable: 'preprocessings',
      score_column: scoreColumn,
      aggregate: 'best' as const,
    };
  }, [isPanelVisible, chains.length, filters, scoreColumn]);

  const { data: heatmapData, isLoading: heatmapLoading } = useInspectorHeatmap(heatmapParams);

  // Candlestick data (lazy: only when panel visible)
  const candlestickParams = useMemo(() => {
    if (!isPanelVisible('candlestick') || chains.length === 0) return null;
    return {
      run_id: filters.run_ids,
      dataset_name: filters.dataset_names,
      category_variable: 'model_class',
      score_column: scoreColumn,
    };
  }, [isPanelVisible, chains.length, filters, scoreColumn]);

  const { data: candlestickData, isLoading: candlestickLoading } = useInspectorCandlestick(candlestickParams);

  // Branch comparison data (lazy)
  const branchComparisonParams = useMemo(() => {
    if (!isPanelVisible('branch_comparison') || chains.length === 0) return null;
    return {
      run_id: filters.run_ids,
      dataset_name: filters.dataset_names,
      score_column: scoreColumn,
    };
  }, [isPanelVisible, chains.length, filters, scoreColumn]);

  const { data: branchComparisonData, isLoading: branchComparisonLoading } = useInspectorBranchComparison(branchComparisonParams);

  // Branch topology data (lazy — uses first chain's pipeline_id)
  const branchTopologyParams = useMemo(() => {
    if (!isPanelVisible('branch_topology') || chains.length === 0) return null;
    const pipelineId = chains[0]?.pipeline_id;
    if (!pipelineId) return null;
    return {
      pipeline_id: pipelineId,
      score_column: scoreColumn,
    };
  }, [isPanelVisible, chains, scoreColumn]);

  const { data: branchTopologyData, isLoading: branchTopologyLoading } = useInspectorBranchTopology(branchTopologyParams);

  // Fold stability data (lazy — uses same chain selection as scatter)
  const foldStabilityParams = useMemo(() => {
    if (!isPanelVisible('fold_stability') || scatterChainIds.length === 0) return null;
    return {
      chain_ids: scatterChainIds,
      score_column: scoreColumn,
      partition,
    };
  }, [isPanelVisible, scatterChainIds, scoreColumn, partition]);

  const { data: foldStabilityData, isLoading: foldStabilityLoading } = useInspectorFoldStability(foldStabilityParams);

  // Confusion matrix data (lazy — classification only, uses same chain selection)
  const confusionParams = useMemo(() => {
    if (!isPanelVisible('confusion') || scatterChainIds.length === 0) return null;
    return {
      chain_ids: scatterChainIds,
      partition,
    };
  }, [isPanelVisible, scatterChainIds, partition]);

  const { data: confusionData, isLoading: confusionLoading } = useInspectorConfusionMatrix(confusionParams);

  // Robustness radar data (lazy — uses same chain selection)
  const robustnessParams = useMemo(() => {
    if (!isPanelVisible('robustness') || scatterChainIds.length === 0) return null;
    return {
      chain_ids: scatterChainIds,
      score_column: scoreColumn,
      partition,
    };
  }, [isPanelVisible, scatterChainIds, scoreColumn, partition]);

  const { data: robustnessData, isLoading: robustnessLoading } = useInspectorRobustness(robustnessParams);

  // Metric correlation data (lazy)
  const correlationParams = useMemo(() => {
    if (!isPanelVisible('correlation') || chains.length === 0) return null;
    return {
      run_id: filters.run_ids,
      dataset_name: filters.dataset_names,
    };
  }, [isPanelVisible, chains.length, filters]);

  const { data: correlationData, isLoading: correlationLoading } = useInspectorMetricCorrelation(correlationParams);

  // ---- Phase 5 panels ----

  // Preprocessing impact data (lazy)
  const preprocImpactParams = useMemo(() => {
    if (!isPanelVisible('preprocessing_impact') || chains.length === 0) return null;
    return {
      run_id: filters.run_ids,
      dataset_name: filters.dataset_names,
      score_column: scoreColumn,
    };
  }, [isPanelVisible, chains.length, filters, scoreColumn]);

  const { data: preprocImpactData, isLoading: preprocImpactLoading } = useInspectorPreprocessingImpact(preprocImpactParams);

  // Discover available hyperparameters client-side from chain summaries
  const availableHyperParams = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of chains) {
      if (!c.best_params || typeof c.best_params !== 'object') continue;
      for (const [k, v] of Object.entries(c.best_params)) {
        if (typeof v === 'number' && isFinite(v)) {
          counts.set(k, (counts.get(k) ?? 0) + 1);
        }
      }
    }
    return [...counts.entries()]
      .filter(([, cnt]) => cnt >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k);
  }, [chains]);

  // Auto-select first param if none selected
  const activeHyperParam = selectedHyperParam || availableHyperParams[0] || '';

  // Hyperparameter sensitivity data (lazy)
  const hyperparamParams = useMemo(() => {
    if (!isPanelVisible('hyperparameter') || chains.length === 0 || !activeHyperParam) return null;
    return {
      run_id: filters.run_ids,
      dataset_name: filters.dataset_names,
      param_name: activeHyperParam,
      score_column: scoreColumn,
    };
  }, [isPanelVisible, chains.length, filters, scoreColumn, activeHyperParam]);

  const { data: hyperparamData, isLoading: hyperparamLoading } = useInspectorHyperparameter(hyperparamParams);

  // Bias-variance data (lazy — uses same chain selection)
  const biasVarianceParams = useMemo(() => {
    if (!isPanelVisible('bias_variance') || scatterChainIds.length === 0) return null;
    return {
      chain_ids: scatterChainIds,
      score_column: scoreColumn,
    };
  }, [isPanelVisible, scatterChainIds, scoreColumn]);

  const { data: biasVarianceData, isLoading: biasVarianceLoading } = useInspectorBiasVariance(biasVarianceParams);

  // Learning curve data (lazy)
  const learningCurveParams = useMemo(() => {
    if (!isPanelVisible('learning_curve') || chains.length === 0) return null;
    return {
      run_id: filters.run_ids,
      dataset_name: filters.dataset_names,
      score_column: scoreColumn,
    };
  }, [isPanelVisible, chains.length, filters, scoreColumn]);

  const { data: learningCurveData, isLoading: learningCurveLoading } = useInspectorLearningCurve(learningCurveParams);

  // Grid layout computation
  const gridClassName = useMemo(() => {
    if (maximizedPanel) return 'grid grid-cols-1 grid-rows-1';
    if (visibleCount <= 1) return 'grid grid-cols-1';
    if (visibleCount <= 2) return 'grid grid-cols-2';
    if (visibleCount <= 4) return 'grid grid-cols-2';
    return 'grid grid-cols-3'; // 5+ panels → 3-column grid
  }, [visibleCount, maximizedPanel]);

  // Panel rendering order
  const panelOrder: InspectorPanelType[] = [
    'rankings', 'heatmap', 'histogram', 'candlestick', 'scatter', 'preprocessing_impact',
    'residuals', 'branch_comparison', 'fold_stability', 'confusion',
    'branch_topology', 'robustness', 'correlation',
    'hyperparameter', 'bias_variance', 'learning_curve',
  ];

  // Common panel props builder
  const getPanelProps = (panelType: InspectorPanelType) => ({
    panelType,
    viewState: panelStates[panelType],
    isMaximized: maximizedPanel === panelType,
    onMaximize: () => maximizePanel(panelType),
    onMinimize: () => minimizePanel(panelType),
    onRestore: () => restorePanel(panelType),
    onHide: () => togglePanel(panelType),
    itemCount: totalChains,
    selectedCount,
  });

  // Hyperparameter panel header: param selector
  const hyperparamHeader = availableHyperParams.length > 0 ? (
    <Select value={activeHyperParam} onValueChange={setSelectedHyperParam}>
      <SelectTrigger className="h-5 text-[10px] w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {availableHyperParams.map(p => (
          <SelectItem key={p} value={p}>{p}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  ) : undefined;

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-background">
      {/* Toolbar */}
      <InspectorToolbar />

      {/* Panels grid */}
      <div className={cn('flex-1 p-3 gap-3 overflow-auto', gridClassName)}>
        {panelOrder.map(panelType => {
          const state = panelStates[panelType];
          if (state === 'hidden') return null;
          if (maximizedPanel && maximizedPanel !== panelType) return null;

          const props = getPanelProps(panelType);

          switch (panelType) {
            case 'scatter':
              return (
                <InspectorPanel key="scatter" {...props} isLoading={scatterLoading}>
                  <PredVsObsChart
                    data={scatterData}
                    groups={groups}
                    isLoading={scatterLoading}
                  />
                </InspectorPanel>
              );

            case 'residuals':
              return (
                <InspectorPanel key="residuals" {...props} isLoading={scatterLoading}>
                  <ResidualsChart
                    data={scatterData}
                    isLoading={scatterLoading}
                  />
                </InspectorPanel>
              );

            case 'rankings':
              return (
                <InspectorPanel key="rankings" {...props} isLoading={rankingsLoading}>
                  <RankingsTable
                    data={rankingsData}
                    groups={groups}
                    isLoading={rankingsLoading}
                  />
                </InspectorPanel>
              );

            case 'histogram':
              return (
                <InspectorPanel key="histogram" {...props} isLoading={histogramLoading}>
                  <ScoreHistogram
                    data={histogramData}
                    groups={groups}
                    isLoading={histogramLoading}
                  />
                </InspectorPanel>
              );

            case 'heatmap':
              return (
                <InspectorPanel key="heatmap" {...props} isLoading={heatmapLoading}>
                  <PerformanceHeatmap
                    data={heatmapData}
                    isLoading={heatmapLoading}
                  />
                </InspectorPanel>
              );

            case 'candlestick':
              return (
                <InspectorPanel key="candlestick" {...props} isLoading={candlestickLoading}>
                  <CandlestickChart
                    data={candlestickData}
                    isLoading={candlestickLoading}
                  />
                </InspectorPanel>
              );

            case 'branch_comparison':
              return (
                <InspectorPanel key="branch_comparison" {...props} isLoading={branchComparisonLoading}>
                  <BranchComparisonChart
                    data={branchComparisonData}
                    isLoading={branchComparisonLoading}
                  />
                </InspectorPanel>
              );

            case 'branch_topology':
              return (
                <InspectorPanel key="branch_topology" {...props} isLoading={branchTopologyLoading}>
                  <BranchTopologyDiagram
                    data={branchTopologyData}
                    isLoading={branchTopologyLoading}
                  />
                </InspectorPanel>
              );

            case 'fold_stability':
              return (
                <InspectorPanel key="fold_stability" {...props} isLoading={foldStabilityLoading}>
                  <FoldStabilityChart
                    data={foldStabilityData}
                    groups={groups}
                    isLoading={foldStabilityLoading}
                  />
                </InspectorPanel>
              );

            case 'confusion':
              return (
                <InspectorPanel key="confusion" {...props} isLoading={confusionLoading}>
                  <ConfusionMatrixChart
                    data={confusionData}
                    isLoading={confusionLoading}
                  />
                </InspectorPanel>
              );

            case 'robustness':
              return (
                <InspectorPanel key="robustness" {...props} isLoading={robustnessLoading}>
                  <RobustnessRadar
                    data={robustnessData}
                    isLoading={robustnessLoading}
                  />
                </InspectorPanel>
              );

            case 'correlation':
              return (
                <InspectorPanel key="correlation" {...props} isLoading={correlationLoading}>
                  <MetricCorrelation
                    data={correlationData}
                    isLoading={correlationLoading}
                  />
                </InspectorPanel>
              );

            case 'preprocessing_impact':
              return (
                <InspectorPanel key="preprocessing_impact" {...props} isLoading={preprocImpactLoading}>
                  <PreprocessingImpact
                    data={preprocImpactData}
                    isLoading={preprocImpactLoading}
                  />
                </InspectorPanel>
              );

            case 'hyperparameter':
              return (
                <InspectorPanel key="hyperparameter" {...props} isLoading={hyperparamLoading} headerContent={hyperparamHeader}>
                  <HyperparameterSensitivity
                    data={hyperparamData}
                    isLoading={hyperparamLoading}
                  />
                </InspectorPanel>
              );

            case 'bias_variance':
              return (
                <InspectorPanel key="bias_variance" {...props} isLoading={biasVarianceLoading}>
                  <BiasVariance
                    data={biasVarianceData}
                    isLoading={biasVarianceLoading}
                  />
                </InspectorPanel>
              );

            case 'learning_curve':
              return (
                <InspectorPanel key="learning_curve" {...props} isLoading={learningCurveLoading}>
                  <LearningCurve
                    data={learningCurveData}
                    isLoading={learningCurveLoading}
                  />
                </InspectorPanel>
              );

            default:
              return null;
          }
        })}

        {/* Empty state */}
        {visibleCount === 0 && (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm col-span-full">
            All panels are hidden. Use the toolbar to show them.
          </div>
        )}
      </div>
    </div>
  );
}

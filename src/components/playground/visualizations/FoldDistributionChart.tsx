/**
 * FoldDistributionChart - Enhanced fold visualization (Phase 3)
 *
 * Features:
 * - Color by mean target value per partition
 * - Color by metadata mode per partition
 * - Color by mean spectral metric per partition
 * - Interactive: click bar → select samples in partition via SelectionContext
 * - Improved tooltips with partition statistics
 * - View modes: counts, distribution, both
 * - Cross-chart selection highlighting
 * - Export functionality
 */

import React, { useMemo, useState, useCallback, useRef } from 'react';
import { exportDataAsCSV } from '@/lib/chartExport';
import {
  formatFoldLabel,
  computeUniformBins,
  calculateOptimalBinCount,
} from './chartConfig';
import {
  type GlobalColorConfig,
  type ColorContext,
  getHeldOutTestColor,
  PARTITION_COLORS,
} from '@/lib/playground/colorConfig';
import { isCategoricalTarget } from '@/lib/playground/targetTypeDetection';
import { useSelection } from '@/context/useSelection';
import type { FoldsInfo } from '@/types/playground';
import {
  buildFoldDistributionExportRows,
  buildFoldDistributionMetadataCategories,
  buildFoldDistributionPartitionBars,
  buildFoldDistributionSegmentKeys,
  buildFoldDistributionYStatsData,
  getFoldDistributionTargetMean,
  getCombinedGroupingNote,
  type FoldDistributionSegmentOptions,
  type PartitionBarData,
} from '@/lib/playground/foldDistributionData';
import {
  getFoldDistributionLightColor,
  getFoldDistributionPartitionBarColor,
  getFoldDistributionSegmentColor,
  getFoldDistributionSegmentLabel,
  type FoldDistributionPartitionPalette,
} from '@/lib/playground/foldDistributionPresentation';
import { FoldDistributionCountChart } from './FoldDistributionCountChart';
import { FoldDistributionYDistributionChart } from './FoldDistributionYDistributionChart';
import {
  FoldDistributionChartView,
  FoldDistributionEmptyState,
} from './FoldDistributionChartView';
import type { FoldViewMode } from './FoldDistributionHeaderControls';
import { useFoldDistributionInteraction } from './useFoldDistributionInteraction';

// ============= Types =============

export type { FoldViewMode } from './FoldDistributionHeaderControls';

interface FoldDistributionChartProps {
  /** Fold information from backend */
  folds: FoldsInfo | null;
  /** Y values for coloring and statistics */
  y?: number[];
  /** Metadata for metadata-based coloring */
  metadata?: Record<string, unknown[]>;
  /** Currently selected fold (null = all folds) */
  selectedFold?: number | null;
  /** Callback when fold is selected */
  onSelectFold?: (foldIndex: number | null) => void;
  /** Whether chart is in loading state */
  isLoading?: boolean;
  /** Enable SelectionContext integration */
  useSelectionContext?: boolean;
  /** Compact mode */
  compact?: boolean;
  /** Global color configuration (unified system) */
  globalColorConfig?: GlobalColorConfig;
  /** Color context data for unified color system */
  colorContext?: ColorContext;
}

interface ChartConfig {
  viewMode: FoldViewMode;
  showMeanLine: boolean;
  showLegend: boolean;
  showYLegend: boolean;
}

// ============= Default Configuration =============

const DEFAULT_CONFIG: ChartConfig = {
  viewMode: 'counts',
  showMeanLine: false,
  showLegend: true,
  showYLegend: false,
};

// ============= Component =============

export function FoldDistributionChart({
  folds,
  y,
  selectedFold: externalSelectedFold,
  onSelectFold,
  useSelectionContext = true,
  compact = false,
  globalColorConfig,
  colorContext,
}: FoldDistributionChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [config, setConfig] = useState<ChartConfig>(DEFAULT_CONFIG);
  const [internalSelectedFold, setInternalSelectedFold] = useState<number | null>(null);

  // SelectionContext integration - always call hook, conditionally use result
  const selectionHook = useSelection();
  const selectionCtx = useSelectionContext ? selectionHook : null;
  const emptySelectedSamples = useMemo(() => new Set<number>(), []);
  const selectedSamples = selectionCtx?.selectedSamples ?? emptySelectedSamples;

  // Use external selection if provided
  const selectedFold = externalSelectedFold ?? internalSelectedFold;
  const handleSelectFold = onSelectFold ?? setInternalSelectedFold;

  // Determine effective color mode (global or internal)
  const effectiveColorMode = globalColorConfig?.mode ?? 'partition';
  const combinedGroupingNote = useMemo(
    () => getCombinedGroupingNote(folds, globalColorConfig?.mode, globalColorConfig?.metadataKey),
    [folds, globalColorConfig?.metadataKey, globalColorConfig?.mode],
  );

  // Phase 5: Detect if target is classification
  const isClassificationMode = useMemo(() => {
    return colorContext?.targetType && isCategoricalTarget(colorContext.targetType);
  }, [colorContext?.targetType]);

  // Get class labels for classification mode
  const classLabels = useMemo(() => colorContext?.classLabels ?? [], [colorContext?.classLabels]);

  // Calculate optimal bin count using Freedman-Diaconis rule (same as YHistogram)
  // Use shared utility to ensure consistency with Y Histogram
  const optimalBinCount = useMemo(() => {
    if (!y || y.length < 4) return 5;
    // Use same bin count range as Y Histogram for consistency
    return calculateOptimalBinCount(y, 5, 50);
  }, [y]);

  // Compute Y bins for target mode (regression) using UNIFORM binning
  // This ensures bins match exactly with Y Histogram ranges
  const yBins = useMemo(() => {
    if (!y || y.length === 0 || isClassificationMode) return [];
    return computeUniformBins(y, optimalBinCount);
  }, [y, isClassificationMode, optimalBinCount]);

  // Get unique metadata values for metadata mode
  const metadataCategories = useMemo(() => {
    return buildFoldDistributionMetadataCategories(colorContext?.metadata, globalColorConfig?.metadataKey);
  }, [globalColorConfig?.metadataKey, colorContext?.metadata]);

  const foldDistributionSegmentOptions = useMemo<FoldDistributionSegmentOptions>(() => ({
    colorMode: effectiveColorMode,
    y,
    yBins,
    isClassificationMode: Boolean(isClassificationMode),
    classLabels,
    outlierIndices: colorContext?.outlierIndices,
    selectedSamples,
    metadataKey: globalColorConfig?.metadataKey,
    metadata: colorContext?.metadata,
    metadataCategories,
  }), [
    effectiveColorMode,
    y,
    yBins,
    isClassificationMode,
    classLabels,
    colorContext?.outlierIndices,
    selectedSamples,
    globalColorConfig?.metadataKey,
    colorContext?.metadata,
    metadataCategories,
  ]);

  // Phase 4: Get display filter from colorContext
  const displayFilteredIndices = colorContext?.displayFilteredIndices;

  /**
   * Transform fold data into partition-based bars
   * Creates separate bars for each partition: Train 1, Val 1, Train 2, Val 2, ..., Test
   * Phase 4: Filters by displayFilteredIndices when present (selected only / unselected only)
   */
  const partitionBarData = useMemo((): PartitionBarData[] => buildFoldDistributionPartitionBars({
    folds,
    y,
    displayFilteredIndices,
    segmentOptions: foldDistributionSegmentOptions,
  }), [folds, y, displayFilteredIndices, foldDistributionSegmentOptions]);

  /**
   * Get segment keys for partition bar mode (different from stacked fold mode)
   */
  const partitionSegmentKeys = useMemo(() => buildFoldDistributionSegmentKeys({
    colorMode: effectiveColorMode,
    yBins,
    isClassificationMode: Boolean(isClassificationMode),
    classLabels,
    metadataCategories,
  }), [effectiveColorMode, yBins, metadataCategories, isClassificationMode, classLabels]);

  // Transform fold data for Y distribution visualization
  const yData = useMemo(() => buildFoldDistributionYStatsData(folds, {
    formatFoldLabel,
  }), [folds]);

  const hasYStats = yData.length > 0;

  // Global mean for reference line
  const globalYMean = useMemo(() => getFoldDistributionTargetMean(y), [y]);

  // Get train/test colors from global palette
  const trainColor = PARTITION_COLORS.train;
  const trainColorLight = PARTITION_COLORS.trainLight;
  const valColor = PARTITION_COLORS.val;
  const valColorLight = PARTITION_COLORS.valLight;

  const heldOutTestColor = getHeldOutTestColor();
  const validationLabel = folds && folds.n_folds > 1 ? 'Val' : 'Test';
  const validationColor = folds && folds.n_folds > 1 ? PARTITION_COLORS.val : PARTITION_COLORS.test;
  const heldOutTestColorLight = useMemo(() => {
    return getFoldDistributionLightColor(heldOutTestColor);
  }, [heldOutTestColor]);
  const partitionPalette = useMemo<FoldDistributionPartitionPalette>(() => ({
    train: trainColor,
    trainLight: trainColorLight,
    val: valColor,
    valLight: valColorLight,
    heldOutTest: heldOutTestColor,
    heldOutTestLight: heldOutTestColorLight,
  }), [heldOutTestColor, heldOutTestColorLight, trainColor, trainColorLight, valColor, valColorLight]);

  /**
   * Get the base bar color for a partition bar based on partition type
   * Uses global color configuration for consistency with other charts
   */
  const getPartitionBarColor = useCallback((entry: PartitionBarData, isHighlighted: boolean): string => {
    return getFoldDistributionPartitionBarColor(entry, isHighlighted, partitionPalette);
  }, [partitionPalette]);

  /**
   * Get segment color for a partition bar entry
   * Used when coloring by target, metadata, etc.
   */
  const getPartitionSegmentColor = useCallback((segmentKey: string, entry: PartitionBarData): string => {
    return getFoldDistributionSegmentColor(segmentKey, entry, {
      colorMode: effectiveColorMode,
      selectedFold,
      continuousPalette: globalColorConfig?.continuousPalette ?? 'blue_red',
      categoricalPalette: globalColorConfig?.categoricalPalette ?? 'default',
      yBins,
      partitionPalette,
    });
  }, [
    effectiveColorMode,
    globalColorConfig?.categoricalPalette,
    globalColorConfig?.continuousPalette,
    selectedFold,
    partitionPalette,
    yBins,
  ]);

  // Get segment label for legend
  const getSegmentLabel = useCallback((segmentKey: string): string => {
    return getFoldDistributionSegmentLabel(segmentKey, {
      colorMode: effectiveColorMode,
      yBins,
      classLabels,
      metadataCategories,
    });
  }, [effectiveColorMode, metadataCategories, classLabels, yBins]);

  const {
    clickedPartitionId,
    rangeOverlayBounds,
    handleChartBackgroundClick,
    handleChartMouseDown,
    handleChartMouseMove,
    handleChartMouseUp,
  } = useFoldDistributionInteraction({
    selectionCtx,
    selectedSamples,
    partitionBarData,
    partitionSegmentKeys,
    getPartitionSegmentColor,
    onSelectFold: handleSelectFold,
  });

  // Export handler
  const handleExport = useCallback(() => {
    if (!folds) return;

    const exportData = buildFoldDistributionExportRows(folds, { formatFoldLabel });
    exportDataAsCSV(exportData, 'fold_distribution');
  }, [folds]);

  // Update config
  const updateConfig = useCallback((updates: Partial<ChartConfig>) => {
    setConfig(prev => ({ ...prev, ...updates }));
  }, []);

  // Empty state
  if (!folds || folds.n_folds === 0) {
    return <FoldDistributionEmptyState />;
  }

  // Render count bar chart with separate bars per partition
  const renderCountChart = () => (
    <FoldDistributionCountChart
      partitionBarData={partitionBarData}
      partitionSegmentKeys={partitionSegmentKeys}
      selectedSamples={selectedSamples}
      clickedPartitionId={clickedPartitionId}
      rangeOverlayBounds={rangeOverlayBounds}
      folds={folds}
      effectiveColorMode={effectiveColorMode}
      getPartitionBarColor={getPartitionBarColor}
      getPartitionSegmentColor={getPartitionSegmentColor}
      getSegmentLabel={getSegmentLabel}
      onMouseDown={handleChartMouseDown}
      onMouseMove={handleChartMouseMove}
      onMouseUp={handleChartMouseUp}
    />
  );

  // Render distribution chart
  const renderDistributionChart = () => (
    <FoldDistributionYDistributionChart
      yData={yData}
      showMeanLine={config.showMeanLine}
      showLegend={config.showLegend}
      globalYMean={globalYMean}
      selectedFold={selectedFold}
      trainColor={trainColor}
      validationLabel={validationLabel}
      validationColor={validationColor}
    />
  );

  return (
    <FoldDistributionChartView
      rootRef={chartRef}
      onBackgroundClick={handleChartBackgroundClick}
      headerControls={{
        splitterName: folds.splitter_name,
        foldCount: folds.n_folds,
        viewMode: config.viewMode,
        hasYStats,
        selectedFold,
        showLegend: config.showLegend,
        showYLegend: config.showYLegend,
        showMeanLine: config.showMeanLine,
        disableYLegend: effectiveColorMode === 'partition' || !y || y.length === 0,
        disableMeanLine: !hasYStats || config.viewMode === 'counts',
        onViewModeChange: (viewMode) => updateConfig({ viewMode }),
        onClearFoldSelection: () => handleSelectFold(null),
        onShowLegendChange: (checked) => updateConfig({ showLegend: checked }),
        onShowYLegendChange: (checked) => updateConfig({ showYLegend: checked }),
        onShowMeanLineChange: (checked) => updateConfig({ showMeanLine: checked }),
        onExport: handleExport,
      }}
      combinedGroupingNote={combinedGroupingNote}
      viewMode={config.viewMode}
      hasYStats={hasYStats}
      renderCountChart={renderCountChart}
      renderDistributionChart={renderDistributionChart}
      footer={{
        compact,
        showLegend: config.showLegend,
        showYLegend: config.showYLegend,
        effectiveColorMode,
        partitionBars: partitionBarData,
        partitionSegmentKeys,
        trainColor,
        valColor,
        heldOutTestColor,
        selectedFold,
        selectedCount: selectedSamples.size,
        isClassificationMode: Boolean(isClassificationMode),
        classLabels,
        hasYValues: Boolean(y && y.length > 0),
        categoricalPalette: globalColorConfig?.categoricalPalette,
        continuousPalette: globalColorConfig?.continuousPalette,
        getPartitionSegmentColor,
        getSegmentLabel,
      }}
    />
  );
}

export default React.memo(FoldDistributionChart);

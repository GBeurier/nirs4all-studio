/**
 * SpectraChart - Enhanced Spectra Chart with Phase 2 features
 *
 * Phase 2 Implementation: Enhanced Spectra Chart
 *
 * New Features:
 * - Integrated toolbar with view mode, aggregation, sampling controls
 * - Wavelength focus with ROI presets and derivative view
 * - Filter panel with partition, target range, metadata filters
 * - Advanced aggregation modes (mean +/- std, median+quantiles, minmax, density)
 * - Smart sampling strategies (random, stratified, coverage, progressive)
 * - Source step comparison support
 *
 * This component extends the existing SpectraChart with Phase 2 enhancements
 * while maintaining full backward compatibility.
 */

import React, { useRef, useState, useEffect } from 'react';
import type {
  GlobalColorConfig,
  ColorContext,
} from '@/lib/playground/colorConfig';
import { SpectraChartView } from './SpectraChartView';
import { useSpectraChartDerivedData } from './useSpectraChartDerivedData';
import { useSpectraChartExportActions } from './SpectraChartExportActions';
import { useSpectraChartInteractions } from './useSpectraChartInteractions';
import {
  useSpectraChartConfig,
  type UseSpectraChartConfigResult,
} from '@/lib/playground/useSpectraChartConfig';
import { SelectionContext } from '@/context/useSelection';
import {
  buildSpectraRechartsPlotProps,
  buildSpectraWebGLBranchProps,
} from './spectraRendererProps';
import type { RenderMode } from '@/lib/playground/renderOptimizer';
import type { DataSection, FoldsInfo, UnifiedOperator } from '@/types/playground';

// ============= Types =============

export interface SpectraChartProps {
  /** Original data section from backend */
  original: DataSection;
  /** Processed data section from backend */
  processed: DataSection;
  /** Optional Y values for coloring */
  y?: number[];
  /** Sample IDs for labels */
  sampleIds?: string[];
  /** Fold information for fold coloring */
  folds?: FoldsInfo | null;
  /** Global unified color configuration */
  globalColorConfig?: GlobalColorConfig;
  /** Color context with computed values for coloring */
  colorContext?: ColorContext;
  /** Callback when the user triggers a chart interaction */
  onInteractionStart?: () => void;
  /** Whether chart is in loading state */
  isLoading?: boolean;
  /** Enable SelectionContext integration for cross-chart highlighting */
  useSelectionContext?: boolean;
  /** External config result (for shared config across components) */
  externalConfig?: UseSpectraChartConfigResult;
  /** Compact mode for smaller containers */
  compact?: boolean;
  /** Available metadata columns for filter panel */
  metadataColumns?: string[];
  /** Available pipeline operators for step selection */
  operators?: UnifiedOperator[];
  /** Metadata values for grouping/coloring */
  metadata?: Record<string, unknown[]>;
  /** Callback when samples are selected via brush */
  onBrushSelect?: (indices: number[]) => void;
  /** Effective render mode for actual rendering ('canvas' or 'webgl') */
  renderMode?: RenderMode;
  /** Display render mode for UI (user's selection: 'auto', 'canvas', 'webgl') */
  displayRenderMode?: RenderMode;
  /** Callback when render mode changes */
  onRenderModeChange?: (mode: RenderMode) => void;
  /** Outlier indices from pipeline operators (for outlier color mode) */
  outlierIndices?: Set<number>;
  // Phase 6: Reference dataset comparison
  /** Reference dataset for comparison (processed data from another dataset) */
  referenceDataset?: DataSection | null;
  /** Label for the reference dataset */
  referenceLabel?: string;
  // Phase 7: Difference mode enhancements
  /** Whether to show absolute differences instead of signed differences */
  showAbsoluteDifference?: boolean;
}

// ============= Line color helpers (VIZ-05) =============
//
// Recharts/SVG fallback hot path: the base stroke of every <Line> is
// independent of hover/selection state, so it is computed once per sample
// (hover-stable, memoizable). Hover/selection emphasis is applied on top via
// a cheap O(affected) override so hovering one line no longer recolors every
// line. The split preserves the exact visual semantics of the previous
// single getColor() implementation.

const EMPTY_SELECTED_SAMPLES = new Set<number>();
const EMPTY_PINNED_SAMPLES = new Set<number>();

// ============= Main Component =============

export function SpectraChart({
  original,
  processed,
  y,
  sampleIds,
  folds,
  globalColorConfig,
  colorContext,
  onInteractionStart,
  isLoading = false,
  useSelectionContext = true,
  externalConfig,
  compact = false,
  metadataColumns,
  operators,
  metadata,
  onBrushSelect,
  renderMode = 'canvas',
  displayRenderMode,
  onRenderModeChange,
  outlierIndices,
  referenceDataset,
  referenceLabel = 'Reference',
  showAbsoluteDifference = false,
}: SpectraChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartAreaRef = useRef<HTMLDivElement>(null);

  // Use external config or create internal one
  const internalConfig = useSpectraChartConfig();
  const configResult = externalConfig ?? internalConfig;
  const { config } = configResult;

  // Determine if we're in WebGL mode
  const isWebGLMode = renderMode === 'webgl' || renderMode === 'webgl_aggregated';

  // SelectionContext integration for cross-chart highlighting
  const fullSelectionCtx = React.useContext(SelectionContext);
  const selectionCtx = useSelectionContext ? fullSelectionCtx ?? null : null;

  // Determine effective selection state
  const selectedSamples = selectionCtx?.selectedSamples ?? EMPTY_SELECTED_SAMPLES;

  const hoveredSample = selectionCtx?.hoveredSample ?? null;
  const pinnedSamples = selectionCtx?.pinnedSamples ?? EMPTY_PINNED_SAMPLES;

  useEffect(() => {
    if (config.displayMode === 'selected_only' && selectedSamples.size === 0) {
      configResult.setDisplayMode('individual');
    }
  }, [config.displayMode, configResult, selectedSamples.size]);

  // Brush state for zoom
  const [brushDomain, setBrushDomain] = useState<[number, number] | null>(null);

  const {
    baseWavelengths,
    wavelengthAxisName,
    wavelengthAxisLabel,
    wavelengthUnitSuffix,
    wavelengthRange,
    focusedData,
    samplingResult,
    displayIndices,
    displayedSamples,
    totalSamples,
    aggregatedStats,
    groupedStats,
    groupKeys,
    filteredData,
    getBaseLineColor,
    webglSampleColors,
    yAxisDomain,
    differenceStats,
    highDifferenceRegions,
    legendItems,
    showOriginal,
    showProcessed,
    showGroupedAggregation,
    hasSelection,
    isSelectedOnlyMode,
  } = useSpectraChartDerivedData({
    original,
    processed,
    config,
    selectedSamples,
    isWebGLMode,
    brushDomain,
    y,
    folds,
    metadata,
    colorContext,
    globalColorConfig,
    outlierIndices,
    referenceDataset,
    referenceLabel,
    showAbsoluteDifference,
  });

  const {
    rangeSelectionBounds,
    rectSelectionBounds,
    handleBackgroundClick,
    handleClick,
    handleWheel,
    handleDoubleClick,
    handleRangeMouseDown,
    handleRangeMouseMove,
    handleMouseLeave,
    handleChartMouseUp,
    handleResetBrush,
    handleSelectSimilar,
  } = useSpectraChartInteractions({
    chartAreaRef,
    selectionCtx,
    isWebGLMode,
    wavelengthRange,
    brushDomain,
    setBrushDomain,
    focusedData,
    displayIndices,
    yAxisDomain,
    enableHover: config.enableHover,
    folds,
    y,
    onInteractionStart,
    onBrushSelect,
  });

  // Export chart (full view + context-menu subset)
  const { handleExport, handleExportSamples } = useSpectraChartExportActions({
    chartRef,
    focusedData,
    displayIndices,
    sampleIds,
  });

  const webglRendererProps = buildSpectraWebGLBranchProps({
    config,
    wavelengthAxisLabel,
    originalSpectra: original.spectra,
    focusedSpectra: focusedData.spectra,
    focusedWavelengths: focusedData.wavelengths,
    y,
    sampleIds,
    folds,
    displayIndices,
    sampleColors: webglSampleColors,
    aggregatedStats,
    groupedStats,
    useSelectionContext,
    isLoading,
  });

  const rechartsRendererProps = buildSpectraRechartsPlotProps({
    config,
    filteredData,
    highDifferenceRegions,
    rangeSelectionBounds,
    rectSelectionBounds,
    showGroupedAggregation,
    groupKeys,
    categoricalPalette: globalColorConfig?.categoricalPalette,
    showOriginal,
    showProcessed,
    displayIndices,
    selectedSamples,
    pinnedSamples,
    hoveredSample,
    hasSelection,
    isSelectedOnlyMode,
    getBaseLineColor,
    referenceSpectraCount: referenceDataset?.spectra?.length ?? 0,
    sampleIds,
    targetValues: y,
    foldLabels: folds?.fold_labels,
    wavelengthAxisName,
    wavelengthUnitSuffix,
    onClick: handleClick,
    onMouseDown: handleRangeMouseDown,
    onMouseMove: handleRangeMouseMove,
    onMouseLeave: handleMouseLeave,
  });

  const toolbarProps = {
    configResult,
    samplingResult,
    totalSamples,
    displayedSamples,
    selectedCount: selectedSamples.size,
    isLoading,
    brushActive: !!brushDomain,
    onResetBrush: handleResetBrush,
    onExport: handleExport,
    onInteractionStart,
    compact,
    operators,
    metadataColumns,
    wavelengthRange,
    wavelengthCount: baseWavelengths.length,
    wavelengthUnitSuffix,
    renderMode: displayRenderMode ?? renderMode,
    effectiveRenderMode: renderMode,
    onRenderModeChange,
  };

  const surfaceProps = {
    chartAreaRef,
    isWebGLMode,
    contextMenuProps: {
      hoveredSample,
      sampleIds,
      yValues: y,
      folds: folds?.fold_labels?.map(String),
      onExportSamples: handleExportSamples,
      onSelectSimilar: handleSelectSimilar,
    },
    onBackgroundClick: handleBackgroundClick,
    onRechartsMouseUp: handleChartMouseUp,
    onWheel: handleWheel,
    onDoubleClick: handleDoubleClick,
    webglProps: webglRendererProps,
    rechartsProps: rechartsRendererProps,
  };

  const footerProps = {
    legendItems,
    selectedCount: selectedSamples.size,
    globalColorConfig,
    colorContext,
    differenceStats,
    brushDomain,
    wavelengthUnitSuffix,
  };

  return (
    <SpectraChartView
      chartRef={chartRef}
      isLoading={isLoading}
      toolbar={toolbarProps}
      surface={surfaceProps}
      footer={footerProps}
    />
  );
}

export default React.memo(SpectraChart);

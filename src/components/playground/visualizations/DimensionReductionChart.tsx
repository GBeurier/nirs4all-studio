/**
 * DimensionReductionChart - Enhanced PCA/UMAP visualization (Phase 3)
 *
 * Features:
 * - PCA and UMAP method support
 * - 2D scatter plot (default) with optional 3D view toggle
 * - Color by: Y value, fold, metadata, spectral metrics
 * - Improved tooltips with all sample metadata
 * - Axis component selector (any PC/UMAP dimension)
 * - Aspect ratio enforcement (always square)
 * - Cross-chart selection highlighting via SelectionContext
 * - Lasso and box selection tools
 * - Export functionality (PNG, CSV)
 */

import React, { useMemo, useRef, useCallback, useState } from 'react';
import { exportChart } from '@/lib/chartExport';
import {
  type GlobalColorConfig,
  type ColorContext,
} from '@/lib/playground/colorConfig';
import type { PCAResult, FoldsInfo } from '@/types/playground';
import {
  buildDimensionReductionWebgl2DProps,
  buildDimensionReductionWebgl3DProps,
  type DimensionReductionDataPoint,
} from '@/lib/playground/dimensionReductionData';
import {
  getDimensionReductionMousePosition,
  getDimensionReductionPointIndex,
  selectDimensionReduction3DPoints,
  selectDimensionReductionRechartsPoints,
  selectDimensionReductionWebglPoints,
} from '@/lib/playground/dimensionReductionInteraction';
import {
  buildDimensionReductionExportRows,
  getDimensionReductionExportName,
  getDimensionReductionPointColor,
} from '@/lib/playground/dimensionReductionPresentation';
import { useSelection } from '@/context/useSelection';
import type { SelectionResult } from '../selectionGeometry';

// Import optimized WebGL/Regl scatter renderers
import {
  type ScatterRendererType,
  type Scatter3DHandle,
} from './scatter';

// Import unified selection handlers (Phase 2)
import {
  computeSelectionAction,
  computeAreaSelectionAction,
  executeSelectionAction,
} from '@/lib/playground/selectionHandlers';
import {
  extractModifiers,
  shouldClearOnBackgroundClick,
} from '@/lib/playground/selectionUtils';
import { DimensionReductionChartEmptyState } from './DimensionReductionChartEmptyState';
import { DimensionReductionChartFrame } from './DimensionReductionChartFrame';
import {
  DimensionReduction2DView,
  DimensionReduction3DView,
} from './DimensionReductionRendererViews';
import { useDimensionReductionChartData } from './useDimensionReductionChartData';

// ============= Types =============

export type DimensionReductionMethod = 'pca' | 'umap';
export type ViewMode = '2d' | '3d';
export type ColorMode = 'target' | 'fold' | 'metadata';

interface DimensionReductionChartProps {
  /** PCA result from backend */
  pca: PCAResult | null;
  /** UMAP result from backend (optional) */
  umap?: {
    coordinates: number[][];
    n_components: number;
    error?: string;
  } | null;
  /** Y values for coloring */
  y?: number[];
  /** Fold information for fold coloring */
  folds?: FoldsInfo | null;
  /** Sample IDs for labels */
  sampleIds?: string[];
  /** Metadata for tooltips and coloring */
  metadata?: Record<string, unknown[]>;
  /** Global color configuration (unified system) */
  globalColorConfig?: GlobalColorConfig;
  /** Color context data for unified color system */
  colorContext?: ColorContext;
  /** Currently selected sample (deprecated - use SelectionContext) */
  selectedSample?: number | null;
  /** Callback when sample is selected (deprecated - use SelectionContext) */
  onSelectSample?: (index: number) => void;
  /** Whether chart is in loading state */
  isLoading?: boolean;
  /** Enable SelectionContext integration for cross-chart highlighting */
  useSelectionContext?: boolean;
  /** Request UMAP computation from backend */
  onRequestUMAP?: () => void;
  /** Whether UMAP is computing */
  isUMAPLoading?: boolean;
  /** Compact mode */
  compact?: boolean;
  // Phase 6: Reference dataset
  /** Reference PCA result for comparison */
  referencePca?: PCAResult | null;
  /** Label for reference dataset */
  referenceLabel?: string;
}

type DataPoint = DimensionReductionDataPoint;

interface ChartConfig {
  method: DimensionReductionMethod;
  viewMode: ViewMode;
  xAxis: string;
  yAxis: string;
  zAxis: string;
  colorMode: ColorMode;
  metadataKey?: string;
  showGrid: boolean;
  pointSize: 'small' | 'medium' | 'large';
  showLabels: boolean;
  preserveAspectRatio: boolean;
  /** Whether to enable hover highlighting and tooltips */
  enableHover: boolean;
  /** Whether to show crosshairs at origin */
  showCrosshairs: boolean;
}

// ============= Default Configuration =============

const DEFAULT_CONFIG: ChartConfig = {
  method: 'pca',
  viewMode: '2d',
  xAxis: 'dim1',
  yAxis: 'dim2',
  zAxis: 'dim3',
  colorMode: 'target',
  showGrid: true,
  pointSize: 'medium',
  showLabels: false,
  preserveAspectRatio: false,
  enableHover: true,
  showCrosshairs: false,
};

const POINT_SIZES = {
  small: { base: 15, selected: 30, hovered: 40 },
  medium: { base: 30, selected: 50, hovered: 60 },
  large: { base: 50, selected: 80, hovered: 100 },
};

// ============= Component =============

export function DimensionReductionChart({
  pca,
  umap,
  y,
  folds,
  sampleIds,
  metadata,
  globalColorConfig,
  colorContext: externalColorContext,
  selectedSample: externalSelectedSample,
  onSelectSample: externalOnSelectSample,
  isLoading = false,
  useSelectionContext = true,
  onRequestUMAP,
  isUMAPLoading = false,
  compact = false,
  referencePca,
  referenceLabel = 'Reference',
}: DimensionReductionChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const scatter3DRef = useRef<Scatter3DHandle>(null);
  const [config, setConfig] = useState<ChartConfig>(DEFAULT_CONFIG);
  const [rendererType, setRendererType] = useState<ScatterRendererType>('webgl');

  // SelectionContext integration - always call hook, conditionally use result
  const selectionHook = useSelection();
  const selectionCtx = useSelectionContext ? selectionHook : null;

  // Use global selection tool mode from SelectionContext
  const selectionTool = selectionCtx?.selectionToolMode ?? 'click';
  const setSelectionTool = selectionCtx?.setSelectionToolMode ?? (() => {});


  // Effective selection state
  const externalSelectedSamples = useMemo(() => new Set<number>(
    externalSelectedSample !== null && externalSelectedSample !== undefined
      ? [externalSelectedSample]
      : []
  ), [externalSelectedSample]);
  const selectedSamples = useSelectionContext && selectionCtx
    ? selectionCtx.selectedSamples
    : externalSelectedSamples;

  const hoveredSample = selectionCtx?.hoveredSample ?? null;
  const emptyPinnedSamples = useMemo(() => new Set<number>(), []);
  const pinnedSamples = selectionCtx?.pinnedSamples ?? emptyPinnedSamples;

  // Mouse position for tooltip (WebGL/Regl only - Recharts has its own tooltip)
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);

  const {
    activeResult,
    hasUMAP,
    hasPCA,
    nComponents,
    dimensionOptions,
    varianceExplained,
    activeAxes,
    axisLabels,
    chartData,
    filteredChartData,
    referenceChartData,
    uniqueFolds,
    yRange,
    computedColorContext,
    metadataKeys,
  } = useDimensionReductionChartData({
    config,
    pca,
    umap,
    y,
    folds,
    sampleIds,
    metadata,
    externalColorContext,
    selectedSamples,
    pinnedSamples,
    referencePca,
    referenceLabel,
  });

  // Get point color for WebGL/canvas renderers - returns only parseable HSL colors (no CSS variables)
  // Uses getWebGLSampleColor which handles selection/outlier modes with concrete colors
  const getPointColor = useCallback((point: DataPoint) => {
    return getDimensionReductionPointColor({
      point,
      globalColorConfig,
      colorContext: computedColorContext,
      colorMode: config.colorMode,
      metadataKey: config.metadataKey,
      yRange,
    });
  }, [globalColorConfig, computedColorContext, config.colorMode, config.metadataKey, yRange]);

  // Alias for 3D view - same as getPointColor since both need concrete colors
  const getPointColor3D = getPointColor;

  // Handle point click - Recharts Scatter onClick signature: (data, index, event)
  // Phase 2: Uses unified selection handlers
  const handleClick = useCallback((data: unknown, _index: number, event: React.MouseEvent) => {
    // In box/lasso mode, individual item clicks are disabled to avoid conflicts
    // This replaces the selectionJustCompletedRef anti-pattern
    if (selectionTool !== 'click') {
      return;
    }

    const idx = getDimensionReductionPointIndex(data);
    if (idx === undefined) return;

    if (selectionCtx) {
      // Use unified selection handler
      const modifiers = extractModifiers(event);
      const action = computeSelectionAction(
        { indices: [idx] },
        selectedSamples,
        modifiers
      );
      executeSelectionAction(selectionCtx, action);
    } else if (externalOnSelectSample) {
      externalOnSelectSample(idx);
    }
  }, [selectionCtx, externalOnSelectSample, selectedSamples, selectionTool]);

  // Handle hover
  const handleMouseEnter = useCallback((data: unknown) => {
    if (!config.enableHover) return;
    const idx = getDimensionReductionPointIndex(data);
    if (idx !== undefined && selectionCtx) {
      selectionCtx.setHovered(idx);
    }
  }, [selectionCtx, config.enableHover]);

  const handleMouseLeave = useCallback(() => {
    if (selectionCtx) {
      selectionCtx.setHovered(null);
    }
  }, [selectionCtx]);

  // Pre-computed WebGL arrays for 2D renderers (ScatterPureWebGL2D, ScatterRegl2D)
  // Avoids creating new arrays on each render via inline .map() calls
  const webgl2DProps = useMemo(() => {
    return buildDimensionReductionWebgl2DProps(filteredChartData, getPointColor);
  }, [filteredChartData, getPointColor]);

  // Pre-computed WebGL arrays for 3D renderers (ScatterWebGL3D, ScatterRegl3D)
  const webgl3DProps = useMemo(() => {
    return buildDimensionReductionWebgl3DProps(filteredChartData, getPointColor3D);
  }, [filteredChartData, getPointColor3D]);

  // Handle box/lasso selection for WebGL/Regl renderers
  // Phase 2: Uses unified selection handlers, Phase 4: Uses filteredChartData
  const handleSelectionCompleteWebGL = useCallback((result: SelectionResult, modifiers: { shift: boolean; ctrl: boolean }) => {
    if (!selectionCtx || !chartContainerRef.current) return;

    const container = chartContainerRef.current;
    const containerRect = container.getBoundingClientRect();
    const selectedIndices = selectDimensionReductionWebglPoints(
      filteredChartData,
      result,
      containerRect,
      config.preserveAspectRatio,
    );
    if (selectedIndices.length === 0) return;

    // Use area selection handler (doesn't clear when re-selecting same points)
    const action = computeAreaSelectionAction(
      { indices: selectedIndices },
      selectionCtx.selectedSamples,
      modifiers
    );
    executeSelectionAction(selectionCtx, action);
  }, [selectionCtx, filteredChartData, config.preserveAspectRatio]);

  // Handle box/lasso selection for 3D WebGL/Regl renderers
  // Phase 2: Uses unified selection handlers
  const handleSelectionComplete3D = useCallback((result: SelectionResult, modifiers: { shift: boolean; ctrl: boolean }) => {
    if (!selectionCtx || !scatter3DRef.current) return;

    const selectedIndices = selectDimensionReduction3DPoints(
      result,
      (minX, minY, maxX, maxY) => scatter3DRef.current!.getPointsInScreenRect(minX, minY, maxX, maxY),
    );

    if (selectedIndices.length === 0) return;

    // Use area selection handler (doesn't clear when re-selecting same points)
    const action = computeAreaSelectionAction(
      { indices: selectedIndices },
      selectionCtx.selectedSamples,
      modifiers
    );
    executeSelectionAction(selectionCtx, action);
  }, [selectionCtx]);

  // Handle box/lasso selection completion for Recharts
  // Phase 2: Uses unified selection handlers
  // Strategy: Check if each scatter circle's screen position is inside the selection area
  const handleSelectionComplete = useCallback((result: SelectionResult, modifiers: { shift: boolean; ctrl: boolean }) => {
    if (!selectionCtx || !chartContainerRef.current) {
      return;
    }

    const selectedIndices = selectDimensionReductionRechartsPoints(
      chartContainerRef.current,
      chartData,
      result,
    );
    if (selectedIndices.length === 0) {
      return;
    }

    // Use area selection handler (doesn't clear when re-selecting same points)
    const action = computeAreaSelectionAction(
      { indices: selectedIndices },
      selectionCtx.selectedSamples,
      modifiers
    );
    executeSelectionAction(selectionCtx, action);
  }, [selectionCtx, chartData]);

  // Handle background click for Recharts chart area
  // Phase 2: Uses shouldClearOnBackgroundClick utility for unified behavior
  const handleChartClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!selectionCtx || selectionCtx.selectedSamples.size === 0) return;

    // Use unified background click detection
    if (shouldClearOnBackgroundClick(e, selectionTool)) {
      selectionCtx.clear();
    }
  }, [selectionCtx, selectionTool]);

  // Handle background click from SelectionContainer (for box/lasso mode empty drag)
  // Phase 2: This is called when SelectionContainer detects a click that doesn't select anything
  const handleBackgroundClick = useCallback(() => {
    if (selectionCtx && selectionCtx.selectedSamples.size > 0) {
      selectionCtx.clear();
    }
  }, [selectionCtx]);

  // Update config
  const updateConfig = useCallback((updates: Partial<ChartConfig>) => {
    setConfig(prev => ({ ...prev, ...updates }));
  }, []);

  // Export handler
  const handleExport = useCallback(() => {
    const exportData = buildDimensionReductionExportRows(chartData, activeAxes);
    const methodName = getDimensionReductionExportName(config.method);
    exportChart(chartRef.current, exportData, methodName);
  }, [chartData, activeAxes, config.method]);

  const handleViewModeToggle = useCallback(() => {
    const newViewMode = config.viewMode === '3d' ? '2d' : '3d';
    // Switch to PCA when entering 3D mode if UMAP is selected (UMAP not supported in 3D)
    if (newViewMode === '3d' && config.method === 'umap') {
      updateConfig({ viewMode: newViewMode, method: 'pca', xAxis: 'dim1', yAxis: 'dim2', zAxis: 'dim3' });
    } else {
      updateConfig({ viewMode: newViewMode });
    }
  }, [config.method, config.viewMode, updateConfig]);

  const handleHoverToggle = useCallback(() => {
    updateConfig({ enableHover: !config.enableHover });
  }, [config.enableHover, updateConfig]);

  const handleMethodChange = useCallback((method: DimensionReductionMethod) => {
    updateConfig({ method, xAxis: 'dim1', yAxis: 'dim2', zAxis: 'dim3' });
  }, [updateConfig]);

  const handleContainerMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const rect = chartContainerRef.current?.getBoundingClientRect();
    if (rect) {
      setMousePos(getDimensionReductionMousePosition(event.clientX, event.clientY, rect));
    }
  }, []);

  const handleContainerMouseLeave = useCallback(() => {
    setMousePos(null);
  }, []);

  const handle3DSelect = useCallback((data: DataPoint, event?: MouseEvent) => {
    // Create a minimal synthetic React MouseEvent for compatibility
    const syntheticEvent = {
      shiftKey: event?.shiftKey ?? false,
      ctrlKey: event?.ctrlKey ?? false,
      metaKey: event?.metaKey ?? false,
    } as React.MouseEvent;
    handleClick({ payload: data }, 0, syntheticEvent);
  }, [handleClick]);

  const handle3DHover = useCallback((index: number | null) => {
    selectionCtx?.setHovered(index);
  }, [selectionCtx]);

  // Error state
  if (activeResult?.error) {
    return (
      <DimensionReductionChartEmptyState
        method={config.method}
        error={activeResult.error}
        isUMAPLoading={isUMAPLoading}
      />
    );
  }

  // Empty state
  if (!activeResult || chartData.length < 3) {
    return (
      <DimensionReductionChartEmptyState
        method={config.method}
        showComputeUMAP={config.method === 'umap' && !hasUMAP && !!onRequestUMAP}
        isUMAPLoading={isUMAPLoading}
        onRequestUMAP={onRequestUMAP}
      />
    );
  }

  // Point size based on config
  const sizes = POINT_SIZES[config.pointSize];

  const recharts2DView = (
    <DimensionReduction2DView
      data={chartData}
      referenceData={referenceChartData}
      xAxis={config.xAxis}
      yAxis={config.yAxis}
      axisLabels={axisLabels}
      pointBaseSize={sizes.base}
      showGrid={config.showGrid}
      showCrosshairs={config.showCrosshairs}
      enableHover={config.enableHover}
      globalColorConfig={globalColorConfig}
      colorContext={computedColorContext}
      colorMode={config.colorMode}
      metadataKey={config.metadataKey}
      yRange={yRange}
      selectedSamples={selectedSamples}
      pinnedSamples={pinnedSamples}
      hoveredSample={hoveredSample}
      onPointClick={handleClick}
      onPointMouseEnter={handleMouseEnter}
      onPointMouseLeave={handleMouseLeave}
    />
  );

  const recharts3DView = (
    <DimensionReduction3DView
      data={chartData}
      axisLabels={axisLabels}
      getColor={getPointColor3D}
      selectedSamples={selectedSamples}
      hoveredSample={hoveredSample}
      onSelect={handle3DSelect}
      onHover={handle3DHover}
    />
  );

  return (
    <DimensionReductionChartFrame
      chartRef={chartRef}
      containerRef={chartContainerRef}
      scatter3DRef={scatter3DRef}
      method={config.method}
      viewMode={config.viewMode}
      xAxis={config.xAxis}
      yAxis={config.yAxis}
      zAxis={config.zAxis}
      nComponents={nComponents}
      dimensionOptions={dimensionOptions}
      hasPCA={hasPCA}
      rendererType={rendererType}
      pointSize={config.pointSize}
      pointBaseSize={sizes.base / 5}
      showGrid={config.showGrid}
      preserveAspectRatio={config.preserveAspectRatio}
      colorMode={config.colorMode}
      metadataKey={config.metadataKey}
      showEqualAxisScale={rendererType !== 'recharts' && config.viewMode === '2d'}
      showLegacyColorOptions={!globalColorConfig}
      hasFolds={uniqueFolds.length > 0}
      metadataKeys={metadataKeys}
      enableHover={config.enableHover}
      selectionTool={selectionTool}
      selectionEnabled={selectionTool !== 'click'}
      useSelectionContext={useSelectionContext}
      webgl2DProps={webgl2DProps}
      webgl3DProps={webgl3DProps}
      recharts2DView={recharts2DView}
      recharts3DView={recharts3DView}
      axisLabels={axisLabels}
      hoveredPoint={hoveredSample === null ? null : chartData.find(d => d.index === hoveredSample) ?? null}
      mousePosition={mousePos}
      containerWidth={chartContainerRef.current?.clientWidth}
      compact={compact}
      showVarianceSummary={config.method === 'pca' && varianceExplained[config.xAxis] !== undefined}
      selectedCount={selectedSamples.size}
      globalColorConfig={globalColorConfig}
      colorContext={externalColorContext}
      hasReferenceData={referenceChartData.length > 0}
      referenceLabel={referenceLabel}
      onMethodChange={handleMethodChange}
      onXAxisChange={(xAxis) => updateConfig({ xAxis })}
      onYAxisChange={(yAxis) => updateConfig({ yAxis })}
      onZAxisChange={(zAxis) => updateConfig({ zAxis })}
      onRendererTypeChange={setRendererType}
      onPointSizeChange={(pointSize) => updateConfig({ pointSize })}
      onShowGridChange={(checked) => updateConfig({ showGrid: checked })}
      onPreserveAspectRatioChange={(checked) => updateConfig({ preserveAspectRatio: checked })}
      onColorModeChange={(colorMode) => updateConfig({ colorMode })}
      onMetadataKeyChange={(metadataKey) => updateConfig({ metadataKey })}
      onToggleViewMode={handleViewModeToggle}
      onToggleHover={handleHoverToggle}
      onExport={handleExport}
      onContainerMouseMove={handleContainerMouseMove}
      onContainerMouseLeave={handleContainerMouseLeave}
      onRechartsSelectionComplete={handleSelectionComplete}
      onWebglSelectionComplete={handleSelectionCompleteWebGL}
      on3DSelectionComplete={handleSelectionComplete3D}
      onBackgroundClick={handleBackgroundClick}
      onRechartsBackgroundClick={handleChartClick}
    />
  );
}

export default React.memo(DimensionReductionChart);

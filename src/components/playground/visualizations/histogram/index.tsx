/**
 * YHistogramV2 - Mode router for the histogram visualization.
 *
 * Uses React.lazy() to code-split each render mode into its own chunk.
 * Calls the shared useHistogramData hook and selects the appropriate
 * sub-component based on the current stacking/color mode.
 *
 * Features:
 * - Configurable bin count (auto, 10, 20, 50, custom)
 * - Automatic stacking based on global color mode (partition/fold = stacked)
 * - Color derived from global color configuration
 * - KDE overlay toggle
 * - Reference lines (mean, median)
 * - Cross-chart selection highlighting via SelectionContext
 * - Export functionality (PNG, CSV)
 * - Progressive drill-down for stacked bars (bar → segment → clear)
 *
 * Selection Handling (Phase 3 of Unified Selection Model):
 * - Uses unified selection handlers from selectionHandlers.ts
 * - handleBarSelection: Simple bar selection with computeSelectionAction
 * - handleStackedBarSelection: Stacked bar selection with computeStackedBarAction
 * - Range drag selection uses handleDragSelection
 *
 * @see docs/_internals/PLAYGROUND_SELECTION_MODEL.md
 */

import React, { Suspense } from 'react';
import { BarChart3 } from 'lucide-react';
import { useHistogramData } from './useHistogramData';
import HistogramBase from './HistogramBase';
import type { YHistogramV2Props, HistogramChartProps, BinData } from './types';

// ============= Lazy-loaded mode components =============

const HistogramSimple = React.lazy(() => import('./HistogramSimple'));
const HistogramByPartition = React.lazy(() => import('./HistogramByPartition'));
const HistogramByFold = React.lazy(() => import('./HistogramByFold'));
const HistogramByMetadata = React.lazy(() => import('./HistogramByMetadata'));
const HistogramBySelection = React.lazy(() => import('./HistogramBySelection'));
const HistogramClassification = React.lazy(() => import('./HistogramClassification'));

// ============= Loading fallback =============

function ChartLoadingFallback() {
  return (
    <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
      Loading...
    </div>
  );
}

// ============= Component =============

export function YHistogramV2(props: YHistogramV2Props) {
  const data = useHistogramData(props);

  const {
    // For HistogramBase
    chartRef,
    config,
    updateConfig,
    isClassificationMode,
    classBarData,
    isProcessed,
    displayStats,
    selectedSamples,
    selectedClasses,
    selectionCtx,
    compact,
    globalColorConfig,
    colorContext,
    handleExport,

    // For mode selection
    shouldStackByPartition,
    shouldStackByFold,
    shouldStackByMetadata,
    shouldStackBySelection,
    hasFolds,
    metadataCategories,
    stats,
    displayY,

    // For chart props
    histogramData,
    kdeData,
    selectedBins,
    hoveredBin,
    hoveredClass,
    rangeSelection,
    setRangeSelection,
    handleMouseDown,
    handleMouseMove,
    handleMouseLeave,
    handleDragSelection,
    handleBarSelection,
    lastMouseEventRef,
    uniqueFolds,
    metadata,
    getYValue,
    yAxisLabel,
    getBarColor,
  } = data;

  // Empty state
  if (!displayY || displayY.length === 0 || !stats) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        <div className="text-center">
          <BarChart3 className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
          <p>No Y values available</p>
        </div>
      </div>
    );
  }

  // Build shared chart props
  const chartProps: HistogramChartProps & { getBarColor: (entry: BinData, index: number) => string } = {
    histogramData,
    stats,
    displayY,
    config,
    yAxisLabel,
    getYValue,
    kdeData,
    selectedSamples,
    selectedBins,
    hoveredBin,
    selectionCtx,
    rangeSelection,
    setRangeSelection,
    handleMouseDown,
    handleMouseMove,
    handleMouseLeave,
    handleDragSelection,
    handleBarSelection,
    lastMouseEventRef,
    globalColorConfig,
    colorContext,
    uniqueFolds,
    metadata,
    metadataCategories,
    classBarData,
    selectedClasses,
    hoveredClass,
    getBarColor,
  };

  // Select chart mode component
  const renderChart = () => {
    // Phase 5: Use classification chart for categorical targets
    if (isClassificationMode && classBarData.length > 0) {
      return <HistogramClassification {...chartProps} />;
    }

    // Stack by partition (train/test)
    if (shouldStackByPartition && colorContext?.trainIndices && colorContext?.testIndices) {
      return <HistogramByPartition {...chartProps} />;
    }

    // Stack by fold
    if (shouldStackByFold && hasFolds) {
      return <HistogramByFold {...chartProps} />;
    }

    // Stack by metadata category
    if (shouldStackByMetadata && metadataCategories.length > 0) {
      return <HistogramByMetadata {...chartProps} />;
    }

    // Stack by selection
    if (shouldStackBySelection) {
      return <HistogramBySelection {...chartProps} />;
    }

    // Default: simple chart
    return <HistogramSimple {...chartProps} />;
  };

  return (
    <HistogramBase
      chartRef={chartRef}
      config={config}
      updateConfig={updateConfig}
      isClassificationMode={isClassificationMode}
      classBarData={classBarData}
      isProcessed={isProcessed}
      displayStats={displayStats}
      selectedSamples={selectedSamples}
      selectedClasses={selectedClasses}
      selectionCtx={selectionCtx}
      compact={compact}
      globalColorConfig={globalColorConfig}
      colorContext={colorContext}
      handleExport={handleExport}
    >
      <Suspense fallback={<ChartLoadingFallback />}>
        {renderChart()}
      </Suspense>
    </HistogramBase>
  );
}

export default React.memo(YHistogramV2);

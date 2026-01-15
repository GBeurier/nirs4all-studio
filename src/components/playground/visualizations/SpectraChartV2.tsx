/**
 * SpectraChartV2 - Enhanced Spectra Chart with Phase 2 features
 *
 * Phase 2 Implementation: Enhanced Spectra Chart
 *
 * New Features:
 * - Integrated toolbar with view mode, aggregation, sampling controls
 * - Wavelength focus with ROI presets and derivative view
 * - Filter panel with partition, target range, metadata filters
 * - Advanced aggregation modes (mean±std, median+quantiles, minmax, density)
 * - Smart sampling strategies (random, stratified, coverage, progressive)
 * - Source step comparison support
 *
 * This component extends the existing SpectraChart with Phase 2 enhancements
 * while maintaining full backward compatibility.
 */

import React, { useMemo, useRef, useState, useCallback } from 'react';
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  ReferenceArea,
} from 'recharts';
import { Loader2 } from 'lucide-react';
import { exportChart } from '@/lib/chartExport';
import {
  CHART_THEME,
  CHART_MARGINS,
  ANIMATION_CONFIG,
  formatWavelength,
} from './chartConfig';
import {
  type GlobalColorConfig,
  type ColorContext,
  getBaseColor as getUnifiedBaseColor,
  getWebGLSampleColor,
  HIGHLIGHT_COLORS,
  getCategoricalColor,
} from '@/lib/playground/colorConfig';
import { InlineColorLegend } from '../ColorLegend';
import { SpectraChartToolbar } from './SpectraChartToolbar';
import { SpectraContextMenu } from './SpectraContextMenu';
import {
  computeAggregatedStats,
  computeGroupedStats,
  buildAggregationDataPoint,
  getAggregationElements,
  getAggregationLegendItems,
  type AggregatedStats,
} from './SpectraAggregation';
import {
  useSpectraChartConfig,
  type UseSpectraChartConfigResult,
} from '@/lib/playground/useSpectraChartConfig';
import {
  applySampling,
  type SamplingResult,
} from '@/lib/playground/sampling';
import {
  filterWavelengths,
  computeDerivative,
} from '@/lib/playground/spectraConfig';
import { SelectionContext } from '@/context/SelectionContext';
import { shouldClearOnBackgroundClick } from '@/lib/playground/selectionUtils';
import { SpectraWebGL } from './SpectraWebGL';
import { Zap } from 'lucide-react';
import type { RenderMode } from '@/lib/playground/renderOptimizer';
import type { DataSection, FoldsInfo, UnifiedOperator } from '@/types/playground';

// ============= Types =============

export interface SpectraChartV2Props {
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

// ============= Main Component =============

export function SpectraChartV2({
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
}: SpectraChartV2Props) {
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
  const selectionCtx = useSelectionContext ? fullSelectionCtx : null;

  // Determine effective selection state
  const selectedSamples = selectionCtx?.selectedSamples ?? new Set<number>();
  const selectionToolMode = selectionCtx?.selectionToolMode ?? 'click';

  const hoveredSample = selectionCtx?.hoveredSample ?? null;
  const pinnedSamples = selectionCtx?.pinnedSamples ?? new Set<number>();

  // Brush state for zoom
  const [brushDomain, setBrushDomain] = useState<[number, number] | null>(null);

  // Wavelength range selection state (for selecting samples by spectral behavior)
  const [rangeSelection, setRangeSelection] = useState<{
    startWavelength: number | null;
    endWavelength: number | null;
    isSelecting: boolean;
  }>({ startWavelength: null, endWavelength: null, isSelecting: false });

  // Rectangle selection state (for 2D selection by wavelength AND absorbance)
  const [rectSelection, setRectSelection] = useState<{
    startX: number | null;
    startY: number | null;
    endX: number | null;
    endY: number | null;
    isSelecting: boolean;
  }>({ startX: null, startY: null, endX: null, endY: null, isSelecting: false });


  // Get base wavelengths
  const baseWavelengths = useMemo(() => {
    if (config.viewMode === 'original') {
      return original.wavelengths;
    }
    return processed.wavelengths.length > 0 ? processed.wavelengths : original.wavelengths;
  }, [config.viewMode, processed.wavelengths, original.wavelengths]);

  // Compute wavelength range for picker
  const wavelengthRange: [number, number] = useMemo(() => {
    if (baseWavelengths.length === 0) return [0, 1000];
    return [baseWavelengths[0], baseWavelengths[baseWavelengths.length - 1]];
  }, [baseWavelengths]);

  // Get base spectra based on view mode
  const baseSpectra = useMemo(() => {
    switch (config.viewMode) {
      case 'original':
        return { spectra: original.spectra, wavelengths: original.wavelengths };
      case 'processed':
      case 'both':
        return { spectra: processed.spectra, wavelengths: processed.wavelengths };
      case 'difference': {
        // Compute difference between processed and original
        if (processed.spectra.length !== original.spectra.length) {
          return { spectra: processed.spectra, wavelengths: processed.wavelengths };
        }
        const diffSpectra = processed.spectra.map((proc, idx) => {
          const orig = original.spectra[idx];
          if (!orig || proc.length !== orig.length) return proc;
          return proc.map((v, i) => {
            const diff = v - orig[i];
            return showAbsoluteDifference ? Math.abs(diff) : diff;
          });
        });
        return { spectra: diffSpectra, wavelengths: processed.wavelengths };
      }
      default:
        return { spectra: processed.spectra, wavelengths: processed.wavelengths };
    }
  }, [config.viewMode, processed, original, showAbsoluteDifference]);

  // Apply wavelength focus (range filter, derivative)
  const focusedData = useMemo(() => {
    let { wavelengths, spectra } = baseSpectra;

    // Apply wavelength range filter
    if (config.wavelengthFocus.range || config.wavelengthFocus.edgeMask.enabled) {
      const filtered = filterWavelengths(wavelengths, spectra, config.wavelengthFocus);
      wavelengths = filtered.wavelengths;
      spectra = filtered.spectra;
    }

    // Apply derivative if requested
    if (config.wavelengthFocus.derivative > 0) {
      spectra = spectra.map(spectrum =>
        computeDerivative(spectrum, wavelengths, config.wavelengthFocus.derivative as 1 | 2)
      );
    }

    return { wavelengths, spectra };
  }, [baseSpectra, config.wavelengthFocus]);

  // Apply sampling strategy with display mode consideration
  // Always include selected samples (up to 50) even if they weren't in the sampled subset
  const MAX_FORCED_SELECTION = 50;

  const samplingResult: SamplingResult = useMemo(() => {
    const totalSamples = focusedData.spectra.length;

    // For selected-only mode, only show selected samples
    if (config.displayMode === 'selected_only' && selectedSamples.size > 0) {
      const selectedIndices = Array.from(selectedSamples).filter(i => i < totalSamples);
      return {
        indices: selectedIndices,
        totalSamples,
        sampledCount: selectedIndices.length,
        wasApplied: true,
        strategy: 'random', // Using 'random' as placeholder for manual selection
      };
    }

    const baseSampling = applySampling(totalSamples, config.sampling, {
      yValues: y,
      spectra: focusedData.spectra,
    });

    // If there are selected samples, ensure they're included in the display (up to MAX_FORCED_SELECTION)
    if (selectedSamples.size > 0) {
      const sampledSet = new Set(baseSampling.indices);
      const selectedIndices = Array.from(selectedSamples)
        .filter(i => i < totalSamples && !sampledSet.has(i))
        .slice(0, MAX_FORCED_SELECTION);

      if (selectedIndices.length > 0) {
        const mergedIndices = [...baseSampling.indices, ...selectedIndices].sort((a, b) => a - b);
        return {
          ...baseSampling,
          indices: mergedIndices,
          sampledCount: mergedIndices.length,
        };
      }
    }

    return baseSampling;
  }, [focusedData.spectra, config.sampling, config.displayMode, selectedSamples, y]);

  // Get display indices (apply display filter if active)
  const displayIndices = useMemo(() => {
    const indices = samplingResult.indices;
    // Phase 4: Filter by displayFilteredIndices if present
    if (colorContext?.displayFilteredIndices) {
      return indices.filter(i => colorContext.displayFilteredIndices!.has(i));
    }
    return indices;
  }, [samplingResult.indices, colorContext?.displayFilteredIndices]);
  const displayedSamples = displayIndices.length;
  const totalSamples = samplingResult.totalSamples;

  // Compute aggregated stats if in aggregation mode
  const aggregatedStats: AggregatedStats | null = useMemo(() => {
    if (config.aggregation.mode === 'none' && config.displayMode !== 'grouped') return null;
    return computeAggregatedStats(focusedData.spectra, config.aggregation.quantileRange);
  }, [focusedData.spectra, config.aggregation.mode, config.aggregation.quantileRange, config.displayMode]);

  // Compute grouped stats if in grouped mode
  const groupedStats: Map<string | number, AggregatedStats> | null = useMemo(() => {
    if (config.displayMode !== 'grouped' || !config.aggregation.groupBy || !metadata) return null;

    const groupLabels = metadata[config.aggregation.groupBy] as (string | number)[] | undefined;
    if (!groupLabels) return null;

    return computeGroupedStats(focusedData.spectra, groupLabels, config.aggregation.quantileRange);
  }, [config.displayMode, config.aggregation.groupBy, config.aggregation.quantileRange, metadata, focusedData.spectra]);

  // Get unique group values for legend
  const groupKeys = useMemo(() => {
    if (!groupedStats) return [];
    return Array.from(groupedStats.keys());
  }, [groupedStats]);

  // Get outlier samples - prefer prop from pipeline operators, fallback to spectral deviation
  const outlierSamples = useMemo((): Set<number> => {
    // Check if outlier mode is enabled in global color config
    if (globalColorConfig?.mode !== 'outlier') return new Set();

    // Use provided outlier indices from pipeline operators if available
    if (outlierIndices && outlierIndices.size > 0) {
      return outlierIndices;
    }

    // Fallback: compute outliers from spectral deviation
    const { spectra } = focusedData;
    if (spectra.length < 10) return new Set(); // Need enough samples for stats

    // Calculate mean spectrum
    const nWavelengths = spectra[0]?.length ?? 0;
    const meanSpectrum = new Array(nWavelengths).fill(0);
    spectra.forEach((spectrum) => {
      spectrum.forEach((v, i) => {
        meanSpectrum[i] += v / spectra.length;
      });
    });

    // Calculate per-sample deviation from mean (RMS)
    const deviations = spectra.map((spectrum) => {
      let sumSq = 0;
      spectrum.forEach((v, i) => {
        sumSq += Math.pow(v - meanSpectrum[i], 2);
      });
      return Math.sqrt(sumSq / nWavelengths);
    });

    // Calculate mean and std of deviations
    const meanDev = deviations.reduce((a, b) => a + b, 0) / deviations.length;
    const stdDev = Math.sqrt(
      deviations.reduce((acc, d) => acc + Math.pow(d - meanDev, 2), 0) / deviations.length
    );

    // Mark samples >2 std as outliers
    const threshold = meanDev + 2 * stdDev;
    const outliers = new Set<number>();
    deviations.forEach((d, idx) => {
      if (d > threshold) outliers.add(idx);
    });

    return outliers;
  }, [globalColorConfig?.mode, outlierIndices, focusedData]);

  // Original stats for 'both' mode
  const originalAggregatedStats: AggregatedStats | null = useMemo(() => {
    if (config.aggregation.mode === 'none' || config.viewMode !== 'both') return null;
    let origSpectra = original.spectra;
    let origWavelengths = original.wavelengths;

    // Apply same wavelength focus to original
    if (config.wavelengthFocus.range || config.wavelengthFocus.edgeMask.enabled) {
      const filtered = filterWavelengths(origWavelengths, origSpectra, config.wavelengthFocus);
      origWavelengths = filtered.wavelengths;
      origSpectra = filtered.spectra;
    }

    if (config.wavelengthFocus.derivative > 0) {
      origSpectra = origSpectra.map(spectrum =>
        computeDerivative(spectrum, origWavelengths, config.wavelengthFocus.derivative as 1 | 2)
      );
    }

    return computeAggregatedStats(origSpectra, config.aggregation.quantileRange);
  }, [original, config.aggregation.mode, config.viewMode, config.wavelengthFocus, config.aggregation.quantileRange]);

  // Build chart data (only for Canvas/Recharts mode - WebGL doesn't use this)
  const chartData = useMemo(() => {
    // Skip expensive chart data construction when in WebGL mode
    // WebGL uses focusedData directly and doesn't need this Recharts format
    if (isWebGLMode) return [];

    const { wavelengths, spectra } = focusedData;
    const showIndividualLines = config.aggregation.mode === 'none' || config.aggregation.showIndividualLines;
    const showOriginalLines = showIndividualLines && (config.viewMode === 'both' || config.viewMode === 'original');
    const showProcessedLines = showIndividualLines && (config.viewMode === 'both' || config.viewMode === 'processed');

    return wavelengths.map((wavelength, wIdx) => {
      const point: Record<string, unknown> = { wavelength };

      // Add individual spectrum lines
      if (showProcessedLines || config.viewMode === 'difference') {
        displayIndices.forEach((sIdx, displayIdx) => {
          if (spectra[sIdx]) {
            point[`p${displayIdx}`] = spectra[sIdx][wIdx];
          }
        });
      }

      if (showOriginalLines) {
        displayIndices.forEach((sIdx, displayIdx) => {
          if (original.spectra[sIdx]) {
            // Apply wavelength focus to original too
            const origValue = original.spectra[sIdx][wIdx];
            if (origValue !== undefined) {
              point[`o${displayIdx}`] = origValue;
            }
          }
        });
      }

      // Phase 6: Add reference dataset lines
      if (referenceDataset?.spectra && referenceDataset.spectra.length > 0) {
        const refSpectra = referenceDataset.spectra;
        const maxRefSamples = Math.min(refSpectra.length, displayIndices.length);
        for (let rIdx = 0; rIdx < maxRefSamples; rIdx++) {
          if (refSpectra[rIdx] && refSpectra[rIdx][wIdx] !== undefined) {
            point[`r${rIdx}`] = refSpectra[rIdx][wIdx];
          }
        }
      }

      // Add aggregation data
      if (aggregatedStats && config.aggregation.mode !== 'none' && config.displayMode !== 'grouped') {
        const aggPoint = buildAggregationDataPoint(wavelength, wIdx, aggregatedStats, config.aggregation.mode, '');
        Object.assign(point, aggPoint);

        // Add original aggregation for 'both' mode
        if (originalAggregatedStats && config.viewMode === 'both') {
          const origAggPoint = buildAggregationDataPoint(wavelength, wIdx, originalAggregatedStats, config.aggregation.mode, 'orig');
          Object.assign(point, origAggPoint);
        }
      }

      // Add grouped aggregation data
      if (groupedStats && config.displayMode === 'grouped') {
        groupedStats.forEach((stats, groupKey) => {
          const prefix = `grp_${groupKey}`;
          point[`${prefix}_mean`] = stats.mean[wIdx];
          point[`${prefix}_std_low`] = stats.mean[wIdx] - stats.std[wIdx];
          point[`${prefix}_std_high`] = stats.mean[wIdx] + stats.std[wIdx];
          if (stats.quantileLower) point[`${prefix}_q_low`] = stats.quantileLower[wIdx];
          if (stats.quantileUpper) point[`${prefix}_q_high`] = stats.quantileUpper[wIdx];
          if (stats.median) point[`${prefix}_median`] = stats.median[wIdx];
          point[`${prefix}_min`] = stats.min[wIdx];
          point[`${prefix}_max`] = stats.max[wIdx];
        });
      }

      return point;
    });
  }, [isWebGLMode, focusedData, displayIndices, config.aggregation.mode, config.aggregation.showIndividualLines, config.viewMode, config.displayMode, aggregatedStats, originalAggregatedStats, original.spectra, groupedStats, referenceDataset]);

  // Filter data by brush domain
  const filteredData = useMemo(() => {
    if (!brushDomain) return chartData;
    return chartData.filter(
      d => (d.wavelength as number) >= brushDomain[0] && (d.wavelength as number) <= brushDomain[1]
    );
  }, [chartData, brushDomain]);

  // Build color context from props (used when globalColorConfig is provided)
  const computedColorContext = useMemo<ColorContext>(() => {
    // If colorContext is provided, use it directly
    if (colorContext) return colorContext;

    // Otherwise build from local props
    const yValues = y ?? [];

    // Get train/test indices from first fold only to ensure disjoint sets
    // In K-fold CV, the same sample can be train in one fold and test in another
    let trainIndices: Set<number> | undefined;
    let testIndices: Set<number> | undefined;

    if (folds?.folds && folds.folds.length > 0) {
      const firstFold = folds.folds[0];
      trainIndices = new Set<number>(firstFold.train_indices ?? []);
      testIndices = new Set<number>(firstFold.test_indices ?? []);
    }

    return {
      y: yValues,
      yMin: yValues.length > 0 ? Math.min(...yValues) : 0,
      yMax: yValues.length > 0 ? Math.max(...yValues) : 1,
      trainIndices,
      testIndices,
      foldLabels: folds?.fold_labels,
      metadata,
      outlierIndices: outlierSamples.size > 0 ? outlierSamples : undefined,
    };
  }, [colorContext, y, folds, metadata, outlierSamples]);

  // Get color for a sample based on stats (ignoring selection/pinning)
  const getBaseColor = useCallback((sampleIdx: number) => {
    // Use unified color system
    if (globalColorConfig) {
      return getUnifiedBaseColor(sampleIdx, globalColorConfig, computedColorContext);
    }
    // Default fallback when no color config is provided
    return 'hsl(var(--muted-foreground))';
  }, [globalColorConfig, computedColorContext]);

  // Get color for a sample based on color config (including selection)
  const getColor = useCallback((displayIdx: number, isOriginal: boolean) => {
    const sampleIdx = displayIndices[displayIdx];
    const isSelected = selectedSamples.has(sampleIdx);
    const isHovered = hoveredSample === sampleIdx;
    const isPinned = pinnedSamples.has(sampleIdx);
    const hasSelection = selectedSamples.size > 0;

    // In "selected_only" mode, don't apply selection overlay - keep global coloration
    // The samples shown are already filtered to selected ones
    const isSelectedOnlyMode = config.displayMode === 'selected_only';

    // Highlighted states take priority - use distinctive colors (except in selected_only mode)
    if (!isSelectedOnlyMode) {
      if (isHovered) return HIGHLIGHT_COLORS.hovered; // Primary color
      if (isSelected) return config.colorConfig.selectionColor ?? HIGHLIGHT_COLORS.selected; // Configurable selection color
      if (isPinned && config.colorConfig.highlightPinned) return HIGHLIGHT_COLORS.pinned; // Gold for pinned
    } else {
      // In selected_only mode, only show hover highlight (not selection color)
      if (isHovered) return HIGHLIGHT_COLORS.hovered;
    }

    const baseColor = getBaseColor(sampleIdx);

    // Dim non-selected samples when there's a selection (but not in selected_only mode)
    if (hasSelection && !isSelectedOnlyMode && !isSelected && !isPinned) {
      const opacity = config.colorConfig.unselectedOpacity;
      // Use color-mix for CSS-variable-safe opacity blending
      return `color-mix(in srgb, ${baseColor} ${Math.round(opacity * 100)}%, transparent)`;
    }

    // Make original spectra semi-transparent when showing both (to differentiate from processed)
    // Using transparency preserves the color while showing the difference
    if (isOriginal && config.viewMode === 'both') {
      return `color-mix(in srgb, ${baseColor} 50%, transparent)`;
    }

    return baseColor;
  }, [displayIndices, selectedSamples, hoveredSample, pinnedSamples, config.viewMode, config.displayMode, config.colorConfig.highlightPinned, config.colorConfig.unselectedOpacity, config.colorConfig.selectionColor, getBaseColor]);

  // Compute sample colors for WebGL to match Canvas coloring
  // Uses getWebGLSampleColor which includes selection/outlier mode handling
  const sampleColors = useMemo(() => {
    if (!isWebGLMode) return undefined;
    const colors: string[] = [];
    // Populate colors for visible samples
    for (const sampleIdx of displayIndices) {
      if (globalColorConfig) {
        colors[sampleIdx] = getWebGLSampleColor(sampleIdx, globalColorConfig, computedColorContext);
      } else {
        colors[sampleIdx] = getBaseColor(sampleIdx);
      }
    }
    return colors;
  }, [isWebGLMode, displayIndices, globalColorConfig, computedColorContext, getBaseColor]);

  // Handle background click to clear selection (Phase 4: Unified Selection Model)
  // SpectraChart does not support line click-to-select, only box/lasso selection
  // Background clicks in 'click' mode should clear the selection
  const handleBackgroundClick = useCallback((e: React.MouseEvent) => {
    if (!selectionCtx) return;

    // Use unified background click detection
    if (shouldClearOnBackgroundClick(e, selectionToolMode)) {
      selectionCtx.clear();
    }
  }, [selectionCtx, selectionToolMode]);

  // Handle chart click (Recharts onClick callback)
  // Note: SpectraChart does NOT support click-to-select on spectrum lines.
  // This handler only clears selection when clicking empty space within the chart area.
  const handleClick = useCallback((e: unknown, event?: React.MouseEvent) => {
    const chartEvent = e as { activePayload?: Array<{ dataKey: string }> };

    // If no active payload or no valid data key, it's a background click
    if (!chartEvent?.activePayload?.[0]?.dataKey) {
      // Background click - delegate to unified handler
      if (event) {
        handleBackgroundClick(event);
      }
      return;
    }

    const key = chartEvent.activePayload[0].dataKey as string;
    const match = key.match(/[po](\d+)/);
    if (!match) {
      // Clicked on aggregation or reference line, not a sample - treat as background
      if (event) {
        handleBackgroundClick(event);
      }
      return;
    }

    // Note: Line click-to-select is intentionally NOT implemented for SpectraChart.
    // The density of spectral lines makes click targeting impractical.
    // Selection is done via box/lasso selection tools or cross-chart highlighting.
    // Clicking on a line area is treated as a background click.
    if (event) {
      handleBackgroundClick(event);
    }
  }, [handleBackgroundClick]);

  // Mousewheel zoom handler for canvas mode
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    // Skip if in WebGL mode (WebGL has its own zoom controller)
    if (isWebGLMode) return;

    e.preventDefault();

    const fullRange = wavelengthRange[1] - wavelengthRange[0];

    // Get current view range
    const currentDomain = brushDomain ?? wavelengthRange;
    const currentRange = currentDomain[1] - currentDomain[0];

    // Get mouse position relative to chart (0 to 1)
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mouseXNorm = (e.clientX - rect.left) / rect.width;

    // Zoom factor
    const zoomFactor = e.deltaY > 0 ? 1.15 : 0.87;
    let newRange = currentRange * zoomFactor;

    // Clamp zoom range (min 5% of full range, max 100%)
    newRange = Math.max(fullRange * 0.05, Math.min(fullRange, newRange));

    // If we're at full range and trying to zoom out, do nothing
    if (newRange >= fullRange * 0.99) {
      setBrushDomain(null);
      return;
    }

    // Calculate new bounds centered on mouse position
    const mouseXData = currentDomain[0] + mouseXNorm * currentRange;
    const leftRatio = (mouseXData - currentDomain[0]) / currentRange;

    let newMin = mouseXData - leftRatio * newRange;
    let newMax = mouseXData + (1 - leftRatio) * newRange;

    // Clamp to data bounds
    if (newMin < wavelengthRange[0]) {
      newMin = wavelengthRange[0];
      newMax = wavelengthRange[0] + newRange;
    }
    if (newMax > wavelengthRange[1]) {
      newMax = wavelengthRange[1];
      newMin = wavelengthRange[1] - newRange;
    }

    onInteractionStart?.();
    setBrushDomain([newMin, newMax]);
  }, [isWebGLMode, wavelengthRange, brushDomain, onInteractionStart]);

  // Double-click to reset zoom
  const handleDoubleClick = useCallback(() => {
    if (!isWebGLMode && brushDomain) {
      onInteractionStart?.();
      setBrushDomain(null);
    }
  }, [isWebGLMode, brushDomain, onInteractionStart]);

  // Track if Alt key is pressed for rectangle selection mode
  const [isAltKeyPressed, setIsAltKeyPressed] = useState(false);

  // Track Alt key state
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setIsAltKeyPressed(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setIsAltKeyPressed(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Compute Y-axis domain for rectangle selection coordinate mapping
  const yAxisDomain = useMemo((): [number, number] => {
    const { spectra } = focusedData;
    if (spectra.length === 0) return [0, 1];

    let min = Infinity;
    let max = -Infinity;
    for (const spectrum of spectra) {
      for (const v of spectrum) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    // Add 5% padding
    const padding = (max - min) * 0.05;
    return [min - padding, max + padding];
  }, [focusedData]);

  // Rectangle selection handlers (Alt+drag for 2D selection)
  // Note: These are called from handleRangeMouseDown/Move with chart event data
  const handleRectMouseDownCb = useCallback((chartEvent: { activeLabel?: number; chartY?: number }) => {
    if (!chartEvent?.activeLabel || chartEvent?.chartY === undefined) return;

    const wl = chartEvent.activeLabel;
    if (isNaN(wl)) return;

    // Get actual chart height from the container ref
    const containerHeight = chartAreaRef.current?.clientHeight ?? 250;
    const marginTop = CHART_MARGINS.spectra.top;
    const marginBottom = CHART_MARGINS.spectra.bottom;
    const plotHeight = containerHeight - marginTop - marginBottom;

    const normalizedY = Math.max(0, Math.min(1, 1 - (chartEvent.chartY - marginTop) / plotHeight));
    const yValue = yAxisDomain[0] + normalizedY * (yAxisDomain[1] - yAxisDomain[0]);

    setRectSelection({
      startX: wl,
      startY: yValue,
      endX: wl,
      endY: yValue,
      isSelecting: true,
    });
  }, [yAxisDomain]);

  const handleRectMouseMoveCb = useCallback((chartEvent: { activeLabel?: number; chartY?: number }) => {
    if (!rectSelection.isSelecting) return;
    if (!chartEvent?.activeLabel || chartEvent?.chartY === undefined) return;

    const wl = chartEvent.activeLabel;
    if (isNaN(wl)) return;

    // Get actual chart height from the container ref
    const containerHeight = chartAreaRef.current?.clientHeight ?? 250;
    const marginTop = CHART_MARGINS.spectra.top;
    const marginBottom = CHART_MARGINS.spectra.bottom;
    const plotHeight = containerHeight - marginTop - marginBottom;

    const normalizedY = Math.max(0, Math.min(1, 1 - (chartEvent.chartY - marginTop) / plotHeight));
    const yValue = yAxisDomain[0] + normalizedY * (yAxisDomain[1] - yAxisDomain[0]);

    setRectSelection(prev => ({
      ...prev,
      endX: wl,
      endY: yValue,
    }));
  }, [rectSelection.isSelecting, yAxisDomain]);

  // Handle wavelength range selection for sample selection
  const handleRangeMouseDown = useCallback((e: unknown) => {
    const chartEvent = e as { activeLabel?: number; chartY?: number };
    if (!chartEvent?.activeLabel) return;
    const wl = chartEvent.activeLabel;
    if (isNaN(wl)) return;

    // Rectangle selection mode (Alt key)
    if (isAltKeyPressed && chartEvent.chartY !== undefined) {
      handleRectMouseDownCb(chartEvent);
      return;
    }

    // Standard wavelength range selection
    setRangeSelection({ startWavelength: wl, endWavelength: wl, isSelecting: true });
  }, [isAltKeyPressed, handleRectMouseDownCb]);

  const handleRangeMouseMove = useCallback((e: unknown) => {
    const chartEvent = e as { activeLabel?: number; activePayload?: Array<{ dataKey: string }>; chartY?: number };

    // Handle hover detection for SelectionContext (only if hover is enabled)
    if (config.enableHover && selectionCtx && chartEvent?.activePayload?.[0]?.dataKey) {
      const key = chartEvent.activePayload[0].dataKey as string;
      const match = key.match(/[po](\d+)/);
      if (match) {
        const displayIdx = parseInt(match[1], 10);
        const sampleIdx = displayIndices[displayIdx];
        if (sampleIdx !== undefined && selectionCtx.hoveredSample !== sampleIdx) {
          selectionCtx.setHovered(sampleIdx);
        }
      }
    } else if (!config.enableHover && selectionCtx && selectionCtx.hoveredSample !== null) {
      // Clear hover if hover is disabled
      selectionCtx.setHovered(null);
    }

    // Handle rectangle selection
    if (rectSelection.isSelecting && chartEvent?.activeLabel && chartEvent.chartY !== undefined) {
      handleRectMouseMoveCb(chartEvent);
      return;
    }

    // Handle range selection
    if (!rangeSelection.isSelecting) return;
    if (!chartEvent?.activeLabel) return;
    const wl = chartEvent.activeLabel;
    if (!isNaN(wl)) {
      setRangeSelection(prev => ({ ...prev, endWavelength: wl }));
    }
  }, [rangeSelection.isSelecting, rectSelection.isSelecting, selectionCtx, displayIndices, handleRectMouseMoveCb, config.enableHover]);

  // Clear hover when mouse leaves chart
  const handleMouseLeave = useCallback(() => {
    if (selectionCtx) {
      selectionCtx.setHovered(null);
    }
  }, [selectionCtx]);

  const handleRangeMouseUp = useCallback((e: React.MouseEvent) => {
    if (!rangeSelection.isSelecting || rangeSelection.startWavelength === null || rangeSelection.endWavelength === null) {
      setRangeSelection({ startWavelength: null, endWavelength: null, isSelecting: false });
      return;
    }

    const { wavelengths, spectra } = focusedData;
    const minWl = Math.min(rangeSelection.startWavelength, rangeSelection.endWavelength);
    const maxWl = Math.max(rangeSelection.startWavelength, rangeSelection.endWavelength);

    // Only process if there's a meaningful range
    const wlStep = wavelengths.length > 1 ? Math.abs(wavelengths[1] - wavelengths[0]) : 1;
    if (Math.abs(maxWl - minWl) > wlStep * 2) {
      // Find wavelength indices in range
      const wlIndicesInRange = wavelengths
        .map((wl, idx) => ({ wl, idx }))
        .filter(({ wl }) => wl >= minWl && wl <= maxWl)
        .map(({ idx }) => idx);

      if (wlIndicesInRange.length > 0) {
        // Calculate mean value in range for each sample
        const sampleRangeMeans = spectra.map(spectrum => {
          const values = wlIndicesInRange.map(wIdx => spectrum[wIdx]).filter(v => v !== undefined);
          return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
        });

        // Calculate global stats
        const globalMean = sampleRangeMeans.reduce((a, b) => a + b, 0) / sampleRangeMeans.length;
        const globalStd = Math.sqrt(
          sampleRangeMeans.reduce((acc, v) => acc + Math.pow(v - globalMean, 2), 0) / sampleRangeMeans.length
        );

        // Select samples that are outliers (>2 std from mean) in this wavelength range
        const outlierThreshold = 2;
        const outlierSamples: number[] = [];
        sampleRangeMeans.forEach((mean, idx) => {
          if (Math.abs(mean - globalMean) > outlierThreshold * globalStd) {
            outlierSamples.push(idx);
          }
        });

        // If no outliers found, select samples in top/bottom 10%
        const samplesToSelect = outlierSamples.length > 0 ? outlierSamples : (() => {
          const sorted = sampleRangeMeans.map((v, idx) => ({ v, idx })).sort((a, b) => a.v - b.v);
          const percentile10 = Math.ceil(sorted.length * 0.1);
          return [
            ...sorted.slice(0, percentile10).map(s => s.idx),
            ...sorted.slice(-percentile10).map(s => s.idx),
          ];
        })();

        if (samplesToSelect.length > 0) {
          if (selectionCtx) {
            if (e.shiftKey) {
              selectionCtx.select(samplesToSelect, 'add');
            } else if (e.ctrlKey || e.metaKey) {
              selectionCtx.toggle(samplesToSelect);
            } else {
              selectionCtx.select(samplesToSelect, 'replace');
            }
          }
          onBrushSelect?.(samplesToSelect);
        }
      }
    }

    setRangeSelection({ startWavelength: null, endWavelength: null, isSelecting: false });
  }, [rangeSelection, focusedData, selectionCtx, onBrushSelect]);

  // Compute range selection bounds for ReferenceArea display
  const rangeSelectionBounds = useMemo(() => {
    if (!rangeSelection.isSelecting || rangeSelection.startWavelength === null || rangeSelection.endWavelength === null) {
      return null;
    }
    return {
      min: Math.min(rangeSelection.startWavelength, rangeSelection.endWavelength),
      max: Math.max(rangeSelection.startWavelength, rangeSelection.endWavelength),
    };
  }, [rangeSelection]);

  // Rectangle selection mouse up handler
  const handleRectMouseUp = useCallback((e: React.MouseEvent) => {
    if (!rectSelection.isSelecting || !rectSelection.startX || !rectSelection.endX) {
      setRectSelection({ startX: null, startY: null, endX: null, endY: null, isSelecting: false });
      return;
    }

    const { wavelengths, spectra } = focusedData;

    // Get rectangle bounds
    const minX = Math.min(rectSelection.startX, rectSelection.endX);
    const maxX = Math.max(rectSelection.startX, rectSelection.endX);
    const minY = Math.min(rectSelection.startY ?? 0, rectSelection.endY ?? 0);
    const maxY = Math.max(rectSelection.startY ?? 0, rectSelection.endY ?? 0);

    // Only process if rectangle has meaningful size
    const wlStep = wavelengths.length > 1 ? Math.abs(wavelengths[1] - wavelengths[0]) : 1;
    const yRange = yAxisDomain[1] - yAxisDomain[0];

    if (Math.abs(maxX - minX) > wlStep * 2 && Math.abs(maxY - minY) > yRange * 0.02) {
      // Find wavelength indices in X range
      const wlIndicesInRange: number[] = [];
      wavelengths.forEach((wl, idx) => {
        if (wl >= minX && wl <= maxX) {
          wlIndicesInRange.push(idx);
        }
      });

      if (wlIndicesInRange.length > 0) {
        // Find spectra that have at least one point inside the rectangle
        const selectedIndices: number[] = [];
        spectra.forEach((spectrum, sampleIdx) => {
          for (const wlIdx of wlIndicesInRange) {
            const yVal = spectrum[wlIdx];
            if (yVal !== undefined && yVal >= minY && yVal <= maxY) {
              selectedIndices.push(sampleIdx);
              break; // Found a point in rectangle, no need to check more
            }
          }
        });

        if (selectedIndices.length > 0 && selectionCtx) {
          if (e.shiftKey) {
            selectionCtx.select(selectedIndices, 'add');
          } else if (e.ctrlKey || e.metaKey) {
            selectionCtx.toggle(selectedIndices);
          } else {
            selectionCtx.select(selectedIndices, 'replace');
          }
          onBrushSelect?.(selectedIndices);
        }
      }
    }

    setRectSelection({ startX: null, startY: null, endX: null, endY: null, isSelecting: false });
  }, [rectSelection, focusedData, yAxisDomain, selectionCtx, onBrushSelect]);

  // Compute rectangle selection bounds for visual feedback
  const rectSelectionBounds = useMemo(() => {
    if (!rectSelection.isSelecting || !rectSelection.startX || !rectSelection.endX) {
      return null;
    }
    return {
      x1: Math.min(rectSelection.startX, rectSelection.endX),
      x2: Math.max(rectSelection.startX, rectSelection.endX),
      y1: Math.min(rectSelection.startY ?? 0, rectSelection.endY ?? 0),
      y2: Math.max(rectSelection.startY ?? 0, rectSelection.endY ?? 0),
    };
  }, [rectSelection]);

  // Reset brush
  const handleResetBrush = useCallback(() => {
    setBrushDomain(null);
    onInteractionStart?.();
  }, [onInteractionStart]);

  // Export chart
  const handleExport = useCallback(() => {
    const { wavelengths, spectra } = focusedData;
    const exportData = wavelengths.map((wl, i) => {
      const row: Record<string, number | string> = { wavelength: wl };
      displayIndices.forEach((sIdx, displayIdx) => {
        const id = sampleIds?.[sIdx] ?? `sample_${sIdx}`;
        if (spectra[sIdx]) {
          row[id] = spectra[sIdx][i];
        }
      });
      return row;
    });
    exportChart(chartRef.current, exportData, 'spectra');
  }, [focusedData, displayIndices, sampleIds]);

  // Context menu: Export selected samples
  const handleExportSamples = useCallback((sampleIndices: number[]) => {
    const { wavelengths, spectra } = focusedData;
    const exportData = wavelengths.map((wl, i) => {
      const row: Record<string, number | string> = { wavelength: wl };
      sampleIndices.forEach((sIdx) => {
        const id = sampleIds?.[sIdx] ?? `sample_${sIdx}`;
        if (spectra[sIdx]) {
          row[id] = spectra[sIdx][i];
        }
      });
      return row;
    });
    exportChart(chartRef.current, exportData, `spectra_${sampleIndices.length}samples`);
  }, [focusedData, sampleIds]);

  // Context menu: Select similar samples
  const handleSelectSimilar = useCallback((sampleIdx: number, criterion: 'fold' | 'yRange' | 'outlier') => {
    if (!selectionCtx) return;

    let similarSamples: number[] = [];

    switch (criterion) {
      case 'fold': {
        const foldLabels = folds?.fold_labels;
        if (foldLabels && foldLabels.length > sampleIdx) {
          const targetFold = foldLabels[sampleIdx];
          similarSamples = foldLabels
            .map((f: number, idx: number) => ({ f, idx }))
            .filter(({ f }: { f: number }) => f === targetFold)
            .map(({ idx }: { idx: number }) => idx);
        }
        break;
      }
      case 'yRange': {
        if (y) {
          const targetY = y[sampleIdx];
          const tolerance = Math.abs(targetY) * 0.1; // ±10%
          similarSamples = y
            .map((val, idx) => ({ val, idx }))
            .filter(({ val }) => Math.abs(val - targetY) <= tolerance)
            .map(({ idx }) => idx);
        }
        break;
      }
      case 'outlier': {
        // This would use an outlier detection algorithm
        // For now, just select samples >2std from mean
        if (y) {
          const mean = y.reduce((a, b) => a + b, 0) / y.length;
          const std = Math.sqrt(y.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / y.length);
          similarSamples = y
            .map((val, idx) => ({ val, idx }))
            .filter(({ val }) => Math.abs(val - mean) > 2 * std)
            .map(({ idx }) => idx);
        }
        break;
      }
    }

    if (similarSamples.length > 0) {
      selectionCtx.select(similarSamples, 'replace');
    }
  }, [selectionCtx, folds, y]);

  // Determine what to render
  const showIndividualLines = config.aggregation.mode === 'none' || config.aggregation.showIndividualLines;
  const showOriginal = showIndividualLines && (config.viewMode === 'both' || config.viewMode === 'original');
  const showProcessed = showIndividualLines && (config.viewMode === 'both' || config.viewMode === 'processed');
  const showGroupedAggregation = config.displayMode === 'grouped' && groupedStats && groupKeys.length > 0;

  // Phase 7: Compute difference statistics when in difference mode
  const differenceStats = useMemo(() => {
    if (config.viewMode !== 'difference') return null;
    if (processed.spectra.length !== original.spectra.length) return null;

    let sumAbs = 0;
    let sumSq = 0;
    let maxAbs = 0;
    let count = 0;

    processed.spectra.forEach((proc, sampleIdx) => {
      const orig = original.spectra[sampleIdx];
      if (!orig || proc.length !== orig.length) return;
      proc.forEach((v, i) => {
        const diff = v - orig[i];
        const absDiff = Math.abs(diff);
        sumAbs += absDiff;
        sumSq += diff * diff;
        maxAbs = Math.max(maxAbs, absDiff);
        count++;
      });
    });

    if (count === 0) return null;

    const meanAbsDiff = sumAbs / count;
    const rmse = Math.sqrt(sumSq / count);

    return {
      meanAbsDiff,
      maxAbsDiff: maxAbs,
      rmse,
    };
  }, [config.viewMode, processed.spectra, original.spectra]);

  // Phase 7: Compute high-difference wavelength regions for highlighting
  const highDifferenceRegions = useMemo(() => {
    if (config.viewMode !== 'difference') return [];
    if (processed.spectra.length !== original.spectra.length) return [];

    const { wavelengths: wls, spectra: diffSpectra } = focusedData;
    if (wls.length === 0 || diffSpectra.length === 0) return [];

    // Compute mean absolute difference per wavelength
    const meanAbsPerWl = wls.map((_, wlIdx) => {
      let sum = 0;
      let count = 0;
      diffSpectra.forEach(spectrum => {
        if (spectrum[wlIdx] !== undefined) {
          sum += Math.abs(spectrum[wlIdx]);
          count++;
        }
      });
      return count > 0 ? sum / count : 0;
    });

    // Compute overall mean and std of mean abs per wavelength
    const overallMean = meanAbsPerWl.reduce((a, b) => a + b, 0) / meanAbsPerWl.length;
    const overallStd = Math.sqrt(
      meanAbsPerWl.reduce((acc, v) => acc + Math.pow(v - overallMean, 2), 0) / meanAbsPerWl.length
    );

    // Threshold: wavelengths with mean abs diff > mean + 1.5*std
    const threshold = overallMean + 1.5 * overallStd;

    // Find contiguous regions above threshold
    const regions: { start: number; end: number }[] = [];
    let inRegion = false;
    let regionStart = 0;

    meanAbsPerWl.forEach((val, idx) => {
      if (val > threshold) {
        if (!inRegion) {
          inRegion = true;
          regionStart = idx;
        }
      } else {
        if (inRegion) {
          inRegion = false;
          // Only add regions spanning at least 3 wavelengths to avoid noise
          if (idx - regionStart >= 3) {
            regions.push({
              start: wls[regionStart],
              end: wls[idx - 1],
            });
          }
        }
      }
    });

    // Handle region that extends to the end
    if (inRegion && wls.length - regionStart >= 3) {
      regions.push({
        start: wls[regionStart],
        end: wls[wls.length - 1],
      });
    }

    return regions;
  }, [config.viewMode, processed.spectra.length, original.spectra.length, focusedData]);

  // Get legend items
  type LegendItem = { label: string; color: string; dashed?: boolean; isArea?: boolean };
  const legendItems = useMemo((): LegendItem[] => {
    // Grouped mode legend
    if (showGroupedAggregation) {
      return groupKeys.map((key, idx) => ({
        label: String(key),
        color: getCategoricalColor(idx, globalColorConfig?.categoricalPalette ?? 'default'),
        isArea: config.aggregation.mode !== 'none',
      }));
    }

    if (config.aggregation.mode !== 'none') {
      const aggItems = getAggregationLegendItems(config.aggregation.mode, config.viewMode === 'both') as LegendItem[];
      // Add reference dataset to aggregation legend
      if (referenceDataset?.spectra && referenceDataset.spectra.length > 0) {
        aggItems.push({ label: referenceLabel, color: CHART_THEME.referenceLineColor, dashed: true });
      }
      return aggItems;
    }
    const items: LegendItem[] = [];
    if (showProcessed) {
      items.push({ label: config.viewMode === 'difference' ? 'Difference' : 'Processed', color: 'hsl(var(--primary))' });
    }
    if (showOriginal && config.viewMode === 'both') {
      items.push({ label: 'Original', color: 'hsl(var(--primary))', dashed: true });
    }
    // Phase 6: Add reference dataset to legend
    if (referenceDataset?.spectra && referenceDataset.spectra.length > 0) {
      items.push({ label: referenceLabel, color: CHART_THEME.referenceLineColor, dashed: true });
    }
    return items;
  }, [config.aggregation.mode, config.viewMode, showProcessed, showOriginal, showGroupedAggregation, groupKeys, referenceDataset, referenceLabel]);

  return (
    <div className="h-full flex flex-col relative" ref={chartRef}>
      {/* Enhanced Toolbar with integrated settings */}
      <SpectraChartToolbar
        configResult={configResult}
        samplingResult={samplingResult}
        totalSamples={totalSamples}
        displayedSamples={displayedSamples}
        isLoading={isLoading}
        brushActive={!!brushDomain}
        onResetBrush={handleResetBrush}
        onExport={handleExport}
        onInteractionStart={onInteractionStart}
        compact={compact}
        operators={operators}
        metadataColumns={metadataColumns}
        wavelengthRange={wavelengthRange}
        wavelengthCount={baseWavelengths.length}
        renderMode={displayRenderMode ?? renderMode}
        effectiveRenderMode={renderMode}
        onRenderModeChange={onRenderModeChange}
      />

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-background/80 flex items-center justify-center z-20 pointer-events-none">
          <Loader2 className="w-5 h-5 animate-spin text-primary" aria-hidden="true" />
          <span className="sr-only">Updating spectra</span>
        </div>
      )}

      {/* Chart with context menu */}
      <SpectraContextMenu
        hoveredSample={hoveredSample}
        sampleIds={sampleIds}
        yValues={y}
        folds={folds?.fold_labels?.map(String)}
        onExportSamples={handleExportSamples}
        onSelectSimilar={handleSelectSimilar}
      >
        <div
          ref={chartAreaRef}
          className="flex-1 min-h-0 relative"
          onClick={handleBackgroundClick}
          onMouseUp={isWebGLMode ? undefined : (e) => {
            if (rectSelection.isSelecting) {
              handleRectMouseUp(e);
            } else {
              handleRangeMouseUp(e);
            }
          }}
          onWheel={handleWheel}
          onDoubleClick={handleDoubleClick}
        >
          {/* WebGL Rendering Mode */}
          {isWebGLMode ? (
            <>
              {/* WebGL indicator */}
              <div className="absolute top-2 right-2 z-10 flex items-center gap-1 px-2 py-0.5 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded text-[10px] font-medium">
                <Zap className="w-3 h-3" />
                WebGL
              </div>
              <SpectraWebGL
                spectra={
                  // For aggregated/grouped mode, pass empty spectra (we use aggregatedStats/groupedStats instead)
                  config.displayMode === 'aggregated' || config.displayMode === 'grouped'
                    ? []
                    : // For individual/selected_only, render normal spectra
                      config.viewMode === 'original'
                        ? original.spectra
                        : focusedData.spectra
                }
                originalSpectra={config.viewMode === 'both' && config.displayMode !== 'aggregated' && config.displayMode !== 'grouped' ? original.spectra : undefined}
                wavelengths={focusedData.wavelengths}
                y={config.displayMode === 'aggregated' || config.displayMode === 'grouped' ? undefined : y}
                sampleIds={sampleIds}
                folds={folds ?? undefined}
                visibleIndices={config.displayMode === 'aggregated' || config.displayMode === 'grouped' ? undefined : displayIndices}
                sampleColors={
                  config.displayMode === 'grouped' && groupedStats
                    ? Array.from(groupedStats.keys()).map((_, idx) => getCategoricalColor(idx, globalColorConfig?.categoricalPalette ?? 'default'))
                    : sampleColors
                }
                aggregatedStats={config.displayMode === 'aggregated' && aggregatedStats ? aggregatedStats : undefined}
                groupedStats={config.displayMode === 'grouped' && groupedStats ? groupedStats : undefined}
                useSelectionContext={config.displayMode !== 'aggregated' && config.displayMode !== 'grouped' && useSelectionContext}
                selectedColor={config.colorConfig.selectionColor}
                applySelectionColoring={config.displayMode !== 'selected_only'}
                enableHover={config.enableHover}
                showHoverTooltip={config.enableHover}
                isLoading={isLoading}
                className="absolute inset-0"
              />
            </>
          ) : (
          /* Canvas/SVG Rendering Mode - Recharts */
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={filteredData}
              margin={CHART_MARGINS.spectra}
              onClick={handleClick}
              onMouseDown={handleRangeMouseDown}
              onMouseMove={handleRangeMouseMove}
              onMouseLeave={handleMouseLeave}
            >
              <CartesianGrid
                strokeDasharray={CHART_THEME.gridDasharray}
              stroke={CHART_THEME.gridStroke}
              opacity={CHART_THEME.gridOpacity}
            />
            <XAxis
              dataKey="wavelength"
              stroke={CHART_THEME.axisStroke}
              fontSize={CHART_THEME.axisFontSize}
              tickFormatter={formatWavelength}
            />
            <YAxis
              stroke={CHART_THEME.axisStroke}
              fontSize={CHART_THEME.axisFontSize}
              tickFormatter={(v) => v.toFixed(2)}
              width={45}
            />

            {/* Phase 7: High difference region highlights */}
            {highDifferenceRegions.map((region, idx) => (
              <ReferenceArea
                key={`high-diff-${idx}`}
                x1={region.start}
                x2={region.end}
                strokeOpacity={0}
                fill="hsl(30, 100%, 50%)"
                fillOpacity={0.12}
              />
            ))}

            {/* Wavelength range selection highlight */}
            {rangeSelectionBounds && (
              <ReferenceArea
                x1={rangeSelectionBounds.min}
                x2={rangeSelectionBounds.max}
                strokeOpacity={0.3}
                stroke="hsl(var(--primary))"
                fill="hsl(var(--primary))"
                fillOpacity={0.15}
              />
            )}

            {/* Rectangle selection highlight (Alt+drag) */}
            {rectSelectionBounds && (
              <ReferenceArea
                x1={rectSelectionBounds.x1}
                x2={rectSelectionBounds.x2}
                y1={rectSelectionBounds.y1}
                y2={rectSelectionBounds.y2}
                strokeOpacity={0.5}
                stroke="hsl(var(--primary))"
                fill="hsl(var(--primary))"
                fillOpacity={0.2}
                strokeDasharray="4 2"
              />
            )}

            {/* Grouped aggregation elements */}
            {showGroupedAggregation && groupKeys.map((groupKey, groupIdx) => {
              const prefix = `grp_${groupKey}`;
              const groupColor = getCategoricalColor(groupIdx, globalColorConfig?.categoricalPalette ?? 'default');

              return (
                <React.Fragment key={`group-${groupKey}`}>
                  {/* Standard deviation band */}
                  {config.aggregation.mode === 'mean_std' && (
                    <Area
                      type="monotone"
                      dataKey={`${prefix}_std_high`}
                      stroke="none"
                      fill={groupColor}
                      fillOpacity={0.15}
                      {...ANIMATION_CONFIG}
                    />
                  )}

                  {/* Quantile band */}
                  {config.aggregation.mode === 'median_quantiles' && (
                    <Area
                      type="monotone"
                      dataKey={`${prefix}_q_high`}
                      stroke="none"
                      fill={groupColor}
                      fillOpacity={0.15}
                      {...ANIMATION_CONFIG}
                    />
                  )}

                  {/* Min-max envelope */}
                  {config.aggregation.mode === 'minmax' && (
                    <>
                      <Area
                        type="monotone"
                        dataKey={`${prefix}_max`}
                        stroke="none"
                        fill={groupColor}
                        fillOpacity={0.1}
                        {...ANIMATION_CONFIG}
                      />
                      <Line
                        type="monotone"
                        dataKey={`${prefix}_min`}
                        stroke={groupColor}
                        strokeWidth={1}
                        strokeDasharray="2 2"
                        dot={false}
                        activeDot={false}
                        {...ANIMATION_CONFIG}
                      />
                      <Line
                        type="monotone"
                        dataKey={`${prefix}_max`}
                        stroke={groupColor}
                        strokeWidth={1}
                        strokeDasharray="2 2"
                        dot={false}
                        activeDot={false}
                        {...ANIMATION_CONFIG}
                      />
                    </>
                  )}

                  {/* Mean or median line */}
                  <Line
                    type="monotone"
                    dataKey={config.aggregation.mode === 'median_quantiles' ? `${prefix}_median` : `${prefix}_mean`}
                    stroke={groupColor}
                    strokeWidth={2}
                    dot={false}
                    activeDot={false}
                    {...ANIMATION_CONFIG}
                  />
                </React.Fragment>
              );
            })}

            {/* Global aggregation elements (non-grouped) */}
            {config.aggregation.mode !== 'none' && !showGroupedAggregation && getAggregationElements(
              config.aggregation.mode,
              '',
              config.viewMode === 'both'
            )}

            {/* Original spectra (dashed) */}
            {showOriginal && displayIndices.map((sampleIdx, displayIdx) => {
              const isSelected = selectedSamples.has(sampleIdx);
              const isHovered = hoveredSample === sampleIdx;
              const isPinned = pinnedSamples.has(sampleIdx);
              const highlighted = isSelected || isHovered || isPinned;

              return (
                <Line
                  key={`orig-${displayIdx}`}
                  type="monotone"
                  dataKey={`o${displayIdx}`}
                  stroke={getColor(displayIdx, true)}
                  strokeWidth={highlighted ? CHART_THEME.selectedLineStrokeWidth : CHART_THEME.lineStrokeWidth}
                  strokeDasharray={config.viewMode === 'both' ? '4 2' : undefined}
                  dot={false}
                  activeDot={false}
                  {...ANIMATION_CONFIG}
                />
              );
            })}

            {/* Processed spectra (solid) */}
            {(showProcessed || config.viewMode === 'difference') && displayIndices.map((sampleIdx, displayIdx) => {
              const isSelected = selectedSamples.has(sampleIdx);
              const isHovered = hoveredSample === sampleIdx;
              const isPinned = pinnedSamples.has(sampleIdx);
              const highlighted = isSelected || isHovered || isPinned;

              return (
                <Line
                  key={`proc-${displayIdx}`}
                  type="monotone"
                  dataKey={`p${displayIdx}`}
                  stroke={getColor(displayIdx, false)}
                  strokeWidth={highlighted ? CHART_THEME.selectedLineStrokeWidth : CHART_THEME.lineStrokeWidth}
                  dot={false}
                  activeDot={false}
                  {...ANIMATION_CONFIG}
                />
              );
            })}

            {/* Phase 6: Reference dataset spectra (dashed, distinct color) */}
            {referenceDataset?.spectra && referenceDataset.spectra.slice(0, displayIndices.length).map((_spectrum, rIdx) => (
              <Line
                key={`ref-${rIdx}`}
                type="monotone"
                dataKey={`r${rIdx}`}
                stroke={CHART_THEME.referenceLineColor}
                strokeWidth={CHART_THEME.lineStrokeWidth}
                strokeDasharray={CHART_THEME.referenceDashArray}
                strokeOpacity={CHART_THEME.referenceLineOpacity}
                dot={false}
                activeDot={false}
                {...ANIMATION_CONFIG}
              />
            ))}

            <Tooltip
              isAnimationActive={false}
              cursor={config.enableHover ? { stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1, strokeDasharray: '4 2' } : false}
              content={({ active, payload }) => {
                // Only show tooltip when hover is enabled and we have a hovered sample
                if (!config.enableHover || !active || hoveredSample === null) return null;

                // Get sample info
                const sampleId = sampleIds?.[hoveredSample] ?? `Sample ${hoveredSample}`;
                const yValue = y?.[hoveredSample];
                const foldLabel = folds?.fold_labels?.[hoveredSample];

                // Get wavelength from payload
                const wavelength = payload?.[0]?.payload?.wavelength;

                // Get first spectrum value at this wavelength for the hovered sample
                const displayIdx = displayIndices.indexOf(hoveredSample);
                const spectrumValue = displayIdx >= 0 && payload?.[0]?.payload
                  ? payload[0].payload[`p${displayIdx}`] ?? payload[0].payload[`o${displayIdx}`]
                  : undefined;

                return (
                  <div className="bg-popover border border-border rounded-md px-2 py-1.5 shadow-md text-[10px]">
                    <div className="font-medium text-foreground mb-0.5">{sampleId}</div>
                    {yValue !== undefined && (
                      <div className="text-muted-foreground">Y: <span className="font-mono">{yValue.toFixed(3)}</span></div>
                    )}
                    {foldLabel !== undefined && foldLabel >= 0 && (
                      <div className="text-muted-foreground">Fold: {foldLabel + 1}</div>
                    )}
                    {wavelength !== undefined && (
                      <div className="text-muted-foreground">λ: <span className="font-mono">{wavelength.toFixed(1)} nm</span></div>
                    )}
                    {spectrumValue !== undefined && (
                      <div className="text-muted-foreground">A: <span className="font-mono">{spectrumValue.toFixed(4)}</span></div>
                    )}
                  </div>
                );
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
          )}
        </div>
      </SpectraContextMenu>

      {/* Legend and Footer */}
      <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-3">
          {legendItems.map((item, idx) => (
            <span key={idx} className="flex items-center gap-1">
              {item.isArea ? (
                <span className="w-3 h-2 opacity-30" style={{ backgroundColor: item.color }} />
              ) : (
                <span
                  className={`w-3 h-0.5 ${item.dashed ? 'border-t border-dashed' : ''}`}
                  style={item.dashed ? { borderColor: item.color } : { backgroundColor: item.color }}
                />
              )}
              {item.label}
            </span>
          ))}
          {selectedSamples.size > 0 && (
            <span className="text-primary font-medium">
              • {selectedSamples.size} selected
            </span>
          )}
          {/* Color legend */}
          {globalColorConfig && colorContext && (
            <InlineColorLegend config={globalColorConfig} context={colorContext} />
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* Phase 7: Difference statistics */}
          {differenceStats && (
            <span className="font-mono text-orange-600 dark:text-orange-400">
              MAD: {differenceStats.meanAbsDiff.toExponential(2)} |
              Max: {differenceStats.maxAbsDiff.toExponential(2)} |
              RMSE: {differenceStats.rmse.toExponential(2)}
            </span>
          )}
          {brushDomain && (
            <span>
              Zoom: {brushDomain[0].toFixed(0)} - {brushDomain[1].toFixed(0)} nm
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default React.memo(SpectraChartV2);

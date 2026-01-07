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

import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Brush,
  Tooltip,
  ReferenceArea,
} from 'recharts';
import { Loader2 } from 'lucide-react';
import { exportChart } from '@/lib/chartExport';
import {
  CHART_THEME,
  STATISTICS_COLORS,
  CHART_MARGINS,
  ANIMATION_CONFIG,
  getExtendedSampleColor,
  formatWavelength,
  FOLD_COLORS,
  type ExtendedColorConfig,
} from './chartConfig';
import { SpectraChartToolbar } from './SpectraChartToolbar';
import { WavelengthRangePicker } from './WavelengthRangePicker';
import { SpectraFilterPanel } from './SpectraFilterPanel';
import { SpectraSettingsPopup } from './SpectraSettingsPopup';
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
  type AggregationMode,
  type SpectraColorMode,
} from '@/lib/playground/spectraConfig';
import { useSelection, SelectionContext } from '@/context/SelectionContext';
import { SpectraWebGL } from './SpectraWebGL';
import { Zap } from 'lucide-react';
import type { RenderMode } from '@/lib/playground/renderOptimizer';
import type { DataSection, FoldsInfo, UnifiedOperator } from '@/types/playground';

// ============= Types =============

interface HoveredLine {
  displayIdx: number;
  sampleIdx: number;
  isOriginal: boolean;
  value: number;
  color: string;
}

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
  /** Color configuration */
  colorConfig?: ExtendedColorConfig;
  /** Currently selected sample (deprecated - use SelectionContext) */
  selectedSample?: number | null;
  /** Callback when sample is selected (deprecated - use SelectionContext) */
  onSelectSample?: (index: number) => void;
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
  /** Render mode: 'canvas' for Recharts, 'webgl' for GPU-accelerated Three.js */
  renderMode?: RenderMode;
  /** Outlier indices from pipeline operators (for outlier color mode) */
  outlierIndices?: Set<number>;
}

// ============= Main Component =============

export function SpectraChartV2({
  original,
  processed,
  y,
  sampleIds,
  folds,
  colorConfig,
  selectedSample: externalSelectedSample,
  onSelectSample: externalOnSelectSample,
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
  outlierIndices,
}: SpectraChartV2Props) {
  const chartRef = useRef<HTMLDivElement>(null);

  // Determine if we're in WebGL mode
  const isWebGLMode = renderMode === 'webgl' || renderMode === 'webgl_aggregated';

  // Use external config or create internal one
  const internalConfig = useSpectraChartConfig();
  const configResult = externalConfig ?? internalConfig;
  const { config } = configResult;

  // SelectionContext integration for cross-chart highlighting
  const fullSelectionCtx = React.useContext(SelectionContext);
  const selectionCtx = useSelectionContext ? fullSelectionCtx : null;

  // Determine effective selection state
  const selectedSamples = useSelectionContext && selectionCtx
    ? selectionCtx.selectedSamples
    : new Set<number>(externalSelectedSample !== null && externalSelectedSample !== undefined ? [externalSelectedSample] : []);

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

  // Hover state
  const [hoveredLine, setHoveredLine] = useState<HoveredLine | null>(null);
  const [hoverWavelength, setHoverWavelength] = useState<number | null>(null);

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
          return proc.map((v, i) => v - orig[i]);
        });
        return { spectra: diffSpectra, wavelengths: processed.wavelengths };
      }
      default:
        return { spectra: processed.spectra, wavelengths: processed.wavelengths };
    }
  }, [config.viewMode, processed, original]);

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

  // Compute Y value range for filter panel
  const yRange: [number, number] | undefined = useMemo(() => {
    if (!y || y.length === 0) return undefined;
    return [Math.min(...y), Math.max(...y)];
  }, [y]);

  // Apply sampling strategy with display mode consideration
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
        strategy: 'manual' as const,
      } as SamplingResult;
    }

    return applySampling(totalSamples, config.sampling, {
      yValues: y,
      spectra: focusedData.spectra,
    });
  }, [focusedData.spectra, config.sampling, config.displayMode, selectedSamples, y]);

  // Get display indices
  const displayIndices = samplingResult.indices;
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
    if (config.colorConfig.mode !== 'outlier') return new Set();

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
  }, [config.colorConfig.mode, outlierIndices, focusedData]);

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

  // Build chart data
  const chartData = useMemo(() => {
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
          if (stats.quantileLow) point[`${prefix}_q_low`] = stats.quantileLow[wIdx];
          if (stats.quantileHigh) point[`${prefix}_q_high`] = stats.quantileHigh[wIdx];
          if (stats.median) point[`${prefix}_median`] = stats.median[wIdx];
          point[`${prefix}_min`] = stats.min[wIdx];
          point[`${prefix}_max`] = stats.max[wIdx];
        });
      }

      return point;
    });
  }, [focusedData, displayIndices, config.aggregation.mode, config.aggregation.showIndividualLines, config.viewMode, config.displayMode, aggregatedStats, originalAggregatedStats, original.spectra, groupedStats]);

  // Filter data by brush domain
  const filteredData = useMemo(() => {
    if (!brushDomain) return chartData;
    return chartData.filter(
      d => (d.wavelength as number) >= brushDomain[0] && (d.wavelength as number) <= brushDomain[1]
    );
  }, [chartData, brushDomain]);

  // Get color for a sample based on stats (ignoring selection/pinning)
  const getBaseColor = useCallback((sampleIdx: number) => {
    const colorMode = config.colorConfig.mode;
    const yValues = y ?? [];
    const foldLabels = folds?.fold_labels;

    switch (colorMode) {
      case 'selection':
        return 'hsl(var(--muted-foreground))';

      case 'fold':
        if (foldLabels && foldLabels[sampleIdx] !== undefined) {
          return FOLD_COLORS[foldLabels[sampleIdx] % FOLD_COLORS.length];
        }
        return 'hsl(var(--muted-foreground))';

      case 'partition':
        if (folds?.train_indices?.includes(sampleIdx)) {
          return 'hsl(217, 70%, 50%)'; // Blue for train
        } else if (folds?.test_indices?.includes(sampleIdx)) {
          return 'hsl(38, 92%, 50%)'; // Orange for test
        }
        return 'hsl(var(--muted-foreground))';

      case 'metadata': {
        if (metadata && config.colorConfig.metadataKey) {
          const metaValues = metadata[config.colorConfig.metadataKey] as (string | number)[] | undefined;
          if (metaValues) {
            const value = metaValues[sampleIdx];
            const uniqueValues = [...new Set(metaValues)];
            const valueIndex = uniqueValues.indexOf(value);
            return FOLD_COLORS[valueIndex % FOLD_COLORS.length];
          }
        }
        return 'hsl(var(--muted-foreground))';
      }

      case 'outlier':
        if (outlierSamples.has(sampleIdx)) {
          return 'hsl(0, 70%, 50%)'; // Red for outliers
        }
        return 'hsl(var(--muted-foreground))';

      case 'target':
      default:
        return getExtendedSampleColor(
          sampleIdx,
          yValues,
          foldLabels,
          colorConfig,
          undefined,
          undefined
        );
    }
  }, [config.colorConfig, y, folds, metadata, outlierSamples, colorConfig]);

  // Get color for a sample based on color config (including selection)
  const getColor = useCallback((displayIdx: number, isOriginal: boolean) => {
    const sampleIdx = displayIndices[displayIdx];
    const isSelected = selectedSamples.has(sampleIdx);
    const isHovered = hoveredSample === sampleIdx;
    const isPinned = pinnedSamples.has(sampleIdx);
    const hasSelection = selectedSamples.size > 0;

    // Highlighted states always take priority
    if (isHovered) return 'hsl(var(--primary))';
    if (isSelected) return 'hsl(var(--primary))';
    if (isPinned && config.colorConfig.highlightPinned) return 'hsl(45, 90%, 50%)'; // Gold for pinned

    const baseColor = getBaseColor(sampleIdx);

    // Dim non-selected samples when there's a selection
    if (hasSelection) {
      const opacity = Math.round(config.colorConfig.unselectedOpacity * 255).toString(16).padStart(2, '0');
      return `${baseColor}${opacity}`;
    }

    // Desaturate original spectra slightly when showing both
    if (isOriginal && config.viewMode === 'both') {
      return baseColor.replace(/50%\)/, '60%)').replace(/70%/, '50%');
    }

    return baseColor;
  }, [displayIndices, selectedSamples, hoveredSample, pinnedSamples, config.viewMode, config.colorConfig, getBaseColor]);

  // Compute sample colors for WebGL to match Canvas coloring
  const sampleColors = useMemo(() => {
    if (!isWebGLMode) return undefined;
    const colors: string[] = [];
    // Populate colors for visible samples
    for (const sampleIdx of displayIndices) {
      colors[sampleIdx] = getBaseColor(sampleIdx);
    }
    return colors;
  }, [isWebGLMode, displayIndices, getBaseColor]);

  // Handle chart click
  const handleClick = useCallback((e: unknown, event?: React.MouseEvent) => {
    const chartEvent = e as { activePayload?: Array<{ dataKey: string }> };
    if (!chartEvent?.activePayload?.[0]?.dataKey) {
      if (selectionCtx && selectionCtx.selectedSamples.size > 0) {
        selectionCtx.clear();
      }
      return;
    }

    const key = chartEvent.activePayload[0].dataKey as string;
    const match = key.match(/[po](\d+)/);
    if (!match) {
      if (selectionCtx && selectionCtx.selectedSamples.size > 0) {
        selectionCtx.clear();
      }
      return;
    }

    const displayIdx = parseInt(match[1], 10);
    const sampleIdx = displayIndices[displayIdx];

    if (selectionCtx) {
      const mouseEvent = event as MouseEvent | undefined;
      if (mouseEvent?.shiftKey) {
        selectionCtx.select([sampleIdx], 'add');
      } else if (mouseEvent?.ctrlKey || mouseEvent?.metaKey) {
        selectionCtx.toggle([sampleIdx]);
      } else {
        if (selectedSamples.has(sampleIdx) && selectedSamples.size === 1) {
          selectionCtx.clear();
        } else {
          selectionCtx.select([sampleIdx], 'replace');
        }
      }
    } else if (externalOnSelectSample) {
      externalOnSelectSample(sampleIdx);
    }
  }, [selectionCtx, externalOnSelectSample, displayIndices, selectedSamples]);

  // Handle brush change (for zoom)
  const handleBrushChange = useCallback((domain: { startIndex?: number; endIndex?: number }) => {
    if (domain.startIndex !== undefined && domain.endIndex !== undefined) {
      const startWl = chartData[domain.startIndex]?.wavelength as number | undefined;
      const endWl = chartData[domain.endIndex]?.wavelength as number | undefined;
      if (startWl !== undefined && endWl !== undefined) {
        onInteractionStart?.();
        setBrushDomain([startWl, endWl]);
      }
    }
  }, [chartData, onInteractionStart]);

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

  // Handle wavelength range selection for sample selection
  const handleRangeMouseDown = useCallback((e: unknown) => {
    const chartEvent = e as { activeLabel?: number };
    if (!chartEvent?.activeLabel) return;
    const wl = chartEvent.activeLabel;
    if (!isNaN(wl)) {
      setRangeSelection({ startWavelength: wl, endWavelength: wl, isSelecting: true });
    }
  }, []);

  const handleRangeMouseMove = useCallback((e: unknown) => {
    if (!rangeSelection.isSelecting) return;
    const chartEvent = e as { activeLabel?: number };
    if (!chartEvent?.activeLabel) return;
    const wl = chartEvent.activeLabel;
    if (!isNaN(wl)) {
      setRangeSelection(prev => ({ ...prev, endWavelength: wl }));
    }
  }, [rangeSelection.isSelecting]);

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
        if (folds) {
          const targetFold = folds[sampleIdx];
          similarSamples = folds
            .map((f, idx) => ({ f, idx }))
            .filter(({ f }) => f === targetFold)
            .map(({ idx }) => idx);
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

  // Get legend items
  const legendItems = useMemo(() => {
    // Grouped mode legend
    if (showGroupedAggregation) {
      return groupKeys.map((key, idx) => ({
        label: String(key),
        color: FOLD_COLORS[idx % FOLD_COLORS.length],
        isArea: config.aggregation.mode !== 'none',
      }));
    }

    if (config.aggregation.mode !== 'none') {
      return getAggregationLegendItems(config.aggregation.mode, config.viewMode === 'both');
    }
    const items: Array<{ label: string; color: string; dashed?: boolean; isArea?: boolean }> = [];
    if (showProcessed) {
      items.push({ label: config.viewMode === 'difference' ? 'Difference' : 'Processed', color: 'hsl(var(--primary))' });
    }
    if (showOriginal && config.viewMode === 'both') {
      items.push({ label: 'Original', color: 'hsl(var(--primary))', dashed: true });
    }
    return items;
  }, [config.aggregation.mode, config.viewMode, showProcessed, showOriginal, showGroupedAggregation, groupKeys]);

  return (
    <div className="h-full flex flex-col relative" ref={chartRef}>
      {/* Enhanced Toolbar */}
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
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
        />

        {/* Secondary controls */}
        <div className="flex items-center gap-1.5">
          {/* Wavelength focus picker */}
          <WavelengthRangePicker
            config={config.wavelengthFocus}
            onChange={configResult.updateWavelengthFocus}
            wavelengthRange={wavelengthRange}
            wavelengthCount={baseWavelengths.length}
            onInteractionStart={onInteractionStart}
            compact={compact}
          />

          {/* Filter panel */}
          <SpectraFilterPanel
            config={config.filters}
            onChange={configResult.updateFilters}
            folds={folds}
            yRange={yRange}
            metadataColumns={metadataColumns}
            totalSamples={totalSamples}
            filteredSamples={displayedSamples}
            onInteractionStart={onInteractionStart}
            compact={compact}
          />
        </div>
      </div>

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-background/70 backdrop-blur-[1px] flex items-center justify-center z-20 pointer-events-none">
          <Loader2 className="w-5 h-5 animate-spin text-primary" aria-hidden="true" />
          <span className="sr-only">Updating spectra</span>
        </div>
      )}

      {/* Chart with context menu */}
      <SpectraContextMenu
        hoveredSample={hoveredSample}
        sampleIds={sampleIds}
        yValues={y}
        folds={folds}
        onExportSamples={handleExportSamples}
        onSelectSimilar={handleSelectSimilar}
      >
        <div
          className="flex-1 min-h-0 relative"
          onMouseUp={isWebGLMode ? undefined : handleRangeMouseUp}
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
                spectra={config.viewMode === 'original' ? original.spectra : focusedData.spectra}
                originalSpectra={config.viewMode === 'both' ? original.spectra : undefined}
                wavelengths={focusedData.wavelengths}
                y={y}
                visibleIndices={displayIndices}
                sampleColors={sampleColors}
                useSelectionContext={useSelectionContext}
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

            <Brush
              dataKey="wavelength"
              height={15}
              stroke="hsl(var(--primary))"
              fill="hsl(var(--muted))"
              onChange={handleBrushChange}
              data={chartData}
            />

            {/* Grouped aggregation elements */}
            {showGroupedAggregation && groupKeys.map((groupKey, groupIdx) => {
              const prefix = `grp_${groupKey}`;
              const groupColor = FOLD_COLORS[groupIdx % FOLD_COLORS.length];

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
                        {...ANIMATION_CONFIG}
                      />
                      <Line
                        type="monotone"
                        dataKey={`${prefix}_max`}
                        stroke={groupColor}
                        strokeWidth={1}
                        strokeDasharray="2 2"
                        dot={false}
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
                  {...ANIMATION_CONFIG}
                />
              );
            })}

            <Tooltip
              content={() => null}
            />
          </ComposedChart>
        </ResponsiveContainer>
          )}
        </div>
      </SpectraContextMenu>

      {/* Legend */}
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
        </div>
        {brushDomain && (
          <span>
            Zoom: {brushDomain[0].toFixed(0)} - {brushDomain[1].toFixed(0)} nm
          </span>
        )}
      </div>
    </div>
  );
}

export default SpectraChartV2;

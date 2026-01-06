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

import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
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
  type ExtendedColorConfig,
} from './chartConfig';
import { SpectraChartToolbar } from './SpectraChartToolbar';
import { WavelengthRangePicker } from './WavelengthRangePicker';
import { SpectraFilterPanel } from './SpectraFilterPanel';
import {
  computeAggregatedStats,
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
} from '@/lib/playground/spectraConfig';
import { useSelection } from '@/context/SelectionContext';
import type { DataSection, FoldsInfo } from '@/types/playground';

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
}: SpectraChartV2Props) {
  const chartRef = useRef<HTMLDivElement>(null);

  // Use external config or create internal one
  const internalConfig = useSpectraChartConfig();
  const configResult = externalConfig ?? internalConfig;
  const { config } = configResult;

  // SelectionContext integration for cross-chart highlighting
  const selectionCtx = useSelectionContext ? useSelection() : null;

  // Determine effective selection state
  const selectedSamples = useSelectionContext && selectionCtx
    ? selectionCtx.selectedSamples
    : new Set<number>(externalSelectedSample !== null && externalSelectedSample !== undefined ? [externalSelectedSample] : []);

  const hoveredSample = selectionCtx?.hoveredSample ?? null;
  const pinnedSamples = selectionCtx?.pinnedSamples ?? new Set<number>();

  // Brush state
  const [brushDomain, setBrushDomain] = useState<[number, number] | null>(null);

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
      case 'difference':
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

  // Apply sampling strategy
  const samplingResult: SamplingResult = useMemo(() => {
    const totalSamples = focusedData.spectra.length;
    return applySampling(totalSamples, config.sampling, {
      yValues: y,
      spectra: focusedData.spectra,
    });
  }, [focusedData.spectra, config.sampling, y]);

  // Get display indices
  const displayIndices = samplingResult.indices;
  const displayedSamples = displayIndices.length;
  const totalSamples = samplingResult.totalSamples;

  // Compute aggregated stats if in aggregation mode
  const aggregatedStats: AggregatedStats | null = useMemo(() => {
    if (config.aggregation.mode === 'none') return null;
    return computeAggregatedStats(focusedData.spectra, config.aggregation.quantileRange);
  }, [focusedData.spectra, config.aggregation.mode, config.aggregation.quantileRange]);

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
    const showIndividualLines = config.aggregation.mode === 'none';
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
            let origValue = original.spectra[sIdx][wIdx];
            if (origValue !== undefined) {
              point[`o${displayIdx}`] = origValue;
            }
          }
        });
      }

      // Add aggregation data
      if (aggregatedStats && config.aggregation.mode !== 'none') {
        const aggPoint = buildAggregationDataPoint(wavelength, wIdx, aggregatedStats, config.aggregation.mode, '');
        Object.assign(point, aggPoint);

        // Add original aggregation for 'both' mode
        if (originalAggregatedStats && config.viewMode === 'both') {
          const origAggPoint = buildAggregationDataPoint(wavelength, wIdx, originalAggregatedStats, config.aggregation.mode, 'orig');
          Object.assign(point, origAggPoint);
        }
      }

      return point;
    });
  }, [focusedData, displayIndices, config.aggregation.mode, config.viewMode, aggregatedStats, originalAggregatedStats, original.spectra]);

  // Filter data by brush domain
  const filteredData = useMemo(() => {
    if (!brushDomain) return chartData;
    return chartData.filter(
      d => (d.wavelength as number) >= brushDomain[0] && (d.wavelength as number) <= brushDomain[1]
    );
  }, [chartData, brushDomain]);

  // Get color for a sample
  const getColor = useCallback((displayIdx: number, isOriginal: boolean) => {
    const sampleIdx = displayIndices[displayIdx];
    const yValues = y ?? [];
    const foldLabels = folds?.fold_labels;

    const isSelected = selectedSamples.has(sampleIdx);
    const isHovered = hoveredSample === sampleIdx;
    const isPinned = pinnedSamples.has(sampleIdx);
    const hasSelection = selectedSamples.size > 0;

    if (isHovered) return 'hsl(var(--primary))';
    if (isSelected) return 'hsl(var(--primary))';
    if (isPinned) return 'hsl(var(--accent-foreground))';

    const effectiveSelection = hasSelection ? sampleIdx : undefined;

    const baseColor = getExtendedSampleColor(
      sampleIdx,
      yValues,
      foldLabels,
      colorConfig,
      effectiveSelection,
      undefined
    );

    if (hasSelection) return `${baseColor}40`;

    if (isOriginal && config.viewMode === 'both') {
      return baseColor.replace(/50%\)/, '60%)').replace(/70%/, '50%');
    }
    return baseColor;
  }, [displayIndices, y, folds, colorConfig, selectedSamples, hoveredSample, pinnedSamples, config.viewMode]);

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

  // Handle brush change
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

  // Determine what to render
  const showIndividualLines = config.aggregation.mode === 'none';
  const showOriginal = showIndividualLines && (config.viewMode === 'both' || config.viewMode === 'original');
  const showProcessed = showIndividualLines && (config.viewMode === 'both' || config.viewMode === 'processed');

  // Get legend items
  const legendItems = useMemo(() => {
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
  }, [config.aggregation.mode, config.viewMode, showProcessed, showOriginal]);

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

      {/* Chart */}
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={filteredData}
            margin={CHART_MARGINS.spectra}
            onClick={handleClick}
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

            <Brush
              dataKey="wavelength"
              height={15}
              stroke="hsl(var(--primary))"
              fill="hsl(var(--muted))"
              onChange={handleBrushChange}
              data={chartData}
            />

            {/* Aggregation elements */}
            {config.aggregation.mode !== 'none' && getAggregationElements(
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
      </div>

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

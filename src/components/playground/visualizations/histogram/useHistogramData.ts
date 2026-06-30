/**
 * Shared hook for YHistogram: bins computation, KDE, statistics, selection, event handlers.
 *
 * All shared logic that was previously inline in YHistogram is extracted here.
 * Mode-specific chart components consume this hook's return value via props.
 */

import { useMemo, useRef, useCallback, useState, useEffect } from 'react';
import { useSelection } from '@/context/useSelection';
import {
  getCategoricalColor,
  getContinuousColor,
  detectMetadataType,
  getMetadataUniqueCategories,
  HIGHLIGHT_COLORS,
  getHeldOutTestColor,
  getSamplePartitionRole,
  isHeldOutTestSample,
  normalizeValue,
} from '@/lib/playground/colorConfig';
import { exportChart } from '@/lib/chartExport';
import {
  calculateOptimalBinCount,
  computeKDE,
  getHistogramPartitionRoleColor,
} from './utils';
import { useHistogramSelectionHandlers } from './useHistogramSelectionHandlers';
import {
  computeClassBarData,
  computeHistogramBins,
  computeSelectedYStats,
  computeYStats,
  getHoveredBin,
  getHoveredClass,
  getSelectedBins,
  getSelectedClasses,
  mapSamplesToClasses,
} from './histogramDataUtils';
import {
  type YHistogramProps,
  type BinData,
  type HistogramConfig,
  DEFAULT_CONFIG,
} from './types';

export function useHistogramData(props: YHistogramProps) {
  const {
    y,
    processedY,
    folds,
    metadata,
    selectedSample: externalSelectedSample,
    useSelectionContext: useSelectionContextFlag = true,
    compact = false,
    globalColorConfig,
    colorContext,
  } = props;

  const chartRef = useRef<HTMLDivElement>(null);
  const [config, setConfig] = useState<HistogramConfig>(DEFAULT_CONFIG);

  // SelectionContext integration for cross-chart highlighting
  // Always call hook unconditionally, then conditionally use the result
  const fullSelectionCtx = useSelection();
  const selectionCtx = useSelectionContextFlag ? fullSelectionCtx : null;

  // Determine effective selection state
  const fallbackSelectedSamples = useMemo(
    () => new Set<number>(
      externalSelectedSample !== null && externalSelectedSample !== undefined
        ? [externalSelectedSample]
        : []
    ),
    [externalSelectedSample]
  );
  const selectedSamples = useSelectionContextFlag
    ? fullSelectionCtx.selectedSamples
    : fallbackSelectedSamples;

  const hoveredSample = useSelectionContextFlag ? fullSelectionCtx.hoveredSample : null;

  // Use processed Y if available
  const displayY = processedY && processedY.length === y.length ? processedY : y;
  const isProcessed = processedY && processedY.length === y.length;

  useEffect(() => {
    if (config.selectedOnly && selectedSamples.size === 0) {
      setConfig(prev => ({ ...prev, selectedOnly: false }));
    }
  }, [config.selectedOnly, selectedSamples.size]);

  // Determine effective color mode from global config
  const effectiveColorMode = globalColorConfig?.mode ?? 'target';

  // Determine stacking modes
  const shouldStackByPartition = effectiveColorMode === 'partition';
  const shouldStackByFold = effectiveColorMode === 'fold';
  const shouldStackByOutlier = effectiveColorMode === 'outlier' && (colorContext?.outlierIndices?.size ?? 0) > 0;
  const shouldStackBySelection = effectiveColorMode === 'selection';

  // Auto-detect metadata type if not explicitly set
  const effectiveMetadataType = useMemo(() => {
    if (effectiveColorMode !== 'metadata' || !globalColorConfig?.metadataKey || !metadata) return null;
    if (globalColorConfig?.metadataType) return globalColorConfig.metadataType;
    const values = metadata[globalColorConfig.metadataKey];
    if (!values) return null;
    return detectMetadataType(values);
  }, [effectiveColorMode, globalColorConfig?.metadataKey, globalColorConfig?.metadataType, metadata]);

  const shouldStackByMetadata = effectiveColorMode === 'metadata' && effectiveMetadataType === 'categorical';

  // Get unique metadata categories for stacking
  const metadataCategories = useMemo(() => {
    if (!shouldStackByMetadata || !globalColorConfig?.metadataKey || !metadata) return [];
    const key = globalColorConfig.metadataKey;
    const values = metadata[key];
    if (!values) return [];
    return getMetadataUniqueCategories(values);
  }, [shouldStackByMetadata, globalColorConfig?.metadataKey, metadata]);

  const effectiveDisplayFilter = useMemo(() => {
    const baseFilter = colorContext?.displayFilteredIndices;

    if (!config.selectedOnly || selectedSamples.size === 0) {
      return baseFilter;
    }

    const selectedOnlyFilter = new Set<number>();
    selectedSamples.forEach((sampleIdx) => {
      if (!baseFilter || baseFilter.has(sampleIdx)) {
        selectedOnlyFilter.add(sampleIdx);
      }
    });

    return selectedOnlyFilter;
  }, [colorContext?.displayFilteredIndices, config.selectedOnly, selectedSamples]);

  const filteredDisplayY = useMemo(() => {
    if (!effectiveDisplayFilter) {
      return displayY;
    }
    return displayY.filter((_, idx) => effectiveDisplayFilter.has(idx));
  }, [displayY, effectiveDisplayFilter]);

  // Calculate effective bin count
  const effectiveBinCount = useMemo(() => {
    if (config.binCount === 'custom') return config.customBinCount;
    if (config.binCount === 'auto') return calculateOptimalBinCount(filteredDisplayY);
    return parseInt(config.binCount, 10);
  }, [config.binCount, config.customBinCount, filteredDisplayY]);

  // Compute histogram bins
  const { histogramData, sampleBins } = useMemo(() => {
    return computeHistogramBins({
      values: displayY,
      binCount: effectiveBinCount,
      displayFilter: effectiveDisplayFilter,
      foldLabels: folds?.fold_labels ?? [],
    });
  }, [displayY, effectiveBinCount, folds, effectiveDisplayFilter]);

  // Phase 5: Determine if we're in classification mode
  const isClassificationMode = useMemo(() => {
    const targetType = colorContext?.targetType;
    return targetType === 'classification' || targetType === 'ordinal';
  }, [colorContext?.targetType]);

  // Phase 5: Compute class bar data for classification mode
  const classBarData = useMemo(() => {
    if (!isClassificationMode) return [];

    return computeClassBarData({
      values: displayY,
      classLabels: colorContext?.classLabels,
      classLabelMap: colorContext?.classLabelMap,
      displayFilter: effectiveDisplayFilter,
      foldLabels: folds?.fold_labels ?? [],
    });
  }, [isClassificationMode, colorContext?.classLabels, colorContext?.classLabelMap, effectiveDisplayFilter, displayY, folds]);

  // Phase 5: Map samples to their class index for selection highlighting
  const sampleToClass = useMemo(() => {
    if (!isClassificationMode) return [] as number[];
    const classLabels = colorContext?.classLabels ?? [];
    const classLabelMap = colorContext?.classLabelMap;
    return mapSamplesToClasses(displayY, classLabels, classLabelMap);
  }, [isClassificationMode, colorContext?.classLabels, colorContext?.classLabelMap, displayY]);

  // Compute statistics
  const stats = useMemo(() => computeYStats(filteredDisplayY), [filteredDisplayY]);

  // Compute stats for selected samples
  const selectedStats = useMemo(
    () => computeSelectedYStats(displayY, selectedSamples, effectiveDisplayFilter),
    [displayY, effectiveDisplayFilter, selectedSamples]
  );

  // Stats to display in footer
  const displayStats = selectedSamples.size > 0 ? selectedStats : stats;

  // Compute KDE data
  const kdeData = useMemo(() => {
    if (!config.showKDE || filteredDisplayY.length === 0) return [];
    const kde = computeKDE(filteredDisplayY);
    // Scale KDE to match histogram height
    const maxCount = Math.max(...histogramData.map(d => d.count));
    const maxDensity = Math.max(...kde.map(d => d.density));
    return kde.map(d => ({
      x: d.x,
      density: (d.density / maxDensity) * maxCount,
    }));
  }, [config.showKDE, filteredDisplayY, histogramData]);

  // Get unique fold indices
  const uniqueFolds = useMemo(() => {
    if (!folds?.fold_labels) return [] as number[];
    return [...new Set(folds.fold_labels.filter(f => f >= 0))].sort((a, b) => a - b);
  }, [folds]);

  // Find which bins contain selected/hovered samples
  const selectedBins = useMemo(() => {
    return getSelectedBins(selectedSamples, sampleBins);
  }, [selectedSamples, sampleBins]);

  const hoveredBin = getHoveredBin(hoveredSample, sampleBins);

  // Phase 5: Find which classes contain selected/hovered samples
  const selectedClasses = useMemo(() => {
    if (!isClassificationMode) return new Set<number>();
    return getSelectedClasses(selectedSamples, sampleToClass);
  }, [isClassificationMode, selectedSamples, sampleToClass]);

  const hoveredClass = useMemo(() => {
    if (!isClassificationMode) return null;
    return getHoveredClass(hoveredSample, sampleToClass);
  }, [isClassificationMode, hoveredSample, sampleToClass]);

  const hasFolds = uniqueFolds.length > 0;

  // ============= getYValue and yAxisLabel =============

  const getYValue = useCallback((count: number) => {
    switch (config.yAxisType) {
      case 'frequency':
        return stats ? (count / stats.n) * 100 : count;
      case 'density': {
        const binWidth = histogramData.length > 0
          ? histogramData[0].binEnd - histogramData[0].binStart
          : 1;
        return stats ? count / (stats.n * binWidth) : count;
      }
      default:
        return count;
    }
  }, [config.yAxisType, stats, histogramData]);

  const yAxisLabel = config.yAxisType === 'frequency' ? '%' : config.yAxisType === 'density' ? 'Density' : 'Count';

  const {
    lastMouseEventRef,
    rangeSelection,
    setRangeSelection,
    handleMouseDown,
    handleMouseMove,
    handleMouseLeave,
    handleDragSelection,
    handleBarSelection,
    handleStackedBarSelection,
  } = useHistogramSelectionHandlers({ histogramData, selectionCtx });

  // ============= Export Handler =============

  const handleExport = useCallback(() => {
    const exportData = histogramData.map(h => ({
      bin_center: h.binCenter,
      bin_start: h.binStart,
      bin_end: h.binEnd,
      count: h.count,
    }));
    exportChart(chartRef.current, exportData, 'y_histogram');
  }, [histogramData]);

  // ============= Config Update =============

  const updateConfig = useCallback((updates: Partial<HistogramConfig>) => {
    setConfig(prev => ({ ...prev, ...updates }));
  }, []);

  // ============= Bar Color (simple mode) =============

  const getBarColor = useCallback((entry: BinData, _index: number) => {
    switch (effectiveColorMode) {
      case 'target': {
        const t = normalizeValue(entry.binCenter, stats?.min ?? 0, stats?.max ?? 1);
        return getContinuousColor(t, globalColorConfig?.continuousPalette ?? 'blue_red');
      }

      case 'fold': {
        if (entry.samples.length > 0) {
          const foldCounts = new Map<number, number>();
          let maxFold = -1;
          let maxCount = 0;
          let heldOutCount = 0;

          entry.samples.forEach((sampleIdx) => {
            if (colorContext && isHeldOutTestSample(sampleIdx, colorContext)) {
              heldOutCount += 1;
              return;
            }

            const foldLabel = colorContext?.foldLabels?.[sampleIdx];
            if (foldLabel !== undefined && foldLabel >= 0) {
              const nextCount = (foldCounts.get(foldLabel) ?? 0) + 1;
              foldCounts.set(foldLabel, nextCount);
              if (nextCount > maxCount) {
                maxCount = nextCount;
                maxFold = foldLabel;
              }
            }
          });

          if (heldOutCount > maxCount) {
            return getHeldOutTestColor();
          }
          if (maxFold >= 0) {
            return getCategoricalColor(maxFold, globalColorConfig?.categoricalPalette ?? 'default');
          }
        }
        return 'hsl(var(--primary) / 0.6)';
      }

      case 'partition': {
        const partitionCounts = {
          train: 0,
          val: 0,
          test: 0,
        };

        entry.samples.forEach((sampleIdx) => {
          const role = colorContext ? getSamplePartitionRole(sampleIdx, colorContext) : 'unknown';
          if (role === 'train' || role === 'val' || role === 'test') {
            partitionCounts[role] += 1;
          }
        });

        let dominantRole: 'train' | 'val' | 'test' | null = null;
        let dominantCount = 0;
        (['train', 'val', 'test'] as const).forEach((role) => {
          if (partitionCounts[role] > dominantCount) {
            dominantRole = role;
            dominantCount = partitionCounts[role];
          }
        });

        if (dominantRole) {
          return getHistogramPartitionRoleColor(dominantRole);
        }
        return 'hsl(var(--primary) / 0.6)';
      }

      case 'outlier': {
        if (colorContext?.outlierIndices) {
          const outlierCount = entry.samples.filter(s => colorContext.outlierIndices?.has(s)).length;
          if (outlierCount > entry.samples.length / 2) return HIGHLIGHT_COLORS.outlier;
        }
        return 'hsl(var(--muted-foreground) / 0.6)';
      }

      case 'selection':
        return 'hsl(var(--muted-foreground) / 0.6)';

      case 'index': {
        const avgIndex = entry.samples.length > 0
          ? entry.samples.reduce((a, b) => a + b, 0) / entry.samples.length
          : 0;
        const totalSamples = colorContext?.totalSamples ?? displayY.length;
        const t = avgIndex / Math.max(1, totalSamples - 1);
        return getContinuousColor(t, globalColorConfig?.continuousPalette ?? 'blue_red');
      }

      case 'metadata': {
        const metadataKey = globalColorConfig?.metadataKey;
        if (metadataKey && metadata?.[metadataKey] && entry.samples.length > 0) {
          const metadataValues = metadata[metadataKey];
          const metadataType = globalColorConfig?.metadataType ?? detectMetadataType(metadataValues);

          if (metadataType === 'continuous') {
            const numericValues = metadataValues.filter(v => typeof v === 'number') as number[];
            if (numericValues.length > 0) {
              const sum = entry.samples.reduce((acc, sampleIdx) => {
                const val = metadataValues[sampleIdx];
                return acc + (typeof val === 'number' ? val : 0);
              }, 0);
              const avgValue = sum / entry.samples.length;
              const min = Math.min(...numericValues);
              const max = Math.max(...numericValues);
              const t = normalizeValue(avgValue, min, max);
              return getContinuousColor(t, globalColorConfig?.continuousPalette ?? 'blue_red');
            }
          } else {
            const categoryCounts: Record<string, number> = {};
            entry.samples.forEach(sampleIdx => {
              const val = String(metadataValues[sampleIdx] ?? '');
              if (val && val !== 'undefined' && val !== 'null') {
                categoryCounts[val] = (categoryCounts[val] || 0) + 1;
              }
            });

            let maxCategory = '';
            let maxCatCount = 0;
            Object.entries(categoryCounts).forEach(([cat, count]) => {
              if (count > maxCatCount) {
                maxCatCount = count;
                maxCategory = cat;
              }
            });

            if (maxCategory) {
              const uniqueValues = getMetadataUniqueCategories(metadataValues);
              const idx = uniqueValues.indexOf(maxCategory);
              return getCategoricalColor(idx >= 0 ? idx : 0, globalColorConfig?.categoricalPalette ?? 'default');
            }
          }
        }
        // Fallback to Y-based coloring
        const t = normalizeValue(entry.binCenter, stats?.min ?? 0, stats?.max ?? 1);
        return getContinuousColor(t, globalColorConfig?.continuousPalette ?? 'blue_red');
      }

      default: {
        const t = normalizeValue(entry.binCenter, stats?.min ?? 0, stats?.max ?? 1);
        return getContinuousColor(t, globalColorConfig?.continuousPalette ?? 'blue_red');
      }
    }
  }, [effectiveColorMode, globalColorConfig, colorContext, stats, displayY.length, metadata]);

  return {
    // Refs
    chartRef,
    lastMouseEventRef,

    // Config state
    config,
    updateConfig,

    // Computed data
    displayY,
    isProcessed: !!isProcessed,
    histogramData,
    sampleBins,
    stats,
    selectedStats,
    displayStats,
    kdeData,
    classBarData,
    sampleToClass,

    // Mode detection
    effectiveColorMode,
    isClassificationMode,
    shouldStackByPartition,
    shouldStackByFold,
    shouldStackByOutlier,
    shouldStackByMetadata,
    shouldStackBySelection,
    hasFolds,
    uniqueFolds,
    metadataCategories,

    // Selection state
    selectedSamples,
    hoveredSample,
    selectedBins,
    hoveredBin,
    selectedClasses,
    hoveredClass,
    selectionCtx,

    // Range selection
    rangeSelection,
    setRangeSelection,

    // Computed values
    getYValue,
    yAxisLabel,
    getBarColor,

    // Handlers
    handleMouseDown,
    handleMouseMove,
    handleMouseLeave,
    handleDragSelection,
    handleBarSelection,
    handleStackedBarSelection,
    handleExport,

    // Pass-through props
    compact,
    globalColorConfig,
    colorContext,
    metadata,
    folds,
  };
}

export type UseHistogramDataReturn = ReturnType<typeof useHistogramData>;

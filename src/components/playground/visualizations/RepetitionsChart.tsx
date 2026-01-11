/**
 * RepetitionsChart - Visualize intra-sample variability (Phase 7)
 *
 * Displays the variability between multiple measurements (repetitions) of the
 * same biological sample. Helps identify:
 * - Samples with high measurement variability
 * - Outlier repetitions
 * - Batch effects across repetitions
 *
 * Features:
 * - Strip plot: X = bio sample, Y = distance from reference
 * - Dynamic distance metric computation via API
 * - Configurable quantile reference lines
 * - Selection integration with other charts
 * - X-axis zoom with mouse wheel/pan
 * - Export functionality
 */

import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
  Tooltip,
  ZAxis,
  ReferenceLine,
} from 'recharts';
import {
  Repeat,
  Download,
  Settings2,
  AlertTriangle,
  ArrowUpDown,
  ZoomIn,
  MousePointer2,
  Monitor,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip as TooltipUI,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { exportDataAsCSV } from '@/lib/chartExport';
import {
  CHART_THEME,
  formatYValue,
} from './chartConfig';
import {
  type GlobalColorConfig,
  type ColorContext,
  getContinuousColor,
  getCategoricalColor,
  normalizeValue,
  detectMetadataType,
  PARTITION_COLORS,
  HIGHLIGHT_COLORS_CONCRETE,
  getWebGLSampleColor,
} from '@/lib/playground/colorConfig';
import { useSelection } from '@/context/SelectionContext';
import type { RepetitionResult } from '@/types/playground';
import type { UseSpectraChartConfigResult } from '@/lib/playground/useSpectraChartConfig';
import type { DiffQuantile } from '@/lib/playground/spectraConfig';
import { DiffModeControls } from './DiffModeControls';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { computeRepetitionVariance } from '@/api/playground';
import {
  SelectionContainer,
  isPointInBox,
  isPointInPolygon,
  type SelectionResult,
} from '@/components/playground/SelectionTools';
import {
  computeSelectionAction,
  computeAreaSelectionAction,
  executeSelectionAction,
} from '@/lib/playground/selectionHandlers';
import {
  ScatterPureWebGL2D,
  type DataBounds,
} from './scatter';

// ============= Types =============

interface RepetitionsChartProps {
  /** Repetition analysis data from backend */
  repetitionData: RepetitionResult | null | undefined;
  /** Raw spectra data for distance computation */
  spectraData?: number[][];
  /** Whether chart is in loading state */
  isLoading?: boolean;
  /** Enable SelectionContext integration */
  useSelectionContext?: boolean;
  /** Y values for target coloring */
  y?: number[];
  /** Compact mode */
  compact?: boolean;
  /** Callback to open repetition setup dialog */
  onConfigureRepetitions?: () => void;
  /** Global color configuration (unified system) */
  globalColorConfig?: GlobalColorConfig;
  /** Color context data for unified color system */
  colorContext?: ColorContext;
  /** Spectra chart config result for diff mode controls */
  configResult?: UseSpectraChartConfigResult;
  /** Whether reference dataset mode is active (affects dataset source visibility) */
  hasReferenceDataset?: boolean;
}

interface PlotDataPoint {
  /** X position (bio sample index) */
  x: number;
  /** Y position (distance) */
  y: number;
  /** Bio sample ID */
  bioSample: string;
  /** Rep index within bio sample */
  repIndex: number;
  /** Global sample index */
  sampleIndex: number;
  /** Sample ID string */
  sampleId: string;
  /** Target value for coloring */
  targetY?: number;
  /** Mean Y for the bio sample */
  yMean?: number;
  /** Is this an outlier? */
  isOutlier: boolean;
  /** Is this point selected? */
  isSelected: boolean;
}

interface ComputedDistances {
  distances: number[];
  quantiles: Record<number, number>;
  mean: number;
  max: number;
}

// ============= Color Helpers =============

function getTargetColor(
  y: number,
  yMin: number,
  yMax: number,
  palette?: GlobalColorConfig['continuousPalette']
): string {
  if (yMax === yMin) return 'hsl(180, 60%, 50%)';
  const t = normalizeValue(y, yMin, yMax);
  if (palette) {
    return getContinuousColor(t, palette);
  }
  const hue = 270 - t * 210;
  const saturation = 60 + t * 20;
  const lightness = 35 + t * 25;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

function getDistanceColor(distance: number, maxDistance: number): string {
  if (maxDistance === 0) return 'hsl(120, 60%, 50%)';
  const t = Math.min(distance / maxDistance, 1);
  const hue = 120 - t * 120;
  return `hsl(${hue}, 70%, 50%)`;
}

function getBioSampleColor(
  index: number,
  palette?: GlobalColorConfig['categoricalPalette']
): string {
  if (palette) {
    return getCategoricalColor(index, palette);
  }
  const hue = (index * 137.508) % 360;
  return `hsl(${hue}, 60%, 50%)`;
}

// ============= Constants =============

const MIN_PIXELS_PER_SAMPLE = 4;
const INITIAL_VISIBLE_SAMPLES = 20; // Initial zoom level
const Y_AXIS_PADDING = 0.15; // 15% padding above max
const POINT_RADIUS = { normal: 2, outlier: 3, selected: 4 };
const QUANTILE_COLORS: Record<DiffQuantile, string> = {
  50: 'hsl(var(--muted-foreground))',
  75: 'hsl(180, 60%, 50%)',
  90: 'hsl(45, 90%, 50%)',
  95: 'hsl(0, 70%, 55%)',
};

// Sort options for X-axis ordering
type SortOption = 'index' | 'distance' | 'distance_desc' | 'variance' | 'variance_desc' | 'color' | 'name';
const SORT_OPTIONS: { value: SortOption; label: string; description: string }[] = [
  { value: 'index', label: 'Original Index', description: 'Original sample order' },
  { value: 'name', label: 'Name', description: 'Alphabetical by bio sample' },
  { value: 'distance', label: 'Distance ↑', description: 'Lowest distance first' },
  { value: 'distance_desc', label: 'Distance ↓', description: 'Highest distance first' },
  { value: 'variance', label: 'Variance ↑', description: 'Lowest within-group variance first' },
  { value: 'variance_desc', label: 'Variance ↓', description: 'Highest within-group variance first' },
  { value: 'color', label: 'Color Value', description: 'By color/target value' },
];

// ============= Component =============

export function RepetitionsChart({
  repetitionData,
  spectraData,
  isLoading = false,
  useSelectionContext = true,
  y,
  compact = false,
  onConfigureRepetitions,
  globalColorConfig,
  colorContext,
  configResult,
  hasReferenceDataset = false,
}: RepetitionsChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [enableHover, setEnableHover] = useState(true);
  const [computedDistances, setComputedDistances] = useState<ComputedDistances | null>(null);
  const [isComputing, setIsComputing] = useState(false);

  // Zoom/pan state (right-click drag)
  const [xDomain, setXDomain] = useState<[number, number] | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<number | null>(null);

  // Note: Left-click area selection is now handled by SelectionContainer

  // Sort state
  const [sortBy, setSortBy] = useState<SortOption>('index');

  // Track if initial zoom has been set
  const [initialZoomSet, setInitialZoomSet] = useState(false);

  // Renderer type (Recharts/WebGL)
  const [rendererType, setRendererType] = useState<'recharts' | 'webgl'>('recharts');

  // SelectionContext integration
  const selectionCtx = useSelectionContext ? useSelection() : null;
  const selectedSamples = selectionCtx?.selectedSamples ?? new Set<number>();

  // Check if we have valid repetition data
  const hasRepetitions = repetitionData?.has_repetitions && repetitionData?.data;

  // Get diff config from configResult
  const diffConfig = configResult?.config.diffConfig;
  const metric = diffConfig?.metric ?? 'euclidean';
  const scaleType = diffConfig?.scaleType ?? 'linear';
  const quantiles = diffConfig?.quantiles ?? [];
  const repetitionReference = diffConfig?.repetitionReference ?? 'group_mean';

  // Compute distances when metric or reference changes
  useEffect(() => {
    if (!hasRepetitions || !repetitionData?.data || !spectraData || spectraData.length === 0) {
      return;
    }

    const groupIds = repetitionData.data.map(d => d.bio_sample);

    // Only compute if we have valid data
    if (groupIds.length === 0 || spectraData.length !== groupIds.length) {
      return;
    }

    setIsComputing(true);

    computeRepetitionVariance({
      X: spectraData,
      group_ids: groupIds,
      reference: repetitionReference,
      metric: metric,
    })
      .then(response => {
        if (response.success) {
          // Validate distances - replace NaN/Inf with 0 to prevent chart breaking
          const validDistances = response.distances.map(d => {
            if (!Number.isFinite(d) || d < 0) return 0;
            return d;
          });

          // Check if all distances are valid (non-zero)
          const hasValidData = validDistances.some(d => d > 0);

          if (hasValidData) {
            setComputedDistances({
              distances: validDistances,
              quantiles: response.quantiles,
              mean: validDistances.reduce((a, b) => a + b, 0) / validDistances.length,
              max: Math.max(...validDistances.filter(d => Number.isFinite(d))),
            });
          } else {
            // If all distances are 0 or invalid, clear computed distances to use fallback
            console.warn('Metric computation returned invalid distances, using fallback');
            setComputedDistances(null);
          }
        }
      })
      .catch(err => {
        console.error('Failed to compute distances:', err);
        setComputedDistances(null);
      })
      .finally(() => {
        setIsComputing(false);
      });
  }, [hasRepetitions, repetitionData, spectraData, metric, repetitionReference]);

  // Get display filter from colorContext
  const displayFilteredIndices = colorContext?.displayFilteredIndices;

  // Transform data for plotting
  const { plotData, bioSampleOrder, yRange, statistics } = useMemo(() => {
    if (!hasRepetitions || !repetitionData?.data) {
      return {
        plotData: [] as PlotDataPoint[],
        bioSampleOrder: [] as string[],
        yRange: { min: 0, max: 1 },
        statistics: null,
      };
    }

    let data = repetitionData.data;

    // Apply display filter if active (e.g., "selected only" mode)
    if (displayFilteredIndices && displayFilteredIndices.size > 0) {
      data = data.filter(d => displayFilteredIndices.has(d.sample_index));
    }

    if (data.length === 0) {
      return {
        plotData: [] as PlotDataPoint[],
        bioSampleOrder: [] as string[],
        yRange: { min: 0, max: 1 },
        statistics: null,
      };
    }

    // Use computed distances if available, otherwise fall back to repetitionData distances
    // Note: distances array corresponds to original data order, need to map by sample_index
    const distanceMap = new Map<number, number>();
    if (computedDistances?.distances) {
      repetitionData.data.forEach((d, i) => {
        distanceMap.set(d.sample_index, computedDistances.distances[i] ?? d.distance);
      });
    }

    // Get unique bio samples and compute per-group stats for sorting
    const bioSamplesSet = new Set(data.map(d => d.bio_sample));
    const bioSampleStats = new Map<string, { meanDist: number; variance: number; meanY: number; firstIndex: number }>();

    for (const bioSample of bioSamplesSet) {
      const groupData = data.filter(d => d.bio_sample === bioSample);
      const distances = groupData.map(d => distanceMap.get(d.sample_index) ?? d.distance);
      const meanDist = distances.reduce((a, b) => a + b, 0) / distances.length;
      const variance = distances.length > 1
        ? distances.reduce((sum, d) => sum + Math.pow(d - meanDist, 2), 0) / (distances.length - 1)
        : 0;
      const yValues = groupData.filter(d => d.y !== undefined).map(d => d.y!);
      const meanY = yValues.length > 0 ? yValues.reduce((a, b) => a + b, 0) / yValues.length : 0;
      const firstIndex = groupData[0]?.sample_index ?? 0;
      bioSampleStats.set(bioSample, { meanDist, variance, meanY, firstIndex });
    }

    // Sort bio samples based on sortBy option
    let bioSampleList = Array.from(bioSamplesSet);
    switch (sortBy) {
      case 'name':
        bioSampleList.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        break;
      case 'distance':
        bioSampleList.sort((a, b) => (bioSampleStats.get(a)?.meanDist ?? 0) - (bioSampleStats.get(b)?.meanDist ?? 0));
        break;
      case 'distance_desc':
        bioSampleList.sort((a, b) => (bioSampleStats.get(b)?.meanDist ?? 0) - (bioSampleStats.get(a)?.meanDist ?? 0));
        break;
      case 'variance':
        bioSampleList.sort((a, b) => (bioSampleStats.get(a)?.variance ?? 0) - (bioSampleStats.get(b)?.variance ?? 0));
        break;
      case 'variance_desc':
        bioSampleList.sort((a, b) => (bioSampleStats.get(b)?.variance ?? 0) - (bioSampleStats.get(a)?.variance ?? 0));
        break;
      case 'color':
        bioSampleList.sort((a, b) => (bioSampleStats.get(a)?.meanY ?? 0) - (bioSampleStats.get(b)?.meanY ?? 0));
        break;
      case 'index':
      default:
        bioSampleList.sort((a, b) => (bioSampleStats.get(a)?.firstIndex ?? 0) - (bioSampleStats.get(b)?.firstIndex ?? 0));
        break;
    }

    // Create a map of bio sample to X index (after sorting)
    const bioSampleIndex = new Map<string, number>();
    bioSampleList.forEach((bs, i) => bioSampleIndex.set(bs, i));

    // Get Y range for coloring
    const allY = data.filter(d => d.y !== undefined).map(d => d.y!);
    const yMin = allY.length > 0 ? Math.min(...allY) : 0;
    const yMax = allY.length > 0 ? Math.max(...allY) : 1;

    const maxDist = computedDistances?.max ?? repetitionData.statistics?.max_distance ?? 1;
    const p95 = computedDistances?.quantiles?.[95] ?? repetitionData.statistics?.p95_distance ?? maxDist;

    // Transform to plot data
    const plotData: PlotDataPoint[] = data.map((d) => {
      const distance = distanceMap.get(d.sample_index) ?? d.distance;
      // Apply log scale if needed
      const displayDistance = scaleType === 'log' ? Math.log1p(distance) : distance;

      return {
        x: bioSampleIndex.get(d.bio_sample) ?? 0,
        y: displayDistance,
        bioSample: d.bio_sample,
        repIndex: d.rep_index,
        sampleIndex: d.sample_index,
        sampleId: d.sample_id,
        targetY: d.y,
        yMean: d.y_mean,
        isOutlier: distance > p95,
        isSelected: selectedSamples.has(d.sample_index),
      };
    });

    // Compute statistics for display
    const stats = computedDistances
      ? {
          mean_distance: computedDistances.mean,
          max_distance: computedDistances.max,
          p95_distance: computedDistances.quantiles[95] ?? computedDistances.max,
        }
      : repetitionData.statistics;

    return {
      plotData,
      bioSampleOrder: bioSampleList,
      yRange: { min: yMin, max: yMax },
      statistics: stats,
    };
  }, [repetitionData, selectedSamples, hasRepetitions, computedDistances, scaleType, displayFilteredIndices, sortBy]);

  // Compute Y domain with 15% padding (needed by event handlers)
  const yDomain = useMemo(() => {
    if (plotData.length === 0) return [0, 1] as [number, number];
    const yValues = plotData.map(p => p.y);
    const minY = Math.min(0, Math.min(...yValues)); // Include 0
    const maxY = Math.max(...yValues);
    const range = maxY - minY || 1;
    return [minY, maxY + range * Y_AXIS_PADDING] as [number, number];
  }, [plotData]);

  // Max distance for color scaling
  const maxDistance = statistics?.max_distance ?? 1;

  // Get point color - handles all global color modes
  const getPointColor = useCallback((point: PlotDataPoint): string => {
    const continuousPalette = globalColorConfig?.continuousPalette ?? 'blue_red';
    const categoricalPalette = globalColorConfig?.categoricalPalette ?? 'default';

    if (globalColorConfig) {
      const mode = globalColorConfig.mode;
      switch (mode) {
        case 'target':
          if (point.targetY !== undefined) {
            return getTargetColor(point.targetY, yRange.min, yRange.max, continuousPalette);
          }
          return HIGHLIGHT_COLORS_CONCRETE.unselected;

        case 'partition':
          if (colorContext?.trainIndices?.has(point.sampleIndex)) {
            return PARTITION_COLORS.train;
          }
          if (colorContext?.testIndices?.has(point.sampleIndex)) {
            return PARTITION_COLORS.test;
          }
          return HIGHLIGHT_COLORS_CONCRETE.unselected;

        case 'fold': {
          const foldLabel = colorContext?.foldLabels?.[point.sampleIndex];
          if (foldLabel !== undefined && foldLabel >= 0) {
            return getCategoricalColor(foldLabel, categoricalPalette);
          }
          return HIGHLIGHT_COLORS_CONCRETE.unselected;
        }

        case 'selection': {
          const isSelected = colorContext?.selectedSamples?.has(point.sampleIndex);
          return isSelected ? HIGHLIGHT_COLORS_CONCRETE.selected : HIGHLIGHT_COLORS_CONCRETE.unselected;
        }

        case 'outlier':
          if (colorContext?.outlierIndices?.has(point.sampleIndex)) {
            return HIGHLIGHT_COLORS_CONCRETE.outlier;
          }
          return HIGHLIGHT_COLORS_CONCRETE.unselected;

        case 'metadata': {
          const metadataKey = globalColorConfig.metadataKey;
          if (!metadataKey || !colorContext?.metadata) {
            return HIGHLIGHT_COLORS_CONCRETE.unselected;
          }
          const values = colorContext.metadata[metadataKey];
          const value = values?.[point.sampleIndex];
          if (value === undefined || value === null) {
            return HIGHLIGHT_COLORS_CONCRETE.unselected;
          }
          // Determine type
          const metadataType = globalColorConfig.metadataType ?? detectMetadataType(values);
          if (metadataType === 'continuous' && typeof value === 'number') {
            const numericValues = values.filter(v => typeof v === 'number') as number[];
            const min = Math.min(...numericValues);
            const max = Math.max(...numericValues);
            const t = normalizeValue(value, min, max);
            return getContinuousColor(t, continuousPalette);
          } else {
            // Categorical
            const uniqueValues = [...new Set(values.filter(v => v !== null && v !== undefined))];
            const idx = uniqueValues.indexOf(value);
            return getCategoricalColor(idx >= 0 ? idx : 0, categoricalPalette);
          }
        }

        case 'index': {
          const totalSamples = colorContext?.totalSamples ?? 1;
          const t = point.sampleIndex / Math.max(1, totalSamples - 1);
          return getContinuousColor(t, continuousPalette);
        }

        default:
          return HIGHLIGHT_COLORS_CONCRETE.unselected;
      }
    }

    // Default: color by distance
    return getDistanceColor(point.y, scaleType === 'log' ? Math.log1p(maxDistance) : maxDistance);
  }, [yRange, maxDistance, globalColorConfig, colorContext, scaleType]);

  // Get point color for WebGL renderers - uses concrete HSL colors (no CSS variables)
  const getWebGLPointColor = useCallback((point: PlotDataPoint): string => {
    // Build a minimal colorContext for this point
    const pointColorContext: ColorContext = {
      y: point.targetY !== undefined ? [point.targetY] : undefined,
      yMin: yRange.min,
      yMax: yRange.max,
      selectedSamples,
      totalSamples: plotData.length,
    };

    // Use the unified WebGL color function if globalColorConfig is provided
    if (globalColorConfig) {
      return getWebGLSampleColor(point.sampleIndex, globalColorConfig, {
        ...pointColorContext,
        ...colorContext,
      });
    }

    // Default: color by distance (same as getPointColor but with concrete colors)
    return getDistanceColor(point.y, scaleType === 'log' ? Math.log1p(maxDistance) : maxDistance);
  }, [yRange, maxDistance, globalColorConfig, colorContext, scaleType, selectedSamples, plotData.length]);

  // Pre-computed WebGL props for 2D renderers (ScatterPureWebGL2D, ScatterRegl2D)
  const webglProps = useMemo(() => {
    const points: [number, number][] = new Array(plotData.length);
    const indices: number[] = new Array(plotData.length);
    const colors: string[] = new Array(plotData.length);
    const values: number[] = new Array(plotData.length);

    for (let i = 0; i < plotData.length; i++) {
      const point = plotData[i];
      points[i] = [point.x, point.y];
      indices[i] = point.sampleIndex;
      colors[i] = getWebGLPointColor(point);
      values[i] = point.targetY ?? point.y;
    }

    return { points, indices, colors, values };
  }, [plotData, getWebGLPointColor]);

  // Calculate custom bounds for WebGL based on xDomain
  const webglBounds = useMemo((): DataBounds => {
    const effectiveDomain = xDomain ?? [-0.5, bioSampleOrder.length - 0.5];
    return {
      minX: effectiveDomain[0],
      maxX: effectiveDomain[1],
      minY: yDomain[0],
      maxY: yDomain[1],
    };
  }, [xDomain, yDomain, bioSampleOrder.length]);

  // Handle point click using unified selection handler
  // Special case: Shift+click selects entire bio-sample group (all repetitions)
  const handlePointClick = useCallback((point: PlotDataPoint, event?: React.MouseEvent) => {
    if (!selectionCtx) return;
    // In box/lasso mode, clicking on points is disabled - area selection handles it
    if (selectionCtx.selectionToolMode !== 'click') return;

    // Special case: Shift+click selects the entire bio-sample group
    if (event?.shiftKey) {
      const bioSamplePoints = plotData.filter(p => p.bioSample === point.bioSample);
      selectionCtx.select(bioSamplePoints.map(p => p.sampleIndex), 'add');
      return;
    }

    // Use unified selection handler for standard click behavior
    const action = computeSelectionAction(
      { indices: [point.sampleIndex] },
      selectedSamples,
      { shift: false, ctrl: event?.ctrlKey || event?.metaKey || false }
    );
    executeSelectionAction(selectionCtx, action);
  }, [selectionCtx, plotData, selectedSamples]);

  // Background click handler for SelectionContainer
  // Only clears selection in click mode when clicking on empty space
  const handleBackgroundClick = useCallback((modifiers: { shift: boolean; ctrl: boolean }) => {
    if (!selectionCtx) return;
    // Only clear if no modifiers are pressed
    if (!modifiers.shift && !modifiers.ctrl) {
      selectionCtx.clear();
    }
  }, [selectionCtx]);

  // Handle area selection completion from SelectionContainer (box or lasso)
  // Uses DOM-based point detection for accuracy (similar to DimensionReductionChart)
  const handleSelectionComplete = useCallback((result: SelectionResult, modifiers: { shift: boolean; ctrl: boolean }) => {
    if (!selectionCtx || plotData.length === 0 || !chartRef.current) return;

    const container = chartRef.current;
    const containerRect = container.getBoundingClientRect();

    // Find all scatter symbols using DOM queries (more robust than coordinate calculation)
    // Recharts renders symbols inside layer groups
    const selectors = [
      '.recharts-scatter-symbol',
      '.recharts-symbols',
      '.recharts-layer.recharts-scatter .recharts-symbols',
      '.recharts-scatter path',
      '.recharts-layer path[fill]',
    ];

    let scatterSymbols: NodeListOf<Element> | null = null;
    for (const selector of selectors) {
      const elements = container.querySelectorAll(selector);
      if (elements.length > 0) {
        scatterSymbols = elements;
        break;
      }
    }

    if (!scatterSymbols || scatterSymbols.length === 0) {
      return;
    }

    // Build array of screen positions for each point using getBoundingClientRect
    const pointScreenPositions: Array<{ screenX: number; screenY: number; dataIndex: number }> = [];

    scatterSymbols.forEach((symbol, idx) => {
      if (idx < plotData.length) {
        const rect = symbol.getBoundingClientRect();
        // Get the center of the symbol relative to container
        const centerX = rect.left + rect.width / 2 - containerRect.left;
        const centerY = rect.top + rect.height / 2 - containerRect.top;

        if (Number.isFinite(centerX) && Number.isFinite(centerY) && rect.width > 0) {
          pointScreenPositions.push({
            screenX: centerX,
            screenY: centerY,
            dataIndex: plotData[idx].sampleIndex,
          });
        }
      }
    });

    // Find points inside the selection using their screen coordinates
    const selectedIndices: number[] = [];

    if ('path' in result) {
      // Lasso selection - check if each point's screen position is inside the lasso path
      const screenPath = result.path;
      if (screenPath.length < 3) return;

      pointScreenPositions.forEach(point => {
        if (isPointInPolygon({ x: point.screenX, y: point.screenY }, screenPath)) {
          selectedIndices.push(point.dataIndex);
        }
      });
    } else {
      // Box selection - check if each point's screen position is inside the box
      const bounds = {
        minX: Math.min(result.start.x, result.end.x),
        maxX: Math.max(result.start.x, result.end.x),
        minY: Math.min(result.start.y, result.end.y),
        maxY: Math.max(result.start.y, result.end.y),
      };

      pointScreenPositions.forEach(point => {
        if (isPointInBox({ x: point.screenX, y: point.screenY }, bounds)) {
          selectedIndices.push(point.dataIndex);
        }
      });
    }

    if (selectedIndices.length === 0) return;

    // Use area selection handler (doesn't clear when re-selecting same points)
    const action = computeAreaSelectionAction(
      { indices: selectedIndices },
      selectedSamples,
      modifiers
    );
    executeSelectionAction(selectionCtx, action);
  }, [selectionCtx, plotData, selectedSamples]);

  // Handle selection for WebGL renderers - converts screen to data coordinates
  const handleSelectionCompleteWebGL = useCallback((result: SelectionResult, modifiers: { shift: boolean; ctrl: boolean }) => {
    if (!selectionCtx || plotData.length === 0 || !chartRef.current) return;

    const container = chartRef.current;
    const containerRect = container.getBoundingClientRect();
    // Account for axis offsets (left-10 = 40px, bottom-6 = 24px)
    const axisLeftOffset = 40;
    const axisBottomOffset = 24;
    const containerWidth = containerRect.width - axisLeftOffset;
    const containerHeight = containerRect.height - axisBottomOffset;

    // Convert screen coordinates to data coordinates (accounting for axis offset)
    const screenToData = (screenX: number, screenY: number) => {
      const bounds = webglBounds;
      const adjustedX = screenX - axisLeftOffset;
      const dataX = bounds.minX + (adjustedX / containerWidth) * (bounds.maxX - bounds.minX);
      const dataY = bounds.maxY - (screenY / containerHeight) * (bounds.maxY - bounds.minY);
      return { x: dataX, y: dataY };
    };

    const selectedIndices: number[] = [];

    if ('path' in result) {
      // Lasso selection - convert screen path to data coordinates
      const dataPath = result.path.map(p => screenToData(p.x, p.y));

      for (const point of plotData) {
        if (isPointInPolygon({ x: point.x, y: point.y }, dataPath)) {
          selectedIndices.push(point.sampleIndex);
        }
      }
    } else {
      // Box selection - convert screen box to data coordinates
      const startData = screenToData(result.start.x, result.start.y);
      const endData = screenToData(result.end.x, result.end.y);

      const dataBounds = {
        minX: Math.min(startData.x, endData.x),
        maxX: Math.max(startData.x, endData.x),
        minY: Math.min(startData.y, endData.y),
        maxY: Math.max(startData.y, endData.y),
      };

      for (const point of plotData) {
        if (isPointInBox({ x: point.x, y: point.y }, dataBounds)) {
          selectedIndices.push(point.sampleIndex);
        }
      }
    }

    if (selectedIndices.length === 0) return;

    // Use area selection handler
    const action = computeAreaSelectionAction(
      { indices: selectedIndices },
      selectedSamples,
      modifiers
    );
    executeSelectionAction(selectionCtx, action);
  }, [selectionCtx, plotData, selectedSamples, webglBounds]);

  // Prevent context menu on right-click (we use it for panning)
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  // Handle mouse wheel for X-axis zoom
  // Note: We use a ref-based approach to add the wheel listener with { passive: false }
  // to allow preventDefault() without triggering browser warnings
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();

    const numSamples = bioSampleOrder.length;
    if (numSamples === 0) return;

    const currentDomain = xDomain ?? [-0.5, numSamples - 0.5];
    const range = currentDomain[1] - currentDomain[0];
    const center = (currentDomain[0] + currentDomain[1]) / 2;

    // Zoom in or out
    const zoomFactor = e.deltaY > 0 ? 1.2 : 0.8;
    let newRange = range * zoomFactor;

    // Limit zoom based on min pixels per sample
    newRange = Math.max(newRange, 1); // At least 1 sample visible
    newRange = Math.min(newRange, numSamples); // Can't zoom out beyond all samples

    const newStart = Math.max(-0.5, center - newRange / 2);
    const newEnd = Math.min(numSamples - 0.5, center + newRange / 2);

    setXDomain([newStart, newEnd]);
  }, [xDomain, bioSampleOrder.length]);

  // Attach wheel listener with { passive: false } to allow preventDefault()
  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;

    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      element.removeEventListener('wheel', handleWheel);
    };
  }, [handleWheel]);

  // Handle right-click mouse down for panning
  // Note: Left-click area selection is now handled by SelectionContainer
  const handlePanMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 2) {
      // Right click - start panning
      e.preventDefault();
      setIsPanning(true);
      setPanStart(e.clientX);
    }
  }, []);

  // Handle mouse move for panning only (area selection handled by SelectionContainer)
  const handlePanMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning || panStart === null) return;

    const numSamples = bioSampleOrder.length;
    if (numSamples === 0) return;

    const chartWidth = chartRef.current?.clientWidth ?? 800;
    const currentDomain = xDomain ?? [-0.5, numSamples - 0.5];
    const range = currentDomain[1] - currentDomain[0];

    const deltaX = e.clientX - panStart;
    const deltaSamples = -(deltaX / chartWidth) * range;

    let newStart = currentDomain[0] + deltaSamples;
    let newEnd = currentDomain[1] + deltaSamples;

    // Clamp to bounds
    if (newStart < -0.5) {
      newEnd -= (newStart + 0.5);
      newStart = -0.5;
    }
    if (newEnd > numSamples - 0.5) {
      newStart -= (newEnd - (numSamples - 0.5));
      newEnd = numSamples - 0.5;
    }

    setXDomain([Math.max(-0.5, newStart), Math.min(numSamples - 0.5, newEnd)]);
    setPanStart(e.clientX);
  }, [isPanning, panStart, xDomain, bioSampleOrder.length]);

  // Handle mouse up - finish pan only (area selection handled by SelectionContainer)
  const handlePanMouseUp = useCallback(() => {
    if (isPanning) {
      setIsPanning(false);
      setPanStart(null);
    }
  }, [isPanning]);

  // Handle mouse leave - cancel pan
  const handlePanMouseLeave = useCallback(() => {
    if (isPanning) {
      setIsPanning(false);
      setPanStart(null);
    }
  }, [isPanning]);

  // Reset zoom on double click
  const handleDoubleClick = useCallback(() => {
    setXDomain(null);
  }, []);

  // Export handler
  const handleExport = useCallback(() => {
    if (!repetitionData?.data) return;

    const exportData = repetitionData.data.map((d, i) => ({
      bio_sample: d.bio_sample,
      rep_index: d.rep_index,
      sample_id: d.sample_id,
      sample_index: d.sample_index,
      distance: computedDistances?.distances[i] ?? d.distance,
      y: d.y ?? '',
      y_mean: d.y_mean ?? '',
    }));

    exportDataAsCSV(exportData, 'repetition_analysis');
  }, [repetitionData, computedDistances]);

  // Toggle grid
  const handleGridToggle = useCallback(() => {
    setShowGrid(prev => !prev);
  }, []);

  // Set initial zoom when data loads (zoom to show ~INITIAL_VISIBLE_SAMPLES)
  useEffect(() => {
    if (!initialZoomSet && bioSampleOrder.length > 0) {
      const numSamples = bioSampleOrder.length;
      if (numSamples > INITIAL_VISIBLE_SAMPLES) {
        // Start zoomed in to show first INITIAL_VISIBLE_SAMPLES
        setXDomain([-0.5, INITIAL_VISIBLE_SAMPLES - 0.5]);
      }
      setInitialZoomSet(true);
    }
  }, [bioSampleOrder.length, initialZoomSet]);

  // Compute zoom level for indicator
  const zoomInfo = useMemo(() => {
    const numSamples = bioSampleOrder.length;
    if (numSamples === 0) return { level: 100, visible: 0, total: 0 };
    const effectiveDomain = xDomain ?? [-0.5, numSamples - 0.5];
    const visibleRange = effectiveDomain[1] - effectiveDomain[0];
    const visibleSamples = Math.round(visibleRange);
    const zoomPercent = Math.round((visibleSamples / numSamples) * 100);
    return { level: zoomPercent, visible: visibleSamples, total: numSamples };
  }, [xDomain, bioSampleOrder.length]);

  // Empty states
  if (!repetitionData) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        <div className="text-center">
          <Repeat className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
          <p>Loading repetition data...</p>
        </div>
      </div>
    );
  }

  if (repetitionData.error) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        <div className="text-center">
          <AlertTriangle className="w-8 h-8 text-amber-500/70 mx-auto mb-2" />
          <p className="text-amber-600">Repetition analysis error</p>
          <p className="text-xs mt-1 max-w-[200px]">{repetitionData.error}</p>
        </div>
      </div>
    );
  }

  if (!hasRepetitions) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        <div className="text-center max-w-[250px]">
          <Repeat className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
          <p className="font-medium mb-1">No repetitions detected</p>
          <p className="text-xs">{repetitionData.message || 'Samples appear to be unique measurements.'}</p>
          {onConfigureRepetitions && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3 text-xs"
              onClick={onConfigureRepetitions}
            >
              <Settings2 className="w-3 h-3 mr-1" />
              Configure Detection
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Compute X domain
  const effectiveXDomain = xDomain ?? [-0.5, bioSampleOrder.length - 0.5];

  // Get quantile values for reference lines
  const quantileValues = useMemo(() => {
    const values: { quantile: DiffQuantile; value: number }[] = [];
    const source = computedDistances?.quantiles ?? {
      50: statistics?.mean_distance ?? 0,
      75: (statistics?.mean_distance ?? 0) * 1.5,
      90: (statistics?.p95_distance ?? 0) * 0.9,
      95: statistics?.p95_distance ?? 0,
    };

    for (const q of quantiles) {
      let value = source[q] ?? 0;
      if (scaleType === 'log') {
        value = Math.log1p(value);
      }
      values.push({ quantile: q, value });
    }
    return values;
  }, [quantiles, computedDistances, statistics, scaleType]);

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (!enableHover) return null;
    if (!active || !payload || payload.length === 0) return null;
    const point: PlotDataPoint | undefined = payload[0]?.payload;
    if (!point) return null;

    return (
      <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-xs max-w-[200px]">
        <p className="font-medium mb-1 truncate">{point.bioSample}</p>
        <div className="space-y-0.5 text-muted-foreground">
          <p>Repetition: {point.repIndex + 1}</p>
          <p>Sample: {point.sampleId}</p>
          <p>Distance: {formatYValue(point.y)}</p>
          {point.targetY !== undefined && (
            <p>Y Value: {formatYValue(point.targetY)}</p>
          )}
          {point.isOutlier && (
            <p className="text-amber-600 font-medium">⚠ High variability</p>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      className="h-full flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Repeat className="w-4 h-4 text-primary" />
          Repetitions
          <Badge variant="secondary" className="text-[10px] font-normal">
            {repetitionData.n_with_reps} bio samples
          </Badge>
          {(isComputing || isLoading) && (
            <span className="text-[10px] text-muted-foreground animate-pulse">Computing...</span>
          )}
        </h3>

        <div className="flex items-center gap-1.5">
          {/* Diff Mode Controls */}
          {configResult && (
            <>
              <DiffModeControls
                configResult={configResult}
                compact={compact}
                hasReferenceDataset={hasReferenceDataset}
                hasRepetitions={true}
                showGrid={showGrid}
                onGridToggle={handleGridToggle}
              />
              <Separator orientation="vertical" className="h-4 mx-0.5" />
            </>
          )}

          {/* Sort Dropdown */}
          <DropdownMenu>
            <TooltipProvider delayDuration={200}>
              <TooltipUI>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant={sortBy !== 'index' ? 'secondary' : 'ghost'}
                      size="sm"
                      className="h-7 px-2 text-xs gap-1"
                    >
                      <ArrowUpDown className="w-3 h-3" />
                      {!compact && SORT_OPTIONS.find(o => o.value === sortBy)?.label}
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-xs">Sort samples by</p>
                </TooltipContent>
              </TooltipUI>
            </TooltipProvider>
            <DropdownMenuContent side="bottom" align="start" className="w-48">
              <DropdownMenuLabel className="text-[10px] text-muted-foreground">
                Sort Samples By
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
                {SORT_OPTIONS.map(option => (
                  <DropdownMenuRadioItem
                    key={option.value}
                    value={option.value}
                    className="text-xs"
                  >
                    <div className="flex flex-col">
                      <span>{option.label}</span>
                      <span className="text-[10px] text-muted-foreground">{option.description}</span>
                    </div>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Renderer toggle (SVG/WebGL) */}
          <TooltipProvider delayDuration={200}>
            <div className="flex items-center border rounded-md">
              <TooltipUI>
                <TooltipTrigger asChild>
                  <Button
                    variant={rendererType === 'recharts' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-7 w-7 p-0 rounded-r-none border-r"
                    onClick={() => setRendererType('recharts')}
                  >
                    <Monitor className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-xs">SVG renderer (Recharts)</p>
                </TooltipContent>
              </TooltipUI>

              <TooltipUI>
                <TooltipTrigger asChild>
                  <Button
                    variant={rendererType === 'webgl' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-7 w-7 p-0 rounded-l-none border-l"
                    onClick={() => setRendererType('webgl')}
                  >
                    <Zap className={`w-3.5 h-3.5 ${rendererType === 'webgl' ? 'text-yellow-500' : ''}`} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-xs">WebGL (GPU accelerated)</p>
                </TooltipContent>
              </TooltipUI>
            </div>
          </TooltipProvider>

          {/* Hover toggle */}
          <TooltipProvider delayDuration={200}>
            <TooltipUI>
              <TooltipTrigger asChild>
                <Button
                  variant={enableHover ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => setEnableHover(!enableHover)}
                >
                  <MousePointer2 className={cn("w-3.5 h-3.5", enableHover && "text-primary")} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">{enableHover ? 'Hover enabled' : 'Hover disabled'}</p>
              </TooltipContent>
            </TooltipUI>
          </TooltipProvider>

          {/* Zoom Indicator */}
          {zoomInfo.level < 100 && (
            <TooltipProvider delayDuration={200}>
              <TooltipUI>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="h-6 text-[10px] gap-1 cursor-default">
                    <ZoomIn className="w-3 h-3" />
                    {zoomInfo.visible}/{zoomInfo.total}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-xs">Showing {zoomInfo.visible} of {zoomInfo.total} samples ({zoomInfo.level}%)</p>
                  <p className="text-[10px] text-muted-foreground">Double-click to reset zoom</p>
                </TooltipContent>
              </TooltipUI>
            </TooltipProvider>
          )}

          <Separator orientation="vertical" className="h-4 mx-0.5" />

          {/* Configure */}
          {onConfigureRepetitions && (
            <TooltipProvider delayDuration={200}>
              <TooltipUI>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={onConfigureRepetitions}
                  >
                    <Settings2 className="w-3 h-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-xs">Configure repetition detection</p>
                </TooltipContent>
              </TooltipUI>
            </TooltipProvider>
          )}

          {/* Export */}
          <TooltipProvider delayDuration={200}>
            <TooltipUI>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 px-2" onClick={handleExport}>
                  <Download className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">Export data</p>
              </TooltipContent>
            </TooltipUI>
          </TooltipProvider>
        </div>
      </div>

      {/* Chart with loading overlay wrapped in SelectionContainer */}
      <SelectionContainer
        mode={selectionCtx?.selectionToolMode ?? 'click'}
        onSelectionComplete={rendererType === 'recharts' ? handleSelectionComplete : handleSelectionCompleteWebGL}
        onBackgroundClick={handleBackgroundClick}
        enabled={!!selectionCtx}
        className="flex-1 min-h-0"
      >
        <div
          ref={chartRef}
          className="h-full relative"
          onMouseDown={handlePanMouseDown}
          onMouseMove={handlePanMouseMove}
          onMouseUp={handlePanMouseUp}
          onMouseLeave={handlePanMouseLeave}
          onDoubleClick={handleDoubleClick}
          onContextMenu={handleContextMenu}
          style={{
            cursor: isPanning
              ? 'grabbing'
              : (selectionCtx?.selectionToolMode === 'box' || selectionCtx?.selectionToolMode === 'lasso')
                ? 'crosshair'
                : undefined
          }}
        >
          {/* Loading overlay */}
          {isComputing && (
            <div className="absolute inset-0 bg-background/60 flex items-center justify-center z-10">
              <div className="flex flex-col items-center gap-2">
                <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span className="text-xs text-muted-foreground">Computing distances...</span>
              </div>
            </div>
          )}

          {/* WebGL indicator badge */}
          {rendererType === 'webgl' && (
            <div className="absolute top-2 left-2 z-10 flex items-center gap-1 px-2 py-0.5 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded text-[10px] font-medium">
              <Zap className="w-3 h-3" />
              WebGL
            </div>
          )}

          {/* Y-axis overlay for WebGL mode */}
          {rendererType === 'webgl' && (
            <div className="absolute left-0 top-0 bottom-6 w-10 pointer-events-none z-[6] flex flex-col justify-between py-1">
              {/* Y-axis label */}
              <div className="absolute -left-1 top-1/2 -translate-y-1/2 -rotate-90 origin-center text-[9px] text-muted-foreground whitespace-nowrap">
                {scaleType === 'log' ? 'log(1 + Distance)' : 'Distance'}
              </div>
              {/* Y-axis ticks */}
              {(() => {
                const yRange = webglBounds.maxY - webglBounds.minY;
                const tickCount = 5;
                const ticks: number[] = [];
                for (let i = 0; i <= tickCount; i++) {
                  ticks.push(webglBounds.minY + (yRange * i) / tickCount);
                }
                return ticks.map((tick, i) => {
                  const yPercent = ((webglBounds.maxY - tick) / yRange) * 100;
                  return (
                    <div
                      key={`y-tick-${i}`}
                      className="absolute right-1 text-[9px] text-muted-foreground"
                      style={{ top: `${yPercent}%`, transform: 'translateY(-50%)' }}
                    >
                      {tick.toFixed(2)}
                    </div>
                  );
                });
              })()}
            </div>
          )}

          {/* X-axis labels overlay for WebGL mode */}
          {rendererType === 'webgl' && (
            <div className="absolute left-10 right-0 bottom-0 h-6 pointer-events-none z-[6]">
              {bioSampleOrder.map((_, sampleIndex) => {
                const xRange = webglBounds.maxX - webglBounds.minX;
                const xPercent = ((sampleIndex - webglBounds.minX) / xRange) * 100;
                // Only show if in visible range and not too dense
                if (xPercent < 0 || xPercent > 100) return null;
                // Skip labels if too many are visible (show every nth)
                const visibleCount = Math.ceil(webglBounds.maxX) - Math.floor(webglBounds.minX);
                const step = Math.max(1, Math.floor(visibleCount / 20));
                if (sampleIndex % step !== 0) return null;
                return (
                  <div
                    key={`x-label-${sampleIndex}`}
                    className="absolute text-[9px] text-muted-foreground"
                    style={{ left: `${xPercent}%`, transform: 'translateX(-50%)' }}
                  >
                    {sampleIndex}
                  </div>
                );
              })}
            </div>
          )}

          {/* Axis lines overlay for WebGL mode */}
          {rendererType === 'webgl' && (
            <div className="absolute left-10 right-0 top-0 bottom-6 pointer-events-none z-[3]">
              {/* Y-axis line (left edge) */}
              <div className="absolute left-0 top-0 bottom-0 border-l border-muted-foreground/50" />
              {/* X-axis line (bottom edge) */}
              <div className="absolute left-0 right-0 bottom-0 border-b border-muted-foreground/50" />
            </div>
          )}

          {/* Grid lines overlay for WebGL mode */}
          {rendererType === 'webgl' && showGrid && (
            <div className="absolute left-10 right-0 top-0 bottom-6 pointer-events-none z-[4]">
              {/* Vertical grid lines (at each sample) */}
              {bioSampleOrder.map((_, sampleIndex) => {
                const xRange = webglBounds.maxX - webglBounds.minX;
                const xPercent = ((sampleIndex - webglBounds.minX) / xRange) * 100;
                if (xPercent < 0 || xPercent > 100) return null;
                return (
                  <div
                    key={`sample-grid-${sampleIndex}`}
                    className="absolute top-0 bottom-0 border-l border-dashed opacity-30"
                    style={{
                      left: `${xPercent}%`,
                      borderColor: 'currentColor',
                    }}
                  />
                );
              })}
              {/* Horizontal grid lines */}
              {(() => {
                const yRange = webglBounds.maxY - webglBounds.minY;
                const tickCount = 5;
                const lines: React.ReactNode[] = [];
                for (let i = 0; i <= tickCount; i++) {
                  const tick = webglBounds.minY + (yRange * i) / tickCount;
                  const yPercent = ((webglBounds.maxY - tick) / yRange) * 100;
                  lines.push(
                    <div
                      key={`h-grid-${i}`}
                      className="absolute left-0 right-0 border-t border-dashed opacity-30"
                      style={{
                        top: `${yPercent}%`,
                        borderColor: 'currentColor',
                      }}
                    />
                  );
                }
                return lines;
              })()}
            </div>
          )}

          {/* Quantile reference lines overlay for WebGL mode */}
          {rendererType === 'webgl' && quantileValues.length > 0 && (
            <div className="absolute left-10 right-0 top-0 bottom-6 pointer-events-none z-[5]">
              {quantileValues.map(({ quantile, value }) => {
                // Calculate Y position as percentage from top
                const yRange = webglBounds.maxY - webglBounds.minY;
                const yPercent = ((webglBounds.maxY - value) / yRange) * 100;
                // Only show if in visible range
                if (yPercent < 0 || yPercent > 100) return null;
                return (
                  <div
                    key={`quantile-line-${quantile}`}
                    className="absolute left-0 right-0 border-t-2 border-dashed"
                    style={{
                      top: `${yPercent}%`,
                      borderColor: QUANTILE_COLORS[quantile],
                    }}
                  >
                    <span
                      className="absolute right-1 -top-3 text-[9px] font-medium"
                      style={{ color: QUANTILE_COLORS[quantile] }}
                    >
                      P{quantile}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Recharts SVG renderer */}
          {rendererType === 'recharts' && (
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 45 }}>
                {showGrid && (
                  <CartesianGrid
                    strokeDasharray={CHART_THEME.gridDasharray}
                    stroke={CHART_THEME.gridStroke}
                    opacity={CHART_THEME.gridOpacity}
                  />
                )}

                <XAxis
                  type="number"
                  dataKey="x"
                  domain={effectiveXDomain}
                  ticks={bioSampleOrder.map((_, i) => i).filter(i =>
                    i >= Math.floor(effectiveXDomain[0]) && i <= Math.ceil(effectiveXDomain[1])
                  )}
                  tickFormatter={(value) => String(value)}
                  stroke={CHART_THEME.axisStroke}
                  fontSize={CHART_THEME.axisFontSize}
                  interval={0}
                  height={25}
                  allowDataOverflow
                />

                <YAxis
                  type="number"
                  dataKey="y"
                  domain={yDomain}
                  stroke={CHART_THEME.axisStroke}
                  fontSize={CHART_THEME.axisFontSize}
                  width={40}
                  scale={scaleType === 'log' ? 'linear' : 'linear'}
                  label={{
                    value: scaleType === 'log' ? 'log(1 + Distance)' : 'Distance',
                    angle: -90,
                    position: 'insideLeft',
                    fontSize: CHART_THEME.axisLabelFontSize,
                    offset: 5,
                  }}
                />

                <ZAxis range={[20, 60]} />

                <Tooltip
                  isAnimationActive={false}
                  cursor={enableHover ? { stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1, strokeDasharray: '4 2' } : false}
                  content={<CustomTooltip />}
                />

                {/* Quantile reference lines */}
                {quantileValues.map(({ quantile, value }) => (
                  <ReferenceLine
                    key={`quantile-${quantile}`}
                    y={value}
                    stroke={QUANTILE_COLORS[quantile]}
                    strokeDasharray="3 3"
                    strokeWidth={1}
                    label={{
                      value: `P${quantile}`,
                      position: 'right',
                      fontSize: 9,
                      fill: QUANTILE_COLORS[quantile],
                    }}
                  />
                ))}

                {/* Scatter points */}
                <Scatter
                  data={plotData}
                  cursor="pointer"
                  onClick={(data: any, index: number, event: React.MouseEvent) => {
                    handlePointClick(plotData[index], event);
                  }}
                  isAnimationActive={false}
                >
                  {plotData.map((point, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={getPointColor(point)}
                      stroke={
                        point.isSelected
                          ? 'hsl(var(--foreground))'
                          : point.isOutlier
                            ? 'hsl(var(--warning))'
                            : 'none'
                      }
                      strokeWidth={point.isSelected ? 2 : point.isOutlier ? 1 : 0}
                      r={point.isSelected ? POINT_RADIUS.selected : point.isOutlier ? POINT_RADIUS.outlier : POINT_RADIUS.normal}
                    />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          )}

          {/* WebGL renderer */}
          {rendererType === 'webgl' && (
            <div className="absolute left-10 right-0 top-0 bottom-6">
              <ScatterPureWebGL2D
                points={webglProps.points}
                indices={webglProps.indices}
                colors={webglProps.colors}
                values={webglProps.values}
                useSelectionContext={useSelectionContext}
                pointSize={6}
                showGrid={false}
                showAxes={false}
                className="h-full w-full"
                clearOnBackgroundClick={selectionCtx?.selectionToolMode === 'click'}
                customBounds={webglBounds}
              />
            </div>
          )}

        </div>
      </SelectionContainer>

      {/* Footer */}
      {!compact && (
        <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span>
              {repetitionData.total_repetitions} measurements from {repetitionData.n_with_reps} samples
            </span>
            {repetitionData.n_singletons && repetitionData.n_singletons > 0 && (
              <span>({repetitionData.n_singletons} singletons hidden)</span>
            )}
            <span className="text-muted-foreground/50">
              Scroll to zoom • Right-drag to pan • Left-drag to select • Double-click to reset
            </span>
          </div>

          <div className="flex items-center gap-3">
            {statistics && (
              <span>
                Mean: {formatYValue(scaleType === 'log' ? Math.log1p(statistics.mean_distance) : statistics.mean_distance)} |
                Max: {formatYValue(scaleType === 'log' ? Math.log1p(statistics.max_distance) : statistics.max_distance)}
              </span>
            )}

            {selectedSamples.size > 0 && (
              <span className="text-primary font-medium">
                {selectedSamples.size} selected
              </span>
            )}
          </div>
        </div>
      )}

      {/* High variability warning */}
      {repetitionData.high_variability_samples &&
       repetitionData.high_variability_samples.length > 0 &&
       !compact && (
        <div className="flex items-center gap-1.5 mt-1 text-[10px] text-amber-600">
          <AlertTriangle className="w-3 h-3" />
          <span>
            {repetitionData.high_variability_samples.length} sample(s) with high variability
            {repetitionData.high_variability_samples.length <= 3 && (
              <span className="text-muted-foreground ml-1">
                ({repetitionData.high_variability_samples.map(s => s.bio_sample).join(', ')})
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

export default RepetitionsChart;

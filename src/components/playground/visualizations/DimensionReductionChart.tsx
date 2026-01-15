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
import { cn } from '@/lib/utils';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  ZAxis,
  Cell,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import {
  Orbit,
  Download,
  Layers,
  Box,
  Maximize2,
  Settings2,
  ChevronDown,
  Loader2,
  Monitor,
  Zap,
  Cpu,
  MousePointer2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip as TooltipUI,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { exportChart } from '@/lib/chartExport';
import {
  CHART_THEME,
  CHART_MARGINS,
  ANIMATION_CONFIG,
  formatPercentage,
  formatFoldLabel,
  formatYValue,
} from './chartConfig';
import {
  type GlobalColorConfig,
  type ColorContext,
  type ColorResult,
  getBaseColor as getUnifiedBaseColor,
  getUnifiedSampleColor,
  getWebGLSampleColor,
  getCategoricalColor,
  getContinuousColor,
  normalizeValue,
  PARTITION_COLORS,
  HIGHLIGHT_COLORS,
} from '@/lib/playground/colorConfig';
import { InlineColorLegend } from '../ColorLegend';
import type { PCAResult, FoldsInfo } from '@/types/playground';
import { useSelection } from '@/context/SelectionContext';
import {
  SelectionContainer,
  isPointInPolygon,
  isPointInBox,
  type SelectionToolType,
  type SelectionResult,
  type Point,
} from '../SelectionTools';

// Import ScatterPlot3D directly - it's a placeholder when Three.js isn't installed
import { ScatterPlot3D } from './ScatterPlot3D';

// Import optimized WebGL/Regl scatter renderers
import {
  ScatterPureWebGL2D,
  ScatterPureWebGL3D,
  ScatterRegl2D,
  ScatterRegl3D,
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

// ============= Types =============

export type DimensionReductionMethod = 'pca' | 'umap';
export type ViewMode = '2d' | '3d';
export type ColorMode = 'target' | 'fold' | 'metadata' | 'metric';

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
  /** Spectral metrics for coloring */
  spectralMetrics?: Record<string, number[]>;
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

interface DataPoint {
  x: number;
  y: number;
  z?: number;
  index: number;
  name: string;
  yValue?: number;
  foldLabel?: number;
  metadata?: Record<string, unknown>;
}

interface ChartConfig {
  method: DimensionReductionMethod;
  viewMode: ViewMode;
  xAxis: string;
  yAxis: string;
  zAxis: string;
  colorMode: ColorMode;
  metadataKey?: string;
  metricKey?: string;
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

// Helper to safely get a finite coordinate value (outside component to avoid re-renders)
function safeCoord(value: number | undefined): number {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return 0;
  }
  return value;
}

// ============= Component =============

export function DimensionReductionChart({
  pca,
  umap,
  y,
  folds,
  sampleIds,
  metadata,
  spectralMetrics,
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
  const selectedSamples = useSelectionContext && selectionCtx
    ? selectionCtx.selectedSamples
    : new Set<number>(
        externalSelectedSample !== null && externalSelectedSample !== undefined
          ? [externalSelectedSample]
          : []
      );

  const hoveredSample = selectionCtx?.hoveredSample ?? null;
  const pinnedSamples = selectionCtx?.pinnedSamples ?? new Set<number>();

  // Mouse position for tooltip (WebGL/Regl only - Recharts has its own tooltip)
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);

  // Get active result based on method (don't fall back to PCA when UMAP is selected)
  const activeResult = config.method === 'umap' ? umap : pca;
  // UMAP is available if it has coordinates with data and no error
  const hasUMAP = !!umap && !umap.error && Array.isArray(umap.coordinates) && umap.coordinates.length > 0;
  const hasPCA = !!pca && !pca.error && Array.isArray(pca.coordinates) && pca.coordinates.length > 0;

  // Calculate components needed for 99.9% variance (PCA only)
  const componentsFor999Variance = useMemo(() => {
    if (!pca?.explained_variance_ratio) {
      return pca?.n_components ?? 0;
    }

    let cumulative = 0;
    for (let i = 0; i < pca.explained_variance_ratio.length; i++) {
      cumulative += pca.explained_variance_ratio[i] ?? 0;
      if (cumulative >= 0.999) {
        return Math.min(i + 1, pca.explained_variance_ratio.length);
      }
    }
    return pca.explained_variance_ratio.length;
  }, [pca]);

  // Available dimensions - show all components up to 99.9% variance for PCA, or all components for UMAP
  const nComponents = config.method === 'pca'
    ? componentsFor999Variance
    : (umap?.n_components ?? 0);
  const dimensionOptions = useMemo(() => {
    const prefix = config.method === 'pca' ? 'PC' : 'UMAP';
    return Array.from({ length: nComponents }, (_, i) => ({
      value: `dim${i + 1}`,
      label: `${prefix}${i + 1}`,
      index: i,
    }));
  }, [config.method, nComponents]);

  // Variance explained (PCA only)
  const varianceExplained = useMemo(() => {
    if (config.method !== 'pca' || !pca?.explained_variance_ratio) {
      return {};
    }
    const result: Record<string, number> = {};
    pca.explained_variance_ratio.forEach((v, i) => {
      result[`dim${i + 1}`] = (v ?? 0) * 100;
    });
    return result;
  }, [config.method, pca]);

  // Build chart data - filter out points with NaN/Infinity coordinates
  const chartData = useMemo<DataPoint[]>(() => {
    if (!activeResult?.coordinates || activeResult.coordinates.length === 0) {
      return [];
    }

    const xIdx = parseInt(config.xAxis.replace('dim', ''), 10) - 1;
    const yIdx = parseInt(config.yAxis.replace('dim', ''), 10) - 1;
    const zIdx = parseInt(config.zAxis.replace('dim', ''), 10) - 1;

    const points: DataPoint[] = [];

    activeResult.coordinates.forEach((coords, i) => {
      const rawX = coords[xIdx];
      const rawY = coords[yIdx];
      const rawZ = coords[zIdx];

      // Skip points with NaN/Infinity in x or y coordinates (essential for 2D rendering)
      if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) {
        console.warn(`[DimensionReductionChart] Skipping point ${i} with invalid coordinates: x=${rawX}, y=${rawY}`);
        return;
      }

      const point: DataPoint = {
        x: rawX,
        y: rawY,
        z: safeCoord(rawZ),
        index: i,
        name: sampleIds?.[i] ?? `Sample ${i + 1}`,
        yValue: y?.[i] ?? pca?.y?.[i],
        foldLabel: folds?.fold_labels?.[i] ?? pca?.fold_labels?.[i],
      };

      // Include metadata for tooltips
      if (metadata) {
        point.metadata = {};
        for (const [key, values] of Object.entries(metadata)) {
          if (values && values[i] !== undefined) {
            point.metadata[key] = values[i];
          }
        }
      }

      points.push(point);
    });

    return points;
  }, [activeResult, config.xAxis, config.yAxis, config.zAxis, sampleIds, y, pca, folds, metadata]);

  // Phase 4: Get display filter for selected only / unselected only filtering
  const displayFilteredIndices = externalColorContext?.displayFilteredIndices;

  // Phase 4: Filter chart data for WebGL/Regl renderers based on display filter
  // The Recharts renderer handles this via opacity=0 in getUnifiedSampleColor,
  // but WebGL/Regl renderers need pre-filtered data
  const filteredChartData = useMemo<DataPoint[]>(() => {
    if (!displayFilteredIndices) return chartData;
    return chartData.filter(point => displayFilteredIndices.has(point.index));
  }, [chartData, displayFilteredIndices]);

  // Phase 6: Build reference dataset chart data - filter out NaN/Infinity coordinates
  const referenceChartData = useMemo<DataPoint[]>(() => {
    if (!referencePca?.coordinates || referencePca.coordinates.length === 0) {
      return [];
    }

    const xIdx = parseInt(config.xAxis.replace('dim', ''), 10) - 1;
    const yIdx = parseInt(config.yAxis.replace('dim', ''), 10) - 1;
    const zIdx = parseInt(config.zAxis.replace('dim', ''), 10) - 1;

    const points: DataPoint[] = [];

    referencePca.coordinates.forEach((coords, i) => {
      const rawX = coords[xIdx];
      const rawY = coords[yIdx];

      // Skip points with NaN/Infinity in x or y coordinates
      if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) {
        return;
      }

      points.push({
        x: rawX,
        y: rawY,
        z: safeCoord(coords[zIdx]),
        index: i,
        name: `${referenceLabel} ${i + 1}`,
        yValue: referencePca.y?.[i],
        foldLabel: referencePca.fold_labels?.[i],
      });
    });

    return points;
  }, [referencePca, config.xAxis, config.yAxis, config.zAxis, referenceLabel]);


  // Unique folds for legend
  const uniqueFolds = useMemo(() => {
    if (!folds?.fold_labels) return [];
    return [...new Set(folds.fold_labels.filter(f => f >= 0))].sort((a, b) => a - b);
  }, [folds]);

  // Pre-compute Y value range for efficient coloring
  const yRange = useMemo(() => {
    if (chartData.length === 0) return { min: 0, max: 1 };
    // Filter to only finite values to avoid NaN in color calculations
    const yValues = chartData
      .map(d => d.yValue ?? 0)
      .filter(Number.isFinite);
    if (yValues.length === 0) return { min: 0, max: 1 };
    return {
      min: Math.min(...yValues),
      max: Math.max(...yValues),
    };
  }, [chartData]);

  // Computed color context (build from props or use external)
  // NOTE: hoveredSample is intentionally NOT included to avoid expensive re-renders on hover
  // Hover highlighting is handled directly in the Cell render
  const computedColorContext = useMemo<ColorContext>(() => {
    if (externalColorContext) return externalColorContext;

    // Build train/test indices from first fold for partition mode
    // Use first fold only to ensure disjoint sets (K-fold has overlapping samples)
    let trainIndices: Set<number> | undefined;
    let testIndices: Set<number> | undefined;
    if (folds?.folds && folds.folds.length > 0) {
      const firstFold = folds.folds[0];
      trainIndices = new Set<number>(firstFold.train_indices ?? []);
      testIndices = new Set<number>(firstFold.test_indices ?? []);
    }

    return {
      y,
      yMin: yRange.min,
      yMax: yRange.max,
      trainIndices,
      testIndices,
      foldLabels: folds?.fold_labels ?? pca?.fold_labels,
      metadata,
      selectedSamples,
      pinnedSamples,
      // hoveredSample excluded - handled directly in Cell render for performance
    };
  }, [externalColorContext, y, yRange, folds, pca, metadata, selectedSamples, pinnedSamples]);

  // Get point color for WebGL/canvas renderers - returns only parseable HSL colors (no CSS variables)
  // Uses getWebGLSampleColor which handles selection/outlier modes with concrete colors
  const getPointColor = useCallback((point: DataPoint) => {
    // Use unified color system if globalColorConfig is provided
    if (globalColorConfig) {
      return getWebGLSampleColor(point.index, globalColorConfig, computedColorContext);
    }

    // Legacy color logic (fallback when no globalColorConfig provided)
    switch (config.colorMode) {
      case 'fold':
        if (point.foldLabel !== undefined && point.foldLabel >= 0) {
          return getCategoricalColor(point.foldLabel, 'default');
        }
        return 'hsl(220, 10%, 50%)'; // Muted gray fallback

      case 'metadata':
        if (config.metadataKey && point.metadata?.[config.metadataKey] !== undefined) {
          // Simple categorical coloring using global palette
          const value = point.metadata[config.metadataKey];
          const hash = String(value).split('').reduce((a, b) => {
            a = ((a << 5) - a) + b.charCodeAt(0);
            return a & a;
          }, 0);
          return getCategoricalColor(Math.abs(hash), 'default');
        }
        return 'hsl(239, 84%, 67%)'; // Primary-like indigo

      case 'metric':
        // TODO: Implement metric-based coloring when spectralMetrics is available
        return 'hsl(239, 84%, 67%)'; // Primary-like indigo

      case 'target':
      default:
        if (point.yValue !== undefined && chartData.length > 0) {
          const t = (point.yValue - yRange.min) / (yRange.max - yRange.min + 0.001);
          return getContinuousColor(t, 'blue_red');
        }
        return 'hsl(239, 84%, 67%)'; // Primary-like indigo
    }
  }, [globalColorConfig, computedColorContext, config.colorMode, config.metadataKey, chartData, yRange]);

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

    const point = data as { index?: number; payload?: DataPoint };
    const idx = point?.payload?.index ?? point?.index;
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
    const point = data as { index?: number; payload?: DataPoint };
    const idx = point?.payload?.index ?? point?.index;
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
    const points: [number, number][] = new Array(filteredChartData.length);
    const indices: number[] = new Array(filteredChartData.length);
    const colors: string[] = new Array(filteredChartData.length);
    const values: number[] = new Array(filteredChartData.length);

    for (let i = 0; i < filteredChartData.length; i++) {
      const d = filteredChartData[i];
      points[i] = [d.x, d.y];
      indices[i] = d.index;
      colors[i] = getPointColor(d);
      values[i] = d.yValue ?? 0;
    }

    return { points, indices, colors, values };
  }, [filteredChartData, getPointColor]);

  // Pre-computed WebGL arrays for 3D renderers (ScatterWebGL3D, ScatterRegl3D)
  const webgl3DProps = useMemo(() => {
    const points: [number, number, number][] = new Array(filteredChartData.length);
    const indices: number[] = new Array(filteredChartData.length);
    const colors: string[] = new Array(filteredChartData.length);
    const values: number[] = new Array(filteredChartData.length);

    for (let i = 0; i < filteredChartData.length; i++) {
      const d = filteredChartData[i];
      points[i] = [d.x, d.y, d.z ?? 0];
      indices[i] = d.index;
      colors[i] = getPointColor3D(d);
      values[i] = d.yValue ?? 0;
    }

    return { points, indices, colors, values };
  }, [filteredChartData, getPointColor3D]);

  // Calculate view bounds for WebGL/Regl renderers (matches their internal calculation)
  // Phase 4: Use filteredChartData to match what's actually rendered
  // IMPORTANT: Must match the exact bounds calculation used by ScatterRegl2D/ScatterPureWebGL2D
  const calculateViewBounds = useCallback((containerWidth: number, containerHeight: number) => {
    // Calculate data bounds with padding (same as WebGL/Regl renderers)
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (const d of filteredChartData) {
      if (Number.isFinite(d.x) && Number.isFinite(d.y)) {
        minX = Math.min(minX, d.x);
        maxX = Math.max(maxX, d.x);
        minY = Math.min(minY, d.y);
        maxY = Math.max(maxY, d.y);
      }
    }

    const padX = (maxX - minX) * 0.05 || 0.1;
    const padY = (maxY - minY) * 0.05 || 0.1;
    minX -= padX;
    maxX += padX;
    minY -= padY;
    maxY += padY;

    let left = minX, right = maxX;
    let bottom = minY, top = maxY;

    // Only apply aspect ratio adjustment when preserveAspectRatio is enabled
    // This must match the WebGL/Regl renderer behavior exactly
    if (config.preserveAspectRatio) {
      const aspect = containerWidth / containerHeight;
      const dataW = maxX - minX;
      const dataH = maxY - minY;
      const dataAspect = dataW / dataH;

      if (dataAspect > aspect) {
        const newH = dataW / aspect;
        const pad = (newH - dataH) / 2;
        bottom -= pad;
        top += pad;
      } else {
        const newW = dataH * aspect;
        const pad = (newW - dataW) / 2;
        left -= pad;
        right += pad;
      }
    }
    // When preserveAspectRatio is false, the data stretches to fill the container
    // (no aspect ratio adjustment needed - left/right/bottom/top already match data bounds)

    return { left, right, bottom, top };
  }, [filteredChartData, config.preserveAspectRatio]);

  // Convert screen coordinates to data coordinates for WebGL/Regl
  const screenToData = useCallback((screenX: number, screenY: number, containerWidth: number, containerHeight: number) => {
    const { left, right, bottom, top } = calculateViewBounds(containerWidth, containerHeight);

    // Screen coordinates are 0,0 at top-left, Y increases downward
    // Data coordinates have Y increasing upward
    const dataX = left + (screenX / containerWidth) * (right - left);
    const dataY = top - (screenY / containerHeight) * (top - bottom);

    return { x: dataX, y: dataY };
  }, [calculateViewBounds]);

  // Handle box/lasso selection for WebGL/Regl renderers
  // Phase 2: Uses unified selection handlers, Phase 4: Uses filteredChartData
  const handleSelectionCompleteWebGL = useCallback((result: SelectionResult, modifiers: { shift: boolean; ctrl: boolean }) => {
    if (!selectionCtx || !chartContainerRef.current) return;

    const container = chartContainerRef.current;
    const containerRect = container.getBoundingClientRect();
    const containerWidth = containerRect.width;
    const containerHeight = containerRect.height;

    const selectedIndices: number[] = [];

    if ('path' in result) {
      // Lasso selection - convert screen path to data coordinates and check points
      const dataPath = result.path.map(p => screenToData(p.x, p.y, containerWidth, containerHeight));

      for (const point of filteredChartData) {
        if (isPointInPolygon({ x: point.x, y: point.y }, dataPath)) {
          selectedIndices.push(point.index);
        }
      }
    } else {
      // Box selection
      const startData = screenToData(result.start.x, result.start.y, containerWidth, containerHeight);
      const endData = screenToData(result.end.x, result.end.y, containerWidth, containerHeight);

      const dataBounds = {
        minX: Math.min(startData.x, endData.x),
        maxX: Math.max(startData.x, endData.x),
        minY: Math.min(startData.y, endData.y),
        maxY: Math.max(startData.y, endData.y),
      };

      for (const point of filteredChartData) {
        if (isPointInBox({ x: point.x, y: point.y }, dataBounds)) {
          selectedIndices.push(point.index);
        }
      }
    }

    if (selectedIndices.length === 0) return;

    // Use area selection handler (doesn't clear when re-selecting same points)
    const action = computeAreaSelectionAction(
      { indices: selectedIndices },
      selectionCtx.selectedSamples,
      modifiers
    );
    executeSelectionAction(selectionCtx, action);
  }, [selectionCtx, filteredChartData, screenToData]);

  // Handle box/lasso selection for 3D WebGL/Regl renderers
  // Phase 2: Uses unified selection handlers
  const handleSelectionComplete3D = useCallback((result: SelectionResult, modifiers: { shift: boolean; ctrl: boolean }) => {
    if (!selectionCtx || !scatter3DRef.current) return;

    let selectedIndices: number[] = [];

    if ('path' in result) {
      // Lasso selection - approximate with bounding box
      // For proper lasso selection, we'd need polygon intersection testing on GPU
      const xs = result.path.map(p => p.x);
      const ys = result.path.map(p => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      selectedIndices = scatter3DRef.current.getPointsInScreenRect(minX, minY, maxX, maxY);
    } else {
      // Box selection
      selectedIndices = scatter3DRef.current.getPointsInScreenRect(
        result.start.x, result.start.y,
        result.end.x, result.end.y
      );
    }

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

    const container = chartContainerRef.current;
    const containerRect = container.getBoundingClientRect();

    // Find all scatter symbols - try multiple selectors
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

    // Build a map of screen positions to data indices using getBoundingClientRect
    // This is more reliable than parsing SVG attributes
    const pointScreenPositions: Array<{ screenX: number; screenY: number; dataIndex: number }> = [];

    scatterSymbols.forEach((symbol, idx) => {
      // Only process symbols that correspond to our data (skip reference dataset symbols)
      if (idx < chartData.length) {
        const rect = symbol.getBoundingClientRect();
        // Get the center of the symbol
        const centerX = rect.left + rect.width / 2 - containerRect.left;
        const centerY = rect.top + rect.height / 2 - containerRect.top;

        if (Number.isFinite(centerX) && Number.isFinite(centerY) && rect.width > 0) {
          pointScreenPositions.push({
            screenX: centerX,
            screenY: centerY,
            dataIndex: chartData[idx].index,
          });
        }
      }
    });

    // Find points inside the selection using their screen coordinates
    const selectedIndices: number[] = [];

    if ('path' in result) {
      // Lasso selection - check if each point's screen position is inside the lasso path
      const screenPath = result.path;

      if (screenPath.length < 3) {
        return;
      }

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

  // Export handler
  const handleExport = useCallback(() => {
    const exportData = chartData.map(d => {
      const row: Record<string, string | number> = {
        sample: d.name,
        [config.xAxis]: d.x,
        [config.yAxis]: d.y,
      };
      if (d.z !== undefined) row[config.zAxis] = d.z;
      if (d.yValue !== undefined) row.y_value = d.yValue;
      if (d.foldLabel !== undefined && d.foldLabel >= 0) {
        row.fold = formatFoldLabel(d.foldLabel);
      }
      return row;
    });
    const methodName = config.method === 'pca' ? 'pca_scores' : 'umap_embedding';
    exportChart(chartRef.current, exportData, methodName);
  }, [chartData, config.method, config.xAxis, config.yAxis, config.zAxis]);

  // Update config
  const updateConfig = useCallback((updates: Partial<ChartConfig>) => {
    setConfig(prev => ({ ...prev, ...updates }));
  }, []);

  // Get axis label with variance
  const getAxisLabel = (axis: string) => {
    const prefix = config.method === 'pca' ? 'PC' : 'UMAP';
    const num = axis.replace('dim', '');
    const variance = varianceExplained[axis];
    if (variance !== undefined) {
      return `${prefix}${num} (${formatPercentage(variance)})`;
    }
    return `${prefix}${num}`;
  };

  // Metadata keys for coloring
  const metadataKeys = useMemo(() => {
    if (!metadata) return [];
    return Object.keys(metadata);
  }, [metadata]);

  // Error state
  if (activeResult?.error) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        <div className="text-center">
          <Orbit className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
          <p>{config.method.toUpperCase()} Error</p>
          <p className="text-xs mt-1">{activeResult.error}</p>
        </div>
      </div>
    );
  }

  // Empty state
  if (!activeResult || chartData.length < 3) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        <div className="text-center">
          <Orbit className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
          <p>Need at least 3 samples for {config.method.toUpperCase()}</p>
          {config.method === 'umap' && !hasUMAP && onRequestUMAP && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={onRequestUMAP}
              disabled={isUMAPLoading}
            >
              {isUMAPLoading ? (
                <>
                  <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                  Computing UMAP...
                </>
              ) : (
                'Compute UMAP'
              )}
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Point size based on config
  const sizes = POINT_SIZES[config.pointSize];

  // Render settings dropdown
  const renderSettingsDropdown = () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2">
          <Settings2 className="w-3 h-3" />
          <ChevronDown className="w-3 h-3 ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {/* Point Size */}
        <DropdownMenuLabel className="text-xs text-muted-foreground">Point Size</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={config.pointSize}
          onValueChange={(v) => updateConfig({ pointSize: v as 'small' | 'medium' | 'large' })}
        >
          <DropdownMenuRadioItem value="small">Small</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="medium">Medium</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="large">Large</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />

        {/* Display toggles */}
        <DropdownMenuCheckboxItem
          checked={config.showGrid}
          onCheckedChange={(checked) => updateConfig({ showGrid: checked })}
        >
          Show Grid
        </DropdownMenuCheckboxItem>

        {/* Aspect ratio option for WebGL/Regl in 2D */}
        {rendererType !== 'recharts' && config.viewMode === '2d' && (
          <DropdownMenuCheckboxItem
            checked={config.preserveAspectRatio}
            onCheckedChange={(checked) => updateConfig({ preserveAspectRatio: checked })}
          >
            Equal Axis Scale
          </DropdownMenuCheckboxItem>
        )}

        {/* Color options when no global config */}
        {!globalColorConfig && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">Color By</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={config.colorMode}
              onValueChange={(v) => updateConfig({ colorMode: v as ColorMode })}
            >
              <DropdownMenuRadioItem value="target">Y Value</DropdownMenuRadioItem>
              {uniqueFolds.length > 0 && (
                <DropdownMenuRadioItem value="fold">Fold</DropdownMenuRadioItem>
              )}
              {metadataKeys.length > 0 && (
                <DropdownMenuRadioItem value="metadata">Metadata</DropdownMenuRadioItem>
              )}
            </DropdownMenuRadioGroup>

            {config.colorMode === 'metadata' && metadataKeys.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-muted-foreground">Field</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={config.metadataKey || metadataKeys[0]}
                  onValueChange={(v) => updateConfig({ metadataKey: v })}
                >
                  {metadataKeys.slice(0, 10).map(key => (
                    <DropdownMenuRadioItem key={key} value={key}>
                      {key}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // Render 3D view
  const render3DView = () => (
    <ScatterPlot3D
      data={chartData}
      xLabel={getAxisLabel(config.xAxis)}
      yLabel={getAxisLabel(config.yAxis)}
      zLabel={getAxisLabel(config.zAxis)}
      getColor={getPointColor3D}
      selectedSamples={selectedSamples}
      hoveredSample={hoveredSample}
      onSelect={(data: DataPoint, event?: MouseEvent) => {
        // Create a minimal synthetic React MouseEvent for compatibility
        const syntheticEvent = {
          shiftKey: event?.shiftKey ?? false,
          ctrlKey: event?.ctrlKey ?? false,
          metaKey: event?.metaKey ?? false,
        } as React.MouseEvent;
        handleClick({ payload: data }, 0, syntheticEvent);
      }}
      onHover={(idx: number | null) => selectionCtx?.setHovered(idx)}
    />
  );

  // Render 2D view
  const render2DView = () => (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={CHART_MARGINS.pca}>
        {config.showGrid && (
          <CartesianGrid
            strokeDasharray={CHART_THEME.gridDasharray}
            stroke={CHART_THEME.gridStroke}
            opacity={CHART_THEME.gridOpacity}
          />
        )}

        <XAxis
          dataKey="x"
          type="number"
          stroke={CHART_THEME.axisStroke}
          fontSize={CHART_THEME.axisFontSize}
          name={config.xAxis}
          label={{
            value: getAxisLabel(config.xAxis),
            position: 'bottom',
            offset: -5,
            fontSize: CHART_THEME.axisLabelFontSize,
          }}
        />

        <YAxis
          dataKey="y"
          type="number"
          stroke={CHART_THEME.axisStroke}
          fontSize={CHART_THEME.axisFontSize}
          width={45}
          name={config.yAxis}
          label={{
            value: getAxisLabel(config.yAxis),
            angle: -90,
            position: 'insideLeft',
            fontSize: CHART_THEME.axisLabelFontSize,
          }}
        />

        <ZAxis range={[sizes.base, sizes.base]} />

        {config.showCrosshairs && (
          <>
            <ReferenceLine x={0} stroke="hsl(220, 10%, 50%)" strokeOpacity={0.5} />
            <ReferenceLine y={0} stroke="hsl(220, 10%, 50%)" strokeOpacity={0.5} />
          </>
        )}

        <Tooltip
          isAnimationActive={false}
          cursor={config.enableHover ? { stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1, strokeDasharray: '4 2' } : false}
          contentStyle={{
            backgroundColor: CHART_THEME.tooltipBg,
            border: `1px solid ${CHART_THEME.tooltipBorder}`,
            borderRadius: CHART_THEME.tooltipBorderRadius,
            fontSize: CHART_THEME.tooltipFontSize,
          }}
          content={({ payload }) => {
            if (!config.enableHover) return null;
            if (!payload || payload.length === 0) return null;
            const data = payload[0]?.payload as DataPoint | undefined;
            if (!data) return null;

            return (
              <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-xs max-w-xs">
                <p className="font-medium mb-1">{data.name}</p>
                <div className="space-y-0.5 text-muted-foreground">
                  <p>{getAxisLabel(config.xAxis)}: {data.x.toFixed(3)}</p>
                  <p>{getAxisLabel(config.yAxis)}: {data.y.toFixed(3)}</p>
                  {data.yValue !== undefined && (
                    <p>Y: {formatYValue(data.yValue, 2)}</p>
                  )}
                  {data.foldLabel !== undefined && data.foldLabel >= 0 && (
                    <p>{formatFoldLabel(data.foldLabel)}</p>
                  )}
                  {data.metadata && Object.keys(data.metadata).length > 0 && (
                    <div className="mt-1 pt-1 border-t border-border">
                      {Object.entries(data.metadata).slice(0, 5).map(([key, value]) => (
                        <p key={key} className="truncate">
                          {key}: {String(value)}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          }}
        />

        <Scatter
          data={chartData}
          fill="#6366f1"
          onClick={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          cursor="pointer"
          {...ANIMATION_CONFIG}
        >
          {chartData.map((entry) => {
            // Use unified color system when globalColorConfig is provided
            if (globalColorConfig) {
              // Pass hoveredSample directly to colorContext to avoid full re-render
              // but still get correct hover styling
              const contextWithHover = { ...computedColorContext, hoveredSample };
              const colorResult = getUnifiedSampleColor(entry.index, globalColorConfig, contextWithHover);
              // Phase 4: Skip hidden samples (from display filtering)
              if (colorResult.hidden) {
                return <Cell key={`cell-${entry.index}`} fill="transparent" fillOpacity={0} />;
              }
              return (
                <Cell
                  key={`cell-${entry.index}`}
                  fill={colorResult.color}
                  fillOpacity={colorResult.opacity}
                  stroke={colorResult.stroke}
                  strokeWidth={colorResult.strokeWidth ?? 0}
                />
              );
            }

            // Legacy color logic
            const isSelected = selectedSamples.has(entry.index);
            const isHovered = hoveredSample === entry.index;
            const isPinned = pinnedSamples.has(entry.index);
            const highlighted = isSelected || isHovered || isPinned;
            const pointColor = getPointColor(entry);

            return (
              <Cell
                key={`cell-${entry.index}`}
                fill={pointColor}
                stroke={highlighted ? 'hsl(var(--foreground))' : undefined}
                strokeWidth={highlighted ? 2 : 0}
              />
            );
          })}
        </Scatter>

        {/* Phase 6: Reference dataset scatter points */}
        {referenceChartData.length > 0 && (
          <Scatter
            data={referenceChartData}
            fill={CHART_THEME.referenceLineColor}
            shape="diamond"
            {...ANIMATION_CONFIG}
          >
            {referenceChartData.map((entry) => (
              <Cell
                key={`ref-cell-${entry.index}`}
                fill={CHART_THEME.referenceLineColor}
                fillOpacity={CHART_THEME.referenceLineOpacity}
              />
            ))}
          </Scatter>
        )}
      </ScatterChart>
    </ResponsiveContainer>
  );

  return (
    <div className="h-full flex flex-col" ref={chartRef}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Orbit className="w-4 h-4 text-primary" />
          {config.method.toUpperCase()}
          {config.viewMode === '3d' && (
            <Badge variant="outline" className="text-[10px] h-4 px-1">3D</Badge>
          )}
        </h3>

        <div className="flex items-center gap-1.5">
          {/* Method selector */}
          <Select
            value={config.method}
            onValueChange={(v) => {
              updateConfig({ method: v as DimensionReductionMethod });
              // Reset axes for new method
              updateConfig({ xAxis: 'dim1', yAxis: 'dim2', zAxis: 'dim3' });
            }}
          >
            <SelectTrigger className="h-7 w-[70px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pca" disabled={!hasPCA}>PCA</SelectItem>
              <SelectItem value="umap" disabled={config.viewMode === '3d'}>UMAP</SelectItem>
            </SelectContent>
          </Select>

          {/* Axis selectors */}
          {nComponents >= 2 && (
            <>
              <Select value={config.xAxis} onValueChange={(v) => updateConfig({ xAxis: v })}>
                <SelectTrigger className="h-7 w-16 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {dimensionOptions.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <span className="text-xs text-muted-foreground">vs</span>

              <Select value={config.yAxis} onValueChange={(v) => updateConfig({ yAxis: v })}>
                <SelectTrigger className="h-7 w-16 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {dimensionOptions.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Z axis selector for 3D mode */}
              {config.viewMode === '3d' && nComponents >= 3 && (
                <>
                  <span className="text-xs text-muted-foreground">vs</span>
                  <Select value={config.zAxis} onValueChange={(v) => updateConfig({ zAxis: v })}>
                    <SelectTrigger className="h-7 w-16 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {dimensionOptions.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}
            </>
          )}

          {/* 3D toggle */}
          {nComponents >= 3 && (
            <TooltipProvider delayDuration={200}>
              <TooltipUI>
                <TooltipTrigger asChild>
                  <Button
                    variant={config.viewMode === '3d' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => {
                      const newViewMode = config.viewMode === '3d' ? '2d' : '3d';
                      // Switch to PCA when entering 3D mode if UMAP is selected (UMAP not supported in 3D)
                      if (newViewMode === '3d' && config.method === 'umap') {
                        updateConfig({ viewMode: newViewMode, method: 'pca', xAxis: 'dim1', yAxis: 'dim2', zAxis: 'dim3' });
                      } else {
                        updateConfig({ viewMode: newViewMode });
                      }
                    }}
                  >
                    <Box className="w-3 h-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-xs">{config.viewMode === '3d' ? '2D View' : '3D View'}</p>
                </TooltipContent>
              </TooltipUI>
            </TooltipProvider>
          )}

          {/* Renderer toggle (SVG/WebGL/Regl) */}
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
                    className="h-7 w-7 p-0"
                    onClick={() => setRendererType('webgl')}
                  >
                    <Zap className={`w-3.5 h-3.5 ${rendererType === 'webgl' ? 'text-yellow-500' : ''}`} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-xs">Pure WebGL (GPU accelerated)</p>
                </TooltipContent>
              </TooltipUI>

              <TooltipUI>
                <TooltipTrigger asChild>
                  <Button
                    variant={rendererType === 'regl' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-7 w-7 p-0 rounded-l-none border-l"
                    onClick={() => setRendererType('regl')}
                  >
                    <Cpu className={`w-3.5 h-3.5 ${rendererType === 'regl' ? 'text-yellow-500' : ''}`} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-xs">Regl renderer (GPU accelerated)</p>
                </TooltipContent>
              </TooltipUI>
            </div>
          </TooltipProvider>

          {/* Hover toggle */}
          <TooltipProvider delayDuration={200}>
            <TooltipUI>
              <TooltipTrigger asChild>
                <Button
                  variant={config.enableHover ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => updateConfig({ enableHover: !config.enableHover })}
                >
                  <MousePointer2 className={cn("w-3.5 h-3.5", config.enableHover && "text-primary")} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">{config.enableHover ? 'Hover enabled' : 'Hover disabled'}</p>
              </TooltipContent>
            </TooltipUI>
          </TooltipProvider>

          {/* Settings */}
          {renderSettingsDropdown()}

          {/* Export */}
          <TooltipProvider delayDuration={200}>
            <TooltipUI>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 px-2" onClick={handleExport}>
                  <Download className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">Export chart</p>
              </TooltipContent>
            </TooltipUI>
          </TooltipProvider>
        </div>
      </div>

      {/* Chart - wrap 2D view with SelectionContainer for box/lasso selection */}
      <div
        ref={chartContainerRef}
        className={cn(
          "flex-1 min-h-[200px] max-h-full relative",
          // Only force square aspect for SVG/Recharts renderer
          // WebGL/Regl handle aspect ratio internally and should use all available space
          rendererType === 'recharts' && "aspect-square"
        )}
        onMouseMove={rendererType !== 'recharts' ? (e) => {
          const rect = chartContainerRef.current?.getBoundingClientRect();
          if (rect) {
            setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
          }
        } : undefined}
        onMouseLeave={rendererType !== 'recharts' ? () => setMousePos(null) : undefined}
      >
        {/* WebGL indicator badge - positioned left to avoid overlapping reset button in 3D */}
        {rendererType !== 'recharts' && (
          <div className="absolute top-2 left-2 z-10 flex items-center gap-1 px-2 py-0.5 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded text-[10px] font-medium">
            <Zap className="w-3 h-3" />
            {rendererType === 'webgl' ? 'WebGL' : 'Regl'}
          </div>
        )}

        {/* Tooltip for WebGL/Regl renderers */}
        {rendererType !== 'recharts' && config.enableHover && hoveredSample !== null && mousePos && (() => {
          const data = chartData.find(d => d.index === hoveredSample);
          if (!data) return null;
          return (
            <div
              className="absolute z-20 pointer-events-none bg-card border border-border rounded-lg p-2 shadow-lg text-xs max-w-xs"
              style={{
                left: mousePos.x + 12,
                top: mousePos.y + 12,
                transform: mousePos.x > (chartContainerRef.current?.clientWidth ?? 0) / 2 ? 'translateX(-100%)' : undefined,
              }}
            >
              <p className="font-medium mb-1">{data.name}</p>
              <div className="space-y-0.5 text-muted-foreground">
                <p>{getAxisLabel(config.xAxis)}: {data.x.toFixed(3)}</p>
                <p>{getAxisLabel(config.yAxis)}: {data.y.toFixed(3)}</p>
                {config.viewMode === '3d' && data.z !== undefined && (
                  <p>{getAxisLabel(config.zAxis)}: {data.z.toFixed(3)}</p>
                )}
                {data.yValue !== undefined && (
                  <p>Y: {formatYValue(data.yValue, 2)}</p>
                )}
                {data.foldLabel !== undefined && data.foldLabel >= 0 && (
                  <p>{formatFoldLabel(data.foldLabel)}</p>
                )}
                {data.metadata && Object.keys(data.metadata).length > 0 && (
                  <div className="mt-1 pt-1 border-t border-border">
                    {Object.entries(data.metadata).slice(0, 5).map(([key, value]) => (
                      <p key={key} className="truncate">
                        {key}: {String(value)}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {config.viewMode === '3d' ? (
          // 3D View - wrap with SelectionContainer for box/lasso selection
          rendererType === 'recharts' ? (
            <SelectionContainer
              mode={selectionTool}
              enabled={selectionTool !== 'click'}
              onSelectionComplete={handleSelectionComplete}
              onPointClick={() => {}}
              onBackgroundClick={handleBackgroundClick}
              className="h-full w-full"
            >
              {render3DView()}
            </SelectionContainer>
          ) : rendererType === 'webgl' ? (
            <SelectionContainer
              mode={selectionTool}
              enabled={selectionTool !== 'click'}
              onSelectionComplete={handleSelectionComplete3D}
              onPointClick={() => {}}
              onBackgroundClick={handleBackgroundClick}
              className="h-full w-full"
            >
              <ScatterPureWebGL3D
                ref={scatter3DRef}
                points={webgl3DProps.points}
                indices={webgl3DProps.indices}
                colors={webgl3DProps.colors}
                values={webgl3DProps.values}
                useSelectionContext={useSelectionContext}
                pointSize={sizes.base / 5}
                showGrid={config.showGrid}
                showAxes={true}
                xLabel={getAxisLabel(config.xAxis)}
                yLabel={getAxisLabel(config.yAxis)}
                zLabel={getAxisLabel(config.zAxis)}
                className="h-full w-full"
                clearOnBackgroundClick={selectionTool === 'click'}
              />
            </SelectionContainer>
          ) : (
            <SelectionContainer
              mode={selectionTool}
              enabled={selectionTool !== 'click'}
              onSelectionComplete={handleSelectionComplete3D}
              onPointClick={() => {}}
              onBackgroundClick={handleBackgroundClick}
              className="h-full w-full"
            >
              <ScatterRegl3D
                ref={scatter3DRef}
                points={webgl3DProps.points}
                indices={webgl3DProps.indices}
                colors={webgl3DProps.colors}
                values={webgl3DProps.values}
                useSelectionContext={useSelectionContext}
                pointSize={sizes.base / 5}
                showGrid={config.showGrid}
                showAxes={true}
                xLabel={getAxisLabel(config.xAxis)}
                yLabel={getAxisLabel(config.yAxis)}
                zLabel={getAxisLabel(config.zAxis)}
                className="h-full w-full"
                clearOnBackgroundClick={selectionTool === 'click'}
              />
            </SelectionContainer>
          )
        ) : (
          // 2D View
          rendererType === 'recharts' ? (
            <SelectionContainer
              mode={selectionTool}
              enabled={selectionTool !== 'click'}
              onSelectionComplete={handleSelectionComplete}
              onPointClick={() => {}} // Point clicks handled by Recharts onClick
              onBackgroundClick={handleBackgroundClick}
              className="h-full w-full"
            >
              <div onClick={handleChartClick} className="h-full w-full">
                {render2DView()}
              </div>
            </SelectionContainer>
          ) : rendererType === 'webgl' ? (
            <SelectionContainer
              mode={selectionTool}
              enabled={selectionTool !== 'click'}
              onSelectionComplete={handleSelectionCompleteWebGL}
              onPointClick={() => {}} // Point clicks handled by WebGL onClick
              onBackgroundClick={handleBackgroundClick}
              className="h-full w-full"
            >
              <ScatterPureWebGL2D
                points={webgl2DProps.points}
                indices={webgl2DProps.indices}
                colors={webgl2DProps.colors}
                values={webgl2DProps.values}
                useSelectionContext={useSelectionContext}
                pointSize={sizes.base / 5}
                showGrid={config.showGrid}
                showAxes={true}
                xLabel={getAxisLabel(config.xAxis)}
                yLabel={getAxisLabel(config.yAxis)}
                className="h-full w-full"
                clearOnBackgroundClick={selectionTool === 'click'}
                preserveAspectRatio={config.preserveAspectRatio}
              />
            </SelectionContainer>
          ) : (
            <SelectionContainer
              mode={selectionTool}
              enabled={selectionTool !== 'click'}
              onSelectionComplete={handleSelectionCompleteWebGL}
              onPointClick={() => {}} // Point clicks handled by Regl onClick
              onBackgroundClick={handleBackgroundClick}
              className="h-full w-full"
            >
              <ScatterRegl2D
                points={webgl2DProps.points}
                indices={webgl2DProps.indices}
                colors={webgl2DProps.colors}
                values={webgl2DProps.values}
                useSelectionContext={useSelectionContext}
                pointSize={sizes.base / 5}
                showGrid={config.showGrid}
                showAxes={true}
                xLabel={getAxisLabel(config.xAxis)}
                yLabel={getAxisLabel(config.yAxis)}
                className="h-full w-full"
                clearOnBackgroundClick={selectionTool === 'click'}
                preserveAspectRatio={config.preserveAspectRatio}
              />
            </SelectionContainer>
          )
        )}
      </div>

      {/* Footer */}
      {!compact && (
        <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-2">
            {config.method === 'pca' && varianceExplained[config.xAxis] !== undefined && (
              <span>
                Var: {getAxisLabel(config.xAxis)}, {getAxisLabel(config.yAxis)}
              </span>
            )}
            {selectedSamples.size > 0 && (
              <span className="text-primary font-medium">
                • {selectedSamples.size} selected
              </span>
            )}
            {/* Color legend */}
            {globalColorConfig && externalColorContext && (
              <InlineColorLegend config={globalColorConfig} context={externalColorContext} />
            )}
          </div>

          {/* Phase 6: Reference dataset legend */}
          {referenceChartData.length > 0 && (
            <div className="flex items-center gap-1.5 ml-2 pl-2 border-l border-border/50">
              <span
                className="w-2 h-2"
                style={{
                  backgroundColor: CHART_THEME.referenceLineColor,
                  clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
                }}
              />
              <span>{referenceLabel}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default React.memo(DimensionReductionChart);

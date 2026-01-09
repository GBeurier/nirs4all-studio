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
  getFoldColor,
  formatPercentage,
  formatFoldLabel,
  formatYValue,
  FOLD_COLORS,
} from './chartConfig';
import {
  type GlobalColorConfig,
  type ColorContext,
  type ColorResult,
  getBaseColor as getUnifiedBaseColor,
  getUnifiedSampleColor,
  getCategoricalColor,
  getContinuousColor,
  normalizeValue,
  PARTITION_COLORS,
  HIGHLIGHT_COLORS,
} from '@/lib/playground/colorConfig';
import type { PCAResult, FoldsInfo } from '@/types/playground';
import { useSelection } from '@/context/SelectionContext';
import {
  SelectionContainer,
  SelectionModeToggle,
  isPointInPolygon,
  isPointInBox,
  type SelectionToolType,
  type SelectionResult,
  type Point,
} from '../SelectionTools';

// Import ScatterPlot3D directly - it's a placeholder when Three.js isn't installed
import { ScatterPlot3D } from './ScatterPlot3D';

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
  showCrosshairs: boolean;
  pointSize: 'small' | 'medium' | 'large';
  showLabels: boolean;
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
  showCrosshairs: false,
  pointSize: 'medium',
  showLabels: false,
};

const POINT_SIZES = {
  small: { base: 30, selected: 50, hovered: 60 },
  medium: { base: 50, selected: 80, hovered: 100 },
  large: { base: 80, selected: 120, hovered: 150 },
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
  const [config, setConfig] = useState<ChartConfig>(DEFAULT_CONFIG);

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

    return {
      y,
      yMin: yRange.min,
      yMax: yRange.max,
      foldLabels: folds?.fold_labels ?? pca?.fold_labels,
      metadata,
      selectedSamples,
      pinnedSamples,
      // hoveredSample excluded - handled directly in Cell render for performance
    };
  }, [externalColorContext, y, yRange, folds, pca, metadata, selectedSamples, pinnedSamples]);

  // Get point color - returns CSS-compatible colors (concrete HSL, no variables)
  const getPointColor = useCallback((point: DataPoint) => {
    // Use unified color system if globalColorConfig is provided
    if (globalColorConfig) {
      return getUnifiedBaseColor(point.index, globalColorConfig, computedColorContext);
    }

    // Legacy color logic
    switch (config.colorMode) {
      case 'fold':
        if (point.foldLabel !== undefined && point.foldLabel >= 0) {
          return getFoldColor(point.foldLabel);
        }
        return 'hsl(220, 10%, 50%)'; // Muted gray fallback

      case 'metadata':
        if (config.metadataKey && point.metadata?.[config.metadataKey] !== undefined) {
          // Simple categorical coloring
          const value = point.metadata[config.metadataKey];
          const hash = String(value).split('').reduce((a, b) => {
            a = ((a << 5) - a) + b.charCodeAt(0);
            return a & a;
          }, 0);
          return `hsl(${Math.abs(hash) % 360}, 70%, 50%)`;
        }
        return 'hsl(239, 84%, 67%)'; // Primary-like indigo

      case 'metric':
        // TODO: Implement metric-based coloring when spectralMetrics is available
        return 'hsl(239, 84%, 67%)'; // Primary-like indigo

      case 'target':
      default:
        if (point.yValue !== undefined && chartData.length > 0) {
          const t = (point.yValue - yRange.min) / (yRange.max - yRange.min + 0.001);
          const hue = 240 - t * 180; // Blue to red gradient
          return `hsl(${hue}, 70%, 50%)`;
        }
        return 'hsl(239, 84%, 67%)'; // Primary-like indigo
    }
  }, [globalColorConfig, computedColorContext, config.colorMode, config.metadataKey, chartData, yRange]);

  // Get point color for 3D view - returns only parseable HSL colors (no CSS variables)
  // Three.js cannot parse CSS variables, so we use concrete color values
  const getPointColor3D = useCallback((point: DataPoint) => {
    // Use unified color system if globalColorConfig is provided
    if (globalColorConfig) {
      return getUnifiedBaseColor(point.index, globalColorConfig, computedColorContext);
    }

    // Legacy color logic
    switch (config.colorMode) {
      case 'fold':
        if (point.foldLabel !== undefined && point.foldLabel >= 0) {
          return getFoldColor(point.foldLabel);
        }
        return 'hsl(220, 10%, 50%)'; // Muted gray fallback

      case 'metadata':
        if (config.metadataKey && point.metadata?.[config.metadataKey] !== undefined) {
          const value = point.metadata[config.metadataKey];
          const hash = String(value).split('').reduce((a, b) => {
            a = ((a << 5) - a) + b.charCodeAt(0);
            return a & a;
          }, 0);
          return `hsl(${Math.abs(hash) % 360}, 70%, 50%)`;
        }
        return 'hsl(239, 84%, 67%)'; // Primary-like indigo fallback

      case 'metric':
        return 'hsl(239, 84%, 67%)'; // Primary-like indigo fallback

      case 'target':
      default:
        if (point.yValue !== undefined && chartData.length > 0) {
          const t = (point.yValue - yRange.min) / (yRange.max - yRange.min + 0.001);
          const hue = 240 - t * 180; // Blue to red gradient
          return `hsl(${hue}, 70%, 50%)`;
        }
        return 'hsl(239, 84%, 67%)'; // Primary-like indigo fallback
    }
  }, [globalColorConfig, computedColorContext, config.colorMode, config.metadataKey, chartData, yRange]);

  // Handle point click - Recharts Scatter onClick signature: (data, index, event)
  const handleClick = useCallback((data: unknown, _index: number, event: React.MouseEvent) => {
    const point = data as { index?: number; payload?: DataPoint };
    const idx = point?.payload?.index ?? point?.index;
    if (idx === undefined) return;

    if (selectionCtx) {
      if (event?.shiftKey) {
        selectionCtx.select([idx], 'add');
      } else if (event?.ctrlKey || event?.metaKey) {
        selectionCtx.toggle([idx]);
      } else {
        if (selectedSamples.has(idx) && selectedSamples.size === 1) {
          selectionCtx.clear();
        } else {
          selectionCtx.select([idx], 'replace');
        }
      }
    } else if (externalOnSelectSample) {
      externalOnSelectSample(idx);
    }
  }, [selectionCtx, externalOnSelectSample, selectedSamples]);

  // Handle hover
  const handleMouseEnter = useCallback((data: unknown) => {
    const point = data as { index?: number; payload?: DataPoint };
    const idx = point?.payload?.index ?? point?.index;
    if (idx !== undefined && selectionCtx) {
      selectionCtx.setHovered(idx);
    }
  }, [selectionCtx]);

  const handleMouseLeave = useCallback(() => {
    if (selectionCtx) {
      selectionCtx.setHovered(null);
    }
  }, [selectionCtx]);

  // Handle box/lasso selection completion
  // Strategy: Check if each scatter circle's screen position is inside the selection area
  // This is more reliable than trying to convert between coordinate systems
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

    // Apply selection based on modifiers
    if (modifiers.shift) {
      selectionCtx.select(selectedIndices, 'add');
    } else if (modifiers.ctrl) {
      // Toggle: add unselected, remove selected
      const toAdd = selectedIndices.filter(i => !selectionCtx.selectedSamples.has(i));
      const toRemove = selectedIndices.filter(i => selectionCtx.selectedSamples.has(i));
      if (toAdd.length > 0) selectionCtx.select(toAdd, 'add');
      toRemove.forEach(i => selectionCtx.toggle([i]));
    } else {
      selectionCtx.select(selectedIndices, 'replace');
    }
  }, [selectionCtx, chartData]);

  // Handle background click - only clear selection when in 'click' mode
  // In box/lasso modes, the mouseup that completes selection also triggers a click event
  // so we must not clear selection in those modes
  const handleChartClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Only clear selection on background click when in 'click' mode
    // In box/lasso modes, completing a selection triggers a click that would clear it
    if (selectionTool !== 'click') {
      return;
    }

    const target = e.target as HTMLElement;
    if (target.tagName === 'svg' || target.classList.contains('recharts-surface')) {
      if (selectionCtx && selectionCtx.selectedSamples.size > 0) {
        selectionCtx.clear();
      }
    }
  }, [selectionCtx, selectionTool]);

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
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Display Options</DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuCheckboxItem
          checked={config.showGrid}
          onCheckedChange={(checked) => updateConfig({ showGrid: checked })}
        >
          Show Grid
        </DropdownMenuCheckboxItem>

        <DropdownMenuCheckboxItem
          checked={config.showCrosshairs}
          onCheckedChange={(checked) => updateConfig({ showCrosshairs: checked })}
        >
          Show Crosshairs at Origin
        </DropdownMenuCheckboxItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Point Size</DropdownMenuLabel>

        <DropdownMenuRadioGroup
          value={config.pointSize}
          onValueChange={(v) => updateConfig({ pointSize: v as 'small' | 'medium' | 'large' })}
        >
          <DropdownMenuRadioItem value="small">Small</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="medium">Medium</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="large">Large</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        {/* Only show internal color selector when no global config provided */}
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
                <DropdownMenuLabel className="text-xs text-muted-foreground">Metadata Field</DropdownMenuLabel>
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
          contentStyle={{
            backgroundColor: CHART_THEME.tooltipBg,
            border: `1px solid ${CHART_THEME.tooltipBorder}`,
            borderRadius: CHART_THEME.tooltipBorderRadius,
            fontSize: CHART_THEME.tooltipFontSize,
          }}
          content={({ payload }) => {
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
              <SelectItem value="umap">UMAP</SelectItem>
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
                    onClick={() => updateConfig({ viewMode: config.viewMode === '3d' ? '2d' : '3d' })}
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

          {/* Selection mode toggle (only for 2D view) */}
          {config.viewMode === '2d' && (
            <SelectionModeToggle
              mode={selectionTool}
              onChange={setSelectionTool}
            />
          )}

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
        className="flex-1 min-h-[200px] aspect-square max-h-full"
      >
        {config.viewMode === '3d' ? (
          render3DView()
        ) : (
          <SelectionContainer
            mode={selectionTool}
            enabled={selectionTool !== 'click'}
            onSelectionComplete={handleSelectionComplete}
            onPointClick={() => {}} // Point clicks handled by Recharts onClick
            className="h-full w-full"
          >
            <div onClick={handleChartClick} className="h-full w-full">
              {render2DView()}
            </div>
          </SelectionContainer>
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
          </div>

          {/* Fold legend when coloring by fold */}
          {config.colorMode === 'fold' && uniqueFolds.length > 0 && (
            <div className="flex items-center gap-2">
              {uniqueFolds.slice(0, 5).map(foldIdx => (
                <span key={foldIdx} className="flex items-center gap-1">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: getFoldColor(foldIdx) }}
                  />
                  <span>{formatFoldLabel(foldIdx)}</span>
                </span>
              ))}
              {uniqueFolds.length > 5 && (
                <span>+{uniqueFolds.length - 5} more</span>
              )}
            </div>
          )}

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

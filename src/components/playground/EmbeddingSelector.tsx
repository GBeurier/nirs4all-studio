/**
 * EmbeddingSelector - Mini PCA/UMAP scatter overlay for quick selection
 *
 * Phase 5 Implementation: Advanced Filtering & Metrics
 *
 * Features:
 * - Mini scatter plot of PCA/UMAP embedding
 * - Lasso/box selection synced with main display
 * - Toggleable position (corner overlay vs expanded)
 * - Colored by partition or target
 * - Selection preview and count
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  ReferenceArea,
  ZAxis,
} from 'recharts';
import {
  Maximize2,
  Minimize2,
  Grid3X3,
  Move,
  RotateCcw,
  PointerIcon,
  Box,
  Lasso,
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
  Tooltip as UITooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useSelection } from '@/context/SelectionContext';
import type { ExecuteResponse } from '@/types/playground';

// ============= Types =============

export type SelectionMode = 'none' | 'box' | 'lasso';
export type ColorBy = 'partition' | 'target' | 'selection' | 'none';

export interface EmbeddingSelectorProps {
  /** Embedding data (PCA or UMAP) */
  embedding?: number[][];
  /** Partition labels */
  partitions?: string[];
  /** Target values */
  targets?: number[];
  /** Sample IDs */
  sampleIds?: string[];
  /** Current embedding method */
  embeddingMethod?: 'pca' | 'umap';
  /** Overlay mode (corner vs expanded) */
  expanded?: boolean;
  /** Toggle expanded mode */
  onToggleExpanded?: () => void;
  /** Whether to use SelectionContext */
  useSelectionContext?: boolean;
  /** Callback for selection (if not using context) */
  onSelect?: (indices: number[]) => void;
  /** Partition color map */
  partitionColors?: Record<string, string>;
  /** Whether the overlay is visible */
  visible?: boolean;
}

// ============= Constants =============

const DEFAULT_COLORS = [
  '#4299e1', // blue
  '#ed8936', // orange
  '#48bb78', // green
  '#ed64a6', // pink
  '#9f7aea', // purple
  '#38b2ac', // teal
  '#f56565', // red
  '#ecc94b', // yellow
];

// ============= Helper: Lasso Point in Polygon =============

function pointInPolygon(
  point: { x: number; y: number },
  polygon: { x: number; y: number }[]
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x,
      yi = polygon[i].y;
    const xj = polygon[j].x,
      yj = polygon[j].y;
    if ((yi > point.y) !== (yj > point.y) && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// ============= Main Component =============

export function EmbeddingSelector({
  embedding,
  partitions,
  targets,
  sampleIds,
  embeddingMethod = 'pca',
  expanded = false,
  onToggleExpanded,
  useSelectionContext = true,
  onSelect,
  partitionColors,
  visible = true,
}: EmbeddingSelectorProps) {
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('box');
  const [colorBy, setColorBy] = useState<ColorBy>('partition');
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<{ x: number; y: number } | null>(null);
  const [lassoPoints, setLassoPoints] = useState<{ x: number; y: number }[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  // Selection context
  const { select, toggle, selectedSamples, selectedCount, clear } = useSelection();

  // Process embedding data
  const data = useMemo(() => {
    if (!embedding || embedding.length === 0) return [];

    // Determine partition color mapping
    const uniquePartitions = [...new Set(partitions ?? [])];
    const partitionColorMap: Record<string, string> = partitionColors ?? {};
    uniquePartitions.forEach((p, i) => {
      if (!partitionColorMap[p]) {
        partitionColorMap[p] = DEFAULT_COLORS[i % DEFAULT_COLORS.length];
      }
    });

    // Calculate target color scale if needed
    let targetMin = 0,
      targetMax = 1;
    if (targets && targets.length > 0) {
      targetMin = Math.min(...targets);
      targetMax = Math.max(...targets);
    }

    return embedding.map((coords, idx) => {
      const isSelected = selectedSamples.has(idx);
      let color = '#a0aec0';

      if (colorBy === 'partition' && partitions && partitions[idx]) {
        color = partitionColorMap[partitions[idx]] ?? '#a0aec0';
      } else if (colorBy === 'target' && targets && targets[idx] !== undefined) {
        // Blue to red gradient based on target value
        const normalized = (targets[idx] - targetMin) / (targetMax - targetMin || 1);
        const r = Math.round(255 * normalized);
        const b = Math.round(255 * (1 - normalized));
        color = `rgb(${r}, 100, ${b})`;
      } else if (colorBy === 'selection') {
        color = isSelected ? '#48bb78' : '#a0aec0';
      }

      return {
        idx,
        x: coords[0],
        y: coords.length > 1 ? coords[1] : 0,
        color,
        isSelected,
        partition: partitions?.[idx],
        target: targets?.[idx],
        sampleId: sampleIds?.[idx],
      };
    });
  }, [embedding, partitions, targets, sampleIds, partitionColors, selectedSamples, colorBy]);

  // Calculate axis bounds
  const [xMin, xMax, yMin, yMax] = useMemo(() => {
    if (data.length === 0) return [0, 1, 0, 1];
    const xs = data.map(d => d.x);
    const ys = data.map(d => d.y);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    const xPad = (xMax - xMin) * 0.05 || 1;
    const yPad = (yMax - yMin) * 0.05 || 1;
    return [xMin - xPad, xMax + xPad, yMin - yPad, yMax + yPad];
  }, [data]);

  // Handle mouse events for selection
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (selectionMode === 'none' || !e.currentTarget) return;

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      // Get the chart area bounds (account for padding/margins)
      const chartPadding = { left: 5, right: 5, top: 5, bottom: 5 };
      const chartWidth = rect.width - chartPadding.left - chartPadding.right;
      const chartHeight = rect.height - chartPadding.top - chartPadding.bottom;

      // Convert mouse position to data coordinates
      const mouseX = e.clientX - rect.left - chartPadding.left;
      const mouseY = e.clientY - rect.top - chartPadding.top;

      const dataX = xMin + (mouseX / chartWidth) * (xMax - xMin);
      const dataY = yMax - (mouseY / chartHeight) * (yMax - yMin);

      if (selectionMode === 'box') {
        setIsSelecting(true);
        setSelectionStart({ x: dataX, y: dataY });
        setSelectionEnd({ x: dataX, y: dataY });
      } else if (selectionMode === 'lasso') {
        setIsSelecting(true);
        setLassoPoints([{ x: dataX, y: dataY }]);
      }
    },
    [selectionMode, xMin, xMax, yMin, yMax]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isSelecting || selectionMode === 'none') return;

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const chartPadding = { left: 5, right: 5, top: 5, bottom: 5 };
      const chartWidth = rect.width - chartPadding.left - chartPadding.right;
      const chartHeight = rect.height - chartPadding.top - chartPadding.bottom;

      const mouseX = e.clientX - rect.left - chartPadding.left;
      const mouseY = e.clientY - rect.top - chartPadding.top;

      const dataX = xMin + (mouseX / chartWidth) * (xMax - xMin);
      const dataY = yMax - (mouseY / chartHeight) * (yMax - yMin);

      if (selectionMode === 'box') {
        setSelectionEnd({ x: dataX, y: dataY });
      } else if (selectionMode === 'lasso') {
        setLassoPoints(prev => [...prev, { x: dataX, y: dataY }]);
      }
    },
    [isSelecting, selectionMode, xMin, xMax, yMin, yMax]
  );

  const handleMouseUp = useCallback(() => {
    if (!isSelecting) return;
    setIsSelecting(false);

    let selectedIndices: number[] = [];

    if (selectionMode === 'box' && selectionStart && selectionEnd) {
      const x1 = Math.min(selectionStart.x, selectionEnd.x);
      const x2 = Math.max(selectionStart.x, selectionEnd.x);
      const y1 = Math.min(selectionStart.y, selectionEnd.y);
      const y2 = Math.max(selectionStart.y, selectionEnd.y);

      selectedIndices = data
        .filter(d => d.x >= x1 && d.x <= x2 && d.y >= y1 && d.y <= y2)
        .map(d => d.idx);
    } else if (selectionMode === 'lasso' && lassoPoints.length > 2) {
      selectedIndices = data
        .filter(d => pointInPolygon({ x: d.x, y: d.y }, lassoPoints))
        .map(d => d.idx);
    }

    // Apply selection
    if (selectedIndices.length > 0) {
      if (useSelectionContext) {
        select(selectedIndices);
      } else if (onSelect) {
        onSelect(selectedIndices);
      }
    }

    // Clear selection shapes
    setSelectionStart(null);
    setSelectionEnd(null);
    setLassoPoints([]);
  }, [isSelecting, selectionMode, selectionStart, selectionEnd, lassoPoints, data, useSelectionContext, select, onSelect]);

  // Handle click on point
  const handlePointClick = useCallback(
    (data: any) => {
      if (data && data.idx !== undefined) {
        if (useSelectionContext) {
          toggle(data.idx);
        } else if (onSelect) {
          onSelect([data.idx]);
        }
      }
    },
    [useSelectionContext, toggle, onSelect]
  );

  if (!visible || !embedding || embedding.length === 0) {
    return null;
  }

  const containerClass = expanded
    ? 'w-full h-64 border rounded-lg bg-background'
    : 'w-40 h-32 border rounded-lg bg-background shadow-lg';

  return (
    <div
      ref={containerRef}
      className={cn(containerClass, 'relative select-none', isSelecting && 'cursor-crosshair')}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => isSelecting && handleMouseUp()}
    >
      {/* Mini toolbar */}
      <div className="absolute top-1 right-1 z-10 flex items-center gap-0.5">
        <TooltipProvider delayDuration={100}>
          <UITooltip>
            <TooltipTrigger asChild>
              <Button
                variant={selectionMode === 'box' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setSelectionMode(selectionMode === 'box' ? 'none' : 'box')}
                className="h-5 w-5 p-0"
              >
                <Box className="w-3 h-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              Box selection
            </TooltipContent>
          </UITooltip>

          <UITooltip>
            <TooltipTrigger asChild>
              <Button
                variant={selectionMode === 'lasso' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setSelectionMode(selectionMode === 'lasso' ? 'none' : 'lasso')}
                className="h-5 w-5 p-0"
              >
                <Lasso className="w-3 h-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              Lasso selection
            </TooltipContent>
          </UITooltip>

          {expanded && (
            <UITooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0"
                  onClick={clear}
                >
                  <RotateCcw className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                Clear selection
              </TooltipContent>
            </UITooltip>
          )}

          {onToggleExpanded && (
            <UITooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0"
                  onClick={onToggleExpanded}
                >
                  {expanded ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {expanded ? 'Minimize' : 'Expand'}
              </TooltipContent>
            </UITooltip>
          )}
        </TooltipProvider>
      </div>

      {/* Color by selector (expanded mode only) */}
      {expanded && (
        <div className="absolute top-1 left-1 z-10">
          <Select value={colorBy} onValueChange={(v) => setColorBy(v as ColorBy)}>
            <SelectTrigger className="h-5 text-[10px] w-20 px-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="partition" className="text-xs">Partition</SelectItem>
              <SelectItem value="target" className="text-xs">Target</SelectItem>
              <SelectItem value="selection" className="text-xs">Selection</SelectItem>
              <SelectItem value="none" className="text-xs">None</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Selection count */}
      {selectedCount > 0 && (
        <div className="absolute bottom-1 left-1 z-10 text-[9px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded">
          {selectedCount} selected
        </div>
      )}

      {/* Method label */}
      <div className="absolute bottom-1 right-1 z-10 text-[9px] text-muted-foreground uppercase">
        {embeddingMethod}
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <XAxis
            type="number"
            dataKey="x"
            domain={[xMin, xMax]}
            hide
          />
          <YAxis
            type="number"
            dataKey="y"
            domain={[yMin, yMax]}
            hide
          />
          <ZAxis range={[expanded ? 20 : 10, expanded ? 60 : 30]} />

          {/* Selection box */}
          {isSelecting && selectionMode === 'box' && selectionStart && selectionEnd && (
            <ReferenceArea
              x1={selectionStart.x}
              x2={selectionEnd.x}
              y1={selectionStart.y}
              y2={selectionEnd.y}
              fill="#4299e1"
              fillOpacity={0.2}
              stroke="#4299e1"
              strokeOpacity={0.8}
            />
          )}

          <Scatter
            data={data}
            onClick={(e) => e && handlePointClick(e)}
          >
            {data.map((entry, index) => (
              <circle
                key={entry.idx}
                cx={0}
                cy={0}
                r={expanded ? (entry.isSelected ? 4 : 2) : (entry.isSelected ? 3 : 1.5)}
                fill={entry.isSelected ? '#48bb78' : entry.color}
                stroke={entry.isSelected ? '#2f855a' : 'none'}
                strokeWidth={1}
                opacity={entry.isSelected ? 1 : 0.6}
              />
            ))}
          </Scatter>

          {expanded && (
            <Tooltip
              content={({ payload }) => {
                if (!payload || payload.length === 0) return null;
                const d = payload[0].payload;
                return (
                  <div className="bg-popover border rounded px-2 py-1 text-xs shadow-lg">
                    <div className="font-medium">{d.sampleId ?? `Sample ${d.idx}`}</div>
                    {d.partition && <div className="text-muted-foreground">Partition: {d.partition}</div>}
                    {d.target !== undefined && <div className="text-muted-foreground">Target: {d.target.toFixed(3)}</div>}
                  </div>
                );
              }}
            />
          )}
        </ScatterChart>
      </ResponsiveContainer>

      {/* Lasso path overlay */}
      {isSelecting && selectionMode === 'lasso' && lassoPoints.length > 1 && (
        <svg className="absolute inset-0 pointer-events-none" style={{ overflow: 'visible' }}>
          <path
            d={`M ${lassoPoints
              .map((p, i) => {
                const rect = containerRef.current?.getBoundingClientRect();
                if (!rect) return '';
                const chartWidth = rect.width - 10;
                const chartHeight = rect.height - 10;
                const screenX = 5 + ((p.x - xMin) / (xMax - xMin)) * chartWidth;
                const screenY = 5 + ((yMax - p.y) / (yMax - yMin)) * chartHeight;
                return `${i === 0 ? '' : 'L'}${screenX},${screenY}`;
              })
              .join(' ')}`}
            fill="rgba(66, 153, 225, 0.2)"
            stroke="#4299e1"
            strokeWidth={1}
            strokeDasharray="4,2"
          />
        </svg>
      )}
    </div>
  );
}

export default EmbeddingSelector;

/**
 * PredVsObsChart — Scatter plot of Predicted vs Observed values.
 *
 * Displays y_pred (Y axis) vs y_true (X axis) with a y=x reference line.
 * Points colored by group. Supports selection and hover cross-highlighting.
 *
 * Auto-switches to Canvas2D rendering when point count exceeds threshold
 * for smooth performance with large datasets.
 */

import { useMemo, useCallback } from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { Loader2 } from 'lucide-react';
import { useInspectorSelection } from '@/context/InspectorSelectionContext';
import { useInspectorHover } from '@/context/InspectorSelectionContext';
import { CanvasScatter, CANVAS_SCATTER_THRESHOLD, type CanvasScatterPoint, type CanvasReferenceLine } from './CanvasScatter';
import type { ScatterResponse, InspectorGroup } from '@/types/inspector';

interface PredVsObsChartProps {
  data: ScatterResponse | null | undefined;
  groups: InspectorGroup[];
  isLoading: boolean;
}

interface ScatterDot {
  x: number;
  y: number;
  chainId: string;
  modelClass: string;
  color: string;
}

export function PredVsObsChart({ data, groups, isLoading }: PredVsObsChartProps) {
  const { select, selectedChains, hasSelection } = useInspectorSelection();
  const { hoveredChain, setHovered } = useInspectorHover();

  // Build chain→color lookup
  const chainColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of groups) {
      for (const cid of group.chain_ids) map.set(cid, group.color);
    }
    return map;
  }, [groups]);

  // Flatten scatter points
  const { dots, minVal, maxVal } = useMemo(() => {
    if (!data?.points?.length) return { dots: [] as ScatterDot[], minVal: 0, maxVal: 1 };

    const allDots: ScatterDot[] = [];
    let min = Infinity;
    let max = -Infinity;

    for (const point of data.points) {
      const color = chainColorMap.get(point.chain_id) ?? '#64748b';
      for (let i = 0; i < point.y_true.length; i++) {
        const x = point.y_true[i];
        const y = point.y_pred[i];
        allDots.push({ x, y, chainId: point.chain_id, modelClass: point.model_class, color });
        if (x < min) min = x;
        if (x > max) max = x;
        if (y < min) min = y;
        if (y > max) max = y;
      }
    }

    const range = max - min || 1;
    return { dots: allDots, minVal: min - range * 0.05, maxVal: max + range * 0.05 };
  }, [data, chainColorMap]);

  // Compute R² and RMSE annotations
  const { r2, rmse } = useMemo(() => {
    if (dots.length === 0) return { r2: null, rmse: null };

    const n = dots.length;
    const meanY = dots.reduce((s, d) => s + d.x, 0) / n;
    let ssRes = 0;
    let ssTot = 0;

    for (const d of dots) {
      const residual = d.y - d.x;
      ssRes += residual * residual;
      ssTot += (d.x - meanY) * (d.x - meanY);
    }

    const r2Val = ssTot > 0 ? 1 - ssRes / ssTot : 0;
    const rmseVal = Math.sqrt(ssRes / n);
    return { r2: r2Val, rmse: rmseVal };
  }, [dots]);

  const useCanvasRenderer = dots.length > CANVAS_SCATTER_THRESHOLD;

  // Smart tick formatter: auto-detect precision from data range
  const tickFormatter = useMemo(() => {
    const range = maxVal - minVal;
    if (range === 0) return (v: number) => v.toFixed(2);
    const magnitude = Math.abs(Math.log10(range));
    const decimals = magnitude > 2 ? 1 : magnitude > 1 ? 2 : range < 0.1 ? 4 : 3;
    return (v: number) => v.toFixed(decimals);
  }, [minVal, maxVal]);

  // ========= Canvas2D path (high point count) =========

  const canvasPoints = useMemo<CanvasScatterPoint[]>(() => {
    if (!useCanvasRenderer) return [];
    return dots.map(d => {
      const isSelected = hasSelection && selectedChains.has(d.chainId);
      const isHovered = hoveredChain === d.chainId;
      const dimmed = hasSelection && !isSelected;
      return {
        x: d.x,
        y: d.y,
        color: d.color,
        opacity: dimmed ? 0.15 : isHovered ? 1 : 0.7,
        radius: isHovered ? 5 : isSelected ? 4 : 3,
        chainId: d.chainId,
        meta: { modelClass: d.modelClass },
      };
    });
  }, [dots, useCanvasRenderer, hasSelection, selectedChains, hoveredChain]);

  const canvasRefLines = useMemo<CanvasReferenceLine[]>(() => [{
    type: 'y-equals-x',
    color: '#94a3b8',
    dash: [4, 4],
    width: 1,
  }], []);

  const canvasAnnotations = useMemo(() => {
    if (r2 === null || rmse === null) return [];
    return [{ text: `R² = ${r2.toFixed(4)} | RMSE = ${rmse.toFixed(4)} | n = ${dots.length}`, position: 'top-left' as const }];
  }, [r2, rmse, dots.length]);

  const handleCanvasPointClick = useCallback((point: CanvasScatterPoint, e: React.MouseEvent) => {
    if (e.shiftKey) {
      select([point.chainId], 'add');
    } else if (e.ctrlKey || e.metaKey) {
      select([point.chainId], 'toggle');
    } else {
      select([point.chainId], 'toggle');
    }
  }, [select]);

  const handleCanvasPointHover = useCallback((point: CanvasScatterPoint | null) => {
    setHovered(point?.chainId ?? null);
  }, [setHovered]);

  const renderCanvasTooltip = useCallback((point: CanvasScatterPoint) => (
    <div className="bg-popover text-popover-foreground text-xs p-2 rounded shadow-md border border-border">
      <div className="font-medium">{String(point.meta?.modelClass ?? '')}</div>
      <div>Observed: {point.x.toFixed(4)}</div>
      <div>Predicted: {point.y.toFixed(4)}</div>
      <div>Residual: {(point.y - point.x).toFixed(4)}</div>
    </div>
  ), []);

  // ========= Loading / Empty states =========

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">Loading scatter data...</span>
      </div>
    );
  }

  if (dots.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No prediction data available. Select chains to visualize.
      </div>
    );
  }

  // ========= Canvas2D renderer (large datasets) =========

  if (useCanvasRenderer) {
    return (
      <CanvasScatter
        points={canvasPoints}
        referenceLines={canvasRefLines}
        annotations={canvasAnnotations}
        xLabel="Observed"
        yLabel="Predicted"
        xDomain={[minVal, maxVal]}
        yDomain={[minVal, maxVal]}
        onPointClick={handleCanvasPointClick}
        onPointHover={handleCanvasPointHover}
        renderTooltip={renderCanvasTooltip}
      />
    );
  }

  // ========= Recharts SVG renderer (small datasets) =========

  return (
    <div className="w-full h-full relative">
      {r2 !== null && rmse !== null && (
        <div className="absolute top-1 left-10 z-10 text-xs text-muted-foreground bg-card/80 px-2 py-1 rounded">
          R² = {r2.toFixed(4)} | RMSE = {rmse.toFixed(4)} | n = {dots.length}
        </div>
      )}

      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 20, right: 20, bottom: 30, left: 50 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis
            type="number"
            dataKey="x"
            domain={[minVal, maxVal]}
            name="Observed"
            label={{ value: 'Observed', position: 'insideBottom', offset: -10, style: { fontSize: 12, fill: '#94a3b8' } }}
            tick={{ fontSize: 10 }}
            tickFormatter={tickFormatter}
          />
          <YAxis
            type="number"
            dataKey="y"
            domain={[minVal, maxVal]}
            name="Predicted"
            label={{ value: 'Predicted', angle: -90, position: 'insideLeft', offset: -5, style: { fontSize: 12, fill: '#94a3b8' } }}
            tick={{ fontSize: 10 }}
            tickFormatter={tickFormatter}
            width={45}
          />
          <RechartsTooltip
            content={({ payload }) => {
              if (!payload?.[0]?.payload) return null;
              const d = payload[0].payload as ScatterDot;
              return (
                <div className="bg-popover text-popover-foreground text-xs p-2 rounded shadow-md border border-border">
                  <div className="font-medium">{d.modelClass}</div>
                  <div>Observed: {d.x.toFixed(4)}</div>
                  <div>Predicted: {d.y.toFixed(4)}</div>
                  <div>Residual: {(d.y - d.x).toFixed(4)}</div>
                </div>
              );
            }}
          />

          <ReferenceLine
            segment={[{ x: minVal, y: minVal }, { x: maxVal, y: maxVal }]}
            stroke="#94a3b8"
            strokeDasharray="4 4"
            strokeWidth={1}
          />

          <Scatter
            data={dots}
            isAnimationActive={false}
            onClick={(_entry: unknown, index: number) => {
              const dot = dots[index];
              if (dot) select([dot.chainId], 'toggle');
            }}
            onMouseEnter={(_entry: unknown, index: number) => {
              const dot = dots[index];
              if (dot) setHovered(dot.chainId);
            }}
            onMouseLeave={() => setHovered(null)}
          >
            {dots.map((dot, idx) => {
              const isChainSelected = hasSelection && selectedChains.has(dot.chainId);
              const isChainHovered = hoveredChain === dot.chainId;
              const dimmed = hasSelection && !isChainSelected;

              return (
                <Cell
                  key={idx}
                  fill={dot.color}
                  fillOpacity={dimmed ? 0.15 : isChainHovered ? 1 : 0.7}
                  r={isChainHovered ? 5 : 3}
                  stroke={isChainSelected ? dot.color : 'none'}
                  strokeWidth={isChainSelected ? 1.5 : 0}
                  cursor="pointer"
                />
              );
            })}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * ResidualsChart — Scatter plot of residuals (y_pred - y_true) vs y_pred.
 *
 * Reuses the same ScatterResponse data as PredVsObsChart.
 * Shows reference line at residual=0 and ±2σ bands.
 *
 * Auto-switches to Canvas2D rendering when point count exceeds threshold.
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
import { useInspectorSelection, useInspectorHover } from '@/context/InspectorSelectionContext';
import { useInspectorColor } from '@/context/InspectorColorContext';
import { CanvasScatter, CANVAS_SCATTER_THRESHOLD, type CanvasScatterPoint, type CanvasReferenceLine } from './CanvasScatter';
import type { ScatterResponse } from '@/types/inspector';

interface ResidualsChartProps {
  data: ScatterResponse | null | undefined;
  isLoading: boolean;
}

interface ResidualDot {
  x: number;       // y_pred
  y: number;       // residual (y_pred - y_true)
  yTrue: number;
  chainId: string;
  modelClass: string;
}

export function ResidualsChart({ data, isLoading }: ResidualsChartProps) {
  const { select, selectedChains, hasSelection } = useInspectorSelection();
  const { hoveredChain, setHovered } = useInspectorHover();
  const { getChainColor, getChainOpacity } = useInspectorColor();

  // Flatten scatter points into residual dots
  const { dots, meanResidual, stdResidual } = useMemo(() => {
    if (!data?.points?.length) return { dots: [] as ResidualDot[], meanResidual: 0, stdResidual: 0 };

    const allDots: ResidualDot[] = [];
    for (const point of data.points) {
      for (let i = 0; i < point.y_true.length; i++) {
        const yTrue = point.y_true[i];
        const yPred = point.y_pred[i];
        allDots.push({
          x: yPred,
          y: yPred - yTrue,
          yTrue,
          chainId: point.chain_id,
          modelClass: point.model_class,
        });
      }
    }

    if (allDots.length === 0) return { dots: allDots, meanResidual: 0, stdResidual: 0 };
    const residuals = allDots.map(d => d.y);
    const mean = residuals.reduce((s, v) => s + v, 0) / residuals.length;
    const variance = residuals.reduce((s, v) => s + (v - mean) ** 2, 0) / residuals.length;
    const std = Math.sqrt(variance);

    return { dots: allDots, meanResidual: mean, stdResidual: std };
  }, [data]);

  const useCanvasRenderer = dots.length > CANVAS_SCATTER_THRESHOLD;

  // Smart tick formatters for axes (must be before early returns)
  const xTickFormatter = useMemo(() => {
    if (dots.length === 0) return (v: number) => v.toFixed(2);
    const xs = dots.map(d => d.x);
    const range = Math.max(...xs) - Math.min(...xs);
    if (range === 0) return (v: number) => v.toFixed(2);
    const decimals = range < 0.01 ? 4 : range < 0.1 ? 3 : range < 10 ? 2 : 1;
    return (v: number) => v.toFixed(decimals);
  }, [dots]);

  const yTickFormatter = useMemo(() => {
    if (stdResidual === 0) return (v: number) => v.toFixed(4);
    const range = stdResidual * 4;
    const decimals = range < 0.01 ? 4 : range < 0.1 ? 3 : range < 10 ? 2 : 1;
    return (v: number) => v.toFixed(decimals);
  }, [stdResidual]);

  // ========= Canvas2D path (high point count) =========

  const canvasPoints = useMemo<CanvasScatterPoint[]>(() => {
    if (!useCanvasRenderer) return [];
    return dots.map(d => {
      const color = getChainColor(d.chainId);
      const isHovered = hoveredChain === d.chainId;
      const opacity = isHovered ? 1 : getChainOpacity(d.chainId);
      const isSelected = hasSelection && selectedChains.has(d.chainId);
      return {
        x: d.x,
        y: d.y,
        color,
        opacity,
        radius: isHovered ? 5 : isSelected ? 4 : 3,
        chainId: d.chainId,
        meta: { modelClass: d.modelClass, yTrue: d.yTrue },
      };
    });
  }, [dots, useCanvasRenderer, getChainColor, getChainOpacity, hoveredChain, hasSelection, selectedChains]);

  const canvasRefLines = useMemo<CanvasReferenceLine[]>(() => {
    const lines: CanvasReferenceLine[] = [
      { type: 'horizontal', value: 0, color: '#94a3b8', width: 1.5 },
    ];
    if (stdResidual > 0) {
      const band = stdResidual * 2;
      lines.push({ type: 'horizontal', value: band, color: '#f59e0b', dash: [4, 4], width: 1 });
      lines.push({ type: 'horizontal', value: -band, color: '#f59e0b', dash: [4, 4], width: 1 });
    }
    return lines;
  }, [stdResidual]);

  const canvasAnnotations = useMemo(() => [{
    text: `Mean = ${meanResidual.toFixed(4)} | Std = ${stdResidual.toFixed(4)} | n = ${dots.length}`,
    position: 'top-left' as const,
  }], [meanResidual, stdResidual, dots.length]);

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
      <div>Observed: {Number(point.meta?.yTrue ?? 0).toFixed(4)}</div>
      <div>Predicted: {point.x.toFixed(4)}</div>
      <div>Residual: {point.y.toFixed(4)}</div>
      {stdResidual > 0 && <div>Std. Residual: {(point.y / stdResidual).toFixed(2)}σ</div>}
    </div>
  ), [stdResidual]);

  // ========= Loading / Empty states =========

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">Loading residuals data...</span>
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
        xLabel="Predicted"
        yLabel="Residual"
        onPointClick={handleCanvasPointClick}
        onPointHover={handleCanvasPointHover}
        renderTooltip={renderCanvasTooltip}
      />
    );
  }

  // ========= Recharts SVG renderer (small datasets) =========

  const band2Sigma = stdResidual * 2;

  return (
    <div className="w-full h-full relative">
      <div className="absolute top-1 left-10 z-10 text-xs text-muted-foreground bg-card/80 px-2 py-1 rounded">
        Mean = {meanResidual.toFixed(4)} | Std = {stdResidual.toFixed(4)} | n = {dots.length}
      </div>

      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 20, right: 20, bottom: 30, left: 50 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis
            type="number"
            dataKey="x"
            name="Predicted"
            label={{ value: 'Predicted', position: 'insideBottom', offset: -10, style: { fontSize: 12, fill: '#94a3b8' } }}
            tick={{ fontSize: 10 }}
            tickFormatter={xTickFormatter}
          />
          <YAxis
            type="number"
            dataKey="y"
            name="Residual"
            label={{ value: 'Residual', angle: -90, position: 'insideLeft', offset: -5, style: { fontSize: 12, fill: '#94a3b8' } }}
            tick={{ fontSize: 10 }}
            tickFormatter={yTickFormatter}
            width={45}
          />
          <RechartsTooltip
            content={({ payload }) => {
              if (!payload?.[0]?.payload) return null;
              const d = payload[0].payload as ResidualDot;
              return (
                <div className="bg-popover text-popover-foreground text-xs p-2 rounded shadow-md border border-border">
                  <div className="font-medium">{d.modelClass}</div>
                  <div>Observed: {d.yTrue.toFixed(4)}</div>
                  <div>Predicted: {d.x.toFixed(4)}</div>
                  <div>Residual: {d.y.toFixed(4)}</div>
                  {stdResidual > 0 && <div>Std. Residual: {(d.y / stdResidual).toFixed(2)}σ</div>}
                </div>
              );
            }}
          />

          <ReferenceLine y={0} stroke="#94a3b8" strokeWidth={1.5} />

          {stdResidual > 0 && (
            <>
              <ReferenceLine y={band2Sigma} stroke="#f59e0b" strokeDasharray="4 4" strokeWidth={1} />
              <ReferenceLine y={-band2Sigma} stroke="#f59e0b" strokeDasharray="4 4" strokeWidth={1} />
            </>
          )}

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
              const isChainHovered = hoveredChain === dot.chainId;
              const opacity = getChainOpacity(dot.chainId);
              const isChainSelected = hasSelection && selectedChains.has(dot.chainId);

              return (
                <Cell
                  key={idx}
                  fill={getChainColor(dot.chainId)}
                  fillOpacity={isChainHovered ? 1 : opacity}
                  r={isChainHovered ? 5 : 3}
                  stroke={isChainSelected ? getChainColor(dot.chainId) : 'none'}
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

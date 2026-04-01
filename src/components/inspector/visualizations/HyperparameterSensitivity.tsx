/**
 * HyperparameterSensitivity — Scatter plot of hyperparameter value vs score.
 *
 * Adds explicit unsupported/empty states, optional log scaling, a fitted trend
 * line, and click-to-select affordances so the plot can be used as a real
 * exploration tool instead of a decorative scatter.
 */

import { useMemo, useState, useRef, useEffect, type ComponentType } from 'react';
import { AlertCircle, Loader2, MousePointerClick, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { useInspectorSelection } from '@/context/InspectorSelectionContext';
import type { HyperparameterResponse } from '@/types/inspector';

interface HyperparameterSensitivityProps {
  data: HyperparameterResponse | null | undefined;
  isLoading: boolean;
}

type HyperparameterData = HyperparameterResponse & { reason?: string | null };

interface HoveredPoint {
  chain_id: string;
  param_value: number;
  score: number;
  model_class: string;
  mouseX: number;
  mouseY: number;
}

type ScaleMode = 'linear' | 'log';

const MODEL_COLORS = [
  '#0d9488', '#2563eb', '#d97706', '#e11d48', '#7c3aed',
  '#059669', '#ea580c', '#0284c7', '#db2777', '#65a30d',
];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function linearRegression(xs: number[], ys: number[]): { slope: number; intercept: number; r: number } | null {
  if (xs.length < 2 || ys.length < 2 || xs.length !== ys.length) return null;
  const meanX = average(xs);
  const meanY = average(ys);
  let numerator = 0;
  let denomX = 0;
  let denomY = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  if (denomX === 0 || denomY === 0) return null;
  const slope = numerator / denomX;
  const intercept = meanY - slope * meanX;
  const r = numerator / Math.sqrt(denomX * denomY);
  return { slope, intercept, r };
}

function StateCard({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md rounded-xl border border-border/60 bg-card/70 p-4 text-center shadow-sm">
        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="mt-1 text-xs leading-5 text-muted-foreground">{description}</div>
      </div>
    </div>
  );
}

export function HyperparameterSensitivity({ data, isLoading }: HyperparameterSensitivityProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<HoveredPoint | null>(null);
  const [dims, setDims] = useState({ width: 500, height: 350 });
  const [scaleMode, setScaleMode] = useState<ScaleMode>('linear');
  const { select, selectedChains, hasSelection } = useInspectorSelection();

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) setDims({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const chartData = data as HyperparameterData | null | undefined;
  const reason = chartData?.reason?.trim() || null;

  const colorMap = useMemo(() => {
    if (!chartData?.points) return new Map<string, string>();
    const models = [...new Set(chartData.points.map(p => p.model_class))];
    return new Map(models.map((model, index) => [model, MODEL_COLORS[index % MODEL_COLORS.length]]));
  }, [chartData]);

  const modelCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const point of chartData?.points ?? []) {
      counts.set(point.model_class, (counts.get(point.model_class) ?? 0) + 1);
    }
    return counts;
  }, [chartData]);

  const points = useMemo(() => {
    if (!chartData?.points) return [];
    return chartData.points.filter(point => isFiniteNumber(point.param_value) && isFiniteNumber(point.score));
  }, [chartData]);

  const { xValues, yValues, useLogX, logAllowed, xDomain, yDomain, trend } = useMemo(() => {
    const xs = points.map(point => point.param_value);
    const ys = points.map(point => point.score);
    const positive = xs.every(value => value > 0);
    const logEnabled = scaleMode === 'log' && positive;
    const transformedX = logEnabled ? xs.map(value => Math.log10(value)) : xs;

    if (transformedX.length === 0 || ys.length === 0) {
      return {
        xValues: [] as number[],
        yValues: [] as number[],
        useLogX: false,
        logAllowed: positive,
        xDomain: [0, 1] as [number, number],
        yDomain: [0, 1] as [number, number],
        trend: null as ReturnType<typeof linearRegression> | null,
      };
    }

    const rawXMin = Math.min(...transformedX);
    const rawXMax = Math.max(...transformedX);
    const rawYMin = Math.min(...ys);
    const rawYMax = Math.max(...ys);
    const xPad = rawXMax === rawXMin ? Math.abs(rawXMin) * 0.1 || 0.5 : 0;
    const yPad = rawYMax === rawYMin ? Math.abs(rawYMin) * 0.1 || 0.5 : 0;
    const regression = linearRegression(transformedX, ys);

    return {
      xValues: transformedX,
      yValues: ys,
      useLogX: logEnabled,
      logAllowed: positive,
      xDomain: [rawXMin - xPad, rawXMax + xPad] as [number, number],
      yDomain: [rawYMin - yPad, rawYMax + yPad] as [number, number],
      trend: regression,
    };
  }, [points, scaleMode]);

  const marginLeft = 70;
  const marginRight = 20;
  const marginTop = 20;
  const marginBottom = 52;
  const plotW = Math.max(0, dims.width - marginLeft - marginRight);
  const plotH = Math.max(0, dims.height - marginTop - marginBottom);

  const scaleX = (value: number) => marginLeft + ((value - xDomain[0]) / Math.max(1e-12, xDomain[1] - xDomain[0])) * plotW;
  const scaleY = (value: number) => marginTop + plotH - ((value - yDomain[0]) / Math.max(1e-12, yDomain[1] - yDomain[0])) * plotH;

  const xTickValues = useMemo(() => {
    const ticks: number[] = [];
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      ticks.push(xDomain[0] + (xDomain[1] - xDomain[0]) * (i / steps));
    }
    return ticks;
  }, [xDomain]);

  const yTickValues = useMemo(() => {
    const ticks: number[] = [];
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      ticks.push(yDomain[0] + (yDomain[1] - yDomain[0]) * (i / steps));
    }
    return ticks;
  }, [yDomain]);

  const renderXValue = (value: number) => {
    if (!useLogX) return value.toPrecision(3);
    return Number(10 ** value).toPrecision(3);
  };

  const chartTitle = chartData?.param_name ?? 'Parameter';
  const scoreLabel = chartData?.score_column ?? 'Score';

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        <span className="text-sm">Loading hyperparameter data...</span>
      </div>
    );
  }

  if (!chartData || points.length === 0) {
    const description = reason ?? 'Chains need numeric model parameters and scores to populate this scatter.';
    return (
      <StateCard
        icon={AlertCircle}
        title="No hyperparameter signal"
        description={description}
      />
    );
  }

  return (
    <div ref={containerRef} className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{chartTitle}</span>
            <span>{points.length} points</span>
            <span>•</span>
            <span>{modelCounts.size} model families</span>
            <span>•</span>
            <span>{scoreLabel}</span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            Click a point to select a chain. {useLogX ? 'Log scale is active.' : 'Linear scale is active.'}
            {!logAllowed && ' Log scale is disabled because some values are not positive.'}
          </div>
        </div>

        <div className="flex items-center gap-1 rounded-md border border-border/60 bg-background p-1 text-xs">
          <button
            type="button"
            className={`rounded px-2 py-1 transition-colors ${scaleMode === 'linear' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
            onClick={() => setScaleMode('linear')}
          >
            Linear
          </button>
          <button
            type="button"
            className={`rounded px-2 py-1 transition-colors ${scaleMode === 'log' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'} ${!logAllowed ? 'opacity-40' : ''}`}
            onClick={() => logAllowed && setScaleMode('log')}
            disabled={!logAllowed}
          >
            Log
          </button>
        </div>
      </div>

      {reason && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
          {reason}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-lg border border-border/60 bg-card/40 p-2">
        <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
          {chartData.available_params?.slice(0, 8).map(param => (
            <span key={param} className="rounded-full border border-border/60 bg-background px-2 py-0.5">
              {param}
            </span>
          ))}
          {chartData.available_params && chartData.available_params.length > 8 && (
            <span className="rounded-full border border-border/60 bg-background px-2 py-0.5">
              +{chartData.available_params.length - 8} more
            </span>
          )}
        </div>

        <div className="min-h-0 flex-1 relative">
          <svg width={Math.max(dims.width, 420)} height={Math.max(dims.height, 280)} className="select-none">
            <text
              x={Math.max(dims.width, 420) / 2}
              y={Math.max(dims.height, 280) - 6}
              textAnchor="middle"
              className="fill-muted-foreground"
              fontSize={10}
            >
              {chartTitle}{useLogX ? ' (log10)' : ''}
            </text>

            <text
              x={16}
              y={Math.max(dims.height, 280) / 2}
              textAnchor="middle"
              className="fill-muted-foreground"
              fontSize={10}
              transform={`rotate(-90, 16, ${Math.max(dims.height, 280) / 2})`}
            >
              {scoreLabel}
            </text>

            <line x1={marginLeft} y1={marginTop} x2={marginLeft} y2={marginTop + plotH} stroke="currentColor" opacity={0.2} />
            <line x1={marginLeft} y1={marginTop + plotH} x2={marginLeft + plotW} y2={marginTop + plotH} stroke="currentColor" opacity={0.2} />

            {xTickValues.map((tick, index) => {
              const x = scaleX(tick);
              return (
                <g key={`xt-${index}`}>
                  <line x1={x} y1={marginTop + plotH} x2={x} y2={marginTop + plotH + 4} stroke="currentColor" opacity={0.25} />
                  <text x={x} y={marginTop + plotH + 16} textAnchor="middle" className="fill-muted-foreground" fontSize={9}>
                    {renderXValue(tick)}
                  </text>
                </g>
              );
            })}

            {yTickValues.map((tick, index) => {
              const y = scaleY(tick);
              return (
                <g key={`yt-${index}`}>
                  <line x1={marginLeft - 4} y1={y} x2={marginLeft} y2={y} stroke="currentColor" opacity={0.25} />
                  <text x={marginLeft - 6} y={y + 3} textAnchor="end" className="fill-muted-foreground" fontSize={9}>
                    {tick.toPrecision(3)}
                  </text>
                </g>
              );
            })}

            {trend && (
              <line
                x1={scaleX(xDomain[0])}
                y1={scaleY(trend.slope * xDomain[0] + trend.intercept)}
                x2={scaleX(xDomain[1])}
                y2={scaleY(trend.slope * xDomain[1] + trend.intercept)}
                stroke="#0f172a"
                strokeDasharray="5 4"
                strokeWidth={1.5}
                opacity={0.5}
              />
            )}

            {points.map((point, index) => {
              const xValue = xValues[index];
              const yValue = yValues[index];
              const cx = scaleX(xValue);
              const cy = scaleY(yValue);
              const color = colorMap.get(point.model_class) ?? '#64748b';
              const isHov = hovered?.chain_id === point.chain_id;
              const isSelected = hasSelection && selectedChains.has(point.chain_id);
              const dimmed = hasSelection && !isSelected;
              return (
                <circle
                  key={point.chain_id}
                  cx={cx}
                  cy={cy}
                  r={isHov ? 5.5 : isSelected ? 5 : 3.5}
                  fill={color}
                  opacity={dimmed ? 0.2 : isHov ? 1 : 0.78}
                  stroke={isSelected ? '#ffffff' : 'none'}
                  strokeWidth={isSelected ? 1.5 : 0}
                  cursor="pointer"
                  onClick={(e) => {
                    if (e.shiftKey) select([point.chain_id], 'add');
                    else if (e.ctrlKey || e.metaKey) select([point.chain_id], 'toggle');
                    else select([point.chain_id], 'replace');
                  }}
                  onMouseEnter={(e) => setHovered({
                    chain_id: point.chain_id,
                    param_value: point.param_value,
                    score: point.score,
                    model_class: point.model_class,
                    mouseX: e.clientX,
                    mouseY: e.clientY,
                  })}
                  onMouseLeave={() => setHovered(null)}
                />
              );
            })}
          </svg>

          {hovered && (
            <div
              className="fixed z-50 pointer-events-none rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg"
              style={{ left: hovered.mouseX + 12, top: hovered.mouseY - 50 }}
            >
              <div className="font-medium">{hovered.model_class}</div>
              <div>{chartTitle}: {hovered.param_value.toPrecision(4)}</div>
              <div>{scoreLabel}: {hovered.score.toFixed(4)}</div>
            </div>
          )}
        </div>
      </div>

      {trend && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/20 px-2 py-0.5">
            <ArrowUpRight className="h-3 w-3" />
            slope {trend.slope.toFixed(4)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/20 px-2 py-0.5">
            <ArrowDownRight className="h-3 w-3" />
            r {trend.r.toFixed(3)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/20 px-2 py-0.5">
            <MousePointerClick className="h-3 w-3" />
            {hasSelection ? `${selectedChains.size} selected` : 'No selection'}
          </span>
        </div>
      )}
    </div>
  );
}

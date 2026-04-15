/**
 * ConfusionMatrixChart — Heatmap of confusion matrix for classification tasks.
 *
 * Renders a compact SVG matrix with row/column totals, readable labels,
 * and explicit unsupported/empty states. The chart is intentionally
 * defensive because confusion data is only meaningful for classification
 * chains with discrete labels.
 */

import { useMemo, useState, useRef, useEffect, type ComponentType } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { ConfusionMatrixResponse, ConfusionMatrixCell } from '@/types/inspector';

interface ConfusionMatrixChartProps {
  data: ConfusionMatrixResponse | null | undefined;
  isLoading: boolean;
}

type ConfusionMatrixData = ConfusionMatrixResponse & { reason?: string | null };

interface HoveredCell {
  true_label: string;
  pred_label: string;
  count: number;
  normalized: number | null;
  mouseX: number;
  mouseY: number;
}

const BLUES = [
  '#eff6ff', '#dbeafe', '#bfdbfe', '#93c5fd', '#60a5fa',
  '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af', '#1e3a8a',
];

function getBlueColor(value: number, maxValue: number): string {
  if (maxValue <= 0 || value <= 0) return '#f8fafc';
  const t = Math.min(value / maxValue, 1);
  const idx = Math.round(t * (BLUES.length - 1));
  return BLUES[idx];
}

function getTextColor(value: number, maxValue: number): string {
  if (maxValue <= 0) return '#0f172a';
  const t = value / maxValue;
  return t > 0.55 ? '#ffffff' : '#0f172a';
}

function formatLabel(label: string, maxLength = 12): string {
  return label.length > maxLength ? `${label.slice(0, maxLength - 1)}…` : label;
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
      <div className="max-w-sm rounded-xl border border-border/60 bg-card/70 p-4 text-center shadow-sm">
        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="mt-1 text-xs leading-5 text-muted-foreground">{description}</div>
      </div>
    </div>
  );
}

export function ConfusionMatrixChart({ data, isLoading }: ConfusionMatrixChartProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<HoveredCell | null>(null);
  const [dims, setDims] = useState({ width: 500, height: 400 });

  useEffect(() => {
    if (!viewportRef.current) return;
    const updateDims = (element: HTMLDivElement) => {
      setDims({
        width: Math.max(1, element.clientWidth),
        height: Math.max(1, element.clientHeight),
      });
    };
    updateDims(viewportRef.current);
    const obs = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) {
        setDims({
          width: Math.max(1, entry.contentRect.width),
          height: Math.max(1, entry.contentRect.height),
        });
      }
    });
    obs.observe(viewportRef.current);
    return () => obs.disconnect();
  }, []);

  const { cellMap, maxValue, rowTotals, colTotals, totalSamples, accuracy, displayValues } = useMemo(() => {
    if (!data?.cells) {
      return {
        cellMap: new Map<string, ConfusionMatrixCell>(),
        maxValue: 0,
        rowTotals: new Map<string, number>(),
        colTotals: new Map<string, number>(),
        totalSamples: 0,
        accuracy: 0,
        displayValues: false,
      };
    }

    const map = new Map<string, ConfusionMatrixCell>();
    const rows = new Map<string, number>();
    const cols = new Map<string, number>();
    let max = 0;
    let diagonal = 0;
    const hasNormalized = data.normalize !== 'none';

    for (const cell of data.cells) {
      map.set(`${cell.true_label}|${cell.pred_label}`, cell);
      rows.set(cell.true_label, (rows.get(cell.true_label) ?? 0) + cell.count);
      cols.set(cell.pred_label, (cols.get(cell.pred_label) ?? 0) + cell.count);
      if (cell.count > max) max = cell.count;
      if (cell.true_label === cell.pred_label) diagonal += cell.count;
    }

    const total = data.total_samples || Array.from(rows.values()).reduce((sum, v) => sum + v, 0);

    return {
      cellMap: map,
      maxValue: max,
      rowTotals: rows,
      colTotals: cols,
      totalSamples: total,
      accuracy: total > 0 ? diagonal / total : 0,
      displayValues: hasNormalized,
    };
  }, [data]);

  const matrixData = data as ConfusionMatrixData | null | undefined;
  const reason = matrixData?.reason?.trim() || null;

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        <span className="text-sm">Loading confusion matrix...</span>
      </div>
    );
  }

  if (!matrixData || matrixData.cells.length === 0) {
    if (reason) {
      return (
        <StateCard
          icon={AlertCircle}
          title="No confusion matrix available"
          description={reason}
        />
      );
    }

    return (
      <StateCard
        icon={AlertCircle}
        title="No confusion data"
        description="This panel needs classification chains with prediction arrays for the selected partition."
      />
    );
  }

  const { labels } = matrixData;
  if (labels.length === 0) {
    return (
      <StateCard
        icon={AlertCircle}
        title="No class labels found"
        description={reason ?? 'The selected chains did not produce discrete labels for this partition.'}
      />
    );
  }

  const marginLeft = 148;
  const marginRight = 20;
  const marginTop = 86;
  const marginBottom = 86;
  const svgW = Math.max(dims.width, marginLeft + marginRight + labels.length * 46);
  const svgH = Math.max(dims.height, marginTop + marginBottom + labels.length * 38);
  const plotW = svgW - marginLeft - marginRight;
  const plotH = svgH - marginTop - marginBottom;
  const cellW = labels.length > 0 ? plotW / labels.length : 0;
  const cellH = labels.length > 0 ? plotH / labels.length : 0;
  const cellLabelThreshold = cellW > 38 && cellH > 28;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Classification confusion matrix</span>
        <span>{matrixData.partition}</span>
        <span>•</span>
        <span>{matrixData.normalize === 'none' ? 'raw counts' : `normalized: ${matrixData.normalize}`}</span>
        <span>•</span>
        <span>{labels.length} labels</span>
        <span>•</span>
        <span>{totalSamples} samples</span>
        <span>•</span>
        <span>diag accuracy {(accuracy * 100).toFixed(1)}%</span>
      </div>

      {reason && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
          {reason}
        </div>
      )}

      <div ref={viewportRef} className="min-h-0 flex-1 overflow-auto rounded-lg border border-border/60 bg-card/40">
        <svg width={svgW} height={svgH} className="select-none">
          <text
            x={marginLeft + plotW / 2}
            y={18}
            textAnchor="middle"
            className="fill-muted-foreground"
            fontSize={12}
            fontWeight={600}
          >
            Predicted
          </text>
          <text
            x={16}
            y={marginTop + plotH / 2}
            textAnchor="middle"
            className="fill-muted-foreground"
            fontSize={12}
            fontWeight={600}
            transform={`rotate(-90, 16, ${marginTop + plotH / 2})`}
          >
            Actual
          </text>

          <g transform={`translate(${marginLeft}, ${marginTop})`}>
            {labels.map((label, i) => (
              <g key={`col-${label}`}>
                <text
                  x={i * cellW + cellW / 2}
                  y={-18}
                  textAnchor="middle"
                  className="fill-foreground"
                  fontSize={10}
                  fontWeight={500}
                >
                  {formatLabel(label, 14)}
                </text>
                <text
                  x={i * cellW + cellW / 2}
                  y={-6}
                  textAnchor="middle"
                  className="fill-muted-foreground"
                  fontSize={9}
                >
                  {colTotals.get(label) ?? 0}
                </text>
              </g>
            ))}

            {labels.map((label, i) => (
              <g key={`row-${label}`}>
                <text
                  x={-10}
                  y={i * cellH + cellH / 2 - 4}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-foreground"
                  fontSize={10}
                  fontWeight={500}
                >
                  {formatLabel(label, 14)}
                </text>
                <text
                  x={-10}
                  y={i * cellH + cellH / 2 + 9}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-muted-foreground"
                  fontSize={9}
                >
                  {rowTotals.get(label) ?? 0}
                </text>
              </g>
            ))}

            {labels.map((trueLabel, ri) =>
              labels.map((predLabel, ci) => {
                const cell = cellMap.get(`${trueLabel}|${predLabel}`);
                const count = cell?.count ?? 0;
                const normalized = cell?.normalized ?? null;
                const value = displayValues && normalized != null ? normalized : count;
                const color = getBlueColor(value, maxValue);
                const textCol = getTextColor(value, maxValue);
                const isHov = hovered?.true_label === trueLabel && hovered?.pred_label === predLabel;
                const isDiagonal = ri === ci;
                const isEmpty = count === 0;

                return (
                  <g key={`${ri}-${ci}`}>
                    <rect
                      x={ci * cellW + 1}
                      y={ri * cellH + 1}
                      width={Math.max(0, cellW - 2)}
                      height={Math.max(0, cellH - 2)}
                      fill={color}
                      opacity={isHov ? 1 : isEmpty ? 0.65 : 0.92}
                      rx={4}
                      stroke={isHov ? '#ffffff' : isDiagonal ? '#3b82f6' : '#e2e8f0'}
                      strokeWidth={isHov ? 2 : isDiagonal ? 1 : 0.7}
                      onMouseEnter={(e) => setHovered({
                        true_label: trueLabel,
                        pred_label: predLabel,
                        count,
                        normalized,
                        mouseX: e.clientX,
                        mouseY: e.clientY,
                      })}
                      onMouseLeave={() => setHovered(null)}
                    />
                    {cellLabelThreshold && (
                      <text
                        x={ci * cellW + cellW / 2}
                        y={ri * cellH + cellH / 2}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill={textCol}
                        fontSize={Math.min(12, cellH * 0.34, cellW * 0.28)}
                        pointerEvents="none"
                        fontWeight={isDiagonal ? 600 : 500}
                      >
                        {displayValues && normalized != null
                          ? `${(normalized * 100).toFixed(1)}%`
                          : count}
                      </text>
                    )}
                  </g>
                );
              }),
            )}
          </g>
        </svg>
      </div>

      {hovered && (
        <div
          className="fixed z-50 pointer-events-none rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg"
          style={{ left: hovered.mouseX + 12, top: hovered.mouseY - 52 }}
        >
          <div className="font-medium">{hovered.true_label} → {hovered.pred_label}</div>
          <div>Count: {hovered.count}</div>
          {hovered.normalized != null && <div>Normalized: {(hovered.normalized * 100).toFixed(1)}%</div>}
          <div className="mt-1 text-muted-foreground">Total samples: {totalSamples}</div>
        </div>
      )}
    </div>
  );
}

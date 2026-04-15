/**
 * Confusion-matrix chart — ported from ConfusionMatrixChart.tsx with
 * centering/sizing fixes:
 *
 *  - Outer flex container centers the SVG in both axes.
 *  - SVG is always square: size = min(containerW, containerH) - labelReserve.
 *
 * Honors config.confusionNormalize, confusionGradient, confusionShowTotals,
 * confusionShowPercent. Reuses buildConfusionMatrixFromVectors for the math.
 */

import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import {
  buildConfusionMatrixFromVectors,
  type ConfusionMatrixNormalize,
} from "@/components/runs/modelDetailClassification";
import type { ConfusionMatrixCell } from "@/types/inspector";
import { getConfusionFillColor, getContrastTextColor } from "../palettes";
import type { ChartConfig, PartitionDataset } from "../types";

interface PredictionConfusionChartProps {
  datasets: PartitionDataset[];
  config: ChartConfig;
  compact?: boolean;
  className?: string;
}

interface HoveredCell {
  true_label: string;
  pred_label: string;
  count: number;
  normalized: number | null;
  mouseX: number;
  mouseY: number;
}

function formatLabel(label: string, maxLength = 12): string {
  return label.length > maxLength ? `${label.slice(0, maxLength - 1)}…` : label;
}

function toMatrixNormalize(n: ChartConfig["confusionNormalize"]): ConfusionMatrixNormalize {
  if (n === "row") return "row";
  if (n === "col") return "column";
  return "none";
}

export const PredictionConfusionChart = forwardRef<HTMLDivElement, PredictionConfusionChartProps>(
  function PredictionConfusionChart({ datasets, config, compact, className }, ref) {
    const viewportRef = useRef<HTMLDivElement>(null);
    const [hovered, setHovered] = useState<HoveredCell | null>(null);
    const [dims, setDims] = useState({ width: 400, height: 400 });

    useEffect(() => {
      const el = viewportRef.current;
      if (!el) return;
      const update = () => {
        setDims({
          width: Math.max(1, el.clientWidth),
          height: Math.max(1, el.clientHeight),
        });
      };
      update();
      const obs = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) {
          setDims({
            width: Math.max(1, entry.contentRect.width),
            height: Math.max(1, entry.contentRect.height),
          });
        }
      });
      obs.observe(el);
      return () => obs.disconnect();
    }, []);

    const matrix = useMemo(() => {
      const yTrue: number[] = [];
      const yPred: number[] = [];
      for (const d of datasets) {
        const n = Math.min(d.yTrue.length, d.yPred.length);
        for (let i = 0; i < n; i++) {
          yTrue.push(d.yTrue[i]);
          yPred.push(d.yPred[i]);
        }
      }
      return buildConfusionMatrixFromVectors({
        yTrue,
        yPred,
        normalize: toMatrixNormalize(config.confusionNormalize),
        partitionLabel: "pooled",
      });
    }, [datasets, config.confusionNormalize]);

    const { cellMap, maxValue, rowTotals, colTotals, totalSamples } = useMemo(() => {
      const map = new Map<string, ConfusionMatrixCell>();
      const rows = new Map<string, number>();
      const cols = new Map<string, number>();
      let max = 0;
      for (const cell of matrix.cells) {
        map.set(`${cell.true_label}|${cell.pred_label}`, cell);
        rows.set(cell.true_label, (rows.get(cell.true_label) ?? 0) + cell.count);
        cols.set(cell.pred_label, (cols.get(cell.pred_label) ?? 0) + cell.count);
        if (cell.count > max) max = cell.count;
      }
      return {
        cellMap: map,
        maxValue: max,
        rowTotals: rows,
        colTotals: cols,
        totalSamples: matrix.total_samples,
      };
    }, [matrix]);

    if (matrix.cells.length === 0 || matrix.labels.length === 0) {
      return (
        <div
          ref={ref}
          className={className ?? "flex h-full w-full items-center justify-center p-4"}
        >
          <div className="max-w-sm rounded-xl border border-border/60 bg-card/70 p-4 text-center shadow-sm">
            <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
              <AlertCircle className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="text-sm font-medium text-foreground">No confusion data</div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              {matrix.reason ??
                "The selected partitions did not produce discrete labels for this task."}
            </div>
          </div>
        </div>
      );
    }

    const labels = matrix.labels;
    const showTotals = config.confusionShowTotals && !compact;
    const labelReserve = compact ? 8 : (showTotals ? 110 : 70);
    const topReserve = compact ? 8 : 60;
    const squareSide = Math.max(40, Math.min(dims.width, dims.height) - labelReserve);
    const plotSide = squareSide;
    const cellSize = labels.length > 0 ? plotSide / labels.length : 0;
    const cellLabelThreshold = cellSize > 28;

    const svgW = plotSide + labelReserve;
    const svgH = plotSide + topReserve;
    const marginLeft = labelReserve;
    const marginTop = topReserve;

    return (
      <div
        ref={ref}
        className={className ?? "flex h-full w-full items-center justify-center"}
      >
        <div
          ref={viewportRef}
          className="flex h-full w-full items-center justify-center"
        >
          <svg width={svgW} height={svgH} className="select-none">
            {!compact && (
              <>
                <text
                  x={marginLeft + plotSide / 2}
                  y={16}
                  textAnchor="middle"
                  className="fill-muted-foreground"
                  fontSize={12}
                  fontWeight={600}
                >
                  Predicted
                </text>
                <text
                  x={12}
                  y={marginTop + plotSide / 2}
                  textAnchor="middle"
                  className="fill-muted-foreground"
                  fontSize={12}
                  fontWeight={600}
                  transform={`rotate(-90, 12, ${marginTop + plotSide / 2})`}
                >
                  Actual
                </text>
              </>
            )}

            <g transform={`translate(${marginLeft}, ${marginTop})`}>
              {!compact &&
                labels.map((label, i) => (
                  <g key={`col-${label}`}>
                    <text
                      x={i * cellSize + cellSize / 2}
                      y={-18}
                      textAnchor="middle"
                      className="fill-foreground"
                      fontSize={10}
                      fontWeight={500}
                    >
                      {formatLabel(label, 14)}
                    </text>
                    {showTotals && (
                      <text
                        x={i * cellSize + cellSize / 2}
                        y={-6}
                        textAnchor="middle"
                        className="fill-muted-foreground"
                        fontSize={9}
                      >
                        {colTotals.get(label) ?? 0}
                      </text>
                    )}
                  </g>
                ))}

              {!compact &&
                labels.map((label, i) => (
                  <g key={`row-${label}`}>
                    <text
                      x={-10}
                      y={i * cellSize + cellSize / 2 - (showTotals ? 4 : 0)}
                      textAnchor="end"
                      dominantBaseline="middle"
                      className="fill-foreground"
                      fontSize={10}
                      fontWeight={500}
                    >
                      {formatLabel(label, 14)}
                    </text>
                    {showTotals && (
                      <text
                        x={-10}
                        y={i * cellSize + cellSize / 2 + 9}
                        textAnchor="end"
                        dominantBaseline="middle"
                        className="fill-muted-foreground"
                        fontSize={9}
                      >
                        {rowTotals.get(label) ?? 0}
                      </text>
                    )}
                  </g>
                ))}

              {labels.map((trueLabel, ri) =>
                labels.map((predLabel, ci) => {
                  const cell = cellMap.get(`${trueLabel}|${predLabel}`);
                  const count = cell?.count ?? 0;
                  const normalized = cell?.normalized ?? null;
                  const intensityValue =
                    config.confusionNormalize !== "none" && normalized != null
                      ? normalized
                      : maxValue > 0
                      ? count / maxValue
                      : 0;
                  const color = getConfusionFillColor(intensityValue, config.confusionGradient);
                  const textCol = getContrastTextColor(color);
                  const isHov =
                    hovered?.true_label === trueLabel && hovered?.pred_label === predLabel;
                  const isDiagonal = ri === ci;
                  const isEmpty = count === 0;

                  const cellW = cellSize;
                  const cellH = cellSize;

                  let cellText: string | null = null;
                  if (cellLabelThreshold) {
                    if (config.confusionShowPercent && normalized != null) {
                      cellText = `${count} (${(normalized * 100).toFixed(1)}%)`;
                    } else if (config.confusionNormalize !== "none" && normalized != null) {
                      cellText = `${(normalized * 100).toFixed(1)}%`;
                    } else {
                      cellText = String(count);
                    }
                  }

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
                        stroke={
                          isHov ? "#0f172a" : isDiagonal ? config.confusionGradient.high : "#e2e8f0"
                        }
                        strokeWidth={isHov ? 2 : isDiagonal ? 1 : 0.7}
                        onMouseEnter={(e) =>
                          setHovered({
                            true_label: trueLabel,
                            pred_label: predLabel,
                            count,
                            normalized,
                            mouseX: e.clientX,
                            mouseY: e.clientY,
                          })
                        }
                        onMouseLeave={() => setHovered(null)}
                      />
                      {cellText && (
                        <text
                          x={ci * cellW + cellW / 2}
                          y={ri * cellH + cellH / 2}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill={textCol}
                          fontSize={Math.min(12, cellH * 0.32, cellW * 0.22)}
                          pointerEvents="none"
                          fontWeight={isDiagonal ? 600 : 500}
                        >
                          {cellText}
                        </text>
                      )}
                    </g>
                  );
                }),
              )}
            </g>
          </svg>

          {hovered && !compact && (
            <div
              className="fixed z-50 pointer-events-none rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg"
              style={{ left: hovered.mouseX + 12, top: hovered.mouseY - 52 }}
            >
              <div className="font-medium">
                {hovered.true_label} → {hovered.pred_label}
              </div>
              <div>Count: {hovered.count}</div>
              {hovered.normalized != null && (
                <div>Normalized: {(hovered.normalized * 100).toFixed(1)}%</div>
              )}
              <div className="mt-1 text-muted-foreground">Total samples: {totalSamples}</div>
            </div>
          )}
        </div>
      </div>
    );
  },
);

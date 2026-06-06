/**
 * SpectraChart - Main spectra visualization component
 *
 * A responsive Recharts-based visualization for synthetic NIRS data.
 * Features:
 * - Multiple spectra lines with target-based coloring
 * - Optional mean spectrum overlay
 * - Optional standard deviation band
 * - Configurable appearance
 */

import { useMemo } from "react";
import { Line, Tooltip, type TooltipProps } from "recharts";
import type { PreviewData } from "../contexts";
import { cn } from "@/lib/utils";
import {
  formatWavelengthUnit,
  getWavelengthAxisLabel,
} from "@/components/playground/visualizations/chartConfig";
import { BaseSpectraChart, SPECTRA_CHART_THEME } from "@/components/charts/BaseSpectraChart";

// Custom tooltip that shows only aggregate stats (not individual spectra)
function CustomTooltip({
  active,
  payload,
  label,
  unitSymbol,
}: TooltipProps<number, string> & { unitSymbol: string }) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  // Find mean, upper, lower from payload
  const meanEntry = payload.find((p) => p.dataKey === "mean");
  const upperEntry = payload.find((p) => p.dataKey === "upper");
  const lowerEntry = payload.find((p) => p.dataKey === "lower");

  const mean = meanEntry?.value as number | undefined;
  const upper = upperEntry?.value as number | undefined;
  const lower = lowerEntry?.value as number | undefined;

  return (
    <div className="bg-popover border border-border rounded-md px-3 py-2 shadow-md">
      <div className="text-xs font-medium text-foreground mb-1">
        {Math.round(label as number)}
        {unitSymbol ? ` ${unitSymbol}` : ""}
      </div>
      <div className="space-y-0.5 text-xs">
        {mean !== undefined && (
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Mean:</span>
            <span className="font-mono">{mean.toFixed(4)}</span>
          </div>
        )}
        {upper !== undefined && lower !== undefined && (
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Range:</span>
            <span className="font-mono">
              {lower.toFixed(3)} - {upper.toFixed(3)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

interface SpectraChartProps {
  data: PreviewData;
  showMean?: boolean;
  showStdBand?: boolean;
  maxSpectraLines?: number;
  className?: string;
  /**
   * Wavelength axis unit (e.g. "nm", "cm-1"). Drives the X-axis label and
   * tooltip suffix via the shared chartConfig helpers. Synthetic spectra are
   * generated in nm, so this defaults to "nm".
   */
  unit?: string;
}

export function getColorForTarget(
  target: number,
  targetType: "regression" | "classification",
  minTarget: number,
  maxTarget: number
): string {
  if (targetType === "classification") {
    const classColors = [
      "#3b82f6", // blue
      "#ef4444", // red
      "#22c55e", // green
      "#f59e0b", // amber
      "#8b5cf6", // violet
      "#ec4899", // pink
      "#06b6d4", // cyan
      "#f97316", // orange
    ];
    const classIndex = Math.floor(target) % classColors.length;
    return classColors[classIndex];
  }

  // Continuous color scale for regression (blue to red)
  const normalizedTarget =
    maxTarget !== minTarget
      ? (target - minTarget) / (maxTarget - minTarget)
      : 0.5;

  const r = Math.round(normalizedTarget * 239 + (1 - normalizedTarget) * 59);
  const g = Math.round(normalizedTarget * 68 + (1 - normalizedTarget) * 130);
  const b = Math.round(normalizedTarget * 68 + (1 - normalizedTarget) * 246);

  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Compute the merged Recharts rows for the synthesis chart from RAW spectra.
 *
 * Calculates the per-wavelength mean and ±1σ band, samples up to
 * `maxSpectraLines` individual spectra (evenly spaced when over the cap), and
 * returns the merged rows plus the per-sampled-line colours (ordered).
 */
export function buildSynthesisChartData(
  data: PreviewData,
  maxSpectraLines: number,
): { mergedData: Array<Record<string, number>>; lineColors: string[] } {
  const { spectra, wavelengths, targets, target_type } = data;

  if (spectra.length === 0 || wavelengths.length === 0) {
    return { mergedData: [], lineColors: [] };
  }

  const numWavelengths = wavelengths.length;
  const numSpectra = spectra.length;

  const minTarget = Math.min(...targets);
  const maxTarget = Math.max(...targets);

  // Calculate mean and std at each wavelength
  const means: number[] = [];
  const stds: number[] = [];

  for (let w = 0; w < numWavelengths; w++) {
    let sum = 0;
    for (let s = 0; s < numSpectra; s++) {
      sum += spectra[s][w];
    }
    const mean = sum / numSpectra;
    means.push(mean);

    let variance = 0;
    for (let s = 0; s < numSpectra; s++) {
      variance += Math.pow(spectra[s][w] - mean, 2);
    }
    const std = Math.sqrt(variance / numSpectra);
    stds.push(std);
  }

  // Sample spectra for individual lines
  const sampleIndices: number[] = [];
  if (numSpectra <= maxSpectraLines) {
    for (let i = 0; i < numSpectra; i++) {
      sampleIndices.push(i);
    }
  } else {
    const step = numSpectra / maxSpectraLines;
    for (let i = 0; i < maxSpectraLines; i++) {
      sampleIndices.push(Math.floor(i * step));
    }
  }

  const lineColors = sampleIndices.map((idx) =>
    getColorForTarget(targets[idx], target_type, minTarget, maxTarget),
  );

  const mergedData = wavelengths.map((wl, i) => {
    const entry: Record<string, number> = {
      wavelength: wl,
      mean: means[i],
      upper: means[i] + stds[i],
      lower: means[i] - stds[i],
    };
    sampleIndices.forEach((sampleIdx, sIdx) => {
      entry[`spectrum_${sIdx}`] = spectra[sampleIdx][i];
    });
    return entry;
  });

  return { mergedData, lineColors };
}

export function SpectraChart({
  data,
  showMean = true,
  showStdBand = true,
  maxSpectraLines = 50,
  className,
  unit = "nm",
}: SpectraChartProps) {
  const { mergedData, lineColors } = useMemo(
    () => buildSynthesisChartData(data, maxSpectraLines),
    [data, maxSpectraLines],
  );

  if (mergedData.length === 0) {
    return (
      <div className={cn("flex items-center justify-center h-full", className)}>
        <p className="text-muted-foreground">No data to display</p>
      </div>
    );
  }

  const unitSymbol = formatWavelengthUnit(unit);

  return (
    <div className={cn("w-full h-full", className)}>
      <BaseSpectraChart
        data={mergedData}
        margin={{ top: 10, right: 20, left: 0, bottom: 30 }}
        unit={unit}
        gridOpacity={0.5}
        xLabel={{ value: getWavelengthAxisLabel(unit), offset: -20, fontSize: 11 }}
        yLabel={{ value: "Absorbance", fontSize: 11 }}
        xAxisProps={{ stroke: SPECTRA_CHART_THEME.axisText, fontSize: 11 }}
        yAxisProps={{ stroke: SPECTRA_CHART_THEME.axisText, fontSize: 11 }}
        xTickFormatter={(v) => `${Math.round(v)}`}
        yTickFormatter={(v) => v.toFixed(2)}
        tooltip={<Tooltip content={<CustomTooltip unitSymbol={unitSymbol} />} />}
      >
        {/* Individual spectra lines */}
        {lineColors.map((color, idx) => (
          <Line
            key={`spectrum_${idx}`}
            dataKey={`spectrum_${idx}`}
            type="monotone"
            stroke={color}
            strokeWidth={1}
            strokeOpacity={0.3}
            dot={false}
            isAnimationActive={false}
          />
        ))}

        {/* Standard deviation lines */}
        {showStdBand && (
          <Line
            dataKey="upper"
            type="monotone"
            stroke={SPECTRA_CHART_THEME.line}
            strokeWidth={1}
            strokeDasharray="4 3"
            strokeOpacity={0.5}
            dot={false}
            isAnimationActive={false}
          />
        )}
        {showStdBand && (
          <Line
            dataKey="lower"
            type="monotone"
            stroke={SPECTRA_CHART_THEME.line}
            strokeWidth={1}
            strokeDasharray="4 3"
            strokeOpacity={0.5}
            dot={false}
            isAnimationActive={false}
          />
        )}

        {/* Mean line */}
        {showMean && (
          <Line
            dataKey="mean"
            type="monotone"
            stroke={SPECTRA_CHART_THEME.line}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        )}
      </BaseSpectraChart>
    </div>
  );
}

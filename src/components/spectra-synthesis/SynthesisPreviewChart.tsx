/**
 * SynthesisPreviewChart
 *
 * A simple spectra chart for displaying synthetic NIRS data preview.
 * Uses Recharts for visualization with support for:
 * - Multiple spectra lines with configurable opacity
 * - Mean spectrum overlay
 * - Target coloring (regression/classification)
 * - Responsive layout
 */

import { useMemo } from "react";
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  Legend,
  Area,
} from "recharts";
import type { PreviewData } from "./contexts";

// ============= Types =============

interface SynthesisPreviewChartProps {
  data: PreviewData;
  showMean?: boolean;
  showStdBand?: boolean;
  maxSpectraLines?: number;
  className?: string;
}

// ============= Color Utilities =============

function getColorForTarget(
  target: number,
  targetType: "regression" | "classification",
  minTarget: number,
  maxTarget: number,
  classCount?: number
): string {
  if (targetType === "classification") {
    // Use categorical colors for classification
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

  // Interpolate between blue (0) and red (1)
  const r = Math.round(normalizedTarget * 239 + (1 - normalizedTarget) * 59);
  const g = Math.round(normalizedTarget * 68 + (1 - normalizedTarget) * 130);
  const b = Math.round(normalizedTarget * 68 + (1 - normalizedTarget) * 246);

  return `rgb(${r}, ${g}, ${b})`;
}

// ============= Component =============

export function SynthesisPreviewChart({
  data,
  showMean = true,
  showStdBand = true,
  maxSpectraLines = 50,
  className,
}: SynthesisPreviewChartProps) {
  // Process data for chart
  const chartData = useMemo(() => {
    const { spectra, wavelengths, targets, target_type } = data;

    if (spectra.length === 0 || wavelengths.length === 0) {
      return { points: [], meanLine: [], spectraLines: [] };
    }

    const numWavelengths = wavelengths.length;
    const numSpectra = spectra.length;

    // Calculate target range for color mapping
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

    // Build data points for mean/std
    const points = wavelengths.map((wl, i) => ({
      wavelength: wl,
      mean: means[i],
      upper: means[i] + stds[i],
      lower: means[i] - stds[i],
    }));

    // Sample spectra for individual lines (to avoid overwhelming the chart)
    const sampleIndices: number[] = [];
    if (numSpectra <= maxSpectraLines) {
      for (let i = 0; i < numSpectra; i++) {
        sampleIndices.push(i);
      }
    } else {
      // Stratified sampling based on target values
      const step = numSpectra / maxSpectraLines;
      for (let i = 0; i < maxSpectraLines; i++) {
        sampleIndices.push(Math.floor(i * step));
      }
    }

    // Build spectra lines data
    const spectraLines = sampleIndices.map((idx) => ({
      index: idx,
      target: targets[idx],
      color: getColorForTarget(
        targets[idx],
        target_type,
        minTarget,
        maxTarget
      ),
      data: wavelengths.map((wl, w) => ({
        wavelength: wl,
        value: spectra[idx][w],
      })),
    }));

    return { points, spectraLines, minTarget, maxTarget };
  }, [data, maxSpectraLines]);

  if (chartData.points.length === 0) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <p className="text-muted-foreground">No data to display</p>
      </div>
    );
  }

  // Prepare merged data for Recharts
  const mergedData = chartData.points.map((point, idx) => {
    const entry: Record<string, number> = {
      wavelength: point.wavelength,
      mean: point.mean,
      upper: point.upper,
      lower: point.lower,
    };

    // Add individual spectra values
    chartData.spectraLines.forEach((spectrum, sIdx) => {
      entry[`spectrum_${sIdx}`] = spectrum.data[idx].value;
    });

    return entry;
  });

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={mergedData}
          margin={{ top: 10, right: 30, left: 10, bottom: 10 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
          <XAxis
            dataKey="wavelength"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(v) => `${Math.round(v)}`}
            stroke="hsl(var(--muted-foreground))"
            fontSize={11}
            label={{
              value: "Wavelength (nm)",
              position: "insideBottom",
              offset: -5,
              fontSize: 11,
              fill: "hsl(var(--muted-foreground))",
            }}
          />
          <YAxis
            stroke="hsl(var(--muted-foreground))"
            fontSize={11}
            tickFormatter={(v) => v.toFixed(2)}
            label={{
              value: "Absorbance",
              angle: -90,
              position: "insideLeft",
              fontSize: 11,
              fill: "hsl(var(--muted-foreground))",
            }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "6px",
              fontSize: 12,
            }}
            labelFormatter={(label) => `Wavelength: ${Math.round(label as number)} nm`}
            formatter={(value: number) => [value.toFixed(4), "Absorbance"]}
          />

          {/* Individual spectra lines */}
          {chartData.spectraLines.map((spectrum, idx) => (
            <Line
              key={`spectrum_${idx}`}
              dataKey={`spectrum_${idx}`}
              type="monotone"
              stroke={spectrum.color}
              strokeWidth={1}
              strokeOpacity={0.3}
              dot={false}
              isAnimationActive={false}
            />
          ))}

          {/* Standard deviation band */}
          {showStdBand && (
            <Area
              dataKey="upper"
              type="monotone"
              stroke="none"
              fill="hsl(var(--primary))"
              fillOpacity={0.1}
            />
          )}
          {showStdBand && (
            <Area
              dataKey="lower"
              type="monotone"
              stroke="none"
              fill="hsl(var(--background))"
              fillOpacity={1}
            />
          )}

          {/* Mean line */}
          {showMean && (
            <Line
              dataKey="mean"
              type="monotone"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * SpectraChart - Recharts-based spectral visualization component
 *
 * Displays mean spectrum with optional min/max range shading.
 * Used in dataset previews and quick views.
 */
import { useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  formatWavelengthUnit,
  getWavelengthAxisLabel,
  getWavelengthAxisName,
} from "@/components/playground/visualizations/chartConfig";

export interface SpectraChartProps {
  /** Array of wavelength values for the x-axis */
  wavelengths: number[];
  /** Mean spectrum values */
  meanSpectrum: number[];
  /** Standard deviation values (optional) */
  stdSpectrum?: number[];
  /** Minimum spectrum values for range display (optional) */
  minSpectrum?: number[];
  /** Maximum spectrum values for range display (optional) */
  maxSpectrum?: number[];
  /** Chart width (default: 100%) */
  width?: number | string;
  /** Chart height (default: 200) */
  height?: number | string;
  /**
   * Override the X-axis label entirely. When omitted, the label is derived
   * from `unit` so cm⁻¹ datasets render "Wavenumber (cm⁻¹)" instead of being
   * mislabelled as nm.
   */
  xLabel?: string;
  /** Y-axis label (default: none) */
  yLabel?: string;
  /**
   * Wavelength axis unit (e.g. "nm", "cm-1") as detected by nirs4all from the
   * dataset headers. Used to derive the X-axis label and tooltip text when
   * `xLabel` is not explicitly set.
   */
  unit?: string;
  /** Show axis labels (default: true) */
  showLabels?: boolean;
  /** Mean line color override (default: primary) */
  lineColor?: string;
  /** Range fill color override (default: primary with low opacity) */
  rangeFillColor?: string;
}

export function SpectraChart({
  wavelengths,
  meanSpectrum,
  stdSpectrum,
  minSpectrum,
  maxSpectrum,
  width = "100%",
  height = 200,
  xLabel,
  yLabel,
  unit,
  showLabels = true,
  lineColor,
  rangeFillColor,
}: SpectraChartProps) {
  const resolvedXLabel = xLabel ?? getWavelengthAxisLabel(unit);
  const axisName = getWavelengthAxisName(unit);
  const unitSymbol = formatWavelengthUnit(unit);
  const tooltipUnitSuffix = unitSymbol ? ` ${unitSymbol}` : "";
  // Transform data for Recharts
  const data = useMemo(() => {
    if (!wavelengths?.length || !meanSpectrum?.length) return [];
    return wavelengths.map((w, i) => {
      const point: Record<string, number | number[]> = { wavelength: w, mean: meanSpectrum[i] };
      if (minSpectrum && maxSpectrum) {
        point.range = [minSpectrum[i], maxSpectrum[i]];
      }
      return point;
    });
  }, [wavelengths, meanSpectrum, minSpectrum, maxSpectrum]);

  // Handle empty data
  if (!wavelengths?.length || !meanSpectrum?.length) {
    return (
      <div
        className="flex items-center justify-center text-muted-foreground text-sm"
        style={{ width, height }}
      >
        No spectra data available
      </div>
    );
  }

  const defaultColor = "hsl(var(--primary))";
  const strokeColor = lineColor ?? defaultColor;
  const fillColor = rangeFillColor ?? defaultColor;
  const fillOpacity = rangeFillColor ? 1 : 0.15;

  return (
    <div style={{ width, height }} className="min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={data}
          margin={{
            top: 20,
            right: 20,
            left: -15, // Compress padding
            bottom: showLabels ? 20 : 5,
          }}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
          <XAxis
            dataKey="wavelength"
            type="number"
            domain={["dataMin", "dataMax"]}
            minTickGap={30}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false}
            axisLine={{ stroke: "hsl(var(--border))" }}
            tickFormatter={(value) => Number(value).toFixed(0)}
            label={
              showLabels && resolvedXLabel
                ? {
                    value: resolvedXLabel,
                    position: "insideBottom",
                    offset: -15,
                    fill: "hsl(var(--muted-foreground))",
                    fontSize: 12,
                  }
                : undefined
            }
          />
          <YAxis
            type="number"
            domain={["auto", "auto"]}
            tickFormatter={(value) => {
               // Handle large or very small numbers
               if (value === 0) return "0";
               if (Math.abs(value) >= 1000 || Math.abs(value) < 0.01) {
                  return value.toExponential(1);
               }
               return value.toFixed(1);
            }}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false}
            axisLine={false}
            width={45}
            allowDecimals={true}
            label={
               showLabels && yLabel
                 ? {
                     value: yLabel,
                     angle: -90,
                     position: "insideLeft",
                     fill: "hsl(var(--muted-foreground))",
                     fontSize: 12,
                   }
                 : undefined
             }
          />
          <Tooltip
            contentStyle={{
              borderRadius: "var(--radius)",
              border: "1px solid hsl(var(--border))",
              backgroundColor: "hsl(var(--background))",
              fontSize: "12px",
              boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
            }}
            itemStyle={{ color: "hsl(var(--foreground))" }}
            labelStyle={{ color: "hsl(var(--foreground))", fontWeight: "bold", marginBottom: "4px" }}
            labelFormatter={(label) => `${axisName}: ${label}${tooltipUnitSuffix}`}
            formatter={(value: unknown, name: string) => {
              if (name === "range") {
                const [lo, hi] = Array.isArray(value) ? value : [value, value];
                return [`[${Number(lo).toFixed(3)}, ${Number(hi).toFixed(3)}]`, "Min/Max"];
              }
              return [typeof value === "number" ? value.toFixed(3) : value, "Mean"];
            }}
          />
          {minSpectrum && maxSpectrum && (
            <Area
              type="monotone"
              dataKey="range"
              stroke="none"
              fill={fillColor}
              fillOpacity={fillOpacity}
              activeDot={false}
            />
          )}
          <Line
            type="monotone"
            dataKey="mean"
            stroke={strokeColor}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0, fill: strokeColor }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

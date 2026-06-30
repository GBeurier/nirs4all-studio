/**
 * SpectraChart - Recharts-based spectral visualization component
 *
 * Displays mean spectrum with optional min/max range shading.
 * Used in dataset previews and quick views.
 */
import { useMemo } from "react";
import { Area, Line, Tooltip } from "recharts";
import {
  formatWavelengthUnit,
  getWavelengthAxisLabel,
  getWavelengthAxisName,
} from "@/components/playground/visualizations/chartConfig";
import { BaseSpectraChart, SPECTRA_CHART_THEME } from "@/components/charts/BaseSpectraChart";
import { buildSpectraChartData } from "./spectraChartData";

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
  const data = useMemo(
    () => buildSpectraChartData(wavelengths, meanSpectrum, minSpectrum, maxSpectrum),
    [wavelengths, meanSpectrum, minSpectrum, maxSpectrum],
  );

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

  const defaultColor = SPECTRA_CHART_THEME.line;
  const strokeColor = lineColor ?? defaultColor;
  const fillColor = rangeFillColor ?? defaultColor;
  const fillOpacity = rangeFillColor ? 1 : 0.15;

  return (
    <div style={{ width, height }} className="min-w-0">
      <BaseSpectraChart
        data={data}
        margin={{ top: 20, right: 20, left: -15, bottom: showLabels ? 20 : 5 }}
        unit={unit}
        gridVertical={false}
        xLabel={
          showLabels && resolvedXLabel ? { value: resolvedXLabel, offset: -15, fontSize: 12 } : null
        }
        yLabel={showLabels && yLabel ? { value: yLabel, fontSize: 12 } : undefined}
        xAxisProps={{
          minTickGap: 30,
          tick: { fontSize: 11, fill: SPECTRA_CHART_THEME.axisText },
          tickLine: false,
          axisLine: { stroke: SPECTRA_CHART_THEME.axisLine },
        }}
        yAxisProps={{
          domain: ["auto", "auto"],
          tick: { fontSize: 11, fill: SPECTRA_CHART_THEME.axisText },
          tickLine: false,
          axisLine: false,
          width: 45,
        }}
        xTickFormatter={(value) => Number(value).toFixed(0)}
        yTickFormatter={(value) => {
          // Handle large or very small numbers
          if (value === 0) return "0";
          if (Math.abs(value) >= 1000 || Math.abs(value) < 0.01) {
            return value.toExponential(1);
          }
          return value.toFixed(1);
        }}
        tooltip={
          <Tooltip<number | string | Array<number | string>, string>
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
            formatter={(value, name) => {
              if (name === "range") {
                const [lo, hi] = Array.isArray(value) ? value : [value, value];
                return [`[${Number(lo).toFixed(3)}, ${Number(hi).toFixed(3)}]`, "Min/Max"];
              }
              return [typeof value === "number" ? value.toFixed(3) : value, "Mean"];
            }}
          />
        }
      >
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
      </BaseSpectraChart>
    </div>
  );
}

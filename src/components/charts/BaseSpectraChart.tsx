/**
 * BaseSpectraChart - shared Recharts shell for NIRS spectra charts.
 *
 * Owns the ResponsiveContainer/ComposedChart/CartesianGrid/XAxis/YAxis scaffold
 * that the dataset and spectra-synthesis charts both rendered independently, plus
 * the `hsl(var(--*))` theme tokens and the unit-aware X-axis label derivation so
 * unit handling lives in one place. Per-axis styling that legitimately differs
 * between the two charts is passed through via `xAxisProps`/`yAxisProps`.
 *
 * This is the chart shell only — it does NOT own the data contract. Aggregated
 * (mean/min/max) and raw (spectra[][]) inputs are prepared by each caller and
 * passed in as the already-merged Recharts `data` array, with the series and
 * tooltip supplied as `children`/`tooltip`.
 */
import type { ComponentProps, ReactNode } from "react";
import {
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { getWavelengthAxisLabel } from "@/components/playground/visualizations/chartConfig";

/** Shared CSS-variable theme tokens used by the spectra charts. */
export const SPECTRA_CHART_THEME = {
  grid: "hsl(var(--border))",
  axisLine: "hsl(var(--border))",
  axisText: "hsl(var(--muted-foreground))",
  line: "hsl(var(--primary))",
} as const;

export interface BaseSpectraChartProps {
  /** Pre-merged Recharts rows (each keyed by `wavelength` + series). */
  data: Array<Record<string, number | number[]>>;
  margin: { top: number; right: number; left: number; bottom: number };
  /** Wavelength unit (e.g. "nm", "cm-1"); derives the X-axis label when no `xLabel.value` is given. */
  unit?: string;
  /** X-axis label; `value` defaults to getWavelengthAxisLabel(unit), `null` hides it. */
  xLabel?: (AxisLabelProps & { value?: string }) | null;
  /** Y-axis label, or `null`/omitted to hide it. */
  yLabel?: AxisLabelProps & { value: string };
  gridOpacity?: number;
  /** CartesianGrid vertical lines (default true). */
  gridVertical?: boolean;
  /** Per-chart <XAxis>/<YAxis> styling overrides (stroke, tick, axisLine, domain, width, ...). */
  xAxisProps?: Partial<ComponentProps<typeof XAxis>>;
  yAxisProps?: Partial<ComponentProps<typeof YAxis>>;
  xTickFormatter: (value: number) => string;
  yTickFormatter: (value: number) => string;
  /** The Recharts <Tooltip> element. */
  tooltip: ReactNode;
  /** Series elements (<Line>, <Area>, ...). */
  children: ReactNode;
}

/** Recharts axis-label fields the spectra charts customise. */
interface AxisLabelProps {
  offset?: number;
  fontSize?: number;
}

export function BaseSpectraChart({
  data,
  margin,
  unit,
  xLabel,
  yLabel,
  gridOpacity,
  gridVertical = true,
  xAxisProps,
  yAxisProps,
  xTickFormatter,
  yTickFormatter,
  tooltip,
  children,
}: BaseSpectraChartProps) {
  const theme = SPECTRA_CHART_THEME;

  const xAxisLabel =
    xLabel === null
      ? undefined
      : {
          position: "insideBottom" as const,
          fill: theme.axisText,
          ...xLabel,
          value: xLabel?.value ?? getWavelengthAxisLabel(unit),
        };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={margin}>
        <CartesianGrid
          strokeDasharray="3 3"
          vertical={gridVertical}
          stroke={theme.grid}
          opacity={gridOpacity}
        />
        <XAxis
          dataKey="wavelength"
          type="number"
          domain={["dataMin", "dataMax"]}
          tickFormatter={xTickFormatter}
          label={xAxisLabel}
          {...xAxisProps}
        />
        <YAxis
          type="number"
          tickFormatter={yTickFormatter}
          allowDecimals
          label={
            yLabel
              ? { angle: -90, position: "insideLeft", fill: theme.axisText, ...yLabel }
              : undefined
          }
          {...yAxisProps}
        />
        {tooltip}
        {children}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

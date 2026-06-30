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
import { Tooltip } from "recharts";
import type { PreviewData } from "../contexts";
import { cn } from "@/lib/utils";
import {
  formatWavelengthUnit,
  getWavelengthAxisLabel,
} from "@/components/playground/visualizations/chartConfig";
import { BaseSpectraChart, SPECTRA_CHART_THEME } from "@/components/charts/BaseSpectraChart";
import {
  renderIndividualSpectraLines,
  renderMeanLine,
  renderStandardDeviationLines,
  SynthesisChartTooltip,
} from "./SpectraChartLayers";
import { buildSynthesisChartData } from "./synthesisChartData";

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
        tooltip={<Tooltip content={<SynthesisChartTooltip unitSymbol={unitSymbol} />} />}
      >
        {renderIndividualSpectraLines(lineColors)}
        {showStdBand && renderStandardDeviationLines()}
        {showMean && renderMeanLine()}
      </BaseSpectraChart>
    </div>
  );
}

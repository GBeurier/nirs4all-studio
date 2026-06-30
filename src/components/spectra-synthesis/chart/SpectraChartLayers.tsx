/* eslint-disable react-refresh/only-export-components */
import { Line, type TooltipProps } from "recharts";

import { SPECTRA_CHART_THEME } from "@/components/charts/BaseSpectraChart";

export function SynthesisChartTooltip({
  active,
  payload,
  label,
  unitSymbol,
}: TooltipProps<number, string> & { unitSymbol: string }) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

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

export function renderIndividualSpectraLines(lineColors: string[]) {
  return lineColors.map((color, idx) => (
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
  ));
}

export function renderStandardDeviationLines() {
  return [
    <Line
      key="upper"
      dataKey="upper"
      type="monotone"
      stroke={SPECTRA_CHART_THEME.line}
      strokeWidth={1}
      strokeDasharray="4 3"
      strokeOpacity={0.5}
      dot={false}
      isAnimationActive={false}
    />,
    <Line
      key="lower"
      dataKey="lower"
      type="monotone"
      stroke={SPECTRA_CHART_THEME.line}
      strokeWidth={1}
      strokeDasharray="4 3"
      strokeOpacity={0.5}
      dot={false}
      isAnimationActive={false}
    />,
  ];
}

export function renderMeanLine() {
  return (
    <Line
      key="mean"
      dataKey="mean"
      type="monotone"
      stroke={SPECTRA_CHART_THEME.line}
      strokeWidth={2}
      dot={false}
      isAnimationActive={false}
    />
  );
}

import { formatYValue } from './chartConfig';
import type { RepetitionsPlotDataPoint } from '@/lib/playground/repetitionsChartData';

export interface RepetitionsChartTooltipPayloadEntry {
  payload?: RepetitionsPlotDataPoint;
}

export interface RepetitionsChartTooltipProps {
  enableHover: boolean;
  active?: boolean;
  payload?: RepetitionsChartTooltipPayloadEntry[];
}

export function RepetitionsChartTooltip({
  enableHover,
  active,
  payload,
}: RepetitionsChartTooltipProps) {
  if (!enableHover || !active || !payload || payload.length === 0) {
    return null;
  }

  const point = payload[0]?.payload;
  if (!point) {
    return null;
  }

  return (
    <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-xs max-w-[200px]">
      <p className="font-medium mb-1 truncate">{point.bioSample}</p>
      <div className="space-y-0.5 text-muted-foreground">
        <p>Repetition: {point.repIndex + 1}</p>
        <p>Sample: {point.sampleId}</p>
        <p>Distance: {formatYValue(point.y)}</p>
        {point.targetY !== undefined && (
          <p>Y Value: {formatYValue(point.targetY)}</p>
        )}
        {point.isOutlier && (
          <p className="text-amber-600 font-medium">High variability</p>
        )}
      </div>
    </div>
  );
}

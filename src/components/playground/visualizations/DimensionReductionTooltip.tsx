import type { CSSProperties } from 'react';

import { formatFoldLabel, formatYValue } from './chartConfig';

export interface DimensionReductionTooltipPoint {
  x: number;
  y: number;
  z?: number;
  name: string;
  yValue?: number;
  foldLabel?: number;
  metadata?: Record<string, unknown>;
}

export interface DimensionReductionTooltipPayloadEntry {
  payload?: DimensionReductionTooltipPoint;
}

export interface DimensionReductionTooltipCardProps {
  point: DimensionReductionTooltipPoint;
  xLabel: string;
  yLabel: string;
  zLabel?: string;
  showZ?: boolean;
  className?: string;
  style?: CSSProperties;
}

export interface DimensionReductionRechartsTooltipProps {
  enableHover: boolean;
  payload?: DimensionReductionTooltipPayloadEntry[];
  xLabel: string;
  yLabel: string;
}

export interface DimensionReductionFloatingTooltipProps {
  enableHover: boolean;
  point?: DimensionReductionTooltipPoint | null;
  mousePosition?: { x: number; y: number } | null;
  containerWidth?: number;
  xLabel: string;
  yLabel: string;
  zLabel?: string;
  showZ?: boolean;
}

export function DimensionReductionTooltipCard({
  point,
  xLabel,
  yLabel,
  zLabel,
  showZ = false,
  className,
  style,
}: DimensionReductionTooltipCardProps) {
  const metadataEntries = point.metadata
    ? Object.entries(point.metadata).slice(0, 5)
    : [];

  return (
    <div
      className={[
        'bg-card border border-border rounded-lg p-2 shadow-lg text-xs max-w-xs',
        className,
      ].filter(Boolean).join(' ')}
      style={style}
    >
      <p className="font-medium mb-1">{point.name}</p>
      <div className="space-y-0.5 text-muted-foreground">
        <p>{xLabel}: {point.x.toFixed(3)}</p>
        <p>{yLabel}: {point.y.toFixed(3)}</p>
        {showZ && zLabel && point.z !== undefined && (
          <p>{zLabel}: {point.z.toFixed(3)}</p>
        )}
        {point.yValue !== undefined && (
          <p>Y: {formatYValue(point.yValue, 2)}</p>
        )}
        {point.foldLabel !== undefined && point.foldLabel >= 0 && (
          <p>{formatFoldLabel(point.foldLabel)}</p>
        )}
        {metadataEntries.length > 0 && (
          <div className="mt-1 pt-1 border-t border-border">
            {metadataEntries.map(([key, value]) => (
              <p key={key} className="truncate">
                {key}: {String(value)}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function DimensionReductionRechartsTooltip({
  enableHover,
  payload,
  xLabel,
  yLabel,
}: DimensionReductionRechartsTooltipProps) {
  if (!enableHover || !payload || payload.length === 0) {
    return null;
  }

  const point = payload[0]?.payload;
  if (!point) {
    return null;
  }

  return (
    <DimensionReductionTooltipCard
      point={point}
      xLabel={xLabel}
      yLabel={yLabel}
    />
  );
}

export function DimensionReductionFloatingTooltip({
  enableHover,
  point,
  mousePosition,
  containerWidth = 0,
  xLabel,
  yLabel,
  zLabel,
  showZ = false,
}: DimensionReductionFloatingTooltipProps) {
  if (!enableHover || !point || !mousePosition) {
    return null;
  }

  return (
    <DimensionReductionTooltipCard
      point={point}
      xLabel={xLabel}
      yLabel={yLabel}
      zLabel={zLabel}
      showZ={showZ}
      className="absolute z-20 pointer-events-none"
      style={{
        left: mousePosition.x + 12,
        top: mousePosition.y + 12,
        transform: mousePosition.x > containerWidth / 2 ? 'translateX(-100%)' : undefined,
      }}
    />
  );
}

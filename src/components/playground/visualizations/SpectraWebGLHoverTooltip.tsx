import { useTranslation } from 'react-i18next';

export interface SpectraWebGLHoverTooltipProps {
  showHoverTooltip: boolean;
  enableHover: boolean;
  hoveredSampleIdx: number | null;
  mousePosition: { x: number; y: number } | null;
  containerWidth: number;
  sampleIds?: string[];
  y?: number[];
  foldLabels?: number[];
}

export function SpectraWebGLHoverTooltip({
  showHoverTooltip,
  enableHover,
  hoveredSampleIdx,
  mousePosition,
  containerWidth,
  sampleIds,
  y,
  foldLabels,
}: SpectraWebGLHoverTooltipProps) {
  const { t } = useTranslation();
  if (!showHoverTooltip || !enableHover || hoveredSampleIdx === null || !mousePosition) {
    return null;
  }

  const yValue = y?.[hoveredSampleIdx];
  const foldLabel = foldLabels?.[hoveredSampleIdx];

  return (
    <div
      className="absolute bg-popover border border-border rounded-md px-2 py-1.5 shadow-md text-[10px] pointer-events-none z-30"
      style={{
        left: mousePosition.x + 10,
        top: mousePosition.y - 10,
        transform: mousePosition.x > containerWidth / 2 ? 'translateX(-100%)' : undefined,
      }}
    >
      <div className="font-medium text-foreground mb-0.5">
        {sampleIds?.[hoveredSampleIdx] ?? t('playground.charts.common.sampleFallback', { index: hoveredSampleIdx })}
      </div>
      {yValue !== undefined && (
        <div className="text-muted-foreground">
          Y: <span className="font-mono">{yValue.toFixed(3)}</span>
        </div>
      )}
      {foldLabel !== undefined && foldLabel >= 0 && (
        <div className="text-muted-foreground">
          {t('playground.charts.common.foldLabel', { n: foldLabel + 1 })}
        </div>
      )}
    </div>
  );
}

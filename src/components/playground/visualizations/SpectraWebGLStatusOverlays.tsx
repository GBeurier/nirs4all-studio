import { useTranslation } from 'react-i18next';

export interface SpectraWebGLStatusOverlaysProps {
  isLoading: boolean;
  showOriginalLegend: boolean;
  originalColor?: string;
  zoomLevel: number;
}

export function SpectraWebGLStatusOverlays({
  isLoading,
  showOriginalLegend,
  originalColor,
  zoomLevel,
}: SpectraWebGLStatusOverlaysProps) {
  const { t } = useTranslation();
  return (
    <>
      {isLoading && (
        <div className="absolute inset-0 bg-background/50 flex items-center justify-center z-10">
          <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      )}

      {showOriginalLegend && (
        <div className="absolute top-2 left-2 text-[10px] text-muted-foreground bg-background/80 px-2 py-1 rounded flex items-center gap-2">
          <span className="flex items-center gap-1">
            <span className="w-4 h-0.5 bg-primary" />
            {t('playground.charts.common.legendProcessed')}
          </span>
          <span className="flex items-center gap-1">
            <span className="w-4 h-0.5 border-t border-dashed" style={{ borderColor: originalColor }} />
            {t('playground.charts.common.legendOriginal')}
          </span>
        </div>
      )}

      <div className="absolute bottom-2 left-2 text-[10px] text-muted-foreground">
        {t('playground.charts.common.zoomHint')}
      </div>

      {zoomLevel > 1.05 && (
        <div className="absolute bottom-2 right-2 text-[10px] text-muted-foreground bg-background/80 px-2 py-0.5 rounded">
          {t('playground.charts.common.zoomLevel', { level: zoomLevel.toFixed(1) })}
        </div>
      )}
    </>
  );
}

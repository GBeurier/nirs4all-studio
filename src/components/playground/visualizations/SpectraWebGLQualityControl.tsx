import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

import type { QualityMode } from './spectraWebGLQuality';

export type SpectraWebGLQualityMode = QualityMode;
export type SpectraWebGLEffectiveQuality = Exclude<SpectraWebGLQualityMode, 'auto'>;

export interface SpectraWebGLQualityControlProps {
  showQualityControls: boolean;
  spectraCount: number;
  internalQuality: SpectraWebGLQualityMode;
  effectiveQuality: SpectraWebGLEffectiveQuality;
  autoQuality: SpectraWebGLEffectiveQuality;
  showQualityMenu: boolean;
  onToggleQualityMenu: () => void;
  onCloseQualityMenu: () => void;
  onQualityChange: (quality: SpectraWebGLQualityMode) => void;
}

const QUALITY_OPTIONS: SpectraWebGLQualityMode[] = ['auto', 'low', 'medium', 'high'];

const QUALITY_LABEL_KEYS: Record<SpectraWebGLQualityMode, string> = {
  auto: 'playground.charts.common.qualityAuto',
  low: 'playground.charts.common.qualityLow',
  medium: 'playground.charts.common.qualityMedium',
  high: 'playground.charts.common.qualityHigh',
};

export function SpectraWebGLQualityControl({
  showQualityControls,
  spectraCount,
  internalQuality,
  effectiveQuality,
  autoQuality,
  showQualityMenu,
  onToggleQualityMenu,
  onCloseQualityMenu,
  onQualityChange,
}: SpectraWebGLQualityControlProps) {
  const { t } = useTranslation();
  return (
    <>
      {showQualityControls && (
        <div className="absolute top-9 right-2 flex flex-col items-end gap-1">
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground bg-background/80 px-1 rounded">
              {t('playground.charts.common.spectraCount', { count: spectraCount })}
            </span>
            <div className="relative">
              <button
                onClick={onToggleQualityMenu}
                aria-label={t('playground.charts.common.qualityMenu')}
                className="text-[10px] text-muted-foreground bg-background/80 hover:bg-background px-2 py-0.5 rounded border border-transparent hover:border-border transition-colors cursor-pointer"
              >
                {internalQuality === 'auto' ? `${t(QUALITY_LABEL_KEYS.auto)} (${t(QUALITY_LABEL_KEYS[effectiveQuality])})` : t(QUALITY_LABEL_KEYS[effectiveQuality])}
              </button>
              {showQualityMenu && (
                <div className="absolute top-full right-0 mt-1 bg-background border rounded shadow-lg py-1 min-w-[80px] z-20">
                  {QUALITY_OPTIONS.map((quality) => (
                    <button
                      key={quality}
                      onClick={() => onQualityChange(quality)}
                      className={cn(
                        'w-full text-left px-3 py-1 text-[11px] hover:bg-muted transition-colors',
                        internalQuality === quality && 'bg-muted font-medium'
                      )}
                    >
                      {t(QUALITY_LABEL_KEYS[quality])}
                      {quality === 'auto' && ` (${t(QUALITY_LABEL_KEYS[autoQuality])})`}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showQualityMenu && (
        <div
          className="fixed inset-0 z-10"
          onClick={onCloseQualityMenu}
        />
      )}
    </>
  );
}

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
  return (
    <>
      {showQualityControls && (
        <div className="absolute top-9 right-2 flex flex-col items-end gap-1">
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground bg-background/80 px-1 rounded">
              {spectraCount} spectra
            </span>
            <div className="relative">
              <button
                onClick={onToggleQualityMenu}
                className="text-[10px] text-muted-foreground bg-background/80 hover:bg-background px-2 py-0.5 rounded border border-transparent hover:border-border transition-colors cursor-pointer"
              >
                {internalQuality === 'auto' ? `auto (${effectiveQuality})` : effectiveQuality}
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
                      {quality}
                      {quality === 'auto' && ` (${autoQuality})`}
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

import type { HyperparameterScaleMode } from '@/lib/inspector/hyperparameterSensitivityData';
import { getHyperparameterScaleDescription } from '@/lib/inspector/hyperparameterSensitivityPresentation';

interface HyperparameterSensitivityHeaderProps {
  chartTitle: string;
  pointCount: number;
  modelFamilyCount: number;
  scoreLabel: string;
  useLogX: boolean;
  logAllowed: boolean;
  scaleMode: HyperparameterScaleMode;
  onScaleModeChange: (mode: HyperparameterScaleMode) => void;
}

export function HyperparameterSensitivityHeader({
  chartTitle,
  pointCount,
  modelFamilyCount,
  scoreLabel,
  useLogX,
  logAllowed,
  scaleMode,
  onScaleModeChange,
}: HyperparameterSensitivityHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
      <div className="space-y-0.5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{chartTitle}</span>
          <span>{pointCount} points</span>
          <span>•</span>
          <span>{modelFamilyCount} model families</span>
          <span>•</span>
          <span>{scoreLabel}</span>
        </div>
        <div className="text-[11px] text-muted-foreground">
          Click a point to select a chain. {getHyperparameterScaleDescription(useLogX, logAllowed)}
        </div>
      </div>

      <div className="flex items-center gap-1 rounded-md border border-border/60 bg-background p-1 text-xs">
        <button
          type="button"
          className={`rounded px-2 py-1 transition-colors ${scaleMode === 'linear' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
          onClick={() => onScaleModeChange('linear')}
        >
          Linear
        </button>
        <button
          type="button"
          className={`rounded px-2 py-1 transition-colors ${scaleMode === 'log' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'} ${!logAllowed ? 'opacity-40' : ''}`}
          onClick={() => logAllowed && onScaleModeChange('log')}
          disabled={!logAllowed}
        >
          Log
        </button>
      </div>
    </div>
  );
}

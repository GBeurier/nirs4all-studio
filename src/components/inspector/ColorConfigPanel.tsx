/**
 * ColorConfigPanel — Color mode and palette configuration for Inspector sidebar.
 *
 * Compact palette controls with theme-aware previews.
 * Uses InspectorColorContext for state management.
 */

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useInspectorColor } from '@/context/InspectorColorContext';
import type { InspectorColorMode } from '@/types/inspector';
import type { ReactNode } from 'react';
import {
  CATEGORICAL_PALETTES,
  getCategoricalPaletteLabel,
  getContinuousPaletteGradient,
  getContinuousPaletteLabel,
  type ContinuousPalette,
  type CategoricalPalette,
} from '@/lib/playground/colorConfig';

const COLOR_MODES: { value: InspectorColorMode; label: string }[] = [
  { value: 'group', label: 'Group' },
  { value: 'score', label: 'Score' },
  { value: 'dataset', label: 'Dataset' },
  { value: 'model_class', label: 'Model Class' },
];

const CONTINUOUS_OPTIONS: { value: ContinuousPalette; label: string }[] = [
  { value: 'viridis', label: 'Viridis' },
  { value: 'plasma', label: 'Plasma' },
  { value: 'inferno', label: 'Inferno' },
  { value: 'coolwarm', label: 'Cool-Warm' },
  { value: 'spectral', label: 'Spectral' },
  { value: 'cividis', label: 'Cividis' },
  { value: 'turbo', label: 'Turbo' },
  { value: 'blues', label: 'Blues' },
];

const CATEGORICAL_OPTIONS: { value: CategoricalPalette; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'tableau10', label: 'Tableau 10' },
  { value: 'set1', label: 'Set 1' },
  { value: 'set2', label: 'Set 2' },
  { value: 'paired', label: 'Paired' },
];

function PaletteButton({
  active,
  onClick,
  label,
  children,
  description,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={active ? 'secondary' : 'outline'}
          className={cn(
            'h-auto w-full justify-start gap-3 px-2.5 py-2 text-left',
            active && 'border-primary/40 bg-primary/10',
          )}
          onClick={onClick}
        >
          {children}
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-foreground">{label}</div>
            <div className="truncate text-[10px] text-muted-foreground">{description}</div>
          </div>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-[220px] text-xs leading-5">
        {description}
      </TooltipContent>
    </Tooltip>
  );
}

export function ColorConfigPanel() {
  const {
    config,
    setMode,
    setContinuousPalette,
    setCategoricalPalette,
    setUnselectedOpacity,
  } = useInspectorColor();

  const isContinuousMode = config.mode === 'score';

  return (
    <TooltipProvider delayDuration={180}>
      <div className="space-y-3">
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Mode</span>
            <Badge variant="outline" className="border-border/60 text-[10px] uppercase tracking-[0.12em]">
              {config.mode}
            </Badge>
          </div>
          <Select value={config.mode} onValueChange={(val) => setMode(val as InspectorColorMode)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COLOR_MODES.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Palette
            </span>
            <span className="text-[10px] text-muted-foreground">
              {isContinuousMode ? getContinuousPaletteLabel(config.continuousPalette) : getCategoricalPaletteLabel(config.categoricalPalette)}
            </span>
          </div>

          {isContinuousMode ? (
            <div className="grid gap-2">
              {CONTINUOUS_OPTIONS.map(opt => {
                const active = config.continuousPalette === opt.value;
                return (
                  <PaletteButton
                    key={opt.value}
                    active={active}
                    onClick={() => setContinuousPalette(opt.value)}
                    label={opt.label}
                    description="Continuous gradient for score-based coloring."
                  >
                    <div
                      className="h-7 w-14 shrink-0 rounded-md border border-border/60"
                      style={{ backgroundImage: getContinuousPaletteGradient(opt.value) }}
                    />
                  </PaletteButton>
                );
              })}
            </div>
          ) : (
            <div className="grid gap-2">
              {CATEGORICAL_OPTIONS.map(opt => {
                const active = config.categoricalPalette === opt.value;
                const palette = CATEGORICAL_PALETTES[opt.value].slice(0, 5);
                return (
                  <PaletteButton
                    key={opt.value}
                    active={active}
                    onClick={() => setCategoricalPalette(opt.value)}
                    label={opt.label}
                    description="Categorical palette for groups, datasets, or model classes."
                  >
                    <div className="flex h-7 w-14 shrink-0 overflow-hidden rounded-md border border-border/60">
                      {palette.map((color, idx) => (
                        <span key={idx} className="h-full flex-1" style={{ backgroundColor: color }} />
                      ))}
                    </div>
                  </PaletteButton>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Opacity
            </span>
            <span className="text-[10px] text-muted-foreground">{config.unselectedOpacity.toFixed(2)}</span>
          </div>
          <Slider
            min={0}
            max={1}
            step={0.05}
            value={[config.unselectedOpacity]}
            onValueChange={([val]) => setUnselectedOpacity(val)}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}

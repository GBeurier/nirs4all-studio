/**
 * ColorConfigPanel — Color mode and palette configuration for Inspector sidebar.
 *
 * Compact palette controls with theme-aware previews.
 * Uses InspectorColorContext for state management.
 */

import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useInspectorColor } from '@/context/useInspectorColor';
import type { InspectorColorMode } from '@/types/inspector';
import {
  formatInspectorOpacityValue,
  getInspectorActivePaletteLabel,
  getInspectorCategoricalPalettePreviewColors,
  getInspectorContinuousPalettePreview,
  INSPECTOR_CATEGORICAL_PALETTE_OPTIONS,
  INSPECTOR_COLOR_MODE_OPTIONS,
  INSPECTOR_CONTINUOUS_PALETTE_OPTIONS,
  isInspectorContinuousColorMode,
} from '@/lib/inspector/colorConfigPanel';
import { InspectorPaletteButton } from './InspectorPaletteButton';

export function ColorConfigPanel() {
  const { t } = useTranslation();
  const {
    config,
    setMode,
    setContinuousPalette,
    setCategoricalPalette,
    setUnselectedOpacity,
  } = useInspectorColor();

  const isContinuousMode = isInspectorContinuousColorMode(config.mode);

  return (
    <TooltipProvider delayDuration={180}>
      <div className="space-y-3">
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{t('inspector.colors.modeTitle')}</span>
            <Badge variant="outline" className="border-border/60 text-[10px] uppercase tracking-[0.12em]">
              {t(`inspector.colors.mode.${config.mode}`)}
            </Badge>
          </div>
          <Select value={config.mode} onValueChange={(val) => setMode(val as InspectorColorMode)}>
            <SelectTrigger className="h-8 text-xs" aria-label={t('inspector.colors.modeTitle')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INSPECTOR_COLOR_MODE_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {t('inspector.colors.palette')}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {getInspectorActivePaletteLabel(config)}
            </span>
          </div>

          {isContinuousMode ? (
            <div className="grid gap-2">
              {INSPECTOR_CONTINUOUS_PALETTE_OPTIONS.map(opt => {
                const active = config.continuousPalette === opt.value;
                return (
                  <InspectorPaletteButton
                    key={opt.value}
                    active={active}
                    onClick={() => setContinuousPalette(opt.value)}
                    label={opt.label}
                    description={t('inspector.colors.continuousDescription')}
                  >
                    <div
                      className="h-7 w-14 shrink-0 rounded-md border border-border/60"
                      style={{ backgroundImage: getInspectorContinuousPalettePreview(opt.value) }}
                    />
                  </InspectorPaletteButton>
                );
              })}
            </div>
          ) : (
            <div className="grid gap-2">
              {INSPECTOR_CATEGORICAL_PALETTE_OPTIONS.map(opt => {
                const active = config.categoricalPalette === opt.value;
                const palette = getInspectorCategoricalPalettePreviewColors(opt.value);
                return (
                  <InspectorPaletteButton
                    key={opt.value}
                    active={active}
                    onClick={() => setCategoricalPalette(opt.value)}
                    label={opt.label}
                    description={t('inspector.colors.categoricalDescription')}
                  >
                    <div className="flex h-7 w-14 shrink-0 overflow-hidden rounded-md border border-border/60">
                      {palette.map((color, idx) => (
                        <span key={idx} className="h-full flex-1" style={{ backgroundColor: color }} />
                      ))}
                    </div>
                  </InspectorPaletteButton>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {t('inspector.colors.opacity')}
            </span>
            <span className="text-[10px] text-muted-foreground">{formatInspectorOpacityValue(config.unselectedOpacity)}</span>
          </div>
          <Slider
            aria-label={t('inspector.colors.opacity')}
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

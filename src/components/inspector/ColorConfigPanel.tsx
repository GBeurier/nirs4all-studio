/**
 * ColorConfigPanel — Color mode and palette configuration for Inspector sidebar.
 *
 * Controls: color mode, continuous/categorical palette, unselected opacity.
 * Uses InspectorColorContext for state management.
 */

import { useTranslation } from 'react-i18next';
import { Palette } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { useInspectorColor } from '@/context/InspectorColorContext';
import type { InspectorColorMode } from '@/types/inspector';
import type { ContinuousPalette, CategoricalPalette } from '@/lib/playground/colorConfig';

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

export function ColorConfigPanel() {
  const { t } = useTranslation();
  const {
    config,
    setMode,
    setContinuousPalette,
    setCategoricalPalette,
    setUnselectedOpacity,
  } = useInspectorColor();

  const isContinuousMode = config.mode === 'score';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Palette className="w-4 h-4 text-muted-foreground" />
        <span>{t('inspector.sidebar.colorMode', 'Color Mode')}</span>
      </div>

      {/* Color Mode */}
      <Select value={config.mode} onValueChange={(val) => setMode(val as InspectorColorMode)}>
        <SelectTrigger className="h-7 text-xs">
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

      {/* Palette Selector */}
      {isContinuousMode ? (
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Continuous Palette</label>
          <Select value={config.continuousPalette} onValueChange={(val) => setContinuousPalette(val as ContinuousPalette)}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONTINUOUS_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Categorical Palette</label>
          <Select value={config.categoricalPalette} onValueChange={(val) => setCategoricalPalette(val as CategoricalPalette)}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORICAL_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Unselected Opacity */}
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">
          Unselected Opacity: {config.unselectedOpacity.toFixed(2)}
        </label>
        <Slider
          min={0}
          max={1}
          step={0.05}
          value={[config.unselectedOpacity]}
          onValueChange={([val]) => setUnselectedOpacity(val)}
        />
      </div>
    </div>
  );
}

import {
  CATEGORICAL_PALETTES,
  getCategoricalPaletteLabel,
  getContinuousPaletteGradient,
  getContinuousPaletteLabel,
  type CategoricalPalette,
  type ContinuousPalette,
} from '@/lib/playground/colorConfig';
import type { InspectorColorConfig, InspectorColorMode } from '@/types/inspector';

export const INSPECTOR_COLOR_MODE_OPTIONS: { value: InspectorColorMode; label: string }[] = [
  { value: 'group', label: 'Group' },
  { value: 'score', label: 'Score' },
  { value: 'dataset', label: 'Dataset' },
  { value: 'model_class', label: 'Model Class' },
];

export const INSPECTOR_CONTINUOUS_PALETTE_OPTIONS: { value: ContinuousPalette; label: string }[] = [
  { value: 'viridis', label: 'Viridis' },
  { value: 'plasma', label: 'Plasma' },
  { value: 'inferno', label: 'Inferno' },
  { value: 'coolwarm', label: 'Cool-Warm' },
  { value: 'spectral', label: 'Spectral' },
  { value: 'cividis', label: 'Cividis' },
  { value: 'turbo', label: 'Turbo' },
  { value: 'blues', label: 'Blues' },
];

export const INSPECTOR_CATEGORICAL_PALETTE_OPTIONS: { value: CategoricalPalette; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'tableau10', label: 'Tableau 10' },
  { value: 'set1', label: 'Set 1' },
  { value: 'set2', label: 'Set 2' },
  { value: 'paired', label: 'Paired' },
];

export function isInspectorContinuousColorMode(mode: InspectorColorMode): boolean {
  return mode === 'score';
}

export function getInspectorActivePaletteLabel(config: InspectorColorConfig): string {
  return isInspectorContinuousColorMode(config.mode)
    ? getContinuousPaletteLabel(config.continuousPalette)
    : getCategoricalPaletteLabel(config.categoricalPalette);
}

export function getInspectorContinuousPalettePreview(palette: ContinuousPalette): string {
  return getContinuousPaletteGradient(palette);
}

export function getInspectorCategoricalPalettePreviewColors(
  palette: CategoricalPalette,
  count = 5,
): string[] {
  return CATEGORICAL_PALETTES[palette].slice(0, count);
}

export function formatInspectorOpacityValue(opacity: number): string {
  return opacity.toFixed(2);
}

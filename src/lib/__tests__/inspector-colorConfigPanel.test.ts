import { describe, expect, it } from 'vitest';

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
import type { InspectorColorConfig } from '@/types/inspector';

const baseConfig: InspectorColorConfig = {
  mode: 'group',
  continuousPalette: 'viridis',
  categoricalPalette: 'default',
  unselectedOpacity: 0.35,
  highlightSelection: true,
  highlightHover: true,
};

describe('inspector color config panel helpers', () => {
  it('exposes stable mode and palette option catalogs', () => {
    expect(INSPECTOR_COLOR_MODE_OPTIONS.map(option => option.value)).toEqual([
      'group',
      'score',
      'dataset',
      'model_class',
    ]);
    expect(INSPECTOR_CONTINUOUS_PALETTE_OPTIONS.map(option => option.value)).toContain('viridis');
    expect(INSPECTOR_CATEGORICAL_PALETTE_OPTIONS.map(option => option.value)).toContain('tableau10');
  });

  it('derives continuous mode and active palette labels', () => {
    expect(isInspectorContinuousColorMode('score')).toBe(true);
    expect(isInspectorContinuousColorMode('group')).toBe(false);
    expect(getInspectorActivePaletteLabel(baseConfig)).toBe('Default');
    expect(getInspectorActivePaletteLabel({ ...baseConfig, mode: 'score' })).toBe('Viridis');
  });

  it('builds palette previews and opacity labels', () => {
    expect(getInspectorContinuousPalettePreview('viridis')).toContain('linear-gradient');
    expect(getInspectorCategoricalPalettePreviewColors('default')).toHaveLength(5);
    expect(getInspectorCategoricalPalettePreviewColors('default', 3)).toHaveLength(3);
    expect(formatInspectorOpacityValue(0.357)).toBe('0.36');
  });
});

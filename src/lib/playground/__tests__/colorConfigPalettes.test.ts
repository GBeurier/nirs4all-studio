import { describe, expect, it } from 'vitest';

import {
  CATEGORICAL_PALETTES,
  CONTINUOUS_PALETTES,
  getCategoricalColor,
  getCategoricalPaletteLabel,
  getContinuousColor,
  getContinuousColorForValue,
  getContinuousPaletteGradient,
  getContinuousPaletteLabel,
  getFiniteNumberDomain,
  normalizeValue,
  type CategoricalPalette,
  type ContinuousPalette,
} from '../colorConfigPalettes';

describe('colorConfigPalettes', () => {
  describe('getCategoricalColor', () => {
    it('returns the palette entry at the given index', () => {
      expect(getCategoricalColor(0, 'default')).toBe(CATEGORICAL_PALETTES.default[0]);
      expect(getCategoricalColor(2, 'tableau10')).toBe(CATEGORICAL_PALETTES.tableau10[2]);
    });

    it('wraps around when the index exceeds the palette length', () => {
      const len = CATEGORICAL_PALETTES.set2.length;
      expect(getCategoricalColor(len, 'set2')).toBe(CATEGORICAL_PALETTES.set2[0]);
      expect(getCategoricalColor(len + 1, 'set2')).toBe(CATEGORICAL_PALETTES.set2[1]);
    });

    it('defaults to the "default" palette', () => {
      expect(getCategoricalColor(1)).toBe(CATEGORICAL_PALETTES.default[1]);
    });
  });

  describe('getContinuousColor', () => {
    it('delegates to the palette function for the clamped value', () => {
      expect(getContinuousColor(0.5, 'blue_red')).toBe(CONTINUOUS_PALETTES.blue_red(0.5));
    });

    it('clamps the normalized value into the 0-1 range', () => {
      expect(getContinuousColor(-1, 'blue_red')).toBe(CONTINUOUS_PALETTES.blue_red(0));
      expect(getContinuousColor(2, 'blue_red')).toBe(CONTINUOUS_PALETTES.blue_red(1));
    });

    it('exposes every documented continuous palette', () => {
      const palettes: ContinuousPalette[] = [
        'blue_red', 'viridis', 'plasma', 'inferno', 'coolwarm',
        'spectral', 'cividis', 'winter', 'blues', 'greens', 'turbo',
      ];
      for (const palette of palettes) {
        expect(getContinuousColor(0.5, palette)).toMatch(/^hsl/);
      }
    });
  });

  describe('normalizeValue', () => {
    it('maps a value within its domain to 0-1', () => {
      expect(normalizeValue(5, 0, 10)).toBe(0.5);
      expect(normalizeValue(0, 0, 10)).toBe(0);
      expect(normalizeValue(10, 0, 10)).toBe(1);
    });

    it('returns 0.5 for a degenerate (min === max) domain', () => {
      expect(normalizeValue(4, 4, 4)).toBe(0.5);
    });

    it('returns 0.5 when any input is non-finite', () => {
      expect(normalizeValue(Number.NaN, 0, 10)).toBe(0.5);
      expect(normalizeValue(5, 0, Number.POSITIVE_INFINITY)).toBe(0.5);
    });
  });

  describe('getFiniteNumberDomain', () => {
    it('ignores non-numeric and non-finite entries', () => {
      const values = [0, Number.NaN, 10, Number.POSITIVE_INFINITY, null, undefined, 'x'];
      expect(getFiniteNumberDomain(values)).toEqual({ min: 0, max: 10 });
    });

    it('returns null when no finite numbers are present', () => {
      expect(getFiniteNumberDomain([Number.NaN, null, 'a', undefined])).toBeNull();
      expect(getFiniteNumberDomain([])).toBeNull();
    });
  });

  describe('getContinuousColorForValue', () => {
    it('returns the continuous color for a finite value', () => {
      expect(getContinuousColorForValue(5, 0, 10, 'blue_red')).toBe(
        getContinuousColor(0.5, 'blue_red')
      );
    });

    it('returns null when value or bounds are non-finite', () => {
      expect(getContinuousColorForValue(Number.NaN, 0, 10)).toBeNull();
      expect(getContinuousColorForValue(5, 0, Number.POSITIVE_INFINITY)).toBeNull();
    });
  });

  describe('palette display helpers', () => {
    it('provides a human label for every continuous palette', () => {
      const palettes = Object.keys(CONTINUOUS_PALETTES) as ContinuousPalette[];
      for (const palette of palettes) {
        expect(getContinuousPaletteLabel(palette)).toBeTruthy();
      }
    });

    it('provides a human label for every categorical palette', () => {
      const palettes = Object.keys(CATEGORICAL_PALETTES) as CategoricalPalette[];
      for (const palette of palettes) {
        expect(getCategoricalPaletteLabel(palette)).toBeTruthy();
      }
    });

    it('builds a CSS linear-gradient preview with 11 stops', () => {
      const gradient = getContinuousPaletteGradient('blue_red');
      expect(gradient.startsWith('linear-gradient(90deg, ')).toBe(true);
      expect(gradient.endsWith(')')).toBe(true);
      // 11 stops at 0%, 10%, ..., 100% (each preceded by a color and a space).
      const stopPositions = gradient.match(/\) \d+(?:\.\d+)?%/g);
      expect(stopPositions?.length).toBe(11);
      expect(gradient).toContain(`${getContinuousColor(0, 'blue_red')} 0%`);
      expect(gradient).toContain(`${getContinuousColor(1, 'blue_red')} 100%`);
    });
  });
});

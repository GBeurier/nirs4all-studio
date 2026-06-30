import { describe, expect, it } from 'vitest';

import {
  adjustColorVariant,
  formatHslColor,
  parseColorToHsl,
  parseHexColor,
  parseHslColor,
} from '../colorConfigVariants';

describe('colorConfigVariants', () => {
  it('parses HSL/HSLA colors and clamps component ranges', () => {
    expect(parseHslColor('hsl(-30, 120%, -5%)')).toEqual({
      h: 330,
      s: 100,
      l: 0,
      a: undefined,
    });
    expect(parseHslColor('hsla(390deg 50% 40% / 1.5)')).toEqual({
      h: 30,
      s: 50,
      l: 40,
      a: 1,
    });
  });

  it('parses short and long hex colors', () => {
    expect(parseHexColor('#0af')).toEqual({ r: 0, g: 170, b: 255 });
    expect(parseHexColor('#10a0ff')).toEqual({ r: 16, g: 160, b: 255 });
  });

  it('projects hex colors into HSL space for variant generation', () => {
    expect(parseColorToHsl('#808080')).toEqual({ h: 0, s: 0, l: expect.closeTo(50.196, 3) });
    expect(parseColorToHsl('not-a-color')).toBeNull();
  });

  it('formats HSL colors with rounded channels and preserved alpha', () => {
    expect(formatHslColor({ h: 173.4, s: 79.6, l: 44.6 })).toBe('hsl(173, 80%, 45%)');
    expect(formatHslColor({ h: 173.4, s: 79.6, l: 44.6, a: 0.25 })).toBe('hsla(173, 80%, 45%, 0.25)');
  });

  it('adjusts saturation and lightness while preserving hue', () => {
    expect(adjustColorVariant('hsl(173, 80%, 45%)', { saturationDelta: -18, lightnessDelta: 14 })).toBe(
      'hsl(173, 62%, 59%)'
    );
  });

  it('returns the original color when parsing fails', () => {
    expect(adjustColorVariant('var(--primary)', { lightnessDelta: 10 })).toBe('var(--primary)');
  });
});

/**
 * Pure color variant helpers used by playground color configuration.
 */

export interface HslColor {
  h: number;
  s: number;
  l: number;
  a?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function parseHslColor(color: string): HslColor | null {
  const match = color.trim().match(
    /^hsla?\(\s*([+-]?\d*\.?\d+)(?:deg)?[,\s]+([+-]?\d*\.?\d+)%[,\s]+([+-]?\d*\.?\d+)%(?:[,\s/]+([+-]?\d*\.?\d+))?\s*\)$/i
  );
  if (!match) return null;
  const [, h, s, l, a] = match;
  return {
    h: ((parseFloat(h) % 360) + 360) % 360,
    s: clamp(parseFloat(s), 0, 100),
    l: clamp(parseFloat(l), 0, 100),
    a: a !== undefined ? clamp(parseFloat(a), 0, 1) : undefined,
  };
}

export function parseHexColor(color: string): { r: number; g: number; b: number } | null {
  const value = color.trim();
  const match = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  const hex = match[1];

  if (hex.length === 3) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
    };
  }

  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

function rgbToHsl(r: number, g: number, b: number): HslColor {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;
  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  const delta = max - min;
  const lightness = (max + min) / 2;

  let hue = 0;
  if (delta > 0) {
    if (max === rNorm) {
      hue = ((gNorm - bNorm) / delta) % 6;
    } else if (max === gNorm) {
      hue = (bNorm - rNorm) / delta + 2;
    } else {
      hue = (rNorm - gNorm) / delta + 4;
    }
    hue *= 60;
    if (hue < 0) hue += 360;
  }

  const saturation = delta === 0
    ? 0
    : delta / (1 - Math.abs(2 * lightness - 1));

  return {
    h: hue,
    s: saturation * 100,
    l: lightness * 100,
  };
}

export function parseColorToHsl(color: string): HslColor | null {
  const parsedHsl = parseHslColor(color);
  if (parsedHsl) return parsedHsl;

  const rgb = parseHexColor(color);
  if (!rgb) return null;
  return rgbToHsl(rgb.r, rgb.g, rgb.b);
}

export function formatHslColor({ h, s, l, a }: HslColor): string {
  const roundedHue = Math.round(h);
  const roundedSaturation = Math.round(s);
  const roundedLightness = Math.round(l);
  if (a !== undefined && a < 1) {
    return `hsla(${roundedHue}, ${roundedSaturation}%, ${roundedLightness}%, ${a})`;
  }
  return `hsl(${roundedHue}, ${roundedSaturation}%, ${roundedLightness}%)`;
}

export function adjustColorVariant(
  color: string,
  {
    saturationDelta = 0,
    lightnessDelta = 0,
  }: {
    saturationDelta?: number;
    lightnessDelta?: number;
  }
): string {
  const parsed = parseColorToHsl(color);
  if (!parsed) return color;
  return formatHslColor({
    ...parsed,
    s: clamp(parsed.s + saturationDelta, 0, 100),
    l: clamp(parsed.l + lightnessDelta, 0, 100),
  });
}

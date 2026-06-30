/**
 * Capture-source detection for combined-report chart rendering.
 *
 * A chart container is captured differently depending on what it holds:
 * - 'canvas': WebGL charts render into a <canvas> we can copy directly.
 * - 'svg': Recharts render an <svg> we serialize and rasterize.
 * - 'fallback': neither present, so a placeholder is drawn.
 */
export type CaptureSourceKind = 'canvas' | 'svg' | 'fallback';

export type CaptureSource =
  | { kind: 'canvas'; canvas: HTMLCanvasElement }
  | { kind: 'svg'; svg: SVGElement }
  | { kind: 'fallback' };

/**
 * Inspect a chart container element and decide how it should be captured.
 * Canvas takes precedence over SVG (WebGL charts may embed helper SVGs).
 */
export function detectCaptureSource(element: HTMLElement): CaptureSource {
  const canvas = element.querySelector('canvas');
  if (canvas) {
    return { kind: 'canvas', canvas };
  }

  const svg = element.querySelector('svg');
  if (svg) {
    return { kind: 'svg', svg };
  }

  return { kind: 'fallback' };
}

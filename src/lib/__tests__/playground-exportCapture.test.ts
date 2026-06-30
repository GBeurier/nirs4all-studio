// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { detectCaptureSource } from '@/lib/playground/exportCapture';

function makeElement(innerHTML: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = innerHTML;
  return el;
}

describe('detectCaptureSource', () => {
  it('prefers a canvas source when one is present', () => {
    const el = makeElement('<svg></svg><canvas></canvas>');
    const source = detectCaptureSource(el);

    expect(source.kind).toBe('canvas');
    if (source.kind === 'canvas') {
      expect(source.canvas.tagName.toLowerCase()).toBe('canvas');
    }
  });

  it('falls back to svg when no canvas is present', () => {
    const el = makeElement('<svg></svg>');
    const source = detectCaptureSource(el);

    expect(source.kind).toBe('svg');
    if (source.kind === 'svg') {
      expect(source.svg.tagName.toLowerCase()).toBe('svg');
    }
  });

  it('reports fallback when neither canvas nor svg exists', () => {
    const el = makeElement('<p>no chart</p>');
    expect(detectCaptureSource(el)).toEqual({ kind: 'fallback' });
  });
});

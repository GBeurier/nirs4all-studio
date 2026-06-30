// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  canvasToPngBlob,
  createPngExportBlob,
  findSvgElement,
  serializeChartSvg,
  serializeSvgElement,
} from '@/lib/playground/exportImage';

describe('findSvgElement', () => {
  it('prefers an explicit SVG element over a nested SVG', () => {
    const explicit = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const nested = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const element = document.createElement('div');
    element.appendChild(nested);

    expect(findSvgElement({ element, svgElement: explicit })).toBe(explicit);
  });

  it('falls back to the first nested SVG', () => {
    const nested = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const element = document.createElement('div');
    element.appendChild(nested);

    expect(findSvgElement({ element })).toBe(nested);
  });
});

describe('serializeSvgElement', () => {
  it('serializes a cloned SVG with export namespaces', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 10 10');
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', '5');
    svg.appendChild(circle);

    const serialized = serializeSvgElement(svg);

    expect(serialized).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(serialized).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(serialized).toContain('viewBox="0 0 10 10"');
    expect(svg.getAttribute('xmlns:xlink')).toBeNull();
  });
});

describe('serializeChartSvg', () => {
  it('returns null when no SVG can be found', () => {
    expect(serializeChartSvg({ element: document.createElement('div') })).toBeNull();
  });
});

describe('canvasToPngBlob', () => {
  it('requests a PNG blob with the supplied quality', async () => {
    let requestedType: string | undefined;
    let requestedQuality: number | undefined;
    const expectedBlob = new Blob(['png'], { type: 'image/png' });
    const canvas = {
      toBlob: (
        callback: BlobCallback,
        type?: string,
        quality?: number
      ) => {
        requestedType = type;
        requestedQuality = quality;
        callback(expectedBlob);
      },
    } as HTMLCanvasElement;

    await expect(canvasToPngBlob(canvas, 0.7)).resolves.toBe(expectedBlob);
    expect(requestedType).toBe('image/png');
    expect(requestedQuality).toBe(0.7);
  });

  it('rejects when the browser cannot create a blob', async () => {
    const canvas = {
      toBlob: (callback: BlobCallback) => {
        callback(null);
      },
    } as HTMLCanvasElement;

    await expect(canvasToPngBlob(canvas)).rejects.toThrow('Failed to create blob');
  });
});

describe('createPngExportBlob', () => {
  it('returns null when there is no canvas or element to capture', async () => {
    await expect(createPngExportBlob({})).resolves.toBeNull();
  });

  it('uses the supplied canvas directly', async () => {
    const expectedBlob = new Blob(['png'], { type: 'image/png' });
    const canvas = {
      toBlob: (callback: BlobCallback) => {
        callback(expectedBlob);
      },
    } as HTMLCanvasElement;

    await expect(createPngExportBlob({ canvasElement: canvas })).resolves.toBe(
      expectedBlob
    );
  });
});

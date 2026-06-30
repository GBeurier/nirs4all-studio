/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { SpectraWebGLStatusOverlays } from '../SpectraWebGLStatusOverlays';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let mountedContainers: HTMLDivElement[] = [];

async function render(element: ReactNode) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  mountedContainers.push(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(element);
  });

  return { container, root };
}

afterEach(() => {
  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers = [];
});

describe('SpectraWebGLStatusOverlays', () => {
  it('renders loading, original legend, controls hint, and zoom status', async () => {
    const { container, root } = await render(
      <SpectraWebGLStatusOverlays
        isLoading
        showOriginalLegend
        originalColor="hsl(12, 60%, 50%)"
        zoomLevel={1.82}
      />
    );

    expect(container.querySelector('.animate-spin')).toBeTruthy();
    expect(container.textContent).toContain('Processed');
    expect(container.textContent).toContain('Original');
    expect(container.textContent).toContain('Scroll to zoom X');
    expect(container.textContent).toContain('1.8× zoom');

    const originalSwatch = container.querySelector('.border-dashed') as HTMLElement | null;
    expect(originalSwatch?.style.borderColor).toBe('rgb(204, 82, 51)');

    await act(async () => {
      root.unmount();
    });
  });

  it('suppresses optional loading, legend, and zoom states', async () => {
    const { container, root } = await render(
      <SpectraWebGLStatusOverlays
        isLoading={false}
        showOriginalLegend={false}
        zoomLevel={1.04}
      />
    );

    expect(container.querySelector('.animate-spin')).toBeNull();
    expect(container.textContent).not.toContain('Processed');
    expect(container.textContent).not.toContain('Original');
    expect(container.textContent).toContain('Scroll to zoom X');
    expect(container.textContent).not.toContain('1.0× zoom');

    await act(async () => {
      root.unmount();
    });
  });
});

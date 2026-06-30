/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { MainCanvasRawDataModeBanner } from '../MainCanvasRawDataModeBanner';

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

describe('MainCanvasRawDataModeBanner', () => {
  it('renders the raw-data mode guidance', async () => {
    const { container, root } = await render(<MainCanvasRawDataModeBanner />);

    expect(container.textContent).toContain('Raw Data Mode:');
    expect(container.textContent).toContain('Viewing original data without preprocessing.');
    expect(container.textContent).toContain('Add operators from the palette to transform your spectra.');

    await act(async () => {
      root.unmount();
    });
  });
});

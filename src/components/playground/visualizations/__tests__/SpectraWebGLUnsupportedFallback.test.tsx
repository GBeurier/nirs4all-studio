/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { SpectraWebGLUnsupportedFallback } from '../SpectraWebGLUnsupportedFallback';

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

describe('SpectraWebGLUnsupportedFallback', () => {
  it('renders the unsupported-WebGL message', async () => {
    const { container, root } = await render(<SpectraWebGLUnsupportedFallback />);

    expect(container.textContent).toContain('WebGL is not supported on this device');
    expect(container.textContent).toContain('Please use Canvas rendering mode or try a different browser');

    await act(async () => {
      root.unmount();
    });
  });
});

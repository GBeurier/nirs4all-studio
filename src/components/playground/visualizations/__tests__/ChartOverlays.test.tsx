/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { ChartLoadingOverlay } from '../ChartLoadingOverlay';
import { WebglIndicatorBadge } from '../WebglIndicatorBadge';

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

describe('chart visualization overlays', () => {
  it('renders an accessible loading overlay with optional visible label', async () => {
    const { container, root } = await render(
      <ChartLoadingOverlay label="Computing distances..." showLabel />
    );

    const label = container.querySelector('span');
    expect(label?.textContent).toBe('Computing distances...');
    expect(label?.className).toContain('text-muted-foreground');
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');

    await act(async () => {
      root.unmount();
    });
  });

  it('renders the WebGL badge on the requested side', async () => {
    const { container, root } = await render(
      <WebglIndicatorBadge position="top-left" />
    );

    expect(container.textContent).toContain('WebGL');
    expect(container.firstElementChild?.className).toContain('left-2');
    expect(container.firstElementChild?.className).not.toContain('right-2');

    await act(async () => {
      root.unmount();
    });
  });

  it('renders a custom renderer badge label', async () => {
    const { container, root } = await render(
      <WebglIndicatorBadge position="top-left" label="Regl" />
    );

    expect(container.textContent).toContain('Regl');
    expect(container.textContent).not.toContain('WebGL');

    await act(async () => {
      root.unmount();
    });
  });
});

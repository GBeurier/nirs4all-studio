/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { MainCanvasEmptyState } from '../MainCanvasEmptyState';

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

describe('MainCanvasEmptyState', () => {
  it('renders the playground empty-state guidance', async () => {
    const { container, root } = await render(<MainCanvasEmptyState />);

    expect(container.textContent).toContain('NIR Preprocessing Playground');
    expect(container.textContent).toContain('Load Data');
    expect(container.textContent).toContain('Upload CSV file');
    expect(container.textContent).toContain('Add Operators');
    expect(container.textContent).toContain('Preprocessing (SNV, SG...)');

    await act(async () => {
      root.unmount();
    });
  });
});

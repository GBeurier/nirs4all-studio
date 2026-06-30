/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CanvasToolbarColorGroup } from '../CanvasToolbarColorGroup';
import { DEFAULT_GLOBAL_COLOR_CONFIG } from '@/lib/playground/colorConfig';

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

describe('CanvasToolbarColorGroup', () => {
  it('renders the coloration controls with metadata-aware configuration', async () => {
    const { container, root } = await render(
      <CanvasToolbarColorGroup
        colorConfig={{ ...DEFAULT_GLOBAL_COLOR_CONFIG, mode: 'metadata', metadataKey: 'batch' }}
        onColorConfigChange={vi.fn()}
        onInteractionStart={vi.fn()}
        hasFolds
        hasPartition
        hasOutliers={false}
        metadata={{ batch: ['a', 'b'], empty: [] }}
      />
    );

    expect(container.textContent).toContain('Coloration');

    await act(async () => {
      root.unmount();
    });
  });
});

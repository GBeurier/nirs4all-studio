/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import i18n from '@/lib/i18n';

import { CanvasToolbarFilterGroup } from '../CanvasToolbarFilterGroup';

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

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('CanvasToolbarFilterGroup', () => {
  it('renders partition controls only when partition data is available', async () => {
    const onPartitionFilterChange = vi.fn();
    const { container, root } = await render(
      <CanvasToolbarFilterGroup
        hasPartition
        hasFolds={false}
        partitionFilter="all"
        onPartitionFilterChange={onPartitionFilterChange}
        folds={null}
        totalSamples={25}
      />
    );

    expect(container.textContent).toContain('Filter');
    expect(container.textContent).toContain('All');

    await act(async () => {
      root.unmount();
    });
  });
});

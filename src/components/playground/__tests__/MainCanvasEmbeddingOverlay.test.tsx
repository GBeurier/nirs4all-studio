/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MainCanvasEmbeddingOverlay } from '../MainCanvasEmbeddingOverlay';
import type { EmbeddingOverlayInput } from '@/lib/playground/chartInputs';

vi.mock('../EmbeddingSelector', () => ({
  EmbeddingSelector: ({
    embedding,
    sampleIds,
    visible,
    embeddingMethod,
    onToggleExpanded,
  }: {
    embedding?: unknown[];
    sampleIds?: string[];
    visible?: boolean;
    embeddingMethod?: string;
    onToggleExpanded?: () => void;
  }) => (
    <button
      type="button"
      data-visible={String(visible)}
      data-sample-ids={sampleIds?.join(',') ?? ''}
      onClick={onToggleExpanded}
    >
      {embeddingMethod}:{embedding?.length ?? 0}
    </button>
  ),
}));

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

const input: EmbeddingOverlayInput = {
  embedding: [[0, 1], [2, 3]],
  partitions: ['Train', 'Test'],
  targets: [1, 2],
  sampleIds: ['s1', 's2'],
  embeddingMethod: 'pca',
};

describe('MainCanvasEmbeddingOverlay', () => {
  it('renders nothing without visible input', async () => {
    const { container, root } = await render(
      <MainCanvasEmbeddingOverlay
        input={input}
        visible={false}
      />
    );

    expect(container.textContent).toBe('');

    await act(async () => {
      root.unmount();
    });
  });

  it('positions the embedding selector and forwards overlay props', async () => {
    const onToggleExpanded = vi.fn();
    const { container, root } = await render(
      <MainCanvasEmbeddingOverlay
        input={input}
        visible
        onToggleExpanded={onToggleExpanded}
      />
    );

    const overlay = container.querySelector('.absolute.top-24.right-6.z-30');
    expect(overlay).toBeTruthy();

    const button = container.querySelector('button');
    expect(button?.textContent).toBe('pca:2');
    expect(button?.dataset.visible).toBe('true');
    expect(button?.dataset.sampleIds).toBe('s1,s2');

    await act(async () => {
      button?.click();
    });

    expect(onToggleExpanded).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });
});

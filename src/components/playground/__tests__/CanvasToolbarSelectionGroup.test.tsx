/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CanvasToolbarSelectionGroup } from '../CanvasToolbarSelectionGroup';
import { SelectionProvider } from '@/context/SelectionContext';

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

function getButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button'))
    .find(candidate => candidate.textContent?.includes(label));
  expect(button).toBeTruthy();
  return button as HTMLButtonElement;
}

afterEach(() => {
  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers = [];
});

describe('CanvasToolbarSelectionGroup', () => {
  it('renders selected count and wires the keep-selection action', async () => {
    const onFilterToSelection = vi.fn();
    const { container, root } = await render(
      <SelectionProvider>
        <CanvasToolbarSelectionGroup
          selectedCount={2}
          onFilterToSelection={onFilterToSelection}
          folds={null}
          totalSamples={10}
          sampleIds={['s1', 's2']}
        />
      </SelectionProvider>
    );

    expect(container.textContent).toContain('Selection');
    expect(container.textContent).toContain('2 sel.');

    await act(async () => {
      getButton(container, 'Keep').click();
    });

    expect(onFilterToSelection).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });
});

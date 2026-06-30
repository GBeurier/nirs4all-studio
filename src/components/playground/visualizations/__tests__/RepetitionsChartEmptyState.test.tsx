/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RepetitionsChartEmptyState } from '../RepetitionsChartEmptyState';

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

describe('RepetitionsChartEmptyState', () => {
  it('renders loading and error states', async () => {
    const loading = await render(<RepetitionsChartEmptyState kind="loading" />);
    expect(loading.container.textContent).toContain('Loading repetition data...');
    await act(async () => {
      loading.root.unmount();
    });

    const error = await render(<RepetitionsChartEmptyState kind="error" error="missing group column" />);
    expect(error.container.textContent).toContain('Repetition analysis error');
    expect(error.container.textContent).toContain('missing group column');
    await act(async () => {
      error.root.unmount();
    });
  });

  it('renders no-repetition state and forwards configure clicks', async () => {
    const onConfigureRepetitions = vi.fn();
    const { container, root } = await render(
      <RepetitionsChartEmptyState
        kind="no-repetitions"
        message="No repeated biological samples were found."
        onConfigureRepetitions={onConfigureRepetitions}
      />
    );

    expect(container.textContent).toContain('No repetitions detected');
    expect(container.textContent).toContain('No repeated biological samples were found.');

    const button = container.querySelector('button');
    expect(button).not.toBeNull();
    await act(async () => {
      button?.click();
    });
    expect(onConfigureRepetitions).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });
});

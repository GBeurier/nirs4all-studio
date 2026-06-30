/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OperatorPaletteCategorySection } from '../OperatorPaletteCategorySection';
import { OperatorPaletteSearch } from '../OperatorPaletteSearch';
import type { OperatorsByTab } from '@/lib/playground/operatorPaletteData';
import type { OperatorDefinition } from '@/types/playground';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver })
  .ResizeObserver = MockResizeObserver as typeof ResizeObserver;

Object.defineProperty(Element.prototype, 'scrollIntoView', {
  configurable: true,
  value: () => undefined,
});

const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = [];

async function render(element: ReactNode) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ container, root });

  await act(async () => {
    root.render(element);
  });

  return { container, root };
}

afterEach(async () => {
  for (const { container, root } of mountedRoots) {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
  mountedRoots.length = 0;
  document.body.innerHTML = '';
});

function makeOperator(overrides: Partial<OperatorDefinition> = {}): OperatorDefinition {
  return {
    name: 'StandardNormalVariate',
    display_name: 'Standard Normal Variate',
    description: 'Normalize spectra',
    category: 'nirs core',
    params: {},
    type: 'preprocessing',
    ...overrides,
  };
}

describe('OperatorPalette presentation components', () => {
  it('renders search groups with the splitter replacement marker', async () => {
    const filteredOperators: OperatorsByTab = {
      preprocessing: [makeOperator()],
      augmentation: [
        makeOperator({
          name: 'GaussianNoise',
          display_name: 'Gaussian Noise',
          description: 'Add noise',
          category: 'noise',
          type: 'augmentation',
        }),
      ],
      splitting: [
        makeOperator({
          name: 'KFold',
          display_name: 'K Fold',
          description: 'Create folds',
          category: 'sklearn-splitters',
          type: 'splitting',
        }),
      ],
      filter: [],
    };

    await render(
      <OperatorPaletteSearch
        open
        onOpenChange={vi.fn()}
        searchQuery=""
        onSearchQueryChange={vi.fn()}
        filteredOperators={filteredOperators}
        onSelect={vi.fn()}
        showSplitterReplacementHint
      />
    );

    expect(document.body.textContent).toContain('Preprocessing');
    expect(document.body.textContent).toContain('Augmentation');
    expect(document.body.textContent).toContain('Splitting');
    expect(document.body.textContent).toContain('K Fold');
    expect(document.body.textContent).toContain('(replaces)');
  });

  it('renders an expanded category section with shared labels and accent colors', async () => {
    const onSelect = vi.fn();

    const { container } = await render(
      <OperatorPaletteCategorySection
        category="nirs core"
        type="preprocessing"
        operators={[makeOperator()]}
        isExpanded
        onToggle={vi.fn()}
        onSelect={onSelect}
      />
    );

    expect(container.textContent).toContain('NIRS Core');
    expect(container.textContent).toContain('1');
    expect(container.textContent).toContain('Standard Normal Variate');
  });
});

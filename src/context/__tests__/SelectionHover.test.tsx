/**
 * @vitest-environment jsdom
 */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { SelectionProvider } from '../SelectionContext';
import { useHoveredSample, useSelection, useSetHoveredSample } from '../useSelection';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const renders = { selectionOnly: 0, hoverReader: 0, hoverSetter: 0 };
let setHovered: ((index: number | null) => void) | null = null;
let hovered: number | null = null;

function SelectionOnlyConsumer() {
  useSelection();
  renders.selectionOnly += 1;
  return null;
}

function HoverReader() {
  hovered = useHoveredSample();
  renders.hoverReader += 1;
  return null;
}

function HoverSetter() {
  setHovered = useSetHoveredSample();
  renders.hoverSetter += 1;
  return null;
}

let mounted: { container: HTMLDivElement; unmount: () => Promise<void> } | null = null;

async function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <SelectionProvider>
        <SelectionOnlyConsumer />
        <HoverReader />
        <HoverSetter />
      </SelectionProvider>,
    );
  });
  mounted = {
    container,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  renders.selectionOnly = 0;
  renders.hoverReader = 0;
  renders.hoverSetter = 0;
  setHovered = null;
  hovered = null;
});

describe('selection hover isolation', () => {
  it('re-renders only hover readers when the hovered sample changes', async () => {
    await mount();
    const before = { ...renders };

    await act(async () => setHovered?.(3));
    await act(async () => setHovered?.(7));

    expect(hovered).toBe(7);
    expect(renders.hoverReader).toBe(before.hoverReader + 2);
    expect(renders.selectionOnly).toBe(before.selectionOnly);
    expect(renders.hoverSetter).toBe(before.hoverSetter);
  });

  it('does not re-render anything when the hovered sample is unchanged', async () => {
    await mount();
    await act(async () => setHovered?.(3));
    const before = { ...renders };

    await act(async () => setHovered?.(3));

    expect(renders).toEqual(before);
  });
});

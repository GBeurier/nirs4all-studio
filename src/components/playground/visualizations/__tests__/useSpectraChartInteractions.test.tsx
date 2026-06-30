/**
 * @vitest-environment jsdom
 */

import { useRef, useState, type MouseEvent, type ReactNode, type WheelEvent } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SelectionContextValue } from '@/context/useSelection';
import {
  useSpectraChartInteractions,
  type UseSpectraChartInteractionsResult,
} from '../useSpectraChartInteractions';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

interface HarnessState {
  brushDomain: [number, number] | null;
  interactions: UseSpectraChartInteractionsResult;
}

interface HarnessProps {
  selectionCtx?: SelectionContextValue | null;
  displayIndices?: number[];
  enableHover?: boolean;
  onBrushSelect?: (indices: number[]) => void;
  onInteractionStart?: () => void;
}

let mountedContainers: HTMLDivElement[] = [];
let latest: HarnessState | null = null;

function createSelectionContext(overrides: Partial<SelectionContextValue> = {}): SelectionContextValue {
  return {
    selectedSamples: new Set<number>(),
    pinnedSamples: new Set<number>(),
    savedSelections: [],
    selectionHistory: [new Set<number>()],
    historyIndex: 0,
    isSelecting: false,
    selectionMode: 'replace',
    hoveredSample: null,
    lastSelectedIndex: null,
    selectionToolMode: 'click',
    select: vi.fn(),
    deselect: vi.fn(),
    toggle: vi.fn(),
    selectAll: vi.fn(),
    selectRange: vi.fn(),
    selectRangeOrdered: vi.fn(),
    replaceIfNotSole: vi.fn(),
    clear: vi.fn(),
    invert: vi.fn(),
    pin: vi.fn(),
    unpin: vi.fn(),
    clearPins: vi.fn(),
    togglePin: vi.fn(),
    saveSelection: vi.fn(),
    loadSelection: vi.fn(),
    deleteSavedSelection: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    setSelecting: vi.fn(),
    setSelectionMode: vi.fn(),
    setSelectionToolMode: vi.fn(),
    setHovered: vi.fn(),
    isSelected: vi.fn(() => false),
    isPinned: vi.fn(() => false),
    selectedCount: 0,
    pinnedCount: 0,
    hasSelection: false,
    intersectWithAvailable: vi.fn(),
    ...overrides,
  };
}

function Harness({
  selectionCtx = null,
  displayIndices = [0, 1, 2, 3],
  enableHover = true,
  onBrushSelect,
  onInteractionStart,
}: HarnessProps) {
  const chartAreaRef = useRef<HTMLDivElement>(null);
  const [brushDomain, setBrushDomain] = useState<[number, number] | null>(null);
  const interactions = useSpectraChartInteractions({
    chartAreaRef,
    selectionCtx,
    isWebGLMode: false,
    wavelengthRange: [1000, 1040],
    brushDomain,
    setBrushDomain,
    focusedData: {
      wavelengths: [1000, 1010, 1020, 1030, 1040],
      spectra: [
        [0, 0, 0, 0, 0],
        [10, 10, 10, 10, 10],
        [0.1, 0.1, 0.1, 0.1, 0.1],
        [0.2, 0.2, 0.2, 0.2, 0.2],
      ],
    },
    displayIndices,
    yAxisDomain: [0, 10],
    enableHover,
    onBrushSelect,
    onInteractionStart,
  });

  latest = { brushDomain, interactions };
  return <div ref={chartAreaRef} />;
}

async function render(element: ReactNode) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  mountedContainers.push(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(element);
  });

  return { root };
}

afterEach(async () => {
  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers = [];
  latest = null;
});

describe('useSpectraChartInteractions', () => {
  it('zooms the canvas brush domain around the wheel position', async () => {
    const onInteractionStart = vi.fn();
    const preventDefault = vi.fn();

    const { root } = await render(
      <Harness onInteractionStart={onInteractionStart} />
    );

    await act(async () => {
      latest?.interactions.handleWheel({
        preventDefault,
        clientX: 50,
        deltaY: -100,
        currentTarget: {
          getBoundingClientRect: () => ({ left: 0, width: 100 }),
        },
      } as unknown as WheelEvent<HTMLDivElement>);
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(onInteractionStart).toHaveBeenCalledTimes(1);
    expect(latest?.brushDomain).toEqual([1002.6, 1037.4]);

    await act(async () => {
      root.unmount();
    });
  });

  it('selects spectra from a completed wavelength range drag', async () => {
    const selectionCtx = createSelectionContext();
    const onBrushSelect = vi.fn();

    const { root } = await render(
      <Harness selectionCtx={selectionCtx} onBrushSelect={onBrushSelect} />
    );

    await act(async () => {
      latest?.interactions.handleRangeMouseDown({ activeLabel: 1000 });
    });
    await act(async () => {
      latest?.interactions.handleRangeMouseMove({ activeLabel: 1040 });
    });

    expect(latest?.interactions.rangeSelectionBounds).toEqual({
      min: 1000,
      max: 1040,
    });

    await act(async () => {
      latest?.interactions.handleChartMouseUp({
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
      } as MouseEvent<HTMLDivElement>);
    });

    expect(selectionCtx.select).toHaveBeenCalledWith([0, 1], 'replace');
    expect(onBrushSelect).toHaveBeenCalledWith([0, 1]);
    expect(latest?.interactions.rangeSelectionBounds).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it('updates selection hover from Recharts payload indices', async () => {
    const setHovered = vi.fn();
    const selectionCtx = createSelectionContext({ setHovered });

    const { root } = await render(
      <Harness selectionCtx={selectionCtx} displayIndices={[10, 42]} />
    );

    await act(async () => {
      latest?.interactions.handleRangeMouseMove({
        activePayload: [{ dataKey: 'p1' }],
      });
    });

    expect(setHovered).toHaveBeenCalledWith(42);

    await act(async () => {
      root.unmount();
    });
  });
});

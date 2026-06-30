/**
 * @vitest-environment jsdom
 *
 * Characterization tests for InspectorSelectionContext.
 *
 * Pins the public behavior of the Inspector selection provider before it is
 * refactored onto the shared selection core (FE-05-state). The Inspector twin
 * operates on chain_ids (strings) and — unlike the Playground twin — owns a
 * window 'keydown' listener for undo/redo/clear, exposes a separate hover
 * context, and has no range / intersect / replace-if-sole actions.
 */

import { createElement, type ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InspectorSelectionProvider } from '../InspectorSelectionContext';
import {
  useInspectorSelection,
  useInspectorHover,
  type InspectorSelectionContextValue,
  type InspectorSelectionMode,
  type InspectorHoverContextValue,
} from '../useInspectorSelection';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

// ============= Harness =============

interface RenderedHook<T> {
  current: T;
  root: Root;
  container: HTMLDivElement;
}

function renderHookInProvider<T>(useHook: () => T): RenderedHook<T> {
  const result = { current: undefined as unknown as T } as RenderedHook<T>;

  function Probe() {
    result.current = useHook();
    return null;
  }

  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(InspectorSelectionProvider, null, children);
  }

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(createElement(Wrapper, null, createElement(Probe)));
  });

  result.root = root;
  result.container = container;
  return result;
}

function unmount<T>(r: RenderedHook<T>) {
  act(() => {
    r.root.unmount();
  });
  r.container.remove();
}

beforeEach(() => {
  sessionStorage.clear();
});

// ============= Selection semantics =============

describe('InspectorSelectionContext — selection', () => {
  let rendered: RenderedHook<InspectorSelectionContextValue>;

  afterEach(() => {
    if (rendered) unmount(rendered);
  });

  it('starts empty with replace mode and click tool', () => {
    rendered = renderHookInProvider(useInspectorSelection);
    expect(rendered.current.selectedCount).toBe(0);
    expect(rendered.current.hasSelection).toBe(false);
    expect(rendered.current.selectionMode).toBe('replace');
    expect(rendered.current.selectionToolMode).toBe('click');
    expect(rendered.current.canUndo).toBe(false);
    expect(rendered.current.canRedo).toBe(false);
  });

  it('select replaces by default', () => {
    rendered = renderHookInProvider(useInspectorSelection);
    act(() => rendered.current.select(['a', 'b']));
    expect([...rendered.current.selectedChains].sort()).toEqual(['a', 'b']);
    act(() => rendered.current.select(['c']));
    expect([...rendered.current.selectedChains]).toEqual(['c']);
    expect(rendered.current.isSelected('c')).toBe(true);
    expect(rendered.current.isSelected('a')).toBe(false);
  });

  it('select with add/remove/toggle modes', () => {
    rendered = renderHookInProvider(useInspectorSelection);
    act(() => rendered.current.select(['a', 'b']));
    act(() => rendered.current.select(['c'], 'add'));
    expect([...rendered.current.selectedChains].sort()).toEqual(['a', 'b', 'c']);
    act(() => rendered.current.select(['b'], 'remove'));
    expect([...rendered.current.selectedChains].sort()).toEqual(['a', 'c']);
    act(() => rendered.current.select(['a', 'x'], 'toggle'));
    expect([...rendered.current.selectedChains].sort()).toEqual(['c', 'x']);
  });

  it('deselect and toggle action creators', () => {
    rendered = renderHookInProvider(useInspectorSelection);
    act(() => rendered.current.select(['a', 'b', 'c']));
    act(() => rendered.current.deselect(['b']));
    expect([...rendered.current.selectedChains].sort()).toEqual(['a', 'c']);
    act(() => rendered.current.toggle(['c', 'd']));
    expect([...rendered.current.selectedChains].sort()).toEqual(['a', 'd']);
  });

  it('selectAll replaces with given chains; invert flips against the universe', () => {
    rendered = renderHookInProvider(useInspectorSelection);
    act(() => rendered.current.selectAll(['a', 'b', 'c']));
    expect([...rendered.current.selectedChains].sort()).toEqual(['a', 'b', 'c']);
    act(() => rendered.current.invert(['a', 'b', 'c', 'd']));
    expect([...rendered.current.selectedChains]).toEqual(['d']);
  });

  it('clear empties selection and is a no-op when already empty', () => {
    rendered = renderHookInProvider(useInspectorSelection);
    act(() => rendered.current.select(['a']));
    const historyBefore = rendered.current.canUndo;
    expect(historyBefore).toBe(true);
    act(() => rendered.current.clear());
    expect(rendered.current.selectedCount).toBe(0);
    // clear on empty selection does not push history
    const canUndoAfterFirstClear = rendered.current.canUndo;
    act(() => rendered.current.clear());
    expect(rendered.current.canUndo).toBe(canUndoAfterFirstClear);
  });

  it('setSelectionMode and setSelectionToolMode', () => {
    rendered = renderHookInProvider(useInspectorSelection);
    const mode: InspectorSelectionMode = 'add';
    act(() => rendered.current.setSelectionMode(mode));
    expect(rendered.current.selectionMode).toBe('add');
    act(() => rendered.current.setSelectionToolMode('lasso'));
    expect(rendered.current.selectionToolMode).toBe('lasso');
  });
});

// ============= Undo / redo =============

describe('InspectorSelectionContext — history', () => {
  let rendered: RenderedHook<InspectorSelectionContextValue>;
  afterEach(() => {
    if (rendered) unmount(rendered);
  });

  it('undo/redo walk the selection history', () => {
    rendered = renderHookInProvider(useInspectorSelection);
    act(() => rendered.current.select(['a']));
    act(() => rendered.current.select(['b']));
    expect([...rendered.current.selectedChains]).toEqual(['b']);
    expect(rendered.current.canUndo).toBe(true);
    expect(rendered.current.canRedo).toBe(false);

    act(() => rendered.current.undo());
    expect([...rendered.current.selectedChains]).toEqual(['a']);
    expect(rendered.current.canRedo).toBe(true);

    act(() => rendered.current.undo());
    expect(rendered.current.selectedCount).toBe(0);

    act(() => rendered.current.redo());
    expect([...rendered.current.selectedChains]).toEqual(['a']);
  });
});

// ============= Pins =============

describe('InspectorSelectionContext — pins', () => {
  let rendered: RenderedHook<InspectorSelectionContextValue>;
  afterEach(() => {
    if (rendered) unmount(rendered);
  });

  it('pin/unpin/togglePin/clearPins manage the pinned set without history', () => {
    rendered = renderHookInProvider(useInspectorSelection);
    act(() => rendered.current.pin(['a', 'b']));
    expect([...rendered.current.pinnedChains].sort()).toEqual(['a', 'b']);
    expect(rendered.current.isPinned('a')).toBe(true);
    expect(rendered.current.pinnedCount).toBe(2);
    // Pins are independent of selection history
    expect(rendered.current.canUndo).toBe(false);

    act(() => rendered.current.unpin(['a']));
    expect([...rendered.current.pinnedChains]).toEqual(['b']);
    act(() => rendered.current.togglePin('b'));
    expect(rendered.current.pinnedCount).toBe(0);
    act(() => rendered.current.togglePin('c'));
    expect([...rendered.current.pinnedChains]).toEqual(['c']);
    act(() => rendered.current.clearPins());
    expect(rendered.current.pinnedCount).toBe(0);
  });
});

// ============= Saved selections =============

describe('InspectorSelectionContext — saved selections', () => {
  let rendered: RenderedHook<InspectorSelectionContextValue>;
  afterEach(() => {
    if (rendered) unmount(rendered);
  });

  it('save/load/delete round-trips the selected chains', () => {
    rendered = renderHookInProvider(useInspectorSelection);
    act(() => rendered.current.select(['a', 'b']));
    act(() => rendered.current.saveSelection('first', '#ff0000'));
    expect(rendered.current.savedSelections).toHaveLength(1);
    const saved = rendered.current.savedSelections[0];
    expect(saved.name).toBe('first');
    expect(saved.chain_ids.sort()).toEqual(['a', 'b']);
    expect(saved.color).toBe('#ff0000');
    expect(typeof saved.createdAt).toBe('string');

    act(() => rendered.current.clear());
    expect(rendered.current.selectedCount).toBe(0);
    act(() => rendered.current.loadSelection(saved.id));
    expect([...rendered.current.selectedChains].sort()).toEqual(['a', 'b']);

    act(() => rendered.current.deleteSavedSelection(saved.id));
    expect(rendered.current.savedSelections).toHaveLength(0);
  });

  it('saveSelection is a no-op on an empty selection', () => {
    rendered = renderHookInProvider(useInspectorSelection);
    act(() => rendered.current.saveSelection('empty'));
    expect(rendered.current.savedSelections).toHaveLength(0);
  });
});

// ============= Hover context =============

describe('InspectorSelectionContext — hover', () => {
  it('exposes a separate hover context independent of selection', () => {
    const rendered = renderHookInProvider(useInspectorHover);
    expect(rendered.current.hoveredChain).toBeNull();
    act(() => rendered.current.setHovered('a'));
    expect(rendered.current.hoveredChain).toBe('a');
    act(() => rendered.current.setHovered(null));
    expect(rendered.current.hoveredChain).toBeNull();
    unmount(rendered);
  });

  it('useInspectorHover throws outside a provider', () => {
    expect(() => {
      const value: { current: InspectorHoverContextValue | null } = { current: null };
      function Probe() {
        value.current = useInspectorHover();
        return null;
      }
      const container = document.createElement('div');
      const root = createRoot(container);
      act(() => root.render(createElement(Probe)));
    }).toThrow('useInspectorHover must be used within an InspectorSelectionProvider');
  });
});

// ============= Keyboard ownership =============

describe('InspectorSelectionContext — keyboard ownership', () => {
  it('registers exactly one window keydown listener that drives undo/redo/clear', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    const value = { current: undefined as unknown as InspectorSelectionContextValue };
    function Probe() {
      value.current = useInspectorSelection();
      return null;
    }

    act(() => {
      root.render(
        createElement(InspectorSelectionProvider, null, createElement(Probe))
      );
    });

    // Seed two history entries
    act(() => value.current.select(['a']));
    act(() => value.current.select(['b']));
    expect([...value.current.selectedChains]).toEqual(['b']);

    // Ctrl+Z → undo
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
    });
    expect([...value.current.selectedChains]).toEqual(['a']);

    // Ctrl+Shift+Z → redo
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true }));
    });
    expect([...value.current.selectedChains]).toEqual(['b']);

    // Escape → clear
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(value.current.selectedCount).toBe(0);

    act(() => root.unmount());
    container.remove();
  });
});

// ============= Guard =============

describe('InspectorSelectionContext — provider guard', () => {
  it('useInspectorSelection throws outside a provider', () => {
    expect(() => {
      function Probe() {
        useInspectorSelection();
        return null;
      }
      const container = document.createElement('div');
      const root = createRoot(container);
      act(() => root.render(createElement(Probe)));
    }).toThrow('useInspectorSelection must be used within an InspectorSelectionProvider');
  });
});

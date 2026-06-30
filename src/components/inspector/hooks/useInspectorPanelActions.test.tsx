/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { InspectorViewProvider } from '@/context/InspectorViewContext';
import type { InspectorViewContextValue } from '@/context/useInspectorView';
import { useInspectorView } from '@/context/useInspectorView';

import { useInspectorPanelActions } from './useInspectorPanelActions';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

interface HarnessResult {
  actions: ReturnType<typeof useInspectorPanelActions>;
  view: InspectorViewContextValue;
}

async function renderHook<T>(hook: () => T, wrapper?: (props: { children: ReactNode }) => ReactNode) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const result: { current: T | undefined } = { current: undefined };

  function TestComponent() {
    result.current = hook();
    return null;
  }

  const element = wrapper
    ? wrapper({ children: <TestComponent /> })
    : <TestComponent />;

  await act(async () => {
    root.render(element);
  });

  return {
    result,
    rerender: async () => {
      await act(async () => {
        root.render(element);
      });
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function useHarness(): HarnessResult {
  return {
    actions: useInspectorPanelActions(),
    view: useInspectorView(),
  };
}

describe('useInspectorPanelActions', () => {
  it('exposes reusable actions backed by InspectorViewProvider', async () => {
    const mounted = await renderHook(useHarness, ({ children }) => (
      <InspectorViewProvider>{children}</InspectorViewProvider>
    ));

    await act(async () => {
      mounted.result.current!.actions.rankings.onMaximize();
    });
    expect(mounted.result.current!.view.maximizedPanel).toBe('rankings');
    expect(mounted.result.current!.view.panelStates.rankings).toBe('maximized');

    await act(async () => {
      mounted.result.current!.actions.rankings.onRestore();
    });
    expect(mounted.result.current!.view.maximizedPanel).toBeNull();
    expect(mounted.result.current!.view.panelStates.rankings).toBe('visible');

    await act(async () => {
      mounted.result.current!.actions.heatmap.onMinimize();
    });
    expect(mounted.result.current!.view.panelStates.heatmap).toBe('minimized');

    await act(async () => {
      mounted.result.current!.actions.heatmap.onHide();
    });
    expect(mounted.result.current!.view.panelStates.heatmap).toBe('hidden');

    await mounted.unmount();
  });

  it('keeps panel action references stable while view state changes', async () => {
    const mounted = await renderHook(useHarness, ({ children }) => (
      <InspectorViewProvider>{children}</InspectorViewProvider>
    ));
    const initialActions = mounted.result.current!.actions;

    await act(async () => {
      mounted.result.current!.actions.rankings.onMaximize();
    });
    await mounted.rerender();

    expect(mounted.result.current!.actions).toBe(initialActions);
    expect(mounted.result.current!.actions.rankings).toBe(initialActions.rankings);

    await mounted.unmount();
  });
});

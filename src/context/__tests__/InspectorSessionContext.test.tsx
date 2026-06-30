/**
 * @vitest-environment jsdom
 */

import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InspectorSessionProvider } from '../InspectorSessionContext';
import { useInspectorSession, type InspectorSessionContextValue } from '../useInspectorSession';
import { INSPECTOR_SESSION_STORAGE_KEY } from '@/lib/inspector/sessionState';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

interface RenderedHook<T> {
  current: T;
  root: Root;
  container: HTMLDivElement;
}

function renderInspectorSession(): RenderedHook<InspectorSessionContextValue> {
  const result = { current: undefined as unknown as InspectorSessionContextValue } as RenderedHook<InspectorSessionContextValue>;

  function Probe() {
    result.current = useInspectorSession();
    return null;
  }

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(createElement(InspectorSessionProvider, null, createElement(Probe)));
  });

  result.root = root;
  result.container = container;
  return result;
}

function unmount<T>(rendered: RenderedHook<T>) {
  act(() => {
    rendered.root.unmount();
  });
  rendered.container.remove();
}

beforeEach(() => {
  sessionStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(1000);
});

afterEach(() => {
  sessionStorage.clear();
  vi.useRealTimers();
});

describe('InspectorSessionProvider', () => {
  it('persists inspector session state under the existing session key and JSON format', () => {
    const rendered = renderInspectorSession();

    try {
      expect(rendered.current.hasSession).toBe(false);

      act(() => {
        rendered.current.saveSession({
          partition: 'test',
          scoreColumn: 'cv_test_score',
        });
      });

      expect(sessionStorage.getItem(INSPECTOR_SESSION_STORAGE_KEY)).toBeNull();

      act(() => {
        vi.advanceTimersByTime(500);
      });

      const raw = sessionStorage.getItem(INSPECTOR_SESSION_STORAGE_KEY);
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw ?? '{}')).toMatchObject({
        filters: {},
        groupMode: 'by_variable',
        groupBy: 'model_class',
        partition: 'test',
        scoreColumn: 'cv_test_score',
        savedAt: 1000,
      });
    } finally {
      unmount(rendered);
    }
  });
});

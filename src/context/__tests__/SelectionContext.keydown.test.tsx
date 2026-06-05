/**
 * @vitest-environment jsdom
 *
 * Regression test for FE-01-state: SelectionContext must NOT register its own
 * window 'keydown' listener. usePlaygroundShortcuts is the single owner of the
 * Playground keybindings (undo/redo/clear); a second listener here double-dispatched
 * UNDO/CLEAR and clobbered selection on Ctrl+Z / Escape.
 */

import { createElement } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SelectionProvider } from '../SelectionContext';

describe('SelectionContext keyboard ownership (FE-01-state)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not register a window keydown listener', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(createElement(SelectionProvider, null, createElement('div')));
    });

    const keydownRegistrations = addSpy.mock.calls.filter(([type]) => type === 'keydown');
    expect(keydownRegistrations).toHaveLength(0);

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});

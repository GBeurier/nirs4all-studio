import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadPlaygroundSelectionState,
  persistPlaygroundSelectionState,
} from './playgroundSelectionStorage';

describe('playgroundSelectionStorage', () => {
  beforeEach(() => {
    let store: Record<string, string> = {};

    const sessionStorage = {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        store = {};
      }),
    };

    vi.stubGlobal('window', { sessionStorage });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persists and restores playground selection state', () => {
    const createdAt = new Date('2026-01-02T03:04:05.000Z');

    persistPlaygroundSelectionState(
      new Set([2, 4]),
      new Set([8]),
      [
        {
          id: 'selection-1',
          name: 'Interesting samples',
          indices: [2, 4],
          createdAt,
          color: '#0f766e',
        },
      ],
    );

    const restored = loadPlaygroundSelectionState();

    expect(restored?.selectedSamples).toEqual(new Set([2, 4]));
    expect(restored?.pinnedSamples).toEqual(new Set([8]));
    expect(restored?.savedSelections).toHaveLength(1);
    expect(restored?.savedSelections?.[0]).toMatchObject({
      id: 'selection-1',
      name: 'Interesting samples',
      indices: [2, 4],
      color: '#0f766e',
    });
    expect(restored?.savedSelections?.[0]?.createdAt).toBeInstanceOf(Date);
    expect(restored?.savedSelections?.[0]?.createdAt.toISOString()).toBe(createdAt.toISOString());
  });

  it('returns null when no persisted state exists', () => {
    expect(loadPlaygroundSelectionState()).toBeNull();
  });
});

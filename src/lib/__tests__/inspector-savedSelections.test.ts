import { describe, expect, it } from 'vitest';

import {
  buildInspectorSavedSelectionsJson,
  DEFAULT_INSPECTOR_SELECTION_COLOR,
  findActiveInspectorSavedSelectionId,
  INSPECTOR_SELECTION_COLORS,
  parseImportableInspectorSavedSelections,
} from '@/lib/inspector/savedSelections';
import type { InspectorSavedSelection } from '@/types/inspector';

function selection(overrides: Partial<InspectorSavedSelection> = {}): InspectorSavedSelection {
  return {
    id: 'sel-1',
    name: 'Selection 1',
    chain_ids: ['chain-a', 'chain-b'],
    createdAt: '2026-06-28T00:00:00.000Z',
    color: DEFAULT_INSPECTOR_SELECTION_COLOR,
    ...overrides,
  };
}

describe('inspector saved selection helpers', () => {
  it('exposes a stable default color from the palette', () => {
    expect(INSPECTOR_SELECTION_COLORS[0].value).toBe(DEFAULT_INSPECTOR_SELECTION_COLOR);
  });

  it('finds a saved selection that exactly matches the active chain set', () => {
    const savedSelections = [
      selection({ id: 'partial', chain_ids: ['chain-a'] }),
      selection({ id: 'match', chain_ids: ['chain-b', 'chain-a'] }),
    ];

    expect(findActiveInspectorSavedSelectionId({
      savedSelections,
      selectedChains: new Set(['chain-a', 'chain-b']),
      selectedCount: 2,
    })).toBe('match');
    expect(findActiveInspectorSavedSelectionId({
      savedSelections,
      selectedChains: new Set(['chain-a', 'chain-b', 'chain-c']),
      selectedCount: 3,
    })).toBeUndefined();
  });

  it('serializes saved selections as formatted JSON', () => {
    expect(buildInspectorSavedSelectionsJson([selection()])).toContain('\n    "id": "sel-1"');
  });

  it('filters import payloads to usable saved selections', () => {
    const parsed = parseImportableInspectorSavedSelections(JSON.stringify([
      selection({ id: 'valid' }),
      { name: 'empty', chain_ids: [] },
      { name: 'bad ids', chain_ids: [1] },
      { chain_ids: ['chain-c'] },
    ]));

    expect(parsed).toEqual([selection({ id: 'valid' })]);
    expect(() => parseImportableInspectorSavedSelections('{}')).toThrow('Invalid saved-selection export');
  });
});

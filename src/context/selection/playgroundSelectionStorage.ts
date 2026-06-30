import {
  loadPersistedSelection,
  persistSelection,
  type PersistFieldNames,
} from './createSelectionCore';
import type { SavedSelection, SelectionState } from '../useSelection';

const STORAGE_KEY = 'playground-selection-state';
const PERSIST_FIELDS: PersistFieldNames = {
  selected: 'selectedSamples',
  pinned: 'pinnedSamples',
  savedSelections: 'savedSelections',
};

export function persistPlaygroundSelectionState(
  selectedSamples: Set<number>,
  pinnedSamples: Set<number>,
  savedSelections: SavedSelection[],
): void {
  persistSelection(STORAGE_KEY, PERSIST_FIELDS, selectedSamples, pinnedSamples, savedSelections);
}

export function loadPlaygroundSelectionState(): Partial<SelectionState> | null {
  const parsed = loadPersistedSelection<number, SavedSelection>(STORAGE_KEY, PERSIST_FIELDS);
  if (!parsed) {
    return null;
  }

  return {
    selectedSamples: new Set(parsed.selected || []),
    pinnedSamples: new Set(parsed.pinned || []),
    savedSelections: (parsed.savedSelections || []).map(savedSelection => ({
      ...savedSelection,
      createdAt: new Date(savedSelection.createdAt),
    })),
  };
}

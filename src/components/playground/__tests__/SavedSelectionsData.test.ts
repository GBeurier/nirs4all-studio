import { describe, expect, it } from 'vitest';

import type { SavedSelection } from '@/context/useSelection';

import {
  buildCompactSaveTooltipDescription,
  buildCsvImportNotification,
  buildCurrentSelectionExportedToastDescription,
  buildInvalidImportFileNotification,
  buildJsonImportNotification,
  buildSaveSelectionDialogDescription,
  buildSelectionDeletedToastDescription,
  buildSelectionLoadedToastDescription,
  buildSelectionSavedToastDescription,
  buildSelectionsExportedToastDescription,
  classifySelectionImportFile,
  getActiveSavedSelectionId,
  savedSelectionMatchesCurrentSelection,
} from '../SavedSelectionsData';

function savedSelection(overrides: Partial<SavedSelection>): SavedSelection {
  return {
    id: 'selection-1',
    name: 'Outliers',
    indices: [1, 2, 3],
    createdAt: new Date('2025-01-01T00:00:00Z'),
    color: '#3b82f6',
    ...overrides,
  };
}

describe('SavedSelectionsData selection matching', () => {
  it('matches saved selections by selected sample membership, independent of order', () => {
    const selection = savedSelection({ indices: [3, 1, 2] });

    expect(savedSelectionMatchesCurrentSelection(selection, new Set([1, 2, 3]), 3)).toBe(true);
  });

  it('rejects saved selections with different counts or missing selected samples', () => {
    const selection = savedSelection({ indices: [1, 2, 3] });

    expect(savedSelectionMatchesCurrentSelection(selection, new Set([1, 2]), 2)).toBe(false);
    expect(savedSelectionMatchesCurrentSelection(selection, new Set([1, 2, 4]), 3)).toBe(false);
  });

  it('returns the first active saved selection id', () => {
    const selections = [
      savedSelection({ id: 'wrong-count', indices: [1, 2] }),
      savedSelection({ id: 'active', indices: [4, 5, 6] }),
      savedSelection({ id: 'also-active', indices: [6, 5, 4] }),
    ];

    expect(getActiveSavedSelectionId(selections, new Set([6, 4, 5]), 3)).toBe('active');
  });
});

describe('SavedSelectionsData descriptions', () => {
  it('builds saved selection toast descriptions', () => {
    const selection = savedSelection({ name: 'Batch A', indices: [7, 8] });

    expect(buildSelectionSavedToastDescription('Batch A', 2)).toBe('"Batch A" with 2 samples');
    expect(buildSelectionLoadedToastDescription(selection)).toBe('"Batch A" - 2 samples');
    expect(buildSelectionDeletedToastDescription(selection)).toBe('"Batch A" removed');
    expect(buildSelectionsExportedToastDescription(3, 'selections.json')).toBe('3 selection(s) saved to selections.json');
    expect(buildCurrentSelectionExportedToastDescription(4, 'current.csv')).toBe('4 sample(s) saved to current.csv');
  });

  it('builds selected sample UI descriptions with existing pluralization', () => {
    expect(buildSaveSelectionDialogDescription(1)).toBe('Save the current 1 selected sample for later use.');
    expect(buildSaveSelectionDialogDescription(2)).toBe('Save the current 2 selected samples for later use.');
    expect(buildCompactSaveTooltipDescription(1)).toBe('Save the 1 selected sample for later recall. Saved selections persist during this session.');
    expect(buildCompactSaveTooltipDescription(2)).toBe('Save the 2 selected samples for later recall. Saved selections persist during this session.');
  });
});

describe('SavedSelectionsData import file classification', () => {
  it('classifies only the lowercase supported extensions used by the component', () => {
    expect(classifySelectionImportFile('selections.json')).toBe('json');
    expect(classifySelectionImportFile('selection.csv')).toBe('csv');
    expect(classifySelectionImportFile('selection.JSON')).toBe('invalid');
    expect(classifySelectionImportFile('selection.csv.backup')).toBe('invalid');
  });
});

describe('SavedSelectionsData import notifications', () => {
  it('builds JSON import success and warning notifications', () => {
    expect(buildJsonImportNotification({
      selectionCount: 2,
      warnings: [],
      unmappedCount: 0,
    })).toEqual({
      level: 'success',
      title: 'Selections imported',
      description: '2 selection(s) added',
    });

    expect(buildJsonImportNotification({
      selectionCount: 2,
      warnings: ['Selection "Imported": 1 sample IDs could not be mapped'],
      unmappedCount: 1,
    })).toEqual({
      level: 'warning',
      title: 'Import completed with warnings',
      description: 'Selection "Imported": 1 sample IDs could not be mapped',
    });

    expect(buildJsonImportNotification({
      selectionCount: 2,
      warnings: [],
      unmappedCount: 3,
    })).toEqual({
      level: 'warning',
      title: 'Import completed with warnings',
      description: '3 sample IDs could not be mapped',
    });
  });

  it('builds CSV import error, warning, and success notifications', () => {
    expect(buildCsvImportNotification({
      selectedCount: 0,
      warnings: [],
      unmappedCount: 0,
    })).toEqual({
      level: 'error',
      title: 'Import failed',
      description: 'No valid samples found in CSV',
    });

    expect(buildCsvImportNotification({
      selectedCount: 5,
      warnings: ['1 sample ID could not be mapped'],
      unmappedCount: 1,
    })).toEqual({
      level: 'warning',
      title: 'Selection imported with warnings',
      description: '5 samples loaded, 1 unmapped',
    });

    expect(buildCsvImportNotification({
      selectedCount: 5,
      warnings: [],
      unmappedCount: 0,
    })).toEqual({
      level: 'success',
      title: 'Selection imported',
      description: '5 samples selected',
    });
  });

  it('builds the invalid file notification read model', () => {
    expect(buildInvalidImportFileNotification()).toEqual({
      level: 'error',
      title: 'Invalid file format',
      description: 'Please use .json or .csv files',
    });
  });
});

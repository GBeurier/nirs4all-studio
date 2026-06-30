import type { SavedSelection } from '@/context/useSelection';

export type SelectionImportFileType = 'json' | 'csv' | 'invalid';

export type SavedSelectionNotificationLevel = 'success' | 'warning' | 'error';

export interface SavedSelectionNotification {
  level: SavedSelectionNotificationLevel;
  title: string;
  description: string;
}

interface JsonImportNotificationInput {
  selectionCount: number;
  warnings: readonly string[];
  unmappedCount: number;
}

interface CsvImportNotificationInput {
  selectedCount: number;
  warnings: readonly string[];
  unmappedCount: number;
}

export function savedSelectionMatchesCurrentSelection(
  selection: Pick<SavedSelection, 'indices'>,
  selectedSamples: Iterable<number>,
  selectedCount: number
): boolean {
  if (selection.indices.length !== selectedCount) return false;

  const savedSet = new Set(selection.indices);
  for (const sampleIndex of selectedSamples) {
    if (!savedSet.has(sampleIndex)) return false;
  }

  return true;
}

export function getActiveSavedSelectionId(
  savedSelections: readonly SavedSelection[],
  selectedSamples: Iterable<number>,
  selectedCount: number
): string | undefined {
  const selectedSampleIndices = Array.from(selectedSamples);
  return savedSelections.find((selection) => (
    savedSelectionMatchesCurrentSelection(selection, selectedSampleIndices, selectedCount)
  ))?.id;
}

export function buildSelectionSavedToastDescription(name: string, selectedCount: number): string {
  return `"${name}" with ${selectedCount} samples`;
}

export function buildSelectionLoadedToastDescription(
  selection: Pick<SavedSelection, 'name' | 'indices'>
): string {
  return `"${selection.name}" - ${selection.indices.length} samples`;
}

export function buildSelectionDeletedToastDescription(selection: Pick<SavedSelection, 'name'>): string {
  return `"${selection.name}" removed`;
}

export function buildSelectionsExportedToastDescription(selectionCount: number, filename: string): string {
  return `${selectionCount} selection(s) saved to ${filename}`;
}

export function buildCurrentSelectionExportedToastDescription(selectedCount: number, filename: string): string {
  return `${selectedCount} sample(s) saved to ${filename}`;
}

export function buildSaveSelectionDialogDescription(selectedCount: number): string {
  return `Save the current ${selectedCount} selected sample${selectedCount !== 1 ? 's' : ''} for later use.`;
}

export function buildCompactSaveTooltipDescription(selectedCount: number): string {
  return `Save the ${selectedCount} selected sample${selectedCount !== 1 ? 's' : ''} for later recall. Saved selections persist during this session.`;
}

export function classifySelectionImportFile(filename: string): SelectionImportFileType {
  if (filename.endsWith('.json')) return 'json';
  if (filename.endsWith('.csv')) return 'csv';
  return 'invalid';
}

export function buildJsonImportNotification({
  selectionCount,
  warnings,
  unmappedCount,
}: JsonImportNotificationInput): SavedSelectionNotification {
  if (warnings.length > 0 || unmappedCount > 0) {
    return {
      level: 'warning',
      title: 'Import completed with warnings',
      description: warnings[0] || `${unmappedCount} sample IDs could not be mapped`,
    };
  }

  return {
    level: 'success',
    title: 'Selections imported',
    description: `${selectionCount} selection(s) added`,
  };
}

export function buildCsvImportNotification({
  selectedCount,
  warnings,
  unmappedCount,
}: CsvImportNotificationInput): SavedSelectionNotification {
  if (selectedCount === 0) {
    return {
      level: 'error',
      title: 'Import failed',
      description: 'No valid samples found in CSV',
    };
  }

  if (warnings.length > 0 || unmappedCount > 0) {
    return {
      level: 'warning',
      title: 'Selection imported with warnings',
      description: `${selectedCount} samples loaded, ${unmappedCount} unmapped`,
    };
  }

  return {
    level: 'success',
    title: 'Selection imported',
    description: `${selectedCount} samples selected`,
  };
}

export function buildInvalidImportFileNotification(): SavedSelectionNotification {
  return {
    level: 'error',
    title: 'Invalid file format',
    description: 'Please use .json or .csv files',
  };
}

import i18n from 'i18next';

import type { SavedSelection } from '@/context/useSelection';
import { useTranslation } from 'react-i18next';

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
  return i18n.t('playground.savedSelections.toast.savedDescription', { name, count: selectedCount });
}

export function buildSelectionLoadedToastDescription(
  selection: Pick<SavedSelection, 'name' | 'indices'>
): string {
  return i18n.t('playground.savedSelections.toast.loadedDescription', { name: selection.name, count: selection.indices.length });
}

export function buildSelectionDeletedToastDescription(selection: Pick<SavedSelection, 'name'>): string {
  return i18n.t('playground.savedSelections.toast.deletedDescription', { name: selection.name });
}

export function buildSelectionsExportedToastDescription(selectionCount: number, filename: string): string {
  return i18n.t('playground.savedSelections.toast.exportedAll', { count: selectionCount, filename });
}

export function buildCurrentSelectionExportedToastDescription(selectedCount: number, filename: string): string {
  return i18n.t('playground.savedSelections.toast.exportedCurrent', { count: selectedCount, filename });
}

export function buildSaveSelectionDialogDescription(selectedCount: number): string {
  return i18n.t('playground.savedSelections.dialog.description', { count: selectedCount });
}

export function buildCompactSaveTooltipDescription(selectedCount: number): string {
  return i18n.t('playground.savedSelections.compactTooltip', { count: selectedCount });
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
      title: i18n.t('playground.savedSelections.import.warningTitle'),
      description: warnings[0] || i18n.t('playground.savedSelections.import.unmapped', { count: unmappedCount }),
    };
  }

  return {
    level: 'success',
    title: i18n.t('playground.savedSelections.import.selectionsImported'),
    description: i18n.t('playground.savedSelections.import.selectionsAdded', { count: selectionCount }),
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
      title: i18n.t('playground.savedSelections.import.failed'),
      description: i18n.t('playground.savedSelections.import.noValidSamples'),
    };
  }

  if (warnings.length > 0 || unmappedCount > 0) {
    return {
      level: 'warning',
      title: i18n.t('playground.savedSelections.import.selectionWarningTitle'),
      description: i18n.t('playground.savedSelections.import.loadedUnmapped', { count: selectedCount, unmapped: unmappedCount }),
    };
  }

  return {
    level: 'success',
    title: i18n.t('playground.savedSelections.import.selectionImported'),
    description: i18n.t('playground.savedSelections.import.samplesSelected', { count: selectedCount }),
  };
}

export function buildInvalidImportFileNotification(): SavedSelectionNotification {
  return {
    level: 'error',
    title: i18n.t('playground.savedSelections.import.invalidFormat'),
    description: i18n.t('playground.savedSelections.import.useJsonOrCsv'),
  };
}

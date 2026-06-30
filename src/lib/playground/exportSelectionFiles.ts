/**
 * Saved-selection file exchange
 *
 * Browser-facing orchestration for saved-selection JSON/CSV files: it wraps the
 * pure serialization/mapping in {@link module:exportSelections} with the
 * download/error glue from {@link module:exportResult}, producing the
 * {@link ExportResult} (or import result) shapes the public `export.ts` API
 * returns. Keeping these wrappers in one focused module makes it the single
 * place to extend for future repository / WASM-local selection exchange formats.
 */

import type { SavedSelection } from '@/context/useSelection';
import {
  buildSelectionCsv,
  buildSelectionsExportPayload,
  parseSelectionCsv,
  parseSelectionsJson,
  type SelectionImportResult,
} from '@/lib/playground/exportSelections';
import { finalizeTextExport, toExportError } from '@/lib/playground/exportResult';
import type { ExportOptions, ExportResult } from '@/lib/playground/export';

/**
 * Enhanced selection export options
 */
export interface SelectionExportOptions extends ExportOptions {
  /** Sample IDs for index-to-ID mapping */
  sampleIds?: string[];
  /** Export format: 'json' or 'csv' */
  format?: 'json' | 'csv';
  /** Include both indices and sample IDs in export */
  includeBoth?: boolean;
}

/**
 * Export selections to JSON (enhanced with sample ID support)
 */
export function exportSelectionsToJson(
  selections: SavedSelection[],
  options: SelectionExportOptions = {}
): ExportResult {
  const {
    filename = 'selections',
    includeTimestamp = true,
    sampleIds,
    includeBoth = true,
  } = options;

  try {
    const exportData = buildSelectionsExportPayload(selections, { sampleIds, includeBoth });
    const json = JSON.stringify(exportData, null, 2);

    return finalizeTextExport(json, filename, 'json', includeTimestamp);
  } catch (error) {
    return toExportError(error, 'json');
  }
}

/**
 * Export current selection to CSV (sample IDs or indices)
 */
export function exportSelectionToCsv(
  indices: number[],
  options: SelectionExportOptions = {}
): ExportResult {
  const {
    filename = 'selection',
    includeTimestamp = true,
    sampleIds,
    includeBoth = false,
  } = options;

  try {
    const csv = buildSelectionCsv(indices, { sampleIds, includeBoth });
    return finalizeTextExport(csv, filename, 'csv', includeTimestamp);
  } catch (error) {
    return toExportError(error, 'csv');
  }
}

/**
 * Import selections from JSON (enhanced with sample ID support)
 */
export function importSelectionsFromJson(
  jsonString: string,
  sampleIds?: string[]
): SelectionImportResult {
  return parseSelectionsJson(jsonString, sampleIds);
}

/**
 * Import selection from CSV file (sample IDs or indices)
 * Expected format: header row with 'index' and/or 'sample_id' columns
 */
export function importSelectionFromCsv(
  csvString: string,
  sampleIds?: string[]
): { indices: number[]; warnings: string[]; unmappedCount: number } {
  return parseSelectionCsv(csvString, sampleIds);
}

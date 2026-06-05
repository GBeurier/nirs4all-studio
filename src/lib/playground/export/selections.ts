/**
 * Export System - Selections export/import (JSON / CSV)
 */

import type { SavedSelection } from '@/context/SelectionContext';
import { MIME_TYPES, downloadBlob, generateFilename } from './shared';
import type { ExportOptions, ExportResult } from './types';

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
    const exportData = {
      version: '2.0',
      exportedAt: new Date().toISOString(),
      count: selections.length,
      hasSampleIds: !!sampleIds,
      selections: selections.map((s) => {
        const exportedSelection: Record<string, unknown> = {
          id: s.id,
          name: s.name,
          color: s.color,
          createdAt: s.createdAt instanceof Date
            ? s.createdAt.toISOString()
            : s.createdAt,
        };

        // Export with sample IDs if available
        if (sampleIds && sampleIds.length > 0) {
          exportedSelection.sampleIds = s.indices
            .filter(i => i >= 0 && i < sampleIds.length)
            .map(i => sampleIds[i]);
          if (includeBoth) {
            exportedSelection.indices = s.indices;
          }
        } else {
          exportedSelection.indices = s.indices;
        }

        return exportedSelection;
      }),
    };

    const json = JSON.stringify(exportData, null, 2);

    const blob = new Blob([json], { type: MIME_TYPES.json });
    const finalFilename = generateFilename(filename, 'json', includeTimestamp);
    downloadBlob(blob, finalFilename);

    return {
      success: true,
      filename: finalFilename,
      format: 'json',
      size: blob.size,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Export failed',
      format: 'json',
    };
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
    const headers: string[] = [];
    const useIds = sampleIds && sampleIds.length > 0;

    if (includeBoth || !useIds) {
      headers.push('index');
    }
    if (useIds) {
      headers.push('sample_id');
    }

    const rows = indices.map((idx) => {
      const row: (string | number)[] = [];
      if (includeBoth || !useIds) {
        row.push(idx);
      }
      if (useIds && idx >= 0 && idx < sampleIds!.length) {
        row.push(sampleIds![idx]);
      } else if (useIds) {
        row.push(''); // Unknown sample ID
      }
      return row.join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');

    const blob = new Blob([csv], { type: MIME_TYPES.csv });
    const finalFilename = generateFilename(filename, 'csv', includeTimestamp);
    downloadBlob(blob, finalFilename);

    return {
      success: true,
      filename: finalFilename,
      format: 'csv',
      size: blob.size,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Export failed',
      format: 'csv',
    };
  }
}

/**
 * Import result with indices mapped from sample IDs if needed
 */
export interface SelectionImportResult {
  selections: SavedSelection[];
  warnings: string[];
  /** Number of sample IDs that couldn't be mapped to indices */
  unmappedCount: number;
}

/**
 * Import selections from JSON (enhanced with sample ID support)
 */
export function importSelectionsFromJson(
  jsonString: string,
  sampleIds?: string[]
): SelectionImportResult {
  const warnings: string[] = [];
  let unmappedCount = 0;

  try {
    const data = JSON.parse(jsonString);

    if (!data.selections || !Array.isArray(data.selections)) {
      throw new Error('Invalid selections format: missing selections array');
    }

    // Build sample ID to index map if we have sample IDs
    const idToIndex = new Map<string, number>();
    if (sampleIds) {
      sampleIds.forEach((id, idx) => {
        idToIndex.set(id, idx);
      });
    }

    const selections: SavedSelection[] = data.selections.map(
      (s: {
        id?: string;
        name?: string;
        indices?: number[];
        sampleIds?: string[];
        color?: string;
        createdAt?: string;
      }) => {
        if (!s.name) {
          warnings.push(`Skipping invalid selection: missing name`);
          return null;
        }

        let indices: number[] = [];

        // Priority: use indices if available, otherwise map from sampleIds
        if (s.indices && s.indices.length > 0) {
          indices = s.indices;
        } else if (s.sampleIds && s.sampleIds.length > 0) {
          // Map sample IDs to indices
          if (sampleIds && idToIndex.size > 0) {
            indices = s.sampleIds
              .map((sid) => {
                const idx = idToIndex.get(sid);
                if (idx === undefined) {
                  unmappedCount++;
                  return -1;
                }
                return idx;
              })
              .filter((idx) => idx >= 0);

            if (indices.length < s.sampleIds.length) {
              warnings.push(
                `Selection "${s.name}": ${s.sampleIds.length - indices.length} sample IDs could not be mapped`
              );
            }
          } else {
            warnings.push(
              `Selection "${s.name}": has sample IDs but no mapping provided, skipping`
            );
            return null;
          }
        } else {
          warnings.push(`Skipping selection "${s.name}": no indices or sample IDs`);
          return null;
        }

        if (indices.length === 0) {
          warnings.push(`Skipping selection "${s.name}": empty after mapping`);
          return null;
        }

        return {
          id: s.id ?? `sel-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          name: s.name,
          indices,
          color: s.color,
          createdAt: s.createdAt ? new Date(s.createdAt) : new Date(),
        };
      }
    ).filter(Boolean) as SavedSelection[];

    return { selections, warnings, unmappedCount };
  } catch (error) {
    throw new Error(
      `Failed to parse selections: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Import selection from CSV file (sample IDs or indices)
 * Expected format: header row with 'index' and/or 'sample_id' columns
 */
export function importSelectionFromCsv(
  csvString: string,
  sampleIds?: string[]
): { indices: number[]; warnings: string[]; unmappedCount: number } {
  const warnings: string[] = [];
  let unmappedCount = 0;

  try {
    const lines = csvString.trim().split('\n');
    if (lines.length < 2) {
      throw new Error('CSV must have header row and at least one data row');
    }

    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const indexCol = headers.indexOf('index');
    const sampleIdCol = headers.indexOf('sample_id');

    if (indexCol === -1 && sampleIdCol === -1) {
      throw new Error('CSV must have "index" or "sample_id" column');
    }

    // Build sample ID to index map if needed
    const idToIndex = new Map<string, number>();
    if (sampleIds && sampleIdCol !== -1) {
      sampleIds.forEach((id, idx) => {
        idToIndex.set(id, idx);
      });
    }

    const indices: number[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cols = line.split(',').map((c) => c.trim());

      // Try index column first
      if (indexCol !== -1 && cols[indexCol]) {
        const idx = parseInt(cols[indexCol], 10);
        if (!isNaN(idx) && idx >= 0) {
          indices.push(idx);
          continue;
        }
      }

      // Fall back to sample ID
      if (sampleIdCol !== -1 && cols[sampleIdCol]) {
        const sid = cols[sampleIdCol];
        const idx = idToIndex.get(sid);
        if (idx !== undefined) {
          indices.push(idx);
        } else {
          unmappedCount++;
        }
      }
    }

    if (unmappedCount > 0) {
      warnings.push(`${unmappedCount} sample IDs could not be mapped to indices`);
    }

    return { indices, warnings, unmappedCount };
  } catch (error) {
    throw new Error(
      `Failed to parse CSV: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

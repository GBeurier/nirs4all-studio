/**
 * Export System - TXT export (folds in nirs4all format)
 */

import type { FoldsInfo } from '@/types/playground';
import { MIME_TYPES, downloadBlob, generateFilename } from './shared';
import type { ExportOptions, ExportResult } from './types';

/**
 * Export folds to TXT in nirs4all format
 * Format: One line per fold, comma-separated indices
 */
export function exportFoldsToTxt(
  folds: FoldsInfo,
  options: ExportOptions = {}
): ExportResult {
  const {
    filename = 'folds',
    includeTimestamp = true,
  } = options;

  try {
    if (!folds || folds.n_folds === 0) {
      return {
        success: false,
        error: 'No folds data to export',
        format: 'txt',
      };
    }

    const lines: string[] = [];

    // Add header comment
    lines.push(`# nirs4all folds export`);
    lines.push(`# Splitter: ${folds.splitter_name ?? 'unknown'}`);
    lines.push(`# Folds: ${folds.n_folds}`);
    lines.push(`# Generated: ${new Date().toISOString()}`);
    lines.push('');

    // Export each fold's train/test indices
    folds.folds.forEach((fold, i) => {
      lines.push(`# Fold ${i + 1}`);
      lines.push(`fold_${i + 1}_train:${fold.train_indices.join(',')}`);
      lines.push(`fold_${i + 1}_test:${fold.test_indices.join(',')}`);
      lines.push('');
    });

    // Fold labels (sample -> fold assignment)
    if (folds.fold_labels && folds.fold_labels.length > 0) {
      lines.push('# Fold labels (sample_index -> fold_number)');
      folds.fold_labels.forEach((foldLabel: number, sampleIdx: number) => {
        lines.push(`${sampleIdx}:${foldLabel}`);
      });
    }

    const content = lines.join('\n');

    const blob = new Blob([content], { type: MIME_TYPES.txt });
    const finalFilename = generateFilename(filename, 'txt', includeTimestamp);
    downloadBlob(blob, finalFilename);

    return {
      success: true,
      filename: finalFilename,
      format: 'txt',
      size: blob.size,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Export failed',
      format: 'txt',
    };
  }
}

/**
 * Export System - CSV data export (spectra, PCA, targets)
 */

import { MIME_TYPES, downloadBlob, generateFilename } from './shared';
import type { DataExportContent, ExportOptions, ExportResult } from './types';

/**
 * Export spectra data to CSV
 * Phase 8: Added is_outlier column support
 */
export function exportSpectraToCsv(
  content: DataExportContent,
  options: ExportOptions = {}
): ExportResult {
  const {
    filename = 'spectra',
    includeTimestamp = true,
  } = options;

  try {
    const { spectra, wavelengths, y, sampleIds, outlierIndices } = content;

    if (!spectra || !wavelengths) {
      return {
        success: false,
        error: 'No spectra data to export',
        format: 'csv',
      };
    }

    // Convert outlierIndices to Set for efficient lookup
    const outlierSet = outlierIndices
      ? (outlierIndices instanceof Set ? outlierIndices : new Set(outlierIndices))
      : null;
    const hasOutliers = outlierSet && outlierSet.size > 0;

    // Build header row
    const headers: string[] = [];
    const hasSampleIds = sampleIds && sampleIds.length === spectra.length;
    const hasY = y && y.length === spectra.length;

    if (hasSampleIds) headers.push('sample_id');
    headers.push(...wavelengths.map((w) => String(w)));
    if (hasY) headers.push('target');
    if (hasOutliers) headers.push('is_outlier');

    // Build data rows
    const rows = spectra.map((spectrum, idx) => {
      const row: (string | number)[] = [];
      if (hasSampleIds) row.push(sampleIds![idx]);
      row.push(...spectrum.map((v) => v.toFixed(6)));
      if (hasY) row.push(y![idx]);
      if (hasOutliers) row.push(outlierSet!.has(idx) ? 1 : 0);
      return row.join(',');
    });

    // Combine
    const csv = [headers.join(','), ...rows].join('\n');

    // Create blob and download
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
 * Export PCA data to CSV
 */
export function exportPcaToCsv(
  content: DataExportContent,
  options: ExportOptions = {}
): ExportResult {
  const {
    filename = 'pca',
    includeTimestamp = true,
  } = options;

  try {
    const { pca, y, sampleIds, explainedVariance } = content;

    if (!pca || pca.length === 0) {
      return {
        success: false,
        error: 'No PCA data to export',
        format: 'csv',
      };
    }

    const nComponents = pca[0].length;
    const hasSampleIds = sampleIds && sampleIds.length === pca.length;
    const hasY = y && y.length === pca.length;

    // Build header
    const headers: string[] = [];
    if (hasSampleIds) headers.push('sample_id');

    // Add PC columns with variance info if available
    for (let i = 0; i < nComponents; i++) {
      if (explainedVariance && explainedVariance[i] !== undefined) {
        headers.push(`PC${i + 1}_${(explainedVariance[i] * 100).toFixed(1)}%`);
      } else {
        headers.push(`PC${i + 1}`);
      }
    }

    if (hasY) headers.push('target');

    // Build rows
    const rows = pca.map((coords, idx) => {
      const row: (string | number)[] = [];
      if (hasSampleIds) row.push(sampleIds![idx]);
      row.push(...coords.map((v) => v.toFixed(6)));
      if (hasY) row.push(y![idx]);
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
 * Export targets to CSV
 */
export function exportTargetsToCsv(
  content: DataExportContent,
  options: ExportOptions = {}
): ExportResult {
  const {
    filename = 'targets',
    includeTimestamp = true,
  } = options;

  try {
    const { y, sampleIds, metadata } = content;

    if (!y || y.length === 0) {
      return {
        success: false,
        error: 'No target data to export',
        format: 'csv',
      };
    }

    const hasSampleIds = sampleIds && sampleIds.length === y.length;

    // Build header
    const headers: string[] = [];
    if (hasSampleIds) headers.push('sample_id');
    headers.push('target');

    // Add metadata columns if present
    const metadataKeys = metadata ? Object.keys(metadata) : [];
    headers.push(...metadataKeys);

    // Build rows
    const rows = y.map((yVal, idx) => {
      const row: (string | number)[] = [];
      if (hasSampleIds) row.push(sampleIds![idx]);
      row.push(yVal);
      for (const key of metadataKeys) {
        const val = metadata![key][idx];
        row.push(val !== undefined && val !== null ? String(val) : '');
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

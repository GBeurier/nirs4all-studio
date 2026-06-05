/**
 * Export System - Shared constants and helpers
 */

import type { ExportFormat } from './types';

// ============= Constants =============

export const MIME_TYPES: Record<ExportFormat, string> = {
  png: 'image/png',
  svg: 'image/svg+xml',
  csv: 'text/csv;charset=utf-8',
  txt: 'text/plain;charset=utf-8',
  json: 'application/json;charset=utf-8',
};

// ============= Utility Functions =============

/**
 * Generate timestamp string for filenames
 */
export function getTimestamp(): string {
  const now = new Date();
  return now.toISOString().slice(0, 19).replace(/[:-]/g, '').replace('T', '_');
}

/**
 * Generate filename with optional timestamp
 */
export function generateFilename(
  base: string,
  extension: ExportFormat,
  includeTimestamp = true
): string {
  const timestamp = includeTimestamp ? `_${getTimestamp()}` : '';
  return `${base}${timestamp}.${extension}`;
}

/**
 * Trigger file download
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

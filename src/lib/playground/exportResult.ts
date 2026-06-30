/**
 * Export result helpers
 *
 * Pure-ish glue between serialized export content and the {@link ExportResult}
 * objects returned by the public `export.ts` API. Extracting these removes the
 * repeated "build blob → download → return success / catch → return failure"
 * boilerplate that every exporter duplicated.
 */

import {
  downloadBlob,
  EXPORT_MIME_TYPES,
  generateExportFilename,
} from '@/lib/playground/exportDownload';
import type { ExportFormat, ExportResult } from '@/lib/playground/export';

/**
 * Wrap serialized text content in a Blob using the format's MIME type.
 * Pure: no DOM access, returns a fresh Blob.
 */
export function buildExportBlob(content: BlobPart, format: ExportFormat): Blob {
  return new Blob([content], { type: EXPORT_MIME_TYPES[format] });
}

/**
 * Convert a thrown value into a failed {@link ExportResult}.
 * Pure: maps `Error` instances to their message, everything else to `fallback`.
 */
export function toExportError(
  error: unknown,
  format: ExportFormat,
  fallback = 'Export failed',
): ExportResult {
  return {
    success: false,
    error: error instanceof Error ? error.message : fallback,
    format,
  };
}

/**
 * Download an already-built Blob and produce a successful {@link ExportResult}.
 * Has the download side effect; the returned result is computed from the blob.
 */
export function finalizeBlobExport(
  blob: Blob,
  baseFilename: string,
  format: ExportFormat,
  includeTimestamp: boolean,
  now?: Date,
): ExportResult {
  const filename = generateExportFilename(baseFilename, format, includeTimestamp, now);
  downloadBlob(blob, filename);
  return {
    success: true,
    filename,
    format,
    size: blob.size,
  };
}

/**
 * Serialize text content to a Blob, download it, and produce a successful
 * {@link ExportResult}.
 */
export function finalizeTextExport(
  content: BlobPart,
  baseFilename: string,
  format: ExportFormat,
  includeTimestamp: boolean,
  now?: Date,
): ExportResult {
  return finalizeBlobExport(buildExportBlob(content, format), baseFilename, format, includeTimestamp, now);
}

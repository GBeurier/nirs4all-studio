import type { ExportFormat } from '@/lib/playground/export';

export const EXPORT_MIME_TYPES: Record<ExportFormat, string> = {
  png: 'image/png',
  svg: 'image/svg+xml',
  csv: 'text/csv;charset=utf-8',
  txt: 'text/plain;charset=utf-8',
  json: 'application/json;charset=utf-8',
};

export function getExportTimestamp(now = new Date()): string {
  return now.toISOString().slice(0, 19).replace(/[:-]/g, '').replace('T', '_');
}

export function generateExportFilename(
  base: string,
  extension: ExportFormat,
  includeTimestamp = true,
  now = new Date(),
): string {
  const timestamp = includeTimestamp ? `_${getExportTimestamp(now)}` : '';
  return `${base}${timestamp}.${extension}`;
}

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

import type { ExportFormat } from '@/lib/playground/export';

/**
 * Kind of work a single batch-export task represents. Distinct from the raw
 * file extension because several kinds share an extension (csv-spectra,
 * csv-targets, csv-pca).
 */
export type BatchExportTaskKind =
  | 'png-chart'
  | 'svg-chart'
  | 'csv-spectra'
  | 'csv-targets'
  | 'csv-pca'
  | 'txt-folds'
  | 'json';

export interface BatchExportTask {
  format: ExportFormat;
  kind: BatchExportTaskKind;
  filename: string;
  /** Chart key (only for png-chart / svg-chart tasks). */
  chartType?: string;
}

export interface BatchExportPlanInput {
  /** Requested formats, in priority order. */
  formats: ExportFormat[];
  /** Base filename (without extension) all tasks derive from. */
  baseFilename: string;
  /** Chart keys available for image export, in render order. */
  chartTypes: string[];
  hasSpectra: boolean;
  hasTargets: boolean;
  hasPca: boolean;
  hasFolds: boolean;
}

/**
 * Plan the ordered list of export tasks for a batch export.
 *
 * Pure: given which content/charts are present, returns the exact sequence of
 * exporter invocations (with their filenames) that batchExport should run. The
 * order matches the requested formats, and charts follow their render order.
 */
export function planBatchExport(input: BatchExportPlanInput): BatchExportTask[] {
  const { formats, baseFilename, chartTypes } = input;
  const tasks: BatchExportTask[] = [];

  for (const format of formats) {
    switch (format) {
      case 'png':
        for (const chartType of chartTypes) {
          tasks.push({
            format: 'png',
            kind: 'png-chart',
            filename: `${baseFilename}-${chartType}`,
            chartType,
          });
        }
        break;

      case 'svg':
        for (const chartType of chartTypes) {
          tasks.push({
            format: 'svg',
            kind: 'svg-chart',
            filename: `${baseFilename}-${chartType}`,
            chartType,
          });
        }
        break;

      case 'csv':
        if (input.hasSpectra) {
          tasks.push({ format: 'csv', kind: 'csv-spectra', filename: `${baseFilename}-spectra` });
        }
        if (input.hasTargets) {
          tasks.push({ format: 'csv', kind: 'csv-targets', filename: `${baseFilename}-targets` });
        }
        if (input.hasPca) {
          tasks.push({ format: 'csv', kind: 'csv-pca', filename: `${baseFilename}-pca` });
        }
        break;

      case 'txt':
        if (input.hasFolds) {
          tasks.push({ format: 'txt', kind: 'txt-folds', filename: `${baseFilename}-folds` });
        }
        break;

      case 'json':
        tasks.push({ format: 'json', kind: 'json', filename: baseFilename });
        break;
    }
  }

  return tasks;
}

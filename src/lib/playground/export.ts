/**
 * Export System - Chart and data export utilities for Playground
 *
 * Provides comprehensive export capabilities:
 * - PNG export (chart images)
 * - SVG export (vector graphics)
 * - CSV export (spectra matrix, targets)
 * - TXT export (folds in nirs4all format)
 * - JSON export (full chart config + data)
 * - Batch export (all visible charts)
 *
 * Phase 6: Performance & Polish
 *
 * This barrel re-exports the public surface from the focused modules in
 * `./export/`. Implementation is split by concern; consumers keep importing
 * from `@/lib/playground/export`.
 */

export type {
  ExportFormat,
  ExportOptions,
  ChartExportData,
  DataExportContent,
  ExportResult,
} from './export/types';

export { exportToPng, exportToSvg } from './export/image';

export {
  exportSpectraToCsv,
  exportPcaToCsv,
  exportTargetsToCsv,
} from './export/csv';

export { exportFoldsToTxt } from './export/txt';

export { exportToJson } from './export/json';

export {
  exportSelectionsToJson,
  exportSelectionToCsv,
  importSelectionsFromJson,
  importSelectionFromCsv,
} from './export/selections';
export type {
  SelectionExportOptions,
  SelectionImportResult,
} from './export/selections';

export { batchExport, getChartElements, prepareExportContent } from './export/batch';
export type { BatchExportOptions } from './export/batch';

export { exportCombinedReport } from './export/report';
export type { CombinedReportOptions } from './export/report';

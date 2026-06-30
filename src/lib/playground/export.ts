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
 */

import type { PlaygroundResult, FoldsInfo } from '@/types/playground';
import type { SpectralData } from '@/types/spectral';
import { buildPcaCsv, buildSpectraCsv, buildTargetsCsv } from '@/lib/playground/exportCsv';
import {
  buildPlaygroundJsonExportPayload,
  type PlaygroundJsonExportInput,
} from '@/lib/playground/exportJson';
import { buildFoldsTxt } from '@/lib/playground/exportFolds';
import {
  buildPlaygroundExportContent,
  type PlaygroundExportContentInput,
} from '@/lib/playground/exportContent';
import {
  finalizeBlobExport,
  finalizeTextExport,
  toExportError,
} from '@/lib/playground/exportResult';
import {
  createPngExportBlob,
  serializeChartSvg,
} from '@/lib/playground/exportImage';
import { planBatchExport } from '@/lib/playground/exportBatchPlan';

export type { SelectionImportResult } from '@/lib/playground/exportSelections';
export {
  exportSelectionsToJson,
  exportSelectionToCsv,
  importSelectionsFromJson,
  importSelectionFromCsv,
  type SelectionExportOptions,
} from '@/lib/playground/exportSelectionFiles';
export {
  exportCombinedReport,
  type CombinedReportOptions,
} from '@/lib/playground/exportReport';

// ============= Types =============

export type ExportFormat = 'png' | 'svg' | 'csv' | 'txt' | 'json';

export interface ExportOptions {
  /** Filename (without extension) */
  filename?: string;
  /** Include timestamp in filename */
  includeTimestamp?: boolean;
  /** Image quality (for PNG) 0-1 */
  quality?: number;
  /** Image scale factor (for PNG) */
  scale?: number;
  /** Include metadata in export */
  includeMetadata?: boolean;
}

export interface ChartExportData {
  /** Chart type identifier */
  chartType: 'spectra' | 'histogram' | 'pca' | 'folds' | 'repetitions';
  /** Chart container element or canvas */
  element?: HTMLElement | null;
  /** SVG element (if available) */
  svgElement?: SVGElement | null;
  /** Canvas element (if available) */
  canvasElement?: HTMLCanvasElement | null;
}

export interface DataExportContent {
  /** Spectra matrix (samples × wavelengths) */
  spectra?: number[][];
  /** Wavelength values */
  wavelengths?: number[];
  /** Target values */
  y?: number[];
  /** Sample IDs */
  sampleIds?: string[];
  /** Metadata columns */
  metadata?: Record<string, unknown[]>;
  /** PCA coordinates */
  pca?: number[][];
  /** Explained variance */
  explainedVariance?: number[];
  /** Folds information */
  folds?: FoldsInfo;
  /** Outlier indices (Phase 8) */
  outlierIndices?: Set<number> | number[];
}

export interface ExportResult {
  success: boolean;
  filename?: string;
  error?: string;
  format: ExportFormat;
  size?: number;
}

// ============= PNG Export =============

/**
 * Export chart to PNG image
 */
export async function exportToPng(
  data: ChartExportData,
  options: ExportOptions = {}
): Promise<ExportResult> {
  const {
    filename = `chart-${data.chartType}`,
    includeTimestamp = true,
    quality = 0.95,
    scale = 2,
  } = options;

  try {
    const blob = await createPngExportBlob(data, { quality, scale });
    if (!blob) {
      return {
        success: false,
        error: 'No element or canvas provided for export',
        format: 'png',
      };
    }

    return finalizeBlobExport(blob, filename, 'png', includeTimestamp);
  } catch (error) {
    return toExportError(error, 'png');
  }
}

// ============= SVG Export =============

/**
 * Export chart to SVG
 */
export function exportToSvg(
  data: ChartExportData,
  options: ExportOptions = {}
): ExportResult {
  const {
    filename = `chart-${data.chartType}`,
    includeTimestamp = true,
  } = options;

  try {
    const svgString = serializeChartSvg(data);
    if (!svgString) {
      return {
        success: false,
        error: 'No SVG element found for export',
        format: 'svg',
      };
    }

    return finalizeTextExport(svgString, filename, 'svg', includeTimestamp);
  } catch (error) {
    return toExportError(error, 'svg');
  }
}

// ============= CSV Export =============

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
    const csvResult = buildSpectraCsv(content);
    if (!csvResult.success) {
      return {
        success: false,
        error: csvResult.error,
        format: 'csv',
      };
    }

    // Create blob and download
    return finalizeTextExport(csvResult.csv, filename, 'csv', includeTimestamp);
  } catch (error) {
    return toExportError(error, 'csv');
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
    const csvResult = buildPcaCsv(content);
    if (!csvResult.success) {
      return {
        success: false,
        error: csvResult.error,
        format: 'csv',
      };
    }

    return finalizeTextExport(csvResult.csv, filename, 'csv', includeTimestamp);
  } catch (error) {
    return toExportError(error, 'csv');
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
    const csvResult = buildTargetsCsv(content);
    if (!csvResult.success) {
      return {
        success: false,
        error: csvResult.error,
        format: 'csv',
      };
    }

    return finalizeTextExport(csvResult.csv, filename, 'csv', includeTimestamp);
  } catch (error) {
    return toExportError(error, 'csv');
  }
}

// ============= TXT Export (Folds) =============

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
    const txtResult = buildFoldsTxt(folds);
    if (!txtResult.success) {
      return {
        success: false,
        error: txtResult.error,
        format: 'txt',
      };
    }

    return finalizeTextExport(txtResult.content, filename, 'txt', includeTimestamp);
  } catch (error) {
    return toExportError(error, 'txt');
  }
}

// ============= JSON Export =============

/**
 * Export full playground state to JSON
 */
export function exportToJson(
  data: PlaygroundJsonExportInput,
  options: ExportOptions = {}
): ExportResult {
  const {
    filename = 'playground-export',
    includeTimestamp = true,
    includeMetadata = true,
  } = options;

  try {
    const exportData = buildPlaygroundJsonExportPayload(data, { includeMetadata });
    const json = JSON.stringify(exportData, null, 2);

    return finalizeTextExport(json, filename, 'json', includeTimestamp);
  } catch (error) {
    return toExportError(error, 'json');
  }
}

// ============= Batch Export =============

export interface BatchExportOptions extends ExportOptions {
  /** Export formats to include */
  formats: ExportFormat[];
  /** Chart elements to export (for PNG/SVG) */
  charts?: Map<string, ChartExportData>;
  /** Data content for CSV/JSON export */
  content?: DataExportContent;
  /** Result data */
  result?: PlaygroundResult | null;
  /** Raw data */
  rawData?: SpectralData | null;
}

/**
 * Batch export all visible charts and data
 */
export async function batchExport(
  options: BatchExportOptions
): Promise<ExportResult[]> {
  const results: ExportResult[] = [];
  const baseFilename = options.filename ?? 'playground-batch';
  const { charts, content } = options;

  const plan = planBatchExport({
    formats: options.formats,
    baseFilename,
    chartTypes: charts ? Array.from(charts.keys()) : [],
    hasSpectra: Boolean(content?.spectra),
    hasTargets: Boolean(content?.y),
    hasPca: Boolean(content?.pca),
    hasFolds: Boolean(content?.folds),
  });

  for (const task of plan) {
    switch (task.kind) {
      case 'png-chart': {
        const chartData = charts?.get(task.chartType!);
        if (chartData) {
          results.push(await exportToPng(chartData, { ...options, filename: task.filename }));
        }
        break;
      }

      case 'svg-chart': {
        const chartData = charts?.get(task.chartType!);
        if (chartData) {
          results.push(exportToSvg(chartData, { ...options, filename: task.filename }));
        }
        break;
      }

      case 'csv-spectra':
        if (content) {
          results.push(exportSpectraToCsv(content, { ...options, filename: task.filename }));
        }
        break;

      case 'csv-targets':
        if (content) {
          results.push(exportTargetsToCsv(content, { ...options, filename: task.filename }));
        }
        break;

      case 'csv-pca':
        if (content) {
          results.push(exportPcaToCsv(content, { ...options, filename: task.filename }));
        }
        break;

      case 'txt-folds':
        if (content?.folds) {
          results.push(exportFoldsToTxt(content.folds, { ...options, filename: task.filename }));
        }
        break;

      case 'json':
        results.push(
          exportToJson(
            { content, result: options.result, rawData: options.rawData },
            { ...options, filename: task.filename }
          )
        );
        break;
    }
  }

  return results;
}

// ============= Export Helpers =============

/**
 * Get reference to chart elements for export
 */
export function getChartElements(
  containerRef: React.RefObject<HTMLElement>
): Map<string, ChartExportData> {
  const charts = new Map<string, ChartExportData>();

  if (!containerRef.current) return charts;

  // Find chart containers by data attribute or class
  const chartContainers = containerRef.current.querySelectorAll('[data-chart-type]');

  chartContainers.forEach((element) => {
    const chartType = element.getAttribute('data-chart-type') as ChartExportData['chartType'];
    if (chartType) {
      charts.set(chartType, {
        chartType,
        element: element as HTMLElement,
        svgElement: element.querySelector('svg') ?? undefined,
        canvasElement: element.querySelector('canvas') ?? undefined,
      });
    }
  });

  return charts;
}

/**
 * Prepare data content for export
 */
export function prepareExportContent(
  rawData: SpectralData | null,
  result: PlaygroundResult | null,
  dataView?: PlaygroundExportContentInput['dataView'],
): DataExportContent {
  return buildPlaygroundExportContent({ rawData, result, dataView });
}

/**
 * Export System - Batch export and export helpers
 */

import type { PlaygroundResult } from '@/types/playground';
import type { SpectralData } from '@/types/spectral';
import { exportToPng, exportToSvg } from './image';
import { exportPcaToCsv, exportSpectraToCsv, exportTargetsToCsv } from './csv';
import { exportFoldsToTxt } from './txt';
import { exportToJson } from './json';
import type {
  ChartExportData,
  DataExportContent,
  ExportFormat,
  ExportOptions,
  ExportResult,
} from './types';

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

  for (const format of options.formats) {
    switch (format) {
      case 'png':
        // Export each chart as PNG
        if (options.charts) {
          for (const [chartType, chartData] of options.charts) {
            const result = await exportToPng(chartData, {
              ...options,
              filename: `${baseFilename}-${chartType}`,
            });
            results.push(result);
          }
        }
        break;

      case 'svg':
        // Export each chart as SVG
        if (options.charts) {
          for (const [chartType, chartData] of options.charts) {
            const result = exportToSvg(chartData, {
              ...options,
              filename: `${baseFilename}-${chartType}`,
            });
            results.push(result);
          }
        }
        break;

      case 'csv':
        // Export spectra
        if (options.content?.spectra) {
          results.push(
            exportSpectraToCsv(options.content, {
              ...options,
              filename: `${baseFilename}-spectra`,
            })
          );
        }
        // Export targets
        if (options.content?.y) {
          results.push(
            exportTargetsToCsv(options.content, {
              ...options,
              filename: `${baseFilename}-targets`,
            })
          );
        }
        // Export PCA
        if (options.content?.pca) {
          results.push(
            exportPcaToCsv(options.content, {
              ...options,
              filename: `${baseFilename}-pca`,
            })
          );
        }
        break;

      case 'txt':
        // Export folds
        if (options.content?.folds) {
          results.push(
            exportFoldsToTxt(options.content.folds, {
              ...options,
              filename: `${baseFilename}-folds`,
            })
          );
        }
        break;

      case 'json':
        // Export full state
        results.push(
          exportToJson(
            {
              content: options.content,
              result: options.result,
              rawData: options.rawData,
            },
            {
              ...options,
              filename: baseFilename,
            }
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
  result: PlaygroundResult | null
): DataExportContent {
  return {
    spectra: result?.processed?.spectra ?? rawData?.spectra,
    wavelengths: result?.processed?.wavelengths ?? rawData?.wavelengths,
    y: rawData?.y,
    sampleIds: rawData?.sampleIds,
    metadata: rawData?.metadata as Record<string, unknown[]> | undefined,
    pca: result?.pca?.coordinates,
    explainedVariance: result?.pca?.explained_variance_ratio,
    folds: result?.folds ?? undefined,
  };
}

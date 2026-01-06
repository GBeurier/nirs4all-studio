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
import type { SavedSelection } from '@/context/SelectionContext';

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
}

export interface ExportResult {
  success: boolean;
  filename?: string;
  error?: string;
  format: ExportFormat;
  size?: number;
}

// ============= Constants =============

const MIME_TYPES: Record<ExportFormat, string> = {
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
function getTimestamp(): string {
  const now = new Date();
  return now.toISOString().slice(0, 19).replace(/[:-]/g, '').replace('T', '_');
}

/**
 * Generate filename with optional timestamp
 */
function generateFilename(
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
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Convert HTML element to canvas using DOM rendering
 */
async function elementToCanvas(
  element: HTMLElement,
  scale = 2
): Promise<HTMLCanvasElement> {
  // Use html2canvas-like approach via SVG foreignObject
  const rect = element.getBoundingClientRect();
  const width = rect.width * scale;
  const height = rect.height * scale;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  // Scale for high DPI
  ctx.scale(scale, scale);

  // Clone element and serialize to SVG
  const clone = element.cloneNode(true) as HTMLElement;
  clone.style.margin = '0';
  clone.style.position = 'absolute';

  // Create SVG with foreignObject
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${rect.width}" height="${rect.height}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml" style="width:${rect.width}px;height:${rect.height}px">
          ${clone.outerHTML}
        </div>
      </foreignObject>
    </svg>
  `;

  // Create image from SVG
  const img = new Image();
  const svgBlob = new Blob([svg], { type: 'image/svg+xml' });
  const svgUrl = URL.createObjectURL(svgBlob);

  await new Promise<void>((resolve, reject) => {
    img.onload = () => {
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(svgUrl);
      resolve();
    };
    img.onerror = () => {
      URL.revokeObjectURL(svgUrl);
      reject(new Error('Failed to load SVG image'));
    };
    img.src = svgUrl;
  });

  return canvas;
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
    let canvas: HTMLCanvasElement;

    // If we have a canvas element, use it directly
    if (data.canvasElement) {
      canvas = data.canvasElement;
    } else if (data.element) {
      // Convert element to canvas
      canvas = await elementToCanvas(data.element, scale);
    } else {
      return {
        success: false,
        error: 'No element or canvas provided for export',
        format: 'png',
      };
    }

    // Convert to blob
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (b) resolve(b);
          else reject(new Error('Failed to create blob'));
        },
        'image/png',
        quality
      );
    });

    // Download
    const finalFilename = generateFilename(filename, 'png', includeTimestamp);
    downloadBlob(blob, finalFilename);

    return {
      success: true,
      filename: finalFilename,
      format: 'png',
      size: blob.size,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Export failed',
      format: 'png',
    };
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
    // Find SVG element
    let svg: SVGElement | null = data.svgElement ?? null;

    if (!svg && data.element) {
      svg = data.element.querySelector('svg');
    }

    if (!svg) {
      return {
        success: false,
        error: 'No SVG element found for export',
        format: 'svg',
      };
    }

    // Clone and prepare SVG
    const clone = svg.cloneNode(true) as SVGElement;

    // Add XML declaration and namespace
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

    // Serialize to string
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(clone);

    // Create blob and download
    const blob = new Blob([svgString], { type: MIME_TYPES.svg });
    const finalFilename = generateFilename(filename, 'svg', includeTimestamp);
    downloadBlob(blob, finalFilename);

    return {
      success: true,
      filename: finalFilename,
      format: 'svg',
      size: blob.size,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Export failed',
      format: 'svg',
    };
  }
}

// ============= CSV Export =============

/**
 * Export spectra data to CSV
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
    const { spectra, wavelengths, y, sampleIds } = content;

    if (!spectra || !wavelengths) {
      return {
        success: false,
        error: 'No spectra data to export',
        format: 'csv',
      };
    }

    // Build header row
    const headers: string[] = [];
    const hasSampleIds = sampleIds && sampleIds.length === spectra.length;
    const hasY = y && y.length === spectra.length;

    if (hasSampleIds) headers.push('sample_id');
    headers.push(...wavelengths.map((w) => String(w)));
    if (hasY) headers.push('target');

    // Build data rows
    const rows = spectra.map((spectrum, idx) => {
      const row: (string | number)[] = [];
      if (hasSampleIds) row.push(sampleIds![idx]);
      row.push(...spectrum.map((v) => v.toFixed(6)));
      if (hasY) row.push(y![idx]);
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

// ============= JSON Export =============

/**
 * Export full playground state to JSON
 */
export function exportToJson(
  data: {
    content?: DataExportContent;
    result?: PlaygroundResult | null;
    rawData?: SpectralData | null;
    selections?: SavedSelection[];
    chartConfig?: Record<string, unknown>;
    pipeline?: Array<{ name: string; type: string; params: Record<string, unknown> }>;
  },
  options: ExportOptions = {}
): ExportResult {
  const {
    filename = 'playground-export',
    includeTimestamp = true,
    includeMetadata = true,
  } = options;

  try {
    const exportData = {
      version: '2.0',
      exportedAt: new Date().toISOString(),
      metadata: includeMetadata
        ? {
          sampleCount: data.rawData?.spectra?.length ?? 0,
          wavelengthCount: data.rawData?.wavelengths?.length ?? 0,
          hasTargets: (data.rawData?.y?.length ?? 0) > 0,
          hasFolds: (data.result?.folds?.n_folds ?? 0) > 0,
        }
        : undefined,
      pipeline: data.pipeline,
      selections: data.selections,
      chartConfig: data.chartConfig,
      data: data.content
        ? {
          wavelengths: data.content.wavelengths,
          spectra: data.content.spectra,
          y: data.content.y,
          sampleIds: data.content.sampleIds,
          pca: data.content.pca,
          explainedVariance: data.content.explainedVariance,
        }
        : undefined,
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

// ============= Selections Export =============

/**
 * Export selections to JSON
 */
export function exportSelectionsToJson(
  selections: SavedSelection[],
  options: ExportOptions = {}
): ExportResult {
  const {
    filename = 'selections',
    includeTimestamp = true,
  } = options;

  try {
    const exportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      count: selections.length,
      selections: selections.map((s) => ({
        id: s.id,
        name: s.name,
        indices: s.indices,
        color: s.color,
        createdAt: s.createdAt instanceof Date
          ? s.createdAt.toISOString()
          : s.createdAt,
      })),
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
 * Import selections from JSON
 */
export function importSelectionsFromJson(
  jsonString: string
): { selections: SavedSelection[]; warnings: string[] } {
  const warnings: string[] = [];

  try {
    const data = JSON.parse(jsonString);

    if (!data.selections || !Array.isArray(data.selections)) {
      throw new Error('Invalid selections format: missing selections array');
    }

    const selections: SavedSelection[] = data.selections.map(
      (s: { id?: string; name?: string; indices?: number[]; color?: string; createdAt?: string }) => {
        if (!s.name || !s.indices) {
          warnings.push(`Skipping invalid selection: missing name or indices`);
          return null;
        }

        return {
          id: s.id ?? `sel-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          name: s.name,
          indices: s.indices,
          color: s.color,
          createdAt: s.createdAt ? new Date(s.createdAt) : new Date(),
        };
      }
    ).filter(Boolean) as SavedSelection[];

    return { selections, warnings };
  } catch (error) {
    throw new Error(
      `Failed to parse selections: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
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

/**
 * Export System - JSON export (full playground state)
 */

import type { PlaygroundResult } from '@/types/playground';
import type { SpectralData } from '@/types/spectral';
import type { SavedSelection } from '@/context/SelectionContext';
import { MIME_TYPES, downloadBlob, generateFilename } from './shared';
import type { DataExportContent, ExportOptions, ExportResult } from './types';

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

import type { SavedSelection } from '@/context/useSelection';
import type { PlaygroundResult } from '@/types/playground';
import type { SpectralData } from '@/types/spectral';
import type { DataExportContent } from '@/lib/playground/export';

export interface PlaygroundJsonExportInput {
  content?: DataExportContent;
  result?: PlaygroundResult | null;
  rawData?: SpectralData | null;
  selections?: SavedSelection[];
  chartConfig?: Record<string, unknown>;
  pipeline?: Array<{ name: string; type: string; params: Record<string, unknown> }>;
}

export interface PlaygroundJsonPayloadOptions {
  includeMetadata?: boolean;
  exportedAt?: string;
}

export function buildPlaygroundJsonExportPayload(
  data: PlaygroundJsonExportInput,
  options: PlaygroundJsonPayloadOptions = {},
): Record<string, unknown> {
  const { includeMetadata = true, exportedAt = new Date().toISOString() } = options;

  return {
    version: '2.0',
    exportedAt,
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
}

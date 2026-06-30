import { describe, expect, it } from 'vitest';

import { buildPlaygroundJsonExportPayload } from '@/lib/playground/exportJson';
import type { SavedSelection } from '@/context/useSelection';
import type { PlaygroundResult } from '@/types/playground';
import type { SpectralData } from '@/types/spectral';

function createResult(): PlaygroundResult {
  return {
    original: {
      spectra: [[1, 2]],
      wavelengths: [1100, 1200],
      shape: [1, 2],
    },
    processed: {
      spectra: [[2, 3]],
      wavelengths: [1100, 1200],
      shape: [1, 2],
    },
    folds: {
      splitter_name: 'KFold',
      n_folds: 2,
      folds: [],
    },
    executionTimeMs: 0,
    trace: [],
    errors: [],
  };
}

describe('playground JSON export payload', () => {
  it('builds the full-state JSON payload with metadata and selected export fields', () => {
    const rawData: SpectralData = {
      spectra: [[1, 2], [3, 4]],
      wavelengths: [1100, 1200],
      y: [10, 20],
    };
    const selection: SavedSelection = {
      id: 'selection-1',
      name: 'Selection A',
      indices: [0],
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
    };

    expect(buildPlaygroundJsonExportPayload({
      rawData,
      result: createResult(),
      selections: [selection],
      chartConfig: { colorMode: 'target' },
      pipeline: [{ name: 'SNV', type: 'preprocessing', params: { center: true } }],
      content: {
        wavelengths: [1110, 1210],
        spectra: [[10, 20]],
        y: [12],
        sampleIds: ['processed-1'],
        pca: [[0.1, 0.2]],
        explainedVariance: [0.8, 0.2],
      },
    }, {
      exportedAt: '2026-06-02T00:00:00.000Z',
    })).toEqual({
      version: '2.0',
      exportedAt: '2026-06-02T00:00:00.000Z',
      metadata: {
        sampleCount: 2,
        wavelengthCount: 2,
        hasTargets: true,
        hasFolds: true,
      },
      pipeline: [{ name: 'SNV', type: 'preprocessing', params: { center: true } }],
      selections: [selection],
      chartConfig: { colorMode: 'target' },
      data: {
        wavelengths: [1110, 1210],
        spectra: [[10, 20]],
        y: [12],
        sampleIds: ['processed-1'],
        pca: [[0.1, 0.2]],
        explainedVariance: [0.8, 0.2],
      },
    });
  });

  it('omits metadata content when includeMetadata is false', () => {
    const payload = buildPlaygroundJsonExportPayload({}, {
      includeMetadata: false,
      exportedAt: '2026-06-02T00:00:00.000Z',
    });

    expect(payload).toMatchObject({
      version: '2.0',
      exportedAt: '2026-06-02T00:00:00.000Z',
      metadata: undefined,
      data: undefined,
    });
  });
});

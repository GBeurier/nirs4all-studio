import { describe, expect, it } from 'vitest';

import { buildCanvasToolbarDataState } from '@/lib/playground/canvasToolbarState';
import type { PlaygroundDataViewProjection } from '@/lib/playground/dataViewProjection';
import type { PlaygroundResult } from '@/types/playground';
import type { SpectralData } from '@/types/spectral';

function createResult(overrides: Partial<PlaygroundResult> = {}): PlaygroundResult {
  return {
    original: {
      spectra: [],
      wavelengths: [],
      shape: [0, 0],
    },
    processed: {
      spectra: [],
      wavelengths: [],
      shape: [0, 0],
    },
    executionTimeMs: 0,
    trace: [],
    errors: [],
    ...overrides,
  };
}

function dataView(overrides: Partial<PlaygroundDataViewProjection> = {}): PlaygroundDataViewProjection {
  return {
    id: 'd1:view:default',
    label: 'Default view',
    source: 'schema-ref',
    representationIds: ['d1:representation:spectra'],
    sampleCount: 2,
    featureCount: 1,
    targetColumn: 'target',
    metadataColumns: [],
    repetitionColumn: null,
    sourceCount: 1,
    isSpectralCompatible: true,
    ...overrides,
  };
}

describe('buildCanvasToolbarDataState', () => {
  it('marks fold chart visible when source partitions exist', () => {
    const result = createResult({
      source_partitions: {
        has_test: true,
        n_train: 2,
        n_test: 1,
      },
    });

    expect(buildCanvasToolbarDataState({
      rawData: null,
      result,
      dataView: dataView({ sampleCount: 3 }),
    })).toMatchObject({
      hasPartition: true,
      hasFolds: false,
      showFoldsChart: true,
      totalSamples: 3,
    });
  });

  it('falls back to processed payload rows when the projection has no sample count', () => {
    const result = createResult({
      processed: {
        spectra: [[1], [2], [3], [4]],
        wavelengths: [1100],
        shape: [4, 1],
      },
    });

    expect(buildCanvasToolbarDataState({
      rawData: null,
      result,
      dataView: dataView({ sampleCount: 0 }),
    }).totalSamples).toBe(4);
  });

  it('detects raw repetition groups for toolbar state', () => {
    const rawData: SpectralData = {
      spectra: [[1], [2], [3]],
      wavelengths: [1100],
      y: [1, 2, 3],
      metadata: [
        { sample_group: 'A' },
        { sample_group: 'A' },
        { sample_group: 'B' },
      ],
      repetitionColumn: 'sample_group',
    };

    expect(buildCanvasToolbarDataState({
      rawData,
      result: null,
      dataView: dataView({ sampleCount: 3 }),
    })).toMatchObject({
      hasRawRepetitions: true,
      hasRepetitions: true,
    });
  });

  it('passes aligned projected sample IDs for toolbar consumers', () => {
    const rawData: SpectralData = {
      spectra: [[1], [2], [3]],
      wavelengths: [1100],
      y: [1, 2, 3],
      sampleIds: ['raw-1', 'raw-2', 'raw-3'],
    };
    const result = createResult({
      processed: {
        spectra: [[10], [20]],
        wavelengths: [1200],
        sample_ids: ['processed-1', 'processed-2'],
        shape: [2, 1],
      },
    });

    expect(buildCanvasToolbarDataState({
      rawData,
      result,
      dataView: dataView({ sampleCount: 2 }),
    }).sampleIds).toEqual(['processed-1', 'processed-2']);

    expect(buildCanvasToolbarDataState({
      rawData,
      result: createResult({
        processed: {
          spectra: [[10], [20]],
          wavelengths: [1200],
          shape: [2, 1],
        },
      }),
      dataView: dataView({ sampleCount: 2 }),
    }).sampleIds).toBeUndefined();
  });
});

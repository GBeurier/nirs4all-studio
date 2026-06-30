import { describe, expect, it } from 'vitest';

import { buildPlaygroundExportContent } from '@/lib/playground/exportContent';
import type { PlaygroundDataViewProjection } from '@/lib/playground/dataViewProjection';
import type { PlaygroundResult } from '@/types/playground';
import type { SpectralData } from '@/types/spectral';

function createResult(overrides: Partial<PlaygroundResult> = {}): PlaygroundResult {
  return {
    original: {
      spectra: [[1, 2]],
      wavelengths: [1100, 1200],
      shape: [1, 2],
    },
    processed: {
      spectra: [[10, 20]],
      wavelengths: [1110, 1210],
      shape: [1, 2],
    },
    executionTimeMs: 0,
    trace: [],
    errors: [],
    ...overrides,
  };
}

function dataViewProjection(overrides: Partial<PlaygroundDataViewProjection> = {}): PlaygroundDataViewProjection {
  return {
    id: 'd1:view:default',
    label: 'Default view',
    source: 'schema-ref',
    representationIds: ['d1:representation:spectra'],
    sampleCount: 2,
    featureCount: 2,
    targetColumn: 'target',
    metadataColumns: ['batch'],
    repetitionColumn: null,
    sourceCount: 1,
    isSpectralCompatible: true,
    ...overrides,
  };
}

describe('playground export content builder', () => {
  it('prefers aligned processed content over raw content', () => {
    const rawData: SpectralData = {
      spectra: [[1], [2], [3]],
      wavelengths: [1100],
      y: [10, 20, 30],
      sampleIds: ['raw-1', 'raw-2', 'raw-3'],
      metadata: [{ batch: 'raw-a' }, { batch: 'raw-b' }, { batch: 'raw-c' }],
    };
    const result = createResult({
      processed: {
        spectra: [[10], [20]],
        wavelengths: [1200],
        y: [11, 22],
        sample_ids: ['processed-1', 'processed-2'],
        metadata: { batch: ['processed-a', 'processed-b'] },
        shape: [2, 1],
      },
      pca: {
        coordinates: [[0, 1], [1, 0]],
        explained_variance_ratio: [0.8, 0.2],
        explained_variance: [8, 2],
        n_components: 2,
      },
    });

    expect(buildPlaygroundExportContent({
      rawData,
      result,
      dataView: dataViewProjection({ sampleCount: 2, featureCount: 1 }),
    })).toMatchObject({
      spectra: [[10], [20]],
      wavelengths: [1200],
      y: [11, 22],
      sampleIds: ['processed-1', 'processed-2'],
      metadata: { batch: ['processed-a', 'processed-b'] },
      pca: [[0, 1], [1, 0]],
      explainedVariance: [0.8, 0.2],
    });
  });

  it('uses raw targets, sample IDs, and columnar metadata only when they align', () => {
    const rawData: SpectralData = {
      spectra: [[1], [2]],
      wavelengths: [1100],
      y: [10, 20],
      sampleIds: ['raw-1', 'raw-2'],
      metadata: [{ batch: 'a' }, { batch: 'b' }],
    };

    expect(buildPlaygroundExportContent({
      rawData,
      result: null,
    })).toMatchObject({
      spectra: [[1], [2]],
      wavelengths: [1100],
      y: [10, 20],
      sampleIds: ['raw-1', 'raw-2'],
      metadata: { batch: ['a', 'b'] },
    });
  });

  it('drops raw sample identity when processed rows no longer align', () => {
    const rawData: SpectralData = {
      spectra: [[1], [2], [3]],
      wavelengths: [1100],
      y: [10, 20, 30],
      sampleIds: ['raw-1', 'raw-2', 'raw-3'],
      metadata: [{ batch: 'a' }, { batch: 'b' }, { batch: 'c' }],
    };
    const result = createResult({
      processed: {
        spectra: [[10], [20]],
        wavelengths: [1200],
        shape: [2, 1],
      },
    });

    expect(buildPlaygroundExportContent({
      rawData,
      result,
      dataView: dataViewProjection({ sampleCount: 2, featureCount: 1 }),
    })).toMatchObject({
      spectra: [[10], [20]],
      wavelengths: [1200],
      y: undefined,
      sampleIds: undefined,
      metadata: undefined,
    });
  });

  it('omits spectral matrices and sample IDs for non-spectral projections', () => {
    const rawData: SpectralData = {
      spectra: [[1], [2]],
      wavelengths: [1100],
      y: [10, 20],
      sampleIds: ['raw-1', 'raw-2'],
      metadata: [{ batch: 'a' }, { batch: 'b' }],
    };

    expect(buildPlaygroundExportContent({
      rawData,
      result: null,
      dataView: dataViewProjection({
        representationIds: ['d1:representation:metadata'],
        isSpectralCompatible: false,
      }),
    })).toMatchObject({
      spectra: undefined,
      wavelengths: undefined,
      y: [10, 20],
      sampleIds: undefined,
      metadata: { batch: ['a', 'b'] },
    });
  });
});

import { describe, expect, it } from 'vitest';

import {
  getAlignedArray,
  getAlignedColumnarMetadata,
  getPlaygroundSampleIds,
  resolvePlaygroundSampleCount,
} from '@/lib/playground/sampleIdentity';
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
    metadataColumns: ['batch'],
    repetitionColumn: null,
    sourceCount: 1,
    isSpectralCompatible: true,
    ...overrides,
  };
}

describe('playground sample identity helpers', () => {
  it('aligns arrays by projected row count', () => {
    expect(getAlignedArray(['a', 'b'], 2)).toEqual(['a', 'b']);
    expect(getAlignedArray(['a', 'b', 'c'], 2)).toBeUndefined();
    expect(getAlignedArray(['a'], undefined)).toEqual(['a']);
  });

  it('resolves sample count from explicit matrix count before data-view and payload fallbacks', () => {
    const result = createResult({
      processed: {
        spectra: [[1], [2], [3]],
        wavelengths: [1100],
        shape: [3, 1],
      },
    });

    expect(resolvePlaygroundSampleCount({
      rawData: null,
      result,
      dataView: dataView({ sampleCount: 2 }),
      matrixSampleCount: 1,
    })).toBe(1);
  });

  it('prefers processed sample IDs and drops raw IDs when processed rows no longer align', () => {
    const rawData: SpectralData = {
      spectra: [[1], [2], [3]],
      wavelengths: [1100],
      y: [10, 20, 30],
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

    expect(getPlaygroundSampleIds({
      rawData,
      result,
      dataView: dataView({ sampleCount: 2 }),
    })).toEqual(['processed-1', 'processed-2']);

    expect(getPlaygroundSampleIds({
      rawData,
      result: createResult({
        processed: {
          spectra: [[10], [20]],
          wavelengths: [1200],
          shape: [2, 1],
        },
      }),
      dataView: dataView({ sampleCount: 2 }),
    })).toBeUndefined();
  });

  it('keeps only metadata columns aligned to the projected row count', () => {
    expect(getAlignedColumnarMetadata({
      batch: ['a', 'b'],
      stale: ['x', 'y', 'z'],
    }, 2)).toEqual({
      batch: ['a', 'b'],
    });
  });
});

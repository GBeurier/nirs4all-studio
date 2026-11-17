import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildExecuteRequest, executeDatasetPlayground } from './playground';
import { resetBackendUrl } from './transport';

afterEach(() => {
  resetBackendUrl();
  vi.unstubAllGlobals();
});

describe('buildExecuteRequest', () => {
  it('expands train/test counts to the aligned owner partition vector', () => {
    const request = buildExecuteRequest({
      spectra: [[1, 2], [3, 4], [5, 6]],
      steps: [],
      sourcePartitions: { has_test: true, n_train: 2, n_test: 1 },
    });

    expect(request.data.partitions).toEqual(['train', 'train', 'test']);
    expect(request.options).not.toHaveProperty('source_partitions');
  });

  it('refuses partition counts that are not aligned with the spectra', () => {
    expect(() => buildExecuteRequest({
      spectra: [[1, 2], [3, 4]],
      steps: [],
      sourcePartitions: { has_test: true, n_train: 2, n_test: 1 },
    })).toThrow('must match the spectra sample count');
  });
});

describe('executeDatasetPlayground', () => {
  it('keeps missing target values and drops fold statistics the backend could not compute', async () => {
    const response = {
      success: true,
      original: { spectra: [[1, 2], [3, 4]], wavelengths: [1100, 1200], shape: [2, 2], y: [11.2, null] },
      processed: { spectra: [[1, 2], [3, 4]], wavelengths: [1100, 1200], shape: [2, 2], y: [11.2, null] },
      folds: {
        splitter_name: 'KFold',
        n_folds: 2,
        folds: [
          {
            fold_index: 0, train_count: 1, test_count: 1, train_indices: [0], test_indices: [1],
            y_train_stats: { mean: 11.2, std: 0, min: 11.2, max: 11.2 },
            y_test_stats: { mean: null, std: null, min: null, max: null },
          },
        ],
      },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));

    const result = await executeDatasetPlayground({ dataset_id: 'dataset-1', steps: [] });

    expect(result.processed.y).toEqual([11.2, null]);
    expect(result.folds?.folds[0].y_train_stats).toEqual({ mean: 11.2, std: 0, min: 11.2, max: 11.2 });
    expect(result.folds?.folds[0].y_test_stats).toBeUndefined();
  });

  it('sends missing target values back to the backend as null, never as 0', () => {
    const request = buildExecuteRequest({ spectra: [[1, 2], [3, 4]], y: [11.2, null], steps: [] });

    expect(JSON.parse(JSON.stringify(request)).data.y).toEqual([11.2, null]);
  });
});

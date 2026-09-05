import { describe, expect, it } from 'vitest';

import { buildExecuteRequest } from './playground';

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

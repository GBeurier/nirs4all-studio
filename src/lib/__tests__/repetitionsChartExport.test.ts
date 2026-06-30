import { describe, expect, it } from 'vitest';

import { buildRepetitionExportRows } from '@/lib/playground/repetitionsChartExport';
import { buildRepetitionExportRows as buildRepetitionExportRowsCompat } from '@/lib/playground/repetitionsChartData';
import type { RepetitionResult } from '@/types/playground';

const repetitionData: RepetitionResult = {
  has_repetitions: true,
  n_bio_samples: 1,
  n_with_reps: 1,
  data: [
    {
      bio_sample: 'sample-a',
      rep_index: 0,
      sample_index: 0,
      sample_id: 'a-1',
      distance: 1,
      y: 10,
      y_mean: 15,
    },
    {
      bio_sample: 'sample-a',
      rep_index: 1,
      sample_index: 1,
      sample_id: 'a-2',
      distance: 5,
    },
  ],
};

describe('repetitionsChartExport', () => {
  it('builds export rows with computed distances and nullable numeric fields', () => {
    expect(buildRepetitionExportRows(repetitionData, {
      distances: [10, 20],
      quantiles: {},
      mean: 15,
      max: 20,
    })).toEqual([
      {
        bio_sample: 'sample-a',
        rep_index: 0,
        sample_id: 'a-1',
        sample_index: 0,
        distance: 10,
        y: 10,
        y_mean: 15,
      },
      {
        bio_sample: 'sample-a',
        rep_index: 1,
        sample_id: 'a-2',
        sample_index: 1,
        distance: 20,
        y: '',
        y_mean: '',
      },
    ]);
  });

  it('returns no rows for missing repetition data', () => {
    expect(buildRepetitionExportRows(null)).toEqual([]);
    expect(buildRepetitionExportRows(undefined)).toEqual([]);
  });

  it('keeps the historical repetitionsChartData export stable', () => {
    expect(buildRepetitionExportRowsCompat).toBe(buildRepetitionExportRows);
  });
});

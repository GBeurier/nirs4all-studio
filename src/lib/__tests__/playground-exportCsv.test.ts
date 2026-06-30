import { describe, expect, it } from 'vitest';

import {
  buildPcaCsv,
  buildSpectraCsv,
  buildTargetsCsv,
} from '@/lib/playground/exportCsv';

describe('playground export CSV builders', () => {
  it('builds spectra CSV with aligned sample IDs, targets, and outlier flags', () => {
    expect(buildSpectraCsv({
      spectra: [[1, 2], [3.25, 4.5]],
      wavelengths: [1100, 1200],
      y: [10, 20],
      sampleIds: ['s1', 's2'],
      outlierIndices: [1],
    })).toEqual({
      success: true,
      csv: [
        'sample_id,1100,1200,target,is_outlier',
        's1,1.000000,2.000000,10,0',
        's2,3.250000,4.500000,20,1',
      ].join('\n'),
    });
  });

  it('omits spectra CSV sample IDs and targets when they do not align to spectra rows', () => {
    expect(buildSpectraCsv({
      spectra: [[1], [2]],
      wavelengths: [1100],
      y: [10],
      sampleIds: ['s1', 's2', 's3'],
    })).toEqual({
      success: true,
      csv: [
        '1100',
        '1.000000',
        '2.000000',
      ].join('\n'),
    });
  });

  it('builds PCA CSV with explained variance in component headers', () => {
    expect(buildPcaCsv({
      pca: [[0.1, 0.2], [0.3, 0.4]],
      explainedVariance: [0.75, 0.2],
      y: [1, 2],
      sampleIds: ['a', 'b'],
    })).toEqual({
      success: true,
      csv: [
        'sample_id,PC1_75.0%,PC2_20.0%,target',
        'a,0.100000,0.200000,1',
        'b,0.300000,0.400000,2',
      ].join('\n'),
    });
  });

  it('builds target CSV with metadata columns and blank missing metadata values', () => {
    expect(buildTargetsCsv({
      y: [10, 20],
      sampleIds: ['s1', 's2'],
      metadata: {
        batch: ['a'],
        source: ['train', 'test'],
      },
    })).toEqual({
      success: true,
      csv: [
        'sample_id,target,batch,source',
        's1,10,a,train',
        's2,20,,test',
      ].join('\n'),
    });
  });

  it('returns a data error when spectra inputs are missing', () => {
    expect(buildSpectraCsv({})).toEqual({
      success: false,
      error: 'No spectra data to export',
    });
  });

  it('returns a data error when PCA inputs are missing', () => {
    expect(buildPcaCsv({})).toEqual({
      success: false,
      error: 'No PCA data to export',
    });
  });

  it('returns a data error when target inputs are missing', () => {
    expect(buildTargetsCsv({})).toEqual({
      success: false,
      error: 'No target data to export',
    });
  });
});

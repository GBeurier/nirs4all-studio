import { describe, expect, it } from 'vitest';

import { planBatchExport } from '@/lib/playground/exportBatchPlan';

describe('planBatchExport', () => {
  it('emits one image task per chart, in render order, per format', () => {
    const tasks = planBatchExport({
      formats: ['png', 'svg'],
      baseFilename: 'batch',
      chartTypes: ['spectra', 'pca'],
      hasSpectra: false,
      hasTargets: false,
      hasPca: false,
      hasFolds: false,
    });

    expect(tasks).toEqual([
      { format: 'png', kind: 'png-chart', filename: 'batch-spectra', chartType: 'spectra' },
      { format: 'png', kind: 'png-chart', filename: 'batch-pca', chartType: 'pca' },
      { format: 'svg', kind: 'svg-chart', filename: 'batch-spectra', chartType: 'spectra' },
      { format: 'svg', kind: 'svg-chart', filename: 'batch-pca', chartType: 'pca' },
    ]);
  });

  it('only plans csv tasks for content that is present', () => {
    const tasks = planBatchExport({
      formats: ['csv'],
      baseFilename: 'batch',
      chartTypes: [],
      hasSpectra: true,
      hasTargets: false,
      hasPca: true,
      hasFolds: false,
    });

    expect(tasks.map((t) => t.kind)).toEqual(['csv-spectra', 'csv-pca']);
    expect(tasks.map((t) => t.filename)).toEqual(['batch-spectra', 'batch-pca']);
  });

  it('skips folds txt when no folds present and always plans json', () => {
    const tasks = planBatchExport({
      formats: ['txt', 'json'],
      baseFilename: 'report',
      chartTypes: [],
      hasSpectra: false,
      hasTargets: false,
      hasPca: false,
      hasFolds: false,
    });

    expect(tasks).toEqual([
      { format: 'json', kind: 'json', filename: 'report' },
    ]);
  });

  it('plans folds txt when folds are present', () => {
    const tasks = planBatchExport({
      formats: ['txt'],
      baseFilename: 'report',
      chartTypes: [],
      hasSpectra: false,
      hasTargets: false,
      hasPca: false,
      hasFolds: true,
    });

    expect(tasks).toEqual([
      { format: 'txt', kind: 'txt-folds', filename: 'report-folds' },
    ]);
  });

  it('preserves requested format ordering across mixed exports', () => {
    const tasks = planBatchExport({
      formats: ['json', 'csv', 'png'],
      baseFilename: 'b',
      chartTypes: ['hist'],
      hasSpectra: true,
      hasTargets: true,
      hasPca: false,
      hasFolds: false,
    });

    expect(tasks.map((t) => t.kind)).toEqual([
      'json',
      'csv-spectra',
      'csv-targets',
      'png-chart',
    ]);
  });
});

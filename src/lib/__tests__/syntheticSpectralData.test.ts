import { describe, expect, it } from 'vitest';

import { createSyntheticSpectralData } from '@/lib/playground/syntheticSpectralData';

describe('createSyntheticSpectralData', () => {
  it('builds the default legacy demo dataset contract', () => {
    const data = createSyntheticSpectralData({ random: () => 0.5 });

    expect(data.wavelengths).toHaveLength(200);
    expect(data.wavelengths[0]).toBe(1100);
    expect(data.wavelengths.at(-1)).toBe(2500);
    expect(data.spectra).toHaveLength(700);
    expect(data.y).toHaveLength(700);
    expect(data.sampleIds).toHaveLength(700);
    expect(data.metadata).toHaveLength(700);
    expect(data.wavelengthUnit).toBe('nm');
    expect(data.sourcePartitions).toEqual({
      has_test: true,
      n_train: 560,
      n_test: 140,
    });
  });

  it('keeps samples ordered by biological sample and repetition', () => {
    const data = createSyntheticSpectralData({
      numBioSamples: 3,
      numReps: 2,
      numTestBioSamples: 1,
      numWavelengths: 5,
      startWavelength: 1000,
      endWavelength: 1200,
      random: () => 0.5,
    });

    expect(data.wavelengths).toEqual([1000, 1050, 1100, 1150, 1200]);
    expect(data.sampleIds).toEqual([
      'Sample_01_r1',
      'Sample_01_r2',
      'Sample_02_r1',
      'Sample_02_r2',
      'Sample_03_r1',
      'Sample_03_r2',
    ]);
    expect(data.metadata?.map((sample) => sample.bio_sample)).toEqual([
      'Sample_01',
      'Sample_01',
      'Sample_02',
      'Sample_02',
      'Sample_03',
      'Sample_03',
    ]);
    expect(data.metadata?.map((sample) => sample.repetition)).toEqual([1, 2, 1, 2, 1, 2]);
    expect(data.sourcePartitions).toEqual({
      has_test: true,
      n_train: 4,
      n_test: 2,
    });
    expect(data.spectra.every((spectrum) => spectrum.length === 5)).toBe(true);
    expect(data.y).toEqual([50, 50, 50, 50, 50, 50]);
  });

  it('preserves demo metadata columns used by playground charts', () => {
    const data = createSyntheticSpectralData({ random: () => 0.5 });
    const metadata = data.metadata ?? [];

    expect(new Set(metadata.map((sample) => sample.instrument))).toHaveLength(5);
    expect(new Set(metadata.map((sample) => sample.batch))).toHaveLength(15);
    expect(new Set(metadata.map((sample) => sample.lot))).toHaveLength(100);
  });
});

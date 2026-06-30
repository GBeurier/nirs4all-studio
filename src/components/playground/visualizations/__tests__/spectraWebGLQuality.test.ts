import { describe, expect, it } from 'vitest';

import { QUALITY_CONFIGS, resolveSpectraQualityState, selectAutoQuality } from '../spectraWebGLQuality';

describe('selectAutoQuality', () => {
  it('selects high quality up to the medium threshold', () => {
    expect(selectAutoQuality(100, 1000)).toBe('high');
  });

  it('selects medium quality above 100k points and low quality above 500k points', () => {
    expect(selectAutoQuality(101, 1000)).toBe('medium');
    expect(selectAutoQuality(500, 1000)).toBe('medium');
    expect(selectAutoQuality(501, 1000)).toBe('low');
  });
});

describe('QUALITY_CONFIGS', () => {
  it('keeps the quality presets ordered by decimation budget and DPR limit', () => {
    expect(QUALITY_CONFIGS.low.maxPointsPerSpectrum).toBeLessThan(QUALITY_CONFIGS.medium.maxPointsPerSpectrum);
    expect(QUALITY_CONFIGS.medium.maxPointsPerSpectrum).toBeLessThan(QUALITY_CONFIGS.high.maxPointsPerSpectrum);
    expect(QUALITY_CONFIGS.low.maxDpr).toBeLessThan(QUALITY_CONFIGS.medium.maxDpr);
    expect(QUALITY_CONFIGS.medium.maxDpr).toBeLessThan(QUALITY_CONFIGS.high.maxDpr);
  });

  it('keeps low quality antialiasing disabled for large render batches', () => {
    expect(QUALITY_CONFIGS.low.antialias).toBe(false);
    expect(QUALITY_CONFIGS.medium.antialias).toBe(true);
    expect(QUALITY_CONFIGS.high.antialias).toBe(true);
  });
});

describe('resolveSpectraQualityState', () => {
  it('resolves auto quality from data size and returns the matching config', () => {
    expect(resolveSpectraQualityState({
      quality: 'auto',
      spectraCount: 501,
      wavelengthCount: 1000,
    })).toEqual({
      autoQuality: 'low',
      effectiveQuality: 'low',
      qualityConfig: QUALITY_CONFIGS.low,
    });
  });

  it('preserves explicit quality while still reporting the auto suggestion', () => {
    expect(resolveSpectraQualityState({
      quality: 'high',
      spectraCount: 501,
      wavelengthCount: 1000,
    })).toEqual({
      autoQuality: 'low',
      effectiveQuality: 'high',
      qualityConfig: QUALITY_CONFIGS.high,
    });
  });
});

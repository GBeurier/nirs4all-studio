export type QualityMode = 'low' | 'medium' | 'high' | 'auto';

export interface QualityConfig {
  /** Max points per spectrum (decimation factor) */
  maxPointsPerSpectrum: number;
  /** Line width for normal lines */
  normalLineWidth: number;
  /** Line width for selected lines */
  selectedLineWidth: number;
  /** Opacity for normal lines */
  normalOpacity: number;
  /** Anti-aliasing */
  antialias: boolean;
  /** DPR limit */
  maxDpr: number;
}

export const QUALITY_CONFIGS: Record<Exclude<QualityMode, 'auto'>, QualityConfig> = {
  low: {
    maxPointsPerSpectrum: 100,
    normalLineWidth: 1,
    selectedLineWidth: 2,
    normalOpacity: 1.0,
    antialias: false,
    maxDpr: 1,
  },
  medium: {
    maxPointsPerSpectrum: 300,
    normalLineWidth: 1,
    selectedLineWidth: 2,
    normalOpacity: 1.0,
    antialias: true,
    maxDpr: 1.5,
  },
  high: {
    maxPointsPerSpectrum: 1000,
    normalLineWidth: 1,
    selectedLineWidth: 2,
    normalOpacity: 1.0,
    antialias: true,
    maxDpr: 2,
  },
};

export function selectAutoQuality(
  nSamples: number,
  nWavelengths: number
): Exclude<QualityMode, 'auto'> {
  const complexity = nSamples * nWavelengths;
  if (complexity > 500_000) return 'low';
  if (complexity > 100_000) return 'medium';
  return 'high';
}

export interface SpectraQualityState {
  autoQuality: Exclude<QualityMode, 'auto'>;
  effectiveQuality: Exclude<QualityMode, 'auto'>;
  qualityConfig: QualityConfig;
}

export function resolveSpectraQualityState({
  quality,
  spectraCount,
  wavelengthCount,
}: {
  quality: QualityMode;
  spectraCount: number;
  wavelengthCount: number;
}): SpectraQualityState {
  const autoQuality = selectAutoQuality(spectraCount, wavelengthCount);
  const effectiveQuality: Exclude<QualityMode, 'auto'> = quality === 'auto'
    ? autoQuality
    : quality;

  return {
    autoQuality,
    effectiveQuality,
    qualityConfig: QUALITY_CONFIGS[effectiveQuality],
  };
}

/**
 * Sampling Strategies for Spectra Visualization
 *
 * Phase 2 Implementation: Enhanced Spectra Chart
 *
 * Provides client-side sampling algorithms and interfaces for
 * backend-based sampling strategies.
 */

import type { SamplingStrategy, SamplingConfig } from './spectraConfig';

// ============= Types =============

/**
 * Result of a sampling operation
 */
export interface SamplingResult {
  /** Selected sample indices */
  indices: number[];
  /** Total samples before sampling */
  totalSamples: number;
  /** Strategy used */
  strategy: SamplingStrategy;
  /** Whether sampling was applied (false if all samples selected) */
  wasApplied: boolean;
}

/**
 * Seeded random number generator (Mulberry32)
 * Provides reproducible random sampling
 */
export function createSeededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============= Sampling Functions =============

/**
 * Random sampling - uniform random selection
 */
export function randomSample(
  totalSamples: number,
  targetCount: number,
  seed: number = 42
): number[] {
  if (targetCount >= totalSamples) {
    return Array.from({ length: totalSamples }, (_, i) => i);
  }

  const random = createSeededRandom(seed);
  const indices = new Set<number>();

  // Use reservoir sampling for efficiency
  while (indices.size < targetCount) {
    const idx = Math.floor(random() * totalSamples);
    indices.add(idx);
  }

  return Array.from(indices).sort((a, b) => a - b);
}

/**
 * Stratified sampling - preserve target value distribution
 * Groups samples by Y quantiles and samples from each group
 */
export function stratifiedSample(
  yValues: number[],
  targetCount: number,
  seed: number = 42,
  numBins: number = 5
): number[] {
  const totalSamples = yValues.length;

  if (targetCount >= totalSamples) {
    return Array.from({ length: totalSamples }, (_, i) => i);
  }

  const random = createSeededRandom(seed);

  // Compute quantile boundaries
  const sortedY = [...yValues].sort((a, b) => a - b);
  const boundaries: number[] = [];
  for (let i = 1; i < numBins; i++) {
    const idx = Math.floor((i * sortedY.length) / numBins);
    boundaries.push(sortedY[idx]);
  }

  // Assign samples to bins
  const bins: number[][] = Array.from({ length: numBins }, () => []);
  yValues.forEach((y, idx) => {
    let binIdx = boundaries.findIndex(b => y < b);
    if (binIdx === -1) binIdx = numBins - 1;
    bins[binIdx].push(idx);
  });

  // Sample proportionally from each bin
  const samplesPerBin = Math.floor(targetCount / numBins);
  const remainder = targetCount % numBins;
  const result: number[] = [];

  bins.forEach((bin, binIdx) => {
    const binTarget = samplesPerBin + (binIdx < remainder ? 1 : 0);
    const actualTarget = Math.min(binTarget, bin.length);

    // Shuffle bin and take first actualTarget
    const shuffled = [...bin];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    result.push(...shuffled.slice(0, actualTarget));
  });

  return result.sort((a, b) => a - b);
}

/**
 * Coverage sampling - maximize feature space coverage using k-means-like approach
 * This is a simplified client-side version; backend provides true k-means
 */
export function coverageSample(
  spectra: number[][],
  targetCount: number,
  seed: number = 42
): number[] {
  const totalSamples = spectra.length;

  if (targetCount >= totalSamples) {
    return Array.from({ length: totalSamples }, (_, i) => i);
  }

  const random = createSeededRandom(seed);

  // Simple greedy maximin selection
  // Start with random sample, then iteratively add furthest point
  const selected: number[] = [];
  const used = new Set<number>();

  // Random first sample
  const first = Math.floor(random() * totalSamples);
  selected.push(first);
  used.add(first);

  // Compute simplified "distance" using only a subset of features for speed
  const featureStep = Math.max(1, Math.floor(spectra[0].length / 20));
  const getFeatures = (idx: number) => {
    const result: number[] = [];
    for (let i = 0; i < spectra[idx].length; i += featureStep) {
      result.push(spectra[idx][i]);
    }
    return result;
  };

  const distance = (a: number[], b: number[]): number => {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const d = a[i] - b[i];
      sum += d * d;
    }
    return Math.sqrt(sum);
  };

  // Precompute features for all samples
  const features = spectra.map((_, i) => getFeatures(i));

  while (selected.length < targetCount) {
    let maxDist = -1;
    let maxIdx = -1;

    for (let i = 0; i < totalSamples; i++) {
      if (used.has(i)) continue;

      // Find minimum distance to any selected point
      let minDist = Infinity;
      for (const selIdx of selected) {
        const d = distance(features[i], features[selIdx]);
        if (d < minDist) minDist = d;
      }

      if (minDist > maxDist) {
        maxDist = minDist;
        maxIdx = i;
      }
    }

    if (maxIdx >= 0) {
      selected.push(maxIdx);
      used.add(maxIdx);
    } else {
      break;
    }
  }

  return selected.sort((a, b) => a - b);
}

/**
 * Progressive sampling - level-of-detail based on interaction
 */
export function progressiveSample(
  totalSamples: number,
  level: number,
  levels: number[] = [50, 200, 1000],
  seed: number = 42
): number[] {
  const targetCount = levels[Math.min(level, levels.length - 1)] ?? totalSamples;
  return randomSample(totalSamples, targetCount, seed);
}

// ============= Main Sampling Interface =============

/**
 * Apply sampling strategy to get sample indices
 *
 * @param totalSamples - Total number of samples available
 * @param config - Sampling configuration
 * @param data - Optional data for advanced sampling (y values, spectra)
 * @returns SamplingResult with selected indices
 */
export function applySampling(
  totalSamples: number,
  config: SamplingConfig,
  data?: {
    yValues?: number[];
    spectra?: number[][];
    progressiveLevel?: number;
  }
): SamplingResult {
  const { strategy, sampleCount, progressiveLevels, seed = 42 } = config;

  // Skip sampling if count is sufficient
  if (sampleCount >= totalSamples && strategy !== 'progressive') {
    return {
      indices: Array.from({ length: totalSamples }, (_, i) => i),
      totalSamples,
      strategy,
      wasApplied: false,
    };
  }

  let indices: number[];

  switch (strategy) {
    case 'random':
      indices = randomSample(totalSamples, sampleCount, seed);
      break;

    case 'stratified':
      if (data?.yValues && data.yValues.length === totalSamples) {
        indices = stratifiedSample(data.yValues, sampleCount, seed);
      } else {
        // Fall back to random if no Y values
        indices = randomSample(totalSamples, sampleCount, seed);
      }
      break;

    case 'coverage':
      if (data?.spectra && data.spectra.length === totalSamples) {
        indices = coverageSample(data.spectra, sampleCount, seed);
      } else {
        // Fall back to random if no spectra
        indices = randomSample(totalSamples, sampleCount, seed);
      }
      break;

    case 'progressive':
      indices = progressiveSample(
        totalSamples,
        data?.progressiveLevel ?? 0,
        progressiveLevels,
        seed
      );
      break;

    default:
      indices = randomSample(totalSamples, sampleCount, seed);
  }

  return {
    indices,
    totalSamples,
    strategy,
    wasApplied: true,
  };
}

/**
 * Get display text for sampling result
 */
export function getSamplingDescription(result: SamplingResult): string {
  if (!result.wasApplied) {
    return `Showing all ${result.totalSamples} samples`;
  }

  const strategyLabels: Record<SamplingStrategy, string> = {
    random: 'random',
    stratified: 'stratified by Y',
    coverage: 'coverage-maximizing',
    progressive: 'progressive',
  };

  return `Showing ${result.indices.length} of ${result.totalSamples} (${strategyLabels[result.strategy]})`;
}

// ============= Backend Request Helpers =============

/**
 * Convert frontend sampling config to backend request format
 */
export function toBackendSamplingRequest(config: SamplingConfig): {
  method: 'random' | 'stratified' | 'kmeans' | 'all';
  n_samples: number;
  seed: number;
} {
  // Map frontend strategies to backend methods
  const methodMap: Record<SamplingStrategy, 'random' | 'stratified' | 'kmeans' | 'all'> = {
    random: 'random',
    stratified: 'stratified',
    coverage: 'kmeans',
    progressive: 'random', // Progressive uses random on backend, level managed client-side
  };

  return {
    method: methodMap[config.strategy],
    n_samples: config.sampleCount,
    seed: config.seed ?? 42,
  };
}

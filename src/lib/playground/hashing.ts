/**
 * Hashing utilities for stable cache keys
 *
 * These utilities create deterministic hashes for React Query cache keys,
 * ensuring that identical data/pipeline configurations produce the same key.
 */

import type { UnifiedOperator, SamplingOptions, ExecuteOptions } from '@/types/playground';

/**
 * Simple string hash function (djb2 algorithm)
 */
function djb2Hash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  // Convert to hex string
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Stable JSON stringify with sorted keys
 * Ensures consistent string representation regardless of object key order
 */
function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) {
    return String(obj);
  }

  if (typeof obj !== 'object') {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return '[' + obj.map(stableStringify).join(',') + ']';
  }

  const keys = Object.keys(obj as object).sort();
  const pairs = keys.map(key => {
    const value = (obj as Record<string, unknown>)[key];
    return `"${key}":${stableStringify(value)}`;
  });
  return '{' + pairs.join(',') + '}';
}

/**
 * Hash an operator for cache key purposes
 */
function hashOperator(operator: UnifiedOperator): string {
  return stableStringify({
    id: operator.id,
    type: operator.type,
    name: operator.name,
    params: operator.params,
    enabled: operator.enabled,
  });
}

/**
 * Hash a pipeline (array of operators) for cache key purposes
 *
 * @param operators - Array of operators in the pipeline
 * @returns A stable hash string
 */
export function hashPipeline(operators: UnifiedOperator[]): string {
  const pipelineStr = operators.map(hashOperator).join('|');
  return djb2Hash(pipelineStr);
}

/**
 * Hash execution options for cache key purposes
 *
 * @param options - Execution options
 * @returns A stable hash string
 */
export function hashOptions(options: {
  sampling?: SamplingOptions;
  execute?: ExecuteOptions;
}): string {
  const optionsStr = stableStringify(options);
  return djb2Hash(optionsStr);
}

/**
 * Hash spectral data for cache key purposes
 * Uses a fingerprint (first few samples + shape) rather than full data
 *
 * @param spectra - 2D array of spectral data
 * @param y - Optional target values
 * @returns A stable hash string
 */
export function hashData(spectra: number[][], y?: number[]): string {
  const nSamples = spectra.length;
  const nFeatures = spectra[0]?.length ?? 0;

  // Use first 3 samples for fingerprinting (if available)
  const sampleCount = Math.min(3, nSamples);
  const fingerprint: number[][] = [];

  for (let i = 0; i < sampleCount; i++) {
    // Use every 10th feature to reduce size
    const subSampled = spectra[i].filter((_, j) => j % 10 === 0);
    fingerprint.push(subSampled.map(v => Math.round(v * 1000) / 1000)); // Round for stability
  }

  const dataObj = {
    shape: [nSamples, nFeatures],
    fingerprint,
    yLength: y?.length ?? 0,
    ySum: y ? y.reduce((a, b) => a + b, 0) : 0,
  };

  return djb2Hash(stableStringify(dataObj));
}

/**
 * Create a complete cache key for a playground query
 *
 * @param spectra - Spectral data
 * @param y - Target values
 * @param operators - Pipeline operators
 * @param sampling - Sampling options
 * @param executeOptions - Execution options
 * @returns Array suitable for React Query queryKey
 */
export function createPlaygroundQueryKey(
  spectra: number[][] | null,
  y: number[] | undefined,
  operators: UnifiedOperator[],
  sampling?: SamplingOptions,
  executeOptions?: ExecuteOptions
): readonly unknown[] {
  if (!spectra) {
    return ['playground', 'execute', null] as const;
  }

  const dataHash = hashData(spectra, y);
  const pipelineHash = hashPipeline(operators);
  const optionsHash = hashOptions({ sampling, execute: executeOptions });

  return [
    'playground',
    'execute',
    dataHash,
    pipelineHash,
    optionsHash,
  ] as const;
}

/**
 * Check if two operator arrays are equivalent
 * Used to detect if pipeline actually changed
 */
export function operatorsEqual(a: UnifiedOperator[], b: UnifiedOperator[]): boolean {
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return false;
    if (a[i].name !== b[i].name) return false;
    if (a[i].enabled !== b[i].enabled) return false;
    if (stableStringify(a[i].params) !== stableStringify(b[i].params)) return false;
  }

  return true;
}

/**
 * Get a short display hash for debugging/display purposes
 */
export function shortHash(str: string): string {
  return djb2Hash(str).substring(0, 6);
}

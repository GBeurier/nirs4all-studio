/**
 * Hashing utilities for stable cache keys
 *
 * These utilities create deterministic hashes for React Query cache keys,
 * ensuring that identical data/pipeline configurations produce the same key.
 *
 * Performance optimizations:
 * - Fast djb2 hash for strings
 * - Fast numeric checksum for data arrays (avoids JSON serialization)
 * - Minimal fingerprinting for large datasets
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
 * Fast numeric checksum for arrays (avoids string serialization)
 */
function fastArrayChecksum(arr: number[]): number {
  let sum = 0;
  const len = arr.length;
  // Sample every 50th element for large arrays
  const step = len > 500 ? 50 : 1;
  for (let i = 0; i < len; i += step) {
    sum = ((sum << 5) - sum + (arr[i] * 1000) | 0) | 0;
  }
  return sum >>> 0;
}

/**
 * Stable JSON stringify with sorted keys - optimized version
 * Uses native JSON.stringify with replacer for better performance
 */
function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) {
    return String(obj);
  }

  if (typeof obj !== 'object') {
    return JSON.stringify(obj);
  }

  // For simple objects without deep nesting, use fast path
  if (!Array.isArray(obj)) {
    const keys = Object.keys(obj as object).sort();
    const sortedObj: Record<string, unknown> = {};
    for (const key of keys) {
      sortedObj[key] = (obj as Record<string, unknown>)[key];
    }
    return JSON.stringify(sortedObj);
  }

  // For arrays, stringify directly (order matters)
  return JSON.stringify(obj);
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
 * Uses fast numeric checksums instead of JSON serialization
 *
 * @param spectra - 2D array of spectral data
 * @param y - Optional target values
 * @returns A stable hash string
 */
export function hashData(spectra: number[][], y?: number[]): string {
  const nSamples = spectra.length;
  const nFeatures = spectra[0]?.length ?? 0;

  // Fast checksum using first, middle, and last samples
  let dataChecksum = 0;
  if (nSamples > 0) {
    dataChecksum ^= fastArrayChecksum(spectra[0]);
    if (nSamples > 1) {
      dataChecksum ^= fastArrayChecksum(spectra[Math.floor(nSamples / 2)]);
      dataChecksum ^= fastArrayChecksum(spectra[nSamples - 1]);
    }
  }

  // Fast Y checksum
  const yChecksum = y ? fastArrayChecksum(y) : 0;

  // Combine into simple string (much faster than JSON serialization)
  const hashStr = `${nSamples}:${nFeatures}:${dataChecksum}:${y?.length ?? 0}:${yChecksum}`;
  return djb2Hash(hashStr);
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

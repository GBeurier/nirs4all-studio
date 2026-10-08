/**
 * Hashing utilities for stable cache keys
 *
 * These utilities create deterministic hashes for React Query cache keys,
 * ensuring that identical data/pipeline configurations produce the same key.
 *
 * Loaded immutable data uses a unique snapshot identity. Small pipeline/options
 * use canonical complete keys, without approximate scientific fingerprints.
 */

import type { UnifiedOperator, SamplingOptions, ExecuteOptions } from '@/types/playground';
import type { SpectralData } from '@/types/spectral';

// React state holds immutable loaded snapshots. Identity covers the entire input
// (spectra, targets, axis, metadata, partitions), without rescanning it on a click.
const snapshotIds = new WeakMap<SpectralData, string>();
const snapshotSession = crypto.randomUUID();
let nextSnapshotId = 0;

export function getSpectralDataIdentity(data: SpectralData): string {
  let identity = snapshotIds.get(data);
  if (!identity) {
    identity = `spectral-snapshot:${snapshotSession}:${++nextSnapshotId}`;
    snapshotIds.set(data, identity);
  }
  return identity;
}

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
 * Canonical JSON with keys sorted at every depth.
 */
function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) {
    return String(obj);
  }

  if (typeof obj !== 'object') {
    return JSON.stringify(obj);
  }

  return JSON.stringify(obj, (_key, value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]));
  });
}

/**
 * Hash an operator for cache key purposes
 */
function hashOperator(operator: UnifiedOperator): string {
  return stableStringify({
    id: operator.id,
    type: operator.type,
    name: operator.name,
    classPath: operator.classPath,
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
  return operators.map(hashOperator).join('|');
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
  return stableStringify(options);
}

/**
 * Hash spectral data for cache key purposes
 * Standalone complete data signature. Interactive hooks use snapshot identities
 * to avoid serializing the matrix repeatedly.
 *
 * @param spectra - 2D array of spectral data
 * @param y - Optional target values
 * @returns A stable hash string
 */
export function hashData(spectra: number[][], y?: number[]): string {
  return stableStringify({ spectra, y });
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
  executeOptions?: ExecuteOptions,
  dataSignature?: string | null,
): readonly unknown[] {
  if (!spectra) {
    return ['playground', 'execute', null] as const;
  }

  // Hooks provide a complete snapshot identity. The standalone fallback must
  // include every value, never an approximate fingerprint of scientific data.
  const dataHash = dataSignature ?? hashData(spectra, y);
  const pipelineHash = hashPipeline(operators.filter(operator => operator.enabled));
  const optionsHash = hashOptions({ sampling, execute: executeOptions });

  return [
    'playground',
    'execute',
    dataHash,
    pipelineHash,
    optionsHash,
    dataSignature ?? null,
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
    if (a[i].classPath !== b[i].classPath) return false;
    if (a[i].enabled !== b[i].enabled) return false;
    if (stableStringify(a[i].params) !== stableStringify(b[i].params)) return false;
  }

  return true;
}

// Keep this conservative list aligned with the native playground cache. A
// custom class is not deterministic merely because its name looks ordinary.
const deterministicClasses = new Set([
  'nirs4all.operators.transforms.nirs.SavitzkyGolay',
  'nirs4all.operators.transforms.scalers.StandardNormalVariate',
  'nirs4all.operators.transforms.nirs.MultiplicativeScatterCorrection',
  'nirs4all.operators.transforms.signal.Detrend',
  ...['StandardScaler', 'MinMaxScaler', 'RobustScaler', 'MaxAbsScaler', 'Normalizer', 'PowerTransformer']
    .flatMap(name => [`sklearn.preprocessing.${name}`, `sklearn.preprocessing._data.${name}`]),
]);

/** Reuse only explicitly known deterministic operations. */
export function isPlaygroundPipelineCacheable(operators: UnifiedOperator[], computeUmap = false): boolean {
  if (computeUmap) return false;
  return operators.filter(operator => operator.enabled).every(operator => {
    return (operator.type === 'filter' && operator.name === 'SampleIndexFilter')
      || (operator.type === 'preprocessing' && !!operator.classPath && deterministicClasses.has(operator.classPath));
  });
}

/**
 * Get a short display hash for debugging/display purposes
 */
export function shortHash(str: string): string {
  return djb2Hash(str).substring(0, 6);
}

// ============= Change Detection Hashing =============

/**
 * Hash a filtered list of operators for change detection
 * Only considers enabled operators
 */
export function hashOperatorList(operators: UnifiedOperator[]): string {
  const enabledOps = operators.filter(op => op.enabled);
  if (enabledOps.length === 0) return '';
  return hashPipeline(enabledOps);
}

/**
 * Category hashes for granular change detection
 */
export interface CategoryHashes {
  /** Hash of preprocessing + augmentation operators */
  dataTransform: string;
  /** Hash of splitting operators */
  splitting: string;
  /** Hash of filter operators */
  filter: string;
}

/**
 * Compute per-category hashes for change detection
 * Used to determine which charts need to show loading state
 *
 * @param operators - All pipeline operators
 * @returns Hashes for each operator category
 */
export function computeCategoryHashes(operators: UnifiedOperator[]): CategoryHashes {
  const dataTransformOps = operators.filter(
    op => op.type === 'preprocessing' || op.type === 'augmentation'
  );
  const splittingOps = operators.filter(op => op.type === 'splitting');
  const filterOps = operators.filter(op => op.type === 'filter');

  return {
    dataTransform: hashOperatorList(dataTransformOps),
    splitting: hashOperatorList(splittingOps),
    filter: hashOperatorList(filterOps),
  };
}

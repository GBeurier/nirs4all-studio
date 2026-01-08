/**
 * Test data for Unified Coloration System visual testing
 *
 * Contains 100 samples with:
 * - Spectra (100 x 200 wavelengths)
 * - Y values (range 0-100)
 * - 5-fold CV fold labels
 * - Train/test partition per fold
 * - Categorical and continuous metadata
 * - 10 outliers
 */

// Generate deterministic pseudo-random numbers
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = Math.sin(s) * 10000;
    return s - Math.floor(s);
  };
}

const random = seededRandom(42);

// ============= Sample Configuration =============

export const NUM_SAMPLES = 100;
export const NUM_WAVELENGTHS = 200;
export const NUM_FOLDS = 5;

// ============= Generate Sample IDs =============

export const sampleIds: string[] = Array.from(
  { length: NUM_SAMPLES },
  (_, i) => `sample_${String(i + 1).padStart(3, '0')}`
);

// ============= Generate Wavelengths =============

export const wavelengths: number[] = Array.from(
  { length: NUM_WAVELENGTHS },
  (_, i) => 900 + i * 5 // 900nm to 1895nm
);

// ============= Generate Y Values =============

export const y: number[] = Array.from(
  { length: NUM_SAMPLES },
  (_, i) => {
    // Create a distribution with some clustering
    const base = (i / NUM_SAMPLES) * 100;
    const noise = (random() - 0.5) * 20;
    return Math.max(0, Math.min(100, base + noise));
  }
);

// ============= Generate Spectra =============

export const spectra: number[][] = Array.from(
  { length: NUM_SAMPLES },
  (_, sampleIdx) => {
    return Array.from({ length: NUM_WAVELENGTHS }, (_, wlIdx) => {
      // Base spectrum with some structure
      const base = Math.sin(wlIdx / 20) * 0.3 + 1;
      // Sample-specific variation correlated with Y
      const yFactor = y[sampleIdx] / 100;
      const sampleVariation = yFactor * 0.2 * Math.cos(wlIdx / 10);
      // Random noise
      const noise = (random() - 0.5) * 0.05;
      return base + sampleVariation + noise;
    });
  }
);

// ============= Generate Fold Labels =============

// Assign each sample to a fold (0 to NUM_FOLDS-1)
export const foldLabels: number[] = Array.from(
  { length: NUM_SAMPLES },
  (_, i) => i % NUM_FOLDS
);

// ============= Generate Folds Structure =============

export interface FoldData {
  fold_index: number;
  train_indices: number[];
  test_indices: number[];
}

export const folds: {
  n_folds: number;
  fold_labels: number[];
  folds: FoldData[];
} = {
  n_folds: NUM_FOLDS,
  fold_labels: foldLabels,
  folds: Array.from({ length: NUM_FOLDS }, (_, foldIdx) => {
    const allIndices = Array.from({ length: NUM_SAMPLES }, (_, i) => i);
    const testIndices = allIndices.filter(i => foldLabels[i] === foldIdx);
    const trainIndices = allIndices.filter(i => foldLabels[i] !== foldIdx);

    return {
      fold_index: foldIdx,
      train_indices: trainIndices,
      test_indices: testIndices,
    };
  }),
};

// ============= Generate Metadata =============

const categories = ['A', 'B', 'C', 'D'];
const sources = ['Lab1', 'Lab2', 'Lab3'];

export const metadata: Record<string, (string | number)[]> = {
  // Categorical: category assignment
  category: Array.from({ length: NUM_SAMPLES }, (_, i) =>
    categories[Math.floor(random() * categories.length)]
  ),

  // Categorical: source lab
  source: Array.from({ length: NUM_SAMPLES }, (_, i) =>
    sources[Math.floor(random() * sources.length)]
  ),

  // Continuous: measurement quality score
  quality: Array.from({ length: NUM_SAMPLES }, () =>
    Math.round((random() * 40 + 60) * 10) / 10 // 60-100 range
  ),

  // Continuous: sample age in days
  age: Array.from({ length: NUM_SAMPLES }, () =>
    Math.round(random() * 365) // 0-365 days
  ),
};

// ============= Generate Outliers =============

// Select 10 samples as outliers (spread across the dataset)
export const outlierIndices: number[] = [5, 12, 23, 45, 52, 67, 78, 83, 91, 99];

export const outlierResult = {
  outlier_indices: outlierIndices,
  outlier_scores: outlierIndices.map(() => 0.9 + random() * 0.1),
  threshold: 0.85,
  method: 'iqr',
};

// ============= Combined Test Data Export =============

export const unifiedColorTestData = {
  // Basic data
  spectra,
  wavelengths,
  y,
  sampleIds,

  // Fold structure
  folds,

  // Metadata
  metadata,

  // Outliers
  outlierResult,

  // Derived sets for colorContext
  outlierIndicesSet: new Set(outlierIndices),
  trainIndicesSet: new Set(folds.folds[0].train_indices), // Use fold 0 for train/test
  testIndicesSet: new Set(folds.folds[0].test_indices),
};

// ============= Mock Result Object =============

/**
 * Mock result object compatible with MainCanvas props
 */
export const mockPlaygroundResult = {
  id: 'test-result',
  pipeline_config: {},
  dataset_config: {},
  success: true,

  raw_spectra: spectra,
  wavelengths,
  y,
  sample_ids: sampleIds,

  spectra, // processed = raw for testing

  folds,
  repetitions: null,

  metrics: {
    train_r2: 0.95,
    test_r2: 0.92,
    rmse: 2.5,
  },
};

// ============= Test Scenarios =============

/**
 * Test scenarios for visual verification
 */
export const testScenarios = [
  {
    name: 'Y Value Mode (target)',
    mode: 'target' as const,
    description: 'Samples should show blue-red gradient based on Y value',
    verification: [
      'Low Y values (0-33) should be blue',
      'Medium Y values (34-66) should be green/yellow',
      'High Y values (67-100) should be red',
      'All charts should use the same colors for the same samples',
    ],
  },
  {
    name: 'Partition Mode',
    mode: 'partition' as const,
    description: 'Samples should show train (blue) vs test (orange)',
    verification: [
      'Train samples should be blue',
      'Test samples should be orange',
      'Fold 0 test samples: indices 0, 5, 10, 15, 20, ...',
    ],
  },
  {
    name: 'Fold Mode',
    mode: 'fold' as const,
    description: 'Samples should show distinct colors per fold',
    verification: [
      'Each fold should have a unique color from categorical palette',
      'Fold 0: indices 0, 5, 10, ... (every 5th starting from 0)',
      'Fold 1: indices 1, 6, 11, ... (every 5th starting from 1)',
      // etc.
    ],
  },
  {
    name: 'Metadata Mode (category)',
    mode: 'metadata' as const,
    metadataKey: 'category',
    description: 'Samples should show colors based on category (A/B/C/D)',
    verification: [
      'Each category should have a distinct color',
      '4 categories = 4 colors from categorical palette',
    ],
  },
  {
    name: 'Selection Mode',
    mode: 'selection' as const,
    description: 'Selected samples should be highlighted',
    verification: [
      'Unselected samples should be grey/muted',
      'Selected samples should be primary color',
      'Try selecting samples 0, 10, 20, 30, 40',
    ],
  },
  {
    name: 'Outlier Mode',
    mode: 'outlier' as const,
    description: 'Outliers should be red, non-outliers grey',
    verification: [
      'Outlier indices: 5, 12, 23, 45, 52, 67, 78, 83, 91, 99',
      'These samples should be red',
      'All other samples should be grey',
      'Outliers should be rendered on top (z-order)',
    ],
  },
];

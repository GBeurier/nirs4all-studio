/**
 * Test data for Unified Coloration System visual testing
 *
 * Contains 700 samples with:
 * - Spectra (700 x 200 wavelengths)
 * - Y values (range 0-100)
 * - 5-fold CV fold labels
 * - Train/test partition per fold
 * - Repetitions (175 bio samples x 4 reps)
 * - Categorical and continuous metadata
 * - 70 outliers (10%)
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

export const NUM_SAMPLES = 700;
export const NUM_WAVELENGTHS = 200;
export const NUM_FOLDS = 5;
export const NUM_BIO_SAMPLES = 175;
export const NUM_REPS = 4;
export const NUM_TEST_SAMPLES = 35; // 20% test

// ============= Generate Sample IDs =============

// Sample IDs follow the pattern: Sample_XX_rY (bio sample ID with repetition number)
export const sampleIds: string[] = [];
for (let bioIdx = 0; bioIdx < NUM_BIO_SAMPLES; bioIdx++) {
  const bioId = String(bioIdx + 1).padStart(3, '0');
  for (let rep = 0; rep < NUM_REPS; rep++) {
    sampleIds.push(`Sample_${bioId}_r${rep + 1}`);
  }
}

// ============= Generate Wavelengths =============

export const wavelengths: number[] = Array.from(
  { length: NUM_WAVELENGTHS },
  (_, i) => 900 + i * 5 // 900nm to 1895nm
);

// ============= Generate Y Values =============

// First generate true concentrations for each bio sample
const bioSampleConcentrations: number[] = Array.from(
  { length: NUM_BIO_SAMPLES },
  (_, bioIdx) => {
    // Create a distribution with some clustering
    const base = (bioIdx / NUM_BIO_SAMPLES) * 100;
    const noise = (random() - 0.5) * 20;
    return Math.max(0, Math.min(100, base + noise));
  }
);

// Now create Y values with small variations for each repetition
export const y: number[] = [];
for (let bioIdx = 0; bioIdx < NUM_BIO_SAMPLES; bioIdx++) {
  const trueConcentration = bioSampleConcentrations[bioIdx];
  for (let rep = 0; rep < NUM_REPS; rep++) {
    // Small variation between repetitions
    const variation = (random() - 0.5) * 5;
    y.push(Math.max(0, Math.min(100, trueConcentration + variation)));
  }
}

// ============= Generate Spectra =============

// Generate spectra with bio sample correlation (same bio sample = similar spectra)
export const spectra: number[][] = [];
for (let bioIdx = 0; bioIdx < NUM_BIO_SAMPLES; bioIdx++) {
  const trueConcentration = bioSampleConcentrations[bioIdx];
  const yFactor = trueConcentration / 100;

  for (let rep = 0; rep < NUM_REPS; rep++) {
    // Small variation between repetitions
    const repVariation = (random() - 0.5) * 0.01;

    const spectrum = Array.from({ length: NUM_WAVELENGTHS }, (_, wlIdx) => {
      // Base spectrum with some structure
      const base = Math.sin(wlIdx / 20) * 0.3 + 1;
      // Sample-specific variation correlated with true concentration
      const sampleVariation = yFactor * 0.2 * Math.cos(wlIdx / 10);
      // Random noise
      const noise = (random() - 0.5) * 0.05;
      return base + sampleVariation + noise + repVariation;
    });

    spectra.push(spectrum);
  }
}

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

// Determine train/test split: last NUM_TEST_SAMPLES bio samples are test
const testSampleStart = NUM_BIO_SAMPLES - NUM_TEST_SAMPLES;

// Generate metadata with bio_sample, repetition, and set (train/test)
export const metadata: Record<string, (string | number)[]> = {
  // Bio sample ID (e.g., Sample_001, Sample_002, ...)
  bio_sample: [],

  // Repetition number (1-4)
  repetition: [],

  // Set: train or test
  set: [],

  // Categorical: category assignment (per bio sample)
  category: [],

  // Categorical: source lab (per bio sample)
  source: [],

  // Continuous: measurement quality score
  quality: [],

  // Continuous: sample age in days
  age: [],
};

// Populate metadata arrays
for (let bioIdx = 0; bioIdx < NUM_BIO_SAMPLES; bioIdx++) {
  const bioId = String(bioIdx + 1).padStart(3, '0');
  const isTest = bioIdx >= testSampleStart;
  const bioCategory = categories[Math.floor(random() * categories.length)];
  const bioSource = sources[Math.floor(random() * sources.length)];

  for (let rep = 0; rep < NUM_REPS; rep++) {
    metadata.bio_sample.push(`Sample_${bioId}`);
    metadata.repetition.push(rep + 1);
    metadata.set.push(isTest ? 'test' : 'train');
    metadata.category.push(bioCategory);
    metadata.source.push(bioSource);
    metadata.quality.push(Math.round((random() * 40 + 60) * 10) / 10);
    metadata.age.push(Math.round(random() * 365));
  }
}

// ============= Generate Outliers =============

// Select 70 samples as outliers (10% of 700, spread across the dataset)
export const outlierIndices: number[] = Array.from(
  { length: 70 },
  (_, i) => Math.floor((i * NUM_SAMPLES) / 70)
);

export const outlierResult = {
  outlier_indices: outlierIndices,
  outlier_scores: outlierIndices.map(() => 0.9 + random() * 0.1),
  threshold: 0.85,
  method: 'iqr',
};

// ============= Compute Train/Test Indices from Metadata =============

// Train indices: samples where metadata.set === 'train'
const trainIndices: number[] = [];
const testIndices: number[] = [];
for (let i = 0; i < NUM_SAMPLES; i++) {
  if (metadata.set[i] === 'train') {
    trainIndices.push(i);
  } else {
    testIndices.push(i);
  }
}

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

  // Derived sets for colorContext (using metadata-based train/test)
  outlierIndicesSet: new Set(outlierIndices),
  trainIndicesSet: new Set(trainIndices),
  testIndicesSet: new Set(testIndices),
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
      'Note: Repetitions of the same bio sample should have similar colors',
    ],
  },
  {
    name: 'Partition Mode',
    mode: 'partition' as const,
    description: 'Samples should show train (blue) vs test (orange)',
    verification: [
      'Train samples (560): first 140 bio samples × 4 reps',
      'Test samples (140): last 35 bio samples × 4 reps',
      'Test samples start at index 560 (Sample_141_r1)',
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
      'With 700 samples, each fold has ~140 samples',
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
      'All reps of the same bio sample share the same category',
    ],
  },
  {
    name: 'Metadata Mode (set)',
    mode: 'metadata' as const,
    metadataKey: 'set',
    description: 'Samples should show train vs test based on metadata',
    verification: [
      'Train samples should have one color',
      'Test samples should have another color',
      '80% train (560 samples), 20% test (140 samples)',
    ],
  },
  {
    name: 'Metadata Mode (repetition)',
    mode: 'metadata' as const,
    metadataKey: 'repetition',
    description: 'Samples should show colors based on repetition number (1-4)',
    verification: [
      'Each repetition (1-4) should have a distinct color',
      '4 repetitions = 4 colors from categorical palette',
    ],
  },
  {
    name: 'Selection Mode',
    mode: 'selection' as const,
    description: 'Selected samples should be highlighted',
    verification: [
      'Unselected samples should be grey/muted',
      'Selected samples should be primary color',
      'Try selecting samples 0, 100, 200, 300, 400',
    ],
  },
  {
    name: 'Outlier Mode',
    mode: 'outlier' as const,
    description: 'Outliers should be red, non-outliers grey',
    verification: [
      '70 outliers (10% of 700 samples) spread across dataset',
      'These samples should be red',
      'All other samples should be grey',
      'Outliers should be rendered on top (z-order)',
    ],
  },
];

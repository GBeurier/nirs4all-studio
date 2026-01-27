/**
 * Target Type Detection Utility
 *
 * Analyzes Y values to determine if the target is:
 * - regression: Continuous numeric values
 * - classification: Categorical/discrete labels
 * - ordinal: Ordered scale (1-5, 1-10)
 *
 * Edge cases handled:
 * - Binary 0/1 values (could be classification or percentage)
 * - Ordinal scales (rating 1-5, 1-10)
 * - String labels
 * - Low-cardinality numeric values
 */

// ============= Types =============

export type TargetType = 'regression' | 'classification' | 'ordinal';

export interface TargetTypeResult {
  /** Detected target type */
  type: TargetType;
  /** Confidence in the detection */
  confidence: 'high' | 'medium' | 'low';
  /** Class labels for classification/ordinal (sorted) */
  classLabels?: string[];
  /** Number of unique classes */
  classCount?: number;
  /** Hint for user about potential override */
  suggestedOverride?: string;
  /** Additional detection metadata */
  metadata?: {
    uniqueCount: number;
    isAllIntegers: boolean;
    range: { min: number; max: number } | null;
    hasStringValues: boolean;
  };
}

// ============= Detection Constants =============

/** Max unique values to consider as classification */
const CLASSIFICATION_MAX_UNIQUE = 20;

/** Ordinal detection: common rating scales */
const ORDINAL_MAX_VALUE = 10;

/** Ratio of unique values to total for continuous detection */
const CONTINUOUS_UNIQUENESS_THRESHOLD = 0.15;

// ============= Main Detection Function =============

/**
 * Detect target type from Y values
 *
 * @param yValues Array of target values (numbers or strings)
 * @returns Detection result with type, confidence, and optional class labels
 */
export function detectTargetType(yValues: (number | string | null | undefined)[]): TargetTypeResult {
  // Filter out null/undefined values
  const validValues = yValues.filter((v): v is number | string =>
    v !== null && v !== undefined
  );

  if (validValues.length === 0) {
    return {
      type: 'regression',
      confidence: 'low',
      suggestedOverride: 'No valid values found. Defaulting to regression.',
      metadata: {
        uniqueCount: 0,
        isAllIntegers: false,
        range: null,
        hasStringValues: false,
      },
    };
  }

  // Check for string values - definite classification
  const hasStrings = validValues.some(v => typeof v === 'string');
  if (hasStrings) {
    return detectStringClassification(validValues);
  }

  // All values are numeric
  const numericValues = validValues as number[];
  return detectNumericType(numericValues);
}

// ============= String Classification Detection =============

/** Common boolean-like value pairs */
const BOOLEAN_PAIRS: [string, string][] = [
  ['true', 'false'],
  ['yes', 'no'],
  ['y', 'n'],
  ['1', '0'],
  ['on', 'off'],
  ['positive', 'negative'],
  ['pass', 'fail'],
];

function detectStringClassification(values: (number | string)[]): TargetTypeResult {
  // Convert all to strings for consistency
  const stringValues = values.map(v => String(v));
  const uniqueValues = [...new Set(stringValues)].sort();
  const uniqueLower = uniqueValues.map(v => v.toLowerCase());

  // Check for boolean-like pairs
  if (uniqueValues.length === 2) {
    const isBooleanLike = BOOLEAN_PAIRS.some(
      ([a, b]) => uniqueLower.includes(a) && uniqueLower.includes(b)
    );

    if (isBooleanLike) {
      return {
        type: 'classification',
        confidence: 'high',
        classLabels: uniqueValues,
        classCount: 2,
        suggestedOverride: 'Binary classification detected (boolean-like values).',
        metadata: {
          uniqueCount: uniqueValues.length,
          isAllIntegers: false,
          range: null,
          hasStringValues: true,
        },
      };
    }
  }

  // Check if string values are actually numeric (e.g., "1", "2", "3")
  const numericStrings = uniqueValues.every(v => /^-?\d+(\.\d+)?$/.test(v));
  if (numericStrings && uniqueValues.length <= 10) {
    // Try to detect ordinal pattern from numeric strings
    const numericValues = uniqueValues.map(Number);
    const min = Math.min(...numericValues);
    const max = Math.max(...numericValues);

    if (min >= 0 && max <= 10 && numericValues.every(Number.isInteger)) {
      return {
        type: 'ordinal',
        confidence: 'high',
        classLabels: uniqueValues,
        classCount: uniqueValues.length,
        suggestedOverride: 'Numeric strings detected as ordinal scale.',
        metadata: {
          uniqueCount: uniqueValues.length,
          isAllIntegers: true,
          range: { min, max },
          hasStringValues: true,
        },
      };
    }
  }

  return {
    type: 'classification',
    confidence: 'high',
    classLabels: uniqueValues,
    classCount: uniqueValues.length,
    metadata: {
      uniqueCount: uniqueValues.length,
      isAllIntegers: false,
      range: null,
      hasStringValues: true,
    },
  };
}

// ============= Numeric Type Detection =============

function detectNumericType(values: number[]): TargetTypeResult {
  const uniqueValues = [...new Set(values)];
  const uniqueCount = uniqueValues.length;
  const sorted = [...uniqueValues].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  // Check if all integers
  const isAllIntegers = values.every(v => Number.isInteger(v));

  const baseMetadata = {
    uniqueCount,
    isAllIntegers,
    range: { min, max },
    hasStringValues: false,
  };

  // === Edge Case: Very small dataset (less than 10 samples) ===
  if (values.length < 10) {
    // With very few samples, detection is unreliable
    // Default to regression with low confidence unless clearly categorical
    if (uniqueCount === values.length && !isAllIntegers) {
      return {
        type: 'regression',
        confidence: 'low',
        suggestedOverride: 'Small dataset - detection may be unreliable. Use override if needed.',
        metadata: baseMetadata,
      };
    }
  }

  // === Edge Case: Percentage Detection (0-100 or 0-1 with decimals) ===
  const hasDecimals = values.some(v => !Number.isInteger(v));
  if (hasDecimals) {
    // Values 0-1 with decimals: likely probability/percentage
    if (min >= 0 && max <= 1 && uniqueCount > 5) {
      return {
        type: 'regression',
        confidence: 'high',
        suggestedOverride: 'Values appear to be probabilities (0-1 range).',
        metadata: baseMetadata,
      };
    }

    // Values 0-100 with decimals: likely percentage
    if (min >= 0 && max <= 100 && uniqueCount > 10) {
      return {
        type: 'regression',
        confidence: 'high',
        suggestedOverride: 'Values appear to be percentages (0-100 range).',
        metadata: baseMetadata,
      };
    }
  }

  // === Binary Detection (0/1) ===
  if (uniqueCount === 2) {
    const isBinary01 = sorted[0] === 0 && sorted[1] === 1;
    if (isBinary01) {
      return {
        type: 'classification',
        confidence: 'medium',
        classLabels: ['0', '1'],
        classCount: 2,
        suggestedOverride: 'Values are 0/1. Could be binary classification or probability. Override if this represents percentages.',
        metadata: baseMetadata,
      };
    }

    // Other binary values
    return {
      type: 'classification',
      confidence: 'high',
      classLabels: sorted.map(String),
      classCount: 2,
      metadata: baseMetadata,
    };
  }

  // === Ordinal Detection ===
  // Common patterns: 1-5, 1-10, 0-4, 0-10
  if (isAllIntegers && min >= 0 && max <= ORDINAL_MAX_VALUE) {
    const isLikelyOrdinal = uniqueCount <= max - min + 1;

    if (isLikelyOrdinal && uniqueCount >= 3 && uniqueCount <= 11) {
      // Check if values form a contiguous or near-contiguous sequence
      const expectedCount = max - min + 1;
      const coverage = uniqueCount / expectedCount;

      if (coverage >= 0.6) {
        return {
          type: 'ordinal',
          confidence: coverage >= 0.8 ? 'high' : 'medium',
          classLabels: sorted.map(String),
          classCount: uniqueCount,
          suggestedOverride: uniqueCount <= 5
            ? 'Values appear to be a rating scale (ordinal).'
            : 'Values might be an ordinal scale. Override if continuous.',
          metadata: baseMetadata,
        };
      }
    }
  }

  // === Low Cardinality Classification ===
  if (uniqueCount <= CLASSIFICATION_MAX_UNIQUE) {
    // Calculate uniqueness ratio
    const uniquenessRatio = uniqueCount / values.length;

    // Very low uniqueness suggests classification, BUT only if values look like class labels
    // Continuous regression data with repeated values should NOT be classified as multiclass
    if (uniquenessRatio < CONTINUOUS_UNIQUENESS_THRESHOLD) {
      // Check if values have meaningful decimal parts (sign of continuous data)
      // A value is considered to have a meaningful decimal if the fractional part
      // is not just floating point noise (> 0.001) and not a clean .0 or .5
      const hasSignificantDecimals = values.some(v => {
        const fractional = Math.abs(v % 1);
        return fractional > 0.001 && fractional < 0.999 && Math.abs(fractional - 0.5) > 0.001;
      });

      // If values have significant decimals, they're likely continuous regression data
      // even if there are few unique values (could be rounded or have repeated measurements)
      if (hasSignificantDecimals) {
        return {
          type: 'regression',
          confidence: 'medium',
          suggestedOverride: `Low uniqueness ratio (${(uniquenessRatio * 100).toFixed(0)}%) but values have decimals. Override to classification if these are class probabilities.`,
          metadata: baseMetadata,
        };
      }

      // Check if the value range suggests continuous data (e.g., values spanning > 10)
      // Class labels typically don't span large numeric ranges
      const range = max - min;
      if (range > 10 && !isAllIntegers) {
        return {
          type: 'regression',
          confidence: 'medium',
          suggestedOverride: `Wide value range (${min.toFixed(1)}-${max.toFixed(1)}) suggests continuous data despite low uniqueness.`,
          metadata: baseMetadata,
        };
      }

      const confidence = uniqueCount <= 5 ? 'high' : uniqueCount <= 10 ? 'medium' : 'low';

      return {
        type: 'classification',
        confidence,
        classLabels: sorted.map(String),
        classCount: uniqueCount,
        suggestedOverride: uniqueCount > 10
          ? `${uniqueCount} unique values detected. Override if this is continuous data.`
          : undefined,
        metadata: baseMetadata,
      };
    }
  }

  // === Regression (default) ===
  return {
    type: 'regression',
    confidence: uniqueCount > 50 ? 'high' : 'medium',
    metadata: baseMetadata,
  };
}

// ============= Utility Functions =============

/**
 * Check if target type is categorical (classification or ordinal)
 */
export function isCategoricalTarget(type: TargetType): boolean {
  return type === 'classification' || type === 'ordinal';
}

/**
 * Get appropriate color mode suggestion based on target type
 */
export function suggestColorMode(type: TargetType): 'target' | 'fold' {
  // For classification/ordinal, categorical coloring works better
  // But we still use 'target' mode which will use class-based coloring
  return 'target';
}

/**
 * Format class label for display
 */
export function formatClassLabel(label: string, index: number): string {
  // Check if label is just a number
  if (/^\d+$/.test(label)) {
    return `Class ${label}`;
  }
  return label;
}

/**
 * Get class index from Y value
 */
export function getClassIndex(
  yValue: number | string | null | undefined,
  classLabels: string[]
): number {
  if (yValue === null || yValue === undefined) return -1;
  const strValue = String(yValue);
  return classLabels.indexOf(strValue);
}

/**
 * Create a map of class labels to indices for efficient lookup
 */
export function createClassLabelMap(classLabels: string[]): Map<string, number> {
  return new Map(classLabels.map((label, idx) => [label, idx]));
}

import { type TargetType } from './targetTypeDetection';
import {
  type CategoricalPalette,
  type ContinuousPalette,
  getCategoricalColor,
  getContinuousColor,
  getContinuousColorForValue,
  getFiniteNumberDomain,
} from './colorConfigPalettes';
import {
  getHeldOutTestColor,
  getPartitionRoleColor,
  getSamplePartitionRole,
  isHeldOutTestSample,
} from './colorConfigPartitions';

export type BaseColorMode =
  | 'target'
  | 'partition'
  | 'fold'
  | 'metadata'
  | 'selection'
  | 'outlier'
  | 'index';

export interface BaseColorConfig {
  mode: BaseColorMode;
  metadataKey?: string;
  metadataType?: 'categorical' | 'continuous';
  continuousPalette: ContinuousPalette;
  categoricalPalette: CategoricalPalette;
  targetTypeOverride?: TargetType | 'auto';
}

export interface BaseColorContext {
  y?: number[];
  yMin?: number;
  yMax?: number;
  trainIndices?: Set<number>;
  testIndices?: Set<number>;
  foldLabels?: number[];
  foldKind?: 'test_split' | 'cv_folds';
  foldCount?: number;
  metadata?: Record<string, unknown[]>;
  outlierIndices?: Set<number>;
  totalSamples?: number;
  targetType?: TargetType;
  classLabels?: string[];
  classLabelMap?: Map<string, number>;
}

/**
 * Fixed colors for selection/outlier modes.
 * NOTE: Some of these use CSS variables which work in SVG/CSS but not in WebGL/canvas.
 */
export const HIGHLIGHT_COLORS = {
  selected: 'hsl(var(--primary))',
  hovered: 'hsl(var(--primary))',
  pinned: 'hsl(45, 90%, 50%)',
  outlier: 'hsl(0, 70%, 55%)',
  unselected: 'hsl(var(--muted-foreground))',
  muted: 'hsl(var(--muted-foreground) / 0.3)',
} as const;

/**
 * Concrete color alternatives for WebGL/canvas renderers that cannot parse CSS variables.
 */
export const HIGHLIGHT_COLORS_CONCRETE = {
  selected: 'hsl(173, 80%, 45%)',
  hovered: 'hsl(173, 80%, 45%)',
  pinned: 'hsl(45, 90%, 50%)',
  outlier: 'hsl(0, 70%, 55%)',
  unselected: 'hsl(220, 10%, 50%)',
  muted: 'hsl(220, 10%, 50%, 0.3)',
} as const;

/**
 * Get the effective target type considering manual override.
 */
export function getEffectiveTargetType(
  detectedType: TargetType | undefined,
  override: TargetType | 'auto' | undefined
): TargetType | undefined {
  if (override && override !== 'auto') {
    return override;
  }
  return detectedType;
}

/**
 * Determine if a mode uses continuous or categorical coloring.
 */
export function isContinuousMode(
  mode: BaseColorMode,
  metadataType?: 'categorical' | 'continuous',
  targetType?: TargetType,
  targetTypeOverride?: TargetType | 'auto'
): boolean {
  if (mode === 'target') {
    const effectiveType = getEffectiveTargetType(targetType, targetTypeOverride);
    if (effectiveType === 'classification' || effectiveType === 'ordinal') {
      return false;
    }
    return true;
  }
  if (mode === 'index') return true;
  if (mode === 'metadata' && metadataType === 'continuous') return true;
  return false;
}

/**
 * Auto-detect if a metadata column is categorical or continuous.
 */
export function detectMetadataType(values: unknown[]): 'categorical' | 'continuous' {
  if (values.length === 0) return 'categorical';

  const nonNullValues = values.filter(v => v !== null && v !== undefined);
  const allNumeric = nonNullValues.every(v => typeof v === 'number' && Number.isFinite(v));

  if (!allNumeric) return 'categorical';

  const uniqueValues = new Set(nonNullValues);
  const uniqueRatio = uniqueValues.size / nonNullValues.length;

  return uniqueRatio > 0.2 && uniqueValues.size > 10 ? 'continuous' : 'categorical';
}

/**
 * Get all unique categorical labels for a metadata column while preserving data order.
 */
export function getMetadataUniqueCategories(values: unknown[]): string[] {
  return [...new Set(
    values
      .filter(v => v !== null && v !== undefined)
      .map(v => String(v))
  )];
}

/**
 * Get base color for a sample without selection, hover, pinned, or display-filter overlays.
 */
export function getBaseColor(
  sampleIndex: number,
  config: BaseColorConfig,
  context: BaseColorContext
): string {
  const {
    y, yMin, yMax, foldLabels, metadata, outlierIndices,
  } = context;

  switch (config.mode) {
    case 'target': {
      if (!y || yMin === undefined || yMax === undefined) {
        return HIGHLIGHT_COLORS.unselected;
      }

      const { targetType: detectedType, classLabels, classLabelMap } = context;
      const effectiveTargetType = getEffectiveTargetType(detectedType, config.targetTypeOverride);

      if (effectiveTargetType === 'classification' || effectiveTargetType === 'ordinal') {
        if (classLabels && classLabels.length > 0) {
          const yValue = y[sampleIndex];
          const classIdx = classLabelMap
            ? classLabelMap.get(String(yValue)) ?? -1
            : classLabels.indexOf(String(yValue));
          if (classIdx >= 0) {
            return getCategoricalColor(classIdx, config.categoricalPalette);
          }
        }
        return HIGHLIGHT_COLORS.unselected;
      }

      return getContinuousColorForValue(y[sampleIndex], yMin, yMax, config.continuousPalette)
        ?? HIGHLIGHT_COLORS.unselected;
    }

    case 'partition': {
      const role = getSamplePartitionRole(sampleIndex, context);
      if (role !== 'unknown') {
        return getPartitionRoleColor(role);
      }
      return HIGHLIGHT_COLORS.unselected;
    }

    case 'fold': {
      const foldLabel = foldLabels?.[sampleIndex];
      if (foldLabel !== undefined && foldLabel >= 0) {
        return getCategoricalColor(foldLabel, config.categoricalPalette);
      }
      if (isHeldOutTestSample(sampleIndex, context)) {
        return getHeldOutTestColor();
      }
      return HIGHLIGHT_COLORS.unselected;
    }

    case 'metadata': {
      if (!metadata || !config.metadataKey) {
        return HIGHLIGHT_COLORS.unselected;
      }
      const values = metadata[config.metadataKey];
      const value = values?.[sampleIndex];
      if (value === undefined || value === null) {
        return HIGHLIGHT_COLORS.unselected;
      }

      const metadataType = config.metadataType ?? detectMetadataType(values);

      if (metadataType === 'continuous' && typeof value === 'number') {
        const domain = getFiniteNumberDomain(values);
        if (!domain) {
          return HIGHLIGHT_COLORS.unselected;
        }
        return getContinuousColorForValue(value, domain.min, domain.max, config.continuousPalette)
          ?? HIGHLIGHT_COLORS.unselected;
      }

      const uniqueValues = getMetadataUniqueCategories(values);
      const idx = uniqueValues.indexOf(String(value));
      return getCategoricalColor(idx >= 0 ? idx : 0, config.categoricalPalette);
    }

    case 'selection':
      return HIGHLIGHT_COLORS.unselected;

    case 'outlier': {
      const isOutlier = outlierIndices?.has(sampleIndex) ?? false;
      return isOutlier ? HIGHLIGHT_COLORS.outlier : HIGHLIGHT_COLORS.unselected;
    }

    case 'index': {
      const totalSamples = context.totalSamples ?? (y?.length || 1);
      const t = sampleIndex / Math.max(1, totalSamples - 1);
      return getContinuousColor(t, config.continuousPalette);
    }

    default:
      return HIGHLIGHT_COLORS.unselected;
  }
}

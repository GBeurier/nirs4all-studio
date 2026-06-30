import {
  type CategoricalPalette,
  getCategoricalColor,
} from './colorConfigPalettes';
import { adjustColorVariant } from './colorConfigVariants';

/**
 * Fixed colors for train/test partition
 */
export const PARTITION_COLORS = {
  train: 'hsl(217, 70%, 50%)',      // Blue
  val: 'hsl(38, 92%, 50%)',         // Orange
  test: 'hsl(355, 72%, 42%)',       // Crimson
  trainLight: 'hsl(217, 70%, 75%)',
  valLight: 'hsl(38, 92%, 75%)',
  testLight: 'hsl(355, 72%, 67%)',
} as const;

export type PartitionRole = 'train' | 'val' | 'test' | 'unknown';

export interface PartitionColorContext {
  trainIndices?: Set<number>;
  testIndices?: Set<number>;
  foldLabels?: number[];
  foldKind?: 'test_split' | 'cv_folds';
  foldCount?: number;
}

const PARTITION_ROLE_ORDER: readonly Exclude<PartitionRole, 'unknown'>[] = ['train', 'val', 'test'];

export function getPartitionFoldVariantColor(
  foldIndex: number,
  palette: CategoricalPalette = 'default'
): string {
  return adjustColorVariant(getCategoricalColor(foldIndex, palette), {
    saturationDelta: -18,
    lightnessDelta: 14,
  });
}

export function getHeldOutTestColor(): string {
  return PARTITION_COLORS.test;
}

export function hasValidationSamples(
  context: Pick<PartitionColorContext, 'foldKind' | 'foldCount' | 'foldLabels'>
): boolean {
  if (context.foldKind === 'test_split') return false;
  if (context.foldLabels?.some(label => label >= 0)) {
    return true;
  }
  return (context.foldCount ?? 0) > 1;
}

export function usesFoldPartitionVariants(
  context: Pick<PartitionColorContext, 'foldKind' | 'foldCount' | 'foldLabels'>
): boolean {
  return hasValidationSamples(context);
}

export function isHeldOutTestSample(
  sampleIndex: number,
  context: Pick<PartitionColorContext, 'testIndices' | 'foldKind' | 'foldCount' | 'foldLabels'>
): boolean {
  if (!context.testIndices?.has(sampleIndex)) {
    return false;
  }
  if (context.foldKind !== 'test_split' && (context.foldCount ?? 0) > 1) {
    const foldLabel = context.foldLabels?.[sampleIndex];
    return foldLabel === undefined || foldLabel < 0;
  }
  return true;
}

export function isValidationSample(
  sampleIndex: number,
  context: Pick<PartitionColorContext, 'foldKind' | 'foldCount' | 'foldLabels'>
): boolean {
  if (!hasValidationSamples(context)) {
    return false;
  }
  const foldLabel = context.foldLabels?.[sampleIndex];
  return foldLabel !== undefined && foldLabel >= 0;
}

export function getSamplePartitionRole(
  sampleIndex: number,
  context: PartitionColorContext
): PartitionRole {
  if (isHeldOutTestSample(sampleIndex, context)) {
    return 'test';
  }
  if (isValidationSample(sampleIndex, context)) {
    return 'val';
  }
  if (context.trainIndices?.has(sampleIndex)) {
    return 'train';
  }
  if (context.testIndices?.has(sampleIndex)) {
    return 'test';
  }
  return 'unknown';
}

export function getPartitionRoleColor(role: Exclude<PartitionRole, 'unknown'>): string {
  switch (role) {
    case 'train':
      return PARTITION_COLORS.train;
    case 'val':
      return PARTITION_COLORS.val;
    case 'test':
      return PARTITION_COLORS.test;
  }
}

export function getPartitionRoleLabel(role: Exclude<PartitionRole, 'unknown'>): string {
  switch (role) {
    case 'train':
      return 'Train';
    case 'val':
      return 'Val';
    case 'test':
      return 'Test';
  }
}

export function getPresentPartitionRoles(
  context: PartitionColorContext
): Exclude<PartitionRole, 'unknown'>[] {
  const sampleIndices = new Set<number>();
  context.trainIndices?.forEach(sampleIndex => sampleIndices.add(sampleIndex));
  context.testIndices?.forEach(sampleIndex => sampleIndices.add(sampleIndex));
  context.foldLabels?.forEach((_, sampleIndex) => sampleIndices.add(sampleIndex));

  const roles = new Set<Exclude<PartitionRole, 'unknown'>>();
  for (const sampleIndex of sampleIndices) {
    const role = getSamplePartitionRole(sampleIndex, context);
    if (role !== 'unknown') {
      roles.add(role);
    }
  }

  return PARTITION_ROLE_ORDER.filter(role => roles.has(role));
}

export function hasHeldOutTestSamples(
  context: Pick<PartitionColorContext, 'testIndices' | 'foldKind' | 'foldCount' | 'foldLabels'>
): boolean {
  if (!context.testIndices || context.testIndices.size === 0) {
    return false;
  }
  if (context.foldKind !== 'test_split' && (context.foldCount ?? 0) > 1) {
    for (const sampleIndex of context.testIndices) {
      if (isHeldOutTestSample(sampleIndex, context)) {
        return true;
      }
    }
    return false;
  }
  return true;
}

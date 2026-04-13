import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GLOBAL_COLOR_CONFIG,
  PARTITION_COLORS,
  getBaseColor,
  getCategoricalColor,
  getHeldOutTestColor,
  getMetadataUniqueCategories,
  getPresentPartitionRoles,
  getSamplePartitionRole,
  getUnifiedSampleColor,
  type ColorContext,
} from '../colorConfig';

describe('colorConfig fold and partition semantics', () => {
  const mixedContext: ColorContext = {
    foldKind: 'cv_folds',
    foldCount: 3,
    foldLabels: [0, 1, -1],
    trainIndices: new Set([0, 1]),
    testIndices: new Set([2]),
  };

  it('uses explicit val and test colors when CV folds and held-out test coexist', () => {
    const config = {
      ...DEFAULT_GLOBAL_COLOR_CONFIG,
      mode: 'partition' as const,
      categoricalPalette: 'default' as const,
    };

    expect(getBaseColor(0, config, mixedContext)).toBe(PARTITION_COLORS.val);
    expect(getBaseColor(1, config, mixedContext)).toBe(PARTITION_COLORS.val);
    expect(getBaseColor(2, config, mixedContext)).toBe(PARTITION_COLORS.test);
  });

  it('keeps held-out test samples visible in fold mode', () => {
    const config = {
      ...DEFAULT_GLOBAL_COLOR_CONFIG,
      mode: 'fold' as const,
      categoricalPalette: 'default' as const,
    };

    expect(getBaseColor(0, config, mixedContext)).toBe(getCategoricalColor(0, 'default'));
    expect(getBaseColor(2, config, mixedContext)).toBe(getHeldOutTestColor());
  });

  it('shows a visible selected state for held-out test samples in fold mode', () => {
    const config = {
      ...DEFAULT_GLOBAL_COLOR_CONFIG,
      mode: 'fold' as const,
      categoricalPalette: 'default' as const,
    };

    const selected = getUnifiedSampleColor(2, config, {
      ...mixedContext,
      selectedSamples: new Set([2]),
    });

    expect(selected.color).toBe(getHeldOutTestColor());
    expect(selected.opacity).toBe(1);
    expect(selected.stroke).toBe('hsl(var(--foreground))');
    expect(selected.strokeWidth).toBe(2);
  });

  it('keeps simple test_split partition coloring as train vs test', () => {
    const config = {
      ...DEFAULT_GLOBAL_COLOR_CONFIG,
      mode: 'partition' as const,
      categoricalPalette: 'default' as const,
    };

    const context: ColorContext = {
      foldKind: 'test_split',
      foldCount: 1,
      foldLabels: [-1, -1, 0],
      trainIndices: new Set([0, 1]),
      testIndices: new Set([2]),
    };

    expect(getBaseColor(0, config, context)).toBe(PARTITION_COLORS.train);
    expect(getBaseColor(2, config, context)).toBe(PARTITION_COLORS.test);
  });

  it('reports the correct partition role per sample', () => {
    const context: ColorContext = {
      foldKind: 'cv_folds',
      foldCount: 2,
      foldLabels: [-1, 0, -1],
      trainIndices: new Set([0, 1]),
      testIndices: new Set([2]),
    };

    expect(getSamplePartitionRole(0, context)).toBe('train');
    expect(getSamplePartitionRole(1, context)).toBe('val');
    expect(getSamplePartitionRole(2, context)).toBe('test');
    expect(getPresentPartitionRoles(context)).toEqual(['train', 'val', 'test']);
  });

  it('preserves metadata category order for categorical color mapping', () => {
    const config = {
      ...DEFAULT_GLOBAL_COLOR_CONFIG,
      mode: 'metadata' as const,
      metadataKey: 'partition',
      categoricalPalette: 'default' as const,
    };

    const context: ColorContext = {
      metadata: {
        partition: ['train', 'test', 'train', null, undefined],
      },
    };

    expect(getMetadataUniqueCategories(context.metadata!.partition)).toEqual(['train', 'test']);
    expect(getBaseColor(0, config, context)).toBe(getCategoricalColor(0, 'default'));
    expect(getBaseColor(1, config, context)).toBe(getCategoricalColor(1, 'default'));
  });
});

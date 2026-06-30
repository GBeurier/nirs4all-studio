import { describe, expect, it } from 'vitest';

import { PARTITION_COLORS } from '@/lib/playground/colorConfig';
import {
  getFoldDistributionLightColor,
  getFoldDistributionPartitionBarColor,
  getFoldDistributionSegmentColor,
  getFoldDistributionSegmentLabel,
  type FoldDistributionPartitionPalette,
} from '@/lib/playground/foldDistributionPresentation';
import type { PartitionBarData } from '@/lib/playground/foldDistributionData';

const palette: FoldDistributionPartitionPalette = {
  train: PARTITION_COLORS.train,
  trainLight: PARTITION_COLORS.trainLight,
  val: PARTITION_COLORS.val,
  valLight: PARTITION_COLORS.valLight,
  heldOutTest: PARTITION_COLORS.test,
  heldOutTestLight: 'hsl(355, 52%, 62%)',
};

const trainBar: Pick<PartitionBarData, 'partitionType' | 'foldIndex'> = {
  partitionType: 'train',
  foldIndex: 0,
};

const heldOutBar: Pick<PartitionBarData, 'partitionType' | 'foldIndex'> = {
  partitionType: 'test',
  foldIndex: null,
};

describe('foldDistributionPresentation', () => {
  it('builds the legacy light HSL variant and falls back for non-HSL colors', () => {
    expect(getFoldDistributionLightColor('hsl(355, 72%, 42%)')).toBe('hsl(355, 52%, 62%)');
    expect(getFoldDistributionLightColor('#ff0000')).toBe('#ff0000');
  });

  it('resolves partition bar colors from the active partition palette', () => {
    expect(getFoldDistributionPartitionBarColor(trainBar, true, palette)).toBe(PARTITION_COLORS.train);
    expect(getFoldDistributionPartitionBarColor(trainBar, false, palette)).toBe(PARTITION_COLORS.trainLight);
    expect(getFoldDistributionPartitionBarColor(heldOutBar, true, palette)).toBe(PARTITION_COLORS.test);
    expect(getFoldDistributionPartitionBarColor(heldOutBar, false, palette)).toBe('hsl(355, 52%, 62%)');
  });

  it('resolves segment colors by color mode', () => {
    const baseInput = {
      selectedFold: null,
      continuousPalette: 'blue_red' as const,
      categoricalPalette: 'default' as const,
      yBins: [{ min: 0, max: 5 }, { min: 5, max: 10 }],
      partitionPalette: palette,
    };

    expect(getFoldDistributionSegmentColor('total', trainBar, {
      ...baseInput,
      colorMode: 'partition',
    })).toBe(PARTITION_COLORS.train);
    expect(getFoldDistributionSegmentColor('class_1', trainBar, {
      ...baseInput,
      colorMode: 'target',
    })).toMatch(/^hsl\(/);
    expect(getFoldDistributionSegmentColor('bin_1', trainBar, {
      ...baseInput,
      colorMode: 'target',
    })).toBe('hsl(0, 70%, 50%)');
    expect(getFoldDistributionSegmentColor('total', heldOutBar, {
      ...baseInput,
      colorMode: 'fold',
    })).toBe(PARTITION_COLORS.test);
    expect(getFoldDistributionSegmentColor('outlier', trainBar, {
      ...baseInput,
      colorMode: 'outlier',
    })).toBe('hsl(0, 70%, 55%)');
    expect(getFoldDistributionSegmentColor('selected', trainBar, {
      ...baseInput,
      colorMode: 'selection',
    })).toBe('hsl(var(--primary))');
    expect(getFoldDistributionSegmentColor('other', trainBar, {
      ...baseInput,
      colorMode: 'metadata',
    })).toBe('hsl(var(--muted-foreground) / 0.5)');
  });

  it('resolves segment labels by color mode', () => {
    const baseInput = {
      yBins: [{ min: 0, max: 5 }, { min: 5, max: 10 }],
      classLabels: ['dry', 'wet'],
      metadataCategories: ['batch-a'],
    };

    expect(getFoldDistributionSegmentLabel('class_1', {
      ...baseInput,
      colorMode: 'target',
    })).toBe('wet');
    expect(getFoldDistributionSegmentLabel('bin_0', {
      ...baseInput,
      colorMode: 'target',
    })).toBe('0.00 - 5.00');
    expect(getFoldDistributionSegmentLabel('bin_3', {
      ...baseInput,
      colorMode: 'target',
    })).toBe('Bin 4');
    expect(getFoldDistributionSegmentLabel('meta_0', {
      ...baseInput,
      colorMode: 'metadata',
    })).toBe('batch-a');
    expect(getFoldDistributionSegmentLabel('normal', {
      ...baseInput,
      colorMode: 'outlier',
    })).toBe('Normal');
    expect(getFoldDistributionSegmentLabel('selected', {
      ...baseInput,
      colorMode: 'selection',
    })).toBe('Selected');
  });
});

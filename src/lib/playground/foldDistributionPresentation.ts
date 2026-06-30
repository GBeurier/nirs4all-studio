import {
  getCategoricalColor,
  getContinuousColor,
  HIGHLIGHT_COLORS,
  type CategoricalPalette,
  type ContinuousPalette,
  type GlobalColorMode,
} from '@/lib/playground/colorConfig';
import type { FoldDistributionYBin, PartitionBarData } from '@/lib/playground/foldDistributionData';

export interface FoldDistributionPartitionPalette {
  train: string;
  trainLight: string;
  val: string;
  valLight: string;
  heldOutTest: string;
  heldOutTestLight: string;
}

export interface FoldDistributionSegmentColorInput {
  colorMode: GlobalColorMode;
  selectedFold: number | null;
  continuousPalette: ContinuousPalette;
  categoricalPalette: CategoricalPalette;
  yBins: FoldDistributionYBin[];
  partitionPalette: FoldDistributionPartitionPalette;
}

export interface FoldDistributionSegmentLabelInput {
  colorMode: GlobalColorMode;
  yBins: FoldDistributionYBin[];
  classLabels: string[];
  metadataCategories: unknown[];
}

export function getFoldDistributionLightColor(color: string): string {
  const match = color.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
  if (!match) return color;

  const [, h, s, l] = match;
  return `hsl(${h}, ${Math.max(0, parseInt(s, 10) - 20)}%, ${Math.min(100, parseInt(l, 10) + 20)}%)`;
}

export function getFoldDistributionPartitionBarColor(
  entry: Pick<PartitionBarData, 'partitionType'>,
  isHighlighted: boolean,
  palette: FoldDistributionPartitionPalette,
): string {
  switch (entry.partitionType) {
    case 'train':
      return isHighlighted ? palette.train : palette.trainLight;
    case 'val':
      return isHighlighted ? palette.val : palette.valLight;
    case 'test':
      return isHighlighted ? palette.heldOutTest : palette.heldOutTestLight;
    default:
      return 'hsl(var(--primary))';
  }
}

export function getFoldDistributionSegmentColor(
  segmentKey: string,
  entry: Pick<PartitionBarData, 'foldIndex' | 'partitionType'>,
  {
    colorMode,
    selectedFold,
    continuousPalette,
    categoricalPalette,
    yBins,
    partitionPalette,
  }: FoldDistributionSegmentColorInput,
): string {
  switch (colorMode) {
    case 'partition':
      return getFoldDistributionPartitionBarColor(
        entry,
        selectedFold === entry.foldIndex || selectedFold === null,
        partitionPalette,
      );

    case 'target': {
      if (segmentKey.startsWith('class_')) {
        const classIdx = parseInt(segmentKey.replace('class_', ''), 10);
        return getCategoricalColor(classIdx, categoricalPalette);
      }

      const binIdx = parseInt(segmentKey.replace('bin_', ''), 10);
      const t = yBins.length > 1 ? binIdx / (yBins.length - 1) : 0.5;
      return getContinuousColor(t, continuousPalette);
    }

    case 'fold':
      if (entry.foldIndex !== null) {
        return getCategoricalColor(entry.foldIndex, categoricalPalette);
      }
      return entry.partitionType === 'test' ? partitionPalette.heldOutTest : 'hsl(var(--muted-foreground))';

    case 'outlier':
      return segmentKey === 'outlier' ? HIGHLIGHT_COLORS.outlier : 'hsl(var(--muted-foreground))';

    case 'selection':
      return segmentKey === 'selected' ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground) / 0.4)';

    case 'metadata': {
      if (segmentKey === 'other') {
        return 'hsl(var(--muted-foreground) / 0.5)';
      }
      const metaIdx = parseInt(segmentKey.replace('meta_', ''), 10);
      return getCategoricalColor(metaIdx, categoricalPalette);
    }

    default:
      return getFoldDistributionPartitionBarColor(entry, true, partitionPalette);
  }
}

export function getFoldDistributionSegmentLabel(
  segmentKey: string,
  {
    colorMode,
    yBins,
    classLabels,
    metadataCategories,
  }: FoldDistributionSegmentLabelInput,
): string {
  switch (colorMode) {
    case 'partition':
      return segmentKey === 'train' ? 'Train' : 'Test';

    case 'target': {
      if (segmentKey.startsWith('class_')) {
        const classIdx = parseInt(segmentKey.replace('class_', ''), 10);
        return classLabels[classIdx] ?? `Class ${classIdx + 1}`;
      }

      const binIdx = parseInt(segmentKey.replace('bin_', ''), 10);
      const bin = yBins[binIdx];
      if (!bin) return `Bin ${binIdx + 1}`;

      const formatVal = (value: number): string => value.toFixed(value < 10 ? 2 : 1);
      return `${formatVal(bin.min)} - ${formatVal(bin.max)}`;
    }

    case 'fold':
      return 'Samples';

    case 'outlier':
      return segmentKey === 'outlier' ? 'Outliers' : 'Normal';

    case 'selection':
      return segmentKey === 'selected' ? 'Selected' : 'Unselected';

    case 'metadata': {
      if (segmentKey === 'other') return 'Other';
      const metaIdx = parseInt(segmentKey.replace('meta_', ''), 10);
      return String(metadataCategories[metaIdx] ?? `Category ${metaIdx + 1}`);
    }

    default:
      return segmentKey;
  }
}

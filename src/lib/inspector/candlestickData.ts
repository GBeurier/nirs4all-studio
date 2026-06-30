import { INSPECTOR_GROUP_COLORS } from '@/types/inspector';
import type { CandlestickCategory, CandlestickResponse } from '@/types/inspector';

export interface CandlestickData {
  categories: CandlestickCategory[];
  yMin: number;
  yMax: number;
}

export interface CandlestickLayout {
  marginLeft: number;
  marginRight: number;
  marginTop: number;
  marginBottom: number;
  plotW: number;
  plotH: number;
  yRange: number;
  categoryWidth: number;
  boxWidth: number;
}

export interface CandlestickCategoryGeometry {
  cx: number;
  yQ25: number;
  yQ75: number;
  yMedian: number;
  yMin: number;
  yMax: number;
  capX1: number;
  capX2: number;
  boxX: number;
  boxY: number;
  boxHeight: number;
  medianX1: number;
  medianX2: number;
  labelX: number;
  labelY: number;
  labelTransform: string;
}

export interface CandlestickOutlierPoint {
  value: number;
  cx: number;
  cy: number;
}

export function buildCandlestickData(
  data: CandlestickResponse | null | undefined,
): CandlestickData {
  if (!data?.categories?.length) return { yMin: 0, yMax: 1, categories: [] };
  let min = Infinity;
  let max = -Infinity;
  for (const category of data.categories) {
    if (category.min < min) min = category.min;
    if (category.max > max) max = category.max;
    for (const outlier of category.outlier_values) {
      if (outlier < min) min = outlier;
      if (outlier > max) max = outlier;
    }
  }
  const range = max - min || 1;
  return {
    yMin: min - range * 0.05,
    yMax: max + range * 0.05,
    categories: data.categories,
  };
}

export function buildCandlestickLayout({
  width,
  height,
  categoryCount,
  yMin,
  yMax,
}: {
  width: number;
  height: number;
  categoryCount: number;
  yMin: number;
  yMax: number;
}): CandlestickLayout {
  const marginLeft = 55;
  const marginRight = 15;
  const marginTop = 15;
  const marginBottom = 80;
  const plotW = width - marginLeft - marginRight;
  const plotH = height - marginTop - marginBottom;
  const yRange = yMax - yMin || 1;
  const categoryWidth = plotW / Math.max(categoryCount, 1);
  return {
    marginLeft,
    marginRight,
    marginTop,
    marginBottom,
    plotW,
    plotH,
    yRange,
    categoryWidth,
    boxWidth: Math.min(categoryWidth * 0.6, 50),
  };
}

export function scaleCandlestickY(
  value: number,
  yMin: number,
  layout: CandlestickLayout,
): number {
  return layout.marginTop + layout.plotH - ((value - yMin) / layout.yRange) * layout.plotH;
}

export function buildCandlestickTicks(
  yMin: number,
  yRange: number,
  count = 5,
): number[] {
  const ticks: number[] = [];
  for (let index = 0; index <= count; index++) {
    ticks.push(yMin + (yRange * index) / count);
  }
  return ticks;
}

export function getCandlestickColor(index: number): string {
  return INSPECTOR_GROUP_COLORS[index % INSPECTOR_GROUP_COLORS.length];
}

export function getCandlestickCategoryGeometry({
  category,
  categoryIndex,
  yMin,
  layout,
  height,
}: {
  category: Pick<CandlestickCategory, 'q25' | 'q75' | 'median' | 'min' | 'max'>;
  categoryIndex: number;
  yMin: number;
  layout: CandlestickLayout;
  height: number;
}): CandlestickCategoryGeometry {
  const cx = layout.marginLeft + categoryIndex * layout.categoryWidth + layout.categoryWidth / 2;
  const yQ25 = scaleCandlestickY(category.q25, yMin, layout);
  const yQ75 = scaleCandlestickY(category.q75, yMin, layout);
  const yMedian = scaleCandlestickY(category.median, yMin, layout);
  const categoryYMin = scaleCandlestickY(category.min, yMin, layout);
  const categoryYMax = scaleCandlestickY(category.max, yMin, layout);
  const labelY = height - layout.marginBottom + 10;

  return {
    cx,
    yQ25,
    yQ75,
    yMedian,
    yMin: categoryYMin,
    yMax: categoryYMax,
    capX1: cx - layout.boxWidth * 0.3,
    capX2: cx + layout.boxWidth * 0.3,
    boxX: cx - layout.boxWidth / 2,
    boxY: Math.min(yQ25, yQ75),
    boxHeight: Math.abs(yQ75 - yQ25),
    medianX1: cx - layout.boxWidth / 2,
    medianX2: cx + layout.boxWidth / 2,
    labelX: cx,
    labelY,
    labelTransform: `rotate(-40, ${cx}, ${labelY})`,
  };
}

export function buildCandlestickOutlierPoints({
  values,
  cx,
  yMin,
  layout,
}: {
  values: number[];
  cx: number;
  yMin: number;
  layout: CandlestickLayout;
}): CandlestickOutlierPoint[] {
  return values.map((value) => ({
    value,
    cx,
    cy: scaleCandlestickY(value, yMin, layout),
  }));
}

export function getCandlestickSelectableChainIds(
  category: Pick<CandlestickCategory, 'chain_ids'> | undefined,
): string[] {
  return category?.chain_ids ?? [];
}

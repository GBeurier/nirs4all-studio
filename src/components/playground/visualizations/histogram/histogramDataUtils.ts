import { formatYValue } from '../chartConfig';
import type { BinData, ClassBarData, YStats } from './types';

interface ComputeHistogramBinsInput {
  values: readonly number[];
  binCount: number;
  displayFilter?: ReadonlySet<number>;
  foldLabels?: readonly number[];
}

interface ComputeClassBarDataInput {
  values: readonly number[];
  classLabels?: readonly string[];
  classLabelMap?: ReadonlyMap<string, number>;
  displayFilter?: ReadonlySet<number>;
  foldLabels?: readonly number[];
}

export function computeHistogramBins({
  values,
  binCount,
  displayFilter,
  foldLabels = [],
}: ComputeHistogramBinsInput): { histogramData: BinData[]; sampleBins: number[] } {
  if (values.length === 0) {
    return { histogramData: [], sampleBins: [] };
  }

  const visibleValues = displayFilter
    ? values.filter((_, idx) => displayFilter.has(idx))
    : values;

  if (visibleValues.length === 0) {
    return { histogramData: [], sampleBins: [] };
  }

  const min = Math.min(...visibleValues);
  const max = Math.max(...visibleValues);
  const range = max - min;
  const binWidth = range / binCount || 1;

  const histogram: BinData[] = Array.from({ length: binCount }, (_, i) => ({
    binStart: min + i * binWidth,
    binEnd: min + (i + 1) * binWidth,
    binCenter: min + (i + 0.5) * binWidth,
    count: 0,
    samples: [],
    label: `${formatYValue(min + i * binWidth, 2)} - ${formatYValue(min + (i + 1) * binWidth, 2)}`,
    foldCounts: {},
    foldSamples: {},
  }));

  const sampleBins: number[] = [];

  values.forEach((value, idx) => {
    if (displayFilter && !displayFilter.has(idx)) {
      return;
    }

    let binIndex = Math.floor((value - min) / binWidth);
    if (binIndex >= binCount) binIndex = binCount - 1;
    if (binIndex < 0) binIndex = 0;

    histogram[binIndex].count++;
    histogram[binIndex].samples.push(idx);
    sampleBins[idx] = binIndex;

    const foldIdx = foldLabels[idx];
    if (foldIdx !== undefined && foldIdx >= 0) {
      histogram[binIndex].foldCounts![foldIdx] = (histogram[binIndex].foldCounts![foldIdx] || 0) + 1;
      if (!histogram[binIndex].foldSamples![foldIdx]) {
        histogram[binIndex].foldSamples![foldIdx] = [];
      }
      histogram[binIndex].foldSamples![foldIdx].push(idx);
    }
  });

  return { histogramData: histogram, sampleBins };
}

export function computeClassBarData({
  values,
  classLabels,
  classLabelMap,
  displayFilter,
  foldLabels = [],
}: ComputeClassBarDataInput): ClassBarData[] {
  if (!classLabels || classLabels.length === 0) return [];

  const classBars: ClassBarData[] = classLabels.map((label, idx) => ({
    classLabel: label,
    classIndex: idx,
    count: 0,
    samples: [],
    foldCounts: {},
    foldSamples: {},
  }));

  values.forEach((yVal, idx) => {
    if (displayFilter && !displayFilter.has(idx)) {
      return;
    }

    const classIdx = classLabelMap
      ? classLabelMap.get(String(yVal)) ?? -1
      : classLabels.indexOf(String(yVal));

    if (classIdx >= 0) {
      classBars[classIdx].count++;
      classBars[classIdx].samples.push(idx);

      const foldIdx = foldLabels[idx];
      if (foldIdx !== undefined && foldIdx >= 0) {
        classBars[classIdx].foldCounts![foldIdx] = (classBars[classIdx].foldCounts![foldIdx] || 0) + 1;
        if (!classBars[classIdx].foldSamples![foldIdx]) {
          classBars[classIdx].foldSamples![foldIdx] = [];
        }
        classBars[classIdx].foldSamples![foldIdx].push(idx);
      }
    }
  });

  return classBars;
}

export function mapSamplesToClasses(
  values: readonly number[],
  classLabels: readonly string[],
  classLabelMap?: ReadonlyMap<string, number>
): number[] {
  return values.map((yVal) =>
    classLabelMap
      ? classLabelMap.get(String(yVal)) ?? -1
      : classLabels.indexOf(String(yVal))
  );
}

export function computeYStats(values: readonly number[]): YStats | null {
  if (values.length === 0) return null;

  const n = values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const median = n % 2 === 0
    ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    : sorted[Math.floor(n / 2)];
  const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / n;
  const std = Math.sqrt(variance);
  const q1 = sorted[Math.floor(n * 0.25)];
  const q3 = sorted[Math.floor(n * 0.75)];

  return { mean, median, std, min: sorted[0], max: sorted[n - 1], n, q1, q3 };
}

export function computeSelectedYStats(
  values: readonly number[],
  selectedSamples: ReadonlySet<number>,
  displayFilter?: ReadonlySet<number>
): YStats | null {
  if (selectedSamples.size === 0) return null;

  return computeYStats(values.filter((_, idx) =>
    selectedSamples.has(idx) && (!displayFilter || displayFilter.has(idx))
  ));
}

export function getSelectedBins(
  selectedSamples: ReadonlySet<number>,
  sampleBins: readonly number[]
): Set<number> {
  const bins = new Set<number>();
  selectedSamples.forEach((idx) => {
    if (sampleBins[idx] !== undefined) {
      bins.add(sampleBins[idx]);
    }
  });
  return bins;
}

export function getHoveredBin(
  hoveredSample: number | null,
  sampleBins: readonly number[]
): number | null {
  return hoveredSample !== null && sampleBins[hoveredSample] !== undefined
    ? sampleBins[hoveredSample]
    : null;
}

export function getSelectedClasses(
  selectedSamples: ReadonlySet<number>,
  sampleToClass: readonly number[]
): Set<number> {
  const classes = new Set<number>();
  selectedSamples.forEach((idx) => {
    const classIdx = sampleToClass[idx];
    if (classIdx !== undefined && classIdx >= 0) {
      classes.add(classIdx);
    }
  });
  return classes;
}

export function getHoveredClass(
  hoveredSample: number | null,
  sampleToClass: readonly number[]
): number | null {
  if (hoveredSample === null) return null;
  const classIdx = sampleToClass[hoveredSample];
  return classIdx !== undefined && classIdx >= 0 ? classIdx : null;
}

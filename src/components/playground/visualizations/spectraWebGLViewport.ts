export interface SpectraWebGLRangeStats {
  min: number[];
  max: number[];
}

export interface ComputeEffectiveSpectraVisibleIndicesInput {
  visibleIndices?: number[];
  spectraCount: number;
  maxSamples: number;
  selectedIndices: Set<number>;
  pinnedIndices: Set<number>;
}

export interface ComputeSpectraWebGLRangesInput {
  spectra: number[][];
  originalSpectra?: number[][] | null;
  wavelengths: number[];
  visibleIndices: number[];
  propYRange?: [number, number];
  aggregatedStats?: SpectraWebGLRangeStats;
  groupedStats?: Map<string | number, SpectraWebGLRangeStats>;
}

export interface ShouldSyncSpectraXViewRangeInput {
  previousWavelengths: number[] | null;
  wavelengths: number[];
  xRange: [number, number];
  xViewRange: [number, number];
  userHasZoomed: boolean;
  hasInitialized: boolean;
}

export function computeEffectiveSpectraVisibleIndices({
  visibleIndices,
  spectraCount,
  maxSamples,
  selectedIndices,
  pinnedIndices,
}: ComputeEffectiveSpectraVisibleIndicesInput): number[] {
  let indices = visibleIndices ?? Array.from({ length: spectraCount }, (_, index) => index);

  if (maxSamples > 0 && indices.length > maxSamples) {
    const priorityIndices = new Set<number>();

    selectedIndices.forEach(index => {
      if (indices.includes(index)) priorityIndices.add(index);
    });
    pinnedIndices.forEach(index => {
      if (indices.includes(index)) priorityIndices.add(index);
    });

    const remaining = indices.filter(index => !priorityIndices.has(index));
    const sampleCount = Math.max(0, maxSamples - priorityIndices.size);
    const step = remaining.length / sampleCount;
    const sampledRemaining: number[] = [];

    for (let index = 0; index < sampleCount && index * step < remaining.length; index++) {
      sampledRemaining.push(remaining[Math.floor(index * step)]);
    }

    indices = [...priorityIndices, ...sampledRemaining];
  }

  return indices;
}

export function computeSpectraWebGLRanges({
  spectra,
  originalSpectra,
  wavelengths,
  visibleIndices,
  propYRange,
  aggregatedStats,
  groupedStats,
}: ComputeSpectraWebGLRangesInput): { xRange: [number, number]; yRange: [number, number] } {
  const xMin = wavelengths.length > 0 ? Math.min(...wavelengths) : 0;
  const xMax = wavelengths.length > 0 ? Math.max(...wavelengths) : 1;

  let yMin = Infinity;
  let yMax = -Infinity;

  if (aggregatedStats) {
    collectStatsRange(aggregatedStats, value => {
      yMin = Math.min(yMin, value.min);
      yMax = Math.max(yMax, value.max);
    });
  } else if (groupedStats) {
    groupedStats.forEach(stats => {
      collectStatsRange(stats, value => {
        yMin = Math.min(yMin, value.min);
        yMax = Math.max(yMax, value.max);
      });
    });
  } else {
    collectSpectraRange(spectra, visibleIndices, value => {
      yMin = Math.min(yMin, value);
      yMax = Math.max(yMax, value);
    });

    if (originalSpectra) {
      collectSpectraRange(originalSpectra, visibleIndices, value => {
        yMin = Math.min(yMin, value);
        yMax = Math.max(yMax, value);
      });
    }
  }

  if (propYRange) {
    yMin = propYRange[0];
    yMax = propYRange[1];
  }

  if (!isFinite(yMin) || !isFinite(yMax) || yMin >= yMax) {
    yMin = 0;
    yMax = 1;
  }

  const yPadding = (yMax - yMin) * 0.05;

  return {
    xRange: [xMin, xMax],
    yRange: [yMin - yPadding, yMax + yPadding],
  };
}

export function computeSpectraTargetValueRange(values?: number[]): { yMin: number; yMax: number } {
  if (!values || values.length === 0) return { yMin: 0, yMax: 1 };

  return {
    yMin: Math.min(...values),
    yMax: Math.max(...values),
  };
}

export function shouldSyncSpectraXViewRange({
  previousWavelengths,
  wavelengths,
  xRange,
  xViewRange,
  userHasZoomed,
  hasInitialized,
}: ShouldSyncSpectraXViewRangeInput): boolean {
  const hasWavelengthChange = !previousWavelengths ||
    previousWavelengths.length !== wavelengths.length ||
    Math.abs((previousWavelengths[0] ?? 0) - (wavelengths[0] ?? 0)) > 1 ||
    Math.abs((previousWavelengths[previousWavelengths.length - 1] ?? 0) - (wavelengths[wavelengths.length - 1] ?? 0)) > 1;

  const isXViewRangeInvalid = !isFinite(xViewRange[0]) || !isFinite(xViewRange[1]) || xViewRange[0] >= xViewRange[1];
  const isXRangeValid = isFinite(xRange[0]) && isFinite(xRange[1]) && xRange[0] < xRange[1];
  const needsInitialSync = !userHasZoomed && isXRangeValid &&
    (Math.abs(xViewRange[0] - xRange[0]) > 0.1 || Math.abs(xViewRange[1] - xRange[1]) > 0.1);
  const needsFirstSync = !hasInitialized && isXRangeValid && wavelengths.length > 0;

  return isXRangeValid && (hasWavelengthChange || isXViewRangeInvalid || needsInitialSync || needsFirstSync);
}

export function computeSpectraZoomLevel(xRange: [number, number], xViewRange: [number, number]): number {
  return (xRange[1] - xRange[0]) / (xViewRange[1] - xViewRange[0]);
}

function collectStatsRange(
  stats: SpectraWebGLRangeStats,
  onValue: (value: { min: number; max: number }) => void
) {
  for (let index = 0; index < stats.min.length; index++) {
    onValue({ min: stats.min[index], max: stats.max[index] });
  }
}

function collectSpectraRange(
  spectra: number[][],
  visibleIndices: number[],
  onValue: (value: number) => void
) {
  for (const sampleIndex of visibleIndices) {
    const spectrum = spectra[sampleIndex];
    if (!spectrum) continue;

    for (let valueIndex = 0; valueIndex < spectrum.length; valueIndex++) {
      onValue(spectrum[valueIndex]);
    }
  }
}

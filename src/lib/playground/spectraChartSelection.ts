export interface SpectraRangeBounds {
  min: number;
  max: number;
}

export interface SpectraRectBounds {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

export function getSpectraRangeBounds({
  isSelecting,
  startWavelength,
  endWavelength,
}: {
  isSelecting: boolean;
  startWavelength: number | null;
  endWavelength: number | null;
}): SpectraRangeBounds | null {
  if (!isSelecting || startWavelength === null || endWavelength === null) {
    return null;
  }
  return {
    min: Math.min(startWavelength, endWavelength),
    max: Math.max(startWavelength, endWavelength),
  };
}

export function getSpectraRectBounds({
  isSelecting,
  startX,
  startY,
  endX,
  endY,
}: {
  isSelecting: boolean;
  startX: number | null;
  startY: number | null;
  endX: number | null;
  endY: number | null;
}): SpectraRectBounds | null {
  if (!isSelecting || startX === null || endX === null) {
    return null;
  }
  return {
    x1: Math.min(startX, endX),
    x2: Math.max(startX, endX),
    y1: Math.min(startY ?? 0, endY ?? 0),
    y2: Math.max(startY ?? 0, endY ?? 0),
  };
}

export function chartYToSpectraValue({
  chartY,
  containerHeight,
  marginTop,
  marginBottom,
  yAxisDomain,
}: {
  chartY: number;
  containerHeight: number;
  marginTop: number;
  marginBottom: number;
  yAxisDomain: [number, number];
}): number {
  const plotHeight = containerHeight - marginTop - marginBottom;
  const normalizedY = Math.max(0, Math.min(1, 1 - (chartY - marginTop) / plotHeight));
  return yAxisDomain[0] + normalizedY * (yAxisDomain[1] - yAxisDomain[0]);
}

export function selectSpectraRangeSamples({
  wavelengths,
  spectra,
  startWavelength,
  endWavelength,
}: {
  wavelengths: number[];
  spectra: number[][];
  startWavelength: number;
  endWavelength: number;
}): number[] {
  const minWavelength = Math.min(startWavelength, endWavelength);
  const maxWavelength = Math.max(startWavelength, endWavelength);
  const wavelengthStep = wavelengths.length > 1 ? Math.abs(wavelengths[1] - wavelengths[0]) : 1;

  if (Math.abs(maxWavelength - minWavelength) <= wavelengthStep * 2) {
    return [];
  }

  const wavelengthIndicesInRange = wavelengths
    .map((wavelength, index) => ({ wavelength, index }))
    .filter(({ wavelength }) => wavelength >= minWavelength && wavelength <= maxWavelength)
    .map(({ index }) => index);

  if (wavelengthIndicesInRange.length === 0) {
    return [];
  }

  const sampleRangeMeans = spectra.map(spectrum => {
    const values = wavelengthIndicesInRange.map(wavelengthIndex => spectrum[wavelengthIndex]).filter(value => value !== undefined);
    return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  });

  const globalMean = sampleRangeMeans.reduce((sum, value) => sum + value, 0) / sampleRangeMeans.length;
  const globalStd = Math.sqrt(
    sampleRangeMeans.reduce((sum, value) => sum + Math.pow(value - globalMean, 2), 0) / sampleRangeMeans.length
  );

  const outlierThreshold = 2;
  const outlierSamples: number[] = [];
  sampleRangeMeans.forEach((mean, index) => {
    if (Math.abs(mean - globalMean) > outlierThreshold * globalStd) {
      outlierSamples.push(index);
    }
  });

  if (outlierSamples.length > 0) {
    return outlierSamples;
  }

  const sorted = sampleRangeMeans.map((value, index) => ({ value, index })).sort((left, right) => left.value - right.value);
  const percentile10 = Math.ceil(sorted.length * 0.1);
  return [
    ...sorted.slice(0, percentile10).map(({ index }) => index),
    ...sorted.slice(-percentile10).map(({ index }) => index),
  ];
}

export function selectSpectraRectSamples({
  wavelengths,
  spectra,
  bounds,
  yAxisDomain,
}: {
  wavelengths: number[];
  spectra: number[][];
  bounds: SpectraRectBounds;
  yAxisDomain: [number, number];
}): number[] {
  const wavelengthStep = wavelengths.length > 1 ? Math.abs(wavelengths[1] - wavelengths[0]) : 1;
  const yRange = yAxisDomain[1] - yAxisDomain[0];

  if (Math.abs(bounds.x2 - bounds.x1) <= wavelengthStep * 2 || Math.abs(bounds.y2 - bounds.y1) <= yRange * 0.02) {
    return [];
  }

  const wavelengthIndicesInRange: number[] = [];
  wavelengths.forEach((wavelength, index) => {
    if (wavelength >= bounds.x1 && wavelength <= bounds.x2) {
      wavelengthIndicesInRange.push(index);
    }
  });

  if (wavelengthIndicesInRange.length === 0) {
    return [];
  }

  const selectedIndices: number[] = [];
  spectra.forEach((spectrum, sampleIndex) => {
    for (const wavelengthIndex of wavelengthIndicesInRange) {
      const value = spectrum[wavelengthIndex];
      if (value !== undefined && value >= bounds.y1 && value <= bounds.y2) {
        selectedIndices.push(sampleIndex);
        break;
      }
    }
  });

  return selectedIndices;
}

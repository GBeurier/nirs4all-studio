export interface SpectraDecimationResult {
  allPoints: Float32Array;
  metadata: Array<{
    index: number;
    isOriginal: boolean;
    pointCount: number;
    offset: number;
  }>;
}

export function normalizeSpectraValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) {
    return 0.5;
  }
  if (max === min) return 0.5;
  const result = (value - min) / (max - min);
  return Number.isFinite(result) ? result : 0.5;
}

export function decimateSpectraPoints(
  wavelengths: number[],
  values: number[],
  targetLength: number,
  xViewRange: [number, number],
  yRange: [number, number]
): Float32Array {
  const visiblePoints: { x: number; y: number }[] = [];

  for (let i = 0; i < wavelengths.length; i++) {
    const wavelength = wavelengths[i];
    if (wavelength >= xViewRange[0] && wavelength <= xViewRange[1]) {
      visiblePoints.push({
        x: normalizeSpectraValue(wavelength, xViewRange[0], xViewRange[1]),
        y: normalizeSpectraValue(values[i], yRange[0], yRange[1]),
      });
    }
  }

  const visiblePointCount = visiblePoints.length;
  if (visiblePointCount <= targetLength || targetLength < 3) {
    const result = new Float32Array(visiblePointCount * 2);
    for (let i = 0; i < visiblePointCount; i++) {
      result[i * 2] = visiblePoints[i].x;
      result[i * 2 + 1] = visiblePoints[i].y;
    }
    return result;
  }

  const sampled: { x: number; y: number }[] = [];
  const bucketSize = (visiblePointCount - 2) / (targetLength - 2);
  sampled.push(visiblePoints[0]);

  for (let i = 0; i < targetLength - 2; i++) {
    const averageRangeStart = Math.floor((i + 1) * bucketSize) + 1;
    const averageRangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, visiblePointCount);

    let averageX = 0;
    let averageY = 0;
    for (let j = averageRangeStart; j < averageRangeEnd; j++) {
      averageX += visiblePoints[j].x;
      averageY += visiblePoints[j].y;
    }
    averageX /= averageRangeEnd - averageRangeStart;
    averageY /= averageRangeEnd - averageRangeStart;

    const rangeStart = Math.floor(i * bucketSize) + 1;
    const rangeEnd = averageRangeStart;
    const lastPoint = sampled[sampled.length - 1];

    let maxArea = -1;
    let maxAreaIndex = rangeStart;

    for (let j = rangeStart; j < rangeEnd; j++) {
      const area = Math.abs(
        (lastPoint.x - averageX) * (visiblePoints[j].y - lastPoint.y) -
        (lastPoint.x - visiblePoints[j].x) * (averageY - lastPoint.y)
      );
      if (area > maxArea) {
        maxArea = area;
        maxAreaIndex = j;
      }
    }

    sampled.push(visiblePoints[maxAreaIndex]);
  }

  sampled.push(visiblePoints[visiblePointCount - 1]);

  const result = new Float32Array(sampled.length * 2);
  for (let i = 0; i < sampled.length; i++) {
    result[i * 2] = sampled[i].x;
    result[i * 2 + 1] = sampled[i].y;
  }
  return result;
}

export function computeSpectraDecimation(
  spectra: number[][],
  originalSpectra: number[][] | null,
  wavelengths: number[],
  visibleIndices: number[],
  xViewRange: [number, number],
  yRange: [number, number],
  targetPoints: number
): SpectraDecimationResult {
  const metadata: SpectraDecimationResult['metadata'] = [];
  const chunks: Float32Array[] = [];
  let totalElements = 0;

  for (const index of visibleIndices) {
    const spectrum = spectra[index];
    if (!spectrum) continue;

    const points = decimateSpectraPoints(wavelengths, spectrum, targetPoints, xViewRange, yRange);
    if (points.length >= 4) {
      metadata.push({ index, isOriginal: false, pointCount: points.length / 2, offset: totalElements });
      chunks.push(points);
      totalElements += points.length;
    }
  }

  if (originalSpectra) {
    for (const index of visibleIndices) {
      const spectrum = originalSpectra[index];
      if (!spectrum) continue;

      const points = decimateSpectraPoints(wavelengths, spectrum, targetPoints, xViewRange, yRange);
      if (points.length >= 4) {
        metadata.push({ index, isOriginal: true, pointCount: points.length / 2, offset: totalElements });
        chunks.push(points);
        totalElements += points.length;
      }
    }
  }

  const allPoints = new Float32Array(totalElements);
  let writeOffset = 0;
  for (const chunk of chunks) {
    allPoints.set(chunk, writeOffset);
    writeOffset += chunk.length;
  }

  return { allPoints, metadata };
}

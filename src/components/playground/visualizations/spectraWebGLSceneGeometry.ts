import type { SpectraWebGLLineData } from './spectraWebGLLines';

export interface SpectraWebGLBatchedLineGroup {
  colorKey: string;
  color: SpectraWebGLLineData['color'];
  positions: Float32Array;
}

export interface SpectraWebGLAggregatedAreaGeometry {
  areaPositions: Float32Array;
  quantilePositions: Float32Array | null;
  centerLinePositions: Float32Array;
}

export interface BuildSpectraWebGLAggregatedAreaGeometryInput {
  wavelengths: number[];
  min: number[];
  max: number[];
  median: number[];
  mean?: number[];
  quantileLower?: number[];
  quantileUpper?: number[];
  xRange: [number, number];
  yRange: [number, number];
  showMean?: boolean;
}

export function buildSpectraWebGLBatchedLineGroups(lines: SpectraWebGLLineData[]): SpectraWebGLBatchedLineGroup[] {
  const colorMap = new Map<string, { lines: SpectraWebGLLineData[]; color: SpectraWebGLLineData['color'] }>();

  for (const line of lines) {
    const colorKey = line.color.getHexString();
    if (!colorMap.has(colorKey)) {
      colorMap.set(colorKey, { lines: [], color: line.color.clone() });
    }
    colorMap.get(colorKey)!.lines.push(line);
  }

  return Array.from(colorMap.entries()).map(([colorKey, { lines: groupLines, color }]) => ({
    colorKey,
    color,
    positions: buildSpectraWebGLBatchedLinePositions(groupLines),
  }));
}

export function buildSpectraWebGLBatchedLinePositions(lines: SpectraWebGLLineData[]): Float32Array {
  let totalPoints = 0;
  for (const line of lines) {
    totalPoints += line.pointCount + 1;
  }

  const positions = new Float32Array(totalPoints * 3);
  let offset = 0;

  for (const line of lines) {
    for (let pointIndex = 0; pointIndex < line.pointCount; pointIndex++) {
      positions[offset * 3] = line.points[pointIndex * 2];
      positions[offset * 3 + 1] = line.points[pointIndex * 2 + 1];
      positions[offset * 3 + 2] = 0;
      offset++;
    }

    positions[offset * 3] = NaN;
    positions[offset * 3 + 1] = NaN;
    positions[offset * 3 + 2] = NaN;
    offset++;
  }

  return positions;
}

export function buildSpectraWebGLLinePositions(line: SpectraWebGLLineData, zOrder: number): Float32Array {
  const positions = new Float32Array(line.pointCount * 3);

  for (let pointIndex = 0; pointIndex < line.pointCount; pointIndex++) {
    positions[pointIndex * 3] = line.points[pointIndex * 2];
    positions[pointIndex * 3 + 1] = line.points[pointIndex * 2 + 1];
    positions[pointIndex * 3 + 2] = zOrder;
  }

  return positions;
}

export function buildSpectraWebGLAggregatedAreaGeometry({
  wavelengths,
  min,
  max,
  median,
  mean,
  quantileLower,
  quantileUpper,
  xRange,
  yRange,
  showMean = false,
}: BuildSpectraWebGLAggregatedAreaGeometryInput): SpectraWebGLAggregatedAreaGeometry | null {
  const pointCount = wavelengths.length;
  if (pointCount < 2) return null;

  const normalizeX = createNormalizer(xRange);
  const normalizeY = createNormalizer(yRange);
  const areaVertices: number[] = [];

  for (let index = 0; index < pointCount - 1; index++) {
    appendAreaSegment(areaVertices, {
      x1: normalizeX(wavelengths[index]),
      x2: normalizeX(wavelengths[index + 1]),
      lower1: normalizeY(min[index]),
      upper1: normalizeY(max[index]),
      lower2: normalizeY(min[index + 1]),
      upper2: normalizeY(max[index + 1]),
      z: -0.02,
    });
  }

  const quantileVertices: number[] = [];
  if (quantileLower && quantileUpper) {
    for (let index = 0; index < pointCount - 1; index++) {
      appendAreaSegment(quantileVertices, {
        x1: normalizeX(wavelengths[index]),
        x2: normalizeX(wavelengths[index + 1]),
        lower1: normalizeY(quantileLower[index]),
        upper1: normalizeY(quantileUpper[index]),
        lower2: normalizeY(quantileLower[index + 1]),
        upper2: normalizeY(quantileUpper[index + 1]),
        z: -0.015,
      });
    }
  }

  const centerLine = showMean && mean ? mean : median;
  const centerLineVertices: number[] = [];
  for (let index = 0; index < pointCount; index++) {
    centerLineVertices.push(normalizeX(wavelengths[index]), normalizeY(centerLine[index]), 0);
  }

  return {
    areaPositions: new Float32Array(areaVertices),
    quantilePositions: quantileVertices.length > 0 ? new Float32Array(quantileVertices) : null,
    centerLinePositions: new Float32Array(centerLineVertices),
  };
}

function createNormalizer([min, max]: [number, number]) {
  const span = max - min || 1;
  return (value: number) => (value - min) / span;
}

function appendAreaSegment(
  vertices: number[],
  {
    x1,
    x2,
    lower1,
    upper1,
    lower2,
    upper2,
    z,
  }: {
    x1: number;
    x2: number;
    lower1: number;
    upper1: number;
    lower2: number;
    upper2: number;
    z: number;
  }
) {
  vertices.push(x1, lower1, z);
  vertices.push(x1, upper1, z);
  vertices.push(x2, lower2, z);
  vertices.push(x1, upper1, z);
  vertices.push(x2, upper2, z);
  vertices.push(x2, lower2, z);
}

export interface SpectraWebGLHitTestLine {
  points: Float32Array;
  index: number;
  isOriginal: boolean;
  pointCount: number;
}

export interface SpectraWebGLClientRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SpectraWebGLCameraBounds {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

export interface SpectraWebGLHitTestThresholds {
  x: number;
  y: number;
}

export const SPECTRA_WEBGL_CAMERA_BOUNDS: SpectraWebGLCameraBounds = {
  left: -0.06,
  right: 1.02,
  bottom: -0.12,
  top: 1.04,
};

export const SPECTRA_WEBGL_HIT_TEST_THRESHOLDS: SpectraWebGLHitTestThresholds = {
  x: 0.03,
  y: 0.08,
};

export function pointerToSpectraChartPoint(
  clientX: number,
  clientY: number,
  rect: SpectraWebGLClientRect,
  bounds: SpectraWebGLCameraBounds = SPECTRA_WEBGL_CAMERA_BOUNDS
): { x: number; y: number } {
  const screenX = (clientX - rect.left) / rect.width;
  const screenY = 1 - (clientY - rect.top) / rect.height;

  return {
    x: bounds.left + screenX * (bounds.right - bounds.left),
    y: bounds.bottom + screenY * (bounds.top - bounds.bottom),
  };
}

export function findClosestSpectraHitLine(
  lines: SpectraWebGLHitTestLine[],
  chartPoint: { x: number; y: number },
  thresholds: SpectraWebGLHitTestThresholds = SPECTRA_WEBGL_HIT_TEST_THRESHOLDS
): number | null {
  let closestIndex: number | null = null;
  let closestDistance = Infinity;

  for (const line of lines) {
    if (line.isOriginal) continue;

    for (let pointIndex = 0; pointIndex < line.pointCount; pointIndex++) {
      const x = line.points[pointIndex * 2];
      const y = line.points[pointIndex * 2 + 1];

      if (Math.abs(x - chartPoint.x) < thresholds.x) {
        const distance = Math.abs(y - chartPoint.y);
        if (distance < closestDistance && distance < thresholds.y) {
          closestDistance = distance;
          closestIndex = line.index;
        }
      }
    }
  }

  return closestIndex;
}

export function findClosestSpectraHitLineFromPointer(
  lines: SpectraWebGLHitTestLine[],
  clientX: number,
  clientY: number,
  rect: SpectraWebGLClientRect,
  bounds: SpectraWebGLCameraBounds = SPECTRA_WEBGL_CAMERA_BOUNDS,
  thresholds: SpectraWebGLHitTestThresholds = SPECTRA_WEBGL_HIT_TEST_THRESHOLDS
): number | null {
  return findClosestSpectraHitLine(
    lines,
    pointerToSpectraChartPoint(clientX, clientY, rect, bounds),
    thresholds
  );
}

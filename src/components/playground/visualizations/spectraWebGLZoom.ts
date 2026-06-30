export type SpectraWebGLXRange = [number, number];

export const SPECTRA_WEBGL_ZOOM_IN_FACTOR = 0.87;
export const SPECTRA_WEBGL_ZOOM_OUT_FACTOR = 1.15;
export const SPECTRA_WEBGL_MIN_ZOOM_RATIO = 0.05;
export const SPECTRA_WEBGL_RANGE_CHANGE_THRESHOLD = 1;

export function shouldResetSpectraXViewRange(
  previousRange: SpectraWebGLXRange,
  nextRange: SpectraWebGLXRange,
  hasInitialized: boolean
): boolean {
  return !hasInitialized ||
    Math.abs(previousRange[0] - nextRange[0]) > SPECTRA_WEBGL_RANGE_CHANGE_THRESHOLD ||
    Math.abs(previousRange[1] - nextRange[1]) > SPECTRA_WEBGL_RANGE_CHANGE_THRESHOLD;
}

export function computeSpectraWheelZoomRange({
  xRange,
  viewRange,
  mouseXNorm,
  deltaY,
}: {
  xRange: SpectraWebGLXRange;
  viewRange: SpectraWebGLXRange;
  mouseXNorm: number;
  deltaY: number;
}): SpectraWebGLXRange {
  const [xMin, xMax] = xRange;
  const [viewMin, viewMax] = viewRange;
  const fullRange = xMax - xMin;
  const currentRange = viewMax - viewMin;
  const zoomFactor = deltaY > 0 ? SPECTRA_WEBGL_ZOOM_OUT_FACTOR : SPECTRA_WEBGL_ZOOM_IN_FACTOR;
  const newRange = Math.max(
    fullRange * SPECTRA_WEBGL_MIN_ZOOM_RATIO,
    Math.min(fullRange, currentRange * zoomFactor)
  );
  const mouseXData = viewMin + mouseXNorm * currentRange;
  const leftRatio = (mouseXData - viewMin) / currentRange;

  return clampSpectraXViewRangeToBounds(
    [mouseXData - leftRatio * newRange, mouseXData + (1 - leftRatio) * newRange],
    xRange,
    newRange
  );
}

export function computeSpectraPanRange({
  xRange,
  viewRange,
  dxPixels,
  viewportWidth,
}: {
  xRange: SpectraWebGLXRange;
  viewRange: SpectraWebGLXRange;
  dxPixels: number;
  viewportWidth: number;
}): SpectraWebGLXRange {
  const [viewMin, viewMax] = viewRange;
  const currentRange = viewMax - viewMin;
  const shift = -(dxPixels / viewportWidth) * currentRange;

  return clampSpectraXViewRangeToBounds(
    [viewMin + shift, viewMax + shift],
    xRange,
    currentRange
  );
}

export function resetSpectraXViewRange(xRange: SpectraWebGLXRange): SpectraWebGLXRange {
  return [xRange[0], xRange[1]];
}

function clampSpectraXViewRangeToBounds(
  [viewMin, viewMax]: SpectraWebGLXRange,
  [xMin, xMax]: SpectraWebGLXRange,
  rangeSize: number
): SpectraWebGLXRange {
  let nextMin = viewMin;
  let nextMax = viewMax;

  if (nextMin < xMin) {
    nextMin = xMin;
    nextMax = xMin + rangeSize;
  }
  if (nextMax > xMax) {
    nextMax = xMax;
    nextMin = xMax - rangeSize;
  }

  return [nextMin, nextMax];
}

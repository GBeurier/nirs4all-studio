/**
 * Web Worker for spectra geometry computation.
 *
 * Performs LTTB decimation and Float32Array construction off the main thread
 * to keep the UI responsive during zoom/pan with 1000+ spectra.
 *
 * Protocol:
 * 1. Main thread sends 'setData' with spectra arrays (only when data changes)
 * 2. Main thread sends 'decimate' with view parameters (on every zoom/pan)
 * 3. Worker responds with 'decimated' containing a single transferable Float32Array
 */

// Declare worker global scope for proper TypeScript typing
// (avoids requiring webworker lib in tsconfig)
interface WorkerGlobalScopeCompat {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
}
const workerSelf: WorkerGlobalScopeCompat = self as unknown as WorkerGlobalScopeCompat;
export {};

// ============= Worker-side cached data =============

let cachedSpectra: number[][] = [];
let cachedOriginalSpectra: number[][] | null = null;
let cachedWavelengths: number[] = [];

// ============= Pure computation functions (duplicated from SpectraWebGL.tsx) =============

/**
 * Normalize data to 0-1 range for rendering.
 * Returns 0.5 for invalid inputs to prevent NaN propagation.
 */
function normalizeValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) {
    return 0.5;
  }
  if (max === min) return 0.5;
  const result = (value - min) / (max - min);
  return Number.isFinite(result) ? result : 0.5;
}

/**
 * Decimate array to target length using Largest-Triangle-Three-Buckets (LTTB) algorithm.
 * Preserves visual features better than simple stepping.
 * Maps to [0,1] based on xViewRange for proper zoom behavior.
 */
function decimatePoints(
  wavelengths: number[],
  values: number[],
  targetLength: number,
  xViewRange: [number, number],
  yRange: [number, number]
): Float32Array {
  // Filter to visible range and normalize to [0,1] based on VIEW range
  const visiblePoints: { x: number; y: number }[] = [];
  for (let i = 0; i < wavelengths.length; i++) {
    const wl = wavelengths[i];
    if (wl >= xViewRange[0] && wl <= xViewRange[1]) {
      const normX = normalizeValue(wl, xViewRange[0], xViewRange[1]);
      const normY = normalizeValue(values[i], yRange[0], yRange[1]);
      visiblePoints.push({ x: normX, y: normY });
    }
  }

  const n = visiblePoints.length;
  if (n <= targetLength || targetLength < 3) {
    const result = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      result[i * 2] = visiblePoints[i].x;
      result[i * 2 + 1] = visiblePoints[i].y;
    }
    return result;
  }

  // LTTB algorithm for feature-preserving decimation
  const sampled: { x: number; y: number }[] = [];
  const bucketSize = (n - 2) / (targetLength - 2);

  // Always include first point
  sampled.push(visiblePoints[0]);

  for (let i = 0; i < targetLength - 2; i++) {
    const avgRangeStart = Math.floor((i + 1) * bucketSize) + 1;
    const avgRangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, n);

    // Calculate average point in next bucket
    let avgX = 0, avgY = 0;
    for (let j = avgRangeStart; j < avgRangeEnd; j++) {
      avgX += visiblePoints[j].x;
      avgY += visiblePoints[j].y;
    }
    avgX /= (avgRangeEnd - avgRangeStart);
    avgY /= (avgRangeEnd - avgRangeStart);

    // Find point in current bucket with largest triangle area
    const rangeStart = Math.floor(i * bucketSize) + 1;
    const rangeEnd = avgRangeStart;
    const lastPoint = sampled[sampled.length - 1];

    let maxArea = -1;
    let maxAreaIdx = rangeStart;

    for (let j = rangeStart; j < rangeEnd; j++) {
      const area = Math.abs(
        (lastPoint.x - avgX) * (visiblePoints[j].y - lastPoint.y) -
        (lastPoint.x - visiblePoints[j].x) * (avgY - lastPoint.y)
      );
      if (area > maxArea) {
        maxArea = area;
        maxAreaIdx = j;
      }
    }

    sampled.push(visiblePoints[maxAreaIdx]);
  }

  // Always include last point
  sampled.push(visiblePoints[n - 1]);

  const result = new Float32Array(sampled.length * 2);
  for (let i = 0; i < sampled.length; i++) {
    result[i * 2] = sampled[i].x;
    result[i * 2 + 1] = sampled[i].y;
  }
  return result;
}

// ============= Worker message handler =============

workerSelf.onmessage = (e: MessageEvent) => {
  const msg = e.data;

  if (msg.type === 'setData') {
    // Cache spectra data (sent once per dataset change)
    cachedSpectra = msg.spectra;
    cachedOriginalSpectra = msg.originalSpectra ?? null;
    cachedWavelengths = msg.wavelengths;
    return;
  }

  if (msg.type === 'decimate') {
    const { requestId, visibleIndices, xViewRange, yRange, targetPoints } = msg;

    const metadata: Array<{
      index: number;
      isOriginal: boolean;
      pointCount: number;
      offset: number;
    }> = [];
    const chunks: Float32Array[] = [];
    let totalElements = 0;

    // Process main spectra
    for (const idx of visibleIndices) {
      const spectrum = cachedSpectra[idx];
      if (!spectrum) continue;

      const points = decimatePoints(cachedWavelengths, spectrum, targetPoints, xViewRange, yRange);
      if (points.length >= 4) { // At least 2 points
        metadata.push({
          index: idx,
          isOriginal: false,
          pointCount: points.length / 2,
          offset: totalElements,
        });
        chunks.push(points);
        totalElements += points.length;
      }
    }

    // Process original spectra (for "both" view)
    if (cachedOriginalSpectra) {
      for (const idx of visibleIndices) {
        const spectrum = cachedOriginalSpectra[idx];
        if (!spectrum) continue;

        const points = decimatePoints(cachedWavelengths, spectrum, targetPoints, xViewRange, yRange);
        if (points.length >= 4) {
          metadata.push({
            index: idx,
            isOriginal: true,
            pointCount: points.length / 2,
            offset: totalElements,
          });
          chunks.push(points);
          totalElements += points.length;
        }
      }
    }

    // Combine all decimated points into a single Float32Array for efficient transfer
    const allPoints = new Float32Array(totalElements);
    let writeOffset = 0;
    for (const chunk of chunks) {
      allPoints.set(chunk, writeOffset);
      writeOffset += chunk.length;
    }

    // Transfer the Float32Array buffer (zero-copy)
    workerSelf.postMessage(
      { type: 'decimated', requestId, allPoints, metadata },
      [allPoints.buffer]
    );
  }
};

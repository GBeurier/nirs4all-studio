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

import { computeSpectraDecimation } from './spectraWebGLGeometry';

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

    const { allPoints, metadata } = computeSpectraDecimation(
      cachedSpectra,
      cachedOriginalSpectra,
      cachedWavelengths,
      visibleIndices,
      xViewRange,
      yRange,
      targetPoints
    );

    // Transfer the Float32Array buffer (zero-copy)
    workerSelf.postMessage(
      { type: 'decimated', requestId, allPoints, metadata },
      [allPoints.buffer]
    );
  }
};

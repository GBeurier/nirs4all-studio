import { useEffect, useMemo, useRef, useState } from 'react';

import { computeSpectraDecimation, type SpectraDecimationResult } from './spectraWebGLGeometry';

interface UseSpectraDecimationInput {
  spectra: number[][];
  originalSpectra: number[][] | null;
  wavelengths: number[];
  visibleIndices: number[];
  xViewRange: [number, number];
  yRange: [number, number];
  targetPoints: number;
}

interface DecimatedMessage {
  type: 'decimated';
  requestId: number;
  allPoints: Float32Array;
  metadata: SpectraDecimationResult['metadata'];
}

const EMPTY_DECIMATION: SpectraDecimationResult = { allPoints: new Float32Array(0), metadata: [] };

/**
 * LTTB decimation of the visible spectra for the current X view.
 *
 * Runs in `spectraGeometryWorker` so pan/zoom never blocks the main thread; the previous
 * result stays on screen until the worker answers. Where module workers are unavailable
 * (jsdom, or a worker that fails to load) it falls back to computing synchronously.
 */
export function useSpectraDecimation({
  spectra,
  originalSpectra,
  wavelengths,
  visibleIndices,
  xViewRange,
  yRange,
  targetPoints,
}: UseSpectraDecimationInput): SpectraDecimationResult {
  const [workerFailed, setWorkerFailed] = useState(() => typeof Worker === 'undefined');
  const [workerResult, setWorkerResult] = useState<SpectraDecimationResult>(EMPTY_DECIMATION);
  const workerRef = useRef<Worker | null>(null);
  const latestRequestRef = useRef(0);

  useEffect(() => {
    if (workerFailed) return;
    let worker: Worker;
    try {
      worker = new Worker(new URL('./spectraGeometryWorker.ts', import.meta.url), { type: 'module' });
    } catch {
      setWorkerFailed(true);
      return;
    }
    worker.onmessage = (event: MessageEvent<DecimatedMessage>) => {
      const { type, requestId, allPoints, metadata } = event.data;
      // A newer request supersedes this answer.
      if (type === 'decimated' && requestId === latestRequestRef.current) {
        setWorkerResult({ allPoints, metadata });
      }
    };
    worker.onerror = () => setWorkerFailed(true);
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [workerFailed]);

  // The worker caches the dataset; resend it only when the data itself changes.
  useEffect(() => {
    workerRef.current?.postMessage({ type: 'setData', spectra, originalSpectra, wavelengths });
  }, [spectra, originalSpectra, wavelengths, workerFailed]);

  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) return;
    latestRequestRef.current += 1;
    worker.postMessage({
      type: 'decimate',
      requestId: latestRequestRef.current,
      visibleIndices,
      xViewRange,
      yRange,
      targetPoints,
    });
  }, [spectra, originalSpectra, wavelengths, visibleIndices, xViewRange, yRange, targetPoints, workerFailed]);

  const synchronousResult = useMemo(
    () => workerFailed
      ? computeSpectraDecimation(spectra, originalSpectra, wavelengths, visibleIndices, xViewRange, yRange, targetPoints)
      : null,
    [workerFailed, spectra, originalSpectra, wavelengths, visibleIndices, xViewRange, yRange, targetPoints],
  );

  return synchronousResult ?? workerResult;
}

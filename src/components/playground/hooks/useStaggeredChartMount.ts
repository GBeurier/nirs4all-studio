/**
 * useStaggeredChartMount - Progressive chart mounting for performance
 *
 * OPT-8: Staggered/lazy chart mounting
 *
 * Instead of mounting all charts simultaneously when data arrives,
 * this hook staggers chart mounting across multiple frames to avoid
 * a rendering burst that causes jank.
 *
 * Priority schedule:
 *   1. spectra    — immediate (0ms)
 *   2. histogram  — next frame (~50ms)
 *   3. pca        — ~100ms
 *   4. folds, repetitions — ~200ms
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ChartType } from '@/context/PlaygroundViewContext';

/** Mount schedule: chart type → delay in ms */
const MOUNT_SCHEDULE: readonly { chart: ChartType; delay: number }[] = [
  { chart: 'spectra', delay: 0 },
  { chart: 'histogram', delay: 50 },
  { chart: 'pca', delay: 100 },
  { chart: 'folds', delay: 200 },
  { chart: 'repetitions', delay: 200 },
];

interface UseStaggeredChartMountOptions {
  /** Whether data is available (result or rawData present) */
  hasData: boolean;
  /** Charts currently visible in the view (user hasn't hidden them) */
  visibleCharts: Set<ChartType>;
}

interface UseStaggeredChartMountResult {
  /** Set of charts that have been staged for mounting */
  mountedCharts: Set<ChartType>;
  /** Check if a specific chart is ready to mount its content */
  isChartMounted: (chart: ChartType) => boolean;
}

/**
 * Progressively mounts charts with staggered delays to avoid rendering bursts.
 *
 * - When `hasData` transitions from false→true, starts the mount schedule
 * - Only mounts charts that are in `visibleCharts`
 * - Resets when `hasData` becomes false (dataset cleared/changed)
 * - Charts hidden by the user are never scheduled
 */
export function useStaggeredChartMount({
  hasData,
  visibleCharts,
}: UseStaggeredChartMountOptions): UseStaggeredChartMountResult {
  const [mountedCharts, setMountedCharts] = useState<Set<ChartType>>(new Set());
  const timersRef = useRef<number[]>([]);
  const prevHasDataRef = useRef(false);

  // Clear all pending timers
  const clearTimers = useCallback(() => {
    for (const id of timersRef.current) {
      clearTimeout(id);
    }
    timersRef.current = [];
  }, []);

  // Start mount schedule
  useEffect(() => {
    // Data just arrived
    if (hasData && !prevHasDataRef.current) {
      clearTimers();

      // Start with empty set, then progressively add
      setMountedCharts(new Set());

      for (const { chart, delay } of MOUNT_SCHEDULE) {
        if (!visibleCharts.has(chart)) continue;

        if (delay === 0) {
          // Mount immediately
          setMountedCharts(prev => {
            const next = new Set(prev);
            next.add(chart);
            return next;
          });
        } else {
          const timerId = window.setTimeout(() => {
            setMountedCharts(prev => {
              const next = new Set(prev);
              next.add(chart);
              return next;
            });
          }, delay);
          timersRef.current.push(timerId);
        }
      }
    }

    // Data was cleared — reset mount state
    if (!hasData && prevHasDataRef.current) {
      clearTimers();
      setMountedCharts(new Set());
    }

    prevHasDataRef.current = hasData;
  }, [hasData, clearTimers]); // intentionally exclude visibleCharts to avoid re-scheduling on visibility toggles

  // When a chart becomes visible after initial mount, add it immediately
  // (user toggled visibility after data was already loaded)
  useEffect(() => {
    if (!hasData) return;

    setMountedCharts(prev => {
      let changed = false;
      const next = new Set(prev);

      for (const chart of visibleCharts) {
        if (!next.has(chart)) {
          next.add(chart);
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [hasData, visibleCharts]);

  // Cleanup on unmount
  useEffect(() => clearTimers, [clearTimers]);

  const isChartMounted = useCallback(
    (chart: ChartType) => mountedCharts.has(chart),
    [mountedCharts],
  );

  return { mountedCharts, isChartMounted };
}

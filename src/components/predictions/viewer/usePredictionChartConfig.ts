/**
 * React hook backing the prediction-chart configuration.
 *
 * Persists the full ChartConfig to localStorage under
 * `predictionChartConfig`, debounced by 300ms so rapid slider
 * changes do not thrash storage.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_CHART_CONFIG, type ChartConfig } from "./types";

const STORAGE_KEY = "predictionChartConfig";
const DEBOUNCE_MS = 300;

function readFromStorage(): ChartConfig {
  if (typeof window === "undefined") return DEFAULT_CHART_CONFIG;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CHART_CONFIG;
    const parsed = JSON.parse(raw) as Partial<ChartConfig> | null;
    if (!parsed || typeof parsed !== "object") return DEFAULT_CHART_CONFIG;
    // Merge so new defaults survive older persisted blobs.
    return { ...DEFAULT_CHART_CONFIG, ...parsed };
  } catch {
    return DEFAULT_CHART_CONFIG;
  }
}

export function usePredictionChartConfig(): [
  ChartConfig,
  (next: ChartConfig | ((prev: ChartConfig) => ChartConfig)) => void,
  () => void,
] {
  const [config, setConfigState] = useState<ChartConfig>(() => readFromStorage());
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const persist = useCallback((next: ChartConfig) => {
    if (typeof window === "undefined") return;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore quota / disabled storage errors — config still lives in memory.
      }
      timerRef.current = null;
    }, DEBOUNCE_MS);
  }, []);

  const setConfig = useCallback(
    (next: ChartConfig | ((prev: ChartConfig) => ChartConfig)) => {
      setConfigState((prev) => {
        const value = typeof next === "function" ? (next as (p: ChartConfig) => ChartConfig)(prev) : next;
        persist(value);
        return value;
      });
    },
    [persist],
  );

  const resetConfig = useCallback(() => {
    setConfigState(DEFAULT_CHART_CONFIG);
    persist(DEFAULT_CHART_CONFIG);
  }, [persist]);

  return [config, setConfig, resetConfig];
}

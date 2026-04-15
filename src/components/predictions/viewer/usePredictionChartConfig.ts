/**
 * React hook backing the prediction-chart configuration.
 *
 * Persists the full ChartConfig to localStorage under
 * `predictionChartConfig`, debounced by 300ms so rapid slider
 * changes do not thrash storage.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getConfusionGradientColors,
  getPartitionPaletteColors,
  isConfusionGradientPreset,
  isPartitionPalettePreset,
  normalizeColorToHex,
} from "./palettes";
import { DEFAULT_CHART_CONFIG, type ChartConfig } from "./types";

const STORAGE_KEY = "predictionChartConfig";
const DEBOUNCE_MS = 300;
const CONFIG_UPDATED_EVENT = "prediction-chart-config-updated";

const LEGACY_PALETTE_MAP = {
  viridis: "tableau10",
  colorblind: "tableau10",
  highContrast: "set1",
} as const;

const LEGACY_CONFUSION_MAP = {
  blue: "ocean",
  teal: "lagoon",
  diverging: "ember",
} as const;

function resolveStoredPalette(rawPalette: unknown): ChartConfig["palette"] {
  if (typeof rawPalette !== "string") return DEFAULT_CHART_CONFIG.palette;
  if (rawPalette === "custom" || isPartitionPalettePreset(rawPalette)) {
    return rawPalette;
  }
  return LEGACY_PALETTE_MAP[rawPalette as keyof typeof LEGACY_PALETTE_MAP] ?? DEFAULT_CHART_CONFIG.palette;
}

function resolveStoredConfusionPreset(parsed: Record<string, unknown>): ChartConfig["confusionGradientPreset"] {
  const rawPreset = parsed.confusionGradientPreset;
  if (typeof rawPreset === "string" && isConfusionGradientPreset(rawPreset)) {
    return rawPreset;
  }

  const legacyScale = parsed.confusionColorScale;
  if (typeof legacyScale === "string") {
    return LEGACY_CONFUSION_MAP[legacyScale as keyof typeof LEGACY_CONFUSION_MAP] ?? DEFAULT_CHART_CONFIG.confusionGradientPreset;
  }

  return DEFAULT_CHART_CONFIG.confusionGradientPreset;
}

function mergePartitionColors(
  rawColors: unknown,
  palette: ChartConfig["palette"],
): ChartConfig["partitionColors"] {
  const paletteDefaults = getPartitionPaletteColors(palette === "custom" ? "default" : palette);
  if (!rawColors || typeof rawColors !== "object") {
    return paletteDefaults;
  }

  const candidate = rawColors as Partial<ChartConfig["partitionColors"]>;
  return {
    train: normalizeColorToHex(candidate.train ?? paletteDefaults.train, paletteDefaults.train),
    val: normalizeColorToHex(candidate.val ?? paletteDefaults.val, paletteDefaults.val),
    test: normalizeColorToHex(candidate.test ?? paletteDefaults.test, paletteDefaults.test),
  };
}

function mergeConfusionGradient(
  rawGradient: unknown,
  preset: ChartConfig["confusionGradientPreset"],
): ChartConfig["confusionGradient"] {
  const presetDefaults = getConfusionGradientColors(preset === "custom" ? "ocean" : preset);
  if (!rawGradient || typeof rawGradient !== "object") {
    return presetDefaults;
  }

  const candidate = rawGradient as Partial<ChartConfig["confusionGradient"]>;
  return {
    low: normalizeColorToHex(candidate.low ?? presetDefaults.low, presetDefaults.low),
    high: normalizeColorToHex(candidate.high ?? presetDefaults.high, presetDefaults.high),
  };
}

function normalizeStoredConfig(parsed: Partial<ChartConfig> & Record<string, unknown>): ChartConfig {
  const palette = resolveStoredPalette(parsed.palette);
  const confusionGradientPreset = resolveStoredConfusionPreset(parsed);

  return {
    ...DEFAULT_CHART_CONFIG,
    ...parsed,
    palette,
    partitionColors: mergePartitionColors(parsed.partitionColors, palette),
    confusionGradientPreset,
    confusionGradient: mergeConfusionGradient(parsed.confusionGradient, confusionGradientPreset),
  };
}

function emitConfigUpdate(next: ChartConfig): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ChartConfig>(CONFIG_UPDATED_EVENT, { detail: next }));
}

function readFromStorage(): ChartConfig {
  if (typeof window === "undefined") return DEFAULT_CHART_CONFIG;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CHART_CONFIG;
    const parsed = JSON.parse(raw) as (Partial<ChartConfig> & Record<string, unknown>) | null;
    if (!parsed || typeof parsed !== "object") return DEFAULT_CHART_CONFIG;
    return normalizeStoredConfig(parsed);
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

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleConfigUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<ChartConfig | undefined>;
      const next = customEvent.detail;
      if (!next) return;
      setConfigState(normalizeStoredConfig(next));
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      setConfigState(readFromStorage());
    };

    window.addEventListener(CONFIG_UPDATED_EVENT, handleConfigUpdated as EventListener);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(CONFIG_UPDATED_EVENT, handleConfigUpdated as EventListener);
      window.removeEventListener("storage", handleStorage);
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
      emitConfigUpdate(next);
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

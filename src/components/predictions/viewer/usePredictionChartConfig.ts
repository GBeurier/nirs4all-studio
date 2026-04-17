/**
 * React hook backing the prediction-chart configuration.
 *
 * Global chart settings stay shared in localStorage, while metadata-based
 * coloration is persisted per dataset so it does not leak across datasets.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CATEGORICAL_PALETTES,
  CONTINUOUS_PALETTES,
} from "@/lib/playground/colorConfig";
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
const STORAGE_VERSION = 2;

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

type DatasetColorationConfig = Pick<
  ChartConfig,
  "colorMode" | "metadataKey" | "metadataType" | "continuousPalette" | "categoricalPalette"
>;

export interface PredictionChartConfigStorage {
  version: number;
  global: Partial<ChartConfig> & Record<string, unknown>;
  datasetColoration: Record<string, Partial<DatasetColorationConfig> & Record<string, unknown>>;
}

interface PendingWrite {
  config: ChartConfig;
  datasetKey: string | null;
}

export interface UsePredictionChartConfigOptions {
  datasetKey?: string | null;
}

function resolveStoredColorMode(
  parsed: Partial<ChartConfig> & Record<string, unknown>,
): ChartConfig["colorMode"] {
  const rawMode = parsed.colorMode;
  if (rawMode === "partition" || rawMode === "metadata") {
    return rawMode;
  }
  return "partition";
}

function resolveStoredMetadataType(rawType: unknown): ChartConfig["metadataType"] {
  return rawType === "categorical" || rawType === "continuous" ? rawType : undefined;
}

function resolveStoredPalette(rawPalette: unknown): ChartConfig["palette"] {
  if (typeof rawPalette !== "string") return DEFAULT_CHART_CONFIG.palette;
  if (rawPalette === "custom" || isPartitionPalettePreset(rawPalette)) {
    return rawPalette;
  }
  return LEGACY_PALETTE_MAP[rawPalette as keyof typeof LEGACY_PALETTE_MAP] ?? DEFAULT_CHART_CONFIG.palette;
}

function resolveStoredCategoricalPalette(
  rawPalette: unknown,
  fallbackPalette: ChartConfig["palette"],
): ChartConfig["categoricalPalette"] {
  if (typeof rawPalette === "string" && rawPalette in CATEGORICAL_PALETTES) {
    return rawPalette as ChartConfig["categoricalPalette"];
  }
  if (fallbackPalette !== "custom") {
    return fallbackPalette;
  }
  return DEFAULT_CHART_CONFIG.categoricalPalette;
}

function resolveStoredContinuousPalette(rawPalette: unknown): ChartConfig["continuousPalette"] {
  if (typeof rawPalette === "string" && rawPalette in CONTINUOUS_PALETTES) {
    return rawPalette as ChartConfig["continuousPalette"];
  }
  return DEFAULT_CHART_CONFIG.continuousPalette;
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
  const colorMode = resolveStoredColorMode(parsed);
  const palette = resolveStoredPalette(parsed.palette);
  const metadataKey = typeof parsed.metadataKey === "string" && parsed.metadataKey.trim().length > 0
    ? parsed.metadataKey
    : undefined;
  const metadataType = resolveStoredMetadataType(parsed.metadataType);
  const confusionGradientPreset = resolveStoredConfusionPreset(parsed);

  return {
    ...DEFAULT_CHART_CONFIG,
    ...parsed,
    colorMode,
    metadataKey,
    metadataType,
    categoricalPalette: resolveStoredCategoricalPalette(parsed.categoricalPalette, palette),
    continuousPalette: resolveStoredContinuousPalette(parsed.continuousPalette),
    palette,
    partitionColors: mergePartitionColors(parsed.partitionColors, palette),
    confusionGradientPreset,
    confusionGradient: mergeConfusionGradient(parsed.confusionGradient, confusionGradientPreset),
  };
}

export function normalizePredictionChartDatasetKey(datasetKey?: string | null): string | null {
  if (typeof datasetKey !== "string") return null;
  const trimmed = datasetKey.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function createDefaultStorage(): PredictionChartConfigStorage {
  return {
    version: STORAGE_VERSION,
    global: stripDatasetColorationForStorage(DEFAULT_CHART_CONFIG),
    datasetColoration: {},
  };
}

function normalizeDatasetColoration(
  raw: unknown,
): DatasetColorationConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<DatasetColorationConfig> & Record<string, unknown>;
  const colorMode = candidate.colorMode === "metadata" ? "metadata" : null;
  if (!colorMode) return null;
  return {
    colorMode,
    metadataKey: typeof candidate.metadataKey === "string" && candidate.metadataKey.trim().length > 0
      ? candidate.metadataKey
      : undefined,
    metadataType: resolveStoredMetadataType(candidate.metadataType),
    continuousPalette: resolveStoredContinuousPalette(candidate.continuousPalette),
    categoricalPalette: resolveStoredCategoricalPalette(candidate.categoricalPalette, DEFAULT_CHART_CONFIG.palette),
  };
}

function isVersionedStorage(value: unknown): value is PredictionChartConfigStorage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PredictionChartConfigStorage>;
  return candidate.version === STORAGE_VERSION;
}

export function stripDatasetColorationForStorage(config: ChartConfig): ChartConfig {
  return {
    ...config,
    colorMode: "partition",
    metadataKey: undefined,
    metadataType: undefined,
    continuousPalette: DEFAULT_CHART_CONFIG.continuousPalette,
    categoricalPalette: DEFAULT_CHART_CONFIG.categoricalPalette,
    partitionColoring: true,
  };
}

function extractDatasetColoration(config: ChartConfig): DatasetColorationConfig | null {
  if (config.colorMode !== "metadata") return null;
  return {
    colorMode: "metadata",
    metadataKey: config.metadataKey,
    metadataType: config.metadataType,
    continuousPalette: config.continuousPalette,
    categoricalPalette: config.categoricalPalette,
  };
}

export function normalizePredictionChartStorage(raw: unknown): PredictionChartConfigStorage {
  if (!raw || typeof raw !== "object") {
    return createDefaultStorage();
  }

  if (!isVersionedStorage(raw)) {
    const legacy = normalizeStoredConfig(raw as Partial<ChartConfig> & Record<string, unknown>);
    return {
      version: STORAGE_VERSION,
      global: stripDatasetColorationForStorage(legacy),
      datasetColoration: {},
    };
  }

  const global = raw.global && typeof raw.global === "object"
    ? stripDatasetColorationForStorage(normalizeStoredConfig(raw.global))
    : stripDatasetColorationForStorage(DEFAULT_CHART_CONFIG);

  const datasetColoration: PredictionChartConfigStorage["datasetColoration"] = {};
  const sourceEntries = raw.datasetColoration && typeof raw.datasetColoration === "object"
    ? Object.entries(raw.datasetColoration)
    : [];

  for (const [rawKey, rawValue] of sourceEntries) {
    const key = normalizePredictionChartDatasetKey(rawKey);
    const normalized = normalizeDatasetColoration(rawValue);
    if (!key || !normalized) continue;
    datasetColoration[key] = normalized;
  }

  return {
    version: STORAGE_VERSION,
    global,
    datasetColoration,
  };
}

export function resolvePredictionChartConfig(
  storage: PredictionChartConfigStorage,
  datasetKey?: string | null,
): ChartConfig {
  const normalizedStorage = normalizePredictionChartStorage(storage);
  const key = normalizePredictionChartDatasetKey(datasetKey);
  const base = normalizeStoredConfig(normalizedStorage.global);
  if (!key) return base;

  const override = normalizeDatasetColoration(normalizedStorage.datasetColoration[key]);
  if (!override) return base;

  return normalizeStoredConfig({
    ...base,
    ...override,
  });
}

export function applyPredictionChartConfigToStorage(
  storage: PredictionChartConfigStorage,
  datasetKey: string | null,
  config: ChartConfig,
): PredictionChartConfigStorage {
  const nextStorage = normalizePredictionChartStorage(storage);
  const key = normalizePredictionChartDatasetKey(datasetKey);
  const nextDatasetColoration = { ...nextStorage.datasetColoration };
  const override = extractDatasetColoration(config);

  if (key) {
    if (override) {
      nextDatasetColoration[key] = override;
    } else {
      delete nextDatasetColoration[key];
    }
  }

  return {
    version: STORAGE_VERSION,
    global: stripDatasetColorationForStorage(config),
    datasetColoration: nextDatasetColoration,
  };
}

function emitConfigUpdate(next: PredictionChartConfigStorage): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<PredictionChartConfigStorage>(CONFIG_UPDATED_EVENT, { detail: next }),
  );
}

function readStoragePayload(): PredictionChartConfigStorage {
  if (typeof window === "undefined") return createDefaultStorage();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultStorage();
    return normalizePredictionChartStorage(JSON.parse(raw));
  } catch {
    return createDefaultStorage();
  }
}

function readResolvedConfig(datasetKey: string | null): ChartConfig {
  return resolvePredictionChartConfig(readStoragePayload(), datasetKey);
}

function writeStoragePayload(next: PredictionChartConfigStorage): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

function persistResolvedConfig(datasetKey: string | null, config: ChartConfig): PredictionChartConfigStorage {
  const storage = applyPredictionChartConfigToStorage(readStoragePayload(), datasetKey, config);
  writeStoragePayload(storage);
  emitConfigUpdate(storage);
  return storage;
}

export function usePredictionChartConfig(
  options: UsePredictionChartConfigOptions = {},
): [
  ChartConfig,
  (next: ChartConfig | ((prev: ChartConfig) => ChartConfig)) => void,
  () => void,
] {
  const datasetKey = normalizePredictionChartDatasetKey(options.datasetKey);
  const datasetKeyRef = useRef<string | null>(datasetKey);
  const timerRef = useRef<number | null>(null);
  const pendingWriteRef = useRef<PendingWrite | null>(null);
  const [config, setConfigState] = useState<ChartConfig>(() => readResolvedConfig(datasetKey));

  const flushPendingWrite = useCallback(() => {
    const pending = pendingWriteRef.current;
    if (!pending) return;

    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    pendingWriteRef.current = null;
    persistResolvedConfig(pending.datasetKey, pending.config);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    flushPendingWrite();
    datasetKeyRef.current = datasetKey;
    setConfigState(readResolvedConfig(datasetKey));
  }, [datasetKey, flushPendingWrite]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleConfigUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<PredictionChartConfigStorage | undefined>;
      if (!customEvent.detail) return;
      setConfigState(resolvePredictionChartConfig(customEvent.detail, datasetKeyRef.current));
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      setConfigState(readResolvedConfig(datasetKeyRef.current));
    };

    window.addEventListener(CONFIG_UPDATED_EVENT, handleConfigUpdated as EventListener);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(CONFIG_UPDATED_EVENT, handleConfigUpdated as EventListener);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const persist = useCallback((next: ChartConfig, targetDatasetKey: string | null) => {
    if (typeof window === "undefined") return;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }

    pendingWriteRef.current = {
      config: next,
      datasetKey: targetDatasetKey,
    };

    timerRef.current = window.setTimeout(() => {
      const pending = pendingWriteRef.current;
      if (!pending) return;
      pendingWriteRef.current = null;
      persistResolvedConfig(pending.datasetKey, pending.config);
      timerRef.current = null;
    }, DEBOUNCE_MS);
  }, []);

  const setConfig = useCallback(
    (next: ChartConfig | ((prev: ChartConfig) => ChartConfig)) => {
      setConfigState((prev) => {
        const value = typeof next === "function" ? (next as (p: ChartConfig) => ChartConfig)(prev) : next;
        persist(value, datasetKeyRef.current);
        return value;
      });
    },
    [persist],
  );

  const resetConfig = useCallback(() => {
    setConfigState(DEFAULT_CHART_CONFIG);
    persist(DEFAULT_CHART_CONFIG, datasetKeyRef.current);
  }, [persist]);

  return [config, setConfig, resetConfig];
}

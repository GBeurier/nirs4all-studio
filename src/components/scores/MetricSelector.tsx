import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, SlidersHorizontal } from "lucide-react";
import {
  getMetricDefinitions,
  getAvailableMetrics,
  getPresetsForTaskType,
  getDefaultSelectedMetrics,
  orderMetricKeys,
} from "@/lib/scores";

interface MetricSelectorProps {
  taskType: string | null;
  selectedMetrics: string[];
  onSelectedMetricsChange: (metrics: string[]) => void;
  availableMetricKeys?: readonly string[];
}

function normalizeMetricSelection(
  metrics: readonly string[] | undefined,
  availableMetricKeys?: readonly string[],
): string[] {
  if (!metrics) return [];
  if (!availableMetricKeys) return [...metrics];

  const available = new Set(orderMetricKeys(availableMetricKeys));
  const seen = new Set<string>();

  return metrics.filter((metric) => {
    if (!available.has(metric) || seen.has(metric)) return false;
    seen.add(metric);
    return true;
  });
}

function resolveDefaultMetricSelection(
  taskType: string | null,
  defaultMetrics?: readonly string[],
  availableMetricKeys?: readonly string[],
): string[] {
  const baseline = defaultMetrics ?? getDefaultSelectedMetrics(taskType);
  const filteredBaseline = normalizeMetricSelection(baseline, availableMetricKeys);

  if (filteredBaseline.length > 0 || baseline.length === 0) {
    return filteredBaseline;
  }

  return orderMetricKeys(availableMetricKeys ?? []).slice(0, 6);
}

export function MetricSelector({
  taskType,
  selectedMetrics,
  onSelectedMetricsChange,
  availableMetricKeys,
}: MetricSelectorProps) {
  const [open, setOpen] = useState(false);
  const available = availableMetricKeys
    ? getMetricDefinitions(availableMetricKeys)
    : getAvailableMetrics(taskType);
  const availableSet = new Set(available.map(metric => metric.key));
  const presets = taskType == null && availableMetricKeys
    ? []
    : getPresetsForTaskType(taskType)
      .map(preset => ({
        ...preset,
        keys: preset.keys.filter(key => availableSet.has(key)),
      }))
      .filter(preset => preset.keys.length > 0);

  const toggleMetric = useCallback((key: string) => {
    if (selectedMetrics.includes(key)) {
      onSelectedMetricsChange(selectedMetrics.filter(m => m !== key));
    } else {
      onSelectedMetricsChange([...selectedMetrics, key]);
    }
  }, [selectedMetrics, onSelectedMetricsChange]);

  const applyPreset = useCallback((keys: string[]) => {
    onSelectedMetricsChange(keys);
    setOpen(false);
  }, [onSelectedMetricsChange]);

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <SlidersHorizontal className="h-4 w-4 text-muted-foreground shrink-0" />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-6 px-2 text-xs gap-1">
            <Plus className="h-3 w-3" /> Metrics ({selectedMetrics.length})
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-3">
          <div className="space-y-3">
            <div className="text-[11px] text-muted-foreground">
              {selectedMetrics.length} selected
            </div>
            {presets.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {presets.map(preset => (
                  <Button key={preset.id} variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => applyPreset(preset.keys)}>
                    {preset.label}
                  </Button>
                ))}
              </div>
            )}
            <div className="border-t pt-2 space-y-1 max-h-48 overflow-y-auto">
              {available.map(metric => (
                <label key={metric.key} className="flex items-center gap-2 text-xs py-0.5 cursor-pointer hover:bg-muted/50 px-1 rounded">
                  <Checkbox
                    checked={selectedMetrics.includes(metric.key)}
                    onCheckedChange={() => toggleMetric(metric.key)}
                    className="h-3.5 w-3.5"
                  />
                  <span className="font-mono text-[10px] text-muted-foreground w-10">{metric.abbreviation}</span>
                  <span>{metric.label}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">{metric.direction === "higher" ? "↑" : metric.direction === "lower" ? "↓" : "~0"}</span>
                </label>
              ))}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function isSameMetricSelection(metrics: string[], candidate?: readonly string[]): boolean {
  return !!candidate
    && metrics.length === candidate.length
    && metrics.every((metric, index) => metric === candidate[index]);
}

function metricSelectionSignature(metrics?: readonly string[]): string {
  return metrics?.join("\u001f") ?? "";
}

function metricKeySetSignature(metricKeys?: readonly string[]): string {
  return orderMetricKeys(metricKeys ?? []).join("\u001f");
}

function useStableMetricList(metrics?: readonly string[], treatAsSet = false): readonly string[] | undefined {
  const signature = treatAsSet
    ? metricKeySetSignature(metrics)
    : metricSelectionSignature(metrics);
  const stableMetricsRef = useRef<readonly string[] | undefined>(metrics ? [...metrics] : undefined);
  const stableSignatureRef = useRef<string | null>(null);

  if (stableSignatureRef.current !== signature) {
    stableMetricsRef.current = metrics ? [...metrics] : undefined;
    stableSignatureRef.current = signature;
  }

  return stableMetricsRef.current;
}

/** Hook to persist metric selection per page in localStorage. */
export function useMetricSelection(
  storageKey: string,
  taskType: string | null,
  defaultMetrics?: readonly string[],
  legacyDefaultMetrics?: readonly string[],
  storageVersion?: string,
  availableMetricKeys?: readonly string[],
) {
  const legacyStorageKey = `metrics-${storageKey}`;
  const versionedStorageKey = storageVersion ? `${legacyStorageKey}-${storageVersion}` : legacyStorageKey;
  const stableAvailableMetricKeys = useStableMetricList(availableMetricKeys, true);
  const stableDefaultMetrics = useStableMetricList(defaultMetrics);
  const stableLegacyDefaultMetrics = useStableMetricList(legacyDefaultMetrics);

  const normalizedDefaults = useMemo(
    () => resolveDefaultMetricSelection(taskType, stableDefaultMetrics, stableAvailableMetricKeys),
    [stableAvailableMetricKeys, stableDefaultMetrics, taskType],
  );
  const normalizedLegacyDefaults = useMemo(
    () => normalizeMetricSelection(stableLegacyDefaultMetrics, stableAvailableMetricKeys),
    [stableAvailableMetricKeys, stableLegacyDefaultMetrics],
  );

  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(versionedStorageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const normalized = normalizeMetricSelection(parsed, availableMetricKeys);
          if (isSameMetricSelection(normalized, normalizedLegacyDefaults)) {
            return normalizedDefaults;
          }
          if (normalized.length > 0 || parsed.length === 0) {
            return normalized;
          }
        }
      }
    } catch { /* ignore */ }
    return normalizedDefaults;
  });

  useEffect(() => {
    const syncSelection = (nextSelection: string[], storedSelection?: readonly string[]) => {
      setSelectedMetrics(prev => (
        isSameMetricSelection(prev, nextSelection)
          ? prev
          : nextSelection
      ));

      if (!isSameMetricSelection(nextSelection, storedSelection)) {
        localStorage.setItem(versionedStorageKey, JSON.stringify(nextSelection));
      }
    };

    try {
      if (storageVersion) {
        localStorage.removeItem(legacyStorageKey);
      }

      const stored = localStorage.getItem(versionedStorageKey);
      if (!stored) {
        syncSelection(normalizedDefaults);
        return;
      }

      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) {
        syncSelection(normalizedDefaults);
        return;
      }

      const normalized = normalizeMetricSelection(parsed, availableMetricKeys);

      if (isSameMetricSelection(normalized, normalizedLegacyDefaults)) {
        syncSelection(normalizedDefaults, parsed);
        return;
      }

      const nextSelection = normalized.length > 0 || parsed.length === 0
        ? normalized
        : normalizedDefaults;

      syncSelection(nextSelection, parsed);
    } catch { /* ignore */ }
  }, [
    availableMetricKeys,
    legacyStorageKey,
    normalizedDefaults,
    normalizedLegacyDefaults,
    storageVersion,
    versionedStorageKey,
  ]);

  const setMetrics = useCallback((metrics: string[]) => {
    const normalized = normalizeMetricSelection(metrics, availableMetricKeys);
    setSelectedMetrics(prev => (
      isSameMetricSelection(prev, normalized)
        ? prev
        : normalized
    ));
    try {
      localStorage.setItem(versionedStorageKey, JSON.stringify(normalized));
    } catch { /* ignore */ }
  }, [availableMetricKeys, versionedStorageKey]);

  return [selectedMetrics, setMetrics] as const;
}

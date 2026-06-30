import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getDefaultSelectedMetrics,
  orderMetricKeys,
} from "@/lib/scores";
import {
  legacyMetricSelectionStorageKey,
  metricSelectionStorageKey,
  readClientStorageJson,
  removeClientStorageItem,
  writeClientStorageJson,
} from "@/lib/clientStorage";

function normalizeMetricSelection(
  metrics: readonly string[] | undefined,
  availableMetricKeys?: readonly string[],
): string[] {
  if (!metrics) return [];
  const normalized = orderMetricKeys(metrics);
  if (!availableMetricKeys || availableMetricKeys.length === 0) return normalized;

  const available = new Set(orderMetricKeys(availableMetricKeys));
  return normalized.filter(metric => available.has(metric));
}

function resolveDefaultMetricSelection(
  taskType: string | null,
  defaultMetrics?: readonly string[],
  availableMetricKeys?: readonly string[],
): string[] {
  const baseline = defaultMetrics ?? getDefaultSelectedMetrics(taskType);
  if (availableMetricKeys && availableMetricKeys.length === 0 && baseline.length > 0) {
    return orderMetricKeys(baseline);
  }
  const filteredBaseline = normalizeMetricSelection(baseline, availableMetricKeys);

  if (filteredBaseline.length > 0 || baseline.length === 0) {
    return filteredBaseline;
  }

  return orderMetricKeys(availableMetricKeys ?? []).slice(0, 6);
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

function metricSelectionCandidatesSignature(metricGroups?: ReadonlyArray<readonly string[]>): string {
  return metricGroups?.map(group => metricSelectionSignature(orderMetricKeys(group))).join("\u001e") ?? "";
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

function useStableMetricSelectionCandidates(
  metricGroups?: ReadonlyArray<readonly string[]>,
): ReadonlyArray<readonly string[]> | undefined {
  const signature = metricSelectionCandidatesSignature(metricGroups);
  const stableGroupsRef = useRef<ReadonlyArray<readonly string[]> | undefined>(
    metricGroups ? metricGroups.map(group => [...group]) : undefined,
  );
  const stableSignatureRef = useRef<string | null>(null);

  if (stableSignatureRef.current !== signature) {
    stableGroupsRef.current = metricGroups ? metricGroups.map(group => [...group]) : undefined;
    stableSignatureRef.current = signature;
  }

  return stableGroupsRef.current;
}

function normalizeMetricSelectionCandidates(
  candidates: ReadonlyArray<readonly string[]> | undefined,
  availableMetricKeys?: readonly string[],
): string[][] {
  return (candidates ?? [])
    .map(candidate => normalizeMetricSelection(candidate, availableMetricKeys))
    .filter(candidate => candidate.length > 0);
}

function matchesMetricSelectionCandidate(
  metrics: string[],
  candidates: ReadonlyArray<readonly string[]> | undefined,
): boolean {
  return (candidates ?? []).some(candidate => isSameMetricSelection(metrics, candidate));
}

/** Hook to persist metric selection per page in client storage. */
export function useMetricSelection(
  storageKey: string,
  taskType: string | null,
  defaultMetrics?: readonly string[],
  legacyDefaultMetrics?: readonly string[],
  storageVersion?: string,
  availableMetricKeys?: readonly string[],
  upgradeDefaultCandidates?: ReadonlyArray<readonly string[]>,
) {
  const legacyStorageKey = useMemo(
    () => legacyMetricSelectionStorageKey(storageKey),
    [storageKey],
  );
  const versionedStorageKey = useMemo(
    () => metricSelectionStorageKey(storageKey, storageVersion),
    [storageKey, storageVersion],
  );
  const stableAvailableMetricKeys = useStableMetricList(availableMetricKeys, true);
  const stableDefaultMetrics = useStableMetricList(defaultMetrics);
  const stableLegacyDefaultMetrics = useStableMetricList(legacyDefaultMetrics);
  const stableUpgradeDefaultCandidates = useStableMetricSelectionCandidates(upgradeDefaultCandidates);

  const normalizedDefaults = useMemo(
    () => resolveDefaultMetricSelection(taskType, stableDefaultMetrics, stableAvailableMetricKeys),
    [stableAvailableMetricKeys, stableDefaultMetrics, taskType],
  );
  const normalizedLegacyDefaults = useMemo(
    () => normalizeMetricSelection(stableLegacyDefaultMetrics, stableAvailableMetricKeys),
    [stableAvailableMetricKeys, stableLegacyDefaultMetrics],
  );
  const normalizedUpgradeDefaultCandidates = useMemo(
    () => normalizeMetricSelectionCandidates(stableUpgradeDefaultCandidates, stableAvailableMetricKeys),
    [stableAvailableMetricKeys, stableUpgradeDefaultCandidates],
  );

  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(() => {
    try {
      const parsed = readClientStorageJson(versionedStorageKey);
      if (parsed) {
        if (Array.isArray(parsed)) {
          const normalized = normalizeMetricSelection(parsed, availableMetricKeys);
          if (isSameMetricSelection(normalized, normalizedLegacyDefaults)) {
            return normalizedDefaults;
          }
          if (matchesMetricSelectionCandidate(normalized, normalizedUpgradeDefaultCandidates)) {
            return normalizedDefaults;
          }
          if (normalized.length > 0) {
            return normalized;
          }
          if (parsed.length === 0) {
            return normalizedDefaults.length > 0 ? normalizedDefaults : [];
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
        writeClientStorageJson(versionedStorageKey, nextSelection);
      }
    };

    try {
      if (storageVersion) {
        removeClientStorageItem(legacyStorageKey);
      }

      const parsed = readClientStorageJson(versionedStorageKey);
      if (!parsed) {
        syncSelection(normalizedDefaults);
        return;
      }

      if (!Array.isArray(parsed)) {
        syncSelection(normalizedDefaults);
        return;
      }

      const normalized = normalizeMetricSelection(parsed, availableMetricKeys);

      if (isSameMetricSelection(normalized, normalizedLegacyDefaults)) {
        syncSelection(normalizedDefaults, parsed);
        return;
      }
      if (matchesMetricSelectionCandidate(normalized, normalizedUpgradeDefaultCandidates)) {
        syncSelection(normalizedDefaults, parsed);
        return;
      }

      const nextSelection = normalized.length > 0
        ? normalized
        : parsed.length === 0
          ? (normalizedDefaults.length > 0 ? normalizedDefaults : [])
          : normalizedDefaults;

      syncSelection(nextSelection, parsed);
    } catch { /* ignore */ }
  }, [
    availableMetricKeys,
    legacyStorageKey,
    normalizedDefaults,
    normalizedLegacyDefaults,
    normalizedUpgradeDefaultCandidates,
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
      writeClientStorageJson(versionedStorageKey, normalized);
    } catch { /* ignore */ }
  }, [availableMetricKeys, versionedStorageKey]);

  return [selectedMetrics, setMetrics] as const;
}

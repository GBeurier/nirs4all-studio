/**
 * useDatasetQueries — React Query hooks for dataset endpoints.
 *
 * Why this exists
 * ---------------
 * Datasets, DatasetDetail and DatasetQuickView previously used raw
 * useState+useEffect to fetch from `/api/datasets`, `/api/datasets/{id}` and
 * `/api/datasets/{id}/preview`. That meant:
 *
 *   1. Every navigation back to the Datasets page restarted from `loading=true`
 *      and refired the network calls — there was no cross-mount cache.
 *   2. Opening QuickView or the Detail page re-fetched the preview every time,
 *      even for datasets the user had just looked at.
 *   3. The first QuickView open often raced backend warmup. The preview
 *      endpoint returns `{ success: false, error: "No workspace selected" }`
 *      as a 200 OK while nirs4all is still restoring the active workspace,
 *      and the previous code rendered that error permanently.
 *
 * The QueryClient configured in `main.tsx` already has a 5 minute staleTime,
 * automatic 503/network retry with exponential backoff, and is invalidated by
 * MlReadinessContext when `coreReady` / `mlReady` / `workspaceReady` flip.
 * Routing the dataset endpoints through it fixes all three issues without any
 * new state machinery.
 *
 * Cache key conventions
 * ---------------------
 * - `['datasets', 'list']`              — listDatasets()
 * - `['datasets', 'detail', id]`        — getDataset(id)
 * - `['datasets', 'preview', id, n]`    — previewDatasetById(id, n)
 * - `['workspaces', 'linked']`          — getLinkedWorkspaces()
 * - `['workspaces', wsId, 'scores']`    — getDatasetScores(wsId)
 *
 * Mutations elsewhere should call `useInvalidateDatasets()` to drop the list
 * + scores after link/unlink/refresh/group changes.
 */

import { useCallback, useEffect } from "react";
import {
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  listDatasets,
  getDataset,
  previewDatasetById,
  getLinkedWorkspaces,
  getDatasetScores,
} from "@/api/client";
import { useMlReadiness } from "@/context/MlReadinessContext";
import type {
  Dataset,
  DatasetListResponse,
  LinkedWorkspaceListResponse,
  PreviewDataResponse,
} from "@/types/datasets";

// Long-lived caches: dataset list & preview rarely change behind our back, and
// we explicitly invalidate after mutations and on workspaceReady. 30 minutes of
// gcTime ensures the cache survives navigation between pages.
const LONG_STALE_MS = 5 * 60 * 1000;
const LONG_GC_MS = 30 * 60 * 1000;

const baseOptions = {
  staleTime: LONG_STALE_MS,
  gcTime: LONG_GC_MS,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;

// ---------------------------------------------------------------------------
// Persistent localStorage cache
//
// React Query's cache is in-memory only, so on every cold start the dataset
// list and linked-workspaces would be re-fetched and the page would spin
// while the FastAPI backend warms up. We persist these two payloads (plus
// per-workspace dataset scores) to localStorage so:
//
//   1. The first render of /datasets shows the previous session's list
//      INSTANTLY, before any HTTP request fires.
//   2. React Query still kicks off a background refetch (initialDataUpdatedAt
//      is older than staleTime), so stale entries are corrected within a
//      second of the backend being reachable.
//
// Cache invalidation is correctness-backstopped two ways:
//   - Every mutation handler calls `useInvalidateDatasets()` which clears
//     both the in-memory cache AND the localStorage entries.
//   - Stored payloads carry the schema version below; bumping it on a
//     breaking change purges all stale on-disk caches.
// ---------------------------------------------------------------------------

const CACHE_VERSION = 2;
const STORAGE_KEYS = {
  datasets: "n4a:cache:datasets:list",
  linkedWorkspaces: "n4a:cache:workspaces:linked",
  scores: (workspaceId: string) => `n4a:cache:workspaces:${workspaceId}:scores`,
};

interface CachedEntry<T> {
  v: number;
  ts: number;
  data: T;
}

function readCache<T>(key: string): CachedEntry<T> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedEntry<T>;
    if (parsed?.v !== CACHE_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, data: T, timestamp: number = Date.now()): void {
  try {
    const entry: CachedEntry<T> = { v: CACHE_VERSION, ts: timestamp, data };
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Quota exceeded or storage disabled — ignore, in-memory cache still works.
  }
}

function clearCacheKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/**
 * Drop every persisted dataset cache entry. Called by `useInvalidateDatasets`
 * so a mutation never leaves stale data on disk for the next session.
 */
function clearAllDatasetCaches(): void {
  try {
    clearCacheKey(STORAGE_KEYS.datasets);
    clearCacheKey(STORAGE_KEYS.linkedWorkspaces);
    // Per-workspace score caches are namespaced — sweep them all.
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("n4a:cache:workspaces:") && k.endsWith(":scores")) {
        toRemove.push(k);
      }
    }
    toRemove.forEach(clearCacheKey);
  } catch {
    // ignore
  }
}

/**
 * Hook helper: persist a query's data to localStorage after a fresh fetch.
 * Hydrated/initialData snapshots must not be re-stamped as fresh on mount,
 * otherwise a stale localStorage entry can keep skipping revalidation for the
 * next cold start.
 */
function usePersistOnSuccess<T>(
  key: string | null,
  query: Pick<UseQueryResult<T>, "data" | "dataUpdatedAt" | "fetchStatus" | "status">,
  sourceTimestamp?: number,
): void {
  useEffect(() => {
    if (!key || query.status !== "success" || query.data === undefined) return;
    if (query.fetchStatus !== "idle" || query.dataUpdatedAt <= 0) return;
    if (sourceTimestamp !== undefined && query.dataUpdatedAt <= sourceTimestamp) return;
    writeCache(key, query.data, query.dataUpdatedAt);
  }, [
    key,
    query.data,
    query.dataUpdatedAt,
    query.fetchStatus,
    query.status,
    sourceTimestamp,
  ]);
}

// ---------------------------------------------------------------------------
// Query keys (exported so callers and the prefetch helper stay in sync)
// ---------------------------------------------------------------------------

export const datasetQueryKeys = {
  all: ["datasets"] as const,
  list: () => ["datasets", "list"] as const,
  detail: (id: string | undefined | null) => ["datasets", "detail", id] as const,
  preview: (id: string | undefined | null, maxSamples: number) =>
    ["datasets", "preview", id, maxSamples] as const,
  linkedWorkspaces: () => ["workspaces", "linked"] as const,
  scores: (workspaceId: string | undefined | null) =>
    ["workspaces", workspaceId, "scores"] as const,
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useDatasetsQuery() {
  // Hydrate from localStorage so the page renders the previous session's
  // dataset list synchronously, before any HTTP request fires.
  const cached = readCache<DatasetListResponse>(STORAGE_KEYS.datasets);
  const query = useQuery<DatasetListResponse>({
    queryKey: datasetQueryKeys.list(),
    queryFn: () => listDatasets(),
    initialData: cached?.data,
    // Treat the persisted data as old enough to refetch in the background:
    // staleTime is 5 min, so any timestamp older than that triggers a fetch
    // while still rendering cached content immediately.
    initialDataUpdatedAt: cached?.ts ?? 0,
    ...baseOptions,
  });
  usePersistOnSuccess(STORAGE_KEYS.datasets, query, cached?.ts);
  return query;
}

export function useLinkedWorkspacesQuery() {
  const cached = readCache<LinkedWorkspaceListResponse>(STORAGE_KEYS.linkedWorkspaces);
  const query = useQuery<LinkedWorkspaceListResponse>({
    queryKey: datasetQueryKeys.linkedWorkspaces(),
    queryFn: () => getLinkedWorkspaces(),
    initialData: cached?.data,
    initialDataUpdatedAt: cached?.ts ?? 0,
    ...baseOptions,
  });
  usePersistOnSuccess(STORAGE_KEYS.linkedWorkspaces, query, cached?.ts);
  return query;
}

export function useDatasetQuery(id: string | undefined) {
  return useQuery<Dataset>({
    queryKey: datasetQueryKeys.detail(id ?? null),
    queryFn: async () => {
      const { dataset } = await getDataset(id as string);
      return dataset;
    },
    enabled: !!id,
    ...baseOptions,
  });
}

/**
 * Preview a linked dataset.
 *
 * Gated on `workspaceReady` because the backend's preview endpoint requires
 * the active nirs4all workspace to be restored — before that point it returns
 * `success: false` with no real error, which the previous code rendered as a
 * permanent failure on first quickview open. Once `workspaceReady` flips,
 * MlReadinessContext invalidates queries and this fetch runs automatically.
 *
 * Backend `success: false` responses are converted to thrown errors so React
 * Query treats them as retryable failures and the user sees a real error
 * state with a working Retry button instead of a silent empty preview.
 */
export function useDatasetPreviewQuery(
  id: string | undefined,
  maxSamples: number = 100
) {
  const { workspaceReady } = useMlReadiness();
  return useQuery<PreviewDataResponse>({
    queryKey: datasetQueryKeys.preview(id ?? null, maxSamples),
    queryFn: async () => {
      const result = await previewDatasetById(id as string, maxSamples);
      if (!result.success) {
        throw new Error(result.error || "Failed to load preview");
      }
      return result;
    },
    enabled: !!id && workspaceReady,
    ...baseOptions,
  });
}

export function useDatasetScoresQuery(workspaceId: string | undefined | null) {
  const { workspaceReady } = useMlReadiness();
  const cacheKey = workspaceId ? STORAGE_KEYS.scores(workspaceId) : null;
  const cached = cacheKey
    ? readCache<Awaited<ReturnType<typeof getDatasetScores>>>(cacheKey)
    : null;
  const query = useQuery({
    queryKey: datasetQueryKeys.scores(workspaceId),
    queryFn: () => getDatasetScores(workspaceId as string),
    enabled: !!workspaceId && workspaceReady,
    initialData: workspaceReady ? cached?.data : undefined,
    initialDataUpdatedAt: workspaceReady ? cached?.ts ?? 0 : undefined,
    ...baseOptions,
  });
  usePersistOnSuccess(cacheKey, query, cached?.ts);
  return query;
}

// ---------------------------------------------------------------------------
// Invalidation helpers
// ---------------------------------------------------------------------------

/**
 * Returns a callback that invalidates all dataset/workspace caches. Call this
 * after mutations (link/unlink/refresh/group changes/edit). It is intentionally
 * coarse — these endpoints are cheap and the alternative (touching individual
 * keys per mutation) is brittle.
 */
export function useInvalidateDatasets() {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    // Drop persistent caches first so a hard reload after the mutation cannot
    // resurrect stale data from disk. The in-memory invalidation right after
    // triggers a refetch which will repopulate the cache.
    clearAllDatasetCaches();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: datasetQueryKeys.all }),
      queryClient.invalidateQueries({ queryKey: datasetQueryKeys.linkedWorkspaces() }),
      queryClient.invalidateQueries({ queryKey: ["workspaces"] }),
    ]);
  }, [queryClient]);
}

// ---------------------------------------------------------------------------
// Prefetch helper (called from MlReadinessProvider once core is reachable)
// ---------------------------------------------------------------------------

/**
 * Warms the dataset list and linked-workspaces caches so the first navigation
 * to /datasets renders instantly. Safe to call as soon as the FastAPI core is
 * reachable: both endpoints read from the small `app_config.json` file and do
 * not depend on nirs4all/workspace restore.
 */
export function prefetchDatasetsList(queryClient: QueryClient) {
  queryClient.prefetchQuery({
    queryKey: datasetQueryKeys.list(),
    queryFn: () => listDatasets(),
    staleTime: LONG_STALE_MS,
    gcTime: LONG_GC_MS,
  });
  queryClient.prefetchQuery({
    queryKey: datasetQueryKeys.linkedWorkspaces(),
    queryFn: () => getLinkedWorkspaces(),
    staleTime: LONG_STALE_MS,
    gcTime: LONG_GC_MS,
  });
}

/**
 * Synchronously seed the QueryClient from localStorage at app boot, BEFORE
 * any component mounts. This is what makes the very first /datasets render
 * instant after a cold start: by the time React reaches the Datasets page,
 * the QueryClient already has the previous session's data and there is no
 * loading spinner — only a background refetch.
 *
 * Called from `main.tsx` during QueryClient construction.
 */
export function hydrateDatasetCachesFromStorage(queryClient: QueryClient): void {
  const datasetsCached = readCache<DatasetListResponse>(STORAGE_KEYS.datasets);
  if (datasetsCached) {
    queryClient.setQueryData(datasetQueryKeys.list(), datasetsCached.data, {
      updatedAt: datasetsCached.ts,
    });
  }
  const workspacesCached = readCache<LinkedWorkspaceListResponse>(
    STORAGE_KEYS.linkedWorkspaces
  );
  if (workspacesCached) {
    queryClient.setQueryData(
      datasetQueryKeys.linkedWorkspaces(),
      workspacesCached.data,
      { updatedAt: workspacesCached.ts }
    );
  }
}

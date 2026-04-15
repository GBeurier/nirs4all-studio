/**
 * @vitest-environment jsdom
 */

import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  listDatasets: vi.fn(),
  getDataset: vi.fn(),
  previewDatasetById: vi.fn(),
  getLinkedWorkspaces: vi.fn(),
  getDatasetScores: vi.fn(),
}));

const readinessState = vi.hoisted(() => ({
  workspaceReady: true,
}));

vi.mock("@/api/client", () => ({
  listDatasets: apiMocks.listDatasets,
  getDataset: apiMocks.getDataset,
  previewDatasetById: apiMocks.previewDatasetById,
  getLinkedWorkspaces: apiMocks.getLinkedWorkspaces,
  getDatasetScores: apiMocks.getDatasetScores,
}));

vi.mock("@/context/MlReadinessContext", () => ({
  useMlReadiness: () => readinessState,
}));

import {
  datasetQueryKeys,
  hydrateDatasetCachesFromStorage,
  useDatasetScoresQuery,
  useDatasetsQuery,
  useInvalidateDatasets,
  useLinkedWorkspacesQuery,
} from "./useDatasetQueries";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const STORAGE_KEYS = {
  datasets: "n4a:cache:datasets:list",
  linkedWorkspaces: "n4a:cache:workspaces:linked",
  scores: (workspaceId: string) => `n4a:cache:workspaces:${workspaceId}:scores`,
};
const CURRENT_CACHE_VERSION = 2;

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitFor(assertion: () => void, timeoutMs: number = 1000): Promise<void> {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() - start >= timeoutMs) {
        throw error;
      }
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
  }
}

async function renderHook<T>(hook: () => T, client: QueryClient = createQueryClient()) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const result: { current: T | undefined } = { current: undefined };

  function TestComponent() {
    result.current = hook();
    return null;
  }

  async function render() {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <TestComponent />
        </QueryClientProvider>,
      );
    });
  }

  await render();

  return {
    client,
    result,
    rerender: render,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      client.clear();
    },
  };
}

function readStored<T>(key: string): { v: number; ts: number; data: T } | null {
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
}

afterEach(() => {
  localStorage.clear();
  readinessState.workspaceReady = true;
  apiMocks.listDatasets.mockReset();
  apiMocks.getDataset.mockReset();
  apiMocks.previewDatasetById.mockReset();
  apiMocks.getLinkedWorkspaces.mockReset();
  apiMocks.getDatasetScores.mockReset();
});

describe("useDatasetQueries", () => {
  it("hydrates dataset and linked-workspace caches into the QueryClient before mount", () => {
    const datasetsCached = {
      v: 1,
      ts: 1234,
      data: {
        datasets: [{ id: "dataset-1", name: "Cached dataset" }],
        groups: [],
      },
    };
    const workspacesCached = {
      v: 1,
      ts: 5678,
      data: {
        active_workspace_id: "ws-1",
        workspaces: [{ id: "ws-1", name: "Cached workspace", is_active: true }],
      },
    };
    localStorage.setItem(STORAGE_KEYS.datasets, JSON.stringify(datasetsCached));
    localStorage.setItem(
      STORAGE_KEYS.linkedWorkspaces,
      JSON.stringify(workspacesCached),
    );

    const queryClient = createQueryClient();
    hydrateDatasetCachesFromStorage(queryClient);

    expect(queryClient.getQueryData(datasetQueryKeys.list())).toEqual(
      datasetsCached.data,
    );
    expect(queryClient.getQueryData(datasetQueryKeys.linkedWorkspaces())).toEqual(
      workspacesCached.data,
    );
    expect(queryClient.getQueryState(datasetQueryKeys.list())?.dataUpdatedAt).toBe(
      datasetsCached.ts,
    );
    expect(
      queryClient.getQueryState(datasetQueryKeys.linkedWorkspaces())?.dataUpdatedAt,
    ).toBe(workspacesCached.ts);
  });

  it("hydrates dataset caches written with the current cache version", () => {
    const cached = {
      v: CURRENT_CACHE_VERSION,
      ts: 2468,
      data: {
        datasets: [{ id: "dataset-current", name: "Current cache dataset" }],
        groups: [],
      },
    };
    localStorage.setItem(STORAGE_KEYS.datasets, JSON.stringify(cached));

    const queryClient = createQueryClient();
    hydrateDatasetCachesFromStorage(queryClient);

    expect(queryClient.getQueryData(datasetQueryKeys.list())).toEqual(cached.data);
    expect(queryClient.getQueryState(datasetQueryKeys.list())?.dataUpdatedAt).toBe(
      cached.ts,
    );
  });

  it("does not re-stamp hydrated dataset cache entries as fresh until a real refetch succeeds", async () => {
    const cachedTs = 1111;
    const cachedPayload = {
      datasets: [{ id: "cached-dataset", name: "Cached dataset" }],
      groups: [],
    };
    localStorage.setItem(
      STORAGE_KEYS.datasets,
      JSON.stringify({ v: 1, ts: cachedTs, data: cachedPayload }),
    );

    const pendingFetch = deferred<typeof cachedPayload>();
    apiMocks.listDatasets.mockReturnValue(pendingFetch.promise);

    const mounted = await renderHook(() => useDatasetsQuery());

    expect(mounted.result.current?.data).toEqual(cachedPayload);
    expect(readStored<typeof cachedPayload>(STORAGE_KEYS.datasets)?.ts).toBe(cachedTs);

    const freshPayload = {
      datasets: [{ id: "fresh-dataset", name: "Fresh dataset" }],
      groups: [],
    };
    pendingFetch.resolve(freshPayload);

    await waitFor(() => {
      expect(readStored<typeof freshPayload>(STORAGE_KEYS.datasets)?.data).toEqual(
        freshPayload,
      );
    });
    expect(readStored<typeof freshPayload>(STORAGE_KEYS.datasets)?.v).toBe(
      CURRENT_CACHE_VERSION,
    );
    expect(readStored<typeof freshPayload>(STORAGE_KEYS.datasets)?.ts).toBeGreaterThan(
      cachedTs,
    );
    expect(apiMocks.listDatasets).toHaveBeenCalledTimes(1);

    await mounted.unmount();
  });

  it("keeps dataset-score cache hidden until the workspace is ready, then hydrates and refetches", async () => {
    const workspaceId = "ws-1";
    const cachedScores = {
      datasets: [
        { dataset_name: "cached-dataset", best_score: 0.91, score_kind: "final" },
      ],
    };
    localStorage.setItem(
      STORAGE_KEYS.scores(workspaceId),
      JSON.stringify({ v: 1, ts: 2222, data: cachedScores }),
    );

    const pendingFetch = deferred<{
      datasets: Array<{ dataset_name: string; best_score: number; score_kind: string }>;
    }>();
    apiMocks.getDatasetScores.mockReturnValue(pendingFetch.promise);
    readinessState.workspaceReady = false;

    const mounted = await renderHook(() => useDatasetScoresQuery(workspaceId));

    expect(mounted.result.current?.data).toBeUndefined();
    expect(apiMocks.getDatasetScores).not.toHaveBeenCalled();

    readinessState.workspaceReady = true;
    await mounted.rerender();

    await waitFor(() => {
      expect(mounted.result.current?.data).toEqual(cachedScores);
    });
    expect(apiMocks.getDatasetScores).toHaveBeenCalledTimes(1);

    const freshScores = {
      datasets: [
        { dataset_name: "fresh-dataset", best_score: 0.97, score_kind: "final" },
      ],
    };
    pendingFetch.resolve(freshScores);

    await waitFor(() => {
      expect(readStored<typeof freshScores>(STORAGE_KEYS.scores(workspaceId))?.data).toEqual(
        freshScores,
      );
    });
    expect(readStored<typeof freshScores>(STORAGE_KEYS.scores(workspaceId))?.v).toBe(
      CURRENT_CACHE_VERSION,
    );

    await mounted.unmount();
  });

  it("clears persisted dataset caches and invalidates the shared query namespaces", async () => {
    localStorage.setItem(
      STORAGE_KEYS.datasets,
      JSON.stringify({ v: 1, ts: 1, data: { datasets: [], groups: [] } }),
    );
    localStorage.setItem(
      STORAGE_KEYS.linkedWorkspaces,
      JSON.stringify({ v: 1, ts: 1, data: { active_workspace_id: null, workspaces: [] } }),
    );
    localStorage.setItem(
      STORAGE_KEYS.scores("ws-1"),
      JSON.stringify({ v: 1, ts: 1, data: { datasets: [] } }),
    );

    const queryClient = createQueryClient();
    queryClient.setQueryData(datasetQueryKeys.list(), { datasets: [], groups: [] });
    queryClient.setQueryData(datasetQueryKeys.linkedWorkspaces(), {
      active_workspace_id: null,
      workspaces: [],
    });
    queryClient.setQueryData(["workspaces", "ws-1", "status"], { ok: true });

    const mounted = await renderHook(() => useInvalidateDatasets(), queryClient);

    expect(
      queryClient.getQueryCache().find({ queryKey: datasetQueryKeys.list() })?.state
        .isInvalidated,
    ).toBe(false);

    await act(async () => {
      await mounted.result.current?.();
    });

    expect(localStorage.getItem(STORAGE_KEYS.datasets)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.linkedWorkspaces)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.scores("ws-1"))).toBeNull();
    expect(
      queryClient.getQueryCache().find({ queryKey: datasetQueryKeys.list() })?.state
        .isInvalidated,
    ).toBe(true);
    expect(
      queryClient
        .getQueryCache()
        .find({ queryKey: datasetQueryKeys.linkedWorkspaces() })?.state.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryCache().find({ queryKey: ["workspaces", "ws-1", "status"] })
        ?.state.isInvalidated,
    ).toBe(true);

    await mounted.unmount();
  });

  it("uses the shared linked-workspaces cache key for every consumer hook", async () => {
    const payload = {
      active_workspace_id: "ws-1",
      workspaces: [{ id: "ws-1", name: "Workspace", is_active: true }],
    };
    apiMocks.getLinkedWorkspaces.mockResolvedValue(payload);

    const mounted = await renderHook(() => useLinkedWorkspacesQuery());

    await waitFor(() => {
      expect(mounted.result.current?.data).toEqual(payload);
    });
    expect(
      mounted.client.getQueryData(datasetQueryKeys.linkedWorkspaces()),
    ).toEqual(payload);

    await mounted.unmount();
  });
});

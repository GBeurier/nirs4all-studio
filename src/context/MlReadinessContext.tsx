/**
 * MlReadinessContext - Tracks backend readiness in two phases.
 *
 * The backend starts in two phases:
 * - Phase 1 (core_ready): FastAPI running, basic endpoints work.
 * - Phase 2 (ml_ready): nirs4all/sklearn loaded in background. Heavy pages functional.
 *
 * This context provides `coreReady`, `mlReady`, `mlLoading`, and `mlError` to the app.
 * The app shows a connecting screen until `coreReady`, then pages that need ML
 * wrap their content with <MlLoadingOverlay>.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import {
  datasetQueryKeys,
  prefetchDatasetsList,
} from "@/hooks/useDatasetQueries";

interface MlReadiness {
  coreReady: boolean;
  mlReady: boolean;
  mlLoading: boolean;
  mlError: string | null;
  /**
   * True once nirs4all has finished restoring the active workspace at startup.
   * `mlReady` flips slightly earlier (as soon as the imports complete), so the
   * UI uses this flag to show a non-blocking "Loading workspace…" indicator
   * while datasets/runs/predictions endpoints are still empty.
   */
  workspaceReady: boolean;
  /**
   * True once the dataset list query has data (either hydrated from
   * localStorage at boot or fetched successfully). The backend flips
   * `workspaceReady` the moment `set_active_workspace()` returns, but React
   * Query still needs a round-trip to repopulate the `['datasets', 'list']`
   * cache after the invalidation that follows. The startup banner uses this
   * flag to stay visible through that gap so the Datasets page is not left
   * with only its small in-card spinner.
   */
  datasetsPrimed: boolean;
}

const MlReadinessContext = createContext<MlReadiness>({
  coreReady: false,
  mlReady: false,
  mlLoading: true,
  mlError: null,
  workspaceReady: false,
  datasetsPrimed: false,
});

export function useMlReadiness() {
  return useContext(MlReadinessContext);
}

const electronApi = (
  window as unknown as {
    electronApi?: {
      isElectron: boolean;
      getMlStatus?: () => Promise<{
        ml_ready: boolean;
        ml_loading: boolean;
        ml_error: string | null;
        core_ready: boolean;
        workspace_ready?: boolean;
      }>;
      onMlReady?: (
        cb: (info: { ready: boolean; error?: string; workspaceReady?: boolean }) => void
      ) => () => void;
      onBackendStatusChanged?: (
        cb: (info: { status: string }) => void
      ) => () => void;
    };
  }
).electronApi;

export function MlReadinessProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<MlReadiness>(() => ({
    coreReady: false,
    mlReady: false,
    mlLoading: true,
    mlError: null,
    workspaceReady: false,
    // Seed synchronously from any cache that `hydrateDatasetCachesFromStorage`
    // populated at boot — on warm starts the banner should not wait for a
    // fetch we do not need.
    datasetsPrimed:
      queryClient.getQueryData(datasetQueryKeys.list()) !== undefined,
  }));
  const coreReadyFired = useRef(false);
  const workspaceReadyFired = useRef(false);

  // Invalidate all queries when core becomes ready (backend first reachable)
  // and warm dataset caches so the first navigation to /datasets is instant.
  // The dataset list and linked-workspaces endpoints read from app_config.json
  // and do not depend on nirs4all warmup, so they are safe to fire here.
  useEffect(() => {
    if (state.coreReady && !coreReadyFired.current) {
      coreReadyFired.current = true;
      queryClient.invalidateQueries();
      prefetchDatasetsList(queryClient);
    }
  }, [state.coreReady, queryClient]);

  // Invalidate all queries again when ML becomes ready
  useEffect(() => {
    if (state.mlReady) {
      queryClient.invalidateQueries();
    }
  }, [state.mlReady, queryClient]);

  // Invalidate once more when the workspace finishes restoring — until this
  // point, datasets/runs/predictions endpoints return empty results that
  // would otherwise be cached as "no data".
  useEffect(() => {
    if (state.workspaceReady && !workspaceReadyFired.current) {
      workspaceReadyFired.current = true;
      queryClient.invalidateQueries();
    }
  }, [state.workspaceReady, queryClient]);

  // Flip `datasetsPrimed` true as soon as the dataset list cache holds data.
  // The startup banner stays visible until both `workspaceReady` AND this are
  // true, so the user is never left with only the in-card spinner during the
  // React Query refetch that follows the post-workspace invalidation.
  useEffect(() => {
    if (state.datasetsPrimed) return;
    const cache = queryClient.getQueryCache();
    const check = () => {
      if (queryClient.getQueryData(datasetQueryKeys.list()) !== undefined) {
        setState((prev) =>
          prev.datasetsPrimed ? prev : { ...prev, datasetsPrimed: true }
        );
        return true;
      }
      return false;
    };
    if (check()) return;
    const unsubscribe = cache.subscribe(() => {
      if (check()) unsubscribe();
    });
    return unsubscribe;
  }, [state.datasetsPrimed, queryClient]);

  // In Electron: listen for IPC notifications
  useEffect(() => {
    if (state.workspaceReady) return;

    // Listen for backend status changes (core_ready)
    const cleanupStatus = electronApi?.onBackendStatusChanged?.((info) => {
      if (info.status === "running") {
        setState((prev) => ({
          ...prev,
          coreReady: true,
          mlError: null,
        }));
        return;
      }

      if (info.status === "starting" || info.status === "restarting") {
        setState((prev) => ({
          ...prev,
          coreReady: false,
          mlLoading: true,
          mlError: null,
        }));
        return;
      }

      if (info.status === "error") {
        setState((prev) => ({
          ...prev,
          coreReady: false,
          mlLoading: false,
          mlError: "Backend failed to start",
        }));
      }
    });

    // Listen for ML ready notification. The backend-manager fires this twice:
    //   1. ML imports finished (`workspaceReady=false`) — flip `mlReady`
    //   2. Active workspace restored (`workspaceReady=true`) — flip `workspaceReady`
    // Pages that depend on dataset/run/prediction lists must wait for #2 to
    // observe authoritative data.
    const cleanupMl = electronApi?.onMlReady?.((info) => {
      if (info.ready) {
        setState((prev) => ({
          ...prev,
          coreReady: true,
          mlReady: true,
          mlLoading: false,
          mlError: null,
          workspaceReady: info.workspaceReady ? true : prev.workspaceReady,
        }));
      } else if (info.error) {
        setState((prev) => ({ ...prev, mlLoading: false, mlError: info.error ?? null }));
      }
    });

    return () => {
      cleanupStatus?.();
      cleanupMl?.();
    };
  }, [state.workspaceReady]);

  // Poll /api/system/readiness (works in both web and Electron mode).
  // Polls until `workspace_ready` is true — that is the last phase of the
  // backend startup, after which datasets/runs/predictions endpoints are
  // authoritative.
  useEffect(() => {
    if (state.workspaceReady) return;

    const apply = (status: {
      core_ready?: boolean;
      ml_ready?: boolean;
      ml_loading?: boolean;
      ml_error?: string | null;
      workspace_ready?: boolean;
    }) => {
      // Backwards compatibility: a backend that does not expose
      // `workspace_ready` (older builds) is considered ready as soon as
      // `ml_ready` is true — same semantics as before this flag existed.
      const workspaceReady =
        status.workspace_ready ??
        (status.ml_ready ? true : false);
      setState((prev) => ({
        // Readiness only moves backwards on explicit backend status events.
        // Poll responses can race cleanup or transient fetch failures, so a
        // later "false" payload must not resurrect the ML overlay after a
        // previous successful ready signal.
        coreReady: prev.coreReady || !!status.core_ready,
        mlReady: prev.mlReady || !!status.ml_ready,
        mlLoading:
          (prev.mlReady || !!status.ml_ready)
            ? false
            : status.ml_loading ?? prev.mlLoading,
        mlError: status.ml_error ?? prev.mlError,
        workspaceReady: workspaceReady || prev.workspaceReady,
      }));
      return workspaceReady;
    };

    const check = async () => {
      try {
        if (electronApi?.getMlStatus) {
          const status = await electronApi.getMlStatus();
          if (disposed) return true;
          return apply(status);
        }
        const data = await api.get<{
          ml_ready: boolean;
          ml_loading: boolean;
          ml_error: string | null;
          core_ready?: boolean;
          workspace_ready?: boolean;
        }>("/system/readiness");
        if (disposed) return true;
        return apply(data);
      } catch {
        // Backend not available yet, keep polling
        return disposed;
      }
    };

    let disposed = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    const stopPolling = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };

    check().then((ready) => {
      if (disposed || ready) return;

      interval = setInterval(async () => {
        const done = await check();
        if (done || disposed) {
          stopPolling();
        }
      }, 1000);
    });

    return () => {
      disposed = true;
      stopPolling();
    };
  }, [state.workspaceReady]);

  return (
    <MlReadinessContext.Provider value={state}>
      {children}
    </MlReadinessContext.Provider>
  );
}

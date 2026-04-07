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
}

const MlReadinessContext = createContext<MlReadiness>({
  coreReady: false,
  mlReady: false,
  mlLoading: true,
  mlError: null,
  workspaceReady: false,
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
        cb: (info: { ready: boolean; error?: string }) => void
      ) => () => void;
      onBackendStatusChanged?: (
        cb: (info: { status: string }) => void
      ) => () => void;
    };
  }
).electronApi;

export function MlReadinessProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MlReadiness>({
    coreReady: false,
    mlReady: false,
    mlLoading: true,
    mlError: null,
    workspaceReady: false,
  });
  const queryClient = useQueryClient();
  const coreReadyFired = useRef(false);
  const workspaceReadyFired = useRef(false);

  // Invalidate all queries when core becomes ready (backend first reachable)
  useEffect(() => {
    if (state.coreReady && !coreReadyFired.current) {
      coreReadyFired.current = true;
      queryClient.invalidateQueries();
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

  // In Electron: listen for IPC notifications
  useEffect(() => {
    if (state.workspaceReady) return;

    // Listen for backend status changes (core_ready)
    const cleanupStatus = electronApi?.onBackendStatusChanged?.((info) => {
      if (info.status === "running") {
        setState((prev) => ({ ...prev, coreReady: true }));
      }
    });

    // Listen for ML ready notification. Note: this fires when ML imports
    // finish, which is *before* the workspace has been restored. We do not
    // flip `workspaceReady` here — the polling effect below picks that up
    // from `/api/system/readiness`.
    const cleanupMl = electronApi?.onMlReady?.((info) => {
      if (info.ready) {
        setState((prev) => ({
          ...prev,
          coreReady: true,
          mlReady: true,
          mlLoading: false,
          mlError: null,
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
        coreReady: status.core_ready ?? prev.coreReady,
        mlReady: status.ml_ready ?? prev.mlReady,
        mlLoading: status.ml_ready ? false : status.ml_loading ?? prev.mlLoading,
        mlError: status.ml_error ?? prev.mlError,
        workspaceReady: workspaceReady || prev.workspaceReady,
      }));
      return workspaceReady;
    };

    const check = async () => {
      try {
        if (electronApi?.getMlStatus) {
          const status = await electronApi.getMlStatus();
          // The IPC handler proxies /api/system/readiness — if we got a
          // response at all, core is ready.
          return apply({ ...status, core_ready: true });
        }
        const data = await api.get<{
          ml_ready: boolean;
          ml_loading: boolean;
          ml_error: string | null;
          core_ready?: boolean;
          workspace_ready?: boolean;
        }>("/system/readiness");
        return apply({ ...data, core_ready: true });
      } catch {
        // Backend not available yet, keep polling
        return false;
      }
    };

    let cleanupRef: (() => void) | null = null;
    check().then((ready) => {
      if (ready) return;

      const interval = setInterval(async () => {
        const done = await check();
        if (done) clearInterval(interval);
      }, 1000);

      cleanupRef = () => clearInterval(interval);
    });

    return () => cleanupRef?.();
  }, [state.workspaceReady]);

  return (
    <MlReadinessContext.Provider value={state}>
      {children}
    </MlReadinessContext.Provider>
  );
}

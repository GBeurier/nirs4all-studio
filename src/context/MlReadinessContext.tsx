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
}

const MlReadinessContext = createContext<MlReadiness>({
  coreReady: false,
  mlReady: false,
  mlLoading: true,
  mlError: null,
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
  });
  const queryClient = useQueryClient();
  const coreReadyFired = useRef(false);

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

  // In Electron: listen for IPC notifications
  useEffect(() => {
    if (state.mlReady) return;

    // Listen for backend status changes (core_ready)
    const cleanupStatus = electronApi?.onBackendStatusChanged?.((info) => {
      if (info.status === "running") {
        setState((prev) => ({ ...prev, coreReady: true }));
      }
    });

    // Listen for ML ready notification
    const cleanupMl = electronApi?.onMlReady?.((info) => {
      if (info.ready) {
        setState({ coreReady: true, mlReady: true, mlLoading: false, mlError: null });
      } else if (info.error) {
        setState((prev) => ({ ...prev, mlLoading: false, mlError: info.error ?? null }));
      }
    });

    return () => {
      cleanupStatus?.();
      cleanupMl?.();
    };
  }, [state.mlReady]);

  // Poll /api/system/readiness (works in both web and Electron mode)
  useEffect(() => {
    if (state.mlReady) return;

    const check = async () => {
      try {
        if (electronApi?.getMlStatus) {
          const status = await electronApi.getMlStatus();
          if (status.core_ready) {
            setState((prev) => ({ ...prev, coreReady: true }));
          }
          if (status.ml_ready) {
            setState({ coreReady: true, mlReady: true, mlLoading: false, mlError: null });
            return true;
          }
          if (status.core_ready) {
            setState((prev) => ({
              ...prev,
              coreReady: true,
              mlLoading: status.ml_loading ?? true,
              mlError: status.ml_error ?? null,
            }));
          }
        } else {
          const data = await api.get<{
            ml_ready: boolean;
            ml_loading: boolean;
            ml_error: string | null;
            core_ready?: boolean;
          }>("/system/readiness");
          // If we got a response, core is ready
          setState((prev) => ({ ...prev, coreReady: true }));
          if (data.ml_ready) {
            setState({ coreReady: true, mlReady: true, mlLoading: false, mlError: null });
            return true;
          }
          setState((prev) => ({
            ...prev,
            coreReady: true,
            mlLoading: data.ml_loading ?? true,
            mlError: data.ml_error ?? null,
          }));
        }
      } catch {
        // Backend not available yet, keep polling
      }
      return false;
    };

    check().then((ready) => {
      if (ready) return;

      const interval = setInterval(async () => {
        const done = await check();
        if (done) clearInterval(interval);
      }, 1000);

      cleanupRef = () => clearInterval(interval);
    });

    let cleanupRef: (() => void) | null = null;
    return () => cleanupRef?.();
  }, [state.mlReady]);

  return (
    <MlReadinessContext.Provider value={state}>
      {children}
    </MlReadinessContext.Provider>
  );
}

/** Tracks the Rust control plane independently from the optional Python plugin. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/transport";
import { datasetQueryKeys } from "@/hooks/useDatasetQueries";
import { MlReadinessContext, type MlReadiness } from "@/context/useMlReadiness";

type ControlStatus = MlReadiness["controlStatus"];
type ScientificStatus = MlReadiness["scientificStatus"];

interface ScientificReadinessPayload {
  scientific_status?: string;
  scientific_requested?: boolean;
  core_ready?: boolean;
  ml_ready?: boolean;
  ml_loading?: boolean;
  ml_error?: string | null;
  workspace_ready?: boolean;
  native_prediction_ready?: boolean;
  native_training_ready?: boolean;
}

const electronApi = (window as unknown as {
  electronApi?: {
    isElectron: boolean;
    getControlPlaneInfo?: () => Promise<{
      status: ControlStatus;
      ready: boolean;
      error?: string;
    }>;
    getScientificPluginInfo?: () => Promise<{
      status: ScientificStatus;
      ready: boolean;
      requested: boolean;
      error?: string;
    }>;
    getScientificReadiness?: () => Promise<ScientificReadinessPayload>;
    getMlStatus?: () => Promise<ScientificReadinessPayload>;
    onMlReady?: (cb: (info: {
      ready: boolean;
      error?: string;
      workspaceReady?: boolean;
    }) => void) => () => void;
    onBackendStatusChanged?: (cb: (info: {
      status: ScientificStatus;
      error?: string;
    }) => void) => () => void;
  };
}).electronApi;

const initialState = (datasetsPrimed: boolean): MlReadiness => ({
  controlReady: false,
  controlStatus: electronApi?.isElectron ? "starting" : "running",
  controlError: null,
  scientificStatus: "stopped",
  scientificRequested: false,
  coreReady: false,
  mlReady: false,
  mlLoading: false,
  mlError: null,
  nativePredictionReady: false,
  nativeTrainingReady: false,
  workspaceReady: false,
  datasetsPrimed,
});

export function MlReadinessProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<MlReadiness>(() =>
    initialState(queryClient.getQueryData(datasetQueryKeys.list()) !== undefined),
  );
  const workspaceReadyFired = useRef(false);
  const workspaceReadyRef = useRef(false);

  useEffect(() => {
    if (state.mlReady) queryClient.invalidateQueries();
  }, [state.mlReady, queryClient]);

  useEffect(() => {
    if (state.workspaceReady && !workspaceReadyFired.current) {
      workspaceReadyFired.current = true;
      queryClient.invalidateQueries();
    }
  }, [state.workspaceReady, queryClient]);

  useEffect(() => {
    if (state.datasetsPrimed) return;
    const cache = queryClient.getQueryCache();
    const check = () => {
      if (queryClient.getQueryData(datasetQueryKeys.list()) === undefined) return false;
      setState((previous) => previous.datasetsPrimed
        ? previous
        : { ...previous, datasetsPrimed: true });
      return true;
    };
    if (check()) return;
    const unsubscribe = cache.subscribe(() => {
      if (check()) unsubscribe();
    });
    return unsubscribe;
  }, [state.datasetsPrimed, queryClient]);

  useEffect(() => {
    if (!electronApi?.isElectron) return;
    const cleanupStatus = electronApi.onBackendStatusChanged?.((info) => {
      setState((previous) => ({
        ...previous,
        scientificStatus: info.status,
        scientificRequested: true,
        mlLoading: info.status === "starting" || info.status === "restarting",
        mlError: info.status === "error"
          ? info.error ?? "Scientific plugin failed to start"
          : info.status === "running" ? null : previous.mlError,
      }));
    });
    const cleanupMl = electronApi.onMlReady?.((info) => {
      if (info.ready) {
        if (info.workspaceReady) workspaceReadyRef.current = true;
        setState((previous) => ({
          ...previous,
          scientificStatus: "running",
          scientificRequested: true,
          mlReady: true,
          mlLoading: false,
          mlError: null,
          workspaceReady: info.workspaceReady ? true : previous.workspaceReady,
        }));
      } else if (info.error) {
        setState((previous) => ({
          ...previous,
          scientificRequested: true,
          mlLoading: false,
          mlError: info.error ?? null,
        }));
      }
    });
    return () => {
      cleanupStatus?.();
      cleanupMl?.();
    };
  }, []);

  useEffect(() => {
    if (!electronApi?.isElectron) return;
    let disposed = false;
    const check = async () => {
      try {
        const control = await electronApi.getControlPlaneInfo?.();
        if (disposed || !control) return;
        setState((previous) => ({
          ...previous,
          controlReady: control.ready,
          controlStatus: control.status,
          controlError: control.error ?? null,
          coreReady: control.ready,
        }));

        const plugin = await electronApi.getScientificPluginInfo?.();
        if (disposed || !plugin) return;
        setState((previous) => ({
          ...previous,
          scientificStatus: plugin.status,
          scientificRequested: plugin.requested,
          mlLoading: plugin.status === "starting" || plugin.status === "restarting",
          mlError: plugin.error ?? previous.mlError,
        }));
        if (!plugin.ready || workspaceReadyRef.current) return;

        const getReadiness = electronApi.getScientificReadiness ?? electronApi.getMlStatus;
        const readiness = await getReadiness?.();
        if (disposed || !readiness) return;
        if (readiness.workspace_ready) workspaceReadyRef.current = true;
        setState((previous) => ({
          ...previous,
          scientificStatus: (readiness.scientific_status as ScientificStatus)
            ?? previous.scientificStatus,
          scientificRequested: readiness.scientific_requested
            ?? previous.scientificRequested,
          mlReady: previous.mlReady || !!readiness.ml_ready,
          mlLoading: previous.mlReady || readiness.ml_ready
            ? false
            : readiness.ml_loading ?? previous.mlLoading,
          mlError: readiness.ml_error ?? previous.mlError,
          workspaceReady: previous.workspaceReady
            || !!readiness.workspace_ready
            || (!!readiness.ml_ready && readiness.workspace_ready === undefined),
        }));
      } catch (error) {
        if (disposed) return;
        setState((previous) => ({
          ...previous,
          controlError: previous.controlReady
            ? previous.controlError
            : error instanceof Error ? error.message : String(error),
        }));
      }
    };
    void check();
    const interval = setInterval(check, 1000);
    return () => {
      disposed = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const readiness = await api.get<ScientificReadinessPayload>("/system/readiness");
        if (disposed) return;
        if (!readiness || typeof readiness !== "object") {
          throw new Error("Invalid runtime readiness response");
        }
        // The Rust endpoint is also authoritative for native capabilities in
        // Electron. Do not gate this poll on the optional Python plugin.
        if (electronApi?.isElectron) {
          setState((previous) => ({
            ...previous,
            nativePredictionReady: !!readiness.native_prediction_ready,
            nativeTrainingReady: !!readiness.native_training_ready,
            workspaceReady: readiness.workspace_ready ?? previous.workspaceReady,
          }));
          return;
        }
        setState((previous) => ({
          ...previous,
          controlReady: previous.controlReady || !!readiness.core_ready,
          controlStatus: readiness.core_ready ? "running" : "starting",
          coreReady: previous.coreReady || !!readiness.core_ready,
          nativePredictionReady: !!readiness.native_prediction_ready,
          nativeTrainingReady: !!readiness.native_training_ready,
          scientificStatus: readiness.core_ready ? "running" : "starting",
          scientificRequested: true,
          mlReady: previous.mlReady || !!readiness.ml_ready,
          mlLoading: previous.mlReady || readiness.ml_ready
            ? false
            : readiness.ml_loading ?? previous.mlLoading,
          mlError: readiness.ml_error ?? previous.mlError,
          workspaceReady: previous.workspaceReady
            || !!(readiness.workspace_ready ?? readiness.ml_ready),
        }));
      } catch {
        // The externally managed web backend may still be starting.
        if (!disposed) setState((previous) => ({
          ...previous,
          nativePredictionReady: false,
          nativeTrainingReady: false,
        }));
      } finally {
        checking = false;
      }
    };
    void check();
    const interval = setInterval(check, 1000);
    return () => {
      disposed = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <MlReadinessContext.Provider value={state}>
      {children}
    </MlReadinessContext.Provider>
  );
}

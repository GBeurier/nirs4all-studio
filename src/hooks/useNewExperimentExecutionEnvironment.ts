import { useQuery } from "@tanstack/react-query";

import { createRunGroup, getRunExecutionBackends } from "@/api/runs";
import {
  buildNewExperimentExecutionEnvironment,
  DEFAULT_NEW_EXPERIMENT_EXECUTION_ENVIRONMENT,
  normalizeNewExperimentExecutionEnvironmentOptions,
  type BuildNewExperimentExecutionEnvironmentOptions,
  type NewExperimentExecutionEnvironmentDiagnostics,
  type NewExperimentExecutionEnvironment,
} from "@/lib/experimentExecutionEnvironment";

export type NewExperimentExecutionEnvironmentBridge = BuildNewExperimentExecutionEnvironmentOptions;

declare global {
  interface Window {
    nirs4allStudioExecutionEnvironment?: NewExperimentExecutionEnvironmentBridge;
  }
}

export {
  buildNewExperimentExecutionEnvironment,
  DEFAULT_NEW_EXPERIMENT_EXECUTION_ENVIRONMENT,
  DEFAULT_NEW_EXPERIMENT_LAUNCH_SUBMITTERS,
  normalizeNewExperimentExecutionEnvironmentOptions,
  type BuildNewExperimentExecutionEnvironmentOptions,
  type NewExperimentExecutionEnvironment,
  type NewExperimentExecutionEnvironmentDiagnostics,
  type NewExperimentNativeBackendAvailability,
  type NewExperimentNativeBackendAvailabilityStatus,
  type NewExperimentNativeExecutionBackend,
} from "@/lib/experimentExecutionEnvironment";

export function getNewExperimentExecutionEnvironmentBridge(): NewExperimentExecutionEnvironmentBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return window.nirs4allStudioExecutionEnvironment;
}

export function useNewExperimentExecutionEnvironment(): NewExperimentExecutionEnvironment {
  const { data: executionBackends } = useQuery({
    queryKey: ["runs", "execution-backends"],
    queryFn: getRunExecutionBackends,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const bridge = normalizeNewExperimentExecutionEnvironmentOptions(
    getNewExperimentExecutionEnvironmentBridge(),
  );
  const backendCapabilities = executionBackends?.backends;
  const electronApi = typeof window !== "undefined" ? window.electronApi : undefined;
  const { data: nativeLocalTransport } = useQuery({
    queryKey: ["renderer-transport", "POST /runs/run-groups"],
    queryFn: () => electronApi!.preselectRendererTransport({ kind: "http", method: "POST", path: "/runs/run-groups" }),
    enabled: Boolean(electronApi?.isElectron && electronApi.preselectRendererTransport),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const nativeLocalReady = nativeLocalTransport?.target === "native-sidecar";
  const nativeLocal = nativeLocalReady
    ? { submitNativeLocalRun: createRunGroup } : {};
  if (!bridge && !backendCapabilities?.length && !nativeLocalReady) {
    return DEFAULT_NEW_EXPERIMENT_EXECUTION_ENVIRONMENT;
  }
  return buildNewExperimentExecutionEnvironment({
    ...nativeLocal,
    ...(bridge ?? {}),
    executionBackendCapabilities: backendCapabilities ?? bridge?.executionBackendCapabilities,
  });
}

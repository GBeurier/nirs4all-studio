import type {
  NewExperimentExecutionEnvironmentDiagnostics,
  NewExperimentNativeExecutionBackend,
} from "./experimentExecutionEnvironment";
import type { RunExecutionBackend } from "@/types/runs";

export interface NewExperimentExecutionEnvironmentDiagnosticField {
  id: string;
  label: string;
  value: string;
}

function presentLabels(labels: Array<string | null>): string[] {
  return labels.filter((label): label is string => label != null);
}

function formatNativeBackendList(backends: readonly NewExperimentNativeExecutionBackend[]): string {
  return backends.length > 0 ? backends.join(", ") : "None";
}

function formatExecutionBackendList(backends: readonly RunExecutionBackend[]): string {
  return backends.length > 0 ? backends.join(", ") : "None";
}

export function buildNewExperimentExecutionEnvironmentDiagnosticFields(
  diagnostics: NewExperimentExecutionEnvironmentDiagnostics,
): NewExperimentExecutionEnvironmentDiagnosticField[] {
  const configuredSubmitters = presentLabels([
    diagnostics.hasClusterSubmitter ? "cluster" : null,
    diagnostics.hasWasmLocalSubmitter ? "wasm-local" : null,
  ]);

  return [
    {
      id: "available-adapters",
      label: "Adapters",
      value: diagnostics.availableAdapterIds.length > 0
        ? diagnostics.availableAdapterIds.join(", ")
        : "None",
    },
    {
      id: "available-execution-backends",
      label: "Available backends",
      value: formatExecutionBackendList(diagnostics.availableExecutionBackends ?? []),
    },
    {
      id: "configured-native-backends",
      label: "Configured native",
      value: formatNativeBackendList(diagnostics.configuredNativeBackends),
    },
    {
      id: "unavailable-execution-backends",
      label: "Unavailable backends",
      value: formatExecutionBackendList(diagnostics.unavailableExecutionBackends ?? []),
    },
    {
      id: "unconfigured-native-backends",
      label: "Unconfigured native",
      value: formatNativeBackendList(diagnostics.unconfiguredNativeBackends),
    },
    {
      id: "submitters",
      label: "Submitters",
      value: configuredSubmitters.length > 0 ? configuredSubmitters.join(", ") : "None",
    },
    {
      id: "workspace-prediction-publishers",
      label: "Prediction publishers",
      value: formatNativeBackendList(diagnostics.workspacePredictionPublisherBackends),
    },
    {
      id: "workspace-prediction-handoff-only",
      label: "Prediction handoff-only",
      value: formatNativeBackendList(diagnostics.workspacePredictionHandoffOnlyBackends),
    },
  ];
}

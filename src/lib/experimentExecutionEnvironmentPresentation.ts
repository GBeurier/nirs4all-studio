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
      label: "Calculation options",
      value: diagnostics.availableAdapterIds.length > 0
        ? diagnostics.availableAdapterIds.join(", ")
        : "None",
    },
    {
      id: "available-execution-backends",
      label: "Available analysis engines",
      value: formatExecutionBackendList(diagnostics.availableExecutionBackends ?? []),
    },
    {
      id: "configured-native-backends",
      label: "Ready to use",
      value: formatNativeBackendList(diagnostics.configuredNativeBackends),
    },
    {
      id: "unavailable-execution-backends",
      label: "Unavailable analysis engines",
      value: formatExecutionBackendList(diagnostics.unavailableExecutionBackends ?? []),
    },
    {
      id: "unconfigured-native-backends",
      label: "Setup required",
      value: formatNativeBackendList(diagnostics.unconfiguredNativeBackends),
    },
    {
      id: "submitters",
      label: "Ready to launch",
      value: configuredSubmitters.length > 0 ? configuredSubmitters.join(", ") : "None",
    },
    {
      id: "workspace-prediction-publishers",
      label: "Prediction saving available",
      value: formatNativeBackendList(diagnostics.workspacePredictionPublisherBackends),
    },
    {
      id: "workspace-prediction-handoff-only",
      label: "Prediction saving not configured",
      value: formatNativeBackendList(diagnostics.workspacePredictionHandoffOnlyBackends),
    },
  ];
}

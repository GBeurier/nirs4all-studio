import i18n from "i18next";

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
  return backends.length > 0 ? backends.join(", ") : i18n.t("common.none");
}

function formatExecutionBackendList(backends: readonly RunExecutionBackend[]): string {
  return backends.length > 0 ? backends.join(", ") : i18n.t("common.none");
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
      label: i18n.t("newExperiment.environment.diagnostics.calculationOptions"),
      value: diagnostics.availableAdapterIds.length > 0
        ? diagnostics.availableAdapterIds.join(", ")
        : i18n.t("common.none"),
    },
    {
      id: "available-execution-backends",
      label: i18n.t("newExperiment.environment.diagnostics.availableEngines"),
      value: formatExecutionBackendList(diagnostics.availableExecutionBackends ?? []),
    },
    {
      id: "configured-native-backends",
      label: i18n.t("newExperiment.environment.diagnostics.readyToUse"),
      value: formatNativeBackendList(diagnostics.configuredNativeBackends),
    },
    {
      id: "unavailable-execution-backends",
      label: i18n.t("newExperiment.environment.diagnostics.unavailableEngines"),
      value: formatExecutionBackendList(diagnostics.unavailableExecutionBackends ?? []),
    },
    {
      id: "unconfigured-native-backends",
      label: i18n.t("newExperiment.environment.diagnostics.setupRequired"),
      value: formatNativeBackendList(diagnostics.unconfiguredNativeBackends),
    },
    {
      id: "submitters",
      label: i18n.t("newExperiment.environment.diagnostics.readyToLaunch"),
      value: configuredSubmitters.length > 0 ? configuredSubmitters.join(", ") : i18n.t("common.none"),
    },
    {
      id: "workspace-prediction-publishers",
      label: i18n.t("newExperiment.environment.diagnostics.predictionSavingAvailable"),
      value: formatNativeBackendList(diagnostics.workspacePredictionPublisherBackends),
    },
    {
      id: "workspace-prediction-handoff-only",
      label: i18n.t("newExperiment.environment.diagnostics.predictionSavingNotConfigured"),
      value: formatNativeBackendList(diagnostics.workspacePredictionHandoffOnlyBackends),
    },
  ];
}

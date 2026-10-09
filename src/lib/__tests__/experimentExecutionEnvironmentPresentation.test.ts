import "@/lib/__tests__/support/experimentI18n";
import { describe, expect, it } from "vitest";

import { buildNewExperimentExecutionEnvironmentDiagnosticFields } from "../experimentExecutionEnvironmentPresentation";

describe("experimentExecutionEnvironmentPresentation", () => {
  it("builds execution environment diagnostic fields", () => {
    expect(buildNewExperimentExecutionEnvironmentDiagnosticFields({
      availableAdapterIds: ["legacy-local", "cluster"],
      availableExecutionBackends: ["local-python"],
      configuredNativeBackends: ["cluster"],
      unconfiguredNativeBackends: ["wasm-local"],
      unavailableExecutionBackends: ["wasm-local"],
      unavailableNativeBackends: ["wasm-local"],
      workspacePredictionPublisherBackends: ["cluster"],
      workspacePredictionHandoffOnlyBackends: ["wasm-local"],
      hasClusterSubmitter: true,
      hasWasmLocalSubmitter: false,
    })).toEqual([
      { id: "available-adapters", label: "Calculation options", value: "legacy-local, cluster" },
      { id: "available-execution-backends", label: "Available analysis engines", value: "local-python" },
      { id: "configured-native-backends", label: "Ready to use", value: "cluster" },
      { id: "unavailable-execution-backends", label: "Unavailable analysis engines", value: "wasm-local" },
      { id: "unconfigured-native-backends", label: "Setup required", value: "wasm-local" },
      { id: "submitters", label: "Ready to launch", value: "cluster" },
      { id: "workspace-prediction-publishers", label: "Prediction saving available", value: "cluster" },
      { id: "workspace-prediction-handoff-only", label: "Prediction saving not configured", value: "wasm-local" },
    ]);

    expect(buildNewExperimentExecutionEnvironmentDiagnosticFields({
      availableAdapterIds: [],
      configuredNativeBackends: [],
      unconfiguredNativeBackends: ["cluster", "wasm-local"],
      workspacePredictionPublisherBackends: [],
      workspacePredictionHandoffOnlyBackends: [],
      hasClusterSubmitter: false,
      hasWasmLocalSubmitter: false,
    })).toEqual([
      { id: "available-adapters", label: "Calculation options", value: "None" },
      { id: "available-execution-backends", label: "Available analysis engines", value: "None" },
      { id: "configured-native-backends", label: "Ready to use", value: "None" },
      { id: "unavailable-execution-backends", label: "Unavailable analysis engines", value: "None" },
      { id: "unconfigured-native-backends", label: "Setup required", value: "cluster, wasm-local" },
      { id: "submitters", label: "Ready to launch", value: "None" },
      { id: "workspace-prediction-publishers", label: "Prediction saving available", value: "None" },
      { id: "workspace-prediction-handoff-only", label: "Prediction saving not configured", value: "None" },
    ]);
  });
});

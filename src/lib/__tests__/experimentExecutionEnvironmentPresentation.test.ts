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
      { id: "available-adapters", label: "Adapters", value: "legacy-local, cluster" },
      { id: "available-execution-backends", label: "Available backends", value: "local-python" },
      { id: "configured-native-backends", label: "Configured native", value: "cluster" },
      { id: "unavailable-execution-backends", label: "Unavailable backends", value: "wasm-local" },
      { id: "unconfigured-native-backends", label: "Unconfigured native", value: "wasm-local" },
      { id: "submitters", label: "Submitters", value: "cluster" },
      { id: "workspace-prediction-publishers", label: "Prediction publishers", value: "cluster" },
      { id: "workspace-prediction-handoff-only", label: "Prediction handoff-only", value: "wasm-local" },
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
      { id: "available-adapters", label: "Adapters", value: "None" },
      { id: "available-execution-backends", label: "Available backends", value: "None" },
      { id: "configured-native-backends", label: "Configured native", value: "None" },
      { id: "unavailable-execution-backends", label: "Unavailable backends", value: "None" },
      { id: "unconfigured-native-backends", label: "Unconfigured native", value: "cluster, wasm-local" },
      { id: "submitters", label: "Submitters", value: "None" },
      { id: "workspace-prediction-publishers", label: "Prediction publishers", value: "None" },
      { id: "workspace-prediction-handoff-only", label: "Prediction handoff-only", value: "None" },
    ]);
  });
});

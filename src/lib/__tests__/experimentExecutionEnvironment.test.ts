import { describe, expect, it, vi } from "vitest";

import {
  CLUSTER_EXPERIMENT_EXECUTION_ADAPTER,
  LEGACY_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
  WASM_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
} from "../experimentExecutionAdapter";
import {
  buildNewExperimentExecutionEnvironmentDiagnostics,
  buildNewExperimentExecutionEnvironment,
  DEFAULT_NEW_EXPERIMENT_EXECUTION_ENVIRONMENT,
  normalizeNewExperimentExecutionEnvironmentOptions,
} from "../experimentExecutionEnvironment";
import type { RunExecutionBackendCapability } from "@/types/runs";

const backendCapabilities: RunExecutionBackendCapability[] = [
  {
    backend: "local-python",
    label: "Local Python",
    available: true,
    mode: "in-process",
    supports_progress: true,
    supports_cancellation: true,
    metadata: {},
  },
  {
    backend: "cluster",
    label: "Cluster",
    available: false,
    mode: "in-process",
    supports_progress: false,
    supports_cancellation: false,
    metadata: {
      reason: "driver_unavailable",
      message: "Cluster execution is typed but no cluster driver is configured.",
    },
  },
  {
    backend: "wasm-local",
    label: "WASM Local",
    available: false,
    mode: "in-process",
    supports_progress: false,
    supports_cancellation: false,
    metadata: {
      reason: "driver_unavailable",
      message: "WASM local execution is typed but no WASM driver is configured.",
    },
  },
];

describe("experimentExecutionEnvironment", () => {
  it("keeps the default environment legacy-only until native submitters are available", () => {
    expect(buildNewExperimentExecutionEnvironment()).toBe(DEFAULT_NEW_EXPERIMENT_EXECUTION_ENVIRONMENT);
    expect(buildNewExperimentExecutionEnvironment().availableExecutionAdapters).toEqual([
      LEGACY_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
    ]);
    expect(buildNewExperimentExecutionEnvironment().launchSubmitters).toEqual({});
    expect(buildNewExperimentExecutionEnvironment().nativeBackendAvailability).toEqual([
      {
        backend: "cluster",
        adapterId: "cluster",
        status: "not_configured",
        statusLabel: "Not configured",
        message: "Cluster execution is typed but no native submitter is configured.",
      },
      {
        backend: "wasm-local",
        adapterId: "wasm-local",
        status: "not_configured",
        statusLabel: "Not configured",
        message: "WASM local execution is typed but no native submitter is configured.",
      },
    ]);
    expect(buildNewExperimentExecutionEnvironment().workspacePredictionPublicationAvailability).toEqual([
      {
        backend: "cluster",
        status: "not_configured",
        statusLabel: "Not configured",
        destination: "result_metadata.robustness_evidence",
        message: "Cluster execution is typed but no workspace prediction publisher is configured.",
      },
      {
        backend: "wasm-local",
        status: "not_configured",
        statusLabel: "Not configured",
        destination: "result_metadata.robustness_evidence",
        message: "WASM local execution is typed but no persistent workspace prediction publisher is configured.",
      },
    ]);
    expect(buildNewExperimentExecutionEnvironment().diagnostics).toEqual({
      availableAdapterIds: ["legacy-local"],
      availableExecutionBackends: [],
      configuredNativeBackends: [],
      unconfiguredNativeBackends: ["cluster", "wasm-local"],
      unavailableExecutionBackends: [],
      unavailableNativeBackends: [],
      workspacePredictionPublisherBackends: [],
      workspacePredictionHandoffOnlyBackends: [],
      hasClusterSubmitter: false,
      hasWasmLocalSubmitter: false,
    });
  });

  it("adds native adapters and availability only when their submitters are wired", () => {
    const submitClusterRun = vi.fn(async () => ({ id: "cluster-run-1" }) as never);
    const submitWasmLocalRun = vi.fn(async () => ({ id: "wasm-run-1" }) as never);

    const clusterEnvironment = buildNewExperimentExecutionEnvironment({ submitClusterRun });
    expect(clusterEnvironment.availableExecutionAdapters).toEqual([
      LEGACY_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
      CLUSTER_EXPERIMENT_EXECUTION_ADAPTER,
    ]);
    expect(clusterEnvironment.launchSubmitters).toEqual({ submitClusterRun });
    expect(clusterEnvironment.nativeBackendAvailability).toEqual([
      {
        backend: "cluster",
        adapterId: "cluster",
        status: "available",
        statusLabel: "Available",
        message: "Cluster execution submitter is configured.",
      },
      {
        backend: "wasm-local",
        adapterId: "wasm-local",
        status: "not_configured",
        statusLabel: "Not configured",
        message: "WASM local execution is typed but no native submitter is configured.",
      },
    ]);
    expect(clusterEnvironment.workspacePredictionPublicationAvailability).toEqual([
      {
        backend: "cluster",
        status: "handoff_only",
        statusLabel: "Handoff only",
        destination: "result_metadata.robustness_evidence",
        message: "Cluster execution submitter is configured. Workspace prediction evidence requests remain handoff-only until a concrete publisher/store is configured.",
      },
      {
        backend: "wasm-local",
        status: "not_configured",
        statusLabel: "Not configured",
        destination: "result_metadata.robustness_evidence",
        message: "WASM local execution is typed but no native submitter is configured. Workspace prediction publication is not available.",
      },
    ]);
    expect(clusterEnvironment.diagnostics).toEqual({
      availableAdapterIds: ["legacy-local", "cluster"],
      availableExecutionBackends: [],
      configuredNativeBackends: ["cluster"],
      unconfiguredNativeBackends: ["wasm-local"],
      unavailableExecutionBackends: [],
      unavailableNativeBackends: [],
      workspacePredictionPublisherBackends: [],
      workspacePredictionHandoffOnlyBackends: ["cluster"],
      hasClusterSubmitter: true,
      hasWasmLocalSubmitter: false,
    });

    const fullEnvironment = buildNewExperimentExecutionEnvironment({
      submitClusterRun,
      submitWasmLocalRun,
    });
    expect(fullEnvironment.availableExecutionAdapters).toEqual([
      LEGACY_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
      CLUSTER_EXPERIMENT_EXECUTION_ADAPTER,
      WASM_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
    ]);
    expect(fullEnvironment.launchSubmitters).toEqual({
      submitClusterRun,
      submitWasmLocalRun,
    });
    expect(fullEnvironment.nativeBackendAvailability).toEqual([
      {
        backend: "cluster",
        adapterId: "cluster",
        status: "available",
        statusLabel: "Available",
        message: "Cluster execution submitter is configured.",
      },
      {
        backend: "wasm-local",
        adapterId: "wasm-local",
        status: "available",
        statusLabel: "Available",
        message: "WASM local execution submitter is configured.",
      },
    ]);
    expect(fullEnvironment.workspacePredictionPublicationAvailability).toEqual([
      {
        backend: "cluster",
        status: "handoff_only",
        statusLabel: "Handoff only",
        destination: "result_metadata.robustness_evidence",
        message: "Cluster execution submitter is configured. Workspace prediction evidence requests remain handoff-only until a concrete publisher/store is configured.",
      },
      {
        backend: "wasm-local",
        status: "handoff_only",
        statusLabel: "Handoff only",
        destination: "result_metadata.robustness_evidence",
        message: "WASM local execution submitter is configured. Workspace prediction evidence requests remain handoff-only until a concrete publisher/store is configured.",
      },
    ]);
    expect(fullEnvironment.diagnostics).toEqual({
      availableAdapterIds: ["legacy-local", "cluster", "wasm-local"],
      availableExecutionBackends: [],
      configuredNativeBackends: ["cluster", "wasm-local"],
      unconfiguredNativeBackends: [],
      unavailableExecutionBackends: [],
      unavailableNativeBackends: [],
      workspacePredictionPublisherBackends: [],
      workspacePredictionHandoffOnlyBackends: ["cluster", "wasm-local"],
      hasClusterSubmitter: true,
      hasWasmLocalSubmitter: true,
    });
  });

  it("marks workspace prediction publication configured only for declared publisher backends", () => {
    const submitClusterRun = vi.fn(async () => ({ id: "cluster-run-1" }) as never);
    const submitWasmLocalRun = vi.fn(async () => ({ id: "wasm-run-1" }) as never);

    const environment = buildNewExperimentExecutionEnvironment({
      submitClusterRun,
      submitWasmLocalRun,
      workspacePredictionPublicationBackends: ["cluster"],
    });

    expect(environment.workspacePredictionPublicationAvailability).toEqual([
      {
        backend: "cluster",
        status: "publisher_configured",
        statusLabel: "Publisher configured",
        destination: "result_metadata.robustness_evidence",
        message: "Cluster execution submitter is configured. Workspace prediction evidence publication is configured for result_metadata.robustness_evidence.",
      },
      {
        backend: "wasm-local",
        status: "handoff_only",
        statusLabel: "Handoff only",
        destination: "result_metadata.robustness_evidence",
        message: "WASM local execution submitter is configured. Workspace prediction evidence requests remain handoff-only until a concrete publisher/store is configured.",
      },
    ]);
    expect(environment.diagnostics).toMatchObject({
      workspacePredictionPublisherBackends: ["cluster"],
      workspacePredictionHandoffOnlyBackends: ["wasm-local"],
    });
  });

  it("marks workspace prediction publication configured from backend capability metadata", () => {
    const submitClusterRun = vi.fn(async () => ({ id: "cluster-run-1" }) as never);
    const clusterPublisherCapabilities: RunExecutionBackendCapability[] = [
      backendCapabilities[0],
      {
        backend: "cluster",
        label: "Cluster",
        available: true,
        mode: "in-process",
        supports_progress: true,
        supports_cancellation: true,
        metadata: {
          workspace_prediction_publication: {
            destination: "result_metadata.robustness_evidence",
            publisher: "nirs4all-cluster.runner",
            status: "publisher_configured",
          },
        },
      },
      backendCapabilities[2],
    ];

    const environment = buildNewExperimentExecutionEnvironment({
      executionBackendCapabilities: clusterPublisherCapabilities,
      submitClusterRun,
    });

    expect(environment.workspacePredictionPublicationAvailability).toEqual([
      {
        backend: "cluster",
        status: "publisher_configured",
        statusLabel: "Publisher configured",
        destination: "result_metadata.robustness_evidence",
        message: "Cluster execution submitter is configured. Workspace prediction evidence publication is configured for result_metadata.robustness_evidence.",
      },
      {
        backend: "wasm-local",
        status: "backend_unavailable",
        statusLabel: "Unavailable",
        destination: "result_metadata.robustness_evidence",
        message: "Unavailable: WASM local execution is typed but no WASM driver is configured.",
      },
    ]);
    expect(environment.diagnostics).toMatchObject({
      workspacePredictionPublisherBackends: ["cluster"],
      workspacePredictionHandoffOnlyBackends: [],
    });
  });

  it("keeps backend-unavailable capabilities visible without enabling native submitters", () => {
    const submitClusterRun = vi.fn(async () => ({ id: "cluster-run-1" }) as never);
    const environment = buildNewExperimentExecutionEnvironment({
      executionBackendCapabilities: backendCapabilities,
      submitClusterRun,
    });

    expect(environment.executionBackendCapabilities).toBe(backendCapabilities);
    expect(environment.availableExecutionAdapters).toEqual([
      LEGACY_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
    ]);
    expect(environment.launchSubmitters).toEqual({});
    expect(environment.nativeBackendAvailability).toEqual([
      {
        backend: "cluster",
        adapterId: "cluster",
        status: "backend_unavailable",
        statusLabel: "Unavailable",
        message: "Cluster execution is typed but no cluster driver is configured.",
      },
      {
        backend: "wasm-local",
        adapterId: "wasm-local",
        status: "backend_unavailable",
        statusLabel: "Unavailable",
        message: "WASM local execution is typed but no WASM driver is configured.",
      },
    ]);
    expect(environment.diagnostics).toEqual({
      availableAdapterIds: ["legacy-local"],
      availableExecutionBackends: ["local-python"],
      configuredNativeBackends: [],
      unconfiguredNativeBackends: ["cluster", "wasm-local"],
      unavailableExecutionBackends: ["cluster", "wasm-local"],
      unavailableNativeBackends: ["cluster", "wasm-local"],
      workspacePredictionPublisherBackends: [],
      workspacePredictionHandoffOnlyBackends: [],
      hasClusterSubmitter: false,
      hasWasmLocalSubmitter: false,
    });
  });

  it("builds execution environment diagnostics from environment parts", () => {
    const submitWasmLocalRun = vi.fn(async () => ({ id: "wasm-run-1" }) as never);

    expect(buildNewExperimentExecutionEnvironmentDiagnostics({
      availableExecutionAdapters: [
        LEGACY_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
        WASM_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
      ],
      launchSubmitters: { submitWasmLocalRun },
      executionBackendCapabilities: backendCapabilities,
      nativeBackendAvailability: [
        {
          backend: "cluster",
          adapterId: "cluster",
          status: "not_configured",
          statusLabel: "Not configured",
          message: "Cluster execution is typed but no native submitter is configured.",
        },
        {
          backend: "wasm-local",
          adapterId: "wasm-local",
          status: "available",
          statusLabel: "Available",
          message: "WASM local execution submitter is configured.",
        },
      ],
      workspacePredictionPublicationAvailability: [
        {
          backend: "cluster",
          status: "not_configured",
          statusLabel: "Not configured",
          destination: "result_metadata.robustness_evidence",
          message: "Cluster execution is typed but no native submitter is configured. Workspace prediction publication is not available.",
        },
        {
          backend: "wasm-local",
          status: "publisher_configured",
          statusLabel: "Publisher configured",
          destination: "result_metadata.robustness_evidence",
          message: "WASM local execution submitter is configured. Workspace prediction evidence publication is configured for result_metadata.robustness_evidence.",
        },
      ],
    })).toEqual({
      availableAdapterIds: ["legacy-local", "wasm-local"],
      availableExecutionBackends: ["local-python"],
      configuredNativeBackends: ["wasm-local"],
      unconfiguredNativeBackends: ["cluster"],
      unavailableExecutionBackends: ["cluster", "wasm-local"],
      unavailableNativeBackends: [],
      workspacePredictionPublisherBackends: ["wasm-local"],
      workspacePredictionHandoffOnlyBackends: [],
      hasClusterSubmitter: false,
      hasWasmLocalSubmitter: true,
    });
  });

  it("normalizes runtime execution environment submitters", () => {
    const submitClusterRun = vi.fn(async () => ({ id: "cluster-run-1" }) as never);
    const submitWasmLocalRun = vi.fn(async () => ({ id: "wasm-run-1" }) as never);

    expect(normalizeNewExperimentExecutionEnvironmentOptions(undefined)).toBeUndefined();
    expect(normalizeNewExperimentExecutionEnvironmentOptions(null)).toBeUndefined();
    expect(normalizeNewExperimentExecutionEnvironmentOptions("not-a-bridge")).toBeUndefined();
    expect(normalizeNewExperimentExecutionEnvironmentOptions({
      submitClusterRun: "not-a-function",
      submitWasmLocalRun: null,
    })).toBeUndefined();

    expect(normalizeNewExperimentExecutionEnvironmentOptions({
      submitClusterRun,
      submitWasmLocalRun: "not-a-function",
    })).toEqual({ submitClusterRun });

    expect(normalizeNewExperimentExecutionEnvironmentOptions({
      submitClusterRun: 42,
      submitWasmLocalRun,
    })).toEqual({ submitWasmLocalRun });

    expect(normalizeNewExperimentExecutionEnvironmentOptions({
      submitClusterRun,
      submitWasmLocalRun,
    })).toEqual({
      submitClusterRun,
      submitWasmLocalRun,
    });

    expect(normalizeNewExperimentExecutionEnvironmentOptions({
      executionBackendCapabilities: backendCapabilities,
      workspacePredictionPublicationBackends: ["cluster", "unknown", "cluster"],
      submitClusterRun,
    })).toEqual({
      executionBackendCapabilities: backendCapabilities,
      workspacePredictionPublicationBackends: ["cluster"],
      submitClusterRun,
    });
  });
});

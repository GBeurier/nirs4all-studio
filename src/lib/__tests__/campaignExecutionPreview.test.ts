import { describe, expect, it } from "vitest";

import {
  CLUSTER_EXPERIMENT_EXECUTION_ADAPTER,
  LEGACY_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
  WASM_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
} from "../experimentExecutionAdapter";
import { DEFAULT_NEW_EXPERIMENT_EXECUTION_ENVIRONMENT } from "../experimentExecutionEnvironment";
import {
  buildCampaignExecutionAdapterPreview,
  getCampaignExecutionBackendLabel,
} from "../campaignExecutionPreview";

describe("campaignExecutionPreview", () => {
  it("labels campaign execution backends", () => {
    expect(getCampaignExecutionBackendLabel("local-python")).toBe("Local Python");
    expect(getCampaignExecutionBackendLabel("cluster")).toBe("Cluster");
    expect(getCampaignExecutionBackendLabel("wasm-local")).toBe("WASM local");
  });

  it("builds a native adapter preview for local Python campaigns", () => {
    expect(buildCampaignExecutionAdapterPreview({ executionBackend: "local-python" })).toEqual({
      id: "legacy-local",
      label: "Legacy local run API",
      statusLabel: "Native adapter",
      message: "Launches use the current local run API.",
    });
  });

  it("builds a legacy fallback adapter preview for future backends", () => {
    expect(buildCampaignExecutionAdapterPreview({ executionBackend: "cluster" })).toEqual({
      id: "legacy-local",
      label: "Legacy local run API",
      statusLabel: "Legacy fallback",
      message: "No native adapter is wired for this backend yet; launches still target the legacy local run API.",
    });
    expect(buildCampaignExecutionAdapterPreview({ executionBackend: "wasm-local" })).toEqual({
      id: "legacy-local",
      label: "Legacy local run API",
      statusLabel: "Legacy fallback",
      message: "No native adapter is wired for this backend yet; launches still target the legacy local run API.",
    });
  });

  it("uses native backend availability messages when future backends fall back", () => {
    expect(buildCampaignExecutionAdapterPreview(
      { executionBackend: "cluster" },
      { nativeBackendAvailability: DEFAULT_NEW_EXPERIMENT_EXECUTION_ENVIRONMENT.nativeBackendAvailability },
    )).toEqual({
      id: "legacy-local",
      label: "Legacy local run API",
      statusLabel: "Legacy fallback",
      message: "Cluster execution is typed but no native submitter is configured.",
    });
    expect(buildCampaignExecutionAdapterPreview(
      { executionBackend: "wasm-local" },
      { nativeBackendAvailability: DEFAULT_NEW_EXPERIMENT_EXECUTION_ENVIRONMENT.nativeBackendAvailability },
    )).toEqual({
      id: "legacy-local",
      label: "Legacy local run API",
      statusLabel: "Legacy fallback",
      message: "WASM local execution is typed but no native submitter is configured.",
    });
  });

  it("keeps fallback adapter messages when availability and adapter registry disagree", () => {
    expect(buildCampaignExecutionAdapterPreview(
      { executionBackend: "cluster" },
      {
        nativeBackendAvailability: [{
          backend: "cluster",
          adapterId: "cluster",
          status: "available",
          statusLabel: "Available",
          message: "Cluster execution submitter is configured.",
        }],
      },
    )).toEqual({
      id: "legacy-local",
      label: "Legacy local run API",
      statusLabel: "Legacy fallback",
      message: "No native adapter is wired for this backend yet; launches still target the legacy local run API.",
    });
  });

  it("builds native adapter previews from an injected adapter registry", () => {
    const availableExecutionAdapters = [
      LEGACY_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
      CLUSTER_EXPERIMENT_EXECUTION_ADAPTER,
      WASM_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
    ];

    expect(buildCampaignExecutionAdapterPreview(
      { executionBackend: "cluster" },
      { availableExecutionAdapters },
    )).toEqual({
      id: "cluster",
      label: "Cluster execution adapter",
      statusLabel: "Native adapter",
      message: "Cluster execution adapter is selected for this campaign backend.",
    });
  });
});

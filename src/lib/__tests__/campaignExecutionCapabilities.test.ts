import { describe, expect, it } from "vitest";

import {
  getCampaignExecutionBackendCapabilityStatus,
  isNativeCampaignExecutionAdapter,
  isNativeCampaignExecutionAdapterForBackend,
} from "../campaignExecutionCapabilities";

describe("campaignExecutionCapabilities", () => {
  it("detects native execution adapters from the adapter id for each backend", () => {
    const clusterAdapter = {
      id: "cluster",
      label: "Cluster execution adapter",
      statusLabel: "Ready",
      message: "Cluster execution adapter is selected for this campaign backend.",
    };

    expect(isNativeCampaignExecutionAdapter(clusterAdapter)).toBe(false);
    expect(isNativeCampaignExecutionAdapterForBackend({
      executionBackend: "cluster",
    }, clusterAdapter)).toBe(true);
    expect(getCampaignExecutionBackendCapabilityStatus({
      executionBackend: "cluster",
    }, clusterAdapter)).toEqual({
      status: "not_evaluated",
      message: "Cluster execution adapter is selected for this backend; backend-specific method and compute-option checks are not evaluated yet.",
    });
  });

  it("does not treat a display label alone as backend readiness", () => {
    const fallbackAdapter = {
      id: "legacy-local",
      label: "Legacy local run API",
      statusLabel: "Native adapter",
      message: "The legacy local adapter cannot submit cluster work.",
    };

    expect(isNativeCampaignExecutionAdapter(fallbackAdapter)).toBe(true);
    expect(isNativeCampaignExecutionAdapterForBackend({
      executionBackend: "cluster",
    }, fallbackAdapter)).toBe(false);
    expect(getCampaignExecutionBackendCapabilityStatus({
      executionBackend: "cluster",
    }, fallbackAdapter)).toEqual({
      status: "blocking",
      message: "The legacy local adapter cannot submit cluster work.",
    });
  });

  it("blocks WASM local fallback readiness with the adapter message", () => {
    expect(getCampaignExecutionBackendCapabilityStatus({
      executionBackend: "wasm-local",
    }, {
      id: "legacy-local",
      label: "Legacy local run API",
      statusLabel: "Legacy fallback",
      message: "WASM local execution is typed but no native submitter is configured.",
    })).toEqual({
      status: "blocking",
      message: "WASM local execution is typed but no native submitter is configured.",
    });
  });
});

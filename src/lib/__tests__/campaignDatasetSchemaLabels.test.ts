import { describe, expect, it } from "vitest";

import type { Dataset } from "@/types/datasets";

import {
  formatCampaignDatasetSourceModeLabel,
  formatCampaignDatasetTaskTypeLabel,
  formatCampaignPreviewCount,
  formatOptionalCampaignPreviewCount,
  getCampaignDatasetDefaultDataView,
  getCampaignDatasetTargetCount,
} from "../campaignDatasetSchemaLabels";
import { buildDatasetSchemaRef } from "../datasetSchema";

function dataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    id: "d1",
    name: "Corn",
    path: "/data/corn.csv",
    linked_at: "2026-01-01T00:00:00",
    num_samples: 42,
    num_features: 128,
    n_sources: 2,
    default_target: "protein",
    targets: [{ column: "protein", type: "regression" }],
    config: {
      delimiter: ",",
      decimal_separator: ".",
      has_header: true,
    },
    ...overrides,
  };
}

describe("campaignDatasetSchemaLabels", () => {
  it("formats shared campaign preview counts", () => {
    expect(formatCampaignPreviewCount(1, "target")).toBe("1 target");
    expect(formatCampaignPreviewCount(2, "target")).toBe("2 targets");
    expect(formatOptionalCampaignPreviewCount(undefined, "source")).toBe("Unknown sources");
  });

  it("formats source mode and task type labels", () => {
    expect(formatCampaignDatasetSourceModeLabel(undefined)).toBe("Unknown source mode");
    expect(formatCampaignDatasetSourceModeLabel(buildDatasetSchemaRef(dataset()))).toBe("multi-source");
    expect(formatCampaignDatasetTaskTypeLabel("binary_classification")).toBe("binary classification");
    expect(formatCampaignDatasetTaskTypeLabel(undefined)).toBe("unknown task");
  });

  it("extracts default data views and target counts", () => {
    const schemaRef = buildDatasetSchemaRef(dataset());

    expect(getCampaignDatasetDefaultDataView(schemaRef)?.label).toBe("Default spectral view");
    expect(getCampaignDatasetTargetCount(undefined, schemaRef)).toBe(1);
    expect(getCampaignDatasetTargetCount({ targetLabel: "protein", sampleCount: null, featureCount: null, metadataColumnCount: null, repetitionColumn: null }, undefined)).toBe(1);
    expect(getCampaignDatasetTargetCount(undefined, undefined)).toBeUndefined();
  });
});

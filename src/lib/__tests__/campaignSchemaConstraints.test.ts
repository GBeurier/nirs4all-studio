import { describe, expect, it } from "vitest";

import {
  buildCampaignSchemaConstraintPreview,
  type CampaignSchemaConstraintKind,
} from "../campaignSchemaConstraints";
import {
  buildLegacyCampaignSpec,
  buildPairedCampaignSpec,
  summarizeCampaignPlan,
  type CampaignSpec,
} from "../campaignPlan";

const pipelines = [
  { id: "p1", name: "PLS", source: "saved" as const },
  { id: "p2", name: "SVM", source: "saved" as const },
];

function previewKind(campaign: CampaignSpec): CampaignSchemaConstraintKind {
  return buildCampaignSchemaConstraintPreview(campaign, summarizeCampaignPlan(campaign)).kind;
}

describe("campaignSchemaConstraints", () => {
  it("classifies campaign schema-constraint shapes", () => {
    expect(previewKind(buildLegacyCampaignSpec({
      name: "Empty",
      selectedDatasetIds: [],
      selectedPipelines: [],
      selectedGroupingPayload: {},
    }))).toBe("incomplete");
    expect(previewKind(buildLegacyCampaignSpec({
      name: "Single",
      selectedDatasetIds: ["d1"],
      selectedPipelines: [pipelines[0]],
      selectedGroupingPayload: {},
    }))).toBe("single_pair");
    expect(previewKind(buildLegacyCampaignSpec({
      name: "Shared dataset",
      selectedDatasetIds: ["d1"],
      selectedPipelines: pipelines,
      selectedGroupingPayload: {},
    }))).toBe("shared_dataset");
    expect(previewKind(buildLegacyCampaignSpec({
      name: "Shared pipeline",
      selectedDatasetIds: ["d1", "d2"],
      selectedPipelines: [pipelines[0]],
      selectedGroupingPayload: {},
    }))).toBe("shared_pipeline");
    expect(previewKind(buildLegacyCampaignSpec({
      name: "Cartesian",
      selectedDatasetIds: ["d1", "d2"],
      selectedPipelines: pipelines,
      selectedGroupingPayload: {},
    }))).toBe("cartesian_matrix");
    expect(previewKind(buildPairedCampaignSpec({
      name: "Paired",
      selectedDatasetIds: ["d1", "d2"],
      selectedPipelines: pipelines,
      selectedGroupingPayload: {},
    }))).toBe("paired_by_index");
  });

  it("builds notices only for reusable legacy campaign shapes", () => {
    const sharedDataset = buildLegacyCampaignSpec({
      name: "Shared dataset",
      selectedDatasetIds: ["d1"],
      selectedPipelines: pipelines,
      selectedGroupingPayload: {},
    });

    expect(buildCampaignSchemaConstraintPreview(
      sharedDataset,
      summarizeCampaignPlan(sharedDataset),
    ).notice).toMatchObject({
      id: "shared-dataset-campaign",
      severity: "info",
      title: "Shared dataset campaign",
    });
  });

  it("describes schema binding shapes for preview consumers", () => {
    const singlePair = buildLegacyCampaignSpec({
      name: "Single",
      selectedDatasetIds: ["d1"],
      selectedPipelines: [pipelines[0]],
      selectedGroupingPayload: {},
    });
    const cartesian = buildLegacyCampaignSpec({
      name: "Cartesian",
      selectedDatasetIds: ["d1", "d2"],
      selectedPipelines: pipelines,
      selectedGroupingPayload: {},
    });

    expect(buildCampaignSchemaConstraintPreview(
      singlePair,
      summarizeCampaignPlan(singlePair),
    )).toMatchObject({
      kind: "single_pair",
      label: "Single dataset/pipeline binding",
      description: "One dataset is paired with one pipeline, the simplest schema-bound campaign shape.",
      strictPairingStatus: "ready",
      strictPairingStatusLabel: "Single explicit pair",
      strictModeRecommendation: "Ready for strict schema-bound execution with one dataset and one pipeline.",
      notice: null,
    });
    expect(buildCampaignSchemaConstraintPreview(
      cartesian,
      summarizeCampaignPlan(cartesian),
    )).toMatchObject({
      kind: "cartesian_matrix",
      label: "Cartesian matrix binding",
      description: "Every selected pipeline is paired with every selected dataset.",
      strictPairingStatus: "needs_explicit_pairs",
      strictPairingStatusLabel: "Implicit all-pairs",
      strictModeRecommendation: "Convert the cartesian matrix to explicit dataset/pipeline pair previews before strict schema-bound execution.",
      notice: {
        id: "legacy-cartesian-matrix",
      },
    });
  });
});

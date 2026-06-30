import { describe, expect, it } from "vitest";

import { buildCampaignPlanPreview } from "../campaignPlanPreview";
import { buildLegacyCampaignSpec } from "../campaignSpecBuilders";

const pipelines = [
  { id: "p1", name: "PLS", source: "saved" as const, stepCount: 2, stepSummary: "SNV -> PLS" },
  { id: "p2", name: "SVM", source: "inline" as const, stepCount: 1, stepSummary: "SVM" },
];

describe("campaignPlanPreview", () => {
  it("aggregates campaign summary, inputs, runs, notices, and readiness", () => {
    const campaign = buildLegacyCampaignSpec({
      name: "Campaign",
      selectedDatasetIds: ["d1", "d2"],
      datasetLabelsById: { d1: "Corn", d2: "Wheat" },
      selectedPipelines: pipelines,
      selectedGroupingPayload: { d1: "batch" },
    });

    const preview = buildCampaignPlanPreview(campaign, { runPreviewLimit: 1 });

    expect(preview).toMatchObject({
      modeLabel: "Legacy cartesian",
      pairingMode: {
        kind: "cartesian_matrix",
        label: "All dataset/pipeline pairs",
        strictPairingLabel: "Implicit all-pairs",
        isStrictPairingReady: false,
      },
      executionBackendLabel: "Local Python",
      runMatrixLabel: "4 runs in explicit run matrix",
      hiddenDatasetPreviewCount: 0,
      hiddenPipelinePreviewCount: 0,
      hiddenRunCount: 3,
      hiddenCompatibilityPreviewCount: 0,
      isRunnable: true,
    });
    expect(preview.summary.launchSummary).toBe("4 runs across 2 datasets and 2 pipelines");
    expect(preview.singlePairSplitPreview).toMatchObject({
      status: "split_recommended",
      statusLabel: "Split recommended",
      summary: "4 planned runs can become 4 one-pair campaigns for strict execution.",
      hiddenCandidateCount: 0,
    });
    expect(preview.singlePairSplitPreview.candidatePreviews.map((candidatePreview) => candidatePreview.positionLabel)).toEqual([
      "Campaign 1",
      "Campaign 2",
      "Campaign 3",
      "Campaign 4",
    ]);
    expect(preview.schemaConstraint).toMatchObject({
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
    expect(preview.datasetPreviews.map((datasetPreview) => datasetPreview.label)).toEqual(["Corn", "Wheat"]);
    expect(preview.pipelinePreviews.map((pipelinePreview) => pipelinePreview.sourceLabel)).toEqual(["Saved pipeline", "Current editor"]);
    expect(preview.runPreviews).toEqual([
      {
        id: "d1::p1",
        datasetId: "d1",
        pipelineId: "p1",
        datasetLabel: "Corn",
        pipelineLabel: "PLS",
        datasetDetailLabels: expect.arrayContaining([
          "target: Unknown target",
          "No aggregation configured",
        ]),
        pipelineDetailLabels: expect.arrayContaining([
          "2 steps",
          "SNV -> PLS",
        ]),
        compatibilityStatus: null,
        compatibilityStatusLabel: null,
        compatibilitySummary: null,
        splitGroupBy: "batch",
        positionLabel: "Run 1",
      },
    ]);
    expect(preview.notices.map((notice) => notice.id)).toEqual(["legacy-cartesian-matrix"]);
  });

  it("limits dataset and pipeline input previews without changing campaign cardinality", () => {
    const campaign = buildLegacyCampaignSpec({
      name: "Campaign",
      selectedDatasetIds: ["d1", "d2", "d3"],
      datasetLabelsById: { d1: "Corn", d2: "Wheat", d3: "Soy" },
      selectedPipelines: [
        ...pipelines,
        { id: "p3", name: "Ridge", source: "saved", stepCount: 1, stepSummary: "Ridge" },
      ],
      selectedGroupingPayload: {},
    });

    const preview = buildCampaignPlanPreview(campaign, {
      datasetPreviewLimit: 1,
      pipelinePreviewLimit: 2,
      runPreviewLimit: 9,
      singlePairSplitPreviewLimit: 1,
    });

    expect(preview.summary).toMatchObject({
      datasetCount: 3,
      pipelineCount: 3,
      runCount: 9,
      inputCardinalityLabel: "3 datasets x 3 pipelines",
    });
    expect(preview.datasetPreviews.map((datasetPreview) => datasetPreview.label)).toEqual(["Corn"]);
    expect(preview.pipelinePreviews.map((pipelinePreview) => pipelinePreview.label)).toEqual(["PLS", "SVM"]);
    expect(preview.hiddenDatasetPreviewCount).toBe(2);
    expect(preview.hiddenPipelinePreviewCount).toBe(1);
    expect(preview.hiddenRunCount).toBe(0);
    expect(preview.singlePairSplitPreview.candidatePreviews).toHaveLength(1);
    expect(preview.singlePairSplitPreview.hiddenCandidateCount).toBe(8);
  });

  it("marks incomplete campaign previews as not runnable", () => {
    const campaign = buildLegacyCampaignSpec({
      name: "Empty",
      selectedDatasetIds: [],
      selectedPipelines: [],
      selectedGroupingPayload: {},
    });

    const preview = buildCampaignPlanPreview(campaign);

    expect(preview.isRunnable).toBe(false);
    expect(preview.capabilityChecks).toEqual([]);
    expect(preview.notices.map((notice) => notice.id)).toEqual([
      "missing-datasets",
      "missing-pipelines",
    ]);
  });
});

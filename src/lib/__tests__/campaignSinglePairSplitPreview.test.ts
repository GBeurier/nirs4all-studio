import { describe, expect, it } from "vitest";

import {
  buildCampaignSinglePairSplitPreview,
  buildCampaignSinglePairSplitSpecs,
} from "../campaignSinglePairSplitPreview";
import { buildLegacyCampaignSpec } from "../campaignSpecBuilders";
import type { CampaignSpec } from "../campaignPlan";

const pipelines = [
  { id: "p1", name: "PLS", source: "saved" as const, stepCount: 2, stepSummary: "SNV -> PLS" },
  { id: "p2", name: "SVM", source: "inline" as const, stepCount: 1, stepSummary: "SVM" },
];

describe("campaignSinglePairSplitPreview", () => {
  it("does not evaluate incomplete campaign inputs", () => {
    const campaign = buildLegacyCampaignSpec({
      name: "Empty",
      selectedDatasetIds: [],
      selectedPipelines: [],
      selectedGroupingPayload: {},
    });

    expect(buildCampaignSinglePairSplitPreview(campaign, 5)).toEqual({
      status: "not_evaluated",
      statusLabel: "Pending inputs",
      summary: "Select dataset and pipeline inputs before single-pair campaign splits can be previewed.",
      candidatePreviews: [],
      hiddenCandidateCount: 0,
    });
  });

  it("detects campaigns that already target one dataset and one pipeline", () => {
    const campaign = buildLegacyCampaignSpec({
      name: "Single",
      selectedDatasetIds: ["d1"],
      datasetLabelsById: { d1: "Corn" },
      selectedPipelines: [pipelines[0]],
      selectedGroupingPayload: { d1: "batch" },
    });

    expect(buildCampaignSinglePairSplitPreview(campaign, 5)).toEqual({
      status: "already_single_pair",
      statusLabel: "No split needed",
      summary: "This campaign already targets one dataset, one pipeline, and one planned run.",
      candidatePreviews: [],
      hiddenCandidateCount: 0,
    });
  });

  it("previews one strict campaign candidate per planned run", () => {
    const campaign = buildLegacyCampaignSpec({
      name: "Baseline",
      selectedDatasetIds: ["d1", "d2"],
      datasetLabelsById: { d1: "Corn", d2: "Wheat" },
      selectedPipelines: pipelines,
      selectedGroupingPayload: { d1: "batch" },
    });

    expect(buildCampaignSinglePairSplitPreview(campaign, 2)).toEqual({
      status: "split_recommended",
      statusLabel: "Split recommended",
      summary: "4 planned runs can become 4 one-pair campaigns for strict execution.",
      candidatePreviews: [
        {
          id: "single-pair:d1::p1",
          runId: "d1::p1",
          datasetId: "d1",
          pipelineId: "p1",
          datasetLabel: "Corn",
          pipelineLabel: "PLS",
          suggestedCampaignName: "Baseline / Corn -> PLS",
          summaryLabel: "1 dataset x 1 pipeline x 1 planned run",
          splitGroupBy: "batch",
          positionLabel: "Campaign 1",
        },
        {
          id: "single-pair:d1::p2",
          runId: "d1::p2",
          datasetId: "d1",
          pipelineId: "p2",
          datasetLabel: "Corn",
          pipelineLabel: "SVM",
          suggestedCampaignName: "Baseline / Corn -> SVM",
          summaryLabel: "1 dataset x 1 pipeline x 1 planned run",
          splitGroupBy: "batch",
          positionLabel: "Campaign 2",
        },
      ],
      hiddenCandidateCount: 2,
    });
  });

  it("materializes strict one-pair campaign specs from planned runs", () => {
    const campaign = buildLegacyCampaignSpec({
      name: "Baseline",
      description: "Compare baseline methods",
      selectedDatasetIds: ["d1", "d2"],
      datasetLabelsById: { d1: "Corn", d2: "Wheat" },
      selectedPipelines: pipelines,
      selectedGroupingPayload: { d1: "batch" },
      executionBackend: "cluster",
    });

    const result = buildCampaignSinglePairSplitSpecs(campaign);

    expect(result.skippedRunIds).toEqual([]);
    expect(result.splitSpecs).toHaveLength(4);
    expect(result.splitSpecs[0]).toEqual({
      id: "single-pair:d1::p1",
      sourceRunId: "d1::p1",
      sourceDatasetId: "d1",
      sourcePipelineId: "p1",
      campaign: {
        name: "Baseline / Corn -> PLS",
        description: "Compare baseline methods",
        mode: "paired_by_index",
        executionBackend: "cluster",
        datasets: [
          {
            id: "d1",
            name: "Corn",
            splitGroupBy: "batch",
          },
        ],
        pipelines: [pipelines[0]],
        runMatrix: [
          {
            id: "d1::p1",
            datasetId: "d1",
            pipelineId: "p1",
            datasetIndex: 0,
            pipelineIndex: 0,
            splitGroupBy: "batch",
          },
        ],
      },
    });
    expect(result.splitSpecs[3].campaign).toMatchObject({
      name: "Baseline / Wheat -> SVM",
      mode: "paired_by_index",
      datasets: [{ id: "d2", name: "Wheat", splitGroupBy: null }],
      pipelines: [pipelines[1]],
      runMatrix: [
        {
          id: "d2::p2",
          datasetIndex: 0,
          pipelineIndex: 0,
          splitGroupBy: null,
        },
      ],
    });
  });

  it("reports run entries that cannot be materialized", () => {
    const campaign: CampaignSpec = {
      name: "Malformed",
      mode: "legacy_cartesian",
      executionBackend: "local-python",
      datasets: [{ id: "d1", name: "Corn", splitGroupBy: null }],
      pipelines: [pipelines[0]],
      runMatrix: [
        {
          id: "d1::p1",
          datasetId: "d1",
          pipelineId: "p1",
          datasetIndex: 0,
          pipelineIndex: 0,
          splitGroupBy: null,
        },
        {
          id: "d1::missing",
          datasetId: "d1",
          pipelineId: "missing",
          datasetIndex: 0,
          pipelineIndex: 1,
          splitGroupBy: null,
        },
      ],
    };

    expect(buildCampaignSinglePairSplitSpecs(campaign)).toMatchObject({
      splitSpecs: [
        {
          id: "single-pair:d1::p1",
          sourceRunId: "d1::p1",
          campaign: {
            name: "Malformed / Corn -> PLS",
            mode: "paired_by_index",
          },
        },
      ],
      skippedRunIds: ["d1::missing"],
    });
  });
});

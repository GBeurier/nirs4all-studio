import { describe, expect, it } from "vitest";

import {
  getCampaignPairingModeReadModel,
  getCampaignPlanModeLabel,
  getCampaignRunCount,
  getCampaignStrictOnePairReadinessReadModel,
  summarizeCampaignPlan,
} from "../campaignPlanSummary";
import type {
  CampaignPlanMode,
  CampaignSpec,
} from "../campaignPlan";

function campaign(overrides: Partial<CampaignSpec> = {}): CampaignSpec {
  return {
    name: "Campaign",
    mode: "legacy_cartesian",
    executionBackend: "local-python",
    datasets: [],
    pipelines: [],
    runMatrix: [],
    ...overrides,
  };
}

describe("campaignPlanSummary", () => {
  it("summarizes cardinality from explicit run matrices", () => {
    const plan = campaign({
      executionBackend: "cluster",
      datasets: [
        { id: "d1", splitGroupBy: null },
        { id: "d2", splitGroupBy: null },
      ],
      pipelines: [
        { id: "p1", name: "PLS", source: "saved" },
      ],
      runMatrix: [
        { id: "r1", datasetId: "d1", pipelineId: "p1", datasetIndex: 0, pipelineIndex: 0, splitGroupBy: null },
        { id: "r2", datasetId: "d2", pipelineId: "p1", datasetIndex: 1, pipelineIndex: 0, splitGroupBy: null },
      ],
    });

    expect(getCampaignRunCount(plan)).toBe(2);
    expect(summarizeCampaignPlan(plan)).toEqual({
      mode: "legacy_cartesian",
      executionBackend: "cluster",
      datasetCount: 2,
      pipelineCount: 1,
      runCount: 2,
      matrixCapacity: 2,
      datasetCountLabel: "2 datasets",
      pipelineCountLabel: "1 pipeline",
      runCountLabel: "2 runs",
      inputCardinalityLabel: "2 datasets x 1 pipeline",
      matrixCapacityLabel: "2 possible pairs",
      matrixCoverageLabel: "2 runs planned from 2 possible pairs",
      launchSummary: "2 runs across 2 datasets and 1 pipeline",
    });
  });

  it("uses singular count labels for one-run campaigns", () => {
    const plan = campaign({
      datasets: [{ id: "d1", splitGroupBy: null }],
      pipelines: [{ id: "p1", name: "PLS", source: "saved" }],
      runMatrix: [
        { id: "r1", datasetId: "d1", pipelineId: "p1", datasetIndex: 0, pipelineIndex: 0, splitGroupBy: null },
      ],
    });

    expect(summarizeCampaignPlan(plan)).toMatchObject({
      datasetCountLabel: "1 dataset",
      pipelineCountLabel: "1 pipeline",
      runCountLabel: "1 run",
      matrixCapacity: 1,
      inputCardinalityLabel: "1 dataset x 1 pipeline",
      matrixCapacityLabel: "1 possible pair",
      matrixCoverageLabel: "1 run planned from 1 possible pair",
      launchSummary: "1 run across 1 dataset and 1 pipeline",
    });
  });

  it("labels known plan modes and passes through future mode ids", () => {
    expect(getCampaignPlanModeLabel("legacy_cartesian")).toBe("Legacy cartesian");
    expect(getCampaignPlanModeLabel("paired_by_index")).toBe("Paired by index");
    expect(getCampaignPlanModeLabel("campaign_batch" as CampaignPlanMode)).toBe("campaign_batch");
  });

  it("classifies pairing mode labels for strict campaign preview UX", () => {
    expect(getCampaignPairingModeReadModel(campaign())).toEqual({
      kind: "incomplete",
      label: "Pending pairing",
      strictPairingLabel: "Pending inputs",
      isStrictPairingReady: false,
    });

    expect(getCampaignPairingModeReadModel(campaign({
      datasets: [{ id: "d1", splitGroupBy: null }],
      pipelines: [{ id: "p1", name: "PLS", source: "saved" }],
      runMatrix: [
        { id: "r1", datasetId: "d1", pipelineId: "p1", datasetIndex: 0, pipelineIndex: 0, splitGroupBy: null },
      ],
    }))).toEqual({
      kind: "single_pair",
      label: "One dataset / one pipeline",
      strictPairingLabel: "Strict one-pair ready",
      isStrictPairingReady: true,
    });

    expect(getCampaignPairingModeReadModel(campaign({
      mode: "paired_by_index",
      datasets: [
        { id: "d1", splitGroupBy: null },
        { id: "d2", splitGroupBy: null },
      ],
      pipelines: [
        { id: "p1", name: "PLS", source: "saved" },
        { id: "p2", name: "SVM", source: "saved" },
      ],
      runMatrix: [
        { id: "r1", datasetId: "d1", pipelineId: "p1", datasetIndex: 0, pipelineIndex: 0, splitGroupBy: null },
        { id: "r2", datasetId: "d2", pipelineId: "p2", datasetIndex: 1, pipelineIndex: 1, splitGroupBy: null },
      ],
    }))).toMatchObject({
      kind: "strict_pairs",
      label: "Explicit dataset/pipeline pairs",
      isStrictPairingReady: true,
    });

    expect(getCampaignPairingModeReadModel(campaign({
      datasets: [
        { id: "d1", splitGroupBy: null },
        { id: "d2", splitGroupBy: null },
      ],
      pipelines: [
        { id: "p1", name: "PLS", source: "saved" },
        { id: "p2", name: "SVM", source: "saved" },
      ],
      runMatrix: [
        { id: "r1", datasetId: "d1", pipelineId: "p1", datasetIndex: 0, pipelineIndex: 0, splitGroupBy: null },
        { id: "r2", datasetId: "d1", pipelineId: "p2", datasetIndex: 0, pipelineIndex: 1, splitGroupBy: null },
        { id: "r3", datasetId: "d2", pipelineId: "p1", datasetIndex: 1, pipelineIndex: 0, splitGroupBy: null },
        { id: "r4", datasetId: "d2", pipelineId: "p2", datasetIndex: 1, pipelineIndex: 1, splitGroupBy: null },
      ],
    }))).toMatchObject({
      kind: "cartesian_matrix",
      label: "All dataset/pipeline pairs",
      strictPairingLabel: "Implicit all-pairs",
      isStrictPairingReady: false,
    });

    expect(getCampaignPairingModeReadModel(campaign({
      datasets: [
        { id: "d1", splitGroupBy: null },
        { id: "d2", splitGroupBy: null },
      ],
      pipelines: [
        { id: "p1", name: "PLS", source: "saved" },
        { id: "p2", name: "SVM", source: "saved" },
      ],
      runMatrix: [
        { id: "r1", datasetId: "d1", pipelineId: "p1", datasetIndex: 0, pipelineIndex: 0, splitGroupBy: null },
        { id: "r2", datasetId: "d2", pipelineId: "p2", datasetIndex: 1, pipelineIndex: 1, splitGroupBy: null },
        { id: "r3", datasetId: "d2", pipelineId: "p1", datasetIndex: 1, pipelineIndex: 0, splitGroupBy: null },
      ],
    }))).toMatchObject({
      kind: "explicit_matrix",
      label: "Explicit run matrix",
      strictPairingLabel: "Needs strict pair previews",
      isStrictPairingReady: false,
    });
  });

  it("exposes strict one-pair readiness separately from strict pair readiness", () => {
    const singlePairMode = getCampaignPairingModeReadModel(campaign({
      datasets: [{ id: "d1", splitGroupBy: null }],
      pipelines: [{ id: "p1", name: "PLS", source: "saved" }],
      runMatrix: [
        { id: "r1", datasetId: "d1", pipelineId: "p1", datasetIndex: 0, pipelineIndex: 0, splitGroupBy: null },
      ],
    }));

    expect(getCampaignStrictOnePairReadinessReadModel(singlePairMode)).toEqual({
      status: "ready",
      label: "Strict one-pair ready",
      isReady: true,
    });

    const strictPairsMode = getCampaignPairingModeReadModel(campaign({
      mode: "paired_by_index",
      datasets: [
        { id: "d1", splitGroupBy: null },
        { id: "d2", splitGroupBy: null },
      ],
      pipelines: [
        { id: "p1", name: "PLS", source: "saved" },
        { id: "p2", name: "SVM", source: "saved" },
      ],
      runMatrix: [
        { id: "r1", datasetId: "d1", pipelineId: "p1", datasetIndex: 0, pipelineIndex: 0, splitGroupBy: null },
        { id: "r2", datasetId: "d2", pipelineId: "p2", datasetIndex: 1, pipelineIndex: 1, splitGroupBy: null },
      ],
    }));

    expect(strictPairsMode.isStrictPairingReady).toBe(true);
    expect(getCampaignStrictOnePairReadinessReadModel(strictPairsMode)).toEqual({
      status: "not_ready",
      label: "Multiple strict pairs",
      isReady: false,
    });
  });
});

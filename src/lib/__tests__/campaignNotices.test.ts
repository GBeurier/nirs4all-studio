import { describe, expect, it } from "vitest";

import { buildCampaignPreviewNotices } from "../campaignNotices";
import {
  buildLegacyCampaignSpec,
  buildPairedCampaignSpec,
  summarizeCampaignPlan,
  type CampaignDatasetRef,
  type CampaignPipelineRef,
  type CampaignSpec,
} from "../campaignPlan";

const datasets: CampaignDatasetRef[] = [
  { id: "d1", name: "Corn", splitGroupBy: null },
  { id: "d2", name: "Wheat", splitGroupBy: null },
];

const pipelines: CampaignPipelineRef[] = [
  { id: "p1", name: "PLS", source: "saved" },
  { id: "p2", name: "SVM", source: "saved" },
];

function noticesFor(campaign: CampaignSpec, executionBackendLabel = "Local Python") {
  return buildCampaignPreviewNotices(campaign, summarizeCampaignPlan(campaign), executionBackendLabel);
}

describe("campaignNotices", () => {
  it("blocks campaigns with missing datasets or pipelines", () => {
    const campaign = buildLegacyCampaignSpec({
      name: "Empty",
      selectedDatasetIds: [],
      selectedPipelines: [],
      selectedGroupingPayload: {},
    });

    expect(noticesFor(campaign)).toEqual([
      {
        id: "missing-datasets",
        severity: "blocking",
        title: "No dataset selected",
        message: "Select at least one dataset before launching this campaign.",
      },
      {
        id: "missing-pipelines",
        severity: "blocking",
        title: "No pipeline selected",
        message: "Select at least one pipeline before launching this campaign.",
      },
    ]);
  });

  it("surfaces cartesian campaign expansion only for multi-dataset multi-pipeline plans", () => {
    const cartesianCampaign = buildLegacyCampaignSpec({
      name: "Cartesian",
      selectedDatasetIds: ["d1", "d2"],
      datasetLabelsById: { d1: "Corn", d2: "Wheat" },
      selectedPipelines: pipelines,
      selectedGroupingPayload: {},
    });
    const singleRunCampaign = buildLegacyCampaignSpec({
      name: "Single",
      selectedDatasetIds: ["d1"],
      datasetLabelsById: { d1: "Corn" },
      selectedPipelines: [pipelines[0]],
      selectedGroupingPayload: {},
    });

    expect(noticesFor(cartesianCampaign)).toEqual([
      {
        id: "legacy-cartesian-matrix",
        severity: "info",
        title: "Cartesian campaign",
        message: "Every selected pipeline will run on every selected dataset. Future campaign modes can replace this with previewed pairings.",
      },
    ]);
    expect(noticesFor(singleRunCampaign)).toEqual([]);
  });

  it("blocks paired campaigns when dataset and pipeline counts diverge", () => {
    const campaign = buildPairedCampaignSpec({
      name: "Mismatched",
      selectedDatasetIds: ["d1", "d2"],
      datasetLabelsById: { d1: "Corn", d2: "Wheat" },
      selectedPipelines: [pipelines[0]],
      selectedGroupingPayload: {},
    });

    expect(noticesFor(campaign)).toEqual([
      {
        id: "paired-count-mismatch",
        severity: "blocking",
        title: "Unpaired campaign inputs",
        message: "Paired campaigns require the same number of datasets and pipelines before launch.",
      },
    ]);
  });

  it("surfaces reusable single-input campaign shapes for future schema-bound modes", () => {
    const sharedDatasetCampaign = buildLegacyCampaignSpec({
      name: "Shared dataset",
      selectedDatasetIds: ["d1"],
      datasetLabelsById: { d1: "Corn" },
      selectedPipelines: pipelines,
      selectedGroupingPayload: {},
    });
    const sharedPipelineCampaign = buildLegacyCampaignSpec({
      name: "Shared pipeline",
      selectedDatasetIds: ["d1", "d2"],
      datasetLabelsById: { d1: "Corn", d2: "Wheat" },
      selectedPipelines: [pipelines[0]],
      selectedGroupingPayload: {},
    });

    expect(noticesFor(sharedDatasetCampaign)).toEqual([
      {
        id: "shared-dataset-campaign",
        severity: "info",
        title: "Shared dataset campaign",
        message: "One dataset will be reused across multiple pipelines. Future schema-bound campaign modes should keep these pair previews explicit.",
      },
    ]);
    expect(noticesFor(sharedPipelineCampaign)).toEqual([
      {
        id: "shared-pipeline-campaign",
        severity: "info",
        title: "Shared pipeline campaign",
        message: "One pipeline will be reused across multiple datasets. Future schema-bound campaign modes should keep these pair previews explicit.",
      },
    ]);
  });

  it("warns when the selected execution backend is not local Python", () => {
    const campaign = buildLegacyCampaignSpec({
      name: "Remote",
      selectedDatasetIds: ["d1"],
      datasetLabelsById: { d1: "Corn" },
      selectedPipelines: [pipelines[0]],
      selectedGroupingPayload: {},
      executionBackend: "cluster",
    });

    expect(noticesFor(campaign, "Cluster")).toEqual([
      {
        id: "nonlocal-backend",
        severity: "warning",
        title: "Cluster backend",
        message: "This frontend contract can describe the backend, but the current launch adapter still targets the legacy local run API.",
      },
    ]);
  });

  it("does not need dataset or pipeline object details to compute notice cardinality", () => {
    const campaign: CampaignSpec = {
      name: "Manual",
      mode: "legacy_cartesian",
      executionBackend: "local-python",
      datasets,
      pipelines,
      runMatrix: [],
    };

    expect(noticesFor(campaign).map((notice) => notice.id)).toEqual(["legacy-cartesian-matrix"]);
  });
});

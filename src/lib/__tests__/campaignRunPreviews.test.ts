import { describe, expect, it } from "vitest";

import {
  buildCampaignRunPreviews,
  buildCampaignRunPreviewsFromInputs,
  getHiddenCampaignRunPreviewCount,
} from "../campaignRunPreviews";
import type { CampaignSpec } from "../campaignPlan";

const campaign: CampaignSpec = {
  name: "Campaign",
  mode: "legacy_cartesian",
  executionBackend: "local-python",
  datasets: [
    { id: "d1", name: "Corn", splitGroupBy: "batch" },
    { id: "d2", splitGroupBy: null },
  ],
  pipelines: [
    { id: "p1", name: "PLS", source: "saved" },
  ],
  runMatrix: [
    { id: "r1", datasetId: "d1", pipelineId: "p1", datasetIndex: 0, pipelineIndex: 0, splitGroupBy: "batch" },
    { id: "r2", datasetId: "d2", pipelineId: "p1", datasetIndex: 1, pipelineIndex: 0, splitGroupBy: null },
    { id: "r3", datasetId: "missing-dataset", pipelineId: "missing-pipeline", datasetIndex: 2, pipelineIndex: 1, splitGroupBy: null },
  ],
};

describe("campaignRunPreviews", () => {
  it("builds planned run previews from explicit run matrix entries", () => {
    expect(buildCampaignRunPreviews(campaign, 3)).toEqual([
      {
        id: "r1",
        datasetId: "d1",
        pipelineId: "p1",
        datasetLabel: "Corn",
        pipelineLabel: "PLS",
        datasetDetailLabels: [
          "Unknown samples",
          "Unknown features",
          "Unknown sources",
          "Unknown source mode",
          "Unknown representations",
          "view: Unknown data view",
          "task: unknown task",
          "Unknown targets",
          "target: Unknown target",
          "Unknown metadata columns",
          "No repetition column",
          "No aggregation configured",
        ],
        pipelineDetailLabels: [
          "Unknown steps",
          "Unknown steps",
        ],
        compatibilityStatus: null,
        compatibilityStatusLabel: null,
        compatibilitySummary: null,
        splitGroupBy: "batch",
        positionLabel: "Run 1",
      },
      {
        id: "r2",
        datasetId: "d2",
        pipelineId: "p1",
        datasetLabel: "d2",
        pipelineLabel: "PLS",
        datasetDetailLabels: [
          "Unknown samples",
          "Unknown features",
          "Unknown sources",
          "Unknown source mode",
          "Unknown representations",
          "view: Unknown data view",
          "task: unknown task",
          "Unknown targets",
          "target: Unknown target",
          "Unknown metadata columns",
          "No repetition column",
          "No aggregation configured",
        ],
        pipelineDetailLabels: [
          "Unknown steps",
          "Unknown steps",
        ],
        compatibilityStatus: null,
        compatibilityStatusLabel: null,
        compatibilitySummary: null,
        splitGroupBy: null,
        positionLabel: "Run 2",
      },
      {
        id: "r3",
        datasetId: "missing-dataset",
        pipelineId: "missing-pipeline",
        datasetLabel: "missing-dataset",
        pipelineLabel: "missing-pipeline",
        datasetDetailLabels: [],
        pipelineDetailLabels: [],
        compatibilityStatus: null,
        compatibilityStatusLabel: null,
        compatibilitySummary: null,
        splitGroupBy: null,
        positionLabel: "Run 3",
      },
    ]);
  });

  it("attaches compatibility status when a matching pair preview exists", () => {
    expect(buildCampaignRunPreviews(campaign, 1, [
      {
        id: "r1",
        datasetId: "d1",
        pipelineId: "p1",
        datasetLabel: "Corn",
        pipelineLabel: "PLS",
        status: "passed",
        statusLabel: "Ready",
        summary: "Schema preview ready for this dataset/pipeline pair.",
        dataViewLabel: "Default spectral view",
        dataViewTaskLabel: "unknown task",
        targetLabel: "protein",
        targetCountLabel: "1 target",
        sourceCountLabel: "1 source",
        sourceModeLabel: "single-source",
        datasetAggregationLabel: "No aggregation configured",
        datasetAggregationSourceLabel: null,
        pipelineNodeCountLabel: "2 active nodes",
        transformationSizeLabel: "size: 42 samples x 128 features x 2 active nodes (~10,752 cells)",
        pipelineComplexityLabels: [],
        checks: [],
      },
    ])[0]).toMatchObject({
      compatibilityStatus: "passed",
      compatibilityStatusLabel: "Ready",
      compatibilitySummary: "Schema preview ready for this dataset/pipeline pair.",
    });
  });

  it("can reuse precomputed dataset and pipeline previews for run detail labels", () => {
    expect(buildCampaignRunPreviewsFromInputs({
      campaign,
      limit: 1,
      datasetPreviews: [
        {
          id: "d1",
          label: "Injected dataset",
          sampleCountLabel: "42 samples",
          featureCountLabel: "128 features",
          sourceCountLabel: "2 sources",
          sourceModeLabel: "multimodal",
          representationCountLabel: "3 representations",
          dataViewLabel: "spectral view",
          dataViewTaskLabel: "regression",
          targetCountLabel: "2 targets",
          targetLabel: "moisture",
          metadataColumnCountLabel: "5 metadata columns",
          repetitionLabel: "repetition: batch",
          aggregationLabel: "refit aggregation ready",
          aggregationSourceLabel: "source: nir",
          splitGroupBy: "batch",
        },
      ],
      pipelinePreviews: [
        {
          id: "p1",
          label: "Injected pipeline",
          sourceLabel: "Saved pipeline",
          stepCountLabel: "4 active nodes",
          stepSummaryLabel: "SNV -> PLS",
          complexityLabels: ["2 generators"],
        },
      ],
    })[0]).toMatchObject({
      datasetDetailLabels: [
        "42 samples",
        "128 features",
        "2 sources",
        "multimodal",
        "3 representations",
        "view: spectral view",
        "task: regression",
        "2 targets",
        "target: moisture",
        "5 metadata columns",
        "repetition: batch",
        "refit aggregation ready",
        "source: nir",
      ],
      pipelineDetailLabels: [
        "4 active nodes",
        "SNV -> PLS",
        "2 generators",
      ],
    });
  });

  it("limits planned run previews without changing the caller cardinality", () => {
    expect(buildCampaignRunPreviews(campaign, 1).map((runPreview) => runPreview.id)).toEqual(["r1"]);
    expect(buildCampaignRunPreviews(campaign, 0)).toEqual([]);
  });

  it("clamps hidden planned run count at zero", () => {
    expect(getHiddenCampaignRunPreviewCount(3, 1)).toBe(2);
    expect(getHiddenCampaignRunPreviewCount(3, 3)).toBe(0);
    expect(getHiddenCampaignRunPreviewCount(3, 5)).toBe(0);
  });
});

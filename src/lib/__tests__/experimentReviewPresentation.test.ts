import { describe, expect, it } from "vitest";

import type { CampaignPlanSummary } from "../campaignPlan";
import {
  buildExperimentReviewGroupingRows,
  buildExperimentReviewSummaryFields,
  getExperimentReviewGroupingBadgeLabel,
  getExperimentReviewNoSplitterMessage,
} from "../experimentReviewPresentation";
import type { SelectedPipelinesRuntimeGrouping } from "../runtimeSplitGrouping";

const summary: CampaignPlanSummary = {
  mode: "legacy_cartesian",
  executionBackend: "local-python",
  datasetCount: 2,
  pipelineCount: 3,
  runCount: 6,
  matrixCapacity: 6,
  datasetCountLabel: "2 datasets",
  pipelineCountLabel: "3 pipelines",
  runCountLabel: "6 runs",
  inputCardinalityLabel: "2 datasets x 3 pipelines",
  matrixCapacityLabel: "6 possible pairs",
  matrixCoverageLabel: "6 runs planned from 6 possible pairs",
  launchSummary: "6 runs across 2 datasets and 3 pipelines",
};

const noSplitterSelection: SelectedPipelinesRuntimeGrouping = {
  hasSplitters: false,
  hasRequiredSplitters: false,
  hasOptionalSplitters: false,
  hasPersistedGroupConflict: false,
  conflictingPipelines: [],
};

describe("experimentReviewPresentation", () => {
  it("builds review summary fields from the campaign summary", () => {
    expect(buildExperimentReviewSummaryFields(summary)).toEqual([
      { id: "datasets", label: "Datasets", value: 2 },
      { id: "pipelines", label: "Pipelines", value: 3 },
      { id: "runs", label: "Total Runs", value: 6 },
    ]);
  });

  it("projects runtime grouping badge and no-splitter copy", () => {
    expect(getExperimentReviewGroupingBadgeLabel(noSplitterSelection)).toBe("No splitters");
    expect(getExperimentReviewNoSplitterMessage()).toBe(
      "No runtime grouping will be injected because the selected pipelines do not contain splitters.",
    );
    expect(getExperimentReviewGroupingBadgeLabel({
      ...noSplitterSelection,
      hasSplitters: true,
    })).toBeNull();
  });

  it("builds runtime grouping rows for selected datasets with grouping state", () => {
    expect(buildExperimentReviewGroupingRows({
      datasetById: new Map([
        ["d1", { name: "Corn" }],
        ["d2", { name: "Wheat" }],
      ]),
      datasetGroupingStates: {
        d1: {
          repetitionColumn: "sample_id",
          metadataColumns: ["batch"],
          selectedGroupBy: "batch",
          requiresExplicitGroup: false,
          hasBlockingError: false,
          blockingMessage: null,
          repetitionOnlyWarning: null,
          optionalPropagationWarning: null,
        },
      },
      selectedDatasetIds: ["d1", "d2", "missing"],
    })).toEqual([
      {
        id: "d1",
        datasetName: "Corn",
        summary: "Split constraints: sample_id + batch",
      },
    ]);
  });
});

import { describe, expect, it } from "vitest";

import type { CampaignPlanPreview } from "../campaignPlan";
import {
  buildCampaignCapabilityCardData,
  buildCampaignSummaryFields,
  campaignPlanHiddenLabels,
  campaignSinglePairSplitTagLabel,
  formatCampaignCompatibilityDetailLabels,
  formatCampaignDatasetDetailLabels,
  formatCampaignExecutionAdapterLine,
  formatCampaignGroupByTag,
  formatCampaignPairLabel,
  formatCampaignPairingModeLine,
  formatCampaignPipelineDetailLabels,
  formatCampaignRunDetailLabels,
  formatCampaignSchemaConstraintLine,
  formatCampaignSinglePairSplitCandidateDetailLabels,
  formatHiddenCampaignPreviewCount,
  getCampaignCompatibilityBadgeVariant,
  getCampaignCapabilityBadgeVariant,
  getCampaignNoticeBadgeVariant,
} from "../campaignPlanPresentation";

function campaignPreview(overrides: Partial<CampaignPlanPreview> = {}): CampaignPlanPreview {
  return {
    summary: {
      mode: "legacy_cartesian",
      executionBackend: "local-python",
      datasetCount: 1,
      pipelineCount: 1,
      runCount: 1,
      matrixCapacity: 1,
      datasetCountLabel: "1 dataset",
      pipelineCountLabel: "1 pipeline",
      runCountLabel: "1 run",
      inputCardinalityLabel: "1 dataset x 1 pipeline",
      matrixCapacityLabel: "1 possible pair",
      matrixCoverageLabel: "1 run planned from 1 possible pair",
      launchSummary: "1 run across 1 dataset and 1 pipeline",
    },
    modeLabel: "Legacy cartesian",
    pairingMode: {
      kind: "single_pair",
      label: "One dataset / one pipeline",
      strictPairingLabel: "Strict one-pair ready",
      isStrictPairingReady: true,
    },
    executionBackendLabel: "Local Python",
    executionAdapter: {
      id: "legacy-local",
      label: "Legacy local run adapter",
      statusLabel: "Native",
      message: "Uses the current local run API.",
    },
    schemaConstraint: {
      kind: "single_pair",
      label: "Single dataset/pipeline binding",
      description: "One dataset is paired with one pipeline, the simplest schema-bound campaign shape.",
      strictPairingStatus: "ready",
      strictPairingStatusLabel: "Single explicit pair",
      strictModeRecommendation: "Ready for strict schema-bound execution with one dataset and one pipeline.",
      notice: null,
    },
    runMatrixLabel: "1 run in explicit run matrix",
    datasetPreviews: [],
    pipelinePreviews: [],
    compatibilityPreviews: [],
    capabilityChecks: [],
    runPreviews: [],
    singlePairSplitPreview: {
      status: "already_single_pair",
      statusLabel: "No split needed",
      summary: "This campaign already targets one dataset, one pipeline, and one planned run.",
      candidatePreviews: [],
      hiddenCandidateCount: 0,
    },
    hiddenDatasetPreviewCount: 0,
    hiddenPipelinePreviewCount: 0,
    hiddenRunCount: 0,
    hiddenCompatibilityPreviewCount: 0,
    notices: [],
    isRunnable: true,
    ...overrides,
  };
}

describe("campaignPlanPresentation", () => {
  it("builds summary and adapter labels from the preview contract", () => {
    const preview = campaignPreview();

    expect(buildCampaignSummaryFields(preview)).toEqual([
      { id: "mode", label: "Mode", value: "Legacy cartesian" },
      {
        id: "pairing",
        label: "Pairing",
        value: "One dataset / one pipeline (Strict one-pair ready)",
      },
      { id: "backend", label: "Backend", value: "Local Python" },
      { id: "adapter", label: "Adapter", value: "Native" },
      { id: "inputs", label: "Inputs", value: "1 dataset x 1 pipeline" },
      { id: "runs", label: "Runs", value: "1 run" },
      { id: "matrix", label: "Matrix", value: "1 run planned from 1 possible pair" },
    ]);
    expect(formatCampaignExecutionAdapterLine(preview)).toBe(
      "Legacy local run adapter: Uses the current local run API.",
    );
    expect(formatCampaignSchemaConstraintLine(preview)).toBe(
      "Single dataset/pipeline binding (Single explicit pair): One dataset is paired with one pipeline, the simplest schema-bound campaign shape. Ready for strict schema-bound execution with one dataset and one pipeline.",
    );
    expect(formatCampaignPairingModeLine(preview.pairingMode)).toBe(
      "One dataset / one pipeline (Strict one-pair ready)",
    );
    expect(formatCampaignPairingModeLine(
      {
        kind: "cartesian_matrix",
        label: "All dataset/pipeline pairs",
        strictPairingLabel: "Implicit all-pairs",
        isStrictPairingReady: false,
      },
    )).toBe("All dataset/pipeline pairs (Implicit all-pairs)");
  });

  it("projects capability checks into card data", () => {
    expect(buildCampaignCapabilityCardData({
      id: "execution-backend-capabilities",
      status: "warning",
      statusLabel: "Warning",
      title: "Execution backend capabilities",
      message: "Cluster execution falls back to the legacy local adapter.",
    })).toEqual({
      id: "execution-backend-capabilities",
      status: "warning",
      statusLabel: "Warning",
      title: "Execution backend capabilities",
      message: "Cluster execution falls back to the legacy local adapter.",
    });
  });

  it("formats campaign preview detail labels and badges", () => {
    expect(campaignPlanHiddenLabels.datasets).toBe("more dataset inputs");
    expect(campaignPlanHiddenLabels.pipelines).toBe("more pipeline inputs");
    expect(campaignPlanHiddenLabels.singlePairSplits).toBe("more split candidates");
    expect(campaignSinglePairSplitTagLabel).toBe("strict one-pair");
    expect(formatHiddenCampaignPreviewCount(3, "more planned runs")).toBe("+ 3 more planned runs");
    expect(formatHiddenCampaignPreviewCount(0, "more planned runs")).toBeNull();
    expect(formatCampaignGroupByTag("batch")).toBe("group_by: batch");
    expect(formatCampaignGroupByTag(null)).toBeNull();
    expect(formatCampaignPairLabel("Corn", "PLS")).toBe("Corn -> PLS");
    expect(getCampaignCapabilityBadgeVariant("blocking")).toBe("destructive");
    expect(getCampaignCapabilityBadgeVariant("warning")).toBe("outline");
    expect(getCampaignCapabilityBadgeVariant("not_evaluated")).toBe("outline");
    expect(getCampaignCapabilityBadgeVariant("passed")).toBe("secondary");
    expect(getCampaignCompatibilityBadgeVariant("blocking")).toBe("destructive");
    expect(getCampaignCompatibilityBadgeVariant("warning")).toBe("outline");
    expect(getCampaignCompatibilityBadgeVariant("not_evaluated")).toBe("outline");
    expect(getCampaignCompatibilityBadgeVariant("passed")).toBe("secondary");
    expect(getCampaignNoticeBadgeVariant("blocking")).toBe("destructive");
    expect(getCampaignNoticeBadgeVariant("warning")).toBe("outline");
  });

  it("projects dataset and compatibility details without JSX", () => {
    expect(formatCampaignDatasetDetailLabels({
      id: "d1",
      label: "Corn",
      sampleCountLabel: "42 samples",
      featureCountLabel: "128 features",
      sourceCountLabel: "2 sources",
      sourceModeLabel: "multi-source",
      representationCountLabel: "4 representations",
      dataViewLabel: "Default spectral view",
      dataViewTaskLabel: "regression",
      targetCountLabel: "2 targets",
      targetLabel: "protein",
      metadataColumnCountLabel: "1 metadata column",
      repetitionLabel: "repetition: scan_id",
      aggregationLabel: "aggregation: median by scan_id",
      aggregationSourceLabel: "aggregation source: dataset config",
      splitGroupBy: "batch",
    })).toEqual([
      "42 samples",
      "128 features",
      "2 sources",
      "multi-source",
      "4 representations",
      "view: Default spectral view",
      "task: regression",
      "2 targets",
      "target: protein",
      "1 metadata column",
      "repetition: scan_id",
      "aggregation: median by scan_id",
      "aggregation source: dataset config",
    ]);

    expect(formatCampaignPipelineDetailLabels({
      id: "p1",
      label: "Generated PLS",
      sourceLabel: "Saved pipeline",
      stepCountLabel: "2 steps",
      stepSummaryLabel: "Augment -> PLS",
      complexityLabels: ["1 generator", "1 parameter sweep", "1 refit node"],
    })).toEqual([
      "2 steps",
      "Augment -> PLS",
      "1 generator",
      "1 parameter sweep",
      "1 refit node",
    ]);

    expect(formatCampaignRunDetailLabels({
      id: "r1",
      datasetId: "d1",
      pipelineId: "p1",
      datasetLabel: "Corn",
      pipelineLabel: "Generated PLS",
      datasetDetailLabels: ["42 samples", "target: protein"],
      pipelineDetailLabels: ["2 steps", "1 refit node"],
      compatibilityStatus: null,
      compatibilityStatusLabel: null,
      compatibilitySummary: null,
      splitGroupBy: "batch",
      positionLabel: "Run 1",
    })).toEqual([
      "42 samples",
      "target: protein",
      "2 steps",
      "1 refit node",
    ]);

    expect(formatCampaignCompatibilityDetailLabels({
      id: "d1::p1",
      datasetId: "d1",
      pipelineId: "p1",
      datasetLabel: "Corn",
      pipelineLabel: "PLS",
      status: "passed",
      statusLabel: "Ready",
      summary: "Schema preview ready for this dataset/pipeline pair.",
      dataViewLabel: "Default spectral view",
      dataViewTaskLabel: "regression",
      targetLabel: "protein",
      targetCountLabel: "2 targets",
      sourceCountLabel: "2 sources",
      sourceModeLabel: "multi-source",
      datasetAggregationLabel: "aggregation: mean by scan_id",
      datasetAggregationSourceLabel: "aggregation source: dataset config",
      pipelineNodeCountLabel: "2 active nodes",
      transformationSizeLabel: "size: 42 samples x 128 features x 2 active nodes across 2 sources (~10,752 cells)",
      pipelineComplexityLabels: ["1 generator", "1 refit node"],
      checks: [],
    })).toEqual([
      "view: Default spectral view",
      "task: regression",
      "2 targets",
      "target: protein",
      "2 sources",
      "multi-source",
      "aggregation: mean by scan_id",
      "aggregation source: dataset config",
      "2 active nodes",
      "size: 42 samples x 128 features x 2 active nodes across 2 sources (~10,752 cells)",
      "1 generator",
      "1 refit node",
    ]);

    expect(formatCampaignSinglePairSplitCandidateDetailLabels({
      id: "candidate-1",
      runId: "run-1",
      datasetId: "d1",
      pipelineId: "p1",
      datasetLabel: "Corn",
      pipelineLabel: "PLS",
      positionLabel: "Run 1",
      summaryLabel: "one dataset x one pipeline",
      suggestedCampaignName: "Corn x PLS / Corn -> PLS",
      splitGroupBy: "batch",
    })).toEqual([
      "one dataset x one pipeline",
      "source run: run-1",
    ]);
  });
});

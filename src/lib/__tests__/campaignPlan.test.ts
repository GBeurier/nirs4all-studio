import { describe, expect, it } from "vitest";

import type { Dataset } from "@/types/datasets";

import {
  buildCampaignPlanPreview,
  buildLegacyCampaignRunMatrix,
  buildLegacyCampaignSpec,
  buildPairedCampaignRunMatrix,
  buildPairedCampaignSpec,
  getCampaignRunCount,
  summarizeCampaignPlan,
  type CampaignDatasetRef,
  type CampaignPipelineRef,
} from "../campaignPlan";
import { buildDatasetSchemaRef } from "../datasetSchema";
import { buildPipelineGraphSpecFromLegacySteps } from "../pipelineGraphSpec";

const datasets: CampaignDatasetRef[] = [
  { id: "d1", splitGroupBy: "batch" },
  { id: "d2", splitGroupBy: null },
];

const pipelines: CampaignPipelineRef[] = [
  { id: "p1", name: "PLS", source: "saved", stepCount: 2, stepSummary: "SNV \u2192 PLS" },
  { id: "p2", name: "Draft", source: "inline", stepCount: 0, stepSummary: "Empty pipeline" },
];

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
    metadata_columns: ["batch"],
    targets: [{ column: "protein", type: "regression" }],
    config: {
      delimiter: ",",
      decimal_separator: ".",
      has_header: true,
      repetition: "sample_id",
    },
    ...overrides,
  };
}

describe("campaignPlan", () => {
  it("builds an explicit legacy cartesian run matrix", () => {
    expect(buildLegacyCampaignRunMatrix(datasets, pipelines)).toEqual([
      { id: "d1::p1", datasetId: "d1", pipelineId: "p1", datasetIndex: 0, pipelineIndex: 0, splitGroupBy: "batch" },
      { id: "d1::p2", datasetId: "d1", pipelineId: "p2", datasetIndex: 0, pipelineIndex: 1, splitGroupBy: "batch" },
      { id: "d2::p1", datasetId: "d2", pipelineId: "p1", datasetIndex: 1, pipelineIndex: 0, splitGroupBy: null },
      { id: "d2::p2", datasetId: "d2", pipelineId: "p2", datasetIndex: 1, pipelineIndex: 1, splitGroupBy: null },
    ]);
  });

  it("builds an explicit paired run matrix without cartesian expansion", () => {
    expect(buildPairedCampaignRunMatrix(datasets, pipelines)).toEqual([
      { id: "d1::p1", datasetId: "d1", pipelineId: "p1", datasetIndex: 0, pipelineIndex: 0, splitGroupBy: "batch" },
      { id: "d2::p2", datasetId: "d2", pipelineId: "p2", datasetIndex: 1, pipelineIndex: 1, splitGroupBy: null },
    ]);
  });

  it("wraps the current experiment selection in a campaign spec", () => {
    const campaign = buildLegacyCampaignSpec({
      name: "Corn x PLS",
      description: "",
      selectedDatasetIds: ["d1", "d2"],
      selectedPipelines: pipelines,
      selectedGroupingPayload: { d1: "batch" },
    });

    expect(campaign).toMatchObject({
      name: "Corn x PLS",
      description: undefined,
      mode: "legacy_cartesian",
      executionBackend: "local-python",
      datasets,
      pipelines,
    });
    expect(getCampaignRunCount(campaign)).toBe(4);
  });

  it("wraps paired selections in a one-to-one campaign spec", () => {
    const campaign = buildPairedCampaignSpec({
      name: "Paired",
      selectedDatasetIds: ["d1", "d2"],
      selectedPipelines: pipelines,
      selectedGroupingPayload: { d1: "batch" },
    });

    expect(campaign).toMatchObject({
      name: "Paired",
      mode: "paired_by_index",
      datasets,
      pipelines,
      runMatrix: [
        { id: "d1::p1", datasetId: "d1", pipelineId: "p1", datasetIndex: 0, pipelineIndex: 0, splitGroupBy: "batch" },
        { id: "d2::p2", datasetId: "d2", pipelineId: "p2", datasetIndex: 1, pipelineIndex: 1, splitGroupBy: null },
      ],
    });
    expect(getCampaignRunCount(campaign)).toBe(2);
  });

  it("allows future execution backends without changing the run matrix contract", () => {
    const campaign = buildLegacyCampaignSpec({
      name: "Remote",
      selectedDatasetIds: ["d1"],
      selectedPipelines: [pipelines[0]],
      selectedGroupingPayload: {},
      executionBackend: "cluster",
    });

    expect(campaign.executionBackend).toBe("cluster");
    expect(campaign.runMatrix).toEqual([
      { id: "d1::p1", datasetId: "d1", pipelineId: "p1", datasetIndex: 0, pipelineIndex: 0, splitGroupBy: null },
    ]);
  });

  it("summarizes campaign cardinality from the explicit plan", () => {
    const campaign = buildLegacyCampaignSpec({
      name: "Corn x PLS",
      selectedDatasetIds: ["d1", "d2"],
      selectedPipelines: pipelines,
      selectedGroupingPayload: { d1: "batch" },
      executionBackend: "cluster",
    });

    expect(summarizeCampaignPlan(campaign)).toEqual({
      mode: "legacy_cartesian",
      executionBackend: "cluster",
      datasetCount: 2,
      pipelineCount: 2,
      runCount: 4,
      matrixCapacity: 4,
      datasetCountLabel: "2 datasets",
      pipelineCountLabel: "2 pipelines",
      runCountLabel: "4 runs",
      inputCardinalityLabel: "2 datasets x 2 pipelines",
      matrixCapacityLabel: "4 possible pairs",
      matrixCoverageLabel: "4 runs planned from 4 possible pairs",
      launchSummary: "4 runs across 2 datasets and 2 pipelines",
    });
  });

  it("uses singular labels for a one-run campaign", () => {
    const campaign = buildLegacyCampaignSpec({
      name: "Single",
      selectedDatasetIds: ["d1"],
      selectedPipelines: [pipelines[0]],
      selectedGroupingPayload: {},
    });

    expect(summarizeCampaignPlan(campaign)).toMatchObject({
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

  it("builds a preview for cartesian campaign plans", () => {
    const campaign = buildLegacyCampaignSpec({
      name: "Corn x PLS",
      selectedDatasetIds: ["d1", "d2"],
      datasetLabelsById: { d1: "Corn", d2: "Wheat" },
      datasetSchemasById: {
        d1: {
          sampleCount: 42,
          featureCount: 128,
          targetLabel: "protein",
          metadataColumnCount: 2,
          repetitionColumn: "sample_id",
        },
        d2: {
          sampleCount: 12,
          featureCount: 64,
          targetLabel: "moisture",
          metadataColumnCount: 0,
          repetitionColumn: null,
        },
      },
      selectedPipelines: pipelines,
      selectedGroupingPayload: { d1: "batch" },
    });

    const preview = buildCampaignPlanPreview(campaign);

    expect(preview).toMatchObject({
      modeLabel: "Legacy cartesian",
      executionBackendLabel: "Local Python",
      executionAdapter: {
        id: "legacy-local",
        label: "Legacy local run API",
        statusLabel: "Native adapter",
        message: "Launches use the current local run API.",
      },
      runMatrixLabel: "4 runs in explicit run matrix",
      isRunnable: true,
    });
    expect(preview.summary.runCount).toBe(4);
    expect(preview.hiddenDatasetPreviewCount).toBe(0);
    expect(preview.hiddenPipelinePreviewCount).toBe(0);
    expect(preview.hiddenRunCount).toBe(0);
    expect(preview.datasetPreviews).toEqual([
      {
        id: "d1",
        label: "Corn",
        sampleCountLabel: "42 samples",
        featureCountLabel: "128 features",
        sourceCountLabel: "Unknown sources",
        sourceModeLabel: "Unknown source mode",
        representationCountLabel: "Unknown representations",
        dataViewLabel: "Unknown data view",
        dataViewTaskLabel: "unknown task",
        targetCountLabel: "1 target",
        targetLabel: "protein",
        metadataColumnCountLabel: "2 metadata columns",
        repetitionLabel: "repetition: sample_id",
        aggregationLabel: "No aggregation configured",
        aggregationSourceLabel: null,
        splitGroupBy: "batch",
      },
      {
        id: "d2",
        label: "Wheat",
        sampleCountLabel: "12 samples",
        featureCountLabel: "64 features",
        sourceCountLabel: "Unknown sources",
        sourceModeLabel: "Unknown source mode",
        representationCountLabel: "Unknown representations",
        dataViewLabel: "Unknown data view",
        dataViewTaskLabel: "unknown task",
        targetCountLabel: "1 target",
        targetLabel: "moisture",
        metadataColumnCountLabel: "0 metadata columns",
        repetitionLabel: "No repetition column",
        aggregationLabel: "No aggregation configured",
        aggregationSourceLabel: null,
        splitGroupBy: null,
      },
    ]);
    expect(preview.pipelinePreviews).toEqual([
      {
        id: "p1",
        label: "PLS",
        sourceLabel: "Saved pipeline",
        stepCountLabel: "2 steps",
        stepSummaryLabel: "SNV \u2192 PLS",
        complexityLabels: [],
      },
      {
        id: "p2",
        label: "Draft",
        sourceLabel: "Current editor",
        stepCountLabel: "0 steps",
        stepSummaryLabel: "Empty pipeline",
        complexityLabels: [],
      },
    ]);
    expect(preview.capabilityChecks).toEqual([
      {
        id: "campaign-schema-binding",
        status: "warning",
        statusLabel: "Warning",
        title: "Campaign schema binding",
        message: "Convert the cartesian matrix to explicit dataset/pipeline pair previews before strict schema-bound execution.",
      },
      {
        id: "single-pair-campaign-shape",
        status: "warning",
        statusLabel: "Warning",
        title: "Single-pair campaign shape",
        message: "4 runs are planned across 2 datasets x 2 pipelines; split campaign work into one dataset/pipeline pair per campaign for strict one-pair execution.",
      },
      {
        id: "dataset-pipeline-schema",
        status: "not_evaluated",
        statusLabel: "Not evaluated",
        title: "Dataset/pipeline schema compatibility",
        message: "Reserved for dataset-specific pipeline schema previews before launch.",
      },
      {
        id: "execution-backend-capabilities",
        status: "not_evaluated",
        statusLabel: "Not evaluated",
        title: "Execution backend capabilities",
        message: "Reserved for backend-specific method and compute-option checks.",
      },
    ]);
    expect(preview.runPreviews).toEqual([
      {
        id: "d1::p1",
        datasetId: "d1",
        pipelineId: "p1",
        datasetLabel: "Corn",
        pipelineLabel: "PLS",
        datasetDetailLabels: [
          "42 samples",
          "128 features",
          "Unknown sources",
          "Unknown source mode",
          "Unknown representations",
          "view: Unknown data view",
          "task: unknown task",
          "1 target",
          "target: protein",
          "2 metadata columns",
          "repetition: sample_id",
          "No aggregation configured",
        ],
        pipelineDetailLabels: [
          "2 steps",
          "SNV \u2192 PLS",
        ],
        compatibilityStatus: null,
        compatibilityStatusLabel: null,
        compatibilitySummary: null,
        splitGroupBy: "batch",
        positionLabel: "Run 1",
      },
      {
        id: "d1::p2",
        datasetId: "d1",
        pipelineId: "p2",
        datasetLabel: "Corn",
        pipelineLabel: "Draft",
        datasetDetailLabels: [
          "42 samples",
          "128 features",
          "Unknown sources",
          "Unknown source mode",
          "Unknown representations",
          "view: Unknown data view",
          "task: unknown task",
          "1 target",
          "target: protein",
          "2 metadata columns",
          "repetition: sample_id",
          "No aggregation configured",
        ],
        pipelineDetailLabels: [
          "0 steps",
          "Empty pipeline",
        ],
        compatibilityStatus: null,
        compatibilityStatusLabel: null,
        compatibilitySummary: null,
        splitGroupBy: "batch",
        positionLabel: "Run 2",
      },
      {
        id: "d2::p1",
        datasetId: "d2",
        pipelineId: "p1",
        datasetLabel: "Wheat",
        pipelineLabel: "PLS",
        datasetDetailLabels: [
          "12 samples",
          "64 features",
          "Unknown sources",
          "Unknown source mode",
          "Unknown representations",
          "view: Unknown data view",
          "task: unknown task",
          "1 target",
          "target: moisture",
          "0 metadata columns",
          "No repetition column",
          "No aggregation configured",
        ],
        pipelineDetailLabels: [
          "2 steps",
          "SNV \u2192 PLS",
        ],
        compatibilityStatus: null,
        compatibilityStatusLabel: null,
        compatibilitySummary: null,
        splitGroupBy: null,
        positionLabel: "Run 3",
      },
      {
        id: "d2::p2",
        datasetId: "d2",
        pipelineId: "p2",
        datasetLabel: "Wheat",
        pipelineLabel: "Draft",
        datasetDetailLabels: [
          "12 samples",
          "64 features",
          "Unknown sources",
          "Unknown source mode",
          "Unknown representations",
          "view: Unknown data view",
          "task: unknown task",
          "1 target",
          "target: moisture",
          "0 metadata columns",
          "No repetition column",
          "No aggregation configured",
        ],
        pipelineDetailLabels: [
          "0 steps",
          "Empty pipeline",
        ],
        compatibilityStatus: null,
        compatibilityStatusLabel: null,
        compatibilitySummary: null,
        splitGroupBy: null,
        positionLabel: "Run 4",
      },
    ]);
    expect(preview.notices).toEqual([
      {
        id: "legacy-cartesian-matrix",
        severity: "info",
        title: "Cartesian campaign",
        message: "Every selected pipeline will run on every selected dataset. Future campaign modes can replace this with previewed pairings.",
      },
    ]);
  });

  it("uses dataset schema refs for richer dataset campaign previews", () => {
    const schemaRef = buildDatasetSchemaRef(dataset());
    const campaign = buildLegacyCampaignSpec({
      name: "Corn x PLS",
      selectedDatasetIds: ["d1"],
      datasetSchemaRefsById: { d1: schemaRef },
      selectedPipelines: [pipelines[0]],
      selectedGroupingPayload: { d1: "batch" },
    });

    expect(campaign.datasets[0]).toMatchObject({
      id: "d1",
      name: "Corn",
      schema: {
        sampleCount: 42,
        featureCount: 128,
        targetLabel: "protein",
        metadataColumnCount: 1,
        repetitionColumn: "sample_id",
      },
      schemaRef: {
        id: "d1:schema",
        sourceCount: 2,
        defaultDataViewId: "d1:view:default",
      },
      splitGroupBy: "batch",
    });

    expect(buildCampaignPlanPreview(campaign).datasetPreviews).toEqual([
      {
        id: "d1",
        label: "Corn",
        sampleCountLabel: "42 samples",
        featureCountLabel: "128 features",
        sourceCountLabel: "2 sources",
        sourceModeLabel: "multi-source",
        representationCountLabel: "4 representations",
        dataViewLabel: "Default spectral view",
        dataViewTaskLabel: "unknown task",
        targetCountLabel: "1 target",
        targetLabel: "protein",
        metadataColumnCountLabel: "1 metadata column",
        repetitionLabel: "repetition: sample_id",
        aggregationLabel: "No aggregation configured",
        aggregationSourceLabel: null,
        splitGroupBy: "batch",
      },
    ]);
  });

  it("adds dataset/pipeline compatibility previews when schema refs and graph specs are available", () => {
    const schemaRef = buildDatasetSchemaRef(dataset());
    const graph = buildPipelineGraphSpecFromLegacySteps(
      [
        { id: "pre", name: "SNV", type: "preprocessing", params: {} },
        { id: "model", name: "PLS", type: "model", params: {} },
      ],
      { id: "p1", name: "PLS" },
    );
    const campaign = buildLegacyCampaignSpec({
      name: "Corn x PLS",
      selectedDatasetIds: ["d1"],
      datasetSchemaRefsById: { d1: schemaRef },
      selectedPipelines: [{ ...pipelines[0], graph }],
      selectedGroupingPayload: { d1: "batch" },
    });

    const preview = buildCampaignPlanPreview(campaign);

    expect(preview.compatibilityPreviews).toEqual([
      expect.objectContaining({
        id: "d1::p1",
        datasetLabel: "Corn",
        pipelineLabel: "PLS",
        status: "passed",
        statusLabel: "Ready",
        dataViewLabel: "Default spectral view",
        dataViewTaskLabel: "unknown task",
        targetLabel: "protein",
        targetCountLabel: "1 target",
        sourceCountLabel: "2 sources",
        sourceModeLabel: "multi-source",
        datasetAggregationLabel: "No aggregation configured",
        datasetAggregationSourceLabel: null,
        pipelineNodeCountLabel: "2 active nodes",
        transformationSizeLabel: "size: 42 samples x 128 features x 2 active nodes across 2 sources (~10,752 cells)",
        pipelineComplexityLabels: ["No refit, finetune, sweeps, or generators"],
      }),
    ]);
    expect(preview.hiddenCompatibilityPreviewCount).toBe(0);
    expect(preview.capabilityChecks[0]).toEqual({
      id: "campaign-schema-binding",
      status: "passed",
      statusLabel: "Passed",
      title: "Campaign schema binding",
      message: "Ready for strict schema-bound execution with one dataset and one pipeline.",
    });
    expect(preview.capabilityChecks[1]).toEqual({
      id: "single-pair-campaign-shape",
      status: "passed",
      statusLabel: "Passed",
      title: "Single-pair campaign shape",
      message: "Campaign already targets one dataset, one pipeline, and one planned run.",
    });
    expect(preview.capabilityChecks[2]).toEqual({
      id: "dataset-pipeline-schema",
      status: "passed",
      statusLabel: "Passed",
      title: "Dataset/pipeline schema compatibility",
      message: "1 of 1 dataset/pipeline pair previews are schema-ready.",
    });
  });

  it("limits campaign run previews without changing campaign cardinality", () => {
    const campaign = buildLegacyCampaignSpec({
      name: "Corn x PLS",
      selectedDatasetIds: ["d1", "d2"],
      selectedPipelines: pipelines,
      selectedGroupingPayload: {},
    });

    const preview = buildCampaignPlanPreview(campaign, { runPreviewLimit: 2 });

    expect(preview.summary.runCount).toBe(4);
    expect(preview.runPreviews.map((runPreview) => runPreview.positionLabel)).toEqual(["Run 1", "Run 2"]);
    expect(preview.hiddenRunCount).toBe(2);
  });

  it("limits campaign input previews without changing campaign cardinality", () => {
    const campaign = buildLegacyCampaignSpec({
      name: "Corn x PLS",
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
    });

    expect(preview.summary).toMatchObject({
      datasetCount: 3,
      pipelineCount: 3,
      runCount: 9,
      matrixCapacity: 9,
      launchSummary: "9 runs across 3 datasets and 3 pipelines",
    });
    expect(preview.datasetPreviews.map((datasetPreview) => datasetPreview.label)).toEqual(["Corn"]);
    expect(preview.pipelinePreviews.map((pipelinePreview) => pipelinePreview.label)).toEqual(["PLS", "Draft"]);
    expect(preview.hiddenDatasetPreviewCount).toBe(2);
    expect(preview.hiddenPipelinePreviewCount).toBe(1);
    expect(preview.hiddenRunCount).toBe(0);
  });

  it("allows campaign run previews to be fully collapsed", () => {
    const campaign = buildLegacyCampaignSpec({
      name: "Corn x PLS",
      selectedDatasetIds: ["d1", "d2"],
      selectedPipelines: pipelines,
      selectedGroupingPayload: {},
    });

    const preview = buildCampaignPlanPreview(campaign, { runPreviewLimit: 0 });

    expect(preview.runPreviews).toEqual([]);
    expect(preview.hiddenRunCount).toBe(4);
  });

  it("marks incomplete campaign previews as blocking", () => {
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

  it("previews paired campaigns and blocks unmatched dataset/pipeline counts", () => {
    const paired = buildPairedCampaignSpec({
      name: "Paired",
      selectedDatasetIds: ["d1", "d2"],
      selectedPipelines: pipelines,
      selectedGroupingPayload: {},
    });
    const pairedPreview = buildCampaignPlanPreview(paired);

    expect(pairedPreview).toMatchObject({
      modeLabel: "Paired by index",
      runMatrixLabel: "2 runs in explicit run matrix",
      isRunnable: true,
    });
    expect(pairedPreview.notices.some((notice) => notice.id === "legacy-cartesian-matrix")).toBe(false);
    expect(pairedPreview.summary.matrixCoverageLabel).toBe("2 runs planned from 4 possible pairs");

    const mismatched = buildPairedCampaignSpec({
      name: "Mismatched",
      selectedDatasetIds: ["d1", "d2"],
      selectedPipelines: [pipelines[0]],
      selectedGroupingPayload: {},
    });
    const mismatchedPreview = buildCampaignPlanPreview(mismatched);

    expect(mismatchedPreview.isRunnable).toBe(false);
    expect(mismatchedPreview.notices).toEqual(expect.arrayContaining([
      {
        id: "paired-count-mismatch",
        severity: "blocking",
        title: "Unpaired campaign inputs",
        message: "Paired campaigns require the same number of datasets and pipelines before launch.",
      },
    ]));
  });

  it("surfaces nonlocal execution backends in previews", () => {
    const campaign = buildLegacyCampaignSpec({
      name: "Remote",
      selectedDatasetIds: ["d1"],
      selectedPipelines: [pipelines[0]],
      selectedGroupingPayload: {},
      executionBackend: "cluster",
    });

    const preview = buildCampaignPlanPreview(campaign);

    expect(preview.executionBackendLabel).toBe("Cluster");
    expect(preview.isRunnable).toBe(false);
    expect(preview.executionAdapter).toEqual({
      id: "legacy-local",
      label: "Legacy local run API",
      statusLabel: "Legacy fallback",
      message: "No native adapter is wired for this backend yet; launches still target the legacy local run API.",
    });
    expect(preview.capabilityChecks).toEqual([
      {
        id: "campaign-schema-binding",
        status: "passed",
        statusLabel: "Passed",
        title: "Campaign schema binding",
        message: "Ready for strict schema-bound execution with one dataset and one pipeline.",
      },
      {
        id: "single-pair-campaign-shape",
        status: "passed",
        statusLabel: "Passed",
        title: "Single-pair campaign shape",
        message: "Campaign already targets one dataset, one pipeline, and one planned run.",
      },
      {
        id: "dataset-pipeline-schema",
        status: "not_evaluated",
        statusLabel: "Not evaluated",
        title: "Dataset/pipeline schema compatibility",
        message: "Reserved for dataset-specific pipeline schema previews before launch.",
      },
      {
        id: "execution-backend-capabilities",
        status: "blocking",
        statusLabel: "Blocking",
        title: "Execution backend capabilities",
        message: "No native adapter is wired for this backend yet; launches still target the legacy local run API.",
      },
    ]);
    expect(preview.notices).toEqual([
      {
        id: "nonlocal-backend",
        severity: "warning",
        title: "Cluster backend",
        message: "This frontend contract can describe the backend, but the current launch adapter still targets the legacy local run API.",
      },
    ]);
  });
});

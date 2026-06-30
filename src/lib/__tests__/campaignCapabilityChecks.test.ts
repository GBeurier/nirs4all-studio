import { describe, expect, it } from "vitest";

import type { DatasetPipelineCompatibilityPreview } from "../campaignCompatibilityTypes";
import {
  buildCampaignCapabilityChecks,
  getCampaignCapabilityCheckStatusLabel,
  getCampaignCompatibilityCapabilityStatus,
  getCampaignSchemaBindingCapabilityStatus,
  getCampaignSinglePairCapabilityStatus,
  summarizeCampaignCompatibilityPreviewStatuses,
} from "../campaignCapabilityChecks";
import {
  getCampaignExecutionBackendCapabilityStatus,
  isNativeCampaignExecutionAdapter,
} from "../campaignExecutionCapabilities";
import {
  buildLegacyCampaignSpec,
  summarizeCampaignPlan,
} from "../campaignPlan";

function compatibilityPreview(
  status: DatasetPipelineCompatibilityPreview["status"],
  id = `d1::p-${status}`,
): DatasetPipelineCompatibilityPreview {
  return {
    id,
    datasetId: "d1",
    pipelineId: `p-${status}`,
    datasetLabel: "Corn",
    pipelineLabel: "PLS",
    status,
    statusLabel: status,
    summary: status,
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
    pipelineComplexityLabels: ["No refit, finetune, sweeps, or generators"],
    checks: [],
  };
}

describe("campaignCapabilityChecks", () => {
  it("formats capability check status labels", () => {
    expect(getCampaignCapabilityCheckStatusLabel("not_evaluated")).toBe("Not evaluated");
    expect(getCampaignCapabilityCheckStatusLabel("passed")).toBe("Passed");
    expect(getCampaignCapabilityCheckStatusLabel("warning")).toBe("Warning");
    expect(getCampaignCapabilityCheckStatusLabel("blocking")).toBe("Blocking");
  });

  it("summarizes compatibility preview readiness against run count", () => {
    expect(summarizeCampaignCompatibilityPreviewStatuses([
      compatibilityPreview("passed", "d1::p1"),
      compatibilityPreview("warning", "d1::p2"),
      compatibilityPreview("not_evaluated", "d1::p3"),
    ], 4)).toEqual({
      runCount: 4,
      previewCount: 3,
      evaluatedCount: 2,
      passedCount: 1,
      warningCount: 1,
      blockingCount: 0,
      notEvaluatedCount: 1,
      missingPreviewCount: 1,
    });
    expect(getCampaignCompatibilityCapabilityStatus([], 1)).toEqual({
      status: "not_evaluated",
      message: "Reserved for dataset-specific pipeline schema previews before launch.",
    });
    expect(getCampaignCompatibilityCapabilityStatus([compatibilityPreview("not_evaluated")], 1)).toEqual({
      status: "not_evaluated",
      message: "Reserved for dataset-specific pipeline schema previews before launch.",
    });
    expect(getCampaignCompatibilityCapabilityStatus([compatibilityPreview("blocking")], 1)).toEqual({
      status: "blocking",
      message: "1 dataset/pipeline pair preview needs campaign reference fixes before launch.",
    });
    expect(getCampaignCompatibilityCapabilityStatus([compatibilityPreview("warning")], 1)).toEqual({
      status: "warning",
      message: "1 of 1 dataset/pipeline pair previews are schema-evaluated (1 warning); resolve these before stricter execution modes.",
    });
    expect(getCampaignCompatibilityCapabilityStatus([compatibilityPreview("passed")], 2)).toEqual({
      status: "warning",
      message: "1 of 2 dataset/pipeline pair previews are schema-evaluated (1 missing); resolve these before stricter execution modes.",
    });
    expect(getCampaignCompatibilityCapabilityStatus([compatibilityPreview("passed")], 1)).toEqual({
      status: "passed",
      message: "1 of 1 dataset/pipeline pair previews are schema-ready.",
    });
  });

  it("summarizes campaign schema binding readiness", () => {
    expect(getCampaignSchemaBindingCapabilityStatus({
      kind: "single_pair",
      label: "Single dataset/pipeline binding",
      description: "One dataset is paired with one pipeline, the simplest schema-bound campaign shape.",
      strictPairingStatus: "ready",
      strictPairingStatusLabel: "Single explicit pair",
      strictModeRecommendation: "Ready for strict schema-bound execution with one dataset and one pipeline.",
      notice: null,
    })).toEqual({
      status: "passed",
      message: "Ready for strict schema-bound execution with one dataset and one pipeline.",
    });
    expect(getCampaignSchemaBindingCapabilityStatus({
      kind: "cartesian_matrix",
      label: "Cartesian matrix binding",
      description: "Every selected pipeline is paired with every selected dataset.",
      strictPairingStatus: "needs_explicit_pairs",
      strictPairingStatusLabel: "Implicit all-pairs",
      strictModeRecommendation: "Convert the cartesian matrix to explicit dataset/pipeline pair previews before strict schema-bound execution.",
      notice: null,
    })).toEqual({
      status: "warning",
      message: "Convert the cartesian matrix to explicit dataset/pipeline pair previews before strict schema-bound execution.",
    });
  });

  it("summarizes single-pair campaign shape readiness", () => {
    expect(getCampaignSinglePairCapabilityStatus({
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
    })).toEqual({
      status: "passed",
      message: "Campaign already targets one dataset, one pipeline, and one planned run.",
    });
    expect(getCampaignSinglePairCapabilityStatus({
      mode: "legacy_cartesian",
      executionBackend: "local-python",
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
    })).toEqual({
      status: "warning",
      message: "4 runs are planned across 2 datasets x 2 pipelines; split campaign work into one dataset/pipeline pair per campaign for strict one-pair execution.",
    });
  });

  it("builds schema and backend capability checks for runnable campaign inputs", () => {
    const campaign = buildLegacyCampaignSpec({
      name: "Remote",
      selectedDatasetIds: ["d1"],
      selectedPipelines: [{ id: "p1", name: "PLS", source: "saved" }],
      selectedGroupingPayload: {},
      executionBackend: "cluster",
    });

    expect(buildCampaignCapabilityChecks(
      campaign,
      summarizeCampaignPlan(campaign),
      [compatibilityPreview("passed", "d1::p1")],
    )).toEqual([
      {
        id: "dataset-pipeline-schema",
        status: "passed",
        statusLabel: "Passed",
        title: "Dataset/pipeline schema compatibility",
        message: "1 of 1 dataset/pipeline pair previews are schema-ready.",
      },
      {
        id: "execution-backend-capabilities",
        status: "blocking",
        statusLabel: "Blocking",
        title: "Execution backend capabilities",
        message: "The campaign can describe this backend, but no native launch adapter is available for it.",
      },
    ]);
  });

  it("summarizes execution backend capability readiness", () => {
    expect(getCampaignExecutionBackendCapabilityStatus({
      executionBackend: "local-python",
    })).toEqual({
      status: "not_evaluated",
      message: "Reserved for backend-specific method and compute-option checks.",
    });
    expect(getCampaignExecutionBackendCapabilityStatus({
      executionBackend: "cluster",
    })).toEqual({
      status: "blocking",
      message: "The campaign can describe this backend, but no native launch adapter is available for it.",
    });

    const nativeAdapter = {
      id: "cluster",
      label: "Cluster execution adapter",
      statusLabel: "Native adapter",
      message: "Cluster execution adapter is selected for this campaign backend.",
    };
    expect(isNativeCampaignExecutionAdapter(nativeAdapter)).toBe(true);
    expect(getCampaignExecutionBackendCapabilityStatus({
      executionBackend: "cluster",
    }, nativeAdapter)).toEqual({
      status: "not_evaluated",
      message: "Cluster execution adapter is selected for this backend; backend-specific method and compute-option checks are not evaluated yet.",
    });
  });

  it("uses execution adapter fallback messages for backend capability checks", () => {
    const campaign = buildLegacyCampaignSpec({
      name: "Remote",
      selectedDatasetIds: ["d1"],
      selectedPipelines: [{ id: "p1", name: "PLS", source: "saved" }],
      selectedGroupingPayload: {},
      executionBackend: "cluster",
    });

    expect(buildCampaignCapabilityChecks(
      campaign,
      summarizeCampaignPlan(campaign),
      [compatibilityPreview("passed", "d1::p1")],
      {
        id: "legacy-local",
        label: "Legacy local run API",
        statusLabel: "Legacy fallback",
        message: "Cluster execution is typed but no native submitter is configured.",
      },
    )).toContainEqual({
      id: "execution-backend-capabilities",
      status: "blocking",
      statusLabel: "Blocking",
      title: "Execution backend capabilities",
      message: "Cluster execution is typed but no native submitter is configured.",
    });
  });

  it("does not warn on nonlocal backends when a native execution adapter is selected", () => {
    const campaign = buildLegacyCampaignSpec({
      name: "Remote",
      selectedDatasetIds: ["d1"],
      selectedPipelines: [{ id: "p1", name: "PLS", source: "saved" }],
      selectedGroupingPayload: {},
      executionBackend: "cluster",
    });

    expect(buildCampaignCapabilityChecks(
      campaign,
      summarizeCampaignPlan(campaign),
      [compatibilityPreview("passed", "d1::p1")],
      {
        id: "cluster",
        label: "Cluster execution adapter",
        statusLabel: "Native adapter",
        message: "Cluster execution adapter is selected for this campaign backend.",
      },
    )).toEqual([
      {
        id: "dataset-pipeline-schema",
        status: "passed",
        statusLabel: "Passed",
        title: "Dataset/pipeline schema compatibility",
        message: "1 of 1 dataset/pipeline pair previews are schema-ready.",
      },
      {
        id: "execution-backend-capabilities",
        status: "not_evaluated",
        statusLabel: "Not evaluated",
        title: "Execution backend capabilities",
        message: "Cluster execution adapter is selected for this backend; backend-specific method and compute-option checks are not evaluated yet.",
      },
    ]);
  });

  it("skips capability checks until both dataset and pipeline inputs exist", () => {
    const campaign = buildLegacyCampaignSpec({
      name: "Empty",
      selectedDatasetIds: [],
      selectedPipelines: [],
      selectedGroupingPayload: {},
    });

    expect(buildCampaignCapabilityChecks(campaign, summarizeCampaignPlan(campaign), [])).toEqual([]);
  });
});

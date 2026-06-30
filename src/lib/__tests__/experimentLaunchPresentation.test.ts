import { describe, expect, it } from "vitest";

import type {
  CampaignPlanPreview,
  CampaignSinglePairSplitSpecResult,
} from "../campaignPlan";
import { buildNativeExperimentLaunchPayload } from "../experimentExecutionAdapter";
import {
  buildExperimentLaunchPayloadDiagnostics,
  type ExperimentLaunchPayloadPlan,
} from "../experimentLaunchPayload";
import {
  buildExperimentLaunchBadgeLabels,
  buildExperimentLaunchPayloadBadgeLabels,
  buildExperimentLaunchPayloadManifestDetails,
  formatExperimentLaunchAdapterStatusLine,
  formatExperimentLaunchPayloadActivationLine,
  formatExperimentLaunchPayloadStatusLine,
  getExperimentLaunchDatasetBadgeLabel,
  getExperimentLaunchDescription,
  getExperimentLaunchPayloadBadgeVariant,
} from "../experimentLaunchPresentation";

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
      label: "Legacy local run API",
      statusLabel: "Native adapter",
      message: "Launches use the current local run API.",
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

const strictCampaignSpecs: CampaignSinglePairSplitSpecResult = {
  splitSpecs: [
    {
      id: "single-pair:d1::p1",
      sourceRunId: "d1::p1",
      sourceDatasetId: "d1",
      sourcePipelineId: "p1",
      campaign: {
        name: "Experiment / Corn -> PLS",
        mode: "paired_by_index",
        executionBackend: "cluster",
        datasets: [{ id: "d1", name: "Corn", splitGroupBy: null }],
        pipelines: [{ id: "p1", name: "PLS", source: "saved" }],
        runMatrix: [
          {
            id: "d1::p1",
            datasetId: "d1",
            pipelineId: "p1",
            datasetIndex: 0,
            pipelineIndex: 0,
            splitGroupBy: null,
          },
        ],
      },
    },
    {
      id: "single-pair:d2::p2",
      sourceRunId: "d2::p2",
      sourceDatasetId: "d2",
      sourcePipelineId: "p2",
      campaign: {
        name: "Experiment / Soy -> Ridge",
        mode: "paired_by_index",
        executionBackend: "cluster",
        datasets: [{ id: "d2", name: "Soy", splitGroupBy: null }],
        pipelines: [{ id: "p2", name: "Ridge", source: "saved" }],
        runMatrix: [
          {
            id: "d2::p2",
            datasetId: "d2",
            pipelineId: "p2",
            datasetIndex: 0,
            pipelineIndex: 0,
            splitGroupBy: null,
          },
        ],
      },
    },
    {
      id: "single-pair:d3::p3",
      sourceRunId: "d3::p3",
      sourceDatasetId: "d3",
      sourcePipelineId: "p3",
      campaign: {
        name: "Experiment / Wheat -> SVR",
        mode: "paired_by_index",
        executionBackend: "cluster",
        datasets: [{ id: "d3", name: "Wheat", splitGroupBy: null }],
        pipelines: [{ id: "p3", name: "SVR", source: "saved" }],
        runMatrix: [
          {
            id: "d3::p3",
            datasetId: "d3",
            pipelineId: "p3",
            datasetIndex: 0,
            pipelineIndex: 0,
            splitGroupBy: null,
          },
        ],
      },
    },
  ],
  skippedRunIds: ["d4::p4"],
};

function launchPayloadPlan(overrides: Partial<ExperimentLaunchPayloadPlan> = {}): ExperimentLaunchPayloadPlan {
  const legacyConfig = overrides.legacyConfig ?? {
    name: "Experiment",
    dataset_ids: ["d1"],
    pipeline_ids: ["p1"],
  };
  const strictCampaignSpecs = overrides.strictCampaignSpecs ?? {
    splitSpecs: [],
    skippedRunIds: [],
  };
  const nativePayload = overrides.nativePayload ?? buildNativeExperimentLaunchPayload(legacyConfig, strictCampaignSpecs);

  const plan: Omit<ExperimentLaunchPayloadPlan, "payloadDiagnostics"> & Partial<
    Pick<ExperimentLaunchPayloadPlan, "payloadDiagnostics">
  > = {
    currentSubmissionKind: "legacy_config",
    legacyConfig,
    strictCampaignPayloadStatus: "legacy_only",
    strictCampaignPayloadSummary: "Legacy local launches submit the current ExperimentConfig payload.",
    strictCampaignPayloadActivation: {
      status: "legacy_not_applicable",
      canUseStrictPayload: false,
      message: "Strict campaign payloads are not used by legacy local launches.",
    },
    strictCampaignSpecs,
    nativePayload,
    ...overrides,
  };

  return {
    ...plan,
    payloadDiagnostics: plan.payloadDiagnostics ?? buildExperimentLaunchPayloadDiagnostics(plan),
  };
}

describe("experimentLaunchPresentation", () => {
  it("builds launch badges and adapter status copy", () => {
    const preview = campaignPreview();

    expect(buildExperimentLaunchBadgeLabels(preview)).toEqual([
      { id: "backend", label: "Local Python" },
      { id: "adapter", label: "Legacy local run API" },
      { id: "run-matrix", label: "1 run in explicit run matrix" },
    ]);
    expect(formatExperimentLaunchAdapterStatusLine(preview)).toBe(
      "Native adapter: Launches use the current local run API.",
    );
    expect(formatExperimentLaunchAdapterStatusLine(campaignPreview({
      executionAdapter: {
        id: "legacy-local",
        label: "Legacy local run API",
        statusLabel: "Legacy fallback",
        message: "Cluster execution is typed but no native submitter is configured.",
      },
    }))).toBe("Legacy fallback: Cluster execution is typed but no native submitter is configured.");
  });

  it("builds launch payload badges and status copy", () => {
    expect(buildExperimentLaunchPayloadBadgeLabels(launchPayloadPlan())).toEqual([
      { id: "current-submission", label: "Submission: Legacy config", variant: "outline" },
      { id: "strict-campaigns", label: "Strict campaigns: Legacy only", variant: "outline" },
    ]);
    expect(formatExperimentLaunchPayloadStatusLine(launchPayloadPlan())).toBe(
      "Legacy local launches submit the current ExperimentConfig payload.",
    );
    expect(formatExperimentLaunchPayloadActivationLine(launchPayloadPlan())).toBe(
      "Strict campaign payloads are not used by legacy local launches.",
    );
    expect(getExperimentLaunchPayloadBadgeVariant("ready")).toBe("secondary");
    expect(getExperimentLaunchPayloadBadgeVariant("partial")).toBe("warning");
    expect(getExperimentLaunchPayloadBadgeVariant("unavailable")).toBe("destructive");
    const readyLaunchPayloadPlan = launchPayloadPlan({
      currentSubmissionKind: "native_payload",
      strictCampaignPayloadStatus: "ready",
      strictCampaignPayloadSummary: "1 strict campaign spec ready for Cluster execution adapter.",
      strictCampaignPayloadActivation: {
        status: "ready",
        canUseStrictPayload: true,
        message: "Strict campaign payload is ready for native submitters.",
      },
    });
    expect(buildExperimentLaunchPayloadBadgeLabels(readyLaunchPayloadPlan)).toEqual([
      { id: "current-submission", label: "Submission: Native payload", variant: "secondary" },
      { id: "strict-campaigns", label: "Strict campaigns: Ready", variant: "secondary" },
    ]);
    expect(formatExperimentLaunchPayloadActivationLine(readyLaunchPayloadPlan)).toBe(
      "Strict campaign payload is ready for native submitters.",
    );
  });

  it("builds native payload manifest details for launch UI", () => {
    expect(buildExperimentLaunchPayloadManifestDetails(launchPayloadPlan(), campaignPreview())).toEqual([
      { id: "legacy-inputs", label: "Legacy inputs", value: "1 dataset · 1 pipeline" },
      { id: "native-payload", label: "Native payload", value: "0 strict campaigns · 0 skipped runs" },
      {
        id: "submission-target",
        label: "Submission target",
        value: "Legacy local run API",
        title: "Native adapter: Launches use the current local run API.",
      },
      {
        id: "campaign-cardinality",
        label: "Campaign cardinality",
        value: "1 dataset x 1 pipeline · 1 run",
        title: "1 run in explicit run matrix: 1 run planned from 1 possible pair",
      },
      {
        id: "schema-binding",
        label: "Schema binding",
        value: "Single dataset/pipeline binding · Single explicit pair",
        title: "Single dataset/pipeline binding (Single explicit pair): One dataset is paired with one pipeline, the simplest schema-bound campaign shape. Ready for strict schema-bound execution with one dataset and one pipeline.",
      },
      {
        id: "payload-schema",
        label: "Payload schema",
        value: "studio.native-launch-payload.v1",
        title: "Native launch payload schema version",
      },
      { id: "payload-readiness", label: "Payload readiness", value: "Legacy config submission" },
      { id: "source-runs", label: "Source runs", value: "None" },
    ]);

    expect(buildExperimentLaunchPayloadManifestDetails(launchPayloadPlan({
      legacyConfig: {
        name: "Experiment",
        dataset_ids: ["d1", "d2", "d3"],
        pipeline_ids: ["p1", "p2"],
        inline_pipeline: {
          name: "Draft",
          steps: [{ id: "draft" }],
        },
      },
      strictCampaignSpecs,
    }), campaignPreview())).toEqual([
      { id: "legacy-inputs", label: "Legacy inputs", value: "3 datasets · 3 pipelines" },
      { id: "native-payload", label: "Native payload", value: "3 strict campaigns · 1 skipped run" },
      {
        id: "submission-target",
        label: "Submission target",
        value: "Legacy local run API",
        title: "Native adapter: Launches use the current local run API.",
      },
      {
        id: "campaign-cardinality",
        label: "Campaign cardinality",
        value: "1 dataset x 1 pipeline · 1 run",
        title: "1 run in explicit run matrix: 1 run planned from 1 possible pair",
      },
      {
        id: "schema-binding",
        label: "Schema binding",
        value: "Single dataset/pipeline binding · Single explicit pair",
        title: "Single dataset/pipeline binding (Single explicit pair): One dataset is paired with one pipeline, the simplest schema-bound campaign shape. Ready for strict schema-bound execution with one dataset and one pipeline.",
      },
      {
        id: "payload-schema",
        label: "Payload schema",
        value: "studio.native-launch-payload.v1",
        title: "Native launch payload schema version",
      },
      { id: "payload-readiness", label: "Payload readiness", value: "Legacy config submission" },
      {
        id: "source-runs",
        label: "Source runs",
        value: "d1::p1, d2::p2 + 1 more",
        title: "d1::p1, d2::p2, d3::p3",
      },
      {
        id: "skipped-runs",
        label: "Skipped runs",
        value: "d4::p4",
        title: "d4::p4",
      },
    ]);

    const clusterPreview = campaignPreview({
      summary: {
        ...campaignPreview().summary,
        executionBackend: "cluster",
      },
      executionBackendLabel: "Cluster",
      executionAdapter: {
        id: "cluster",
        label: "Cluster execution adapter",
        statusLabel: "Native adapter",
        message: "Cluster execution adapter is selected for this campaign backend.",
      },
    });
    const partialNativeDetails = buildExperimentLaunchPayloadManifestDetails(launchPayloadPlan({
      currentSubmissionKind: "native_payload",
      strictCampaignPayloadStatus: "partial",
      strictCampaignPayloadActivation: {
        status: "blocked",
        canUseStrictPayload: false,
        message: "1 run entry must be materialized before strict payload submission.",
      },
      strictCampaignSpecs: {
        splitSpecs: strictCampaignSpecs.splitSpecs.slice(0, 1),
        skippedRunIds: ["d2::p2"],
      },
    }), clusterPreview);
    expect(partialNativeDetails).toContainEqual({
      id: "submission-target",
      label: "Submission target",
      value: "Cluster via Cluster execution adapter",
      title: "Native adapter: Cluster execution adapter is selected for this campaign backend.",
    });
    expect(partialNativeDetails).toContainEqual({
      id: "campaign-cardinality",
      label: "Campaign cardinality",
      value: "1 dataset x 1 pipeline · 1 run",
      title: "1 run in explicit run matrix: 1 run planned from 1 possible pair",
    });
    expect(partialNativeDetails).toContainEqual({
      id: "schema-binding",
      label: "Schema binding",
      value: "Single dataset/pipeline binding · Single explicit pair",
      title: "Single dataset/pipeline binding (Single explicit pair): One dataset is paired with one pipeline, the simplest schema-bound campaign shape. Ready for strict schema-bound execution with one dataset and one pipeline.",
    });
    expect(partialNativeDetails).toContainEqual({
      id: "payload-readiness",
      label: "Payload readiness",
      value: "Blocked for native submission",
      title: "1 run entry must be materialized before strict payload submission.",
    });

    const wasmPreview = campaignPreview({
      summary: {
        ...campaignPreview().summary,
        executionBackend: "wasm-local",
      },
      executionBackendLabel: "WASM local",
      executionAdapter: {
        id: "wasm-local",
        label: "WASM local execution adapter",
        statusLabel: "Native adapter",
        message: "WASM local execution adapter is selected for this campaign backend.",
      },
    });
    expect(buildExperimentLaunchPayloadManifestDetails(launchPayloadPlan({
      currentSubmissionKind: "native_payload",
      strictCampaignPayloadStatus: "ready",
      strictCampaignPayloadActivation: {
        status: "ready",
        canUseStrictPayload: true,
        message: "Strict campaign payload is ready for native submitters.",
      },
      strictCampaignSpecs: {
        splitSpecs: strictCampaignSpecs.splitSpecs.slice(0, 1),
        skippedRunIds: [],
      },
    }), wasmPreview)).toContainEqual({
      id: "submission-target",
      label: "Submission target",
      value: "WASM local via WASM local execution adapter",
      title: "Native adapter: WASM local execution adapter is selected for this campaign backend.",
    });
  });

  it("normalizes optional launch text and dataset badge labels", () => {
    const datasetById = new Map([
      ["d1", { name: "Corn" }],
      ["d2", { name: "" }],
    ]);

    expect(getExperimentLaunchDescription("Baseline")).toBe("Baseline");
    expect(getExperimentLaunchDescription("")).toBeNull();
    expect(getExperimentLaunchDatasetBadgeLabel("d1", datasetById)).toBe("Corn");
    expect(getExperimentLaunchDatasetBadgeLabel("d2", datasetById)).toBe("d2");
    expect(getExperimentLaunchDatasetBadgeLabel("missing", datasetById)).toBe("missing");
  });
});

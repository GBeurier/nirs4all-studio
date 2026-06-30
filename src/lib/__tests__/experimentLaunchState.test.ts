import { describe, expect, it } from "vitest";

import type { CampaignPlanPreview } from "../campaignPlan";
import { buildNativeExperimentLaunchPayload } from "../experimentExecutionAdapter";
import {
  buildExperimentLaunchPayloadDiagnostics,
  type ExperimentLaunchPayloadPlan,
} from "../experimentLaunchPayload";
import { getExperimentLaunchState } from "../experimentLaunchState";

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

describe("experimentLaunchState", () => {
  it("allows ready campaign launches", () => {
    expect(getExperimentLaunchState({
      campaignPreview: campaignPreview(),
      isLaunching: false,
      isPreflighting: false,
    })).toEqual({
      actionState: "ready",
      blockingNotices: [],
      buttonLabel: "Launch Experiment",
      isLaunchDisabled: false,
      showSpinner: false,
    });
  });

  it("labels ready native launch actions by backend", () => {
    const readyNativePayloadPlan = launchPayloadPlan({
      currentSubmissionKind: "native_payload",
      strictCampaignPayloadStatus: "ready",
      strictCampaignPayloadSummary: "1 strict campaign spec ready for native execution adapter.",
      strictCampaignPayloadActivation: {
        status: "ready",
        canUseStrictPayload: true,
        message: "Strict campaign payload is ready for native submitters.",
      },
      strictCampaignSpecs: {
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
        ],
        skippedRunIds: [],
      },
    });

    expect(getExperimentLaunchState({
      campaignPreview: campaignPreview({
        summary: {
          ...campaignPreview().summary,
          executionBackend: "cluster",
        },
        executionBackendLabel: "Cluster",
      }),
      isLaunching: false,
      isPreflighting: false,
      launchPayloadPlan: readyNativePayloadPlan,
    })).toMatchObject({
      actionState: "ready",
      buttonLabel: "Submit to Cluster",
      isLaunchDisabled: false,
    });

    expect(getExperimentLaunchState({
      campaignPreview: campaignPreview({
        summary: {
          ...campaignPreview().summary,
          executionBackend: "wasm-local",
        },
        executionBackendLabel: "WASM local",
      }),
      isLaunching: false,
      isPreflighting: false,
      launchPayloadPlan: readyNativePayloadPlan,
    })).toMatchObject({
      actionState: "ready",
      buttonLabel: "Run in WASM Local",
      isLaunchDisabled: false,
    });
  });

  it("prioritizes preflight and launch busy states", () => {
    expect(getExperimentLaunchState({
      campaignPreview: campaignPreview(),
      isLaunching: true,
      isPreflighting: true,
    })).toMatchObject({
      actionState: "checking",
      buttonLabel: "Checking...",
      isLaunchDisabled: true,
      showSpinner: true,
    });

    expect(getExperimentLaunchState({
      campaignPreview: campaignPreview(),
      isLaunching: true,
      isPreflighting: false,
    })).toMatchObject({
      actionState: "launching",
      buttonLabel: "Starting...",
      isLaunchDisabled: true,
      showSpinner: true,
    });
  });

  it("blocks non-runnable campaign plans and exposes blocking notices", () => {
    const notice = {
      id: "missing-datasets",
      severity: "blocking" as const,
      title: "No dataset selected",
      message: "Select at least one dataset before launching this campaign.",
    };

    expect(getExperimentLaunchState({
      campaignPreview: campaignPreview({
        isRunnable: false,
        notices: [
          notice,
          {
            id: "legacy-cartesian-matrix",
            severity: "info",
            title: "Cartesian campaign",
            message: "Every selected pipeline will run on every selected dataset.",
          },
        ],
      }),
      isLaunching: false,
      isPreflighting: false,
    })).toEqual({
      actionState: "blocked",
      blockingNotices: [notice],
      buttonLabel: "Resolve Plan Issues",
      isLaunchDisabled: true,
      showSpinner: false,
    });
  });

  it("blocks runnable native launches when strict payload submission is blocked", () => {
    expect(getExperimentLaunchState({
      campaignPreview: campaignPreview(),
      isLaunching: false,
      isPreflighting: false,
      launchPayloadPlan: launchPayloadPlan({
        currentSubmissionKind: "native_payload",
        strictCampaignPayloadStatus: "partial",
        strictCampaignPayloadSummary: "1 strict campaign spec ready and 1 skipped run for Cluster execution adapter.",
        strictCampaignPayloadActivation: {
          status: "blocked",
          canUseStrictPayload: false,
          message: "1 run entry must be materialized before strict payload submission.",
        },
      }),
    })).toEqual({
      actionState: "blocked",
      blockingNotices: [
        {
          id: "native-payload-submission-blocked",
          severity: "blocking",
          title: "Native payload not ready",
          message: "1 run entry must be materialized before strict payload submission.",
        },
      ],
      buttonLabel: "Resolve Payload Issues",
      isLaunchDisabled: true,
      showSpinner: false,
    });
  });
});

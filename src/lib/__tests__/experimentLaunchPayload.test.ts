import { describe, expect, it } from "vitest";

import type { CampaignSinglePairSplitSpecResult } from "../campaignPlan";
import {
  buildNativeExperimentLaunchPayload,
  CLUSTER_EXPERIMENT_EXECUTION_ADAPTER,
  LEGACY_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
} from "../experimentExecutionAdapter";
import {
  buildExperimentLaunchPayloadDiagnostics,
  buildExperimentLaunchPayloadPlan,
  buildExperimentLaunchSelectionPayloadPlan,
  buildExperimentLaunchStrictCampaignSpecs,
  getExperimentLaunchPayloadSubmissionBlockMessage,
} from "../experimentLaunchPayload";
import type { ExperimentConfig } from "@/types/runs";
import {
  WORKSPACE_PREDICTION_PUBLICATION_EFFECTS,
  WORKSPACE_PREDICTION_PUBLICATION_KEYWORD_IDS,
} from "@/ui/keywordRegistry";

const legacyConfig: ExperimentConfig = {
  name: "Experiment",
  dataset_ids: ["d1"],
  pipeline_ids: ["p1"],
  split_group_by_by_dataset: { d1: null },
};

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
  ],
  skippedRunIds: [],
};

describe("experimentLaunchPayload", () => {
  it("keeps legacy launches on the current ExperimentConfig payload", () => {
    expect(buildExperimentLaunchPayloadPlan({
      executionAdapter: LEGACY_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
      legacyConfig,
      strictCampaignSpecs,
    })).toEqual({
      currentSubmissionKind: "legacy_config",
      legacyConfig,
      strictCampaignSpecs,
      nativePayload: buildNativeExperimentLaunchPayload(legacyConfig, strictCampaignSpecs),
      strictCampaignPayloadStatus: "legacy_only",
      strictCampaignPayloadSummary: "Legacy local launches submit the current ExperimentConfig payload.",
      strictCampaignPayloadActivation: {
        status: "legacy_not_applicable",
        canUseStrictPayload: false,
        message: "Strict campaign payloads are not used by legacy local launches.",
      },
      payloadDiagnostics: {
        nativePayloadVersion: "studio.native-launch-payload.v1",
        currentSubmissionKind: "legacy_config",
        strictCampaignPayloadStatus: "legacy_only",
        strictCampaignPayloadActivationStatus: "legacy_not_applicable",
        nativePayloadRequired: false,
        canSubmitNativePayload: false,
        blockedReason: null,
        legacyDatasetCount: 1,
        legacyPipelineCount: 1,
        strictCampaignCount: 1,
        skippedRunCount: 0,
        sourceRunCount: 1,
        sourceRunIds: ["d1::p1"],
        skippedRunIds: [],
      },
    });
  });

  it("marks strict campaign specs ready for native adapters", () => {
    const plan = buildExperimentLaunchPayloadPlan({
      executionAdapter: CLUSTER_EXPERIMENT_EXECUTION_ADAPTER,
      legacyConfig,
      strictCampaignSpecs,
    });

    expect(plan).toMatchObject({
      currentSubmissionKind: "native_payload",
      legacyConfig: { execution_backend: "cluster" },
      strictCampaignPayloadStatus: "ready",
      strictCampaignPayloadSummary: "1 strict campaign spec ready for Cluster execution adapter.",
      strictCampaignPayloadActivation: {
        status: "ready",
        canUseStrictPayload: true,
        message: "Strict campaign payload is ready for native submitters.",
      },
      payloadDiagnostics: {
        nativePayloadVersion: "studio.native-launch-payload.v1",
        currentSubmissionKind: "native_payload",
        strictCampaignPayloadStatus: "ready",
        strictCampaignPayloadActivationStatus: "ready",
        nativePayloadRequired: true,
        canSubmitNativePayload: true,
        blockedReason: null,
        legacyDatasetCount: 1,
        legacyPipelineCount: 1,
        strictCampaignCount: 1,
        skippedRunCount: 0,
        sourceRunCount: 1,
        sourceRunIds: ["d1::p1"],
        skippedRunIds: [],
      },
    });
    expect(plan.nativePayload.legacyConfig.execution_backend).toBe("cluster");
  });

  it("reports partial and unavailable strict campaign payloads", () => {
    const partialPlan = buildExperimentLaunchPayloadPlan({
      executionAdapter: CLUSTER_EXPERIMENT_EXECUTION_ADAPTER,
      legacyConfig,
      strictCampaignSpecs: {
        splitSpecs: strictCampaignSpecs.splitSpecs,
        skippedRunIds: ["missing-run"],
      },
    });
    expect(partialPlan).toMatchObject({
      currentSubmissionKind: "native_payload",
      strictCampaignPayloadStatus: "partial",
      strictCampaignPayloadSummary: "1 strict campaign spec available; 1 run entry could not be materialized.",
      strictCampaignPayloadActivation: {
        status: "blocked",
        canUseStrictPayload: false,
        message: "1 run entry must be materialized before strict payload submission.",
      },
      payloadDiagnostics: {
        nativePayloadVersion: "studio.native-launch-payload.v1",
        currentSubmissionKind: "native_payload",
        strictCampaignPayloadStatus: "partial",
        strictCampaignPayloadActivationStatus: "blocked",
        nativePayloadRequired: true,
        canSubmitNativePayload: false,
        blockedReason: "1 run entry must be materialized before strict payload submission.",
        legacyDatasetCount: 1,
        legacyPipelineCount: 1,
        strictCampaignCount: 1,
        skippedRunCount: 1,
        sourceRunCount: 1,
        sourceRunIds: ["d1::p1"],
        skippedRunIds: ["missing-run"],
      },
    });
    expect(getExperimentLaunchPayloadSubmissionBlockMessage(partialPlan)).toBe(
      "1 run entry must be materialized before strict payload submission.",
    );

    const unavailablePlan = buildExperimentLaunchPayloadPlan({
      executionAdapter: CLUSTER_EXPERIMENT_EXECUTION_ADAPTER,
      legacyConfig,
      strictCampaignSpecs: {
        splitSpecs: [],
        skippedRunIds: [],
      },
    });
    expect(unavailablePlan).toMatchObject({
      currentSubmissionKind: "native_payload",
      strictCampaignPayloadStatus: "unavailable",
      strictCampaignPayloadSummary: "No strict campaign specs are available for this launch payload.",
      strictCampaignPayloadActivation: {
        status: "blocked",
        canUseStrictPayload: false,
        message: "Strict campaign payload is unavailable for this launch.",
      },
      payloadDiagnostics: {
        nativePayloadVersion: "studio.native-launch-payload.v1",
        currentSubmissionKind: "native_payload",
        strictCampaignPayloadStatus: "unavailable",
        strictCampaignPayloadActivationStatus: "blocked",
        nativePayloadRequired: true,
        canSubmitNativePayload: false,
        blockedReason: "Strict campaign payload is unavailable for this launch.",
        legacyDatasetCount: 1,
        legacyPipelineCount: 1,
        strictCampaignCount: 0,
        skippedRunCount: 0,
        sourceRunCount: 0,
        sourceRunIds: [],
        skippedRunIds: [],
      },
    });
    expect(getExperimentLaunchPayloadSubmissionBlockMessage(unavailablePlan)).toBe(
      "Strict campaign payload is unavailable for this launch.",
    );
  });

  it("allows legacy submissions and ready native submissions through the payload guard", () => {
    expect(getExperimentLaunchPayloadSubmissionBlockMessage(buildExperimentLaunchPayloadPlan({
      executionAdapter: LEGACY_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
      legacyConfig,
      strictCampaignSpecs,
    }))).toBeNull();
    expect(getExperimentLaunchPayloadSubmissionBlockMessage(buildExperimentLaunchPayloadPlan({
      executionAdapter: CLUSTER_EXPERIMENT_EXECUTION_ADAPTER,
      legacyConfig,
      strictCampaignSpecs,
    }))).toBeNull();
  });

  it("builds payload diagnostics from native payload manifest and activation state", () => {
    const nativePayload = buildNativeExperimentLaunchPayload(legacyConfig, {
      splitSpecs: strictCampaignSpecs.splitSpecs,
      skippedRunIds: ["missing-run"],
    });

    expect(buildExperimentLaunchPayloadDiagnostics({
      currentSubmissionKind: "native_payload",
      strictCampaignPayloadStatus: "partial",
      strictCampaignPayloadActivation: {
        status: "blocked",
        canUseStrictPayload: false,
        message: "1 run entry must be materialized before strict payload submission.",
      },
      nativePayload,
    })).toEqual({
      nativePayloadVersion: "studio.native-launch-payload.v1",
      currentSubmissionKind: "native_payload",
      strictCampaignPayloadStatus: "partial",
      strictCampaignPayloadActivationStatus: "blocked",
      nativePayloadRequired: true,
      canSubmitNativePayload: false,
      blockedReason: "1 run entry must be materialized before strict payload submission.",
      legacyDatasetCount: 1,
      legacyPipelineCount: 1,
      strictCampaignCount: 1,
      skippedRunCount: 1,
      sourceRunCount: 1,
      sourceRunIds: ["d1::p1"],
      skippedRunIds: ["missing-run"],
    });
  });

  it("copies robustness evidence publication handoff into launch diagnostics", () => {
    const nativePayload = buildNativeExperimentLaunchPayload({
      ...legacyConfig,
      robustness: {
        mode: "clean_frozen",
        scenarios: [{ kind: "spectral_noise", severity: 0.05 }],
        publish_evidence: {
          spectral_replay: {
            X: "dataset_partition",
            predictor_bundle: "exported_model_bundle",
            destination: "result_metadata.robustness_evidence",
            fail_closed: true,
          },
        },
      },
    }, strictCampaignSpecs);

    expect(buildExperimentLaunchPayloadDiagnostics({
      currentSubmissionKind: "native_payload",
      strictCampaignPayloadStatus: "ready",
      strictCampaignPayloadActivation: {
        status: "ready",
        canUseStrictPayload: true,
        message: "Strict campaign payload is ready for native submitters.",
      },
      nativePayload,
    })).toMatchObject({
      robustnessEvidencePublicationRequested: true,
      robustnessEvidencePublicationDestination: "result_metadata.robustness_evidence",
      robustnessEvidencePublicationKeywordIds: WORKSPACE_PREDICTION_PUBLICATION_KEYWORD_IDS,
      robustnessEvidencePublicationRequiredEffects: WORKSPACE_PREDICTION_PUBLICATION_EFFECTS,
      robustnessEvidencePublicationConformalArtifactPolicy: "prediction_publisher_does_not_persist_conformal_artifacts",
    });
  });

  it("rebuilds strict campaign specs for pruned missing-node pipelines", () => {
    const prunedStrictSpecs = buildExperimentLaunchStrictCampaignSpecs({
      strictCampaignSpecs,
      selectedPipelineConfigs: [
        {
          id: "p1",
          name: "PLS",
          steps: [
            { id: "pre", name: "SNV", type: "preprocessing", params: {} },
            { id: "model", name: "PLS", type: "model", params: {} },
          ],
        },
      ],
      missingIssues: [
        {
          type: "missing_module",
          message: "SNV unavailable",
          details: {
            pipeline_id: "p1",
            step_id: "pre",
          },
        },
      ],
    });

    expect(prunedStrictSpecs.skippedRunIds).toEqual([]);
    expect(prunedStrictSpecs.splitSpecs).toHaveLength(1);
    expect(prunedStrictSpecs.splitSpecs[0].campaign.pipelines).toEqual([
      expect.objectContaining({
        id: "p1",
        name: "PLS",
        source: "inline-pruned",
        stepCount: 1,
        stepSummary: "PLS",
      }),
    ]);
    expect(prunedStrictSpecs.splitSpecs[0].campaign.pipelines[0].graph?.entryNodeIds).toEqual(["model"]);
  });

  it("builds selection payload plans with matching legacy config and strict campaign pruning", () => {
    const plan = buildExperimentLaunchSelectionPayloadPlan({
      name: "Experiment",
      selectedDatasetIds: ["d1"],
      selectedPipelineConfigs: [
        {
          id: "p1",
          name: "PLS",
          steps: [
            { id: "pre", name: "SNV", type: "preprocessing", params: {} },
            { id: "model", name: "PLS", type: "model", params: {} },
          ],
        },
      ],
      selectedGroupingPayload: { d1: null },
      strictCampaignSpecs,
      executionAdapter: CLUSTER_EXPERIMENT_EXECUTION_ADAPTER,
      missingIssues: [
        {
          type: "missing_module",
          message: "SNV unavailable",
          details: {
            pipeline_id: "p1",
            step_id: "pre",
          },
        },
      ],
    });

    expect(plan.currentSubmissionKind).toBe("native_payload");
    expect(plan.legacyConfig).toMatchObject({
      execution_backend: "cluster",
      engine: "dag-ml",
      allow_fallback: false,
      dataset_ids: ["d1"],
      pipeline_ids: [],
      inline_pipeline: {
        name: "PLS",
        steps: [{ id: "model", name: "PLS", type: "model", params: {} }],
      },
      split_group_by_by_dataset: { d1: null },
    });
    expect(plan.strictCampaignSpecs.splitSpecs[0].campaign.pipelines).toEqual([
      expect.objectContaining({
        id: "p1",
        name: "PLS",
        source: "inline-pruned",
        stepCount: 1,
        stepSummary: "PLS",
      }),
    ]);
    expect(plan.nativePayload.legacyConfig).toBe(plan.legacyConfig);
    expect(plan.nativePayload.legacyConfig.execution_backend).toBe("cluster");
    expect(plan.nativePayload.legacyConfig.engine).toBe("dag-ml");
    expect(plan.nativePayload.legacyConfig.allow_fallback).toBe(false);
    expect(plan.nativePayload.strictCampaignSpecs).toBe(plan.strictCampaignSpecs);
  });

  it("marks strict specs skipped when pruning removes a whole pipeline", () => {
    const prunedStrictSpecs = buildExperimentLaunchStrictCampaignSpecs({
      strictCampaignSpecs,
      selectedPipelineConfigs: [
        {
          id: "p1",
          name: "PLS",
          steps: [{ id: "model", name: "PLS", type: "model", params: {} }],
        },
      ],
      missingIssues: [
        {
          type: "missing_module",
          message: "PLS unavailable",
          details: {
            pipeline_id: "p1",
            step_id: "model",
          },
        },
      ],
    });

    expect(prunedStrictSpecs).toEqual({
      splitSpecs: [],
      skippedRunIds: ["d1::p1"],
    });
  });
});

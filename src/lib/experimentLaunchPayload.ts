import type {
  CampaignSinglePairSplitSpecResult,
} from "./campaignPlanPreviewTypes";
import { buildCampaignPipelineRefFromSteps } from "./campaignPipelineAdapter";
import type {
  ExperimentExecutionAdapter,
  NativeExperimentLaunchPayload,
} from "./experimentExecutionAdapter";
import {
  buildNativeExperimentLaunchPayload,
  LEGACY_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
} from "./experimentExecutionAdapter";
import { buildExperimentLaunchConfig } from "./experimentLaunchConfig";
import type { SelectedPipelineConfig } from "./experimentPipelineSelection";
import {
  pruneUnavailableSteps,
  type MissingOperatorIssue,
} from "./pipelineOperatorAvailability";
import type { PipelineStep as EditorPipelineStep } from "@/components/pipeline-editor/types";
import type { ExperimentConfig } from "@/types/runs";

export type ExperimentLaunchCurrentSubmissionKind = "legacy_config" | "native_payload";

export type ExperimentLaunchStrictCampaignPayloadStatus =
  | "legacy_only"
  | "ready"
  | "partial"
  | "unavailable";

export type ExperimentLaunchStrictPayloadActivationStatus =
  | "legacy_not_applicable"
  | "ready"
  | "blocked";

export interface ExperimentLaunchStrictPayloadActivation {
  status: ExperimentLaunchStrictPayloadActivationStatus;
  canUseStrictPayload: boolean;
  message: string;
}

export interface ExperimentLaunchPayloadDiagnostics {
  nativePayloadVersion: NativeExperimentLaunchPayload["manifest"]["version"];
  currentSubmissionKind: ExperimentLaunchCurrentSubmissionKind;
  strictCampaignPayloadStatus: ExperimentLaunchStrictCampaignPayloadStatus;
  strictCampaignPayloadActivationStatus: ExperimentLaunchStrictPayloadActivationStatus;
  nativePayloadRequired: boolean;
  canSubmitNativePayload: boolean;
  blockedReason: string | null;
  legacyDatasetCount: number;
  legacyPipelineCount: number;
  strictCampaignCount: number;
  skippedRunCount: number;
  sourceRunCount: number;
  sourceRunIds: string[];
  skippedRunIds: string[];
}

export interface ExperimentLaunchPayloadPlan {
  currentSubmissionKind: ExperimentLaunchCurrentSubmissionKind;
  legacyConfig: ExperimentConfig;
  strictCampaignPayloadStatus: ExperimentLaunchStrictCampaignPayloadStatus;
  strictCampaignPayloadSummary: string;
  strictCampaignPayloadActivation: ExperimentLaunchStrictPayloadActivation;
  payloadDiagnostics: ExperimentLaunchPayloadDiagnostics;
  strictCampaignSpecs: CampaignSinglePairSplitSpecResult;
  nativePayload: NativeExperimentLaunchPayload;
}

export interface BuildExperimentLaunchPayloadPlanInput {
  executionAdapter: ExperimentExecutionAdapter;
  legacyConfig: ExperimentConfig;
  strictCampaignSpecs: CampaignSinglePairSplitSpecResult;
}

export interface BuildExperimentLaunchStrictCampaignSpecsInput {
  strictCampaignSpecs: CampaignSinglePairSplitSpecResult;
  selectedPipelineConfigs: SelectedPipelineConfig[];
  missingIssues?: MissingOperatorIssue[];
}

export interface BuildExperimentLaunchSelectionPayloadPlanInput {
  name: string;
  description?: string;
  selectedDatasetIds: string[];
  selectedPipelineConfigs: SelectedPipelineConfig[];
  selectedGroupingPayload: Record<string, string | null>;
  strictCampaignSpecs: CampaignSinglePairSplitSpecResult;
  executionAdapter: ExperimentExecutionAdapter;
  missingIssues?: MissingOperatorIssue[];
  runtimeEngine?: string | null;
  allowFallback?: boolean;
}

export type BuildExperimentLaunchPayloadDiagnosticsInput = Pick<
  ExperimentLaunchPayloadPlan,
  | "currentSubmissionKind"
  | "strictCampaignPayloadStatus"
  | "strictCampaignPayloadActivation"
  | "nativePayload"
>;

function getMissingIssuesByPipeline(
  selectedPipelineConfigs: SelectedPipelineConfig[],
  missingIssues: MissingOperatorIssue[],
): Map<string, MissingOperatorIssue[]> {
  const issuesByPipelineId = new Map<string, MissingOperatorIssue[]>();
  const issuesByPipelineName = new Map<string, MissingOperatorIssue[]>();

  for (const issue of missingIssues) {
    const pipelineId = issue.details?.pipeline_id;
    const pipelineName = issue.details?.pipeline_name;

    if (pipelineId) {
      const bucket = issuesByPipelineId.get(pipelineId) ?? [];
      bucket.push(issue);
      issuesByPipelineId.set(pipelineId, bucket);
    }

    if (pipelineName) {
      const bucket = issuesByPipelineName.get(pipelineName) ?? [];
      bucket.push(issue);
      issuesByPipelineName.set(pipelineName, bucket);
    }
  }

  return new Map(
    selectedPipelineConfigs
      .map((pipeline) => [
        pipeline.id,
        issuesByPipelineId.get(pipeline.id) ?? issuesByPipelineName.get(pipeline.name) ?? [],
      ] as const)
      .filter(([, issues]) => issues.length > 0),
  );
}

function appendUniqueSkippedRunId(skippedRunIds: string[], runId: string): string[] {
  if (skippedRunIds.includes(runId)) return skippedRunIds;
  return [...skippedRunIds, runId];
}

export function buildExperimentLaunchStrictCampaignSpecs({
  strictCampaignSpecs,
  selectedPipelineConfigs,
  missingIssues = [],
}: BuildExperimentLaunchStrictCampaignSpecsInput): CampaignSinglePairSplitSpecResult {
  if (missingIssues.length === 0) return strictCampaignSpecs;

  const issuesByPipelineId = getMissingIssuesByPipeline(selectedPipelineConfigs, missingIssues);
  if (issuesByPipelineId.size === 0) return strictCampaignSpecs;

  const prunedPipelineRefsById = new Map(
    selectedPipelineConfigs
      .map((pipeline) => {
        const pipelineIssues = issuesByPipelineId.get(pipeline.id);
        if (!pipelineIssues?.length) return null;

        const pruned = pruneUnavailableSteps(
          pipeline.steps as EditorPipelineStep[],
          pipelineIssues,
        );
        if (pruned.steps.length === 0) return [pipeline.id, null] as const;

        return [
          pipeline.id,
          buildCampaignPipelineRefFromSteps({
            id: pipeline.id,
            name: pipeline.name,
            source: "inline-pruned",
            steps: pruned.steps,
          }),
        ] as const;
      })
      .filter((entry): entry is readonly [string, ReturnType<typeof buildCampaignPipelineRefFromSteps> | null] => entry !== null),
  );

  let skippedRunIds = strictCampaignSpecs.skippedRunIds;
  const splitSpecs = strictCampaignSpecs.splitSpecs
    .map((splitSpec) => {
      if (!prunedPipelineRefsById.has(splitSpec.sourcePipelineId)) return splitSpec;

      const prunedPipelineRef = prunedPipelineRefsById.get(splitSpec.sourcePipelineId);
      if (!prunedPipelineRef) {
        skippedRunIds = appendUniqueSkippedRunId(skippedRunIds, splitSpec.sourceRunId);
        return null;
      }

      return {
        ...splitSpec,
        campaign: {
          ...splitSpec.campaign,
          pipelines: [prunedPipelineRef],
        },
      };
    })
    .filter((splitSpec): splitSpec is typeof strictCampaignSpecs.splitSpecs[number] => splitSpec !== null);

  return {
    splitSpecs,
    skippedRunIds,
  };
}

function buildStrictCampaignPayloadSummary(
  executionAdapter: ExperimentExecutionAdapter,
  strictCampaignSpecs: CampaignSinglePairSplitSpecResult,
): Pick<ExperimentLaunchPayloadPlan, "strictCampaignPayloadStatus" | "strictCampaignPayloadSummary"> {
  const strictSpecLabel = `${strictCampaignSpecs.splitSpecs.length} strict campaign ${strictCampaignSpecs.splitSpecs.length === 1 ? "spec" : "specs"}`;
  const skippedRunLabel = `${strictCampaignSpecs.skippedRunIds.length} run ${strictCampaignSpecs.skippedRunIds.length === 1 ? "entry" : "entries"}`;

  if (executionAdapter.id === LEGACY_LOCAL_EXPERIMENT_EXECUTION_ADAPTER.id) {
    return {
      strictCampaignPayloadStatus: "legacy_only",
      strictCampaignPayloadSummary: "Legacy local launches submit the current ExperimentConfig payload.",
    };
  }

  if (strictCampaignSpecs.splitSpecs.length === 0) {
    return {
      strictCampaignPayloadStatus: "unavailable",
      strictCampaignPayloadSummary: "No strict campaign specs are available for this launch payload.",
    };
  }

  if (strictCampaignSpecs.skippedRunIds.length > 0) {
    return {
      strictCampaignPayloadStatus: "partial",
      strictCampaignPayloadSummary: `${strictSpecLabel} available; ${skippedRunLabel} could not be materialized.`,
    };
  }

  return {
    strictCampaignPayloadStatus: "ready",
    strictCampaignPayloadSummary: `${strictSpecLabel} ready for ${executionAdapter.label}.`,
  };
}

function getExperimentLaunchCurrentSubmissionKind(
  executionAdapter: ExperimentExecutionAdapter,
): ExperimentLaunchCurrentSubmissionKind {
  return executionAdapter.id === LEGACY_LOCAL_EXPERIMENT_EXECUTION_ADAPTER.id
    ? "legacy_config"
    : "native_payload";
}

function withExecutionAdapterBackend(
  legacyConfig: ExperimentConfig,
  executionAdapter: ExperimentExecutionAdapter,
): ExperimentConfig {
  const executionBackend = executionAdapter.nativeBackends[0];
  if (executionBackend === "local-python" || legacyConfig.execution_backend === executionBackend) {
    return legacyConfig;
  }
  return { ...legacyConfig, execution_backend: executionBackend };
}

export function getExperimentLaunchStrictPayloadActivation(
  launchPayloadPlan: Pick<
    ExperimentLaunchPayloadPlan,
    "strictCampaignPayloadStatus" | "strictCampaignSpecs"
  >,
): ExperimentLaunchStrictPayloadActivation {
  if (launchPayloadPlan.strictCampaignPayloadStatus === "legacy_only") {
    return {
      status: "legacy_not_applicable",
      canUseStrictPayload: false,
      message: "Strict campaign payloads are not used by legacy local launches.",
    };
  }

  if (launchPayloadPlan.strictCampaignPayloadStatus === "ready") {
    return {
      status: "ready",
      canUseStrictPayload: true,
      message: "Strict campaign payload is ready for native submitters.",
    };
  }

  if (launchPayloadPlan.strictCampaignPayloadStatus === "partial") {
    return {
      status: "blocked",
      canUseStrictPayload: false,
      message: `${launchPayloadPlan.strictCampaignSpecs.skippedRunIds.length} run ${launchPayloadPlan.strictCampaignSpecs.skippedRunIds.length === 1 ? "entry" : "entries"} must be materialized before strict payload submission.`,
    };
  }

  return {
    status: "blocked",
    canUseStrictPayload: false,
    message: "Strict campaign payload is unavailable for this launch.",
  };
}

export function getExperimentLaunchPayloadSubmissionBlockMessage(
  launchPayloadPlan: Pick<
    ExperimentLaunchPayloadPlan,
    "currentSubmissionKind" | "strictCampaignPayloadActivation"
  >,
): string | null {
  if (
    launchPayloadPlan.currentSubmissionKind === "native_payload" &&
    !launchPayloadPlan.strictCampaignPayloadActivation.canUseStrictPayload
  ) {
    return launchPayloadPlan.strictCampaignPayloadActivation.message;
  }

  return null;
}

export function buildExperimentLaunchPayloadDiagnostics(
  launchPayloadPlan: BuildExperimentLaunchPayloadDiagnosticsInput,
): ExperimentLaunchPayloadDiagnostics {
  const { manifest } = launchPayloadPlan.nativePayload;
  const nativePayloadRequired = launchPayloadPlan.currentSubmissionKind === "native_payload";
  const canSubmitNativePayload = nativePayloadRequired
    && launchPayloadPlan.strictCampaignPayloadActivation.canUseStrictPayload;

  return {
    nativePayloadVersion: manifest.version,
    currentSubmissionKind: launchPayloadPlan.currentSubmissionKind,
    strictCampaignPayloadStatus: launchPayloadPlan.strictCampaignPayloadStatus,
    strictCampaignPayloadActivationStatus: launchPayloadPlan.strictCampaignPayloadActivation.status,
    nativePayloadRequired,
    canSubmitNativePayload,
    blockedReason: getExperimentLaunchPayloadSubmissionBlockMessage(launchPayloadPlan),
    legacyDatasetCount: manifest.legacyDatasetCount,
    legacyPipelineCount: manifest.legacyPipelineCount,
    strictCampaignCount: manifest.strictCampaignCount,
    skippedRunCount: manifest.skippedRunCount,
    sourceRunCount: manifest.sourceRunIds.length,
    sourceRunIds: [...manifest.sourceRunIds],
    skippedRunIds: [...manifest.skippedRunIds],
  };
}

export function buildExperimentLaunchPayloadPlan({
  executionAdapter,
  legacyConfig,
  strictCampaignSpecs,
}: BuildExperimentLaunchPayloadPlanInput): ExperimentLaunchPayloadPlan {
  const currentSubmissionKind = getExperimentLaunchCurrentSubmissionKind(executionAdapter);
  const strictPayloadSummary = buildStrictCampaignPayloadSummary(executionAdapter, strictCampaignSpecs);
  const effectiveLegacyConfig = withExecutionAdapterBackend(legacyConfig, executionAdapter);
  const nativePayload = buildNativeExperimentLaunchPayload(effectiveLegacyConfig, strictCampaignSpecs);
  const strictCampaignPayloadActivation = getExperimentLaunchStrictPayloadActivation({
    strictCampaignSpecs,
    strictCampaignPayloadStatus: strictPayloadSummary.strictCampaignPayloadStatus,
  });

  return {
    currentSubmissionKind,
    legacyConfig: effectiveLegacyConfig,
    strictCampaignSpecs,
    nativePayload,
    ...strictPayloadSummary,
    strictCampaignPayloadActivation,
    payloadDiagnostics: buildExperimentLaunchPayloadDiagnostics({
      currentSubmissionKind,
      strictCampaignPayloadStatus: strictPayloadSummary.strictCampaignPayloadStatus,
      strictCampaignPayloadActivation,
      nativePayload,
    }),
  };
}

export function buildExperimentLaunchSelectionPayloadPlan({
  name,
  description,
  selectedDatasetIds,
  selectedPipelineConfigs,
  selectedGroupingPayload,
  strictCampaignSpecs,
  executionAdapter,
  missingIssues = [],
  runtimeEngine,
  allowFallback,
}: BuildExperimentLaunchSelectionPayloadPlanInput): ExperimentLaunchPayloadPlan {
  const legacyConfig = buildExperimentLaunchConfig({
    name,
    description,
    selectedDatasetIds,
    selectedPipelineConfigs,
    selectedGroupingPayload,
    missingIssues,
    executionBackend: executionAdapter.nativeBackends[0],
    runtimeEngine,
    allowFallback,
  });
  const effectiveStrictCampaignSpecs = buildExperimentLaunchStrictCampaignSpecs({
    strictCampaignSpecs,
    selectedPipelineConfigs,
    missingIssues,
  });

  return buildExperimentLaunchPayloadPlan({
    executionAdapter,
    legacyConfig,
    strictCampaignSpecs: effectiveStrictCampaignSpecs,
  });
}

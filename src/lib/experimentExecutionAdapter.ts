import type { InlinePipelinePayload } from "@/api/runs";
import type {
  CampaignSinglePairSplitSpecResult,
} from "@/lib/campaignPlanPreviewTypes";
import type { CampaignExecutionBackend } from "@/lib/campaignSpecTypes";
import type { ExperimentConfig, Run } from "@/types/runs";
import {
  WORKSPACE_PREDICTION_PUBLICATION_DESTINATION,
  WORKSPACE_PREDICTION_PUBLICATION_EFFECTS,
  WORKSPACE_PREDICTION_PUBLICATION_KEYWORD_IDS,
} from "@/ui/keywordRegistry";

export type ExperimentExecutionAdapterId = "legacy-local" | "cluster" | "wasm-local";
export const NATIVE_EXPERIMENT_LAUNCH_PAYLOAD_VERSION = "studio.native-launch-payload.v1" as const;

export type NativeExperimentLaunchPayloadVersion = typeof NATIVE_EXPERIMENT_LAUNCH_PAYLOAD_VERSION;

export interface ExperimentPreflightRequest {
  pipelineIds: string[];
  inlinePipeline?: InlinePipelinePayload;
  inlinePipelines: InlinePipelinePayload[];
}

export interface LegacyRunExperimentLaunchSubmission {
  kind: "legacy-run";
  config: ExperimentConfig;
}

export interface NativeExperimentLaunchPayloadManifest {
  version: NativeExperimentLaunchPayloadVersion;
  legacyExperimentName: string;
  legacyDatasetCount: number;
  legacyPipelineCount: number;
  robustnessEvidencePublicationHandoff?: NativeRobustnessEvidencePublicationHandoffManifest;
  strictCampaignCount: number;
  skippedRunCount: number;
  sourceRunIds: string[];
  skippedRunIds: string[];
}

export interface NativeRobustnessEvidencePublicationHandoffManifest {
  kind: "robustness_evidence_publication_handoff";
  requested: boolean;
  destination: "result_metadata.robustness_evidence";
  failClosed: boolean;
  keywordIds: typeof WORKSPACE_PREDICTION_PUBLICATION_KEYWORD_IDS;
  requiredEffects: typeof WORKSPACE_PREDICTION_PUBLICATION_EFFECTS;
  conformalArtifactPolicy: "prediction_publisher_does_not_persist_conformal_artifacts";
  alignmentStrategies: Array<
    "sample_indices"
    | "full_dataset_length"
    | "unique_metadata_identity"
    | "relation_manifest_identity"
  >;
  publishedFields: [
    "prediction_arrays.X",
    "result_metadata.robustness_evidence.X",
    "result_metadata.robustness_evidence.predictor_bundle",
  ];
}

export interface NativeExperimentLaunchPayload {
  legacyConfig: ExperimentConfig;
  manifest: NativeExperimentLaunchPayloadManifest;
  strictCampaignSpecs: CampaignSinglePairSplitSpecResult;
}

export interface ClusterExperimentLaunchSubmission {
  kind: "cluster-run";
  requestedBackend: "cluster";
  config: ExperimentConfig;
  nativePayload?: NativeExperimentLaunchPayload;
}

export interface WasmLocalExperimentLaunchSubmission {
  kind: "wasm-local-run";
  requestedBackend: "wasm-local";
  config: ExperimentConfig;
  nativePayload?: NativeExperimentLaunchPayload;
}

export type ExperimentLaunchSubmission =
  | LegacyRunExperimentLaunchSubmission
  | ClusterExperimentLaunchSubmission
  | WasmLocalExperimentLaunchSubmission;

export type SubmitLegacyRun = (config: ExperimentConfig) => Promise<Run>;
export type SubmitClusterRun = (payload: NativeExperimentLaunchPayload) => Promise<Run>;
export type SubmitWasmLocalRun = (payload: NativeExperimentLaunchPayload) => Promise<Run>;

export interface SubmitExperimentLaunchSubmissionOptions {
  submitClusterRun?: SubmitClusterRun;
  submitWasmLocalRun?: SubmitWasmLocalRun;
}

export interface ExperimentExecutionAdapter {
  id: ExperimentExecutionAdapterId;
  label: string;
  nativeBackends: CampaignExecutionBackend[];
  buildPreflightRequest: (config: ExperimentConfig) => ExperimentPreflightRequest;
  buildLaunchSubmission: (
    config: ExperimentConfig,
    nativePayload?: NativeExperimentLaunchPayload,
  ) => ExperimentLaunchSubmission;
}

export interface ExperimentExecutionAdapterResolution {
  adapter: ExperimentExecutionAdapter;
  requestedBackend: CampaignExecutionBackend;
  isNativeForBackend: boolean;
  statusLabel: string;
  message: string;
}

export interface ResolveExperimentExecutionAdapterOptions {
  availableAdapters?: readonly ExperimentExecutionAdapter[];
}

export type RunPreflightArgs = [
  pipelineIds: string[],
  inlinePipeline: InlinePipelinePayload | undefined,
  inlinePipelines: InlinePipelinePayload[],
];

export function buildLegacyLocalExperimentPreflightRequest(
  config: ExperimentConfig,
): ExperimentPreflightRequest {
  return {
    pipelineIds: config.pipeline_ids,
    inlinePipeline: config.inline_pipeline,
    inlinePipelines: config.inline_pipelines ?? [],
  };
}

export function buildLegacyLocalExperimentLaunchSubmission(
  config: ExperimentConfig,
): LegacyRunExperimentLaunchSubmission {
  return {
    kind: "legacy-run",
    config,
  };
}

function getNativePayloadLegacyPipelineCount(config: ExperimentConfig): number {
  return (
    config.pipeline_ids.length
    + (config.inline_pipeline ? 1 : 0)
    + (config.inline_pipelines?.length ?? 0)
  );
}

function buildNativeRobustnessEvidencePublicationHandoffManifest(
  legacyConfig: ExperimentConfig,
): NativeRobustnessEvidencePublicationHandoffManifest | undefined {
  const publishEvidence = legacyConfig.robustness?.publish_evidence;
  const spectralReplay = publishEvidence && typeof publishEvidence === "object"
    ? (publishEvidence as Record<string, unknown>).spectral_replay
    : undefined;
  if (!spectralReplay || typeof spectralReplay !== "object") return undefined;

  const spectralReplayRecord = spectralReplay as Record<string, unknown>;
  return {
    kind: "robustness_evidence_publication_handoff",
    requested: true,
    destination: WORKSPACE_PREDICTION_PUBLICATION_DESTINATION,
    failClosed: spectralReplayRecord.fail_closed !== false,
    keywordIds: WORKSPACE_PREDICTION_PUBLICATION_KEYWORD_IDS,
    requiredEffects: WORKSPACE_PREDICTION_PUBLICATION_EFFECTS,
    conformalArtifactPolicy: "prediction_publisher_does_not_persist_conformal_artifacts",
    alignmentStrategies: [
      "sample_indices",
      "full_dataset_length",
      "unique_metadata_identity",
      "relation_manifest_identity",
    ],
    publishedFields: [
      "prediction_arrays.X",
      "result_metadata.robustness_evidence.X",
      "result_metadata.robustness_evidence.predictor_bundle",
    ],
  };
}

export function buildNativeExperimentLaunchPayloadManifest(
  legacyConfig: ExperimentConfig,
  strictCampaignSpecs: CampaignSinglePairSplitSpecResult,
): NativeExperimentLaunchPayloadManifest {
  const robustnessEvidencePublicationHandoff = buildNativeRobustnessEvidencePublicationHandoffManifest(legacyConfig);
  return {
    version: NATIVE_EXPERIMENT_LAUNCH_PAYLOAD_VERSION,
    legacyExperimentName: legacyConfig.name,
    legacyDatasetCount: legacyConfig.dataset_ids.length,
    legacyPipelineCount: getNativePayloadLegacyPipelineCount(legacyConfig),
    ...(robustnessEvidencePublicationHandoff ? { robustnessEvidencePublicationHandoff } : {}),
    strictCampaignCount: strictCampaignSpecs.splitSpecs.length,
    skippedRunCount: strictCampaignSpecs.skippedRunIds.length,
    sourceRunIds: strictCampaignSpecs.splitSpecs.map((splitSpec) => splitSpec.sourceRunId),
    skippedRunIds: [...strictCampaignSpecs.skippedRunIds],
  };
}

export function buildNativeExperimentLaunchPayload(
  legacyConfig: ExperimentConfig,
  strictCampaignSpecs: CampaignSinglePairSplitSpecResult = { splitSpecs: [], skippedRunIds: [] },
): NativeExperimentLaunchPayload {
  return {
    legacyConfig,
    manifest: buildNativeExperimentLaunchPayloadManifest(legacyConfig, strictCampaignSpecs),
    strictCampaignSpecs,
  };
}

export function buildClusterExperimentLaunchSubmission(
  config: ExperimentConfig,
  nativePayload = buildNativeExperimentLaunchPayload(config),
): ClusterExperimentLaunchSubmission {
  return {
    kind: "cluster-run",
    requestedBackend: "cluster",
    config,
    nativePayload,
  };
}

export function buildWasmLocalExperimentLaunchSubmission(
  config: ExperimentConfig,
  nativePayload = buildNativeExperimentLaunchPayload(config),
): WasmLocalExperimentLaunchSubmission {
  return {
    kind: "wasm-local-run",
    requestedBackend: "wasm-local",
    config,
    nativePayload,
  };
}

export function buildExperimentPreflightRequest(
  adapter: ExperimentExecutionAdapter,
  config: ExperimentConfig,
): ExperimentPreflightRequest {
  return adapter.buildPreflightRequest(config);
}

export function buildExperimentLaunchSubmission(
  adapter: ExperimentExecutionAdapter,
  config: ExperimentConfig,
  nativePayload?: NativeExperimentLaunchPayload,
): ExperimentLaunchSubmission {
  return adapter.buildLaunchSubmission(config, nativePayload);
}

export function submitExperimentLaunchSubmission(
  submission: ExperimentLaunchSubmission,
  submitLegacyRun: SubmitLegacyRun,
  options: SubmitExperimentLaunchSubmissionOptions = {},
): Promise<Run> {
  if (submission.kind === "legacy-run") {
    return submitLegacyRun(submission.config);
  }

  if (submission.kind === "cluster-run" && options.submitClusterRun) {
    return options.submitClusterRun(submission.nativePayload ?? buildNativeExperimentLaunchPayload(submission.config));
  }

  if (submission.kind === "wasm-local-run" && options.submitWasmLocalRun) {
    return options.submitWasmLocalRun(submission.nativePayload ?? buildNativeExperimentLaunchPayload(submission.config));
  }

  return Promise.reject(new Error(
    `${submission.requestedBackend} launch submissions are typed but no transport is wired yet.`,
  ));
}

export function getRunPreflightArgs(request: ExperimentPreflightRequest): RunPreflightArgs {
  return [
    request.pipelineIds,
    request.inlinePipeline,
    request.inlinePipelines,
  ];
}

export const LEGACY_LOCAL_EXPERIMENT_EXECUTION_ADAPTER: ExperimentExecutionAdapter = {
  id: "legacy-local",
  label: "Legacy local run API",
  nativeBackends: ["local-python"],
  buildPreflightRequest: buildLegacyLocalExperimentPreflightRequest,
  buildLaunchSubmission: buildLegacyLocalExperimentLaunchSubmission,
};

export const CLUSTER_EXPERIMENT_EXECUTION_ADAPTER: ExperimentExecutionAdapter = {
  id: "cluster",
  label: "Cluster execution adapter",
  nativeBackends: ["cluster"],
  buildPreflightRequest: buildLegacyLocalExperimentPreflightRequest,
  buildLaunchSubmission: buildClusterExperimentLaunchSubmission,
};

export const WASM_LOCAL_EXPERIMENT_EXECUTION_ADAPTER: ExperimentExecutionAdapter = {
  id: "wasm-local",
  label: "WASM local execution adapter",
  nativeBackends: ["wasm-local"],
  buildPreflightRequest: buildLegacyLocalExperimentPreflightRequest,
  buildLaunchSubmission: buildWasmLocalExperimentLaunchSubmission,
};

export const DEFAULT_EXPERIMENT_EXECUTION_ADAPTERS: readonly ExperimentExecutionAdapter[] = [
  LEGACY_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
];

export function resolveExperimentExecutionAdapter(
  backend: CampaignExecutionBackend,
  options: ResolveExperimentExecutionAdapterOptions = {},
): ExperimentExecutionAdapterResolution {
  const availableAdapters = options.availableAdapters ?? DEFAULT_EXPERIMENT_EXECUTION_ADAPTERS;
  const nativeAdapter = availableAdapters.find((adapter) => adapter.nativeBackends.includes(backend));
  const adapter = nativeAdapter
    ?? availableAdapters.find((candidate) => candidate.id === LEGACY_LOCAL_EXPERIMENT_EXECUTION_ADAPTER.id)
    ?? LEGACY_LOCAL_EXPERIMENT_EXECUTION_ADAPTER;
  const isNativeForBackend = Boolean(nativeAdapter);
  const isLegacyNative = adapter.id === LEGACY_LOCAL_EXPERIMENT_EXECUTION_ADAPTER.id && isNativeForBackend;

  return {
    adapter,
    requestedBackend: backend,
    isNativeForBackend,
    statusLabel: isNativeForBackend ? "Native adapter" : "Legacy fallback",
    message: isLegacyNative
      ? "Launches use the current local run API."
      : isNativeForBackend
        ? `${adapter.label} is selected for this campaign backend.`
      : "No native adapter is wired for this backend yet; launches still target the legacy local run API.",
  };
}

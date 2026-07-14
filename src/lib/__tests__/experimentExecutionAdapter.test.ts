import { describe, expect, it } from "vitest";

import type { CampaignSinglePairSplitSpecResult } from "../campaignPlan";
import type { ExperimentConfig } from "@/types/runs";
import {
  WORKSPACE_PREDICTION_PUBLICATION_EFFECTS,
  WORKSPACE_PREDICTION_PUBLICATION_KEYWORD_IDS,
} from "@/ui/keywordRegistry";

import {
  buildClusterExperimentLaunchSubmission,
  buildExperimentLaunchSubmission,
  buildExperimentPreflightRequest,
  buildLegacyLocalExperimentLaunchSubmission,
  buildLegacyLocalExperimentPreflightRequest,
  buildNativeExperimentLaunchPayload,
  buildWasmLocalExperimentLaunchSubmission,
  CLUSTER_EXPERIMENT_EXECUTION_ADAPTER,
  DEFAULT_EXPERIMENT_EXECUTION_ADAPTERS,
  getRunPreflightArgs,
  LEGACY_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
  NATIVE_EXPERIMENT_LAUNCH_PAYLOAD_VERSION,
  resolveExperimentExecutionAdapter,
  submitExperimentLaunchSubmission,
  WASM_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
} from "../experimentExecutionAdapter";

describe("experimentExecutionAdapter", () => {
  it("builds legacy local preflight requests from experiment configs", () => {
    const config: ExperimentConfig = {
      name: "Experiment",
      dataset_ids: ["d1"],
      pipeline_ids: ["p1"],
      inline_pipeline: {
        name: "Draft",
        steps: [{ id: "draft" }],
      },
      inline_pipelines: [
        {
          name: "Pruned",
          steps: [{ id: "model" }],
        },
      ],
      split_group_by_by_dataset: { d1: null },
    };

    expect(buildLegacyLocalExperimentPreflightRequest(config)).toEqual({
      pipelineIds: ["p1"],
      inlinePipeline: {
        name: "Draft",
        steps: [{ id: "draft" }],
      },
      inlinePipelines: [
        {
          name: "Pruned",
          steps: [{ id: "model" }],
        },
      ],
    });
    expect(LEGACY_LOCAL_EXPERIMENT_EXECUTION_ADAPTER.buildPreflightRequest(config)).toEqual(
      buildLegacyLocalExperimentPreflightRequest(config),
    );
    expect(LEGACY_LOCAL_EXPERIMENT_EXECUTION_ADAPTER.buildLaunchSubmission(config)).toEqual(
      buildLegacyLocalExperimentLaunchSubmission(config),
    );
  });

  it("normalizes missing additional inline pipelines to an empty list", () => {
    expect(LEGACY_LOCAL_EXPERIMENT_EXECUTION_ADAPTER.buildPreflightRequest({
      name: "Experiment",
      dataset_ids: ["d1"],
      pipeline_ids: ["p1"],
    })).toMatchObject({
      pipelineIds: ["p1"],
      inlinePipeline: undefined,
      inlinePipelines: [],
    });
  });

  it("prepares adapter preflight requests and run-preflight arguments", () => {
    const config: ExperimentConfig = {
      name: "Experiment",
      dataset_ids: ["d1"],
      pipeline_ids: ["p1"],
      inline_pipeline: {
        name: "Draft",
        steps: [{ id: "draft" }],
      },
    };

    const request = buildExperimentPreflightRequest(LEGACY_LOCAL_EXPERIMENT_EXECUTION_ADAPTER, config);
    expect(request).toEqual({
      pipelineIds: ["p1"],
      inlinePipeline: {
        name: "Draft",
        steps: [{ id: "draft" }],
      },
      inlinePipelines: [],
    });
    expect(getRunPreflightArgs(request)).toEqual([
      ["p1"],
      {
        name: "Draft",
        steps: [{ id: "draft" }],
      },
      [],
    ]);
    expect(buildExperimentLaunchSubmission(LEGACY_LOCAL_EXPERIMENT_EXECUTION_ADAPTER, config)).toEqual({
      kind: "legacy-run",
      config,
    });
  });

  it("builds typed future-backend launch submissions without wiring transport", () => {
    const config: ExperimentConfig = {
      name: "Experiment",
      dataset_ids: ["d1"],
      pipeline_ids: ["p1"],
    };

    expect(buildClusterExperimentLaunchSubmission(config)).toEqual({
      kind: "cluster-run",
      requestedBackend: "cluster",
      config,
      nativePayload: buildNativeExperimentLaunchPayload(config),
    });
    expect(buildWasmLocalExperimentLaunchSubmission(config)).toEqual({
      kind: "wasm-local-run",
      requestedBackend: "wasm-local",
      config,
      nativePayload: buildNativeExperimentLaunchPayload(config),
    });
    expect(CLUSTER_EXPERIMENT_EXECUTION_ADAPTER.buildPreflightRequest(config)).toEqual(
      buildLegacyLocalExperimentPreflightRequest(config),
    );
    expect(WASM_LOCAL_EXPERIMENT_EXECUTION_ADAPTER.buildPreflightRequest(config)).toEqual(
      buildLegacyLocalExperimentPreflightRequest(config),
    );
    expect(CLUSTER_EXPERIMENT_EXECUTION_ADAPTER.buildLaunchSubmission(config)).toEqual(
      buildClusterExperimentLaunchSubmission(config),
    );
    expect(WASM_LOCAL_EXPERIMENT_EXECUTION_ADAPTER.buildLaunchSubmission(config)).toEqual(
      buildWasmLocalExperimentLaunchSubmission(config),
    );
  });

  it("builds versioned native payload manifests for future submitters", () => {
    const config: ExperimentConfig = {
      name: "Experiment",
      dataset_ids: ["d1", "d2"],
      pipeline_ids: ["p1"],
      inline_pipeline: {
        name: "Draft",
        steps: [{ id: "draft" }],
      },
      inline_pipelines: [
        {
          name: "Pruned",
          steps: [{ id: "model" }],
        },
      ],
    };
    const strictCampaignSpecs = {
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
      skippedRunIds: ["d2::p1"],
    } satisfies CampaignSinglePairSplitSpecResult;

    expect(buildNativeExperimentLaunchPayload(config, strictCampaignSpecs).manifest).toEqual({
      version: NATIVE_EXPERIMENT_LAUNCH_PAYLOAD_VERSION,
      legacyExperimentName: "Experiment",
      legacyDatasetCount: 2,
      legacyPipelineCount: 3,
      strictCampaignCount: 1,
      skippedRunCount: 1,
      sourceRunIds: ["d1::p1"],
      skippedRunIds: ["d2::p1"],
    });
  });

  it("carries robustness evidence handoff metadata in native payload manifests", () => {
    const config: ExperimentConfig = {
      name: "Cluster Robustness Experiment",
      dataset_ids: ["d1"],
      pipeline_ids: ["p1"],
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
    };

    const payload = buildNativeExperimentLaunchPayload(config);

    expect(payload.manifest.robustnessEvidencePublicationHandoff).toEqual({
      kind: "robustness_evidence_publication_handoff",
      requested: true,
      destination: "result_metadata.robustness_evidence",
      failClosed: true,
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
    });
    expect(buildClusterExperimentLaunchSubmission(config).nativePayload?.manifest.robustnessEvidencePublicationHandoff).toEqual(
      payload.manifest.robustnessEvidencePublicationHandoff,
    );
  });

  it("submits legacy run launch submissions through an injected runner", async () => {
    const config: ExperimentConfig = {
      name: "Experiment",
      dataset_ids: ["d1"],
      pipeline_ids: ["p1"],
    };
    const submitLegacyRun = async (submittedConfig: ExperimentConfig) => ({
      id: "run-1",
      name: submittedConfig.name,
    } as never);

    await expect(submitExperimentLaunchSubmission({
      kind: "legacy-run",
      config,
    }, submitLegacyRun)).resolves.toMatchObject({
      id: "run-1",
      name: "Experiment",
    });
  });

  it("rejects future-backend submissions until a native transport is wired", async () => {
    const config: ExperimentConfig = {
      name: "Experiment",
      dataset_ids: ["d1"],
      pipeline_ids: ["p1"],
    };
    let calledLegacySubmit = false;
    const submitLegacyRun = async (submittedConfig: ExperimentConfig) => {
      calledLegacySubmit = true;
      return { id: "run-1", name: submittedConfig.name } as never;
    };

    await expect(
      submitExperimentLaunchSubmission(
        buildClusterExperimentLaunchSubmission(config),
        submitLegacyRun,
      ),
    ).rejects.toThrow("cluster launch submissions are typed but no transport is wired yet.");
    expect(calledLegacySubmit).toBe(false);
  });

  it("submits future-backend launch submissions through injected native transports", async () => {
    const clusterConfig: ExperimentConfig = {
      name: "Cluster Experiment",
      dataset_ids: ["d1"],
      pipeline_ids: ["p1"],
    };
    const wasmConfig: ExperimentConfig = {
      name: "WASM Experiment",
      dataset_ids: ["d2"],
      pipeline_ids: ["p2"],
    };
    const submittedClusterPayloads: ReturnType<typeof buildNativeExperimentLaunchPayload>[] = [];
    const submittedWasmPayloads: ReturnType<typeof buildNativeExperimentLaunchPayload>[] = [];
    let calledLegacySubmit = false;
    const submitLegacyRun = async (submittedConfig: ExperimentConfig) => {
      calledLegacySubmit = true;
      return { id: "legacy-run", name: submittedConfig.name } as never;
    };

    await expect(
      submitExperimentLaunchSubmission(
        buildClusterExperimentLaunchSubmission(clusterConfig),
        submitLegacyRun,
        {
          submitClusterRun: async (submittedPayload) => {
            submittedClusterPayloads.push(submittedPayload);
            return { id: "cluster-run-1", name: submittedPayload.legacyConfig.name } as never;
          },
        },
      ),
    ).resolves.toMatchObject({
      id: "cluster-run-1",
      name: "Cluster Experiment",
    });
    await expect(
      submitExperimentLaunchSubmission(
        buildWasmLocalExperimentLaunchSubmission(wasmConfig),
        submitLegacyRun,
        {
          submitWasmLocalRun: async (submittedPayload) => {
            submittedWasmPayloads.push(submittedPayload);
            return { id: "wasm-run-1", name: submittedPayload.legacyConfig.name } as never;
          },
        },
      ),
    ).resolves.toMatchObject({
      id: "wasm-run-1",
      name: "WASM Experiment",
    });

    expect(calledLegacySubmit).toBe(false);
    expect(submittedClusterPayloads).toEqual([buildNativeExperimentLaunchPayload(clusterConfig)]);
    expect(submittedWasmPayloads).toEqual([buildNativeExperimentLaunchPayload(wasmConfig)]);
  });

  it("resolves local and future backends to explicit adapter status metadata", () => {
    expect(DEFAULT_EXPERIMENT_EXECUTION_ADAPTERS).toEqual([
      LEGACY_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
    ]);
    expect(resolveExperimentExecutionAdapter("local-python")).toMatchObject({
      adapter: LEGACY_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
      requestedBackend: "local-python",
      isNativeForBackend: true,
      statusLabel: "Native adapter",
      message: "Launches use the current local run API.",
    });
    expect(resolveExperimentExecutionAdapter("cluster")).toMatchObject({
      adapter: LEGACY_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
      requestedBackend: "cluster",
      isNativeForBackend: false,
      statusLabel: "Legacy fallback",
      message: "No native adapter is wired for this backend yet; launches still target the legacy local run API.",
    });
    expect(resolveExperimentExecutionAdapter("wasm-local")).toMatchObject({
      adapter: LEGACY_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
      requestedBackend: "wasm-local",
      isNativeForBackend: false,
      statusLabel: "Legacy fallback",
      message: "No native adapter is wired for this backend yet; launches still target the legacy local run API.",
    });
  });

  it("can resolve future backends to injected native adapters once transports are available", () => {
    const availableAdapters = [
      LEGACY_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
      CLUSTER_EXPERIMENT_EXECUTION_ADAPTER,
      WASM_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
    ];

    expect(resolveExperimentExecutionAdapter("cluster", { availableAdapters })).toMatchObject({
      adapter: CLUSTER_EXPERIMENT_EXECUTION_ADAPTER,
      requestedBackend: "cluster",
      isNativeForBackend: true,
      statusLabel: "Native adapter",
      message: "Cluster execution adapter is selected for this campaign backend.",
    });
    expect(resolveExperimentExecutionAdapter("wasm-local", { availableAdapters })).toMatchObject({
      adapter: WASM_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
      requestedBackend: "wasm-local",
      isNativeForBackend: true,
      statusLabel: "Native adapter",
      message: "WASM local execution adapter is selected for this campaign backend.",
    });
  });
});

/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PreflightResult } from "@/api/runs";
import type { CampaignSinglePairSplitSpecResult } from "@/lib/campaignPlan";
import {
  buildNativeExperimentLaunchPayload,
  NATIVE_EXPERIMENT_LAUNCH_PAYLOAD_VERSION,
  type ExperimentExecutionAdapter,
  type SubmitClusterRun,
} from "@/lib/experimentExecutionAdapter";
import type { SelectedPipelineConfig } from "@/lib/experimentPipelineSelection";
import type { MissingOperatorIssue } from "@/lib/pipelineOperatorAvailability";
import type { Run } from "@/types/runs";

const apiMocks = vi.hoisted(() => ({
  createRun: vi.fn(),
  runPreflight: vi.fn(),
}));

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("@/api/runs", () => ({
  createRun: apiMocks.createRun,
  runPreflight: apiMocks.runPreflight,
}));

vi.mock("sonner", () => ({
  toast: toastMocks,
}));

import { useNewExperimentLaunchFlow, type UseNewExperimentLaunchFlowInput } from "./useNewExperimentLaunchFlow";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

async function flushMutation() {
  await act(async () => {
    await Promise.resolve();
  });
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
}

async function renderHook<T>(hook: () => T, client = createQueryClient()) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const result: { current: T | undefined } = { current: undefined };

  function TestComponent() {
    result.current = hook();
    return null;
  }

  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <TestComponent />
      </QueryClientProvider>,
    );
  });

  return {
    client,
    result,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

const selectedPipelineConfigs: SelectedPipelineConfig[] = [
  {
    id: "p1",
    name: "PLS Pipeline",
    steps: [
      { id: "pre", name: "SNV" },
      { id: "model", name: "PLS" },
    ],
  },
];

const singlePairSplitSpecResult: CampaignSinglePairSplitSpecResult = {
  splitSpecs: [
    {
      id: "single-pair:d1::p1",
      sourceRunId: "d1::p1",
      sourceDatasetId: "d1",
      sourcePipelineId: "p1",
      campaign: {
        name: "Experiment / Dataset -> PLS Pipeline",
        mode: "paired_by_index",
        executionBackend: "cluster",
        datasets: [{ id: "d1", name: "Dataset", splitGroupBy: null }],
        pipelines: [{ id: "p1", name: "PLS Pipeline", source: "saved" }],
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

function missingOperatorIssue(): MissingOperatorIssue {
  return {
    type: "missing_module",
    message: "SNV unavailable",
    details: {
      pipeline_id: "p1",
      step_id: "pre",
    },
  };
}

function run(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    name: "Experiment",
    status: "queued",
    created_at: "2026-01-01T00:00:00",
    datasets: [],
    ...overrides,
  };
}

function launchFlowInput(overrides: Partial<UseNewExperimentLaunchFlowInput> = {}): UseNewExperimentLaunchFlowInput {
  return {
    experimentName: "Experiment",
    experimentDescription: "",
    selectedDatasetIds: ["d1"],
    selectedPipelineConfigs,
    selectedGroupingPayload: { d1: null },
    hasGroupingBlockingError: false,
    onGroupingBlockingError: vi.fn(),
    onRunCreated: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  Object.values(apiMocks).forEach((mock) => mock.mockReset());
  Object.values(toastMocks).forEach((mock) => mock.mockReset());
});

describe("useNewExperimentLaunchFlow", () => {
  it("preflights and launches a ready experiment", async () => {
    const onRunCreated = vi.fn();
    apiMocks.runPreflight.mockResolvedValue({ ready: true, issues: [] } satisfies PreflightResult);
    apiMocks.createRun.mockResolvedValue(run());

    const mounted = await renderHook(() => useNewExperimentLaunchFlow(launchFlowInput({ onRunCreated })));

    expect(mounted.result.current!.launchPayloadPlan).toMatchObject({
      currentSubmissionKind: "legacy_config",
      strictCampaignPayloadStatus: "legacy_only",
      strictCampaignPayloadSummary: "Legacy local launches submit the current ExperimentConfig payload.",
    });

    await act(async () => {
      await mounted.result.current!.handleLaunch();
    });
    await flushMutation();

    expect(apiMocks.runPreflight).toHaveBeenCalledWith(["p1"], undefined, []);
    expect(apiMocks.createRun).toHaveBeenCalledWith({
      name: "Experiment",
      description: undefined,
      dataset_ids: ["d1"],
      pipeline_ids: ["p1"],
      inline_pipeline: undefined,
      inline_pipelines: [],
      split_group_by_by_dataset: { d1: null },
    });
    expect(toastMocks.success).toHaveBeenCalledWith("Experiment started!");
    expect(onRunCreated).toHaveBeenCalledWith("run-1");

    await mounted.unmount();
  });

  it("uses the injected execution adapter for preflight requests", async () => {
    const executionAdapter: ExperimentExecutionAdapter = {
      id: "legacy-local",
      label: "Test adapter",
      nativeBackends: ["local-python"],
      buildPreflightRequest: vi.fn(() => ({
        pipelineIds: ["adapter-pipeline"],
        inlinePipeline: { name: "Adapter inline", steps: [{ id: "adapter" }] },
        inlinePipelines: [{ name: "Additional", steps: [{ id: "additional" }] }],
      })),
      buildLaunchSubmission: vi.fn((config) => ({ kind: "legacy-run" as const, config })),
    };
    apiMocks.runPreflight.mockResolvedValue({ ready: true, issues: [] } satisfies PreflightResult);
    apiMocks.createRun.mockResolvedValue(run());

    const mounted = await renderHook(() => useNewExperimentLaunchFlow(launchFlowInput({ executionAdapter })));

    await act(async () => {
      await mounted.result.current!.handleLaunch();
    });

    expect(executionAdapter.buildPreflightRequest).toHaveBeenCalledWith(expect.objectContaining({
      dataset_ids: ["d1"],
      pipeline_ids: ["p1"],
    }));
    expect(apiMocks.runPreflight).toHaveBeenCalledWith(
      ["adapter-pipeline"],
      { name: "Adapter inline", steps: [{ id: "adapter" }] },
      [{ name: "Additional", steps: [{ id: "additional" }] }],
    );

    await mounted.unmount();
  });

  it("uses injected native launch submitters for non-legacy submissions", async () => {
    const onRunCreated = vi.fn();
    const submitClusterRun: SubmitClusterRun = vi.fn(async () => run({ id: "cluster-run-1" }));
    const executionAdapter: ExperimentExecutionAdapter = {
      id: "cluster",
      label: "Cluster execution adapter",
      nativeBackends: ["cluster"],
      buildPreflightRequest: vi.fn((config) => ({
        pipelineIds: config.pipeline_ids,
        inlinePipeline: config.inline_pipeline,
        inlinePipelines: config.inline_pipelines ?? [],
      })),
      buildLaunchSubmission: vi.fn((config, nativePayload) => ({
        kind: "cluster-run" as const,
        requestedBackend: "cluster" as const,
        config,
        nativePayload,
      })),
    };
    apiMocks.runPreflight.mockResolvedValue({ ready: true, issues: [] } satisfies PreflightResult);

    const mounted = await renderHook(() => useNewExperimentLaunchFlow(launchFlowInput({
      executionAdapter,
      launchSubmitters: { submitClusterRun },
      onRunCreated,
      singlePairSplitSpecResult,
    })));

    expect(mounted.result.current!.launchPayloadPlan).toMatchObject({
      currentSubmissionKind: "native_payload",
      strictCampaignPayloadStatus: "ready",
      strictCampaignPayloadSummary: "1 strict campaign spec ready for Cluster execution adapter.",
      strictCampaignSpecs: singlePairSplitSpecResult,
      nativePayload: {
        strictCampaignSpecs: singlePairSplitSpecResult,
      },
    });

    await act(async () => {
      await mounted.result.current!.handleLaunch();
    });
    await flushMutation();

    expect(apiMocks.createRun).not.toHaveBeenCalled();
    expect(submitClusterRun).toHaveBeenCalledWith(buildNativeExperimentLaunchPayload({
      name: "Experiment",
      description: undefined,
      execution_backend: "cluster",
      dataset_ids: ["d1"],
      pipeline_ids: ["p1"],
      inline_pipeline: undefined,
      inline_pipelines: [],
      split_group_by_by_dataset: { d1: null },
    }, singlePairSplitSpecResult));
    expect(toastMocks.success).toHaveBeenCalledWith("Experiment started!");
    expect(onRunCreated).toHaveBeenCalledWith("cluster-run-1");

    await mounted.unmount();
  });

  it("blocks native launch submissions when strict payloads are unavailable", async () => {
    const submitClusterRun: SubmitClusterRun = vi.fn(async () => run({ id: "cluster-run-1" }));
    const executionAdapter: ExperimentExecutionAdapter = {
      id: "cluster",
      label: "Cluster execution adapter",
      nativeBackends: ["cluster"],
      buildPreflightRequest: vi.fn((config) => ({
        pipelineIds: config.pipeline_ids,
        inlinePipeline: config.inline_pipeline,
        inlinePipelines: config.inline_pipelines ?? [],
      })),
      buildLaunchSubmission: vi.fn((config, nativePayload) => ({
        kind: "cluster-run" as const,
        requestedBackend: "cluster" as const,
        config,
        nativePayload,
      })),
    };
    apiMocks.runPreflight.mockResolvedValue({ ready: true, issues: [] } satisfies PreflightResult);

    const mounted = await renderHook(() => useNewExperimentLaunchFlow(launchFlowInput({
      executionAdapter,
      launchSubmitters: { submitClusterRun },
      singlePairSplitSpecResult: { splitSpecs: [], skippedRunIds: [] },
    })));

    expect(mounted.result.current!.launchPayloadPlan).toMatchObject({
      currentSubmissionKind: "native_payload",
      strictCampaignPayloadStatus: "unavailable",
      strictCampaignPayloadActivation: {
        status: "blocked",
        canUseStrictPayload: false,
        message: "Strict campaign payload is unavailable for this launch.",
      },
    });

    await act(async () => {
      await mounted.result.current!.handleLaunch();
    });
    await flushMutation();

    expect(apiMocks.createRun).not.toHaveBeenCalled();
    expect(submitClusterRun).not.toHaveBeenCalled();
    expect(toastMocks.error).toHaveBeenCalledWith("Cannot start experiment", {
      description: "Strict campaign payload is unavailable for this launch.",
    });

    await mounted.unmount();
  });

  it("stops before preflight when runtime grouping is blocking", async () => {
    const onGroupingBlockingError = vi.fn();
    const mounted = await renderHook(() => useNewExperimentLaunchFlow(launchFlowInput({
      hasGroupingBlockingError: true,
      onGroupingBlockingError,
    })));

    await act(async () => {
      await mounted.result.current!.handleLaunch();
    });

    expect(apiMocks.runPreflight).not.toHaveBeenCalled();
    expect(apiMocks.createRun).not.toHaveBeenCalled();
    expect(toastMocks.error).toHaveBeenCalledWith("Resolve runtime grouping errors before launching this experiment.");
    expect(onGroupingBlockingError).toHaveBeenCalledTimes(1);

    await mounted.unmount();
  });

  it("opens missing-node confirmation with a pruned launch config", async () => {
    const issue = missingOperatorIssue();
    apiMocks.runPreflight.mockResolvedValue({ ready: false, issues: [issue] } satisfies PreflightResult);
    apiMocks.createRun.mockResolvedValue(run());

    const mounted = await renderHook(() => useNewExperimentLaunchFlow(launchFlowInput()));

    await act(async () => {
      await mounted.result.current!.handleLaunch();
    });

    expect(mounted.result.current!.showMissingNodesDialog).toBe(true);
    expect(mounted.result.current!.pendingMissingIssues).toEqual([issue]);
    expect(apiMocks.createRun).not.toHaveBeenCalled();

    await act(async () => {
      mounted.result.current!.handleConfirmPrunedLaunch();
    });

    expect(apiMocks.createRun).toHaveBeenCalledWith({
      name: "Experiment",
      description: undefined,
      dataset_ids: ["d1"],
      pipeline_ids: [],
      inline_pipeline: {
        name: "PLS Pipeline",
        steps: [{ id: "model", name: "PLS" }],
      },
      inline_pipelines: [],
      split_group_by_by_dataset: { d1: null },
    });

    await mounted.unmount();
  });

  it("blocks native pruned submissions when strict specs remain partial", async () => {
    const issue = missingOperatorIssue();
    const submitClusterRun: SubmitClusterRun = vi.fn(async () => run({ id: "cluster-run-1" }));
    const executionAdapter: ExperimentExecutionAdapter = {
      id: "cluster",
      label: "Cluster execution adapter",
      nativeBackends: ["cluster"],
      buildPreflightRequest: vi.fn((config) => ({
        pipelineIds: config.pipeline_ids,
        inlinePipeline: config.inline_pipeline,
        inlinePipelines: config.inline_pipelines ?? [],
      })),
      buildLaunchSubmission: vi.fn((config, nativePayload) => ({
        kind: "cluster-run" as const,
        requestedBackend: "cluster" as const,
        config,
        nativePayload,
      })),
    };
    apiMocks.runPreflight.mockResolvedValue({ ready: false, issues: [issue] } satisfies PreflightResult);

    const mounted = await renderHook(() => useNewExperimentLaunchFlow(launchFlowInput({
      executionAdapter,
      launchSubmitters: { submitClusterRun },
      singlePairSplitSpecResult: {
        ...singlePairSplitSpecResult,
        skippedRunIds: ["missing-run"],
      },
    })));

    await act(async () => {
      await mounted.result.current!.handleLaunch();
    });

    expect(mounted.result.current!.showMissingNodesDialog).toBe(true);

    await act(async () => {
      mounted.result.current!.handleConfirmPrunedLaunch();
    });
    await flushMutation();

    expect(mounted.result.current!.showMissingNodesDialog).toBe(false);
    expect(apiMocks.createRun).not.toHaveBeenCalled();
    expect(submitClusterRun).not.toHaveBeenCalled();
    expect(toastMocks.error).toHaveBeenCalledWith("Cannot start experiment", {
      description: "1 run entry must be materialized before strict payload submission.",
    });

    await mounted.unmount();
  });

  it("submits pruned strict campaign specs after missing-node confirmation for native launchers", async () => {
    const issue = missingOperatorIssue();
    const onRunCreated = vi.fn();
    const submitClusterRun: SubmitClusterRun = vi.fn(async () => run({ id: "cluster-run-1" }));
    const executionAdapter: ExperimentExecutionAdapter = {
      id: "cluster",
      label: "Cluster execution adapter",
      nativeBackends: ["cluster"],
      buildPreflightRequest: vi.fn((config) => ({
        pipelineIds: config.pipeline_ids,
        inlinePipeline: config.inline_pipeline,
        inlinePipelines: config.inline_pipelines ?? [],
      })),
      buildLaunchSubmission: vi.fn((config, nativePayload) => ({
        kind: "cluster-run" as const,
        requestedBackend: "cluster" as const,
        config,
        nativePayload,
      })),
    };
    apiMocks.runPreflight.mockResolvedValue({ ready: false, issues: [issue] } satisfies PreflightResult);

    const mounted = await renderHook(() => useNewExperimentLaunchFlow(launchFlowInput({
      executionAdapter,
      launchSubmitters: { submitClusterRun },
      onRunCreated,
      singlePairSplitSpecResult,
    })));

    await act(async () => {
      await mounted.result.current!.handleLaunch();
    });

    expect(mounted.result.current!.showMissingNodesDialog).toBe(true);
    expect(submitClusterRun).not.toHaveBeenCalled();

    await act(async () => {
      mounted.result.current!.handleConfirmPrunedLaunch();
    });
    await flushMutation();

    expect(apiMocks.createRun).not.toHaveBeenCalled();
    expect(submitClusterRun).toHaveBeenCalledWith(expect.objectContaining({
      legacyConfig: {
        name: "Experiment",
        description: undefined,
        execution_backend: "cluster",
        dataset_ids: ["d1"],
        pipeline_ids: [],
        inline_pipeline: {
          name: "PLS Pipeline",
          steps: [{ id: "model", name: "PLS" }],
        },
        inline_pipelines: [],
        split_group_by_by_dataset: { d1: null },
      },
      manifest: {
        version: NATIVE_EXPERIMENT_LAUNCH_PAYLOAD_VERSION,
        legacyExperimentName: "Experiment",
        legacyDatasetCount: 1,
        legacyPipelineCount: 1,
        strictCampaignCount: 1,
        skippedRunCount: 0,
        sourceRunIds: ["d1::p1"],
        skippedRunIds: [],
      },
      strictCampaignSpecs: {
        splitSpecs: [
          expect.objectContaining({
            id: "single-pair:d1::p1",
            campaign: expect.objectContaining({
              pipelines: [
                expect.objectContaining({
                  id: "p1",
                  name: "PLS Pipeline",
                  source: "inline-pruned",
                  stepCount: 1,
                  stepSummary: "PLS",
                }),
              ],
            }),
          }),
        ],
        skippedRunIds: [],
      },
    }));
    expect(toastMocks.success).toHaveBeenCalledWith("Experiment started!");
    expect(onRunCreated).toHaveBeenCalledWith("cluster-run-1");

    await mounted.unmount();
  });

  it("falls back to launching when preflight is unavailable", async () => {
    apiMocks.runPreflight.mockRejectedValue(new Error("offline"));
    apiMocks.createRun.mockResolvedValue(run());

    const mounted = await renderHook(() => useNewExperimentLaunchFlow(launchFlowInput()));

    await act(async () => {
      await mounted.result.current!.handleLaunch();
    });
    await flushMutation();

    expect(toastMocks.warning).toHaveBeenCalledWith("Preflight check unavailable — dependency verification was skipped");
    expect(apiMocks.createRun).toHaveBeenCalledWith(expect.objectContaining({
      dataset_ids: ["d1"],
      pipeline_ids: ["p1"],
    }));

    await mounted.unmount();
  });
});

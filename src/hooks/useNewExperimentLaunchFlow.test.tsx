import "@/lib/__tests__/support/experimentI18n";
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

import { PyTorchInstallPromptContext } from "@/context/usePyTorchInstallPrompt";
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

async function renderHook<T>(
  hook: () => T,
  client = createQueryClient(),
  wrap: (children: ReactNode) => ReactNode = (children) => children,
) {
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
        {wrap(<TestComponent />)}
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
    missingTargetPolicy: "predict",
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
      strictCampaignPayloadSummary: "The experiment is prepared for local analysis.",
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
      missing_target_policy: "predict",
      engine: "dag-ml",
      allow_fallback: false,
    });
    expect(toastMocks.success).toHaveBeenCalledWith("Experiment started!");
    expect(onRunCreated).toHaveBeenCalledWith("run-1");

    await mounted.unmount();
  });

  it("threads the strict native runtime contract into launch submissions", async () => {
    apiMocks.runPreflight.mockResolvedValue({ ready: true, issues: [] } satisfies PreflightResult);
    apiMocks.createRun.mockResolvedValue(run());

    const mounted = await renderHook(() => useNewExperimentLaunchFlow(launchFlowInput({ missingTargetPolicy: "remove" })));

    await act(async () => {
      await mounted.result.current!.handleLaunch();
    });
    await flushMutation();

    expect(apiMocks.createRun).toHaveBeenCalledWith(expect.objectContaining({
      engine: "dag-ml",
      allow_fallback: false,
      dataset_ids: ["d1"],
      pipeline_ids: ["p1"],
      missing_target_policy: "remove",
    }));

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
      strictCampaignPayloadSummary: "1 analysis plan ready for Cluster execution adapter.",
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
      missing_target_policy: "predict",
      engine: "dag-ml",
      allow_fallback: false,
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
        message: "The experiment could not be prepared. Check the selected data and pipelines.",
      },
    });

    await act(async () => {
      await mounted.result.current!.handleLaunch();
    });
    await flushMutation();

    expect(apiMocks.createRun).not.toHaveBeenCalled();
    expect(submitClusterRun).not.toHaveBeenCalled();
    expect(toastMocks.error).toHaveBeenCalledWith("Cannot start experiment", {
      description: "The experiment could not be prepared. Check the selected data and pipelines.",
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
    expect(toastMocks.error).toHaveBeenCalledWith("Check sample grouping before launching this experiment.");
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
      missing_target_policy: "predict",
      engine: "dag-ml",
      allow_fallback: false,
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
      description: "1 run entry must be prepared before the experiment can start.",
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
        missing_target_policy: "predict",
        engine: "dag-ml",
        allow_fallback: false,
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

    expect(toastMocks.warning).toHaveBeenCalledWith("Required analysis tools could not be checked.");
    expect(apiMocks.createRun).toHaveBeenCalledWith(expect.objectContaining({
      dataset_ids: ["d1"],
      pipeline_ids: ["p1"],
    }));

    await mounted.unmount();
  });

  describe("pipelines with PyTorch models", () => {
    const deepPipelineConfigs: SelectedPipelineConfig[] = [
      selectedPipelineConfigs[0],
      {
        id: "p2",
        name: "Deep pipeline",
        steps: [
          { id: "pre", type: "preprocessing", name: "SNV", params: {} },
          {
            id: "branch",
            type: "flow",
            name: "Branch",
            params: {},
            branches: [[{ id: "nicon", type: "model", name: "NICoN", classPath: "nirs4all.operators.models.pytorch.nicon.nicon", params: {} }]],
          },
        ],
      },
    ];
    const request = vi.fn<(need: unknown, proceed: () => void) => void>();

    const renderLaunchFlow = (canInstall: boolean, overrides: Partial<UseNewExperimentLaunchFlowInput> = {}) => renderHook(
      () => useNewExperimentLaunchFlow(launchFlowInput({ selectedPipelineConfigs: deepPipelineConfigs, ...overrides })),
      undefined,
      (children) => (
        <PyTorchInstallPromptContext.Provider value={{ canInstall, request }}>{children}</PyTorchInstallPromptContext.Provider>
      ),
    );

    afterEach(() => {
      request.mockReset();
    });

    it("asks for PyTorch once before checking and submitting, then launches after the installation", async () => {
      apiMocks.runPreflight.mockResolvedValue({ ready: true, issues: [] } satisfies PreflightResult);
      apiMocks.createRun.mockResolvedValue(run());
      const mounted = await renderLaunchFlow(true);

      await act(async () => {
        await mounted.result.current!.handleLaunch();
      });
      await flushMutation();

      expect(request).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledWith({ kind: "experiment" }, expect.any(Function));
      expect(apiMocks.runPreflight).not.toHaveBeenCalled();
      expect(apiMocks.createRun).not.toHaveBeenCalled();

      // The installation succeeded.
      await act(async () => {
        request.mock.calls[0][1]();
      });
      await flushMutation();

      expect(apiMocks.createRun).toHaveBeenCalledWith(expect.objectContaining({ pipeline_ids: ["p1", "p2"] }));

      await mounted.unmount();
    });

    it("reports a grouping problem before asking for PyTorch", async () => {
      const onGroupingBlockingError = vi.fn();
      const mounted = await renderLaunchFlow(true, { hasGroupingBlockingError: true, onGroupingBlockingError });

      await act(async () => {
        await mounted.result.current!.handleLaunch();
      });

      expect(onGroupingBlockingError).toHaveBeenCalledTimes(1);
      expect(request).not.toHaveBeenCalled();

      await mounted.unmount();
    });

    it.each<[string, boolean, Partial<UseNewExperimentLaunchFlowInput>]>([
      ["Studio cannot install PyTorch", false, {}],
      ["no selected pipeline has a PyTorch model", true, { selectedPipelineConfigs }],
      ["the PyTorch model is disabled", true, {
        selectedPipelineConfigs: [{
          id: "p3",
          name: "Disabled deep model",
          steps: [{ id: "nicon", type: "model", name: "NICoN", classPath: "nirs4all.operators.models.pytorch.nicon.nicon", enabled: false }],
        }],
      }],
    ])("launches without asking when %s", async (_label, canInstall, overrides) => {
      apiMocks.runPreflight.mockResolvedValue({ ready: true, issues: [] } satisfies PreflightResult);
      apiMocks.createRun.mockResolvedValue(run());
      const mounted = await renderLaunchFlow(canInstall, overrides);

      await act(async () => {
        await mounted.result.current!.handleLaunch();
      });
      await flushMutation();

      expect(request).not.toHaveBeenCalled();
      expect(apiMocks.createRun).toHaveBeenCalledTimes(1);

      await mounted.unmount();
    });

    it("launches without asking when the experiment runs on a compute server", async () => {
      const submitClusterRun: SubmitClusterRun = vi.fn(async () => run({ id: "cluster-run-1" }));
      const mounted = await renderLaunchFlow(true, {
        executionAdapter: {
          id: "cluster",
          label: "Compute server",
          nativeBackends: ["cluster"],
          buildLaunchSubmission: (config, nativePayload) => ({
            kind: "cluster-run" as const,
            requestedBackend: "cluster" as const,
            config,
            nativePayload,
          }),
        },
        launchSubmitters: { submitClusterRun },
        singlePairSplitSpecResult,
      });

      await act(async () => {
        await mounted.result.current!.handleLaunch();
      });
      await flushMutation();

      expect(request).not.toHaveBeenCalled();
      expect(submitClusterRun).toHaveBeenCalledTimes(1);

      await mounted.unmount();
    });
  });
});

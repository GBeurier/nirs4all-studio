/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildCampaignPlanPreview,
  buildLegacyCampaignSpec,
  type CampaignSinglePairSplitSpecResult,
} from "@/lib/campaignPlan";
import { toExperimentDatasetOption } from "@/lib/experimentDatasetOptions";
import {
  buildNewExperimentExecutionEnvironment,
  DEFAULT_NEW_EXPERIMENT_EXECUTION_ENVIRONMENT,
} from "@/lib/experimentExecutionEnvironment";
import { buildNativeExperimentLaunchPayload } from "@/lib/experimentExecutionAdapter";
import {
  buildExperimentLaunchPayloadDiagnostics,
  type ExperimentLaunchPayloadPlan,
} from "@/lib/experimentLaunchPayload";

import { NewExperimentLaunchStep } from "./NewExperimentLaunchStep";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let mountedContainers: HTMLDivElement[] = [];

async function render(element: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  mountedContainers.push(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(element);
  });

  return { container, root };
}

afterEach(() => {
  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers = [];
});

const dataset = toExperimentDatasetOption({
  id: "d1",
  name: "Corn",
  path: "/data/corn.csv",
  linked_at: "2026-01-01T00:00:00",
  num_samples: 42,
  num_features: 128,
  default_target: "protein",
  metadata_columns: [],
  config: {
    delimiter: ",",
    decimal_separator: ".",
    has_header: true,
  },
});

function launchPayloadPlan(overrides: Partial<ExperimentLaunchPayloadPlan> = {}): ExperimentLaunchPayloadPlan {
  const legacyConfig = overrides.legacyConfig ?? {
    name: "Corn x PLS",
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

function getButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector("button");
  if (!button) {
    throw new Error("Expected launch button to render");
  }
  return button;
}

function strictCampaignSpecsForClusterCampaign(): CampaignSinglePairSplitSpecResult {
  return {
    splitSpecs: [
      {
        id: "single-pair:d1::p1",
        sourceRunId: "d1::p1",
        sourceDatasetId: "d1",
        sourcePipelineId: "p1",
        campaign: {
          name: "Cluster x PLS / Corn -> PLS",
          mode: "paired_by_index",
          executionBackend: "cluster",
          datasets: [{ id: "d1", name: "Corn", splitGroupBy: null }],
          pipelines: [{ id: "p1", name: "PLS", source: "saved", stepCount: 1, stepSummary: "PLS" }],
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
}

describe("NewExperimentLaunchStep", () => {
  it("renders launch metadata from the campaign preview", async () => {
    const campaign = buildLegacyCampaignSpec({
      name: "Corn x PLS",
      selectedDatasetIds: ["d1"],
      selectedPipelines: [{ id: "p1", name: "PLS", source: "saved" }],
      selectedGroupingPayload: {},
    });
    const onLaunch = vi.fn();

    const { container, root } = await render(
      <NewExperimentLaunchStep
        campaignPreview={buildCampaignPlanPreview(campaign)}
        datasetById={new Map([[dataset.id, dataset]])}
        executionEnvironmentDiagnostics={DEFAULT_NEW_EXPERIMENT_EXECUTION_ENVIRONMENT.diagnostics}
        experimentDescription="Baseline"
        experimentName="Corn x PLS"
        isLaunching={false}
        isPreflighting={false}
        launchPayloadPlan={launchPayloadPlan()}
        selectedDatasetIds={["d1"]}
        onLaunch={onLaunch}
      />,
    );

    expect(container.textContent).toContain("Corn x PLS");
    expect(container.textContent).toContain("Baseline");
    expect(container.textContent).toContain("1 run across 1 dataset and 1 pipeline");
    expect(container.textContent).toContain("Local Python");
    expect(container.textContent).toContain("Legacy local run API");
    expect(container.textContent).toContain("1 run in explicit run matrix");
    expect(container.textContent).toContain("Corn");
    expect(container.textContent).toContain("Launch Experiment");
    expect(container.textContent).not.toContain("Native adapter:");
    expect(container.textContent).not.toContain("Execution environment");
    expect(container.textContent).not.toContain("cluster, wasm-local");
    expect(container.textContent).not.toContain("Submission: Legacy config");
    expect(container.textContent).not.toContain("Legacy config submission");
    expect(container.textContent).not.toContain("studio.native-launch-payload.v1");
    expect(getButton(container).disabled).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });

  it("renders native backend availability messages from the campaign preview", async () => {
    const submitClusterRun = async () => ({ id: "cluster-run-1" }) as never;
    const executionEnvironment = buildNewExperimentExecutionEnvironment({ submitClusterRun });
    const campaign = buildLegacyCampaignSpec({
      name: "Cluster x PLS",
      selectedDatasetIds: ["d1"],
      selectedPipelines: [{ id: "p1", name: "PLS", source: "saved", stepCount: 1, stepSummary: "PLS" }],
      selectedGroupingPayload: {},
      executionBackend: "cluster",
    });

    const { container, root } = await render(
      <NewExperimentLaunchStep
        campaignPreview={buildCampaignPlanPreview(campaign, {
          availableExecutionAdapters: executionEnvironment.availableExecutionAdapters,
          nativeBackendAvailability: executionEnvironment.nativeBackendAvailability,
        })}
        datasetById={new Map([[dataset.id, dataset]])}
        executionEnvironmentDiagnostics={executionEnvironment.diagnostics}
        experimentDescription=""
        experimentName="Cluster x PLS"
        isLaunching={false}
        isPreflighting={false}
        launchPayloadPlan={launchPayloadPlan({
          currentSubmissionKind: "native_payload",
          strictCampaignPayloadStatus: "ready",
          strictCampaignPayloadSummary: "1 strict campaign spec ready for Cluster execution adapter.",
          strictCampaignPayloadActivation: {
            status: "ready",
            canUseStrictPayload: true,
            message: "Strict campaign payload is ready for native submitters.",
          },
          legacyConfig: {
            name: "Cluster x PLS",
            dataset_ids: ["d1"],
            pipeline_ids: ["p1"],
          },
          strictCampaignSpecs: strictCampaignSpecsForClusterCampaign(),
        })}
        selectedDatasetIds={["d1"]}
        onLaunch={vi.fn()}
      />,
    );

    expect(container.textContent).toContain("Cluster");
    expect(container.textContent).toContain("Cluster execution adapter");
    expect(container.textContent).toContain("Submit to Cluster");
    expect(container.textContent).not.toContain("Native adapter:");
    expect(container.textContent).not.toContain("Configured native");
    expect(container.textContent).not.toContain("Submitters");
    expect(container.textContent).not.toContain("Submission target");
    expect(getButton(container).disabled).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });

  it("disables native launch when the strict payload is not ready", async () => {
    const submitClusterRun = async () => ({ id: "cluster-run-1" }) as never;
    const executionEnvironment = buildNewExperimentExecutionEnvironment({ submitClusterRun });
    const campaign = buildLegacyCampaignSpec({
      name: "Cluster x PLS",
      selectedDatasetIds: ["d1"],
      selectedPipelines: [{ id: "p1", name: "PLS", source: "saved", stepCount: 1, stepSummary: "PLS" }],
      selectedGroupingPayload: {},
      executionBackend: "cluster",
    });

    const { container, root } = await render(
      <NewExperimentLaunchStep
        campaignPreview={buildCampaignPlanPreview(campaign, {
          availableExecutionAdapters: executionEnvironment.availableExecutionAdapters,
          nativeBackendAvailability: executionEnvironment.nativeBackendAvailability,
        })}
        datasetById={new Map([[dataset.id, dataset]])}
        executionEnvironmentDiagnostics={DEFAULT_NEW_EXPERIMENT_EXECUTION_ENVIRONMENT.diagnostics}
        experimentDescription=""
        experimentName="Cluster x PLS"
        isLaunching={false}
        isPreflighting={false}
        launchPayloadPlan={launchPayloadPlan({
          currentSubmissionKind: "native_payload",
          strictCampaignPayloadStatus: "unavailable",
          strictCampaignPayloadSummary: "No strict campaign specs are available for Cluster execution adapter.",
          strictCampaignPayloadActivation: {
            status: "blocked",
            canUseStrictPayload: false,
            message: "Strict campaign payload is unavailable for this launch.",
          },
          legacyConfig: {
            name: "Cluster x PLS",
            dataset_ids: ["d1"],
            pipeline_ids: ["p1"],
          },
        })}
        selectedDatasetIds={["d1"]}
        onLaunch={vi.fn()}
      />,
    );

    expect(container.textContent).toContain("Native payload not ready");
    expect(container.textContent).toContain("Strict campaign payload is unavailable for this launch.");
    expect(container.textContent).toContain("Resolve Payload Issues");
    expect(container.textContent).not.toContain("Payload readiness");
    expect(container.textContent).not.toContain("Blocked for native submission");
    expect(getButton(container).disabled).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });

  it("disables nonlocal backend launch when no native adapter is available", async () => {
    const campaign = buildLegacyCampaignSpec({
      name: "Cluster x PLS",
      selectedDatasetIds: ["d1"],
      selectedPipelines: [{ id: "p1", name: "PLS", source: "saved", stepCount: 1, stepSummary: "PLS" }],
      selectedGroupingPayload: {},
      executionBackend: "cluster",
    });

    const { container, root } = await render(
      <NewExperimentLaunchStep
        campaignPreview={buildCampaignPlanPreview(campaign, {
          nativeBackendAvailability: DEFAULT_NEW_EXPERIMENT_EXECUTION_ENVIRONMENT.nativeBackendAvailability,
        })}
        datasetById={new Map([[dataset.id, dataset]])}
        executionEnvironmentDiagnostics={DEFAULT_NEW_EXPERIMENT_EXECUTION_ENVIRONMENT.diagnostics}
        experimentDescription=""
        experimentName="Cluster x PLS"
        isLaunching={false}
        isPreflighting={false}
        launchPayloadPlan={launchPayloadPlan({
          legacyConfig: {
            name: "Cluster x PLS",
            dataset_ids: ["d1"],
            pipeline_ids: ["p1"],
          },
        })}
        selectedDatasetIds={["d1"]}
        onLaunch={vi.fn()}
      />,
    );

    expect(container.textContent).toContain("Cluster");
    expect(container.textContent).toContain("Resolve Plan Issues");
    expect(container.textContent).not.toContain("Cluster execution is typed but no native submitter is configured.");
    expect(container.textContent).not.toContain("Legacy fallback");
    expect(getButton(container).disabled).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });

  it("disables launch when the campaign preview is blocking", async () => {
    const campaign = buildLegacyCampaignSpec({
      name: "Incomplete",
      selectedDatasetIds: [],
      selectedPipelines: [],
      selectedGroupingPayload: {},
    });

    const { container, root } = await render(
      <NewExperimentLaunchStep
        campaignPreview={buildCampaignPlanPreview(campaign)}
        datasetById={new Map([[dataset.id, dataset]])}
        executionEnvironmentDiagnostics={DEFAULT_NEW_EXPERIMENT_EXECUTION_ENVIRONMENT.diagnostics}
        experimentDescription=""
        experimentName="Incomplete"
        isLaunching={false}
        isPreflighting={false}
        launchPayloadPlan={launchPayloadPlan({
          legacyConfig: {
            name: "Incomplete",
            dataset_ids: [],
            pipeline_ids: [],
          },
        })}
        selectedDatasetIds={[]}
        onLaunch={vi.fn()}
      />,
    );

    expect(container.textContent).toContain("No dataset selected");
    expect(container.textContent).toContain("No pipeline selected");
    expect(container.textContent).toContain("Resolve Plan Issues");
    expect(getButton(container).disabled).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });
});

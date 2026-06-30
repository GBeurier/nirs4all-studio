/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildCampaignPlanPreview,
  buildLegacyCampaignSpec,
} from "@/lib/campaignPlan";
import { toExperimentDatasetOption } from "@/lib/experimentDatasetOptions";
import {
  buildNewExperimentExecutionEnvironment,
  DEFAULT_NEW_EXPERIMENT_EXECUTION_ENVIRONMENT,
} from "@/lib/experimentExecutionEnvironment";
import { buildPipelineGraphSpecFromLegacySteps } from "@/lib/pipelineGraphSpec";

import { NewExperimentCampaignPlanPreview } from "./NewExperimentCampaignPlanPreview";

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

async function expandCampaignPlanPreview(container: HTMLElement): Promise<void> {
  const trigger = Array.from(container.querySelectorAll("button"))
    .find((button) => /expand campaign plan preview/i.test(button.getAttribute("aria-label") ?? ""));
  expect(trigger, "expected campaign plan preview trigger").toBeTruthy();
  await act(async () => {
    trigger!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
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
  metadata_columns: ["batch"],
  config: {
    delimiter: ",",
    decimal_separator: ".",
    has_header: true,
  },
});

describe("NewExperimentCampaignPlanPreview", () => {
  it("renders campaign inputs, run previews, and notices", async () => {
    const campaign = buildLegacyCampaignSpec({
      name: "Corn x PLS",
      selectedDatasetIds: ["d1", "d2"],
      datasetLabelsById: { d1: "Corn", d2: "Wheat" },
      datasetSchemasById: {
        d1: {
          sampleCount: 42,
          featureCount: 128,
          targetLabel: "protein",
          metadataColumnCount: 1,
          repetitionColumn: null,
        },
        d2: {
          sampleCount: 24,
          featureCount: 64,
          targetLabel: "moisture",
          metadataColumnCount: 0,
          repetitionColumn: "scan_id",
        },
      },
      selectedPipelines: [
        { id: "p1", name: "PLS", source: "saved", stepCount: 2, stepSummary: "SNV \u2192 PLS" },
        { id: "p2", name: "Draft", source: "inline", stepCount: 0, stepSummary: "Empty pipeline" },
      ],
      selectedGroupingPayload: { d1: "batch" },
    });

    const { container, root } = await render(
      <NewExperimentCampaignPlanPreview campaignPreview={buildCampaignPlanPreview(campaign, { runPreviewLimit: 2 })} />,
    );

    expect(container.textContent).toContain("Campaign Plan Preview");
    expect(container.textContent).not.toContain("Legacy cartesian");
    await expandCampaignPlanPreview(container);
    expect(container.textContent).toContain("Legacy cartesian");
    expect(container.textContent).toContain("Local Python");
    expect(container.textContent).toContain("2 datasets x 2 pipelines");
    expect(container.textContent).toContain("4 runs");
    expect(container.textContent).toContain("4 runs planned from 4 possible pairs");
    expect(container.textContent).toContain("Cartesian matrix binding");
    expect(container.textContent).toContain("Implicit all-pairs");
    expect(container.textContent).toContain("Every selected pipeline is paired with every selected dataset.");
    expect(container.textContent).toContain("Readiness Checks");
    expect(container.textContent).toContain("Campaign schema binding");
    expect(container.textContent).toContain("Convert the cartesian matrix to explicit dataset/pipeline pair previews before strict schema-bound execution.");
    expect(container.textContent).toContain("Single-pair campaign shape");
    expect(container.textContent).toContain("split campaign work into one dataset/pipeline pair per campaign");
    expect(container.textContent).toContain("Dataset/pipeline schema compatibility");
    expect(container.textContent).toContain("Execution backend capabilities");
    expect(container.textContent).toContain("Single-Pair Split Preview");
    expect(container.textContent).toContain("Split recommended");
    expect(container.textContent).toContain("4 planned runs can become 4 one-pair campaigns for strict execution.");
    expect(container.textContent).toContain("Campaign 1");
    expect(container.textContent).toContain("Corn x PLS / Corn -> PLS");
    expect(container.textContent).toContain("source run: d1::p1");
    expect(container.textContent).toContain("Dataset Inputs");
    expect(container.textContent).toContain("Corn");
    expect(container.textContent).toContain("42 samples");
    expect(container.textContent).toContain("target: protein");
    expect(container.textContent).toContain("No aggregation configured");
    expect(container.textContent).toContain("Wheat");
    expect(container.textContent).toContain("repetition: scan_id");
    expect(container.textContent).toContain("Pipeline Inputs");
    expect(container.textContent).toContain("Saved pipeline");
    expect(container.textContent).toContain("Current editor");
    expect(container.textContent).toContain("SNV \u2192 PLS");
    expect(container.textContent).toContain("Planned Runs");
    expect(container.textContent).toContain("Run 1");
    expect(container.textContent).toContain("Corn -> PLS");
    expect(container.textContent).toContain("+ 2 more planned runs");
    expect(container.textContent).toContain("Cartesian campaign");

    await act(async () => {
      root.unmount();
    });
  });

  it("renders native backend availability messages in readiness checks", async () => {
    const campaign = buildLegacyCampaignSpec({
      name: "Cluster Preview",
      selectedDatasetIds: ["d1"],
      datasetLabelsById: { d1: "Corn" },
      selectedPipelines: [{ id: "p1", name: "PLS", source: "saved", stepCount: 1, stepSummary: "PLS" }],
      selectedGroupingPayload: {},
      executionBackend: "cluster",
    });

    const { container, root } = await render(
      <NewExperimentCampaignPlanPreview
        campaignPreview={buildCampaignPlanPreview(campaign, {
          nativeBackendAvailability: DEFAULT_NEW_EXPERIMENT_EXECUTION_ENVIRONMENT.nativeBackendAvailability,
        })}
      />,
    );

    await expandCampaignPlanPreview(container);
    expect(container.textContent).toContain("Legacy fallback");
    expect(container.textContent).toContain("Cluster execution is typed but no native submitter is configured.");

    await act(async () => {
      root.unmount();
    });
  });

  it("renders execution environment diagnostics when provided", async () => {
    const campaign = buildLegacyCampaignSpec({
      name: "Cluster Preview",
      selectedDatasetIds: ["d1"],
      datasetLabelsById: { d1: "Corn" },
      selectedPipelines: [{ id: "p1", name: "PLS", source: "saved", stepCount: 1, stepSummary: "PLS" }],
      selectedGroupingPayload: {},
      executionBackend: "cluster",
    });
    const submitClusterRun = async () => ({ id: "cluster-run-1" }) as never;
    const environment = buildNewExperimentExecutionEnvironment({ submitClusterRun });

    const { container, root } = await render(
      <NewExperimentCampaignPlanPreview
        campaignPreview={buildCampaignPlanPreview(campaign, {
          availableExecutionAdapters: environment.availableExecutionAdapters,
          nativeBackendAvailability: environment.nativeBackendAvailability,
        })}
        executionEnvironmentDiagnostics={environment.diagnostics}
      />,
    );

    await expandCampaignPlanPreview(container);
    expect(container.textContent).toContain("Execution Environment");
    expect(container.textContent).toContain("Adapters");
    expect(container.textContent).toContain("legacy-local, cluster");
    expect(container.textContent).toContain("Configured native");
    expect(container.textContent).toContain("cluster");
    expect(container.textContent).toContain("Unconfigured native");
    expect(container.textContent).toContain("wasm-local");
    expect(container.textContent).toContain("Submitters");

    await act(async () => {
      root.unmount();
    });
  });

  it("renders hidden input counts when dataset and pipeline previews are limited", async () => {
    const campaign = buildLegacyCampaignSpec({
      name: "Corn x PLS",
      selectedDatasetIds: ["d1", "d2"],
      datasetLabelsById: { d1: "Corn", d2: "Wheat" },
      selectedPipelines: [
        { id: "p1", name: "PLS", source: "saved", stepCount: 2, stepSummary: "SNV \u2192 PLS" },
        { id: "p2", name: "Draft", source: "inline", stepCount: 0, stepSummary: "Empty pipeline" },
      ],
      selectedGroupingPayload: {},
    });

    const { container, root } = await render(
      <NewExperimentCampaignPlanPreview
        campaignPreview={buildCampaignPlanPreview(campaign, {
          datasetPreviewLimit: 1,
          pipelinePreviewLimit: 1,
          runPreviewLimit: 0,
          singlePairSplitPreviewLimit: 0,
        })}
      />,
    );

    await expandCampaignPlanPreview(container);
    expect(container.textContent).toContain("Dataset Inputs");
    expect(container.textContent).toContain("Corn");
    expect(container.textContent).not.toContain("Wheat");
    expect(container.textContent).toContain("+ 1 more dataset inputs");
    expect(container.textContent).toContain("Pipeline Inputs");
    expect(container.textContent).toContain("PLS");
    expect(container.textContent).not.toContain("Draft");
    expect(container.textContent).toContain("+ 1 more pipeline inputs");
    expect(container.textContent).toContain("+ 4 more planned runs");

    await act(async () => {
      root.unmount();
    });
  });

  it("renders fully collapsed campaign sections when only hidden counts remain", async () => {
    const campaign = buildLegacyCampaignSpec({
      name: "Corn x PLS",
      selectedDatasetIds: ["d1"],
      datasetSchemaRefsById: { d1: dataset.schemaRef },
      selectedPipelines: [
        {
          id: "p1",
          name: "PLS",
          source: "saved",
          graph: buildPipelineGraphSpecFromLegacySteps(
            [
              { id: "pre", name: "SNV", type: "preprocessing", params: {} },
              { id: "model", name: "PLS", type: "model", params: {} },
            ],
            { id: "p1", name: "PLS" },
          ),
        },
      ],
      selectedGroupingPayload: {},
    });

    const { container, root } = await render(
      <NewExperimentCampaignPlanPreview
        campaignPreview={buildCampaignPlanPreview(campaign, {
          datasetPreviewLimit: 0,
          pipelinePreviewLimit: 0,
          compatibilityPreviewLimit: 0,
          runPreviewLimit: 0,
        })}
      />,
    );

    await expandCampaignPlanPreview(container);
    expect(container.textContent).toContain("Dataset Inputs");
    expect(container.textContent).toContain("+ 1 more dataset inputs");
    expect(container.textContent).toContain("Pipeline Inputs");
    expect(container.textContent).toContain("+ 1 more pipeline inputs");
    expect(container.textContent).toContain("Compatibility Preview");
    expect(container.textContent).toContain("+ 1 more compatibility previews");
    expect(container.textContent).toContain("Planned Runs");
    expect(container.textContent).toContain("+ 1 more planned runs");
    expect(container.textContent).not.toContain("Corn -> PLS");

    await act(async () => {
      root.unmount();
    });
  });

  it("renders compatibility previews from schema and graph refs", async () => {
    const campaign = buildLegacyCampaignSpec({
      name: "Corn x PLS",
      selectedDatasetIds: ["d1"],
      datasetSchemaRefsById: { d1: dataset.schemaRef },
      selectedPipelines: [
        {
          id: "p1",
          name: "PLS",
          source: "saved",
          graph: buildPipelineGraphSpecFromLegacySteps(
            [
              { id: "pre", name: "SNV", type: "preprocessing", params: {} },
              { id: "model", name: "PLS", type: "model", params: {} },
            ],
            { id: "p1", name: "PLS" },
          ),
        },
      ],
      selectedGroupingPayload: { d1: null },
    });

    const { container, root } = await render(
      <NewExperimentCampaignPlanPreview campaignPreview={buildCampaignPlanPreview(campaign)} />,
    );

    await expandCampaignPlanPreview(container);
    expect(container.textContent).toContain("Compatibility Preview");
    expect(container.textContent).toContain("Corn -> PLS");
    expect(container.textContent).toContain("Ready");
    expect(container.textContent).toContain("Schema preview ready for this dataset/pipeline pair.");
    expect(container.textContent).toContain("view: Default spectral view");
    expect(container.textContent).toContain("target: protein");
    expect(container.textContent).toContain("No aggregation configured");
    expect(container.textContent).toContain("2 active nodes");
    expect(container.textContent).toContain("size: 42 samples x 128 features x 2 active nodes (~10,752 cells)");
    expect(container.textContent).toContain("No refit, finetune, sweeps, or generators");
    expect(container.textContent).toContain("Dataset schema ref");
    expect(container.textContent).toContain("Pipeline graph spec");
    expect(container.textContent).toContain("Default data view");
    expect(container.textContent).toContain("Dataset aggregation");
    expect(container.textContent).toContain("No dataset aggregation is configured for this pair.");
    expect(container.textContent).toContain("Pipeline active nodes");

    await act(async () => {
      root.unmount();
    });
  });
});

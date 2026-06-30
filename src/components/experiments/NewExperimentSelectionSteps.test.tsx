/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  toExperimentDatasetOption,
} from "@/lib/experimentDatasetOptions";
import type { ExperimentPipelineOption } from "@/lib/experimentPipelineSelection";

import { NewExperimentDatasetSelectionStep } from "./NewExperimentDatasetSelectionStep";
import { NewExperimentPipelineSelectionStep } from "./NewExperimentPipelineSelectionStep";

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

function changeInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(input, "value")?.set;
  const prototype = Object.getPrototypeOf(input) as HTMLInputElement;
  const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

  if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
    prototypeValueSetter.call(input, value);
  } else {
    valueSetter?.call(input, value);
  }

  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function renderWithRouter(element: ReactNode) {
  return render(
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      {element}
    </MemoryRouter>,
  );
}

afterEach(() => {
  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers = [];
});

const pipeline: ExperimentPipelineOption = {
  id: "p1",
  name: "PLS",
  preset: true,
  favorite: true,
  steps: "SNV \u2192 PLS",
  nodeCount: 2,
  activeNodeCount: 2,
  disabledNodeCount: 0,
  branchCount: 1,
  generatorCount: 1,
  stepGeneratorCount: 1,
  parameterSweepCount: 1,
  finetuneNodeCount: 1,
  refitNodeCount: 1,
  maxDepth: 1,
};

const dataset = toExperimentDatasetOption({
  id: "d1",
  name: "Corn",
  path: "/data/corn.csv",
  linked_at: "2026-01-01T00:00:00",
  num_samples: 42,
  train_samples: 30,
  test_samples: 12,
  num_features: 128,
  default_target: "protein",
  metadata_columns: ["batch", "operator"],
  config: {
    delimiter: ",",
    decimal_separator: ".",
    has_header: true,
    repetition: "sample_id",
    aggregation: {
      enabled: true,
      column: "sample_id",
      method: "median",
    },
  },
});

describe("NewExperiment selection steps", () => {
  it("renders pipeline options and forwards row toggles", async () => {
    const onTogglePipeline = vi.fn();
    const { container, root } = await render(
      <NewExperimentPipelineSelectionStep
        availablePipelineCount={1}
        filteredPipelines={[pipeline]}
        isLoading={false}
        pipelineError={null}
        pipelineFilter="all"
        pipelineSearch=""
        selectedPipelineIds={["p1"]}
        onPipelineFilterChange={vi.fn()}
        onPipelineSearchChange={vi.fn()}
        onTogglePipeline={onTogglePipeline}
      />,
    );

    expect(container.textContent).toContain("Select Pipelines");
    expect(container.textContent).toContain("1 selected");
    expect(container.textContent).toContain("PLS");
    expect(container.textContent).toContain("Preset");
    expect(container.textContent).toContain("SNV \u2192 PLS");
    expect(container.textContent).toContain("Graph ready");
    expect(container.textContent).toContain("2 nodes");
    expect(container.textContent).toContain("1 branch");
    expect(container.textContent).toContain("1 generator");
    expect(container.textContent).toContain("1 step generator");
    expect(container.textContent).toContain("1 parameter sweep");
    expect(container.textContent).toContain("1 finetune node");
    expect(container.textContent).toContain("1 refit node");
    expect(container.textContent).toContain("Depth 2");

    await act(async () => {
      container.querySelector<HTMLElement>('[data-experiment-pipeline-id="p1"]')?.click();
    });
    expect(onTogglePipeline).toHaveBeenCalledWith("p1");

    await act(async () => {
      root.unmount();
    });
  });

  it("forwards pipeline search changes", async () => {
    const onPipelineSearchChange = vi.fn();
    const { container, root } = await render(
      <NewExperimentPipelineSelectionStep
        availablePipelineCount={1}
        filteredPipelines={[pipeline]}
        isLoading={false}
        pipelineError={null}
        pipelineFilter="all"
        pipelineSearch=""
        selectedPipelineIds={[]}
        onPipelineFilterChange={vi.fn()}
        onPipelineSearchChange={onPipelineSearchChange}
        onTogglePipeline={vi.fn()}
      />,
    );

    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="Search pipelines..."]',
    );
    expect(input).not.toBeNull();

    await act(async () => {
      changeInputValue(input!, "pls");
    });

    expect(onPipelineSearchChange).toHaveBeenLastCalledWith("pls");

    await act(async () => {
      root.unmount();
    });
  });

  it("renders pipeline empty-search state separately from empty catalog state", async () => {
    const { container, root } = await render(
      <NewExperimentPipelineSelectionStep
        availablePipelineCount={1}
        filteredPipelines={[]}
        isLoading={false}
        pipelineError={null}
        pipelineFilter="all"
        pipelineSearch="missing"
        selectedPipelineIds={[]}
        onPipelineFilterChange={vi.fn()}
        onPipelineSearchChange={vi.fn()}
        onTogglePipeline={vi.fn()}
      />,
    );

    expect(container.textContent).toContain('No pipelines match "missing"');
    expect(container.textContent).not.toContain("No pipelines available");

    await act(async () => {
      root.unmount();
    });
  });

  it("renders pipeline empty catalog state separately from empty-search state", async () => {
    const { container, root } = await renderWithRouter(
      <NewExperimentPipelineSelectionStep
        availablePipelineCount={0}
        filteredPipelines={[]}
        isLoading={false}
        pipelineError={null}
        pipelineFilter="all"
        pipelineSearch=""
        selectedPipelineIds={[]}
        onPipelineFilterChange={vi.fn()}
        onPipelineSearchChange={vi.fn()}
        onTogglePipeline={vi.fn()}
      />,
    );

    expect(container.textContent).toContain("No pipelines available");
    expect(container.textContent).toContain("Create Pipeline");
    expect(container.textContent).not.toContain("No pipelines match");

    await act(async () => {
      root.unmount();
    });
  });

  it("renders pipeline loading and error feedback without mounting result rows", async () => {
    const { container, root } = await render(
      <NewExperimentPipelineSelectionStep
        availablePipelineCount={1}
        filteredPipelines={[pipeline]}
        isLoading={true}
        pipelineError={new Error("Pipeline catalog failed")}
        pipelineFilter="all"
        pipelineSearch=""
        selectedPipelineIds={[]}
        onPipelineFilterChange={vi.fn()}
        onPipelineSearchChange={vi.fn()}
        onTogglePipeline={vi.fn()}
      />,
    );

    expect(container.textContent).toContain("Loading pipelines...");
    expect(container.textContent).toContain("Pipeline catalog failed");
    expect(container.textContent).not.toContain("PLS");

    await act(async () => {
      root.unmount();
    });
  });

  it("renders dataset options and forwards row toggles", async () => {
    const onToggleDataset = vi.fn();
    const { container, root } = await render(
      <NewExperimentDatasetSelectionStep
        availableDatasetCount={1}
        datasetError={null}
        datasetSearch=""
        filteredDatasets={[dataset]}
        isLoading={false}
        selectedDatasetIds={["d1"]}
        onDatasetSearchChange={vi.fn()}
        onToggleDataset={onToggleDataset}
      />,
    );

    expect(container.textContent).toContain("Select Datasets");
    expect(container.textContent).toContain("1 selected");
    expect(container.textContent).toContain("Corn");
    expect(container.textContent).toContain("42 samples");
    expect(container.textContent).toContain("30 train");
    expect(container.textContent).toContain("12 test");
    expect(container.textContent).toContain("128 features");
    expect(container.textContent).toContain("1 source");
    expect(container.textContent).toContain("single-source");
    expect(container.textContent).toContain("4 representations");
    expect(container.textContent).toContain("View: Default spectral view");
    expect(container.textContent).toContain("Task: unknown task");
    expect(container.textContent).toContain("Target: protein");
    expect(container.textContent).toContain("1 target");
    expect(container.textContent).toContain("Metadata: 2 columns");
    expect(container.textContent).toContain("Repetition: sample_id");
    expect(container.textContent).toContain("Aggregation: median by sample_id");

    await act(async () => {
      container.querySelector<HTMLElement>('[data-experiment-dataset-id="d1"]')?.click();
    });
    expect(onToggleDataset).toHaveBeenCalledWith("d1");

    await act(async () => {
      root.unmount();
    });
  });

  it("renders dataset empty-search state separately from empty catalog state", async () => {
    const { container, root } = await render(
      <NewExperimentDatasetSelectionStep
        availableDatasetCount={1}
        datasetError={null}
        datasetSearch="missing"
        filteredDatasets={[]}
        isLoading={false}
        selectedDatasetIds={[]}
        onDatasetSearchChange={vi.fn()}
        onToggleDataset={vi.fn()}
      />,
    );

    expect(container.textContent).toContain('No datasets match "missing"');
    expect(container.textContent).not.toContain("No datasets available");

    await act(async () => {
      root.unmount();
    });
  });

  it("renders dataset empty catalog state separately from empty-search state", async () => {
    const { container, root } = await renderWithRouter(
      <NewExperimentDatasetSelectionStep
        availableDatasetCount={0}
        datasetError={null}
        datasetSearch=""
        filteredDatasets={[]}
        isLoading={false}
        selectedDatasetIds={[]}
        onDatasetSearchChange={vi.fn()}
        onToggleDataset={vi.fn()}
      />,
    );

    expect(container.textContent).toContain("No datasets available");
    expect(container.textContent).toContain("Go to Settings");
    expect(container.textContent).not.toContain("No datasets match");

    await act(async () => {
      root.unmount();
    });
  });

  it("renders dataset loading and fallback error feedback without empty catalog state", async () => {
    const { container, root } = await render(
      <NewExperimentDatasetSelectionStep
        availableDatasetCount={0}
        datasetError="offline"
        datasetSearch=""
        filteredDatasets={[]}
        isLoading={true}
        selectedDatasetIds={[]}
        onDatasetSearchChange={vi.fn()}
        onToggleDataset={vi.fn()}
      />,
    );

    expect(container.textContent).toContain("Loading datasets...");
    expect(container.textContent).toContain("Failed to load datasets");
    expect(container.textContent).not.toContain("No datasets available");

    await act(async () => {
      root.unmount();
    });
  });

  it("forwards dataset search changes", async () => {
    const onDatasetSearchChange = vi.fn();
    const { container, root } = await render(
      <NewExperimentDatasetSelectionStep
        availableDatasetCount={1}
        datasetError={null}
        datasetSearch=""
        filteredDatasets={[dataset]}
        isLoading={false}
        selectedDatasetIds={[]}
        onDatasetSearchChange={onDatasetSearchChange}
        onToggleDataset={vi.fn()}
      />,
    );

    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="Search datasets..."]',
    );
    expect(input).not.toBeNull();

    await act(async () => {
      changeInputValue(input!, "corn");
    });

    expect(onDatasetSearchChange).toHaveBeenLastCalledWith("corn");

    await act(async () => {
      root.unmount();
    });
  });
});

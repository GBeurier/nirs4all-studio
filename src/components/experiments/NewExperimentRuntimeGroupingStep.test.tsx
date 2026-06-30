/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { toExperimentDatasetOption } from "@/lib/experimentDatasetOptions";
import type {
  DatasetRuntimeGroupingState,
  SelectedPipelinesRuntimeGrouping,
} from "@/lib/runtimeSplitGrouping";

import { NewExperimentRuntimeGroupingStep } from "./NewExperimentRuntimeGroupingStep";

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
  metadata_columns: ["batch", "operator"],
  config: {
    delimiter: ",",
    decimal_separator: ".",
    has_header: true,
    repetition: "sample_id",
  },
});

const groupingState: DatasetRuntimeGroupingState = {
  repetitionColumn: "sample_id",
  metadataColumns: ["batch", "operator"],
  selectedGroupBy: "batch",
  requiresExplicitGroup: true,
  hasBlockingError: false,
  blockingMessage: null,
  repetitionOnlyWarning: null,
  optionalPropagationWarning: "The explicit group_by selected here will also be applied.",
};

function selection(overrides: Partial<SelectedPipelinesRuntimeGrouping> = {}): SelectedPipelinesRuntimeGrouping {
  return {
    hasSplitters: true,
    hasRequiredSplitters: true,
    hasOptionalSplitters: false,
    hasPersistedGroupConflict: false,
    conflictingPipelines: [],
    ...overrides,
  };
}

describe("NewExperimentRuntimeGroupingStep", () => {
  it("renders the no-splitter state", async () => {
    const { container, root } = await render(
      <NewExperimentRuntimeGroupingStep
        datasetById={new Map([[dataset.id, dataset]])}
        datasetGroupingStates={{ [dataset.id]: groupingState }}
        groupingSelection={selection({ hasSplitters: false, hasRequiredSplitters: false })}
        selectedDatasetIds={[dataset.id]}
        splitGroupByByDataset={{ [dataset.id]: null }}
        onDatasetGroupChange={vi.fn()}
      />,
    );

    expect(container.textContent).toContain("Runtime Grouping");
    expect(container.textContent).toContain("1 dataset");
    expect(container.textContent).toContain("No splitter was found in the selected pipelines.");

    await act(async () => {
      root.unmount();
    });
  });

  it("renders persisted grouping conflicts", async () => {
    const { container, root } = await render(
      <NewExperimentRuntimeGroupingStep
        datasetById={new Map([[dataset.id, dataset]])}
        datasetGroupingStates={{ [dataset.id]: groupingState }}
        groupingSelection={selection({
          hasPersistedGroupConflict: true,
          conflictingPipelines: [{ id: "p1", name: "Saved PLS", steps: ["GroupKFold"] }],
        })}
        selectedDatasetIds={[dataset.id]}
        splitGroupByByDataset={{ [dataset.id]: "batch" }}
        onDatasetGroupChange={vi.fn()}
      />,
    );

    expect(container.textContent).toContain("A selected pipeline already persists splitter grouping.");
    expect(container.textContent).toContain("Saved PLS: GroupKFold");

    await act(async () => {
      root.unmount();
    });
  });

  it("renders dataset grouping controls and warnings", async () => {
    const { container, root } = await render(
      <NewExperimentRuntimeGroupingStep
        datasetById={new Map([[dataset.id, dataset]])}
        datasetGroupingStates={{ [dataset.id]: groupingState }}
        groupingSelection={selection()}
        selectedDatasetIds={[dataset.id]}
        splitGroupByByDataset={{ [dataset.id]: "batch" }}
        onDatasetGroupChange={vi.fn()}
      />,
    );

    expect(container.textContent).toContain("Corn");
    expect(container.textContent).toContain("2 metadata columns");
    expect(container.textContent).toContain("Required");
    expect(container.textContent).toContain("Dataset repetition");
    expect(container.textContent).toContain("sample_id");
    expect(container.textContent).toContain("The explicit group_by selected here will also be applied.");

    await act(async () => {
      root.unmount();
    });
  });
});

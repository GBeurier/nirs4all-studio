/**
 * @vitest-environment jsdom
 */

import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PredictionFilters } from "./PredictionFilters";
import type { DataVisibility, FoldVisibility } from "@/lib/predictions/rows";

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
  vi.clearAllMocks();
});

function renderFilters(
  overrides: Partial<ComponentProps<typeof PredictionFilters>> = {},
) {
  const defaults: ComponentProps<typeof PredictionFilters> = {
    searchQuery: "",
    onSearchQueryChange: vi.fn(),
    filterDataset: "all",
    onFilterDatasetChange: vi.fn(),
    filterModel: "all",
    onFilterModelChange: vi.fn(),
    filterTaskType: "all",
    onFilterTaskTypeChange: vi.fn(),
    datasetOptions: ["Dataset A"],
    modelOptions: ["PLS"],
    taskTypeOptions: ["regression"],
    visibleFoldTypes: ["folds", "refits", "averages"] satisfies FoldVisibility[],
    onVisibleFoldTypesChange: vi.fn(),
    visibleDataKinds: ["raw", "aggregated"] satisfies DataVisibility[],
    onVisibleDataKindsChange: vi.fn(),
    hasActiveFilters: true,
    onClearFilters: vi.fn(),
  };

  return render(<PredictionFilters {...defaults} {...overrides} />);
}

function buttonByText(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.trim() === label);

  expect(button).toBeDefined();
  return button as HTMLButtonElement;
}

describe("PredictionFilters", () => {
  it("renders visibility groups and clear action", async () => {
    const onClearFilters = vi.fn();
    const { container, root } = await renderFilters({ onClearFilters });

    expect(container.textContent).toContain("Type");
    expect(container.textContent).toContain("Folds");
    expect(container.textContent).toContain("Refits");
    expect(container.textContent).toContain("Averages");
    expect(container.textContent).toContain("Data");
    expect(container.textContent).toContain("Raw");
    expect(container.textContent).toContain("Aggregated");
    expect(container.textContent).toContain("Clear");

    await act(async () => {
      buttonByText(container, "Clear").click();
    });

    expect(onClearFilters).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("dispatches search input changes", async () => {
    const onSearchQueryChange = vi.fn();
    const { container, root } = await renderFilters({ onSearchQueryChange });
    const input = container.querySelector<HTMLInputElement>("input[placeholder='Search models, datasets...']");

    expect(input).toBeDefined();

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(input, "pls");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(onSearchQueryChange).toHaveBeenCalledWith("pls");

    await act(async () => {
      root.unmount();
    });
  });

  it("hides clear when no filters are active", async () => {
    const { container, root } = await renderFilters({ hasActiveFilters: false });

    expect(container.textContent).not.toContain("Clear");

    await act(async () => {
      root.unmount();
    });
  });
});

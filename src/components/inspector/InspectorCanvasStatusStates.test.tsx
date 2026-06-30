/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  InspectorCanvasErrorState,
  InspectorCanvasFilteredEmptyState,
  InspectorCanvasLoadingState,
  InspectorCanvasNoPredictionsState,
} from "./InspectorCanvasStatusStates";

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

function buttonByLabel(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button"))
    .find(candidate => candidate.textContent?.trim() === label);

  expect(button).toBeDefined();
  return button as HTMLButtonElement;
}

describe("InspectorCanvasStatusStates", () => {
  it("renders the loading message used by the canvas frame", async () => {
    const { container, root } = await render(<InspectorCanvasLoadingState />);

    expect(container.textContent).toContain("Loading predictions inspector...");

    await act(async () => {
      root.unmount();
    });
  });

  it("renders inspector errors with a retry action", async () => {
    const onRefresh = vi.fn();
    const { container, root } = await render(
      <InspectorCanvasErrorState
        error="Prediction index unavailable"
        onRefresh={onRefresh}
      />,
    );

    expect(container.textContent).toContain("Inspector unavailable");
    expect(container.textContent).toContain("Prediction index unavailable");

    await act(async () => {
      buttonByLabel(container, "Reload inspector").click();
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("renders the no-predictions empty state with refresh", async () => {
    const onRefresh = vi.fn();
    const { container, root } = await render(
      <InspectorCanvasNoPredictionsState onRefresh={onRefresh} />,
    );

    expect(container.textContent).toContain("No predictions to inspect");
    expect(container.textContent).toContain("Run or import predictions first");

    await act(async () => {
      buttonByLabel(container, "Refresh").click();
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("prefers clear-filter action when local filters hide every chain", async () => {
    const onClearFilters = vi.fn();
    const onRefresh = vi.fn();
    const { container, root } = await render(
      <InspectorCanvasFilteredEmptyState
        hasActiveFilters
        onClearFilters={onClearFilters}
        onRefresh={onRefresh}
      />,
    );

    expect(container.textContent).toContain("No chains match the current scope");
    expect(container.textContent).toContain("Clear local inspector filters");

    await act(async () => {
      buttonByLabel(container, "Clear local filters").click();
      buttonByLabel(container, "Refresh").click();
    });

    expect(onClearFilters).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });
});

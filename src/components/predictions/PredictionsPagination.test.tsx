/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PredictionsPagination } from "./PredictionsPagination";

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
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

  expect(button).toBeDefined();
  return button as HTMLButtonElement;
}

describe("PredictionsPagination", () => {
  it("renders the result range and page state", async () => {
    const { container, root } = await render(
      <PredictionsPagination
        startIndex={10}
        endIndex={20}
        totalCount={42}
        currentPage={2}
        totalPages={5}
        pageSize={25}
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
      />,
    );

    expect(container.textContent).toContain("Showing 11-20 of 42");
    expect(container.textContent).toContain("Page 2 of 5");

    await act(async () => {
      root.unmount();
    });
  });

  it("dispatches explicit page changes from icon controls", async () => {
    const onPageChange = vi.fn();
    const { container, root } = await render(
      <PredictionsPagination
        startIndex={10}
        endIndex={20}
        totalCount={42}
        currentPage={2}
        totalPages={5}
        pageSize={25}
        onPageChange={onPageChange}
        onPageSizeChange={vi.fn()}
      />,
    );

    await act(async () => {
      buttonByLabel(container, "First page").click();
      buttonByLabel(container, "Previous page").click();
      buttonByLabel(container, "Next page").click();
      buttonByLabel(container, "Last page").click();
    });

    expect(onPageChange).toHaveBeenNthCalledWith(1, 1);
    expect(onPageChange).toHaveBeenNthCalledWith(2, 1);
    expect(onPageChange).toHaveBeenNthCalledWith(3, 3);
    expect(onPageChange).toHaveBeenNthCalledWith(4, 5);

    await act(async () => {
      root.unmount();
    });
  });

  it("disables boundary navigation", async () => {
    const { container, root } = await render(
      <PredictionsPagination
        startIndex={0}
        endIndex={10}
        totalCount={10}
        currentPage={1}
        totalPages={1}
        pageSize={10}
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
      />,
    );

    expect(buttonByLabel(container, "First page").disabled).toBe(true);
    expect(buttonByLabel(container, "Previous page").disabled).toBe(true);
    expect(buttonByLabel(container, "Next page").disabled).toBe(true);
    expect(buttonByLabel(container, "Last page").disabled).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });
});

/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { NewExperimentStepProgress } from "./NewExperimentStepProgress";

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

describe("NewExperimentStepProgress", () => {
  it("renders the experiment wizard steps in order", async () => {
    const { container, root } = await render(<NewExperimentStepProgress currentStep={3} />);

    expect(container.textContent).toContain("Select Pipelines");
    expect(container.textContent).toContain("Select Datasets");
    expect(container.textContent).toContain("Runtime Grouping");
    expect(container.textContent).toContain("Review");
    expect(container.textContent).toContain("Launch");
    expect(container.querySelector("[aria-current='step']")?.textContent).toContain("Runtime Grouping");

    await act(async () => {
      root.unmount();
    });
  });
});

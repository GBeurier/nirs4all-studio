/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NewExperimentWizardActions } from "./NewExperimentWizardActions";

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

function buttons(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll("button"));
}

describe("NewExperimentWizardActions", () => {
  it("disables back on the first step and next when progress is blocked", async () => {
    const { container, root } = await render(
      <NewExperimentWizardActions
        canProceed={false}
        currentStep={1}
        maxStep={5}
        onBack={vi.fn()}
        onNext={vi.fn()}
      />,
    );
    const [backButton, nextButton] = buttons(container);

    expect(backButton.disabled).toBe(true);
    expect(nextButton.disabled).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });

  it("calls navigation callbacks when actions are available", async () => {
    const onBack = vi.fn();
    const onNext = vi.fn();
    const { container, root } = await render(
      <NewExperimentWizardActions
        canProceed
        currentStep={3}
        maxStep={5}
        onBack={onBack}
        onNext={onNext}
      />,
    );
    const [backButton, nextButton] = buttons(container);

    await act(async () => {
      backButton.click();
      nextButton.click();
    });

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });
});

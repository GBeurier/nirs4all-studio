/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { FinetuneConfig } from "../../types";
import { FinetuneSearchConfig } from "../FinetuneSearchConfig";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let mountedContainers: HTMLDivElement[] = [];

async function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  mountedContainers.push(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(node);
  });

  return { container, root };
}

afterEach(() => {
  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers = [];
});

function config(overrides: Partial<FinetuneConfig> = {}): FinetuneConfig {
  return {
    approach: "grouped",
    enabled: true,
    eval_mode: "best",
    model_params: [],
    n_trials: 50,
    ...overrides,
  };
}

function changeInput(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;
  valueSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("FinetuneSearchConfig", () => {
  it("updates optimizer persistence fields from advanced settings", async () => {
    const onUpdate = vi.fn();
    const { container } = await render(
      <TooltipProvider>
        <FinetuneSearchConfig config={config()} onUpdate={onUpdate} />
      </TooltipProvider>
    );

    const advancedButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Advanced Settings")
    );
    expect(advancedButton).toBeDefined();

    await act(async () => {
      advancedButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const storageInput = container.querySelector<HTMLInputElement>("#finetune-storage");
    const studyNameInput = container.querySelector<HTMLInputElement>("#finetune-study-name");
    expect(storageInput).not.toBeNull();
    expect(studyNameInput).not.toBeNull();

    await act(async () => {
      changeInput(storageInput!, "sqlite:///optuna-study.db");
    });
    await act(async () => {
      changeInput(studyNameInput!, "ridge-study");
    });

    expect(onUpdate).toHaveBeenCalledWith({ storage: "sqlite:///optuna-study.db" });
    expect(onUpdate).toHaveBeenCalledWith({ study_name: "ridge-study" });
  });
});

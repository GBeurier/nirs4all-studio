/**
 * @vitest-environment jsdom
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParameterDefinition } from "@/data/nodes";
import type { PipelineStep } from "../types";
import { StepConfigPanel } from "../StepConfigPanel";
import type { StepMetadataRegistry } from "../shared/stepMetadata";

const mocks = vi.hoisted(() => ({
  useNodeRegistryOptional: vi.fn(),
}));

vi.mock("../contexts/NodeRegistryContext", () => ({
  useNodeRegistryOptional: mocks.useNodeRegistryOptional,
}));

vi.mock("../config/step-renderers", () => ({
  useStepRenderer: () => ({
    Renderer: ({ step, currentOption, handleResetParams }: Record<string, any>) => (
      <div>
        <div data-testid="description">{currentOption?.description ?? "missing"}</div>
        <div data-testid="params">
          {Object.entries(step.params)
            .map(([key, value]) => `${key}:${String(value)}`)
            .join("|")}
        </div>
        <button data-testid="reset" type="button" onClick={handleResetParams}>
          reset
        </button>
      </div>
    ),
    usesParameterProps: true,
    isLazy: false,
  }),
}));

vi.mock("../shared/useParamInput", () => ({
  useParamInput: () => ({
    renderParamInput: () => null,
  }),
}));

vi.mock("../FinetuneConfig", () => ({
  FinetuningBadge: () => null,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface RegistryNodeFixture {
  id: string;
  name: string;
  description: string;
  isDeepLearning?: boolean;
  parameters?: ParameterDefinition[];
}

function createRegistryContext(
  nodes: RegistryNodeFixture[],
  defaultsByName: Record<string, Record<string, unknown>>,
): StepMetadataRegistry {
  return {
    isJsonRegistry: true,
    getNodesByType: (type) => nodes.filter((node) => type === "model") as never,
    getNodeDefinition: (type, name) =>
      nodes.find((node) => type === "model" && node.name === name) as never,
    getDefaultParams: (_type, name) => defaultsByName[name] ?? {},
    getSweepableParams: () => [],
  };
}

async function renderPanel(
  step: PipelineStep,
  registry: StepMetadataRegistry,
  onUpdate: ReturnType<typeof vi.fn>,
) {
  mocks.useNodeRegistryOptional.mockReturnValue(registry);

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <StepConfigPanel
        step={step}
        onUpdate={onUpdate}
        onRemove={() => undefined}
        onDuplicate={() => undefined}
      />,
    );
  });

  return {
    container,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("StepConfigPanel metadata rendering", () => {
  it("renders and resets registry-only model metadata through the shared seam", async () => {
    const registry = createRegistryContext(
      [
        {
          id: "model.registry-only",
          name: "RegistryOnlyModel",
          description: "Registry-only model",
          isDeepLearning: true,
        },
      ],
      {
        RegistryOnlyModel: { depth: 3, activation: "relu" },
      },
    );
    const onUpdate = vi.fn();
    const view = await renderPanel(
      {
        id: "step-registry",
        type: "model",
        name: "RegistryOnlyModel",
        params: { depth: 7 },
        paramSweeps: {
          activation: {
            type: "or",
            choices: ["relu", "tanh"],
          },
        },
      },
      registry,
      onUpdate,
    );

    expect(view.container.textContent).toContain("Registry-only model");
    expect(view.container.textContent).toContain("depth:7");
    expect(view.container.textContent).toContain("activation:relu");

    await act(async () => {
      view.container.querySelector<HTMLButtonElement>("[data-testid='reset']")?.click();
    });

    expect(onUpdate).toHaveBeenCalledWith("step-registry", {
      params: { depth: 3, activation: "relu" },
      paramSweeps: undefined,
    });

    await view.unmount();
  });

  it("falls back to legacy step metadata when the registry does not cover the model", async () => {
    const registry = createRegistryContext([], {});
    const onUpdate = vi.fn();
    const view = await renderPanel(
      {
        id: "step-legacy",
        type: "model",
        name: "PLSRegression",
        params: { n_components: 4 },
        paramSweeps: {
          max_iter: {
            type: "or",
            choices: [500, 700],
          },
        },
      },
      registry,
      onUpdate,
    );

    expect(view.container.textContent).toContain("Partial Least Squares Regression");
    expect(view.container.textContent).toContain("n_components:4");
    expect(view.container.textContent).toContain("max_iter:500");

    await act(async () => {
      view.container.querySelector<HTMLButtonElement>("[data-testid='reset']")?.click();
    });

    expect(onUpdate).toHaveBeenCalledWith("step-legacy", {
      params: { n_components: 10, max_iter: 500 },
      paramSweeps: undefined,
    });

    await view.unmount();
  });
});
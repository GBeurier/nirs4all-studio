/**
 * @vitest-environment jsdom
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PipelineInfo } from "@/api/pipelines";
import {
  clientStorageKeys,
  readClientStorageString,
  removeClientStorageItem,
} from "@/lib/clientStorage";
import {
  CURRENT_EDITED_PIPELINE_ID,
  type ExperimentPipelineOption,
} from "@/lib/experimentPipelineSelection";
import { storeCurrentEditedPipelineHandoffInClientStorage } from "@/lib/pipelineExperimentHandoff";

const toastMocks = vi.hoisted(() => ({
  info: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: toastMocks,
}));

import { useNewExperimentSelectionFlow, type UseNewExperimentSelectionFlowInput } from "./useNewExperimentSelectionFlow";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

async function renderHook<T>(hook: () => T) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const result: { current: T | undefined } = { current: undefined };

  function TestComponent() {
    result.current = hook();
    return null;
  }

  await act(async () => {
    root.render(<TestComponent />);
  });

  return {
    result,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function pipelineOption(
  overrides: Partial<ExperimentPipelineOption> & Pick<ExperimentPipelineOption, "id" | "name">,
): ExperimentPipelineOption {
  return {
    preset: false,
    favorite: false,
    steps: "",
    nodeCount: 0,
    activeNodeCount: 0,
    disabledNodeCount: 0,
    branchCount: 0,
    generatorCount: 0,
    stepGeneratorCount: 0,
    parameterSweepCount: 0,
    finetuneNodeCount: 0,
    refitNodeCount: 0,
    maxDepth: 0,
    ...overrides,
  };
}

const savedPipelineOptions: ExperimentPipelineOption[] = [
  pipelineOption({
    id: "p1",
    name: "PLS Pipeline",
    steps: "SNV \u2192 PLS",
    nodeCount: 2,
    activeNodeCount: 2,
  }),
];

const rawPipelines: PipelineInfo[] = [
  {
    id: "p1",
    name: "PLS Pipeline",
    category: "custom",
    steps: [{ id: "model", name: "PLS", type: "model", params: {} }],
    created_at: "2026-01-01T00:00:00",
    updated_at: "2026-01-01T00:00:00",
  },
];

function selectionFlowInput(
  overrides: Partial<UseNewExperimentSelectionFlowInput> = {},
): UseNewExperimentSelectionFlowInput {
  return {
    savedPipelineOptions,
    rawPipelines,
    searchParams: new URLSearchParams(),
    onEditorRedirect: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  removeClientStorageItem(clientStorageKeys.currentEditedPipeline);
  Object.values(toastMocks).forEach((mock) => mock.mockReset());
});

describe("useNewExperimentSelectionFlow", () => {
  it("toggles dataset selection and keeps grouping payload state aligned", async () => {
    const mounted = await renderHook(() => useNewExperimentSelectionFlow(selectionFlowInput()));

    await act(async () => {
      mounted.result.current!.toggleDataset("d1");
    });
    expect(mounted.result.current!.selectedDatasetIds).toEqual(["d1"]);
    expect(mounted.result.current!.splitGroupByByDataset).toEqual({ d1: null });

    await act(async () => {
      mounted.result.current!.setSplitGroupByByDataset({ d1: "batch" });
      mounted.result.current!.toggleDataset("d1");
    });
    expect(mounted.result.current!.selectedDatasetIds).toEqual([]);
    expect(mounted.result.current!.splitGroupByByDataset).toEqual({});

    await mounted.unmount();
  });

  it("toggles selected pipeline ids", async () => {
    const mounted = await renderHook(() => useNewExperimentSelectionFlow(selectionFlowInput()));

    await act(async () => {
      mounted.result.current!.togglePipeline("p1");
    });
    expect(mounted.result.current!.selectedPipelineIds).toEqual(["p1"]);

    await act(async () => {
      mounted.result.current!.togglePipeline("p1");
    });
    expect(mounted.result.current!.selectedPipelineIds).toEqual([]);

    await mounted.unmount();
  });

  it("consumes current editor handoff and prepends the current pipeline option", async () => {
    const onEditorRedirect = vi.fn();
    storeCurrentEditedPipelineHandoffInClientStorage({
      name: "Draft",
      steps: [{ id: "draft" }],
      isDirty: true,
      timestamp: 1,
    });

    const mounted = await renderHook(() => useNewExperimentSelectionFlow(selectionFlowInput({
      searchParams: new URLSearchParams("source=editor"),
      onEditorRedirect,
    })));

    expect(mounted.result.current!.selectedPipelineIds).toEqual([CURRENT_EDITED_PIPELINE_ID]);
    expect(mounted.result.current!.allPipelineOptions[0]).toMatchObject({
      id: CURRENT_EDITED_PIPELINE_ID,
      name: "[Current] Draft (unsaved)",
    });
    expect(readClientStorageString(clientStorageKeys.currentEditedPipeline)).toBeNull();
    expect(toastMocks.info).toHaveBeenCalledWith('Pipeline "Draft" ready for experiment');
    expect(onEditorRedirect).toHaveBeenCalledTimes(1);

    await mounted.unmount();
  });

  it("selects a saved pipeline from the URL once raw pipelines are available", async () => {
    const onEditorRedirect = vi.fn();
    const mounted = await renderHook(() => useNewExperimentSelectionFlow(selectionFlowInput({
      searchParams: new URLSearchParams("pipeline=p1"),
      onEditorRedirect,
    })));

    expect(mounted.result.current!.selectedPipelineIds).toEqual(["p1"]);
    expect(toastMocks.info).toHaveBeenCalledWith('Pipeline "PLS Pipeline" selected');
    expect(onEditorRedirect).toHaveBeenCalledTimes(1);

    await mounted.unmount();
  });
});

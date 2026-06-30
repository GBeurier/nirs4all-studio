/**
 * @vitest-environment jsdom
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { NavigateFunction } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PipelineStep } from "@/components/pipeline-editor/types";
import {
  clientStorageKeys,
  readClientStorageString,
  removeClientStorageItem,
} from "@/lib/clientStorage";
import type { PipelineConfig } from "@/hooks/usePipelineEditor";
import { usePipelineEditorRouteActions } from "./usePipelineEditorRouteActions";

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: toastMocks,
}));

vi.mock("@/api/pipelines", () => ({
  renderCanonicalPipeline: vi.fn(),
  savePipeline: vi.fn(),
}));

vi.mock("@/hooks/usePipelineEditor", () => ({
  clearPersistedState: vi.fn(),
  migrateDraftKey: vi.fn(),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

type RouteActionsOptions = Parameters<typeof usePipelineEditorRouteActions>[0];

const pipelineSteps: PipelineStep[] = [
  {
    id: "model",
    type: "model",
    name: "PLS",
    params: {},
  },
];

async function renderHook<T>(hook: () => T) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const queryClient = new QueryClient();
  const result: { current: T | undefined } = { current: undefined };

  function TestComponent() {
    result.current = hook();
    return null;
  }

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <TestComponent />
      </QueryClientProvider>,
    );
  });

  return {
    result,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      queryClient.clear();
      container.remove();
    },
  };
}

function routeActionsInput(
  overrides: Partial<RouteActionsOptions> = {},
): RouteActionsOptions {
  return {
    pipelineId: "pipe-1",
    isNew: false,
    isDirty: true,
    pipelineName: "Draft",
    isFavorite: false,
    steps: pipelineSteps,
    navigate: vi.fn() as unknown as NavigateFunction,
    setIsFavorite: vi.fn(),
    clearPipeline: vi.fn(),
    exportPipeline: () => ({
      name: "Draft",
      steps: pipelineSteps,
      config: {} as PipelineConfig,
    }),
    importIntoEditor: vi.fn(async () => ({ name: "Imported" })),
    closeClearDialog: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  removeClientStorageItem(clientStorageKeys.currentEditedPipeline);
  Object.values(toastMocks).forEach((mock) => mock.mockReset());
  vi.clearAllMocks();
});

describe("usePipelineEditorRouteActions", () => {
  it("stores dirty pipeline handoffs through clientStorage before routing to NewExperiment", async () => {
    const navigate = vi.fn();
    const mounted = await renderHook(() => usePipelineEditorRouteActions(routeActionsInput({
      navigate: navigate as unknown as NavigateFunction,
    })));

    await act(async () => {
      mounted.result.current!.handleUseInExperiment();
    });

    const rawHandoff = readClientStorageString(clientStorageKeys.currentEditedPipeline);
    expect(rawHandoff).not.toBeNull();
    expect(JSON.parse(rawHandoff ?? "")).toMatchObject({
      id: "pipe-1",
      name: "Draft",
      steps: pipelineSteps,
      editorGraphDocument: {
        id: "pipe-1",
        name: "Draft",
        rootNodeIds: ["model"],
        nodes: [
          expect.objectContaining({
            id: "model",
            legacyStepId: "model",
            label: "PLS",
          }),
        ],
      },
      isDirty: true,
      timestamp: expect.any(Number),
    });
    expect(navigate).toHaveBeenCalledWith("/editor?source=editor");

    await mounted.unmount();
  });

  it("routes clean saved pipelines without writing a current editor handoff", async () => {
    const navigate = vi.fn();
    const mounted = await renderHook(() => usePipelineEditorRouteActions(routeActionsInput({
      pipelineId: "pipe 1",
      isDirty: false,
      navigate: navigate as unknown as NavigateFunction,
    })));

    await act(async () => {
      mounted.result.current!.handleUseInExperiment();
    });

    expect(readClientStorageString(clientStorageKeys.currentEditedPipeline)).toBeNull();
    expect(navigate).toHaveBeenCalledWith("/editor?pipeline=pipe%201");

    await mounted.unmount();
  });
});

/**
 * @vitest-environment jsdom
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PredictionDeletionReport } from "@/types/storage";

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

const linkedWorkspaceMocks = vi.hoisted(() => ({
  deleteWorkspaceChainPredictions: vi.fn(),
  deleteWorkspacePredictionGroup: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: toastMocks,
}));

vi.mock("@/api/linkedWorkspaces", () => linkedWorkspaceMocks);

import { useModelPredictionDeleteAction } from "./useModelPredictionDeleteAction";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function deletionReport(overrides: Partial<PredictionDeletionReport> = {}): PredictionDeletionReport {
  return {
    success: true,
    scope: "chain",
    deleted_predictions: 1,
    deleted_arrays: 1,
    deleted_chains: 1,
    deleted_pipelines: 0,
    deleted_artifacts: 0,
    updated_chains: 0,
    ...overrides,
  };
}

async function renderHook(input: Parameters<typeof useModelPredictionDeleteAction>[0]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const queryClient = new QueryClient();
  const result: { current: ReturnType<typeof useModelPredictionDeleteAction> | undefined } = { current: undefined };

  function TestComponent() {
    result.current = useModelPredictionDeleteAction(input);
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
      container.remove();
      queryClient.clear();
    },
  };
}

describe("useModelPredictionDeleteAction", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("deletes a whole chain through the workspace chain endpoint", async () => {
    linkedWorkspaceMocks.deleteWorkspaceChainPredictions.mockResolvedValue(deletionReport());
    const mounted = await renderHook({
      chainId: "chain-1",
      deleteScope: "chain",
      workspaceId: "workspace-1",
    });

    await act(async () => {
      await mounted.result.current!.handleDelete();
    });

    expect(linkedWorkspaceMocks.deleteWorkspaceChainPredictions).toHaveBeenCalledWith("workspace-1", "chain-1");
    expect(linkedWorkspaceMocks.deleteWorkspacePredictionGroup).not.toHaveBeenCalled();

    await mounted.unmount();
  });

  it("deletes a prediction group through the workspace group endpoint", async () => {
    linkedWorkspaceMocks.deleteWorkspacePredictionGroup.mockResolvedValue(deletionReport({ scope: "prediction_group" }));
    const mounted = await renderHook({
      chainId: "chain-1",
      deleteScope: "group",
      foldId: "fold-0",
      workspaceId: "workspace-1",
    });

    await act(async () => {
      await mounted.result.current!.handleDelete();
    });

    expect(linkedWorkspaceMocks.deleteWorkspacePredictionGroup).toHaveBeenCalledWith("workspace-1", "chain-1", "fold-0");
    expect(linkedWorkspaceMocks.deleteWorkspaceChainPredictions).not.toHaveBeenCalled();

    await mounted.unmount();
  });

  it("stops before deletion when workspace context is missing", async () => {
    const mounted = await renderHook({
      chainId: "chain-1",
      deleteScope: "chain",
    });

    await act(async () => {
      await mounted.result.current!.handleDelete();
    });

    expect(linkedWorkspaceMocks.deleteWorkspaceChainPredictions).not.toHaveBeenCalled();
    expect(linkedWorkspaceMocks.deleteWorkspacePredictionGroup).not.toHaveBeenCalled();
    expect(toastMocks.error).toHaveBeenCalledWith("Missing workspace or chain identifier");

    await mounted.unmount();
  });
});

/**
 * @vitest-environment jsdom
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChainPartitionDetailResponse, PartitionPrediction } from "@/types/aggregated-predictions";

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

const chainDetailMock = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({
  toast: toastMocks,
}));

vi.mock("@/api/aggregatedPredictions", () => ({
  getChainPartitionDetail: chainDetailMock,
}));

import { useModelActionCsvExport } from "./useModelActionCsvExport";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function prediction(overrides: Partial<PartitionPrediction> = {}): PartitionPrediction {
  return {
    prediction_id: "pred-1",
    pipeline_id: "pipe-1",
    chain_id: "chain-1",
    dataset_name: "dataset-a",
    model_name: "PLS",
    model_class: "PLSRegression",
    fold_id: "0",
    partition: "test",
    val_score: null,
    test_score: 0.25,
    train_score: null,
    scores: { rmse: 0.25 },
    best_params: null,
    metric: "rmse",
    task_type: "regression",
    n_samples: 10,
    n_features: 128,
    preprocessings: "SNV",
    ...overrides,
  };
}

function chainDetail(predictions: PartitionPrediction[]): ChainPartitionDetailResponse {
  return {
    chain_id: "chain-1",
    predictions,
    total: predictions.length,
    partition: null,
    fold_id: null,
  };
}

async function renderHook(input: { chainId: string; modelName: string }) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const result: { current: ReturnType<typeof useModelActionCsvExport> | undefined } = { current: undefined };

  function TestComponent() {
    result.current = useModelActionCsvExport(input);
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

describe("useModelActionCsvExport", () => {
  const createObjectURL = vi.fn(() => "blob:csv");
  const revokeObjectURL = vi.fn();
  const click = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("URL", {
      createObjectURL,
      revokeObjectURL,
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(click);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    chainDetailMock.mockReset();
    toastMocks.error.mockReset();
    toastMocks.success.mockReset();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    click.mockClear();
  });

  it("exports chain predictions to a downloaded CSV", async () => {
    chainDetailMock.mockResolvedValue(chainDetail([
      prediction({ model_name: "PLS tuned", dataset_name: "dataset, a" }),
    ]));
    const mounted = await renderHook({ chainId: "abcdef123456", modelName: "PLS tuned" });

    await act(async () => {
      await mounted.result.current!.handleCsvExport();
    });

    expect(chainDetailMock).toHaveBeenCalledWith("abcdef123456");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:csv");
    expect(toastMocks.success).toHaveBeenCalledWith("CSV exported");
    expect(mounted.result.current!.csvBusy).toBe(false);

    await mounted.unmount();
  });

  it("reports missing rows without downloading a file", async () => {
    chainDetailMock.mockResolvedValue(chainDetail([]));
    const mounted = await renderHook({ chainId: "chain-1", modelName: "PLS" });

    await act(async () => {
      await mounted.result.current!.handleCsvExport();
    });

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(toastMocks.error).toHaveBeenCalledWith("No predictions found for this chain");
    expect(mounted.result.current!.csvBusy).toBe(false);

    await mounted.unmount();
  });

  it("reports backend export failures", async () => {
    chainDetailMock.mockRejectedValue(new Error("offline"));
    const mounted = await renderHook({ chainId: "chain-1", modelName: "PLS" });

    await act(async () => {
      await mounted.result.current!.handleCsvExport();
    });

    expect(toastMocks.error).toHaveBeenCalledWith("offline");
    expect(mounted.result.current!.csvBusy).toBe(false);

    await mounted.unmount();
  });
});

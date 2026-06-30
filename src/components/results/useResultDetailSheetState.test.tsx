/**
 * @vitest-environment jsdom
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PipelineRun } from "@/types/runs";
import { useResultDetailSheetState } from "./useResultDetailSheetState";

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

function pipeline(overrides: Partial<PipelineRun> = {}): PipelineRun {
  return {
    id: "run-pipeline",
    pipeline_id: "pipe",
    pipeline_name: "PLS baseline",
    model: "PLS",
    preprocessing: "SNV",
    split_strategy: "KFold",
    status: "completed",
    progress: 100,
    metrics: { r2: 0.91 },
    val_score: 0.13,
    test_score: 0.12,
    has_refit: true,
    is_final_model: true,
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useResultDetailSheetState", () => {
  it("derives display data and manages JSON copy state", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const mounted = await renderHook(() => useResultDetailSheetState(pipeline()));

    expect(mounted.result.current!.activeTab).toBe("results");
    expect(mounted.result.current!.hasMetrics).toBe(true);
    expect(mounted.result.current!.logs).toContain("[INFO] Model training complete");
    expect(mounted.result.current!.logRows).toContainEqual({
      id: "7-[INFO] Model training complete",
      text: "[INFO] Model training complete",
      tone: "info",
    });
    expect(JSON.parse(mounted.result.current!.pipelineJson)).toMatchObject({
      name: "PLS baseline",
      status: "completed",
    });

    await act(async () => {
      mounted.result.current!.setActiveTab("json");
    });
    expect(mounted.result.current!.activeTab).toBe("json");

    await act(async () => {
      await mounted.result.current!.handleCopyJson();
    });
    expect(writeText).toHaveBeenCalledWith(mounted.result.current!.pipelineJson);
    expect(mounted.result.current!.copied).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(mounted.result.current!.copied).toBe(false);

    await mounted.unmount();
  });

  it("returns inert defaults when the sheet has no pipeline", async () => {
    const mounted = await renderHook(() => useResultDetailSheetState(null));

    expect(mounted.result.current!.hasMetrics).toBe(false);
    expect(mounted.result.current!.logs).toEqual([]);
    expect(mounted.result.current!.logRows).toEqual([]);
    expect(mounted.result.current!.pipelineJson).toBe("");

    await mounted.unmount();
  });
});

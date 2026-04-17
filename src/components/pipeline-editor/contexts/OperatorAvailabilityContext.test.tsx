/**
 * @vitest-environment jsdom
 */

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OPERATOR_AVAILABILITY_INVALIDATED_EVENT } from "@/lib/pipelineOperatorAvailability";
import type { OperatorAvailabilityResponse } from "@/api/client";
import { OperatorAvailabilityProvider, useOperatorAvailability } from "./OperatorAvailabilityContext";

const mocks = vi.hoisted(() => ({
  getOperatorAvailability: vi.fn(),
  runPreflight: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  getOperatorAvailability: mocks.getOperatorAvailability,
  runPreflight: mocks.runPreflight,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

interface RenderResult {
  result: {
    current?: ReturnType<typeof useOperatorAvailability>;
  };
  unmount: () => Promise<void>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitFor(assertion: () => void, timeoutMs: number = 1000): Promise<void> {
  const start = Date.now();
  while (true) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() - start >= timeoutMs) {
        throw error;
      }
      await act(async () => {
        await Promise.resolve();
      });
    }
  }
}

async function renderProvider(children?: ReactNode): Promise<RenderResult> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const result: RenderResult["result"] = {};

  function Probe() {
    result.current = useOperatorAvailability();
    return null;
  }

  await act(async () => {
    root.render(
      <OperatorAvailabilityProvider steps={[]} pipelineName="Test pipeline">
        {children}
        <Probe />
      </OperatorAvailabilityProvider>,
    );
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

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("OperatorAvailabilityProvider", () => {
  it("retries transient availability failures and clears the banner on success", async () => {
    vi.useFakeTimers();

    const response: OperatorAvailabilityResponse = {
      computed_at: "2026-04-17T00:00:00Z",
      checked_count: 1,
      unavailable: [],
    };

    mocks.runPreflight.mockResolvedValue({ issues: [] });
    mocks.getOperatorAvailability
      .mockRejectedValueOnce(new Error("Failed to load operator availability"))
      .mockResolvedValueOnce(response);

    const view = await renderProvider();

    await waitFor(() => {
      expect(view.result.current?.operatorsError).toBe("Failed to load operator availability");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    await waitFor(() => {
      expect(view.result.current?.operatorsError).toBeNull();
      expect(view.result.current?.operatorAvailability).toEqual(response);
    });

    expect(mocks.getOperatorAvailability).toHaveBeenCalledTimes(2);

    await view.unmount();
  });

  it("ignores stale failed refreshes after a newer refresh succeeds", async () => {
    const firstRequest = deferred<OperatorAvailabilityResponse>();
    const response: OperatorAvailabilityResponse = {
      computed_at: "2026-04-17T00:00:00Z",
      checked_count: 1,
      unavailable: [],
    };

    mocks.runPreflight.mockResolvedValue({ issues: [] });
    mocks.getOperatorAvailability
      .mockReturnValueOnce(firstRequest.promise)
      .mockResolvedValueOnce(response);

    const view = await renderProvider();

    await waitFor(() => {
      expect(mocks.getOperatorAvailability).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      window.dispatchEvent(new CustomEvent(OPERATOR_AVAILABILITY_INVALIDATED_EVENT));
    });

    await waitFor(() => {
      expect(mocks.getOperatorAvailability).toHaveBeenCalledTimes(2);
      expect(view.result.current?.operatorAvailability).toEqual(response);
    });

    await act(async () => {
      firstRequest.reject(new Error("stale failure"));
      await Promise.resolve();
    });

    expect(view.result.current?.operatorsError).toBeNull();
    expect(view.result.current?.operatorAvailability).toEqual(response);

    await view.unmount();
  });
});

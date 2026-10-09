/**
 * @vitest-environment jsdom
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock("@/api/transport", () => ({ api: { get: mocks.apiGet } }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

async function renderFlags() {
  vi.resetModules();
  const { useDeepLearningAvailable, useShapAvailable } = await import("./useBackendCapabilities");
  const seen: { deepLearning?: boolean; shap?: boolean } = {};
  function Probe() {
    seen.deepLearning = useDeepLearningAvailable();
    seen.shap = useShapAvailable();
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => { root.render(<Probe />); });
  return { seen, unmount: () => act(async () => root.unmount()) };
}

afterEach(() => {
  mocks.apiGet.mockReset();
});

describe("useBackendCapabilities", () => {
  it("reports optional heavy capabilities unavailable when the probe fails", async () => {
    mocks.apiGet.mockRejectedValue(new Error("timeout"));
    const view = await renderFlags();
    expect(view.seen).toEqual({ deepLearning: false, shap: false });
    await view.unmount();
  });

  it("does not cache a failed probe, so a later caller can recover", async () => {
    mocks.apiGet.mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValue({ capabilities: { torch: true, shap: true } });
    vi.resetModules();
    const module = await import("./useBackendCapabilities");
    const seen: boolean[] = [];
    function Probe() {
      seen.push(module.useDeepLearningAvailable());
      return null;
    }
    for (const _attempt of [0, 1]) {
      const root = createRoot(document.createElement("div"));
      await act(async () => { root.render(<Probe />); });
      await act(async () => root.unmount());
    }
    expect(mocks.apiGet).toHaveBeenCalledTimes(2);
    expect(seen.at(-1)).toBe(true);
  });

  it("reflects the reported capabilities when the probe succeeds", async () => {
    mocks.apiGet.mockResolvedValue({ capabilities: { torch: false, tensorflow: false, jax: false, shap: true } });
    const view = await renderFlags();
    expect(view.seen).toEqual({ deepLearning: false, shap: true });
    await view.unmount();
  });
});

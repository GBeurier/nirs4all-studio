/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useBackendDisplayUrl } from "./useBackendDisplayUrl";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("shows the Rust service address, refreshes its port and never substitutes the renderer URL", async () => {
  const info = vi.fn().mockResolvedValue({ status: "running", url: "http://127.0.0.1:43123" });
  Object.defineProperty(window, "electronApi", { configurable: true, value: { isElectron: true, getNativeSidecarInfo: info } });
  const container = document.createElement("div");
  const root = createRoot(container);
  function Probe() { return <span>{useBackendDisplayUrl("Unavailable")}</span>; }
  try {
    await act(async () => root.render(<Probe />));
    expect(container.textContent).toBe("http://127.0.0.1:43123");
    info.mockResolvedValue({ status: "running", url: "http://127.0.0.1:43124" });
    await act(async () => window.dispatchEvent(new CustomEvent("backend-restarted")));
    expect(container.textContent).toBe("http://127.0.0.1:43124");
    info.mockRejectedValue(new Error("Stopped"));
    await act(async () => window.dispatchEvent(new CustomEvent("backend-restarted")));
    expect(container.textContent).toBe("Unavailable");
  } finally {
    await act(async () => root.unmount());
    Reflect.deleteProperty(window, "electronApi");
  }
});

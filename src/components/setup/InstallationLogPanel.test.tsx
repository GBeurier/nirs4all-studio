// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { InstallationLogPanel } from "./InstallationLogPanel";
import { api } from "@/api/transport";

vi.mock("@/api/transport", () => ({ api: { get: vi.fn() } }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const history = { status: "error", package: "example", started_at: Date.now() - 5000, updated_at: Date.now(),
  lines: [{ id: 1, time: Date.now(), text: "pip dependency resolution failed" }] };
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); };

describe("installation details", () => {
  it("opens on failure, copies output, collapses, and restores history on remount", async () => {
    vi.mocked(api.get).mockResolvedValue(history);
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
    const element = document.createElement("div");
    const root = createRoot(element);
    const client = new QueryClient();
    try {
      await act(async () => root.render(<QueryClientProvider client={client}><InstallationLogPanel /></QueryClientProvider>));
      await flush();
      expect(element.textContent).toContain("Installation failed");
      expect(element.querySelector("details")?.open).toBe(true);
      const button = [...element.querySelectorAll("button")].find(value => value.textContent === "Copy logs");
      await act(async () => button?.click());
      expect(copy).toHaveBeenCalledWith(expect.stringContaining("pip dependency resolution failed"));
      expect(element.textContent).toContain("Copied");
      await act(async () => {
        const details = element.querySelector("details")!;
        details.open = false;
        details.dispatchEvent(new Event("toggle"));
      });
      expect(element.querySelector("details")?.open).toBe(false);
      await act(async () => root.render(null));
      await act(async () => root.render(<QueryClientProvider client={client}><InstallationLogPanel /></QueryClientProvider>));
      expect(element.textContent).toContain("pip dependency resolution failed");
    } finally { await act(async () => root.unmount()); client.clear(); }
  });

  it("keeps work indeterminate when the log transport fails", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("connection lost"));
    const element = document.createElement("div");
    const root = createRoot(element);
    const client = new QueryClient();
    try {
      await act(async () => root.render(<QueryClientProvider client={client}><InstallationLogPanel active /></QueryClientProvider>));
      await flush();
      expect(element.textContent).toContain("log connection unavailable");
      expect(element.textContent).toContain("Installation in progress");
      expect(element.textContent).not.toContain("Last package operation completed");
    } finally { await act(async () => root.unmount()); client.clear(); }
  });
});

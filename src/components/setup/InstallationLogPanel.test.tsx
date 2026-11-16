// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import i18n from "i18next";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { InstallationLogPanel } from "./InstallationLogPanel";
import type { InstallLogSnapshot } from "@/types/installLog";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const history: InstallLogSnapshot = { status: "error", package: "example", started_at: Date.now() - 5000, updated_at: Date.now(),
  lines: [{ id: 1, time: Date.now(), text: "dependency resolution failed" }] };
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); };

function installLogSource(initial: InstallLogSnapshot) {
  let push: ((snapshot: InstallLogSnapshot) => void) | undefined;
  window.electronApi = {
    getInstallLog: vi.fn().mockResolvedValue(initial),
    onInstallLog: vi.fn((callback: (snapshot: InstallLogSnapshot) => void) => { push = callback; return () => { push = undefined; }; }),
  } as unknown as Window["electronApi"];
  return (snapshot: InstallLogSnapshot) => push?.(snapshot);
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
afterEach(() => {
  window.electronApi = undefined;
});

describe("installation details", () => {
  it("opens on failure, copies output, collapses, and restores history on remount", async () => {
    installLogSource(history);
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
    const element = document.createElement("div");
    const root = createRoot(element);
    try {
      await act(async () => root.render(<InstallationLogPanel />));
      await flush();
      expect(element.textContent).toContain("Installation failed");
      expect(element.querySelector("details")?.open).toBe(true);
      const button = [...element.querySelectorAll("button")].find(value => value.textContent === "Copy logs");
      await act(async () => button?.click());
      expect(copy).toHaveBeenCalledWith(expect.stringContaining("dependency resolution failed"));
      expect(element.textContent).toContain("Copied");
      await act(async () => {
        const details = element.querySelector("details")!;
        details.open = false;
        details.dispatchEvent(new Event("toggle"));
      });
      expect(element.querySelector("details")?.open).toBe(false);
      await act(async () => root.render(null));
      await act(async () => root.render(<InstallationLogPanel />));
      await flush();
      expect(element.textContent).toContain("dependency resolution failed");
    } finally { await act(async () => root.unmount()); }
  });

  it("follows the output pushed by the desktop shell while an operation runs", async () => {
    const push = installLogSource({ status: "idle", package: "", started_at: null, updated_at: null, lines: [] });
    const element = document.createElement("div");
    const root = createRoot(element);
    try {
      await act(async () => root.render(<InstallationLogPanel active />));
      await flush();
      expect(element.textContent).toContain("Installation in progress");
      expect(element.textContent).toContain("Waiting for output…");
      await act(async () => push({ status: "running", package: "torch", started_at: Date.now(), updated_at: Date.now(),
        lines: [{ id: 1, time: Date.now(), text: "Downloading torch" }] }));
      expect(element.textContent).toContain("Downloading torch");
      expect(element.textContent).not.toContain("Last package operation completed");
    } finally { await act(async () => root.unmount()); }
  });

  it("copies the failure reported by the caller with the log", async () => {
    installLogSource(history);
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
    const element = document.createElement("div");
    const root = createRoot(element);
    try {
      await act(async () => root.render(<InstallationLogPanel error="uv exited with code 2" />));
      await flush();
      expect(element.querySelector("details")?.open).toBe(true);
      await act(async () => [...element.querySelectorAll("button")].find(value => value.textContent === "Copy logs")?.click());
      expect(copy).toHaveBeenCalledWith(expect.stringContaining("uv exited with code 2"));
    } finally { await act(async () => root.unmount()); }
  });
});

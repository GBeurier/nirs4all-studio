/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { PythonEnvContext, type PythonEnvContextValue } from "@/context/usePythonEnv";
import { envReport, envState, recommendedPackage } from "@/components/python-env/__tests__/fixtures";
import type { PythonEnvState } from "@/types/pythonEnvironment";
import { AppSidebar } from "./AppSidebar";

const mocks = vi.hoisted(() => ({ updateCount: 0 }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/useUpdates", () => ({ useHasUpdates: () => ({ updateCount: mocks.updateCount }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("sidebar Settings indicator", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    mocks.updateCount = 0;
    globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
  });

  async function settingsLink(state: PythonEnvState | null) {
    const value: PythonEnvContextValue = { api: null, state, setupSkipped: false, skipSetup: vi.fn(), run: vi.fn() };
    await act(async () => root.render(
      <MemoryRouter>
        <TooltipProvider>
          <PythonEnvContext.Provider value={value}><AppSidebar /></PythonEnvContext.Provider>
        </TooltipProvider>
      </MemoryRouter>,
    ));
    return [...container.querySelectorAll("a")].find((link) => link.textContent?.includes("nav.settings"))!;
  }
  const dot = (link: HTMLAnchorElement) => link.querySelector('[aria-label="pythonEnv.needsReview"]');

  it("shows a dot leading to the Python tab when recommended packages are older than recommended", async () => {
    const link = await settingsLink(envState({ selected: envReport({ recommended: [recommendedPackage({ status: "older" })] }) }));
    expect(dot(link)).not.toBeNull();
    expect(link.getAttribute("href")).toBe("/settings?tab=python");
  });

  it("shows the dot when the environment needs attention", async () => {
    const link = await settingsLink(envState({ phase: "needs_attention", problem: { code: "host_failed", message: "x" } }));
    expect(dot(link)).not.toBeNull();
  });

  it("keeps the update badge and no dot for a healthy environment", async () => {
    mocks.updateCount = 1;
    const link = await settingsLink(envState({ selected: envReport({ recommended: [recommendedPackage()] }) }));
    expect(dot(link)).toBeNull();
    expect(link.getAttribute("href")).toBe("/settings?tab=updates");
    expect(link.textContent).toContain("1");
  });

  it("shows nothing outside the desktop application", async () => {
    const link = await settingsLink(null);
    expect(dot(link)).toBeNull();
    expect(link.getAttribute("href")).toBe("/settings");
  });
});

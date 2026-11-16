/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import "@/lib/i18n";
import { PythonEnvContext, type PythonEnvContextValue } from "@/context/usePythonEnv";
import { envState, unconfiguredState } from "@/components/python-env/__tests__/fixtures";
import type { PythonEnvProblemCode, PythonEnvState } from "@/types/pythonEnvironment";
import { PythonEnvBanner } from "./PythonEnvBanner";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const problem = (code: PythonEnvProblemCode, message: string): PythonEnvState =>
  envState({ phase: "needs_attention", problem: { code, message } });

describe("Python environment banner", () => {
  let root: Root;
  let container: HTMLDivElement;
  const run = vi.fn<PythonEnvContextValue["run"]>();

  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });
  beforeEach(() => {
    run.mockReset();
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
  });

  async function render(state: PythonEnvState | null, { setupSkipped = false, path = "/datasets" } = {}) {
    const value: PythonEnvContextValue = { api: null, state, setupSkipped, skipSetup: vi.fn(), run };
    await act(async () => root.render(
      <MemoryRouter initialEntries={[path]}>
        <PythonEnvContext.Provider value={value}><PythonEnvBanner /></PythonEnvContext.Provider>
      </MemoryRouter>,
    ));
  }

  it.each<[PythonEnvProblemCode, string]>([
    ["interpreter_missing", "The selected Python environment was not found"],
    ["interpreter_unusable", "Studio could not use the selected Python interpreter (Python 3.11 or newer is required)"],
    ["required_not_installable", "Studio cannot install the required packages in this environment"],
    ["required_update_failed", "The required packages could not be installed"],
    ["host_failed", "The analysis engine did not start"],
  ])("explains %s with the reported detail and both actions", async (code, title) => {
    await render(problem(code, "Detail reported by the main process."));
    expect(container.textContent).toContain(title);
    expect(container.textContent).toContain("Detail reported by the main process.");
    expect(container.querySelector('a[href="/settings?tab=python"]')?.textContent).toContain("Open Python settings");
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "Retry")).toBe(true);
  });

  it("retries through the environment lifecycle", async () => {
    const retry = vi.fn();
    run.mockImplementation(async (action) => {
      await action({ retry } as never);
      return { success: true, hostRestarted: true, state: envState() };
    });
    await render(problem("host_failed", "The host exited."));
    await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === "Retry")!.click());
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("shows a lighter reminder after setup was skipped", async () => {
    await render(unconfiguredState(), { setupSkipped: true });
    expect(container.textContent).toContain("Python is not set up.");
    expect(container.querySelector('a[href="/setup"]')?.textContent).toContain("Set up Python");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it.each<[string, PythonEnvState | null, { setupSkipped?: boolean; path?: string }]>([
    ["a ready environment", envState(), {}],
    ["a busy environment", envState({ phase: "busy" }), {}],
    ["no environment before the user decided", unconfiguredState(), {}],
    ["the browser", null, {}],
    ["the setup page", problem("host_failed", "x"), { path: "/setup" }],
    ["the Python settings tab", problem("host_failed", "x"), { path: "/settings?tab=python" }],
  ])("stays hidden for %s", async (_label, state, options) => {
    await render(state, options);
    expect(container.textContent).toBe("");
  });
});

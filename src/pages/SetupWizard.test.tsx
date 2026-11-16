/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PythonEnvContext, type PythonEnvContextValue } from "@/context/usePythonEnv";
import type { PythonEnvApi } from "@/types/pythonEnvironment";
import SetupWizard from "./SetupWizard";

vi.mock("@/components/python-env/PythonEnvironmentPage", () => ({
  PythonEnvironmentPage: ({ context }: { context: string }) => <div data-testid="python-page">{context}</div>,
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("setup route", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
  });

  async function render(api: PythonEnvApi | null) {
    const value: PythonEnvContextValue = { api, state: null, setupSkipped: false, skipSetup: vi.fn(), run: vi.fn() };
    await act(async () => root.render(
      <MemoryRouter initialEntries={["/setup"]}>
        <PythonEnvContext.Provider value={value}>
          <Routes>
            <Route path="/setup" element={<SetupWizard />} />
            <Route path="/" element={<div data-testid="home" />} />
          </Routes>
        </PythonEnvContext.Provider>
      </MemoryRouter>,
    ));
  }

  it("shows the Python environment page in the desktop application", async () => {
    await render({} as PythonEnvApi);
    expect(container.querySelector('[data-testid="python-page"]')?.textContent).toBe("setup");
  });

  it("has nothing to set up outside the desktop application", async () => {
    await render(null);
    expect(container.querySelector('[data-testid="python-page"]')).toBeNull();
    expect(container.querySelector('[data-testid="home"]')).not.toBeNull();
  });
});

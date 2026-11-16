/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PythonEnvContext, type PythonEnvContextValue } from "@/context/usePythonEnv";
import { envReport, envState, recommendedPackage } from "@/components/python-env/__tests__/fixtures";
import type { PythonEnvState } from "@/types/pythonEnvironment";
import Settings from "./Settings";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./SettingsSections", () => ({
  GeneralSettingsTab: () => null,
  WorkspacesSettingsTab: () => null,
  DataSettingsTab: () => null,
  PythonSettingsTab: () => <div data-testid="python-tab" />,
  UpdatesSettingsTab: () => null,
  AdvancedSettingsTab: () => null,
}));
vi.mock("@/context/useTheme", () => ({ useTheme: () => ({ theme: "light", setTheme: vi.fn() }) }));
vi.mock("@/context/useDeveloperMode", () => ({ useDeveloperMode: () => ({ isDeveloperMode: false, setDeveloperMode: vi.fn(), isLoading: false }) }));
vi.mock("@/context/useUISettings", () => ({
  useUISettings: () => ({ density: "comfortable", setDensity: vi.fn(), reduceAnimations: false, setReduceAnimations: vi.fn(), zoomLevel: 100, setZoomLevel: vi.fn(), isLoading: false }),
}));
vi.mock("@/api/workspace", () => ({ getWorkspace: vi.fn().mockResolvedValue({ workspace: null }) }));
vi.mock("@/api/updates", () => ({ requestRestart: vi.fn() }));
vi.mock("@/api/transport", () => ({ resetBackendUrl: vi.fn() }));
vi.mock("@/hooks/useBackendDisplayUrl", () => ({ useBackendDisplayUrl: () => "http://127.0.0.1:8000" }));
vi.mock("@/hooks/useDatasetQueries", () => ({
  useLinkedWorkspacesQuery: () => ({ data: undefined }),
  useInvalidateDatasets: () => vi.fn(),
}));
vi.mock("@/lib/sentry", () => ({ disableSentry: vi.fn(), initSentry: vi.fn() }));
vi.mock("@/lib/telemetryConsent", () => ({
  TELEMETRY_CONSENT_UPDATED_EVENT: "telemetry-consent-updated",
  getTelemetryConsentStatus: vi.fn().mockResolvedValue("unset"),
  setTelemetryConsentStatus: vi.fn(),
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal("__APP_VERSION__", "0.0.0-test");

describe("Settings Python tab", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
  });

  async function pythonTab(state: PythonEnvState | null, path = "/settings") {
    const value: PythonEnvContextValue = { api: null, state, setupSkipped: false, skipSetup: vi.fn(), run: vi.fn() };
    await act(async () => root.render(
      <MemoryRouter initialEntries={[path]}>
        <PythonEnvContext.Provider value={value}><Settings /></PythonEnvContext.Provider>
      </MemoryRouter>,
    ));
    return [...container.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent?.includes("settings.tabs.python"))!;
  }
  const dot = (tab: Element) => tab.querySelector('[aria-label="pythonEnv.needsReview"]');

  it("marks the tab when recommended packages are older than recommended", async () => {
    const tab = await pythonTab(envState({ selected: envReport({ recommended: [recommendedPackage({ status: "older" })] }) }));
    expect(dot(tab)).not.toBeNull();
  });

  it("marks the tab when the environment needs attention", async () => {
    const tab = await pythonTab(envState({ phase: "needs_attention", problem: { code: "interpreter_missing", message: "x" } }));
    expect(dot(tab)).not.toBeNull();
  });

  it("leaves the tab unmarked for a healthy environment and opens it from its link", async () => {
    const tab = await pythonTab(envState({ selected: envReport({ recommended: [recommendedPackage()] }) }), "/settings?tab=python");
    expect(dot(tab)).toBeNull();
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector('[data-testid="python-tab"]')).not.toBeNull();
  });
});

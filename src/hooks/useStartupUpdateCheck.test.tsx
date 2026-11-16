// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PythonEnvContext, type PythonEnvContextValue } from "@/context/usePythonEnv";
import { envReport, envState, recommendedPackage, unconfiguredState } from "@/components/python-env/__tests__/fixtures";
import type { PythonEnvState } from "@/types/pythonEnvironment";

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), pathname: "/datasets", toast: vi.fn() }));
vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: mocks.pathname }),
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("i18next", () => ({ default: { t: (key: string, options?: { count?: number }) => options?.count === undefined ? key : `${key}:${options.count}` } }));
vi.mock("./useUpdates", () => ({ useUpdateStatus: () => ({}), useUpdateSettings: () => ({}) }));
vi.mock("./useNetworkState", () => ({ useNetworkState: () => ({ online: false, isLoading: false }) }));
import { useStartupUpdateCheck } from "./useStartupUpdateCheck";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Startup() {
  useStartupUpdateCheck();
  return null;
}

const outdated = (count: number) => envState({
  selected: envReport({
    recommended: Array.from({ length: count }, (_, index) => recommendedPackage({ name: `pkg-${index}`, status: "older" })),
  }),
});

describe("startup checks for the Python environment", () => {
  let root: Root;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pathname = "/datasets";
    root = createRoot(document.createElement("div"));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
  });

  async function render(state: PythonEnvState | null, setupSkipped = false) {
    const value: PythonEnvContextValue = { api: null, state, setupSkipped, skipSetup: vi.fn(), run: vi.fn() };
    await act(async () => root.render(
      <PythonEnvContext.Provider value={value}><Startup /></PythonEnvContext.Provider>,
    ));
  }

  it("opens setup only while no environment is selected", async () => {
    await render(unconfiguredState());
    expect(mocks.navigate).toHaveBeenCalledWith("/setup", { replace: true });
  });

  it.each([
    ["ready", envState()],
    ["needs attention", envState({ phase: "needs_attention", problem: { code: "host_failed", message: "The host did not start." } })],
    ["busy", envState({ phase: "busy", activity: { kind: "updating_required", percent: null, detail: "" } })],
    ["outside the desktop application", null],
  ])("does not open setup when the environment is %s", async (_label, state) => {
    await render(state);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("respects the choice to continue without Python and does not loop on the setup page", async () => {
    await render(unconfiguredState(), true);
    expect(mocks.navigate).not.toHaveBeenCalled();
    mocks.pathname = "/setup";
    await render(unconfiguredState());
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("warns once per session when recommended packages are older than recommended", async () => {
    await render(outdated(2));
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    expect(mocks.toast).toHaveBeenCalledWith("pythonEnv.outdatedToast.title", expect.objectContaining({
      description: "pythonEnv.outdated:2",
    }));
    const { action } = mocks.toast.mock.calls[0][1] as { action: { onClick: () => void } };
    action.onClick();
    expect(mocks.navigate).toHaveBeenCalledWith("/settings?tab=python");

    await render(outdated(3));
    expect(mocks.toast).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when every recommended package is current", async () => {
    await render(envState({ selected: envReport({ recommended: [recommendedPackage()] }) }));
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ navigate: vi.fn(), get: vi.fn(), getEnvInfo: vi.fn(), completed: true }));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("./useUpdates", () => ({ useUpdateStatus: () => ({}), useUpdateSettings: () => ({}) }));
vi.mock("./useRecommendedConfig", () => ({
  useSetupStatus: () => ({ data: { setup_completed: mocks.completed } }),
  useIsConfigAligned: () => ({ isAligned: true, misalignedCount: 0 }),
}));
vi.mock("./useNetworkState", () => ({ useNetworkState: () => ({ online: false, isLoading: false }) }));
vi.mock("@/api/transport", () => ({ api: { get: mocks.get } }));
vi.mock("@/components/settings/PythonEnvPickerRuntime", () => ({ getElectronApi: () => ({ getEnvInfo: mocks.getEnvInfo }) }));
import { useStartupUpdateCheck } from "./useStartupUpdateCheck";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function Startup() { useStartupUpdateCheck(); return null; }
afterEach(() => { vi.resetAllMocks(); mocks.completed = true; });
describe("desktop startup recovery", () => {
  it.each(["ready", "transient-readiness-error", "transient-env-error", "not-ready", "new-profile"])("handles %s without treating every probe failure as a new install", async scenario => {
    mocks.completed = scenario !== "new-profile";
    mocks.getEnvInfo.mockImplementation(async () => {
      if (scenario === "transient-env-error") throw new Error("IPC unavailable");
      return { pythonPath: "D:/existing/python.exe", setupDeferred: false };
    });
    mocks.get.mockImplementation(async () => {
      if (scenario === "transient-readiness-error") throw new Error("503");
      return { ml_ready: scenario !== "not-ready" };
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () => root.render(<Startup />));
      if (["not-ready", "new-profile"].includes(scenario)) expect(mocks.navigate).toHaveBeenCalledWith("/setup", { replace: true });
      else expect(mocks.navigate).not.toHaveBeenCalled();
    } finally { await act(async () => root.unmount()); }
  });
});

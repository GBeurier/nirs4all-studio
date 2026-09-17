/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SetupWizard from "./SetupWizard";

const mocks = vi.hoisted(() => ({
  inventory: vi.fn(), diff: vi.fn(), runtime: vi.fn(), readiness: vi.fn(), complete: vi.fn(), align: vi.fn(), navigate: vi.fn(), config: vi.fn(),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/api/dependencies", () => ({ getDependencies: mocks.inventory }));
vi.mock("@/api/config", () => ({ getConfigDiff: mocks.diff, alignConfig: mocks.align }));
vi.mock("@/api/system", () => ({ getRuntimeSummary: mocks.runtime }));
vi.mock("@/api/transport", () => ({ api: { get: mocks.readiness } }));
vi.mock("@/hooks/useRecommendedConfig", () => ({
  useCompleteSetup: () => ({ mutateAsync: mocks.complete, isPending: false }),
  useRecommendedConfig: mocks.config,
  useGPUDetection: () => ({ data: null, isLoading: true }),
  useSkipSetup: () => ({ mutate: vi.fn() }),
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("SetupWizard packaged installation verification", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.resetAllMocks();
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    mocks.inventory.mockResolvedValue({ read_only: true, runtime_valid: true, categories: [] });
    mocks.diff.mockResolvedValue({ is_aligned: true, packages: [] });
    mocks.runtime.mockResolvedValue({ core_ready: true, coherent: true });
    mocks.readiness.mockResolvedValue({ ml_ready: true });
    mocks.complete.mockResolvedValue({ setup_completed: true });
    mocks.config.mockReturnValue({ data: null, isLoading: true });
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); });
  async function mount() { await act(async () => root.render(<SetupWizard />)); }
  function openButton() {
    return [...container.querySelectorAll("button")].find((button) => button.textContent === "Open Studio")!;
  }

  it("verifies the included CPU runtime and completes without unsupported installs", async () => {
    await mount();
    expect(container.textContent).toContain("required packages are ready");
    expect(mocks.config).not.toHaveBeenCalled();
    await act(async () => openButton().click());
    expect(mocks.diff).toHaveBeenCalledTimes(2);
    expect(mocks.diff).toHaveBeenCalledWith("cpu", false, false);
    expect(mocks.complete).toHaveBeenCalledWith({ profile: "cpu" });
    expect(mocks.navigate).toHaveBeenCalledWith("/datasets", { replace: true });
    expect(mocks.align).not.toHaveBeenCalled();
  });

  it("blocks completion when a required package is missing", async () => {
    mocks.diff.mockResolvedValue({ is_aligned: false, packages: [{ name: "shap", status: "missing" }] });
    await mount();
    expect(container.textContent).toContain("missing or incompatible: shap");
    expect(openButton().disabled).toBe(true);
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("continueAnyway");
  });

  it("blocks completion when packages exist but importing the runtime fails", async () => {
    mocks.runtime.mockResolvedValue({ core_ready: false, coherent: true });
    await mount();
    expect(container.textContent).toContain("runtime is not ready");
    expect(openButton().disabled).toBe(true);
  });

  it("refuses a runtime that becomes unavailable before completion", async () => {
    await mount();
    mocks.inventory.mockRejectedValue(new Error("Runtime unavailable"));
    await act(async () => openButton().click());
    expect(container.textContent).toContain("Runtime unavailable");
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("reports scientific runtime refusal even when Python imports and packages are valid", async () => {
    mocks.readiness.mockResolvedValue({ ml_ready: false, ml_error: "The scientific executor was refused" });
    await mount();
    expect(mocks.readiness).toHaveBeenCalledWith("/system/readiness");
    expect(container.textContent).toContain("The scientific executor was refused");
    expect(openButton().disabled).toBe(true);
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("surfaces persistence failures without launching Studio", async () => {
    mocks.complete.mockRejectedValue(new Error("Cannot save settings"));
    await mount();
    await act(async () => openButton().click());
    expect(container.textContent).toContain("Cannot save settings");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("retains the installation wizard for a writable web backend", async () => {
    mocks.inventory.mockResolvedValue({ runtime_valid: true, categories: [] });
    await mount();
    expect(mocks.config).toHaveBeenCalled();
    expect(container.textContent).toContain("setupWizard.detect.title");
    expect(mocks.runtime).not.toHaveBeenCalled();
  });
});

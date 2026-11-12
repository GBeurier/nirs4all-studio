/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DependenciesManager } from "../DependenciesManager";

const mocks = vi.hoisted(() => ({ inventory: vi.fn(), refresh: vi.fn(), install: vi.fn(), revert: vi.fn(), runtime: vi.fn() }));
vi.mock("@/api/dependencies", () => ({
  getDependencies: mocks.inventory, refreshDependencies: mocks.refresh, installDependency: mocks.install,
  uninstallDependency: vi.fn(), revertDependency: mocks.revert,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/api/system", () => ({ getRuntimeSummary: mocks.runtime }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("DependenciesManager runtime inventory", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.runtime.mockRejectedValue(new Error("Summary unavailable"));
    mocks.refresh.mockResolvedValue({ success: true });
    mocks.inventory.mockResolvedValue({
      read_only: true, runtime_valid: true, cached_at: null, total_installed: 0, total_packages: 1,
      categories: [{ id: "explainability", name: "Explainability", installed_count: 0, total_count: 1, packages: [{
        name: "shap", is_installed: false, installed_version: null, min_version: ">=0.44", recommended_version: null,
      }] }],
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
  async function mount() { await act(async () => root.render(<DependenciesManager />)); }
  function installButton() { return [...container.querySelectorAll("button")].find((button) => button.textContent === "settings.dependencies.install")!; }

  it("honors read-only inventory even when the runtime summary is unavailable", async () => {
    await mount();
    expect(container.textContent).toContain("shap");
    expect(container.textContent).toContain("settings.dependencies.readOnlyExternal");
    expect(installButton().disabled).toBe(true);
    await act(async () => installButton().click());
    expect(mocks.install).not.toHaveBeenCalled();
  });

  it("reports refresh errors and allows retrying the inventory", async () => {
    await mount();
    mocks.refresh.mockRejectedValue(new Error("Runtime stopped"));
    await act(async () => (container.querySelector('[title="settings.dependencies.refresh"]') as HTMLButtonElement).click());
    expect(container.textContent).toContain("Runtime stopped");
    const retry = [...container.querySelectorAll("button")].find((button) => button.textContent === "common.retry")!;
    await act(async () => retry.click());
    expect(container.textContent).toContain("shap");
    expect(container.textContent).not.toContain("Runtime stopped");
  });

  it("updates an external environment to recommended and refreshes its inventory", async () => {
    const inventory = await mocks.inventory();
    inventory.read_only = false;
    Object.assign(inventory.categories[0].packages[0], {
      is_installed: true, installed_version: "0.40", recommended_version: "0.47.1", is_below_recommended: true,
    });
    mocks.inventory.mockResolvedValue(inventory);
    mocks.runtime.mockResolvedValue({ runtime_kind: "custom", is_bundled_default: false });
    let complete!: (result: unknown) => void;
    mocks.revert.mockReturnValue(new Promise(resolve => { complete = resolve; }));
    await mount();
    const update = [...container.querySelectorAll("button")].find(button => button.textContent === "settings.dependencies.updateToRecommended")!;
    expect(update.disabled).toBe(false);
    await act(async () => update.click());
    expect(mocks.revert).toHaveBeenCalledExactlyOnceWith("shap");
    expect(container.textContent).toContain("settings.dependencies.processing");
    await act(async () => complete({ success: true, message: "Updated shap", requires_restart: true }));
    expect(mocks.inventory).toHaveBeenLastCalledWith(true);
    expect(container.textContent).toContain("settings.dependencies.actionSuccess.update");
    expect(container.textContent).toContain("settings.dependencies.restartRequired");
    expect(container.textContent).not.toContain("settings.dependencies.processing");
  });

  it("keeps the bundled runtime protected even if the inventory claims it is writable", async () => {
    const inventory = await mocks.inventory();
    inventory.read_only = false;
    mocks.runtime.mockResolvedValue({ runtime_kind: "bundled", is_bundled_default: true });
    await mount();
    expect(installButton().disabled).toBe(true);
    expect(container.textContent).toContain("settings.dependencies.readOnlyBundled");
  });

  it("shows a structured refusal and opens Python selection after deferred setup", async () => {
    mocks.inventory.mockRejectedValue({ status: 503, detail: "No Python runtime is configured" });
    Object.defineProperty(window, "electronApi", { configurable: true, value: { isElectron: true } });
    const choose = vi.fn();
    window.addEventListener("choose-python-environment", choose);
    try {
      await mount();
      expect(container.textContent).toContain("No Python runtime is configured");
      const configure = [...container.querySelectorAll("button")].find(button => button.textContent === "errors.api.openPythonSettings")!;
      await act(async () => configure.click());
      expect(choose).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener("choose-python-environment", choose);
      Reflect.deleteProperty(window, "electronApi");
    }
  });
});

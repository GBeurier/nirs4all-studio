/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DependenciesManager } from "../DependenciesManager";

const mocks = vi.hoisted(() => ({ inventory: vi.fn(), refresh: vi.fn(), install: vi.fn(), runtime: vi.fn() }));
vi.mock("@/api/dependencies", () => ({
  getDependencies: mocks.inventory, refreshDependencies: mocks.refresh, installDependency: mocks.install,
  uninstallDependency: vi.fn(), revertDependency: vi.fn(),
}));
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
  function installButton() { return [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Install"))!; }

  it("honors read-only inventory even when the runtime summary is unavailable", async () => {
    await mount();
    expect(container.textContent).toContain("shap");
    expect(container.textContent).toContain("Package management is unavailable");
    expect(installButton().disabled).toBe(true);
    await act(async () => installButton().click());
    expect(mocks.install).not.toHaveBeenCalled();
  });

  it("reports refresh errors and allows retrying the inventory", async () => {
    await mount();
    mocks.refresh.mockRejectedValue(new Error("Runtime stopped"));
    await act(async () => (container.querySelector('[title="Refresh dependencies"]') as HTMLButtonElement).click());
    expect(container.textContent).toContain("Runtime stopped");
    const retry = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Retry"))!;
    await act(async () => retry.click());
    expect(container.textContent).toContain("shap");
    expect(container.textContent).not.toContain("Runtime stopped");
  });
});

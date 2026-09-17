/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeveloperModeProvider } from "./DeveloperModeContext";
import { useDeveloperMode, type DeveloperModeContextType } from "./useDeveloperMode";

const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), workspace: vi.fn() }));
vi.mock("@/api/appSettings", () => ({ getAppSettings: mocks.get, updateAppSettings: mocks.update }));
vi.mock("@/api/workspace", () => ({ getWorkspaceSettings: mocks.workspace }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("DeveloperModeProvider", () => {
  let root: Root;
  let container: HTMLDivElement;
  let state: DeveloperModeContextType;
  function Consumer() {
    state = useDeveloperMode();
    return <span>{String(state.isDeveloperMode)}</span>;
  }
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.get.mockResolvedValue({ ui_preferences: {} });
    mocks.workspace.mockRejectedValue(new Error("No active workspace"));
    mocks.update.mockResolvedValue({ success: true });
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); });
  async function mount() {
    await act(async () => root.render(<DeveloperModeProvider><Consumer /></DeveloperModeProvider>));
  }

  it("enables developer mode without a workspace and persists it in app settings", async () => {
    await mount();
    expect(state.isLoading).toBe(false);
    await act(async () => state.toggleDeveloperMode());
    expect(container.textContent).toBe("true");
    expect(mocks.update).toHaveBeenCalledWith({ ui_preferences: { developer_mode: true } });
    mocks.get.mockResolvedValue({ ui_preferences: { developer_mode: true } });
    await act(async () => state.refresh());
    expect(state.isDeveloperMode).toBe(true);
  });

  it("preserves legacy workspace preferences until an app preference is saved", async () => {
    mocks.workspace.mockResolvedValue({ developer_mode: true });
    await mount();
    expect(state.isDeveloperMode).toBe(true);
    mocks.get.mockResolvedValue({ ui_preferences: { developer_mode: false } });
    mocks.workspace.mockClear();
    await act(async () => state.refresh());
    expect(state.isDeveloperMode).toBe(false);
    expect(mocks.workspace).not.toHaveBeenCalled();
  });

  it("restores the previous value when saving fails", async () => {
    await mount();
    mocks.update.mockRejectedValue(new Error("Disk full"));
    const logging = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => {
      await expect(state.setDeveloperMode(false)).rejects.toThrow("Disk full");
    });
    expect(state.isDeveloperMode).toBe(false);
    logging.mockRestore();
  });
});

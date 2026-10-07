/** @vitest-environment jsdom */
import { act, StrictMode } from "react";
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
  afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); });
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

  it("reloads the stored preference after transient native preselection refusal", async () => {
    vi.useFakeTimers();
    mocks.get.mockRejectedValueOnce({ status: 503, code: "STUDIO_NATIVE_ROUTE_UNAVAILABLE" })
      .mockResolvedValue({ ui_preferences: { developer_mode: true } });
    await mount();
    expect(state.isLoading).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(1500));
    expect(state.isDeveloperMode).toBe(true);
    expect(state.isLoading).toBe(false);
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("bounds retries and never substitutes workspace defaults for an unavailable app preference", async () => {
    vi.useFakeTimers();
    mocks.get.mockRejectedValue({ status: 503 });
    mocks.workspace.mockResolvedValue({ developer_mode: true });
    await mount();
    await act(async () => vi.runAllTimersAsync());
    expect(mocks.get).toHaveBeenCalledTimes(9);
    expect(state.isLoading).toBe(false);
    expect(state.isDeveloperMode).toBe(false);
    expect(mocks.workspace).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not retry a permanent settings refusal or lose a previously loaded value", async () => {
    vi.useFakeTimers();
    mocks.get.mockResolvedValue({ ui_preferences: { developer_mode: true } });
    await mount();
    mocks.get.mockRejectedValue({ status: 400 });
    await act(async () => state.refresh());
    expect(state.isDeveloperMode).toBe(true);
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels the pending settings request and retry on unmount", async () => {
    vi.useFakeTimers();
    mocks.get.mockRejectedValue({ status: 503 });
    await mount();
    const signal = mocks.get.mock.calls[0][0];
    await act(async () => root.render(null));
    expect(signal.aborted).toBe(true);
    await act(async () => vi.runAllTimersAsync());
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores an older read that completes after a user's saved change", async () => {
    let complete!: (value: unknown) => void;
    mocks.get.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    await mount();
    await act(async () => state.setDeveloperMode(true));
    await act(async () => complete({ ui_preferences: { developer_mode: false } }));
    expect(state.isDeveloperMode).toBe(true);
    expect(state.isLoading).toBe(false);
    expect(mocks.update).toHaveBeenCalledWith({ ui_preferences: { developer_mode: true } });
  });

  it("only applies the newest refresh when two reads finish out of order", async () => {
    await mount();
    let first!: (value: unknown) => void;
    let second!: (value: unknown) => void;
    mocks.get.mockImplementationOnce(() => new Promise(resolve => { first = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { second = resolve; }));
    let firstRead!: Promise<void>;
    let secondRead!: Promise<void>;
    await act(async () => { firstRead = state.refresh(); secondRead = state.refresh(); });
    await act(async () => { second({ ui_preferences: { developer_mode: true } }); await secondRead; });
    await act(async () => { first({ ui_preferences: { developer_mode: false } }); await firstRead; });
    expect(state.isDeveloperMode).toBe(true);
  });

  it("retries network failure but never repeats the write", async () => {
    vi.useFakeTimers();
    mocks.get.mockRejectedValueOnce({ status: 0 }).mockResolvedValue({ ui_preferences: { developer_mode: true } });
    await mount();
    await act(async () => vi.advanceTimersByTimeAsync(1500));
    expect(state.isDeveloperMode).toBe(true);
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([401, 403, 500, 501])("keeps permanent status %s fail closed without retry", async status => {
    vi.useFakeTimers();
    mocks.get.mockRejectedValue({ status });
    await mount();
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(state.isDeveloperMode).toBe(false);
    expect(state.isLoading).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["app", "workspace"])("bounds a hung %s read including IPC that ignores abort", async kind => {
    vi.useFakeTimers();
    if (kind === "app") mocks.get.mockImplementation(() => new Promise(() => {}));
    else mocks.workspace.mockImplementation(() => new Promise(() => {}));
    await mount();
    const signal = mocks.get.mock.calls[0][0];
    await act(async () => vi.advanceTimersByTimeAsync(89_999));
    expect(state.isLoading).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(signal.aborted).toBe(true);
    expect(state.isLoading).toBe(false);
    expect(state.isDeveloperMode).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up the superseded StrictMode mount before applying the new read", async () => {
    let oldRead!: (value: unknown) => void;
    mocks.get.mockImplementationOnce(() => new Promise(resolve => { oldRead = resolve; }))
      .mockResolvedValue({ ui_preferences: { developer_mode: true } });
    await act(async () => root.render(<StrictMode><DeveloperModeProvider><Consumer /></DeveloperModeProvider></StrictMode>));
    expect(mocks.get.mock.calls[0][0].aborted).toBe(true);
    expect(state.isDeveloperMode).toBe(true);
    await act(async () => oldRead({ ui_preferences: { developer_mode: false } }));
    expect(state.isDeveloperMode).toBe(true);
    expect(state.isLoading).toBe(false);
  });

  it("preserves a user's pending write when refresh returns the older saved value", async () => {
    await mount();
    let finishWrite!: (value: unknown) => void;
    mocks.update.mockImplementation(() => new Promise(resolve => { finishWrite = resolve; }));
    mocks.get.mockResolvedValue({ ui_preferences: { developer_mode: false } });
    let writing!: Promise<void>;
    await act(async () => { writing = state.setDeveloperMode(true); });
    await act(async () => state.refresh());
    expect(state.isDeveloperMode).toBe(true);
    await act(async () => { finishWrite({ success: true }); await writing; });
    expect(state.isDeveloperMode).toBe(true);
  });

  it("continues the newer choice after an older queued write fails", async () => {
    await mount();
    let failOld!: (error: Error) => void;
    mocks.update.mockImplementationOnce(() => new Promise((_, reject) => { failOld = reject; }))
      .mockResolvedValue({ success: true });
    const logging = vi.spyOn(console, "error").mockImplementation(() => {});
    let oldWrite!: Promise<void>;
    let newWrite!: Promise<void>;
    await act(async () => { oldWrite = state.setDeveloperMode(true); });
    await act(async () => { newWrite = state.setDeveloperMode(true); });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    await act(async () => { failOld(new Error("Old write refused")); await expect(oldWrite).rejects.toThrow("Old write refused"); });
    await act(async () => newWrite);
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(state.isDeveloperMode).toBe(true);
    logging.mockRestore();
  });

  it("still rolls back a refused current write when refresh happens during the save", async () => {
    await mount();
    let failWrite!: (error: Error) => void;
    mocks.update.mockImplementation(() => new Promise((_, reject) => { failWrite = reject; }));
    mocks.get.mockResolvedValue({ ui_preferences: { developer_mode: false } });
    const logging = vi.spyOn(console, "error").mockImplementation(() => {});
    let writing!: Promise<void>;
    await act(async () => { writing = state.setDeveloperMode(true); });
    await act(async () => state.refresh());
    await act(async () => { failWrite(new Error("Current write refused")); await expect(writing).rejects.toThrow("Current write refused"); });
    expect(state.isDeveloperMode).toBe(false);
    logging.mockRestore();
  });

  it("ignores a refresh begun during a save even if its stale read finishes after the write", async () => {
    await mount();
    let finishWrite!: (value: unknown) => void;
    let finishRead!: (value: unknown) => void;
    mocks.update.mockImplementation(() => new Promise(resolve => { finishWrite = resolve; }));
    mocks.get.mockImplementation(() => new Promise(resolve => { finishRead = resolve; }));
    let writing!: Promise<void>;
    let refreshing!: Promise<void>;
    await act(async () => { writing = state.setDeveloperMode(true); });
    await act(async () => { refreshing = state.refresh(); });
    await act(async () => { finishWrite({ success: true }); await writing; });
    await act(async () => { finishRead({ ui_preferences: { developer_mode: false } }); await refreshing; });
    expect(state.isDeveloperMode).toBe(true);
  });

  it("rolls back to the confirmed value when overlapping optimistic writes both fail", async () => {
    await mount();
    let failFirst!: (error: Error) => void;
    let failSecond!: (error: Error) => void;
    mocks.update.mockImplementationOnce(() => new Promise((_, reject) => { failFirst = reject; }))
      .mockImplementationOnce(() => new Promise((_, reject) => { failSecond = reject; }));
    const logging = vi.spyOn(console, "error").mockImplementation(() => {});
    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => { first = state.setDeveloperMode(true); });
    await act(async () => { second = state.setDeveloperMode(false); });
    await act(async () => { failFirst(new Error("First refused")); await expect(first).rejects.toThrow("First refused"); });
    await act(async () => { failSecond(new Error("Second refused")); await expect(second).rejects.toThrow("Second refused"); });
    expect(state.isDeveloperMode).toBe(false);
    logging.mockRestore();
  });

  it("retains an acknowledged write when a later optimistic write fails", async () => {
    await mount();
    let finishFirst!: (value: unknown) => void;
    let failSecond!: (error: Error) => void;
    mocks.update.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((_, reject) => { failSecond = reject; }));
    const logging = vi.spyOn(console, "error").mockImplementation(() => {});
    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => { first = state.setDeveloperMode(true); });
    await act(async () => { second = state.setDeveloperMode(false); });
    await act(async () => { finishFirst({ success: true }); await first; });
    await act(async () => { failSecond(new Error("Second refused")); await expect(second).rejects.toThrow("Second refused"); });
    expect(state.isDeveloperMode).toBe(true);
    logging.mockRestore();
  });

  it("prevents a later refusal preceding the earlier acknowledgement in the store", async () => {
    await mount();
    let finishFirst!: (value: unknown) => void;
    let failSecond!: (error: Error) => void;
    mocks.update.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((_, reject) => { failSecond = reject; }));
    const logging = vi.spyOn(console, "error").mockImplementation(() => {});
    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => { first = state.setDeveloperMode(true); });
    await act(async () => { second = state.setDeveloperMode(false); });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(state.isDeveloperMode).toBe(false);
    await act(async () => { finishFirst({ success: true }); await first; });
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.update.mock.calls.map(([value]) => value.ui_preferences.developer_mode)).toEqual([true, false]);
    await act(async () => { failSecond(new Error("Second refused")); await expect(second).rejects.toThrow("Second refused"); });
    expect(state.isDeveloperMode).toBe(true);
    logging.mockRestore();
  });
});

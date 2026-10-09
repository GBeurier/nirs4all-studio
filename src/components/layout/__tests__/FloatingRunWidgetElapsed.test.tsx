/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActiveRunContext, type ActiveRunContextValue, type RunProgressState } from "@/context/useActiveRuns";
import { FloatingRunWidget } from "../FloatingRunWidget";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.parse("2026-10-09T12:00:00Z");

function activeRun(overrides: Partial<RunProgressState> = {}): RunProgressState {
  return {
    runId: "run-1", runName: "PLS", status: "running", progress: 40,
    message: "Training", logs: [], updatedAt: NOW,
    startedAt: new Date(NOW - 65_000).toISOString(),
    ...overrides,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(runs: RunProgressState[], overrides: Partial<ActiveRunContextValue> = {}) {
  container = document.createElement("div");
  root = createRoot(container);
  const value: ActiveRunContextValue = {
    activeRuns: runs, hasActiveRuns: runs.length > 0, isMinimized: false,
    getRunProgress: () => undefined, refreshActiveRuns: vi.fn(), toggleMinimized: vi.fn(),
    selectedRunId: null, selectRun: vi.fn(),
    ...overrides,
  };
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={["/datasets"]}>
        <ActiveRunContext.Provider value={value}>
          <FloatingRunWidget />
        </ActiveRunContext.Provider>
      </MemoryRouter>,
    );
  });
  return container;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  container = null;
  vi.useRealTimers();
});

describe("FloatingRunWidget elapsed time", () => {
  it("shows the elapsed time since the run started and ticks once per second", async () => {
    const view = await mount([activeRun()]);
    expect(view.textContent).toContain("01:05");
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(view.textContent).toContain("01:06");

    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(view.textContent).toContain("01:09");
  });

  it("formats runs of an hour or more as h:mm:ss", async () => {
    const view = await mount([activeRun({ startedAt: new Date(NOW - 3_725_000).toISOString() })]);
    expect(view.textContent).toContain("1:02:05");
  });

  it("clears its interval on unmount", async () => {
    await mount([activeRun()]);
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => root!.unmount());
    root = null;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("schedules no timer without an active run", async () => {
    const view = await mount([]);
    expect(view.textContent).toBe("");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("schedules no timer while minimized or when the run has no start timestamp", async () => {
    await mount([activeRun()], { isMinimized: true });
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => root!.unmount());

    const queued = await mount([activeRun({ status: "queued", startedAt: undefined })]);
    expect(vi.getTimerCount()).toBe(0);
    expect(queued.textContent).not.toContain("00:00");
  });
});

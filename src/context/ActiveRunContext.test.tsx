/** @vitest-environment jsdom */
import { act, memo } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { ActiveRunProvider } from "./ActiveRunContext";
import { useActiveRuns, type ActiveRunContextValue } from "./useActiveRuns";

const mocks = vi.hoisted(() => ({ getActiveRuns: vi.fn(), getWorkspaceExecutionJobRecord: vi.fn() }));
vi.mock("@/api/runs", () => mocks);
vi.mock("@/lib/websocket", () => ({ getWebSocketBaseUrl: async () => "ws://localhost" }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class Socket {
  static instances: Socket[] = [];
  onmessage?: (event: { data: string }) => void;
  onopen?: () => void;
  onclose?: () => void;
  onerror?: () => void;
  close = vi.fn(() => this.onclose?.());
  send = vi.fn();
  constructor(public url: string) { Socket.instances.push(this); }
}
beforeAll(async () => {
  await i18n.changeLanguage("en");
});
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  Socket.instances = [];
});

async function mount(runs: Array<{
  id: string; name: string; status: string;
  progress?: number; progress_message?: string; progress_unavailable?: boolean;
}>) {
  vi.stubGlobal("WebSocket", Socket);
  let response = { runs, total: runs.length };
  mocks.getActiveRuns.mockImplementation(async () => structuredClone(response));
  mocks.getWorkspaceExecutionJobRecord.mockResolvedValue({ id: "run-1", run_name: "PLS", status: "completed" });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  const root = createRoot(container);
  let renders = 0;
  let value: ActiveRunContextValue;
  const Consumer = memo(function Consumer() {
    renders += 1;
    value = useActiveRuns();
    return <span>{value.activeRuns.map((run) => `${run.runName}:${run.progress}`).join(",")}</span>;
  });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 5));
  await act(async () => {
    root.render(<MemoryRouter><QueryClientProvider client={client}><ActiveRunProvider><Consumer /></ActiveRunProvider></QueryClientProvider></MemoryRouter>);
    await flush();
  });
  await act(flush);
  cleanups.push(async () => { await act(async () => root.unmount()); client.clear(); });
  return {
    container,
    renders: () => renders,
    value: () => value!,
    poll: async (next = response) => {
      response = next;
      await act(async () => { await client.refetchQueries({ queryKey: ["activeRuns"] }); await flush(); });
    },
    message: async (data: unknown) => act(async () => {
      Socket.instances[0].onmessage?.({ data: JSON.stringify(data) });
    }),
  };
}

describe("active run polling and render cost", () => {
  it("restores unavailable fit progress and heartbeat messages from polls, then real completion", async () => {
    const runs = [{ id: "run-1", name: "RF", status: "running", progress: 0,
      progress_message: "Scientific computation running · 130s elapsed. Fit progress is unavailable.",
      progress_unavailable: true }];
    const app = await mount(runs);
    expect(app.value().getRunProgress("run-1")).toMatchObject({
      progressUnavailable: true, message: runs[0].progress_message,
    });
    const next = { ...runs[0], progress_message: "Scientific computation running · 140s elapsed. Fit progress is unavailable." };
    await app.poll({ runs: [next], total: 1 });
    expect(app.value().getRunProgress("run-1")?.message).toContain("140s");
    expect(app.value().getRunProgress("run-1")?.progressUnavailable).toBe(true);
    await app.message({ type: "job_progress", channel: "job:run-1", data: { progress: 35 } });
    expect(app.value().getRunProgress("run-1")).toMatchObject({ progress: 35, progressUnavailable: false });
    await app.message({ type: "job_completed", channel: "job:run-1", data: {} });
    expect(app.value().getRunProgress("run-1")).toMatchObject({ progress: 100, progressUnavailable: false });
  });

  it("connects directly to the qualified job channel without a subscription command", async () => {
    await mount([{ id: "run-1", name: "PLS", status: "running" }]);
    expect(Socket.instances[0].url).toBe("ws://localhost/ws/job/run-1");
    Socket.instances[0].onopen?.();
    expect(Socket.instances[0].send).not.toHaveBeenCalled();
  });
  it("shows a persistent error dialog on a WebSocket failure and deduplicates it", async () => {
    const app = await mount([{ id: "run-1", name: "PLS", status: "running" }]);
    const message = { type: "job_failed", channel: "job:run-1", data: { error: "ValueError: invalid pipeline" } };
    await app.message(message);
    await app.message(message);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("ValueError: invalid pipeline");
    expect(app.value().getRunProgress("run-1")?.status).toBe("failed");
    await act(async () => {
      (Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Close"))?.click();
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("recovers an error missed by the WebSocket from the terminal run record", async () => {
    const app = await mount([{ id: "run-1", name: "PLS", status: "running" }]);
    mocks.getWorkspaceExecutionJobRecord.mockResolvedValue({ id: "run-1", run_name: "PLS", status: "failed", error: "python_host_process_failed: missing dependency" });
    await app.poll({ runs: [], total: 0 });
    expect(mocks.getWorkspaceExecutionJobRecord).toHaveBeenCalledWith("run-1");
    expect(app.value().getRunProgress("run-1")?.status).toBe("failed");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("missing dependency");
  });

  it("retries a failed terminal read without declaring the run successful", async () => {
    const app = await mount([{ id: "run-1", name: "PLS", status: "running" }]);
    mocks.getWorkspaceExecutionJobRecord.mockRejectedValueOnce(new Error("Connection lost"));
    await app.poll({ runs: [], total: 0 });
    expect(app.value().getRunProgress("run-1")?.status).toBe("running");
    await app.poll({ runs: [], total: 0 });
    expect(app.value().getRunProgress("run-1")?.status).toBe("completed");
    expect(mocks.getWorkspaceExecutionJobRecord).toHaveBeenCalledTimes(2);
  });

  it("does not rerender consumers across 30 unchanged idle polls", async () => {
    const app = await mount([]);
    const initial = app.renders();
    for (let i = 0; i < 30; i++) await app.poll();
    expect(mocks.getActiveRuns).toHaveBeenCalledTimes(31);
    expect(app.renders()).toBe(initial);
  });

  it("ignores changing envelope totals and duplicate progress but publishes real progress", async () => {
    const runs = [{ id: "run-1", name: "PLS", status: "running" }];
    const app = await mount(runs);
    const initial = app.renders();
    for (let total = 2; total < 12; total++) await app.poll({ runs, total });
    await app.message({ type: "job_progress", channel: "job:run-1", data: { progress: 0 } });
    expect(app.renders()).toBe(initial);
    expect(Socket.instances).toHaveLength(1);
    await app.message({ type: "job_progress", channel: "job:run-1", data: { progress: 42 } });
    expect(app.container.textContent).toBe("PLS:42");
    expect(app.renders()).toBe(initial + 1);
    await app.poll({ runs: [], total: 0 });
    expect(app.value().hasActiveRuns).toBe(false);
    expect(Socket.instances[0].close).toHaveBeenCalledTimes(1);
  });
});

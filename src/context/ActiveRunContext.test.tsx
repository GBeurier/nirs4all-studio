/** @vitest-environment jsdom */
import { act, memo } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActiveRunProvider } from "./ActiveRunContext";
import { useActiveRuns, type ActiveRunContextValue } from "./useActiveRuns";

const mocks = vi.hoisted(() => ({ getActiveRuns: vi.fn(), getRun: vi.fn() }));
vi.mock("@/api/runs", () => ({ getActiveRuns: mocks.getActiveRuns, getRun: mocks.getRun }));
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
  constructor() { Socket.instances.push(this); }
}
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  Socket.instances = [];
});

async function mount(runs: Array<{ id: string; name: string; status: string }>) {
  vi.stubGlobal("WebSocket", Socket);
  let response = { runs, total: runs.length };
  mocks.getActiveRuns.mockImplementation(async () => structuredClone(response));
  mocks.getRun.mockImplementation(async (id) => ({ id, status: "completed", datasets: [] }));
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
    root.render(<QueryClientProvider client={client}><ActiveRunProvider><Consumer /></ActiveRunProvider></QueryClientProvider>);
    await flush();
  });
  await act(flush);
  cleanups.push(async () => { await act(async () => root.unmount()); client.clear(); });
  return {
    container,
    client,
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

  it.each(["failed", "partial"])("resolves a disappeared run as %s and refreshes stored results", async (status) => {
    const app = await mount([{ id: "run-1", name: "PLS", status: "running" }]);
    const invalidate = vi.spyOn(app.client, "invalidateQueries");
    mocks.getRun.mockResolvedValue({
      id: "run-1", status, datasets: [{ pipelines: [{ error_message: "One model could not fit" }] }],
    });
    await app.message({ type: "job_progress", channel: "job:run-1", data: { progress: 42 } });
    await app.poll({ runs: [], total: 0 });
    expect(mocks.getRun).toHaveBeenCalledExactlyOnceWith("run-1");
    expect(app.value().getRunProgress("run-1")).toMatchObject({ status, progress: 42, message: "One model could not fit" });
    expect(app.value().hasActiveRuns).toBe(false);
    for (const key of ["results-summary", "aggregated-predictions", "dataset-all-chains", "runs"]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] });
    }
    expect(invalidate.mock.calls.some(([options]) => typeof options?.predicate === "function")).toBe(true);
    for (let index = 0; index < 5; index++) await app.poll();
    expect(mocks.getRun).toHaveBeenCalledTimes(1);
  });

  it.each(["job_failed", "job_cancelled"])("preserves the error from %s without displaying success", async (type) => {
    const app = await mount([{ id: "run-1", name: "PLS", status: "running" }]);
    const reason = type === "job_cancelled" ? "Cancelled by user" : "Invalid model parameters";
    mocks.getRun.mockResolvedValue({ id: "run-1", status: "failed", datasets: [{ pipelines: [{ error_message: reason }] }] });
    await app.message({ type, channel: "job:run-1", data: { error: reason } });
    expect(app.value().getRunProgress("run-1")).toMatchObject({ status: "failed", progress: 0, message: reason });
    await app.poll({ runs: [], total: 0 });
    expect(mocks.getRun).toHaveBeenCalledTimes(1);
    expect(app.value().getRunProgress("run-1")?.status).toBe("failed");
  });

  it("does not turn a completed job with partial scientific results into run success", async () => {
    const app = await mount([{ id: "run-1", name: "PLS", status: "running" }]);
    mocks.getRun.mockResolvedValue({ id: "run-1", status: "partial", datasets: [] });
    await app.message({ type: "job_completed", channel: "job:run-1", data: { result: { status: "partial" } } });
    expect(app.value().getRunProgress("run-1")).toMatchObject({ status: "partial", progress: 0, message: "Run partially completed" });
  });

  it("bounds failed status checks and never invents success while offline", async () => {
    const app = await mount([{ id: "run-1", name: "PLS", status: "running" }]);
    mocks.getRun.mockRejectedValue(new Error("Connection unavailable"));
    await app.poll({ runs: [], total: 0 });
    expect(app.value().getRunProgress("run-1")?.status).toBe("running");
    await act(async () => {
      await vi.waitFor(() => expect(mocks.getRun).toHaveBeenCalledTimes(3), { timeout: 4000 });
    });
    expect(app.value().getRunProgress("run-1")).toMatchObject({ status: "running", progress: 0 });
    expect(app.value().getRunProgress("run-1")?.message).toContain("Unable to confirm final run status");
    for (let index = 0; index < 10; index++) await app.poll();
    expect(mocks.getRun).toHaveBeenCalledTimes(3);
  });
});

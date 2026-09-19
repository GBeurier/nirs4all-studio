/** @vitest-environment jsdom */
import { act, memo } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActiveRunProvider } from "./ActiveRunContext";
import { useActiveRuns, type ActiveRunContextValue } from "./useActiveRuns";

const mocks = vi.hoisted(() => ({ getActiveRuns: vi.fn() }));
vi.mock("@/api/runs", () => ({ getActiveRuns: mocks.getActiveRuns }));
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
});

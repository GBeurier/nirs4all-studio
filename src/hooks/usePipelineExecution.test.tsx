/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePipelineExecution } from "./usePipelineExecution";
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), updates: { status: null as string | null, progress: 0, progressMessage: "", error: null as string | null } }));
vi.mock("@/hooks/useWebSocket", () => ({ useJobUpdates: () => ({ isConnected: false, metrics: {}, result: null, ...mocks.updates }) }));
vi.mock("@/api/transport", async () => ({
  ...await vi.importActual<typeof import("@/api/transport")>("@/api/transport"), api: mocks,
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let state: ReturnType<typeof usePipelineExecution>;
let cleanup: (() => Promise<void>) | undefined;
let refresh: () => Promise<void>;
beforeEach(() => {
  vi.resetAllMocks(); mocks.post.mockResolvedValue({ success: true, job_id: "job-1" });
  Object.assign(mocks.updates, { status: null, progress: 0, progressMessage: "", error: null });
});
afterEach(async () => { await cleanup?.(); });
async function start() {
  const root = createRoot(document.createElement("div"));
  function Consumer() { state = usePipelineExecution(); return null; }
  refresh = async () => { await act(async () => root.render(<Consumer />)); };
  await act(async () => root.render(<Consumer />));
  cleanup = async () => { await act(async () => root.unmount()); };
  await act(async () => { await state.execute({ pipelineId: "pls", datasetId: "amylose", exportModel: true }); });
  await act(async () => { await Promise.resolve(); });
}
it("recovers a failure that occurred before the WebSocket subscription", async () => {
  mocks.get.mockResolvedValue({ status: "failed", progress: 0, progress_message: "", error: "Invalid n_components: 9000" });
  await start();
  expect(mocks.get).toHaveBeenCalledWith("/training/job-1");
  expect(state.status).toBe("failed");
  expect(state.error).toBe("Invalid n_components: 9000");
});
it("recovers real completion without receiving a socket event", async () => {
  mocks.get.mockResolvedValue({ status: "completed", progress: 100, progress_message: "Done" });
  await start(); expect(state.status).toBe("completed"); expect(state.progress).toBe(100);
});
it("keeps cancellation failures visible and waits for terminal acknowledgement", async () => {
  mocks.get.mockResolvedValue({ status: "running", progress: 0, progress_message: "Calculating" });
  await start();
  mocks.post.mockRejectedValueOnce({ status: 503, detail: "Cancellation refused" });
  await act(async () => state.cancel());
  expect(state.error).toBe("Cancellation refused"); expect(state.status).toBe("running");
  mocks.post.mockResolvedValueOnce({ success: true });
  await act(async () => state.cancel());
  expect(state.status).toBe("running");
});
it("treats the native cancellation event as cancellation instead of failure", async () => {
  mocks.get.mockResolvedValue({ status: "running", progress: 0, progress_message: "Calculating" });
  await start();
  Object.assign(mocks.updates, { status: "failed", error: "Job was cancelled" });
  await refresh();
  expect(state.status).toBe("cancelled"); expect(state.error).toBeNull();
});
it("accepts newer WebSocket progress after a poll and shows completed progress", async () => {
  mocks.get.mockResolvedValue({ status: "running", progress: 10, progress_message: "Started" });
  await start(); expect(state.progress).toBe(10);
  Object.assign(mocks.updates, { status: "running", progress: 60, progressMessage: "Training" });
  await refresh(); expect(state.progress).toBe(60);
  Object.assign(mocks.updates, { status: "completed", progress: 100 });
  await refresh(); expect(state.progress).toBe(100); expect(state.status).toBe("completed");
});

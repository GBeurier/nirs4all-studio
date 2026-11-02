/** @vitest-environment jsdom */
import i18n from "@/lib/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import RunProgress from "./RunProgress";

const mocks = vi.hoisted(() => ({
  record: vi.fn(), detail: vi.fn(), stop: vi.fn(), logs: vi.fn(), error: vi.fn(),
}));
vi.mock("@/api/runs", () => ({ getWorkspaceExecutionJobRecord: mocks.record, stopRun: mocks.stop }));
vi.mock("@/api/linkedWorkspaces", () => ({ getN4AWorkspaceRunDetail: mocks.detail, getWorkspaceRunPipelineLogs: mocks.logs }));
vi.mock("@/hooks/useDatasetQueries", () => ({ useLinkedWorkspacesQuery: () => ({ data: { active_workspace_id: "workspace" } }) }));
vi.mock("@/lib/run-progress", async () => ({
  ...await vi.importActual<typeof import("@/lib/run-progress")>("@/lib/run-progress"), useRunWebSocket: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: vi.fn() } }));
vi.mock("@/components/runs/RunProgressSections", () => ({
  RunProgressHeader: ({ run, onStop }: { run: { name: string; status: string }; onStop: () => void }) =>
    <div>{run.name} {run.status}{run.status === "running" && <button onClick={onStop}>Stop run</button>}</div>,
  ProgressOverviewCard: () => null,
  RunStatsGrid: ({ totalPipelines }: { totalPipelines: number }) => <span>{totalPipelines} pipelines</span>,
  PipelinesColumn: () => null, RunSidePanel: () => null,
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const job = {
  job_id: "run_native_test", status: "running", created_at: "2026-11-02T10:00:00Z", progress: 0,
  progress_message: "Calculating", request: { legacyConfig: { name: "Amylose PLS", dataset_ids: ["amylose"] } }, driver: {},
};
const cleanups: Array<() => Promise<void>> = [];
beforeAll(async () => { await i18n.changeLanguage("en"); });
beforeEach(() => { vi.resetAllMocks(); mocks.record.mockResolvedValue(job); mocks.logs.mockResolvedValue({ logs: [] }); });
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const container = document.createElement("div");
  const root = createRoot(container);
  const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); }); };
  await act(async () => root.render(<MemoryRouter initialEntries={["/runs/run_native_test"]}>
    <QueryClientProvider client={client}><Routes><Route path="/runs/:id" element={<RunProgress />} /></Routes></QueryClientProvider>
  </MemoryRouter>));
  cleanups.push(async () => { await act(async () => root.unmount()); client.clear(); });
  return { container, flush };
}
it("loads the job directly before a scientific run exists, keeping stop available", async () => {
  const view = await mount(); await view.flush();
  expect(mocks.record).toHaveBeenCalledWith("run_native_test");
  expect(mocks.detail).not.toHaveBeenCalled();
  expect(view.container.textContent).toContain("Amylose PLS running");
  mocks.stop.mockRejectedValue({ status: 503, detail: "The selected executor refused cancellation" });
  await act(async () => view.container.querySelector("button")!.click());
  expect(mocks.stop).toHaveBeenCalledWith("run_native_test");
  expect(mocks.error).toHaveBeenCalledWith("Failed to stop run", { description: "The selected executor refused cancellation" });
});
it("shows loading until the native job snapshot arrives", async () => {
  let resolve!: (value: typeof job) => void;
  mocks.record.mockReturnValue(new Promise(r => { resolve = r; }));
  const view = await mount();
  expect(view.container.textContent).toContain("Loading run");
  expect(view.container.textContent).not.toContain("Run not found");
  await act(async () => resolve(job)); await view.flush();
  expect(view.container.textContent).toContain("Amylose PLS running");
});
it("loads actual saved pipelines when the job completes", async () => {
  mocks.record.mockResolvedValue({ ...job, status: "completed", driver: { store_run_ids: ["stored-run"] } });
  mocks.detail.mockResolvedValue({ run_id: "stored-run", name: "Amylose PLS", status: "completed", created_at: job.created_at,
    datasets: [{ name: "Amylose", linked_dataset_id: "amylose" }],
    pipelines: [{ pipeline_id: "pls", name: "PLS-Sweep", dataset_name: "Amylose", status: "completed", metric: "rmse", best_val: 2.63, best_test: 3.55 }],
  });
  const view = await mount(); await view.flush(); await view.flush();
  expect(mocks.detail).toHaveBeenCalledWith("workspace", "stored-run");
  expect(view.container.textContent).toContain("1 pipelines");
  expect(mocks.logs).toHaveBeenCalledWith("workspace", "stored-run", "pls");
});
it("shows the scientific failure", async () => {
  mocks.record.mockResolvedValue({ ...job, status: "failed", error: "Invalid n_components: 9000" });
  const view = await mount(); await view.flush();
  expect(view.container.textContent).toContain("Invalid n_components: 9000");
});
it("preserves cancellation as a separate terminal status", async () => {
  mocks.record.mockResolvedValue({ ...job, status: "cancelled", error: "Job was cancelled" });
  const view = await mount(); await view.flush();
  expect(view.container.textContent).toContain("Amylose PLS cancelled");
  expect(view.container.querySelector('[role="alert"]')).toBeNull();
});

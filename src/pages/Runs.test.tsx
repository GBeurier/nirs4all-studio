/**
 * @vitest-environment jsdom
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listRuns: vi.fn(),
  getEnrichedRuns: vi.fn(),
  useLinkedWorkspacesQuery: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/api/runs", async () => {
  const actual = await vi.importActual<typeof import("@/api/runs")>("@/api/runs");
  return {
    ...actual,
    listRuns: mocks.listRuns,
  };
});

vi.mock("@/api/enrichedRuns", async () => {
  const actual = await vi.importActual<typeof import("@/api/enrichedRuns")>("@/api/enrichedRuns");
  return {
    ...actual,
    getEnrichedRuns: mocks.getEnrichedRuns,
  };
});

vi.mock("@/hooks/useDatasetQueries", () => ({
  useLinkedWorkspacesQuery: mocks.useLinkedWorkspacesQuery,
}));

vi.mock("@/components/scores/MetricSelector", () => ({
  MetricSelector: () => null,
}));

vi.mock("@/components/scores/useMetricSelection", () => ({
  useMetricSelection: () => [[], vi.fn()],
}));

vi.mock("@/components/runs/ProjectFilter", () => ({
  ProjectFilter: () => null,
}));

vi.mock("@/components/ui/tooltip", () => {
  const PassThrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Tooltip: PassThrough,
    TooltipProvider: PassThrough,
    TooltipTrigger: PassThrough,
    TooltipContent: PassThrough,
  };
});

import Runs from "./Runs";
import { RunsExecutionJobRecordDialog, RunsExecutionTasksPanel } from "./RunsSections";
import type { ExecutionJobRecord } from "@/lib/runs/executionJobRecords";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

type RunsExecutionTasksPanelData = Parameters<typeof RunsExecutionTasksPanel>[0]["data"];

function executionJobRecord(overrides: Partial<ExecutionJobRecord> = {}): ExecutionJobRecord {
  return {
    job_id: "job-1",
    job_type: "training",
    requested_backend: "cluster",
    execution_backend: "local-python",
    execution_mode: "in-process",
    status: "running",
    progress: 25,
    progress_message: "training",
    created_at: "2026-06-30T10:00:00Z",
    started_at: null,
    completed_at: null,
    request: {
      run_id: "run-1",
      requested_backend: "cluster",
    },
    driver: {
      backend: "local-python",
      mode: "in-process",
    },
    metrics: {},
    error: null,
    run_id: "run-1",
    run_name: "Calibration run",
    run_status: "running",
    is_orphaned: false,
    ...overrides,
  };
}

function findDialogButton(labelPattern: RegExp): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll("button"))
    .find((button) => {
      const label = `${button.textContent ?? ""} ${button.getAttribute("aria-label") ?? ""}`;
      return labelPattern.test(label);
    });
}

function findEnabledDialogButton(labelPattern: RegExp): HTMLButtonElement | undefined {
  const button = findDialogButton(labelPattern);
  return button && !button.disabled ? button : undefined;
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

async function renderPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = createQueryClient();

  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Runs />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });

  return {
    container,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      client.clear();
    },
  };
}

async function renderNode(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<>{node}</>);
  });

  return {
    container,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

async function waitFor(assertion: () => void, timeoutMs: number = 1000): Promise<void> {
  const start = Date.now();
  while (true) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() - start >= timeoutMs) {
        throw error;
      }
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
  }
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("Runs page", () => {
  it("renders run rows when enriched runs are available", async () => {
    mocks.useLinkedWorkspacesQuery.mockReturnValue({
      data: { active_workspace_id: "ws-1" },
    });
    mocks.listRuns.mockResolvedValue({ runs: [] });
    mocks.getEnrichedRuns.mockResolvedValue({
      runs: [
        {
          run_id: "run-001",
          name: "Regression history run",
          status: "completed",
          project_id: null,
          created_at: "2026-04-17T08:00:00Z",
          completed_at: "2026-04-17T08:10:00Z",
          duration_seconds: 600,
          artifact_size_bytes: 1024,
          datasets_count: 1,
          pipeline_runs_count: 2,
          final_models_count: 1,
          total_models_trained: 2,
          total_folds: 10,
          datasets: [
            {
              dataset_name: "corn",
              best_avg_val_score: 0.91,
              best_avg_test_score: 0.9,
              best_final_score: 0.92,
              metric: "r2",
              task_type: "regression",
              gain_from_previous_best: null,
              pipeline_count: 2,
              top_5: [],
              n_samples: 50,
              n_features: 120,
            },
          ],
          model_classes: [{ name: "PLS", count: 2 }],
        },
      ],
      total: 1,
    });

    const view = await renderPage();

    await waitFor(() => {
      expect(view.container.textContent).toContain("Regression history run");
    });

    await view.unmount();
  });

  it("shows an explicit error when loading enriched runs fails", async () => {
    mocks.useLinkedWorkspacesQuery.mockReturnValue({
      data: { active_workspace_id: "ws-1" },
    });
    mocks.listRuns.mockResolvedValue({ runs: [] });
    mocks.getEnrichedRuns.mockRejectedValue({
      detail: "name '_class_name_from_path' is not defined",
      status: 500,
    });

    const view = await renderPage();

    await waitFor(() => {
      expect(view.container.textContent).toContain("Failed to load run history");
      expect(view.container.textContent).toContain("name '_class_name_from_path' is not defined");
    });

    await view.unmount();
  });

  it("inspects any execution task by job id, not only orphaned tasks", async () => {
    const inspectJob = vi.fn();
    const data: RunsExecutionTasksPanelData = {
      hasTasks: true,
      totalCount: 2,
      activeCount: 1,
      completedCount: 1,
      failedCount: 0,
      remoteRequestedCount: 1,
      groups: [],
      items: [
        {
          jobId: "cluster-job-99",
          runId: "known-run-99",
          runName: "Known cluster run",
          runStatus: "running",
          requestedBackend: "cluster",
          executionBackend: "local-python",
          executionStatus: "running",
          progress: 45,
          progressMessage: "training",
          progressUnavailable: false,
          isActive: true,
          isOrphaned: false,
          isRemoteRequested: true,
          createdAt: "2026-06-30T10:00:00Z",
          startedAt: "2026-06-30T10:01:00Z",
          completedAt: null,
        },
        {
          jobId: "orphan-job-100",
          runId: "orphan-run-100",
          runName: "Orphaned scheduler job",
          runStatus: "orphaned",
          requestedBackend: "cluster",
          executionBackend: "cluster",
          executionStatus: "completed",
          progress: 100,
          progressMessage: "done",
          progressUnavailable: false,
          isActive: false,
          isOrphaned: true,
          isRemoteRequested: true,
          createdAt: "2026-06-30T09:00:00Z",
          startedAt: "2026-06-30T09:01:00Z",
          completedAt: "2026-06-30T09:10:00Z",
        },
      ],
    };
    const view = await renderNode(
      <RunsExecutionTasksPanel
        data={data}
        onInspectJob={inspectJob}
      />,
    );

    const inspectButtons = Array.from(view.container.querySelectorAll("button"));
    expect(inspectButtons).toHaveLength(2);

    await act(async () => {
      inspectButtons[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(inspectJob).toHaveBeenCalledTimes(1);
    expect(inspectJob).toHaveBeenCalledWith("cluster-job-99");
    expect(inspectJob).not.toHaveBeenCalledWith("known-run-99");

    await view.unmount();
  });

  it("shows unavailable execution telemetry explicitly instead of a bare percentage", async () => {
    const data: RunsExecutionTasksPanelData = {
      hasTasks: true,
      totalCount: 1,
      activeCount: 1,
      completedCount: 0,
      failedCount: 0,
      remoteRequestedCount: 1,
      groups: [],
      items: [
        {
          jobId: "cluster-job-no-telemetry",
          runId: "run-no-telemetry",
          runName: "Cluster run without telemetry",
          runStatus: "running",
          requestedBackend: "cluster",
          executionBackend: "local-python",
          executionStatus: "running",
          progress: 0,
          progressMessage: "Progress unavailable",
          progressUnavailable: true,
          isActive: true,
          isOrphaned: false,
          isRemoteRequested: true,
          createdAt: "2026-06-30T10:00:00Z",
          startedAt: "2026-06-30T10:01:00Z",
          completedAt: null,
        },
      ],
    };
    const view = await renderNode(
      <RunsExecutionTasksPanel
        data={data}
        onInspectJob={vi.fn()}
      />,
    );

    const text = view.container.textContent ?? "";
    expect(text).toContain("Progress unavailable");
    expect(text).toContain("Telemetry unavailable");
    expect(text).not.toContain("0%");

    await view.unmount();
  });

  it("renders a same-run execution task group and inspects each grouped job id", async () => {
    const inspectJob = vi.fn();
    const predictionItem: RunsExecutionTasksPanelData["items"][number] = {
      jobId: "prediction-job",
      runId: "multi-run",
      runName: "Multi job run",
      runStatus: "running",
      requestedBackend: "cluster",
      executionBackend: "local-python",
      executionStatus: "running",
      progress: 35,
      progressMessage: "batch prediction",
      progressUnavailable: false,
      isActive: true,
      isOrphaned: false,
      isRemoteRequested: true,
      createdAt: "2026-06-30T10:05:00Z",
      startedAt: "2026-06-30T10:06:00Z",
      completedAt: null,
    };
    const exportItem: RunsExecutionTasksPanelData["items"][number] = {
      jobId: "export-job",
      runId: "multi-run",
      runName: "Multi job run",
      runStatus: "running",
      requestedBackend: "cluster",
      executionBackend: "cluster",
      executionStatus: "failed",
      progress: 10,
      progressMessage: "export failed",
      progressUnavailable: false,
      isActive: false,
      isOrphaned: false,
      isRemoteRequested: true,
      createdAt: "2026-06-30T10:03:00Z",
      startedAt: "2026-06-30T10:03:30Z",
      completedAt: "2026-06-30T10:04:00Z",
    };
    const data: RunsExecutionTasksPanelData = {
      hasTasks: true,
      totalCount: 2,
      activeCount: 1,
      completedCount: 0,
      failedCount: 1,
      remoteRequestedCount: 2,
      groups: [
        {
          groupId: "multi-run",
          runId: "multi-run",
          runName: "Multi job run",
          runStatus: "running",
          isOrphaned: false,
          totalCount: 2,
          activeCount: 1,
          completedCount: 0,
          failedCount: 1,
          remoteRequestedCount: 2,
          latestItem: predictionItem,
          items: [predictionItem, exportItem],
        },
      ],
      items: [predictionItem, exportItem],
    };
    const view = await renderNode(
      <RunsExecutionTasksPanel
        data={data}
        onInspectJob={inspectJob}
      />,
    );

    expect(view.container.textContent).toContain("Multi job run");
    expect(view.container.textContent).toContain("Grouped jobs");
    expect(view.container.textContent).toContain("2 jobs");
    expect(view.container.textContent).toContain("1 active");
    expect(view.container.textContent).toContain("1 failed");
    expect(view.container.textContent).toContain("batch prediction");
    expect(view.container.textContent).toContain("export failed");

    const findGroupedInspectButton = (jobId: string) => {
      const button = Array.from(view.container.querySelectorAll("button"))
        .find((candidate) => candidate.textContent?.includes(`Inspect execution job ${jobId}`));
      expect(button).toBeTruthy();
      return button!;
    };
    const inspectButtons = [
      findGroupedInspectButton("prediction-job"),
      findGroupedInspectButton("export-job"),
    ];

    await act(async () => {
      inspectButtons[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      inspectButtons[1]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(inspectJob.mock.calls).toEqual([
      ["prediction-job"],
      ["export-job"],
    ]);
    expect(inspectJob).not.toHaveBeenCalledWith("multi-run");

    await view.unmount();
  });

  it("expands a large execution task group before inspecting jobs beyond the first three", async () => {
    const inspectJob = vi.fn();
    const groupItems: RunsExecutionTasksPanelData["items"] = Array.from({ length: 5 }, (_, index) => {
      const jobNumber = index + 1;
      return {
        jobId: `fold-job-${jobNumber}`,
        runId: "fold-sweep-run",
        runName: "Fold sweep run",
        runStatus: "running",
        requestedBackend: "cluster",
        executionBackend: "cluster",
        executionStatus: `fold_job_${jobNumber}`,
        progress: index < 3 ? 100 : 0,
        progressMessage: `fold job ${jobNumber}`,
        progressUnavailable: false,
        isActive: index >= 3,
        isOrphaned: false,
        isRemoteRequested: true,
        createdAt: `2026-06-30T10:0${index}:00Z`,
        startedAt: index < 4 ? `2026-06-30T10:0${index}:30Z` : null,
        completedAt: index < 3 ? `2026-06-30T10:0${index + 1}:00Z` : null,
      };
    });
    const data: RunsExecutionTasksPanelData = {
      hasTasks: true,
      totalCount: groupItems.length,
      activeCount: 2,
      completedCount: 3,
      failedCount: 0,
      remoteRequestedCount: groupItems.length,
      groups: [
        {
          groupId: "fold-sweep-run",
          runId: "fold-sweep-run",
          runName: "Fold sweep run",
          runStatus: "running",
          isOrphaned: false,
          totalCount: groupItems.length,
          activeCount: 2,
          completedCount: 3,
          failedCount: 0,
          remoteRequestedCount: groupItems.length,
          latestItem: groupItems[0]!,
          items: groupItems,
        },
      ],
      items: [],
    };
    const view = await renderNode(
      <RunsExecutionTasksPanel
        data={data}
        onInspectJob={inspectJob}
      />,
    );

    const findGroupedInspectButton = (jobId: string) => Array.from(view.container.querySelectorAll("button"))
      .find((candidate) => candidate.textContent?.includes(`Inspect execution job ${jobId}`));

    expect(view.container.textContent).toContain("Fold job 1");
    expect(view.container.textContent).toContain("Fold job 2");
    expect(view.container.textContent).toContain("Fold job 3");
    expect(view.container.textContent).not.toContain("Fold job 4");
    expect(view.container.textContent).not.toContain("Fold job 5");
    expect(view.container.textContent).toContain("+2 more");
    expect(findGroupedInspectButton("fold-job-1")).toBeTruthy();
    expect(findGroupedInspectButton("fold-job-2")).toBeTruthy();
    expect(findGroupedInspectButton("fold-job-3")).toBeTruthy();
    expect(findGroupedInspectButton("fold-job-4")).toBeUndefined();

    const expansionControl = Array.from(view.container.querySelectorAll("button"))
      .find((candidate) => {
        const label = `${candidate.textContent ?? ""} ${candidate.getAttribute("aria-label") ?? ""}`;
        return /\+2 more|show.*more|expand/i.test(label);
      });
    expect(expansionControl, "expected a control to expand remaining grouped jobs").toBeTruthy();

    await act(async () => {
      expansionControl!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(view.container.textContent).toContain("Fold job 4");
    expect(view.container.textContent).toContain("Fold job 5");

    const fourthJobButton = findGroupedInspectButton("fold-job-4");
    expect(fourthJobButton).toBeTruthy();

    await act(async () => {
      fourthJobButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(inspectJob).toHaveBeenCalledWith("fold-job-4");
    expect(inspectJob).not.toHaveBeenCalledWith("fold-sweep-run");

    const collapseControl = Array.from(view.container.querySelectorAll("button"))
      .find((candidate) => {
        const label = `${candidate.textContent ?? ""} ${candidate.getAttribute("aria-label") ?? ""}`;
        return /show fewer|collapse/i.test(label);
      });
    expect(collapseControl, "expected a control to collapse expanded grouped jobs").toBeTruthy();

    await act(async () => {
      collapseControl!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(view.container.textContent).not.toContain("Fold job 4");
    expect(view.container.textContent).not.toContain("Fold job 5");
    expect(findGroupedInspectButton("fold-job-4")).toBeUndefined();

    await view.unmount();
  });

  it("triggers job cancellation from an active execution job detail", async () => {
    const cancelJob = vi.fn();
    const retryRun = vi.fn();
    const view = await renderNode(
      <RunsExecutionJobRecordDialog
        open
        onOpenChange={vi.fn()}
        jobId="job-1"
        record={executionJobRecord({
          job_id: "job-1",
          run_id: "run-1",
          status: "running",
        })}
        isLoading={false}
        errorMessage={null}
        onCancelJob={cancelJob}
        onRetryRun={retryRun}
      />,
    );

    const cancelButton = findEnabledDialogButton(/\bcancel\b/i);
    expect(cancelButton, "expected an enabled cancel control for a linked running job").toBeTruthy();

    await act(async () => {
      cancelButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(cancelJob).toHaveBeenCalledTimes(1);
    expect(cancelJob).toHaveBeenCalledWith("job-1");
    expect(retryRun).not.toHaveBeenCalled();

    await view.unmount();
  });

  it.each([
    ["failed", "run-2"],
    ["cancelled", "run-3"],
  ] as const)("triggers run retry from a %s execution job detail", async (status, runId) => {
    const cancelJob = vi.fn();
    const retryRun = vi.fn();
    const view = await renderNode(
      <RunsExecutionJobRecordDialog
        open
        onOpenChange={vi.fn()}
        jobId={`job-${status}`}
        record={executionJobRecord({
          job_id: `job-${status}`,
          run_id: runId,
          status,
          run_status: status,
          error: status === "failed" ? "Worker failed" : null,
        })}
        isLoading={false}
        errorMessage={null}
        onCancelJob={cancelJob}
        onRetryRun={retryRun}
      />,
    );

    const retryButton = findEnabledDialogButton(/\bretry\b/i);
    expect(retryButton, `expected an enabled retry control for a linked ${status} job`).toBeTruthy();

    await act(async () => {
      retryButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(retryRun).toHaveBeenCalledTimes(1);
    expect(retryRun).toHaveBeenCalledWith(runId);
    expect(cancelJob).not.toHaveBeenCalled();

    await view.unmount();
  });

  it.each([
    [
      "orphaned failed record",
      { job_id: "orphan-failed-job", run_id: "orphan-run", is_orphaned: true, status: "failed", run_status: "failed" },
    ],
    [
      "cancelled record without run id",
      { job_id: "missing-run-cancelled-job", run_id: "", status: "cancelled", run_status: "cancelled" },
    ],
  ] as const)("keeps %s read-only for run actions", async (_label, overrides) => {
    const cancelJob = vi.fn();
    const retryRun = vi.fn();
    const record = executionJobRecord(overrides);
    const view = await renderNode(
      <RunsExecutionJobRecordDialog
        open
        onOpenChange={vi.fn()}
        jobId={record.job_id}
        record={record}
        isLoading={false}
        errorMessage={null}
        onCancelJob={cancelJob}
        onRetryRun={retryRun}
      />,
    );

    expect(document.body.textContent).toContain("Worker logs");
    expect(findEnabledDialogButton(/\bcancel\b/i)).toBeUndefined();
    expect(findEnabledDialogButton(/\bretry\b/i)).toBeUndefined();

    await act(async () => {
      findDialogButton(/\bcancel\b/i)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      findDialogButton(/\bretry\b/i)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(cancelJob).not.toHaveBeenCalled();
    expect(retryRun).not.toHaveBeenCalled();

    await view.unmount();
  });

  it.each([
    [
      "orphaned running record",
      { job_id: "orphan-running-job", run_id: "orphan-run", is_orphaned: true, status: "running", run_status: "running" },
      "orphan-running-job",
    ],
    [
      "running record without run id",
      { job_id: "missing-run-running-job", run_id: "", status: "running", run_status: "running" },
      "missing-run-running-job",
    ],
  ] as const)("cancels %s by job id", async (_label, overrides, expectedJobId) => {
    const cancelJob = vi.fn();
    const retryRun = vi.fn();
    const record = executionJobRecord(overrides);
    const view = await renderNode(
      <RunsExecutionJobRecordDialog
        open
        onOpenChange={vi.fn()}
        jobId={record.job_id}
        record={record}
        isLoading={false}
        errorMessage={null}
        onCancelJob={cancelJob}
        onRetryRun={retryRun}
      />,
    );

    const cancelButton = findEnabledDialogButton(/\bcancel\b/i);
    expect(cancelButton, "expected an enabled cancel control for an active job").toBeTruthy();
    expect(findEnabledDialogButton(/\bretry\b/i)).toBeUndefined();

    await act(async () => {
      cancelButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(cancelJob).toHaveBeenCalledTimes(1);
    expect(cancelJob).toHaveBeenCalledWith(expectedJobId);
    expect(retryRun).not.toHaveBeenCalled();

    await view.unmount();
  });
});

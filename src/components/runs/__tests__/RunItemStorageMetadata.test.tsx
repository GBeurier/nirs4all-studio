/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { RunItem } from "../RunItem";
import type { EnrichedRun } from "@/types/enriched-runs";

vi.mock("@/components/scores/DatasetResultCard", () => ({
  DatasetResultCard: () => null,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let mountedContainers: HTMLDivElement[] = [];
let mountedClients: QueryClient[] = [];

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

async function render(element: ReactNode, queryClient = createQueryClient()) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  mountedContainers.push(container);
  mountedClients.push(queryClient);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          {element}
        </TooltipProvider>
      </QueryClientProvider>,
    );
  });

  return { container, root };
}

afterEach(() => {
  for (const client of mountedClients) {
    client.clear();
  }
  mountedClients = [];

  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers = [];
  vi.clearAllMocks();
});

function run(overrides: Partial<EnrichedRun> & Record<string, unknown> = {}): EnrichedRun & Record<string, unknown> {
  return {
    run_id: "repository-run",
    name: "Repository run",
    status: "completed",
    project_id: null,
    created_at: "2026-04-17T08:00:00Z",
    completed_at: "2026-04-17T08:10:00Z",
    duration_seconds: 600,
    artifact_size_bytes: 1536,
    datasets_count: 0,
    pipeline_runs_count: 2,
    final_models_count: 1,
    total_models_trained: 2,
    total_folds: 10,
    datasets: [],
    artifact_count: 3,
    config: {
      execution_backend: "cluster",
    },
    manifest_path: "/workspace/runs/repository-run/manifest.json",
    repository_id: "repo-1",
    run_dir: "/workspace/runs/repository-run",
    storage_backend: "result-repository",
    store_run_id: "store-repository-run",
    workspace_id: "workspace-1",
    ...overrides,
  };
}

describe("RunItem storage metadata", () => {
  it("renders UI-ready artifact, storage, and provenance fields from the run page data model", async () => {
    const { container, root } = await render(
      <RunItem
        run={run()}
        onViewDetails={vi.fn()}
        workspaceId="workspace-1"
      />,
    );

    expect(container.textContent).toContain("1.5 KB");

    const title = container.querySelector("h3");
    expect(title).not.toBeNull();

    await act(async () => {
      title!.click();
    });

    expect(container.textContent).toContain("Artifacts");
    expect(container.textContent).toContain("3 artifacts");
    expect(container.textContent).toContain("Artifact size");
    expect(container.textContent).toContain("1.5 KB");
    expect(container.textContent).toContain("Execution backend");
    expect(container.textContent).toContain("Cluster");
    expect(container.textContent).toContain("Storage backend");
    expect(container.textContent).toContain("Result repository");
    expect(container.textContent).toContain("Store run ID");
    expect(container.textContent).toContain("store-repository-run");
    expect(container.textContent).toContain("Manifest path");
    expect(container.textContent).toContain("/workspace/runs/repository-run/manifest.json");

    await act(async () => {
      root.unmount();
    });
  });

  it("renders durable execution job indicators when provided", async () => {
    const { container, root } = await render(
      <RunItem
        run={run()}
        onViewDetails={vi.fn()}
        workspaceId="workspace-1"
        executionJob={{
          latestJobId: "job-1",
          requestedBackend: "cluster",
          executionBackend: "local-python",
          executionStatus: "running",
          progress: 47,
          progressMessage: "training fold 2",
          progressUnavailable: false,
          hasDurableRecord: true,
          jobCount: 1,
          activeJobCount: 1,
          failedJobCount: 0,
          hasMultipleJobs: false,
        }}
      />,
    );

    expect(container.textContent).toContain("Running 47%");

    const title = container.querySelector("h3");
    expect(title).not.toBeNull();

    await act(async () => {
      title!.click();
    });

    expect(container.textContent).toContain("Execution");
    expect(container.textContent).toContain("requested Cluster");
    expect(container.textContent).toContain("running on Local Python");
    expect(container.textContent).toContain("training fold 2");

    await act(async () => {
      root.unmount();
    });
  });

  it("renders telemetry unavailable instead of zero progress when job telemetry is unavailable", async () => {
    const { container, root } = await render(
      <RunItem
        run={run({ status: "running" })}
        onViewDetails={vi.fn()}
        workspaceId="workspace-1"
        executionJob={{
          latestJobId: "job-no-telemetry",
          requestedBackend: "cluster",
          executionBackend: "cluster",
          executionStatus: "running",
          progress: 0,
          progressMessage: "waiting for worker telemetry",
          progressUnavailable: true,
          hasDurableRecord: true,
          jobCount: 1,
          activeJobCount: 1,
          failedJobCount: 0,
          hasMultipleJobs: false,
        }}
      />,
    );

    expect(container.textContent).toContain("Telemetry unavailable");
    expect(container.textContent).not.toContain("Running 0%");
    expect(container.textContent).not.toContain("0%");

    const title = container.querySelector("h3");
    expect(title).not.toBeNull();

    await act(async () => {
      title!.click();
    });

    expect(container.textContent).toContain("Telemetry unavailable");
    expect(container.textContent).toContain("waiting for worker telemetry");
    expect(container.textContent).not.toContain("Running 0%");
    expect(container.textContent).not.toContain("0%");

    await act(async () => {
      root.unmount();
    });
  });

  it("renders a multi-job execution summary when execution job counters are provided", async () => {
    const { container, root } = await render(
      <RunItem
        run={run()}
        onViewDetails={vi.fn()}
        workspaceId="workspace-1"
        executionJob={{
          latestJobId: "prediction-job",
          requestedBackend: "cluster",
          executionBackend: "local-python",
          executionStatus: "running",
          progress: 35,
          progressMessage: "batch prediction",
          progressUnavailable: false,
          hasDurableRecord: true,
          jobCount: 3,
          activeJobCount: 1,
          failedJobCount: 1,
          hasMultipleJobs: true,
        }}
      />,
    );

    const title = container.querySelector("h3");
    expect(title).not.toBeNull();

    await act(async () => {
      title!.click();
    });

    expect(container.textContent).toContain("Execution");
    expect(container.textContent).toContain("3 jobs");
    expect(container.textContent).toContain("1 active");
    expect(container.textContent).toContain("1 failed");

    await act(async () => {
      root.unmount();
    });
  });
});

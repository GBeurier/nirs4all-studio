/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { EnrichedRun } from "@/types/enriched-runs";
import { RunDetailSheetHeader } from "../RunDetailSheetHeader";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let mountedContainers: HTMLDivElement[] = [];

async function render(element: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  mountedContainers.push(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(element);
  });

  return { container, root };
}

afterEach(() => {
  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers = [];
});

function enrichedRun(overrides: Partial<EnrichedRun> = {}): EnrichedRun {
  return {
    run_id: "repository-run",
    name: "Repository run",
    status: "completed",
    project_id: null,
    created_at: "2026-04-17T08:00:00Z",
    completed_at: "2026-04-17T08:10:00Z",
    duration_seconds: 600,
    artifact_size_bytes: 1536,
    datasets_count: 1,
    pipeline_runs_count: 2,
    final_models_count: 1,
    total_models_trained: 2,
    total_folds: 10,
    datasets: [],
    ...overrides,
  };
}

describe("RunDetailSheetHeader", () => {
  it("renders storage artifact metadata using UI-ready labels", async () => {
    const run = {
      ...enrichedRun({
        config: {
          execution_backend: "cluster",
        },
      }),
      artifact_count: 3,
      manifest_path: "/workspace/runs/repository-run/manifest.json",
      repository_id: "repo-1",
      run_dir: "/workspace/runs/repository-run",
      storage_backend: "result-repository",
      store_run_id: "store-repository-run",
      workspace_id: "workspace-1",
    } as EnrichedRun & Record<string, unknown>;

    const { container, root } = await render(
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <Sheet open>
          <SheetContent>
            <RunDetailSheetHeader
              run={run}
              status="completed"
              detail={null}
              datasetsCount={1}
              runPageId={null}
              canRerun={false}
              isRerunning={false}
              onRerun={vi.fn()}
            />
          </SheetContent>
        </Sheet>
      </MemoryRouter>,
    );

    const artifactCard = Array.from(document.body.querySelectorAll("div[title]")).find((element) => (
      element.getAttribute("title")?.includes("Storage backend: Result repository")
    ));

    expect(artifactCard).toBeDefined();
    expect(artifactCard?.textContent).toContain("1.5 KB");
    expect(artifactCard?.textContent).toContain("Artifact size");
    expect(artifactCard?.getAttribute("title")).toContain("Artifacts: 3 artifacts");
    expect(artifactCard?.getAttribute("title")).toContain("Execution backend: Cluster");
    expect(artifactCard?.getAttribute("title")).toContain("Store run ID: store-repository-run");
    expect(artifactCard?.getAttribute("title")).toContain("Manifest path: /workspace/runs/repository-run/manifest.json");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});

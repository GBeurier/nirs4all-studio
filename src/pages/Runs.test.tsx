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

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    listRuns: mocks.listRuns,
    getEnrichedRuns: mocks.getEnrichedRuns,
  };
});

vi.mock("@/hooks/useDatasetQueries", () => ({
  useLinkedWorkspacesQuery: mocks.useLinkedWorkspacesQuery,
}));

vi.mock("@/components/scores/MetricSelector", () => ({
  MetricSelector: () => null,
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

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

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
});

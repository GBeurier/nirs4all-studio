/**
 * @vitest-environment jsdom
 */

import type { ReactElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  convertLegacyWorkspace,
  getWorkspaceStats,
  getWorkspaceTransitionStatus,
} from "@/api/workspace";
import type { WorkspaceStatsResponse } from "@/types/settings";
import type { WorkspaceTransitionStatusResponse } from "@/types/storage";
import { WorkspaceStats } from "../WorkspaceStats";

vi.mock("@/api/workspace", () => ({
  cleanWorkspaceCache: vi.fn(),
  convertLegacyWorkspace: vi.fn(),
  getWorkspaceStats: vi.fn(),
  getWorkspaceTransitionStatus: vi.fn(),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ container: HTMLDivElement; root: Root }> = [];

function workspaceStats(overrides: Partial<WorkspaceStatsResponse> = {}): WorkspaceStatsResponse {
  return {
    path: "/tmp/legacy",
    name: "legacy",
    total_size_bytes: 4096,
    space_usage: [{ name: "Runs", size_bytes: 2048, file_count: 2, percentage: 50 }],
    linked_datasets_count: 1,
    linked_datasets_external_size: 1024,
    duckdb_size_bytes: 512,
    parquet_arrays_size_bytes: 256,
    storage_mode: "legacy",
    created_at: "2026-07-10T00:00:00Z",
    last_accessed: "2026-07-10T00:00:00Z",
    runs_count: 3,
    datasets_count: 1,
    predictions_count: 12,
    models_count: 2,
    ...overrides,
  };
}

function legacyTransitionStatus(
  overrides: Partial<WorkspaceTransitionStatusResponse> = {},
): WorkspaceTransitionStatusResponse {
  return {
    path: "/tmp/legacy",
    format: "duckdb-workspace",
    conversion_required: true,
    message: "Legacy DuckDB workspace detected. Convert it to the V1 workspace format before switching runtimes.",
    conversion_command:
      "python -m nirs4all_tools legacy migrate /tmp/legacy --output /tmp/legacy-workspace-v2 --target nirs4all-workspace-v2 --verify",
    default_output_path: "/tmp/legacy-workspace-v2",
    converter_available: true,
    ...overrides,
  };
}

async function render(element: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ container, root });

  await act(async () => {
    root.render(element);
  });

  return container;
}

async function flushAsyncUi() {
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(async () => {
  for (const { container, root } of mounted.splice(0)) {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
  vi.clearAllMocks();
});

describe("WorkspaceStats transition release panel", () => {
  it("renders the legacy workspace warning and starts conversion with the default output", async () => {
    vi.mocked(getWorkspaceStats).mockResolvedValue(workspaceStats());
    vi.mocked(getWorkspaceTransitionStatus).mockResolvedValue(legacyTransitionStatus());
    vi.mocked(convertLegacyWorkspace).mockResolvedValue({
      job_id: "job-1",
      command: ["python", "-m", "nirs4all_tools"],
      output_path: "/tmp/legacy-workspace-v2",
      dry_run: false,
      return_code: null,
      stdout: "",
      stderr: "",
      success: true,
    });

    const onStatsChange = vi.fn();
    const container = await render(<WorkspaceStats onStatsChange={onStatsChange} />);
    await flushAsyncUi();

    expect(container.textContent).toContain("Legacy workspace conversion required");
    expect(container.textContent).toContain("Legacy DuckDB workspace detected");
    expect(container.textContent).toContain("python -m nirs4all_tools legacy migrate");

    const convertButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Convert to V1 Workspace"),
    );
    expect(convertButton).toBeDefined();
    expect(convertButton?.disabled).toBe(false);

    await act(async () => {
      convertButton?.click();
    });
    await flushAsyncUi();

    expect(convertLegacyWorkspace).toHaveBeenCalledWith({
      output_path: "/tmp/legacy-workspace-v2",
      verify: true,
    });
    expect(onStatsChange).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Legacy workspace conversion started (job-1)");
  });
});

import { describe, expect, it } from "vitest";
import {
  getEmptyDatasetsMessage,
  getRunExecutionBackend,
  getRunExecutionBackendDisplay,
  getRunStatusConfig,
  getTotalLogCount,
  isBusyRunStatus,
  isKnownRunStatus,
  resolveRunStatus,
} from "../RunDetailSheetDisplay";

describe("RunDetailSheetDisplay", () => {
  it("preserves run status display fallbacks", () => {
    expect(resolveRunStatus(null)).toBe("completed");
    expect(resolveRunStatus("cancelled")).toBe("cancelled");
    expect(isKnownRunStatus("cancelled")).toBe(false);
    expect(getRunStatusConfig("cancelled").label).toBe("Completed");
  });

  it("detects busy statuses for actions and empty dataset copy", () => {
    expect(isBusyRunStatus("running")).toBe(true);
    expect(isBusyRunStatus("queued")).toBe(true);
    expect(isBusyRunStatus("completed")).toBe(false);
    expect(getEmptyDatasetsMessage("running")).toBe("Fold-level dataset results will appear here as pipelines complete.");
    expect(getEmptyDatasetsMessage("completed")).toBe("No dataset results are available for this run.");
  });

  it("totals persisted log counts", () => {
    expect(getTotalLogCount(null)).toBe(0);
    expect(
      getTotalLogCount({
        run_id: "run-1",
        name: "Run 1",
        status: "completed",
        created_at: "2026-01-01T00:00:00Z",
        completed_at: null,
        datasets: [],
        pipelines: [],
        log_summary: [
          {
            pipeline_id: "pipe-1",
            pipeline_name: null,
            pipeline_status: null,
            log_count: 2,
            total_duration_ms: null,
            warning_count: 0,
            error_count: 0,
          },
          {
            pipeline_id: "pipe-2",
            pipeline_name: null,
            pipeline_status: null,
            log_count: 3,
            total_duration_ms: null,
            warning_count: 0,
            error_count: 0,
          },
        ],
      }),
    ).toBe(5);
  });

  it("builds a small execution backend display model", () => {
    expect(getRunExecutionBackend(null)).toBeNull();
    expect(getRunExecutionBackendDisplay(null)).toEqual({
      backend: null,
      label: "Execution backend not recorded",
      isCluster: false,
    });

    expect(getRunExecutionBackendDisplay({ config: { execution_backend: "local-python" } })).toEqual({
      backend: "local-python",
      label: "Local Python",
      isCluster: false,
    });

    expect(getRunExecutionBackendDisplay({ config: { execution_backend: "cluster" } })).toEqual({
      backend: "cluster",
      label: "Cluster",
      isCluster: true,
    });

    expect(getRunExecutionBackendDisplay({ config: { execution_backend: "gpu-grid" } })).toEqual({
      backend: null,
      label: "Execution backend not recorded",
      isCluster: false,
    });
  });
});

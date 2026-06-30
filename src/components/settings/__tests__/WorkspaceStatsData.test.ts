import { describe, expect, it } from "vitest";

import type { WorkspaceStatsResponse } from "@/types/settings";
import {
  getCleanCacheSuccessMessage,
  getWorkspaceActionFeedbackDescriptors,
  getWorkspaceCountCards,
  getWorkspaceSpaceUsageRows,
  getWorkspaceStorageSummaryCards,
} from "../WorkspaceStatsData";

function createStats(
  overrides: Partial<WorkspaceStatsResponse> = {},
): WorkspaceStatsResponse {
  return {
    path: "/workspace",
    name: "Workspace",
    total_size_bytes: 0,
    space_usage: [],
    linked_datasets_count: 0,
    linked_datasets_external_size: 0,
    duckdb_size_bytes: 0,
    parquet_arrays_size_bytes: 0,
    storage_mode: "new",
    created_at: "2026-06-29T00:00:00Z",
    last_accessed: "2026-06-29T00:00:00Z",
    runs_count: 0,
    datasets_count: 0,
    predictions_count: 0,
    models_count: 0,
    ...overrides,
  };
}

describe("getWorkspaceSpaceUsageRows", () => {
  it("filters empty categories and formats byte/count labels", () => {
    expect(
      getWorkspaceSpaceUsageRows([
        {
          name: "Runs",
          size_bytes: 1536,
          file_count: 3,
          percentage: 12.5,
        },
        {
          name: "Cache",
          size_bytes: 0,
          file_count: 0,
          percentage: 0,
        },
      ]),
    ).toEqual([
      {
        key: "Runs",
        name: "Runs",
        fileCountLabel: "3 files",
        sizeLabel: "1.5 KB",
        percentage: 12.5,
        percentageLabel: "12.5%",
      },
    ]);
  });
});

describe("workspace stat cards", () => {
  it("projects workspace-scoped count cards", () => {
    expect(
      getWorkspaceCountCards(
        createStats({
          runs_count: 4,
          datasets_count: 2,
          predictions_count: 7,
          models_count: 3,
        }),
      ).map(({ key, label, value }) => ({ key, label, value })),
    ).toEqual([
      { key: "runs", label: "Runs", value: "4" },
      { key: "datasets", label: "Datasets", value: "2" },
      { key: "predictions", label: "Predictions", value: "7" },
      { key: "models", label: "Models", value: "3" },
    ]);
  });

  it("projects storage summary labels with formatted local byte sizes", () => {
    expect(
      getWorkspaceStorageSummaryCards(
        createStats({
          total_size_bytes: 1048576,
          linked_datasets_count: 2,
          linked_datasets_external_size: 2048,
          duckdb_size_bytes: 0,
          parquet_arrays_size_bytes: 1536,
          storage_mode: "migrated",
        }),
      ).map(({ key, label, value, detail }) => ({ key, label, value, detail })),
    ).toEqual([
      {
        key: "total-size",
        label: "Total Size",
        value: "1 MB",
        detail: undefined,
      },
      {
        key: "linked-datasets",
        label: "Globally Linked Datasets",
        value: "2",
        detail: "(2 KB external)",
      },
      {
        key: "storage-mode",
        label: "Storage Mode",
        value: "migrated",
        detail: undefined,
      },
      {
        key: "database-parquet",
        label: "Database / Parquet",
        value: "0 B / 1.5 KB",
        detail: undefined,
      },
    ]);
  });
});

describe("getCleanCacheSuccessMessage", () => {
  it("formats removed files and freed bytes", () => {
    expect(
      getCleanCacheSuccessMessage({
        success: true,
        files_removed: 5,
        bytes_freed: 1536,
        categories_cleaned: ["Temp"],
      }),
    ).toBe("Cleaned 5 files, freed 1.5 KB");
  });
});

describe("getWorkspaceActionFeedbackDescriptors", () => {
  it("describes success and error feedback in render order", () => {
    expect(
      getWorkspaceActionFeedbackDescriptors({
        lastAction: {
          type: "clean",
          message: "Cleaned 5 files, freed 1.5 KB",
        },
        error: "Failed to refresh",
      }),
    ).toEqual([
      {
        key: "action-clean",
        tone: "success",
        icon: "check",
        message: "Cleaned 5 files, freed 1.5 KB",
      },
      {
        key: "error",
        tone: "error",
        icon: "alert",
        message: "Failed to refresh",
      },
    ]);
  });
});

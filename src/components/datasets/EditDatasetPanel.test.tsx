import { describe, expect, it } from "vitest";

import { buildInitialState } from "./editDatasetPanelState";
import type { Dataset, DatasetConfig } from "@/types/datasets";

function createDataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    id: "dataset-1",
    name: "Corn",
    path: "C:/datasets/corn",
    linked_at: "2026-04-15T10:00:00Z",
    config: {} as DatasetConfig,
    ...overrides,
  };
}

describe("buildInitialState", () => {
  it("hydrates metadata columns for the edit wizard", () => {
    const state = buildInitialState(
      createDataset({
        metadata_columns: ["batch", "sample_id"],
      }),
    );

    expect(state.metadataColumns).toEqual(["batch", "sample_id"]);
  });

  it("keeps the configured repetition column selectable when metadata columns are missing", () => {
    const state = buildInitialState(
      createDataset({
        config: {
          repetition: "sample_id",
        } as Partial<DatasetConfig> as DatasetConfig,
      }),
    );

    expect(state.aggregation).toMatchObject({
      enabled: true,
      column: "sample_id",
    });
    expect(state.metadataColumns).toEqual(["sample_id"]);
  });

  it("hydrates stored multi-source descriptors for the edit wizard", () => {
    const config: Partial<DatasetConfig> = {
      multi_source: {
        link_by: "sample_id",
        shared_targets: true,
        sources: [
          {
            id: 1,
            name: "nir",
            files: [],
          },
        ],
      },
    };

    const state = buildInitialState(
      createDataset({
        config: config as unknown as DatasetConfig,
      }),
    );

    expect(state.multiSource).toEqual({
      link_by: "sample_id",
      shared_targets: true,
      sources: [
        {
          id: 1,
          name: "nir",
          files: [],
        },
      ],
    });
  });
});

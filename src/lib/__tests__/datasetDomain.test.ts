import { describe, expect, it } from "vitest";

import {
  getDatasetSourceCount,
  getDatasetTargetColumns,
  normalizeDataset,
  normalizeDatasetListResponse,
} from "../datasetDomain";

describe("datasetDomain", () => {
  it("normalizes legacy linked-dataset aliases into the shared Dataset shape", () => {
    const dataset = normalizeDataset({
      path: "/data/corn/train.csv",
      created_at: "2026-01-02T03:04:05",
      samples: 42,
      features: 128,
      targets: 2,
    }, 0);

    expect(dataset).toMatchObject({
      id: "/data/corn/train.csv",
      name: "train.csv",
      path: "/data/corn/train.csv",
      linked_at: "2026-01-02T03:04:05",
      num_samples: 42,
      num_features: 128,
      has_targets: true,
    });
    expect(dataset.targets).toBeUndefined();
  });

  it("keeps list responses totalled and normalized even when old caches are sparse", () => {
    const response = normalizeDatasetListResponse({
      datasets: [
        { id: "dataset-1", name: "Dataset 1" },
      ],
    });

    expect(response.total).toBe(1);
    expect(response.groups).toEqual([]);
    expect(response.datasets[0]).toMatchObject({
      id: "dataset-1",
      name: "Dataset 1",
      path: "",
      linked_at: "",
    });
  });

  it("derives source and target summaries without coupling UI components to payload quirks", () => {
    const dataset = normalizeDataset({
      id: "multi",
      name: "Multi",
      path: "/data/multi",
      linked_at: "2026-01-01T00:00:00",
      targets: [{ column: "protein", type: "regression" }],
      default_target: "moisture",
      config: {
        delimiter: ",",
        decimal_separator: ".",
        has_header: true,
        files: [
          { path: "nir.csv", type: "X", split: "train", source: 0 },
          { path: "meta.csv", type: "metadata", split: "train", source: 1 },
        ],
        targets: [{ column: "protein", type: "regression" }],
      },
    });

    expect(getDatasetSourceCount(dataset)).toBe(2);
    expect(getDatasetTargetColumns(dataset)).toEqual(["protein", "moisture"]);
    expect(dataset.has_targets).toBe(true);
  });
});

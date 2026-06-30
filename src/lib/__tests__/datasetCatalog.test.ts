import { describe, expect, it } from "vitest";

import {
  getAssignedDatasetGroups,
  getDatasetCatalogStats,
  getFilteredSortedDatasets,
} from "../datasetCatalog";
import type { Dataset, DatasetGroup } from "@/types/datasets";

const datasets: Dataset[] = [
  {
    id: "b",
    name: "Barley",
    path: "/data/barley",
    linked_at: "2026-01-03T00:00:00",
    num_samples: 12,
    num_features: 128,
  },
  {
    id: "a",
    name: "Corn",
    path: "/data/corn",
    linked_at: "2026-01-01T00:00:00",
    num_samples: 30,
    num_features: 256,
  },
  {
    id: "c",
    name: "Wheat",
    path: "/archive/wheat",
    linked_at: "2026-01-02T00:00:00",
    num_samples: 0,
  },
];

const groups: DatasetGroup[] = [
  {
    id: "grain",
    name: "Grain",
    dataset_ids: ["a", "b"],
    created_at: "2026-01-01T00:00:00",
  },
  {
    id: "archive",
    name: "Archive",
    dataset_ids: ["c"],
    created_at: "2026-01-01T00:00:00",
  },
];

describe("datasetCatalog", () => {
  it("finds assigned groups for a dataset", () => {
    expect(getAssignedDatasetGroups(groups, "a").map((group) => group.name)).toEqual([
      "Grain",
    ]);
  });

  it("filters by search text across dataset and group labels", () => {
    expect(
      getFilteredSortedDatasets({
        datasets,
        groups,
        searchQuery: "archive",
        filterGroup: "all",
        sortField: "name",
        sortDirection: "asc",
      }).map((dataset) => dataset.id),
    ).toEqual(["c"]);
  });

  it("filters by group and sorts by sample count", () => {
    expect(
      getFilteredSortedDatasets({
        datasets,
        groups,
        searchQuery: "",
        filterGroup: "grain",
        sortField: "num_samples",
        sortDirection: "desc",
      }).map((dataset) => dataset.id),
    ).toEqual(["a", "b"]);
  });

  it("computes catalog summary stats", () => {
    expect(getDatasetCatalogStats(datasets)).toEqual({
      totalSamples: 42,
      hasFeatureCounts: true,
      minFeatures: 128,
      maxFeatures: 256,
    });
  });
});

import { describe, expect, it } from "vitest";
import type { Dataset } from "@/types/datasets";
import {
  buildDatasetShapeDisplayModel,
  formatBoundDatasetShapeBadge,
  formatDatasetListShape,
  formatDataShapeTuple,
  getDataShapeSourcesBadge,
  partitionBindableDatasets,
} from "../DatasetBindingData";

function makeDataset(overrides: Partial<Dataset>): Dataset {
  return {
    id: overrides.id ?? "dataset",
    name: overrides.name ?? "Dataset",
    path: overrides.path ?? "/tmp/dataset.csv",
    linked_at: overrides.linked_at ?? "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("DatasetBindingData", () => {
  it("partitions available and missing datasets while ignoring other statuses", () => {
    const available = makeDataset({ id: "available", status: "available" });
    const missing = makeDataset({ id: "missing", status: "missing" });
    const loading = makeDataset({ id: "loading", status: "loading" });
    const error = makeDataset({ id: "error", status: "error" });
    const unset = makeDataset({ id: "unset" });

    expect(partitionBindableDatasets([available, missing, loading, error, unset])).toEqual({
      availableDatasets: [available],
      missingDatasets: [missing],
    });
  });

  it("formats the bound dataset shape badge with localized dimensions", () => {
    const samples = 1234;
    const features = 56789;

    expect(formatBoundDatasetShapeBadge({ samples, features })).toBe(
      `${samples.toLocaleString()} × ${features.toLocaleString()}`,
    );
  });

  it("formats dataset list shape with unknown fallbacks", () => {
    expect(formatDatasetListShape(makeDataset({ num_samples: 1200 }))).toBe(
      `${(1200).toLocaleString()} samples · ? features`,
    );
    expect(formatDatasetListShape(makeDataset({ num_features: 4500 }))).toBe(
      `? samples · ${(4500).toLocaleString()} features`,
    );
  });

  it("formats shape tuple and source badge display state", () => {
    const shape = { samples: 1000, features: 42 };

    expect(formatDataShapeTuple(shape)).toBe(`(${(1000).toLocaleString()}, ${(42).toLocaleString()})`);
    expect(getDataShapeSourcesBadge(shape)).toBeNull();
    expect(getDataShapeSourcesBadge({ ...shape, sources: 1 })).toBeNull();
    expect(getDataShapeSourcesBadge({ ...shape, sources: 2 })).toEqual({ label: "2 sources" });
    expect(buildDatasetShapeDisplayModel({ ...shape, sources: 3 })).toEqual({
      tuple: `(${(1000).toLocaleString()}, ${(42).toLocaleString()})`,
      sourcesBadge: { label: "3 sources" },
    });
  });
});

/**
 * @vitest-environment jsdom
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Dataset, DatasetGroup } from "@/types/datasets";

const apiMocks = vi.hoisted(() => ({
  linkDataset: vi.fn(),
  refreshDataset: vi.fn(),
  unlinkDataset: vi.fn(),
  updateDatasetConfig: vi.fn(),
  addDatasetToGroup: vi.fn(),
  createGroup: vi.fn(),
  deleteGroup: vi.fn(),
  removeDatasetFromGroup: vi.fn(),
  renameGroup: vi.fn(),
  invalidateDatasets: vi.fn(),
}));

vi.mock("@/api/datasets", () => ({
  linkDataset: apiMocks.linkDataset,
  refreshDataset: apiMocks.refreshDataset,
  unlinkDataset: apiMocks.unlinkDataset,
  updateDatasetConfig: apiMocks.updateDatasetConfig,
}));

vi.mock("@/api/workspace", () => ({
  addDatasetToGroup: apiMocks.addDatasetToGroup,
  createGroup: apiMocks.createGroup,
  deleteGroup: apiMocks.deleteGroup,
  removeDatasetFromGroup: apiMocks.removeDatasetFromGroup,
  renameGroup: apiMocks.renameGroup,
}));

vi.mock("./useDatasetQueries", () => ({
  useInvalidateDatasets: () => apiMocks.invalidateDatasets,
}));

import { useDatasetCatalogActions } from "./useDatasetCatalogActions";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

async function renderHook<T>(hook: () => T) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const result: { current: T | undefined } = { current: undefined };

  function TestComponent() {
    result.current = hook();
    return null;
  }

  await act(async () => {
    root.render(<TestComponent />);
  });

  return {
    result,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

const dataset: Dataset = {
  id: "dataset-1",
  name: "Dataset 1",
  path: "/data/dataset-1",
  linked_at: "2026-01-01T00:00:00",
};

const groups: DatasetGroup[] = [
  {
    id: "group-a",
    name: "Group A",
    dataset_ids: ["dataset-1"],
    created_at: "2026-01-01T00:00:00",
  },
  {
    id: "group-b",
    name: "Group B",
    dataset_ids: [],
    created_at: "2026-01-01T00:00:00",
  },
];

afterEach(() => {
  Object.values(apiMocks).forEach((mock) => mock.mockReset());
});

describe("useDatasetCatalogActions", () => {
  it("links a dataset and invalidates dataset caches", async () => {
    apiMocks.linkDataset.mockResolvedValue({ success: true, dataset });
    apiMocks.invalidateDatasets.mockResolvedValue(undefined);

    const mounted = await renderHook(() => useDatasetCatalogActions(groups));

    await act(async () => {
      await mounted.result.current?.addDataset("/data/dataset-1", { delimiter: "," });
    });

    expect(apiMocks.linkDataset).toHaveBeenCalledWith("/data/dataset-1", {
      delimiter: ",",
    });
    expect(apiMocks.invalidateDatasets).toHaveBeenCalledTimes(1);

    await mounted.unmount();
  });

  it("does not invalidate when linking fails semantically", async () => {
    apiMocks.linkDataset.mockResolvedValue({ success: false });

    const mounted = await renderHook(() => useDatasetCatalogActions(groups));

    await expect(
      mounted.result.current!.addDataset("/data/broken"),
    ).rejects.toThrow("Failed to link dataset");
    expect(apiMocks.invalidateDatasets).not.toHaveBeenCalled();

    await mounted.unmount();
  });

  it("updates, refreshes, and removes datasets through one invalidation boundary", async () => {
    apiMocks.updateDatasetConfig.mockResolvedValue({ success: true, dataset });
    apiMocks.refreshDataset.mockResolvedValue({ success: true, dataset });
    apiMocks.unlinkDataset.mockResolvedValue({ success: true });
    apiMocks.invalidateDatasets.mockResolvedValue(undefined);

    const mounted = await renderHook(() => useDatasetCatalogActions(groups));

    await act(async () => {
      await mounted.result.current?.saveDatasetConfig("dataset-1", { name: "Renamed" });
      await mounted.result.current?.refreshDatasetById("dataset-1");
      await mounted.result.current?.removeDataset("dataset-1");
    });

    expect(apiMocks.updateDatasetConfig).toHaveBeenCalledWith("dataset-1", {
      name: "Renamed",
    });
    expect(apiMocks.refreshDataset).toHaveBeenCalledWith("dataset-1");
    expect(apiMocks.unlinkDataset).toHaveBeenCalledWith("dataset-1");
    expect(apiMocks.invalidateDatasets).toHaveBeenCalledTimes(3);

    await mounted.unmount();
  });

  it("toggles dataset group membership and invalidates once per action", async () => {
    apiMocks.addDatasetToGroup.mockResolvedValue({ success: true });
    apiMocks.removeDatasetFromGroup.mockResolvedValue({ success: true });
    apiMocks.invalidateDatasets.mockResolvedValue(undefined);

    const mounted = await renderHook(() => useDatasetCatalogActions(groups));

    await act(async () => {
      await mounted.result.current?.assignGroup(dataset, "group-a");
      await mounted.result.current?.assignGroup(dataset, "group-b");
    });

    expect(apiMocks.removeDatasetFromGroup).toHaveBeenCalledWith(
      "group-a",
      "dataset-1",
    );
    expect(apiMocks.addDatasetToGroup).toHaveBeenCalledWith(
      "group-b",
      "dataset-1",
    );
    expect(apiMocks.invalidateDatasets).toHaveBeenCalledTimes(2);

    await mounted.unmount();
  });

  it("removes a dataset from all groups when assigning no group", async () => {
    apiMocks.removeDatasetFromGroup.mockResolvedValue({ success: true });
    apiMocks.invalidateDatasets.mockResolvedValue(undefined);

    const mounted = await renderHook(() => useDatasetCatalogActions(groups));

    await act(async () => {
      await mounted.result.current?.assignGroup(dataset, null);
    });

    expect(apiMocks.removeDatasetFromGroup).toHaveBeenCalledTimes(1);
    expect(apiMocks.removeDatasetFromGroup).toHaveBeenCalledWith(
      "group-a",
      "dataset-1",
    );
    expect(apiMocks.invalidateDatasets).toHaveBeenCalledTimes(1);

    await mounted.unmount();
  });
});

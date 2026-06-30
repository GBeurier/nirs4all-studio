import { useCallback } from "react";

import {
  linkDataset,
  refreshDataset,
  unlinkDataset,
  updateDatasetConfig,
  type UpdateDatasetRequest,
} from "@/api/datasets";
import {
  addDatasetToGroup,
  createGroup,
  deleteGroup,
  removeDatasetFromGroup,
  renameGroup,
} from "@/api/workspace";
import type { Dataset, DatasetConfig, DatasetGroup } from "@/types/datasets";

import { useInvalidateDatasets } from "./useDatasetQueries";

export function useDatasetCatalogActions(groups: DatasetGroup[]) {
  const invalidateDatasets = useInvalidateDatasets();

  const refreshAll = useCallback(async () => {
    await invalidateDatasets();
  }, [invalidateDatasets]);

  const addDataset = useCallback(
    async (path: string, config?: Partial<DatasetConfig>) => {
      const result = await linkDataset(path, config);
      if (!result.success) {
        throw new Error("Failed to link dataset");
      }
      await invalidateDatasets();
    },
    [invalidateDatasets],
  );

  const saveDatasetConfig = useCallback(
    async (datasetId: string, updates: UpdateDatasetRequest) => {
      await updateDatasetConfig(datasetId, updates);
      await invalidateDatasets();
    },
    [invalidateDatasets],
  );

  const removeDataset = useCallback(
    async (datasetId: string) => {
      await unlinkDataset(datasetId);
      await invalidateDatasets();
    },
    [invalidateDatasets],
  );

  const refreshDatasetById = useCallback(
    async (datasetId: string) => {
      await refreshDataset(datasetId);
      await invalidateDatasets();
    },
    [invalidateDatasets],
  );

  const assignGroup = useCallback(
    async (dataset: Dataset, groupId: string | null) => {
      if (groupId === null) {
        const currentGroups = groups.filter((group) =>
          group.dataset_ids?.includes(dataset.id),
        );
        for (const group of currentGroups) {
          await removeDatasetFromGroup(group.id, dataset.id);
        }
      } else {
        const isInGroup = groups.some((group) =>
          group.id === groupId && group.dataset_ids?.includes(dataset.id),
        );
        if (isInGroup) {
          await removeDatasetFromGroup(groupId, dataset.id);
        } else {
          await addDatasetToGroup(groupId, dataset.id);
        }
      }

      await invalidateDatasets();
    },
    [groups, invalidateDatasets],
  );

  const createDatasetGroup = useCallback(
    async (name: string) => {
      await createGroup(name);
      await invalidateDatasets();
    },
    [invalidateDatasets],
  );

  const renameDatasetGroup = useCallback(
    async (groupId: string, newName: string) => {
      await renameGroup(groupId, newName);
      await invalidateDatasets();
    },
    [invalidateDatasets],
  );

  const deleteDatasetGroup = useCallback(
    async (groupId: string) => {
      await deleteGroup(groupId);
      await invalidateDatasets();
    },
    [invalidateDatasets],
  );

  const addDatasetToDatasetGroup = useCallback(
    async (groupId: string, datasetId: string) => {
      await addDatasetToGroup(groupId, datasetId);
      await invalidateDatasets();
    },
    [invalidateDatasets],
  );

  const removeDatasetFromDatasetGroup = useCallback(
    async (groupId: string, datasetId: string) => {
      await removeDatasetFromGroup(groupId, datasetId);
      await invalidateDatasets();
    },
    [invalidateDatasets],
  );

  return {
    refreshAll,
    addDataset,
    saveDatasetConfig,
    removeDataset,
    refreshDatasetById,
    assignGroup,
    createDatasetGroup,
    renameDatasetGroup,
    deleteDatasetGroup,
    addDatasetToDatasetGroup,
    removeDatasetFromDatasetGroup,
  };
}

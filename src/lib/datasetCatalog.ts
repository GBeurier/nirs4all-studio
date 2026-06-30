import type { Dataset, DatasetGroup } from "@/types/datasets";

export type DatasetSortField = "name" | "linked_at" | "num_samples" | "group";
export type DatasetSortDirection = "asc" | "desc";
export type DatasetFilterGroup = "all" | string;

export interface DatasetCatalogQuery {
  datasets: Dataset[];
  groups: DatasetGroup[];
  searchQuery: string;
  filterGroup: DatasetFilterGroup;
  sortField: DatasetSortField;
  sortDirection: DatasetSortDirection;
}

export interface DatasetCatalogStats {
  totalSamples: number;
  hasFeatureCounts: boolean;
  minFeatures: number;
  maxFeatures: number;
}

export function getAssignedDatasetGroups(
  groups: DatasetGroup[],
  datasetId: string,
): DatasetGroup[] {
  return groups.filter((group) => group.dataset_ids?.includes(datasetId));
}

function dateValue(value: string | undefined): number {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstGroupName(groups: DatasetGroup[], datasetId: string): string {
  return getAssignedDatasetGroups(groups, datasetId)[0]?.name ?? "\uffff";
}

export function getFilteredSortedDatasets(query: DatasetCatalogQuery): Dataset[] {
  const normalizedSearch = query.searchQuery.trim().toLowerCase();

  return [...query.datasets]
    .filter((dataset) => {
      const assignedGroups = getAssignedDatasetGroups(query.groups, dataset.id);
      const matchesSearch =
        normalizedSearch.length === 0 ||
        dataset.name.toLowerCase().includes(normalizedSearch) ||
        dataset.path.toLowerCase().includes(normalizedSearch) ||
        assignedGroups.some((group) => group.name.toLowerCase().includes(normalizedSearch));

      if (!matchesSearch) return false;
      if (query.filterGroup === "all") return true;

      return query.groups
        .find((group) => group.id === query.filterGroup)
        ?.dataset_ids?.includes(dataset.id) ?? false;
    })
    .sort((a, b) => {
      let comparison = 0;

      switch (query.sortField) {
        case "name":
          comparison = a.name.localeCompare(b.name);
          break;
        case "linked_at":
          comparison = dateValue(a.linked_at) - dateValue(b.linked_at);
          break;
        case "num_samples":
          comparison = (a.num_samples || 0) - (b.num_samples || 0);
          break;
        case "group":
          comparison = firstGroupName(query.groups, a.id).localeCompare(
            firstGroupName(query.groups, b.id),
          );
          break;
      }

      return query.sortDirection === "asc" ? comparison : -comparison;
    });
}

export function getDatasetCatalogStats(datasets: Dataset[]): DatasetCatalogStats {
  const totalSamples = datasets.reduce(
    (sum, dataset) => sum + (dataset.num_samples || 0),
    0,
  );
  const featureCounts = datasets
    .map((dataset) => dataset.num_features)
    .filter((value): value is number => value != null && value > 0);

  return {
    totalSamples,
    hasFeatureCounts: featureCounts.length > 0,
    minFeatures: featureCounts.length > 0 ? Math.min(...featureCounts) : 0,
    maxFeatures: featureCounts.length > 0 ? Math.max(...featureCounts) : 0,
  };
}

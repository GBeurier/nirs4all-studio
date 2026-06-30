import { Brain, Database } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  PredictionFacetSelect,
  PredictionSearchFilter,
  PredictionVisibilityToggleGroup,
} from "@/components/predictions/PredictionFilterControls";
import { getPredictionFiltersReadModel } from "@/components/predictions/PredictionFiltersData";
import type { DataVisibility, FoldVisibility } from "@/lib/predictions/rows";

interface PredictionFiltersProps {
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  filterDataset: string;
  onFilterDatasetChange: (value: string) => void;
  filterModel: string;
  onFilterModelChange: (value: string) => void;
  filterTaskType: string;
  onFilterTaskTypeChange: (value: string) => void;
  datasetOptions: string[];
  modelOptions: string[];
  taskTypeOptions: string[];
  visibleFoldTypes: FoldVisibility[];
  onVisibleFoldTypesChange: (value: FoldVisibility[]) => void;
  visibleDataKinds: DataVisibility[];
  onVisibleDataKindsChange: (value: DataVisibility[]) => void;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}

export function PredictionFilters({
  searchQuery,
  onSearchQueryChange,
  filterDataset,
  onFilterDatasetChange,
  filterModel,
  onFilterModelChange,
  filterTaskType,
  onFilterTaskTypeChange,
  datasetOptions,
  modelOptions,
  taskTypeOptions,
  visibleFoldTypes,
  onVisibleFoldTypesChange,
  visibleDataKinds,
  onVisibleDataKindsChange,
  hasActiveFilters,
  onClearFilters,
}: PredictionFiltersProps) {
  const readModel = getPredictionFiltersReadModel({ hasActiveFilters });
  const {
    dataset: datasetFacet,
    model: modelFacet,
    taskType: taskTypeFacet,
  } = readModel.facets;
  const { foldTypes, dataKinds } = readModel.visibility;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <PredictionSearchFilter
        value={searchQuery}
        onValueChange={onSearchQueryChange}
      />
      <PredictionFacetSelect
        value={filterDataset}
        onValueChange={onFilterDatasetChange}
        options={datasetOptions}
        allLabel={datasetFacet.allLabel}
        placeholder={datasetFacet.placeholder}
        triggerClassName={datasetFacet.triggerClassName}
        icon={<Database className="mr-1 h-3.5 w-3.5" />}
      />
      <PredictionFacetSelect
        value={filterModel}
        onValueChange={onFilterModelChange}
        options={modelOptions}
        allLabel={modelFacet.allLabel}
        placeholder={modelFacet.placeholder}
        triggerClassName={modelFacet.triggerClassName}
        icon={<Brain className="mr-1 h-3.5 w-3.5" />}
      />
      <PredictionFacetSelect
        value={filterTaskType}
        onValueChange={onFilterTaskTypeChange}
        options={taskTypeOptions}
        allLabel={taskTypeFacet.allLabel}
        placeholder={taskTypeFacet.placeholder}
        triggerClassName={taskTypeFacet.triggerClassName}
      />
      <PredictionVisibilityToggleGroup
        label={foldTypes.label}
        value={visibleFoldTypes}
        options={foldTypes.options}
        onValueChange={onVisibleFoldTypesChange}
      />
      <PredictionVisibilityToggleGroup
        label={dataKinds.label}
        value={visibleDataKinds}
        options={dataKinds.options}
        onValueChange={onVisibleDataKindsChange}
      />
      {readModel.clearAction.isVisible && (
        <Button variant="ghost" size="sm" onClick={onClearFilters} className="h-7 text-xs text-muted-foreground">
          {readModel.clearAction.label}
        </Button>
      )}
    </div>
  );
}

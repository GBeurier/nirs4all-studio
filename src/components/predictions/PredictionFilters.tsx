import { Brain, Database } from "lucide-react";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
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
        allLabel={t(datasetFacet.allLabelKey)}
        placeholder={t(datasetFacet.placeholderKey)}
        triggerClassName={datasetFacet.triggerClassName}
        icon={<Database className="mr-1 h-3.5 w-3.5" />}
      />
      <PredictionFacetSelect
        value={filterModel}
        onValueChange={onFilterModelChange}
        options={modelOptions}
        allLabel={t(modelFacet.allLabelKey)}
        placeholder={t(modelFacet.placeholderKey)}
        triggerClassName={modelFacet.triggerClassName}
        icon={<Brain className="mr-1 h-3.5 w-3.5" />}
      />
      <PredictionFacetSelect
        value={filterTaskType}
        onValueChange={onFilterTaskTypeChange}
        options={taskTypeOptions}
        allLabel={t(taskTypeFacet.allLabelKey)}
        placeholder={t(taskTypeFacet.placeholderKey)}
        triggerClassName={taskTypeFacet.triggerClassName}
      />
      <PredictionVisibilityToggleGroup
        label={t(foldTypes.labelKey)}
        value={visibleFoldTypes}
        options={foldTypes.options.map(({ value, labelKey }) => ({ value, label: t(labelKey) }))}
        onValueChange={onVisibleFoldTypesChange}
      />
      <PredictionVisibilityToggleGroup
        label={t(dataKinds.labelKey)}
        value={visibleDataKinds}
        options={dataKinds.options.map(({ value, labelKey }) => ({ value, label: t(labelKey) }))}
        onValueChange={onVisibleDataKindsChange}
      />
      {readModel.clearAction.isVisible && (
        <Button variant="ghost" size="sm" onClick={onClearFilters} className="h-7 text-xs text-muted-foreground">
          {t(readModel.clearAction.labelKey)}
        </Button>
      )}
    </div>
  );
}

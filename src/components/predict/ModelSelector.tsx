import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";

import { getAvailableModels } from "@/api/predict";
import { Card, CardContent } from "@/components/ui/card";
import type { AvailableModel } from "@/types/predict";
import {
  buildModelSelectorState,
  hasHydratedModel,
  type SortField,
  type TaskFilter,
} from "./ModelSelectorData";
import {
  ModelList,
  ModelSelectorEmptyResults,
  ModelSelectorHeader,
  ModelSelectorLoadingCard,
  ModelSelectorNoModelsCard,
} from "./ModelSelectorSections";

interface ModelSelectorProps {
  selectedModel: AvailableModel | null;
  onSelect: (model: AvailableModel) => void;
}

export function ModelSelector({ selectedModel, onSelect }: ModelSelectorProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("score");
  const [sortDesc, setSortDesc] = useState(false);
  const [taskFilter, setTaskFilter] = useState<TaskFilter>("all");
  const [datasetFilter, setDatasetFilter] = useState("all");
  const [classFilter, setClassFilter] = useState("all");
  const [refitOnly, setRefitOnly] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["available-models"],
    queryFn: getAvailableModels,
    staleTime: 30000,
  });

  const models = useMemo(() => data?.models ?? [], [data]);

  useEffect(() => {
    if (!selectedModel || hasHydratedModel(selectedModel) || models.length === 0) return;
    const hydrated = models.find(
      (model) => model.id === selectedModel.id && model.source === selectedModel.source,
    );
    if (hydrated) onSelect(hydrated);
  }, [models, onSelect, selectedModel]);

  const {
    datasetOptions,
    classOptions,
    scoreCohort,
    taskCounts,
    sortedModels,
    activeFilterCount,
  } = useMemo(
    () => buildModelSelectorState({
      models,
      filters: {
        search,
        task: taskFilter,
        dataset: datasetFilter,
        modelClass: classFilter,
        refitOnly,
      },
      sort: {
        field: sortField,
        descending: sortDesc,
      },
    }),
    [models, search, taskFilter, datasetFilter, classFilter, refitOnly, sortField, sortDesc],
  );

  const clearFilters = () => {
    setSearch("");
    setTaskFilter("all");
    setDatasetFilter("all");
    setClassFilter("all");
    setRefitOnly(false);
  };

  const title = t("predict.model.title");

  if (isLoading) {
    return <ModelSelectorLoadingCard title={title} />;
  }

  if (models.length === 0) {
    return (
      <ModelSelectorNoModelsCard
        title={title}
        message={t("predict.model.noModels")}
        hint={t("predict.model.noModelsHint")}
      />
    );
  }

  return (
    <Card className="border-border/60 shadow-sm overflow-hidden">
      <ModelSelectorHeader
        title={title}
        searchPlaceholder={t("predict.model.search")}
        selectedModel={selectedModel}
        modelCount={models.length}
        filteredModelCount={sortedModels.length}
        datasetOptions={datasetOptions}
        classOptions={classOptions}
        search={search}
        onSearchChange={setSearch}
        sortField={sortField}
        sortDesc={sortDesc}
        onSortFieldChange={setSortField}
        onSortDescToggle={() => setSortDesc((value) => !value)}
        taskFilter={taskFilter}
        onTaskFilterChange={setTaskFilter}
        taskCounts={taskCounts}
        datasetFilter={datasetFilter}
        onDatasetFilterChange={setDatasetFilter}
        classFilter={classFilter}
        onClassFilterChange={setClassFilter}
        refitOnly={refitOnly}
        onRefitOnlyToggle={() => setRefitOnly((value) => !value)}
        activeFilterCount={activeFilterCount}
        onClearFilters={clearFilters}
      />

      <CardContent className="pt-0">
        {sortedModels.length === 0 ? (
          <ModelSelectorEmptyResults
            activeFilterCount={activeFilterCount}
            onClearFilters={clearFilters}
          />
        ) : (
          <ModelList
            models={sortedModels}
            scoreCohort={scoreCohort}
            selectedModel={selectedModel}
            sortField={sortField}
            sortDesc={sortDesc}
            onSelect={onSelect}
          />
        )}
      </CardContent>
    </Card>
  );
}

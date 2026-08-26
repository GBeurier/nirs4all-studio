import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Archive, FolderOpen } from "lucide-react";

import { getAvailableModels } from "@/api/predict";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { AvailableModel } from "@/types/predict";
import { selectFile } from "@/utils/fileDialogs";
import {
  buildNativeArchiveModel,
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

function NativeArchivePicker({ onSelect }: Pick<ModelSelectorProps, "onSelect">) {
  const { t } = useTranslation();
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);

  const selectArchive = () => {
    const model = buildNativeArchiveModel(path);
    if (!model) {
      setError(t("predict.model.nativeArchive.invalid", {
        defaultValue: "Choose a .n4a native archive first.",
      }));
      return;
    }
    setError(null);
    onSelect(model);
  };

  const openArchivePicker = async () => {
    const selected = await selectFile([".n4a"]);
    const selectedPath = Array.isArray(selected) ? selected[0] : selected;
    if (typeof selectedPath === "string") {
      setPath(selectedPath);
      setError(null);
      const model = buildNativeArchiveModel(selectedPath);
      if (model) onSelect(model);
    }
  };

  return (
    <Card className="border-primary/25 bg-primary/[0.03] shadow-sm">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-md bg-primary/10 p-2 text-primary">
            <Archive className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-semibold">
              {t("predict.model.nativeArchive.title", { defaultValue: "Native Archive V2" })}
            </p>
            <p className="text-xs leading-5 text-muted-foreground">
              {t("predict.model.nativeArchive.description", {
                defaultValue: "Select a portable Methods archive. Prediction stays on the native replay path.",
              })}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Input
            aria-label={t("predict.model.nativeArchive.path", { defaultValue: "Native Archive V2 path" })}
            placeholder={t("predict.model.nativeArchive.placeholder", { defaultValue: "/path/to/model.n4a" })}
            value={path}
            onChange={(event) => setPath(event.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => void openArchivePicker()}
          >
            <FolderOpen className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">
              {t("predict.model.nativeArchive.choose", { defaultValue: "Choose native archive" })}
            </span>
          </Button>
          <Button type="button" onClick={selectArchive}>
            {t("predict.model.nativeArchive.use", { defaultValue: "Use archive" })}
          </Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
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
  const nativeArchivePicker = <NativeArchivePicker onSelect={onSelect} />;

  if (isLoading) {
    return (
      <div className="space-y-3">
        {nativeArchivePicker}
        <ModelSelectorLoadingCard title={title} />
      </div>
    );
  }

  if (models.length === 0) {
    return (
      <div className="space-y-3">
        {nativeArchivePicker}
        <ModelSelectorNoModelsCard
          title={title}
          message={t("predict.model.noModels")}
          hint={t("predict.model.noModelsHint")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {nativeArchivePicker}
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
    </div>
  );
}

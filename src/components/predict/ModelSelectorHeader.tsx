import type { ComponentType } from "react";
import {
  ArrowDownAZ,
  ArrowDownWideNarrow,
  ArrowUpDown,
  Brain,
  Calendar,
  Check,
  Database,
  GitBranch,
  HardDrive,
  LineChart,
  Package,
  Search,
  Sparkles,
  Star,
  Tags,
  Trophy,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { getPredictionMetricName } from "@/lib/predict-metrics";
import { formatMetricValue } from "@/lib/scores";
import { cn } from "@/lib/utils";
import type { AvailableModel } from "@/types/predict";
import {
  getEffectiveScore,
  type ModelTaskCounts,
  type SortField,
  type TaskFilter,
} from "./ModelSelectorData";

const SORT_LABELS: Record<SortField, string> = {
  score: "Best score",
  dataset: "Dataset",
  name: "Model name",
  newest: "Newest",
  size: "File size",
};

const SORT_ICONS: Record<SortField, ComponentType<{ className?: string }>> = {
  score: Trophy,
  dataset: Database,
  name: ArrowDownAZ,
  newest: Calendar,
  size: HardDrive,
};

interface ModelSelectorHeaderProps {
  title: string;
  searchPlaceholder: string;
  selectedModel: AvailableModel | null;
  modelCount: number;
  filteredModelCount: number;
  datasetOptions: readonly string[];
  classOptions: readonly string[];
  search: string;
  onSearchChange: (value: string) => void;
  sortField: SortField;
  sortDesc: boolean;
  onSortFieldChange: (field: SortField) => void;
  onSortDescToggle: () => void;
  taskFilter: TaskFilter;
  onTaskFilterChange: (filter: TaskFilter) => void;
  taskCounts: ModelTaskCounts;
  datasetFilter: string;
  onDatasetFilterChange: (value: string) => void;
  classFilter: string;
  onClassFilterChange: (value: string) => void;
  refitOnly: boolean;
  onRefitOnlyToggle: () => void;
  activeFilterCount: number;
  onClearFilters: () => void;
}

export function ModelSelectorHeader({
  title,
  searchPlaceholder,
  selectedModel,
  modelCount,
  filteredModelCount,
  datasetOptions,
  classOptions,
  search,
  onSearchChange,
  sortField,
  sortDesc,
  onSortFieldChange,
  onSortDescToggle,
  taskFilter,
  onTaskFilterChange,
  taskCounts,
  datasetFilter,
  onDatasetFilterChange,
  classFilter,
  onClassFilterChange,
  refitOnly,
  onRefitOnlyToggle,
  activeFilterCount,
  onClearFilters,
}: ModelSelectorHeaderProps) {
  return (
    <CardHeader className="space-y-3 pb-3">
      <ModelSelectorSummaryBar
        title={title}
        modelCount={modelCount}
        filteredModelCount={filteredModelCount}
        datasetCount={datasetOptions.length}
        classCount={classOptions.length}
      />

      <SelectedModelPanel selectedModel={selectedModel} />

      <ModelSearchSortBar
        searchPlaceholder={searchPlaceholder}
        search={search}
        onSearchChange={onSearchChange}
        sortField={sortField}
        sortDesc={sortDesc}
        onSortFieldChange={onSortFieldChange}
        onSortDescToggle={onSortDescToggle}
      />

      <ModelFilterBar
        taskFilter={taskFilter}
        onTaskFilterChange={onTaskFilterChange}
        taskCounts={taskCounts}
        modelCount={modelCount}
        datasetOptions={datasetOptions}
        datasetFilter={datasetFilter}
        onDatasetFilterChange={onDatasetFilterChange}
        classOptions={classOptions}
        classFilter={classFilter}
        onClassFilterChange={onClassFilterChange}
        refitOnly={refitOnly}
        onRefitOnlyToggle={onRefitOnlyToggle}
        activeFilterCount={activeFilterCount}
        onClearFilters={onClearFilters}
      />
    </CardHeader>
  );
}

interface ModelSelectorSummaryBarProps {
  title: string;
  modelCount: number;
  filteredModelCount: number;
  datasetCount: number;
  classCount: number;
}

function ModelSelectorSummaryBar({
  title,
  modelCount,
  filteredModelCount,
  datasetCount,
  classCount,
}: ModelSelectorSummaryBarProps) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <CardTitle className="flex items-center gap-2">
          <span>{title}</span>
        </CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">
          {modelCount} models{" | "}{datasetCount} datasets{" | "}{classCount} classes
        </p>
      </div>
      <Badge variant="secondary" className="shrink-0 tabular-nums">
        {filteredModelCount}/{modelCount}
      </Badge>
    </div>
  );
}

interface SelectedModelPanelProps {
  selectedModel: AvailableModel | null;
}

function SelectedModelPanel({ selectedModel }: SelectedModelPanelProps) {
  if (selectedModel) {
    return <SelectedModelSummary model={selectedModel} />;
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-dashed border-border/60 bg-muted/20",
        "px-3 py-3 text-xs text-muted-foreground",
      )}
    >
      <div className="flex items-center gap-2 font-medium text-foreground">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        No model selected
      </div>
      <p className="mt-1">
        Pick from the ranked list below to unlock the prediction workspace.
      </p>
    </div>
  );
}

interface SelectedModelSummaryProps {
  model: AvailableModel;
}

function SelectedModelSummary({ model }: SelectedModelSummaryProps) {
  const { value, metric } = getEffectiveScore(model);

  return (
    <div
      className={cn(
        "rounded-lg border border-primary/30 bg-gradient-to-br",
        "from-primary/5 via-primary/[0.02] to-transparent p-3",
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-primary/80">
        <Check className="h-3 w-3" /> Selected
      </div>
      <p className="mt-1 truncate text-sm font-semibold">{model.name}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <Badge variant="outline" className="h-5 gap-1 px-1.5 text-[10px] font-normal">
          {model.source === "bundle" ? (
            <Package className="h-2.5 w-2.5" />
          ) : (
            <GitBranch className="h-2.5 w-2.5" />
          )}
          {model.source}
        </Badge>
        {model.model_class && (
          <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-normal">
            {model.model_class}
          </Badge>
        )}
        {model.has_refit && (
          <Badge
            variant="outline"
            className={cn(
              "h-5 gap-1 border-emerald-500/40 px-1.5 text-[10px]",
              "font-normal text-emerald-600 dark:text-emerald-400",
            )}
          >
            <Star className="h-2.5 w-2.5 fill-current" /> refit
          </Badge>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
        <span className="inline-flex items-center gap-1 truncate text-muted-foreground">
          <Database className="h-3 w-3 shrink-0" />
          <span className="truncate">{model.dataset_name || "Prediction bundle"}</span>
        </span>
        {value != null && (
          <span className="shrink-0 rounded-md bg-background px-1.5 py-0.5 font-semibold tabular-nums">
            {getPredictionMetricName(metric)} {formatMetricValue(value, metric ?? undefined)}
          </span>
        )}
      </div>
    </div>
  );
}

interface ModelSearchSortBarProps {
  searchPlaceholder: string;
  search: string;
  onSearchChange: (value: string) => void;
  sortField: SortField;
  sortDesc: boolean;
  onSortFieldChange: (field: SortField) => void;
  onSortDescToggle: () => void;
}

function ModelSearchSortBar({
  searchPlaceholder,
  search,
  onSearchChange,
  sortField,
  sortDesc,
  onSortFieldChange,
  onSortDescToggle,
}: ModelSearchSortBarProps) {
  const SortIcon = SORT_ICONS[sortField];

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={searchPlaceholder}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          className="h-8 pl-8 pr-7 text-sm"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearchChange("")}
            className={cn(
              "absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5",
              "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            aria-label="Clear search"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 px-2 text-xs"
            title={`Sort: ${SORT_LABELS[sortField]} (${sortDesc ? "desc" : "asc"})`}
          >
            <SortIcon className="h-3.5 w-3.5 text-primary" />
            <span className="max-w-[80px] truncate">{SORT_LABELS[sortField]}</span>
            <ArrowUpDown
              className={cn("h-3 w-3 transition-transform", sortDesc && "rotate-180")}
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Sort by
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={sortField}
            onValueChange={(value) => onSortFieldChange(value as SortField)}
          >
            {(Object.keys(SORT_LABELS) as SortField[]).map((field) => {
              const Icon = SORT_ICONS[field];
              return (
                <DropdownMenuRadioItem key={field} value={field} className="gap-2 text-xs">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  {SORT_LABELS[field]}
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onSortDescToggle} className="gap-2 text-xs">
            {sortDesc ? (
              <>
                <ArrowUpDown className="h-3.5 w-3.5 rotate-180 text-muted-foreground" />
                Descending {"->"} Ascending
              </>
            ) : (
              <>
                <ArrowDownWideNarrow className="h-3.5 w-3.5 text-muted-foreground" />
                Ascending {"->"} Descending
              </>
            )}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

interface ModelFilterBarProps {
  taskFilter: TaskFilter;
  onTaskFilterChange: (filter: TaskFilter) => void;
  taskCounts: ModelTaskCounts;
  modelCount: number;
  datasetOptions: readonly string[];
  datasetFilter: string;
  onDatasetFilterChange: (value: string) => void;
  classOptions: readonly string[];
  classFilter: string;
  onClassFilterChange: (value: string) => void;
  refitOnly: boolean;
  onRefitOnlyToggle: () => void;
  activeFilterCount: number;
  onClearFilters: () => void;
}

function ModelFilterBar({
  taskFilter,
  onTaskFilterChange,
  taskCounts,
  modelCount,
  datasetOptions,
  datasetFilter,
  onDatasetFilterChange,
  classOptions,
  classFilter,
  onClassFilterChange,
  refitOnly,
  onRefitOnlyToggle,
  activeFilterCount,
  onClearFilters,
}: ModelFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <ToggleGroup
        type="single"
        value={taskFilter}
        onValueChange={(value) => value && onTaskFilterChange(value as TaskFilter)}
        variant="outline"
        size="sm"
        className="h-7"
      >
        <ToggleGroupItem value="all" className="h-7 px-2 text-[11px]">
          All <span className="ml-1 text-muted-foreground/70">{modelCount}</span>
        </ToggleGroupItem>
        <ToggleGroupItem
          value="regression"
          disabled={taskCounts.regression === 0}
          className="h-7 gap-1 px-2 text-[11px]"
          title="Regression models (continuous targets)"
        >
          <LineChart className="h-3 w-3" /> Regression
          <span className="text-muted-foreground/70">{taskCounts.regression}</span>
        </ToggleGroupItem>
        <ToggleGroupItem
          value="classification"
          disabled={taskCounts.classification === 0}
          className="h-7 gap-1 px-2 text-[11px]"
          title="Classification models (discrete classes)"
        >
          <Tags className="h-3 w-3" /> Classification
          <span className="text-muted-foreground/70">{taskCounts.classification}</span>
        </ToggleGroupItem>
      </ToggleGroup>

      {datasetOptions.length > 1 && (
        <Select value={datasetFilter} onValueChange={onDatasetFilterChange}>
          <SelectTrigger className="h-7 w-[130px] gap-1 text-[11px]">
            <Database className="h-3 w-3 shrink-0" />
            <SelectValue placeholder="Dataset" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All datasets</SelectItem>
            {datasetOptions.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {classOptions.length > 1 && (
        <Select value={classFilter} onValueChange={onClassFilterChange}>
          <SelectTrigger className="h-7 w-[130px] gap-1 text-[11px]">
            <Brain className="h-3 w-3 shrink-0" />
            <SelectValue placeholder="Class" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All classes</SelectItem>
            {classOptions.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <button
        type="button"
        onClick={onRefitOnlyToggle}
        className={cn(
          "flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors",
          refitOnly
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            : "border-border/60 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
        )}
      >
        <Star className={cn("h-3 w-3", refitOnly && "fill-current")} />
        Refit only
      </button>

      {activeFilterCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearFilters}
          className="h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" />
          Clear ({activeFilterCount})
        </Button>
      )}
    </div>
  );
}

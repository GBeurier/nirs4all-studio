import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownAZ,
  ArrowDownWideNarrow,
  ArrowUpDown,
  Brain,
  Calendar,
  Check,
  Database,
  Filter,
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

import { getAvailableModels } from "@/api/predict";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { getPredictionMetricLabel, getPredictionMetricName } from "@/lib/predict-metrics";
import { formatMetricValue, getMetricDefinitions, isLowerBetter } from "@/lib/scores";
import { cn } from "@/lib/utils";
import type { AvailableModel } from "@/types/predict";

interface ModelSelectorProps {
  selectedModel: AvailableModel | null;
  onSelect: (model: AvailableModel) => void;
}

type SortField = "score" | "dataset" | "name" | "newest" | "size";
type TaskFilter = "all" | "regression" | "classification";
type TaskKind = "regression" | "classification" | "unknown";

function inferTaskKind(model: AvailableModel): TaskKind {
  const metric = (model.prediction_metric || model.metric || "").toLowerCase();
  if (!metric) return "unknown";
  const def = getMetricDefinitions([metric])[0];
  if (!def) return "unknown";
  if (def.group === "regression") return "regression";
  if (def.group === "multiclass" || def.group === "binary") return "classification";
  return "unknown";
}

const SORT_LABELS: Record<SortField, string> = {
  score: "Best score",
  dataset: "Dataset",
  name: "Model name",
  newest: "Newest",
  size: "File size",
};

const SORT_ICONS: Record<SortField, React.ComponentType<{ className?: string }>> = {
  score: Trophy,
  dataset: Database,
  name: ArrowDownAZ,
  newest: Calendar,
  size: HardDrive,
};

function hasHydratedModel(model: AvailableModel | null): boolean {
  return Boolean(
    model && (
      model.model_class ||
      model.dataset_name ||
      model.preprocessing ||
      model.prediction_score != null ||
      model.best_score != null
    )
  );
}

function effectiveScore(model: AvailableModel): { value: number | null; metric: string | null } {
  if (model.prediction_score != null) {
    return { value: model.prediction_score, metric: model.prediction_metric ?? model.metric };
  }
  if (model.best_score != null) {
    return { value: model.best_score, metric: model.metric };
  }
  return { value: null, metric: model.metric };
}

function formatFileSize(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes)) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Normalize score to 0-1 where 1 = best, 0 = worst, within a cohort.
 * Direction-aware (lower-is-better metrics invert the scale).
 */
function normalizeCohortScore(
  value: number | null,
  metric: string | null | undefined,
  min: number,
  max: number,
): number | null {
  if (value == null || !Number.isFinite(value) || max === min) return null;
  const ratio = (value - min) / (max - min);
  return isLowerBetter(metric) ? 1 - ratio : ratio;
}

function scoreToneClasses(quality: number | null): string {
  if (quality == null) {
    return "bg-muted/70 text-muted-foreground border-border/60";
  }
  if (quality >= 0.75) return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
  if (quality >= 0.5) return "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30";
  if (quality >= 0.25) return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30";
  return "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30";
}

function rankOrnamentClasses(rank: number): string {
  if (rank === 1) return "bg-gradient-to-br from-amber-300 to-amber-500 text-amber-950 shadow-sm shadow-amber-500/30";
  if (rank === 2) return "bg-gradient-to-br from-slate-300 to-slate-400 text-slate-900 shadow-sm shadow-slate-400/30";
  if (rank === 3) return "bg-gradient-to-br from-orange-300 to-orange-500 text-orange-950 shadow-sm shadow-orange-500/30";
  return "bg-muted text-muted-foreground border border-border/60";
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

  const datasetOptions = useMemo(
    () => [...new Set(models.map((m) => m.dataset_name).filter((v): v is string => !!v))].sort(),
    [models],
  );

  const classOptions = useMemo(
    () => [...new Set(models.map((m) => m.model_class).filter((v): v is string => !!v))].sort(),
    [models],
  );

  // Cohort min/max for score normalization (post-filter would be fairer, but global is more stable visually).
  const scoreCohort = useMemo(() => {
    const values = models
      .map((m) => effectiveScore(m).value)
      .filter((v): v is number => v != null && Number.isFinite(v));
    if (values.length === 0) return null;
    return { min: Math.min(...values), max: Math.max(...values) };
  }, [models]);

  const taskCounts = useMemo(() => {
    let regression = 0;
    let classification = 0;
    let unknown = 0;
    for (const m of models) {
      const kind = inferTaskKind(m);
      if (kind === "regression") regression += 1;
      else if (kind === "classification") classification += 1;
      else unknown += 1;
    }
    return { regression, classification, unknown };
  }, [models]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return models.filter((model) => {
      if (taskFilter !== "all") {
        const kind = inferTaskKind(model);
        if (kind !== taskFilter) return false;
      }
      if (datasetFilter !== "all" && model.dataset_name !== datasetFilter) return false;
      if (classFilter !== "all" && model.model_class !== classFilter) return false;
      if (refitOnly && !model.has_refit) return false;
      if (query) {
        const haystack = [
          model.name,
          model.model_class,
          model.dataset_name,
          model.preprocessing,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [models, search, taskFilter, datasetFilter, classFilter, refitOnly]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "score": {
          const sa = effectiveScore(a).value;
          const sb = effectiveScore(b).value;
          if (sa == null && sb == null) cmp = 0;
          else if (sa == null) cmp = 1;
          else if (sb == null) cmp = -1;
          else {
            const lowerBetter = isLowerBetter(effectiveScore(a).metric);
            cmp = lowerBetter ? sa - sb : sb - sa;
          }
          break;
        }
        case "dataset":
          cmp = (a.dataset_name || "").localeCompare(b.dataset_name || "");
          break;
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "newest": {
          const da = a.created_at ? new Date(a.created_at).getTime() : 0;
          const db = b.created_at ? new Date(b.created_at).getTime() : 0;
          cmp = db - da;
          break;
        }
        case "size":
          cmp = (b.file_size ?? 0) - (a.file_size ?? 0);
          break;
      }
      return sortDesc ? -cmp : cmp;
    });
    return copy;
  }, [filtered, sortField, sortDesc]);

  const activeFilterCount =
    (taskFilter !== "all" ? 1 : 0) +
    (datasetFilter !== "all" ? 1 : 0) +
    (classFilter !== "all" ? 1 : 0) +
    (refitOnly ? 1 : 0) +
    (search ? 1 : 0);

  const clearFilters = () => {
    setSearch("");
    setTaskFilter("all");
    setDatasetFilter("all");
    setClassFilter("all");
    setRefitOnly(false);
  };

  const datasetCount = datasetOptions.length;
  const classCount = classOptions.length;

  const SortIcon = SORT_ICONS[sortField];

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("predict.model.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (models.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("predict.model.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="py-10 text-center text-muted-foreground">
            <Package className="mx-auto mb-3 h-10 w-10 opacity-40" />
            <p className="font-medium">{t("predict.model.noModels")}</p>
            <p className="mt-1 text-sm">{t("predict.model.noModelsHint")}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/60 shadow-sm overflow-hidden">
      <CardHeader className="space-y-3 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <span>{t("predict.model.title")}</span>
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {models.length} models · {datasetCount} datasets · {classCount} classes
            </p>
          </div>
          <Badge variant="secondary" className="shrink-0 tabular-nums">
            {sorted.length}/{models.length}
          </Badge>
        </div>

        {/* Selected-model summary */}
        {selectedModel ? (
          <SelectedModelSummary model={selectedModel} />
        ) : (
          <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-2 font-medium text-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              No model selected
            </div>
            <p className="mt-1">Pick from the ranked list below to unlock the prediction workspace.</p>
          </div>
        )}

        {/* Search + sort */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t("predict.model.search")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-8 pl-8 pr-7 text-sm"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
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
                <ArrowUpDown className={cn("h-3 w-3 transition-transform", sortDesc && "rotate-180")} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Sort by
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={sortField}
                onValueChange={(value) => setSortField(value as SortField)}
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
              <DropdownMenuItem onClick={() => setSortDesc((v) => !v)} className="gap-2 text-xs">
                {sortDesc ? (
                  <>
                    <ArrowUpDown className="h-3.5 w-3.5 rotate-180 text-muted-foreground" />
                    Descending → Ascending
                  </>
                ) : (
                  <>
                    <ArrowDownWideNarrow className="h-3.5 w-3.5 text-muted-foreground" />
                    Ascending → Descending
                  </>
                )}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Filter row */}
        <div className="flex flex-wrap items-center gap-1.5">
          <ToggleGroup
            type="single"
            value={taskFilter}
            onValueChange={(value) => value && setTaskFilter(value as TaskFilter)}
            variant="outline"
            size="sm"
            className="h-7"
          >
            <ToggleGroupItem value="all" className="h-7 px-2 text-[11px]">
              All <span className="ml-1 text-muted-foreground/70">{models.length}</span>
            </ToggleGroupItem>
            <ToggleGroupItem
              value="regression"
              disabled={taskCounts.regression === 0}
              className="h-7 px-2 text-[11px] gap-1"
              title="Regression models (continuous targets)"
            >
              <LineChart className="h-3 w-3" /> Regression
              <span className="text-muted-foreground/70">{taskCounts.regression}</span>
            </ToggleGroupItem>
            <ToggleGroupItem
              value="classification"
              disabled={taskCounts.classification === 0}
              className="h-7 px-2 text-[11px] gap-1"
              title="Classification models (discrete classes)"
            >
              <Tags className="h-3 w-3" /> Classification
              <span className="text-muted-foreground/70">{taskCounts.classification}</span>
            </ToggleGroupItem>
          </ToggleGroup>

          {datasetCount > 1 && (
            <Select value={datasetFilter} onValueChange={setDatasetFilter}>
              <SelectTrigger className="h-7 w-[130px] text-[11px] gap-1">
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

          {classCount > 1 && (
            <Select value={classFilter} onValueChange={setClassFilter}>
              <SelectTrigger className="h-7 w-[130px] text-[11px] gap-1">
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
            onClick={() => setRefitOnly((v) => !v)}
            className={cn(
              "flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors",
              refitOnly
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-border/60 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            )}
          >
            <Star className={cn("h-3 w-3", refitOnly && "fill-current")} />
            Refit only
          </button>

          {activeFilterCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
              Clear ({activeFilterCount})
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Filter className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm font-medium">No models match</p>
            <p className="text-xs text-muted-foreground">Try adjusting filters or the search query.</p>
            {activeFilterCount > 0 && (
              <Button variant="outline" size="sm" className="mt-2 h-7 text-xs" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>
        ) : (
          <div className="max-h-[calc(100vh-24rem)] min-h-[20rem] space-y-1.5 overflow-y-auto pr-1">
            {sorted.map((model, index) => {
              const { value, metric } = effectiveScore(model);
              const quality = scoreCohort
                ? normalizeCohortScore(value, metric, scoreCohort.min, scoreCohort.max)
                : null;
              const isSelected =
                selectedModel?.id === model.id && selectedModel?.source === model.source;
              const rank = sortField === "score" && !sortDesc ? index + 1 : null;
              const date = formatDate(model.created_at);
              const size = formatFileSize(model.file_size);

              return (
                <button
                  key={`${model.source}-${model.id}`}
                  type="button"
                  onClick={() => onSelect(model)}
                  className={cn(
                    "group relative w-full overflow-hidden rounded-lg border px-2.5 py-2 text-left transition-all",
                    "hover:border-primary/40 hover:bg-accent/30",
                    isSelected
                      ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20"
                      : "border-border/60 bg-card"
                  )}
                >
                  {/* Score gradient bar (left edge) */}
                  {quality != null && (
                    <div
                      className={cn(
                        "absolute inset-y-0 left-0 w-1 transition-colors",
                        quality >= 0.75
                          ? "bg-emerald-500/70"
                          : quality >= 0.5
                          ? "bg-cyan-500/70"
                          : quality >= 0.25
                          ? "bg-amber-500/70"
                          : "bg-rose-500/70"
                      )}
                    />
                  )}

                  <div className="flex items-start gap-2.5 pl-1.5">
                    {/* Rank badge */}
                    <div
                      className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold tabular-nums",
                        rank != null && rank <= 3
                          ? rankOrnamentClasses(rank)
                          : "bg-muted/70 text-muted-foreground border border-border/60"
                      )}
                    >
                      {rank ?? (
                        model.source === "bundle" ? (
                          <Package className="h-3 w-3" />
                        ) : (
                          <GitBranch className="h-3 w-3" />
                        )
                      )}
                    </div>

                    <div className="min-w-0 flex-1 space-y-1">
                      {/* Name + refit star */}
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold">{model.name}</span>
                        {model.has_refit && (
                          <Star
                            className="h-3 w-3 shrink-0 fill-emerald-500 text-emerald-500"
                            aria-label="Has refit artifact"
                          />
                        )}
                        {isSelected && (
                          <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-primary" />
                        )}
                      </div>

                      {/* Meta: class + dataset */}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                        {model.model_class && (
                          <span className="inline-flex items-center gap-1 rounded bg-muted/60 px-1.5 py-0.5 font-medium text-foreground/80">
                            <Brain className="h-2.5 w-2.5" />
                            {model.model_class}
                          </span>
                        )}
                        {model.dataset_name && (
                          <span className="inline-flex items-center gap-1 truncate">
                            <Database className="h-2.5 w-2.5 shrink-0" />
                            <span className="truncate">{model.dataset_name}</span>
                          </span>
                        )}
                      </div>

                      {/* Preprocessing */}
                      {model.preprocessing && (
                        <p className="line-clamp-1 text-[10.5px] text-muted-foreground/80">
                          {model.preprocessing}
                        </p>
                      )}

                      {/* Footer: score + meta */}
                      <div className="flex items-center justify-between gap-2 pt-0.5">
                        <div className="flex items-center gap-1">
                          {value != null ? (
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
                                scoreToneClasses(quality)
                              )}
                              title={getPredictionMetricLabel(metric)}
                            >
                              {getPredictionMetricName(metric)}
                              <span className="font-bold">{formatMetricValue(value, metric ?? undefined)}</span>
                            </span>
                          ) : (
                            <span className="rounded-md border border-dashed border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              no score
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground/80">
                          {date && (
                            <span className="inline-flex items-center gap-0.5">
                              <Calendar className="h-2.5 w-2.5" /> {date}
                            </span>
                          )}
                          {size && (
                            <span className="inline-flex items-center gap-0.5">
                              <HardDrive className="h-2.5 w-2.5" /> {size}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SelectedModelSummary({ model }: { model: AvailableModel }) {
  const { value, metric } = effectiveScore(model);
  return (
    <div className="rounded-lg border border-primary/30 bg-gradient-to-br from-primary/5 via-primary/[0.02] to-transparent p-3">
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
          <Badge variant="outline" className="h-5 gap-1 border-emerald-500/40 px-1.5 text-[10px] font-normal text-emerald-600 dark:text-emerald-400">
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

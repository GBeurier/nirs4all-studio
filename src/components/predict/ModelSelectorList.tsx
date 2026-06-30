import {
  Brain,
  Calendar,
  Check,
  Database,
  GitBranch,
  HardDrive,
  Package,
  Star,
} from "lucide-react";

import {
  getPredictionMetricLabel,
  getPredictionMetricName,
} from "@/lib/predict-metrics";
import { formatMetricValue } from "@/lib/scores";
import { cn } from "@/lib/utils";
import type { AvailableModel } from "@/types/predict";
import {
  formatModelFileSize,
  formatRelativeModelDate,
  getEffectiveScore,
  normalizeCohortScore,
  rankOrnamentClasses,
  scoreToneClasses,
  type ScoreCohort,
  type SortField,
} from "./ModelSelectorData";

interface ModelListProps {
  models: readonly AvailableModel[];
  scoreCohort: ScoreCohort | null;
  selectedModel: AvailableModel | null;
  sortField: SortField;
  sortDesc: boolean;
  onSelect: (model: AvailableModel) => void;
}

export function ModelList({
  models,
  scoreCohort,
  selectedModel,
  sortField,
  sortDesc,
  onSelect,
}: ModelListProps) {
  return (
    <div className="max-h-[calc(100vh-24rem)] min-h-[20rem] space-y-1.5 overflow-y-auto pr-1">
      {models.map((model, index) => {
        const isSelected = selectedModel?.id === model.id && selectedModel?.source === model.source;
        const rank = sortField === "score" && !sortDesc ? index + 1 : null;

        return (
          <ModelListItem
            key={`${model.source}-${model.id}`}
            model={model}
            scoreCohort={scoreCohort}
            isSelected={isSelected}
            rank={rank}
            onSelect={onSelect}
          />
        );
      })}
    </div>
  );
}

interface ModelListItemProps {
  model: AvailableModel;
  scoreCohort: ScoreCohort | null;
  isSelected: boolean;
  rank: number | null;
  onSelect: (model: AvailableModel) => void;
}

function ModelListItem({
  model,
  scoreCohort,
  isSelected,
  rank,
  onSelect,
}: ModelListItemProps) {
  const { value, metric } = getEffectiveScore(model);
  const quality = scoreCohort
    ? normalizeCohortScore(value, metric, scoreCohort.min, scoreCohort.max)
    : null;
  const date = formatRelativeModelDate(model.created_at);
  const size = formatModelFileSize(model.file_size);

  return (
    <button
      type="button"
      onClick={() => onSelect(model)}
      className={cn(
        "group relative w-full overflow-hidden rounded-lg border px-2.5 py-2 text-left transition-all",
        "hover:border-primary/40 hover:bg-accent/30",
        isSelected
          ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20"
          : "border-border/60 bg-card",
      )}
    >
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
                  : "bg-rose-500/70",
          )}
        />
      )}

      <div className="flex items-start gap-2.5 pl-1.5">
        <RankBadge rank={rank} source={model.source} />

        <div className="min-w-0 flex-1 space-y-1">
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

          <ModelMetadata model={model} />

          {model.preprocessing && (
            <p className="line-clamp-1 text-[10.5px] text-muted-foreground/80">
              {model.preprocessing}
            </p>
          )}

          <ModelListItemFooter
            value={value}
            metric={metric}
            quality={quality}
            date={date}
            size={size}
          />
        </div>
      </div>
    </button>
  );
}

interface RankBadgeProps {
  rank: number | null;
  source: AvailableModel["source"];
}

function RankBadge({ rank, source }: RankBadgeProps) {
  return (
    <div
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold tabular-nums",
        rank != null && rank <= 3
          ? rankOrnamentClasses(rank)
          : "bg-muted/70 text-muted-foreground border border-border/60",
      )}
    >
      {rank ?? (
        source === "bundle" ? (
          <Package className="h-3 w-3" />
        ) : (
          <GitBranch className="h-3 w-3" />
        )
      )}
    </div>
  );
}

interface ModelMetadataProps {
  model: AvailableModel;
}

function ModelMetadata({ model }: ModelMetadataProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
      {model.model_class && (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded bg-muted/60 px-1.5 py-0.5",
            "font-medium text-foreground/80",
          )}
        >
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
  );
}

interface ModelListItemFooterProps {
  value: number | null;
  metric: string | null;
  quality: number | null;
  date: string | null;
  size: string | null;
}

function ModelListItemFooter({
  value,
  metric,
  quality,
  date,
  size,
}: ModelListItemFooterProps) {
  return (
    <div className="flex items-center justify-between gap-2 pt-0.5">
      <div className="flex items-center gap-1">
        {value != null ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
              scoreToneClasses(quality),
            )}
            title={getPredictionMetricLabel(metric)}
          >
            {getPredictionMetricName(metric)}
            <span className="font-bold">
              {formatMetricValue(value, metric ?? undefined)}
            </span>
          </span>
        ) : (
          <span
            className={cn(
              "rounded-md border border-dashed border-border/60 px-1.5 py-0.5",
              "text-[10px] text-muted-foreground",
            )}
          >
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
  );
}

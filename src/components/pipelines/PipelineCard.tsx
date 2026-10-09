import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { motion } from "@/lib/motion";
import {
  Boxes,
  CheckCircle2,
  Clock,
  Copy,
  Cpu,
  Download,
  GitBranch,
  MoreVertical,
  Play,
  Sparkles,
  Star,
  StarOff,
  Trash2,
  XCircle,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Pipeline } from "@/types/pipelines";
import { buildPipelinePreview, computePipelineStats } from "@/lib/pipelineStats";

interface PipelineCardProps {
  pipeline: Pipeline;
  onToggleFavorite: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onExport: () => void;
}

const categoryConfig = {
  user: { color: "text-primary bg-primary/10" },
  preset: { color: "text-accent bg-accent/10" },
  shared: { color: "text-success bg-success/10" },
};

const statusConfig = {
  success: { icon: CheckCircle2, color: "text-success" },
  failed: { icon: XCircle, color: "text-destructive" },
  running: { icon: Clock, color: "text-warning animate-pulse" },
  pending: { icon: Clock, color: "text-muted-foreground" },
};

function formatRelative(dateStr: string | undefined, t: TFunction, locale: string): string {
  if (!dateStr) return t("pipelines.collection.relative.never");
  const d = new Date(dateStr);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return t("pipelines.collection.relative.justNow");
  if (diff < 3_600_000) return t("pipelines.collection.relative.minutesAgo", { n: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t("pipelines.collection.relative.hoursAgo", { n: Math.floor(diff / 3_600_000) });
  const days = Math.floor(diff / 86_400_000);
  if (days < 7) return t("pipelines.collection.relative.daysAgo", { n: days });
  if (days < 30) return t("pipelines.collection.relative.weeksAgo", { n: Math.floor(days / 7) });
  return d.toLocaleDateString(locale);
}

function StatCell({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: string | number;
  emphasize?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <span
        className={cn(
          "font-semibold tabular-nums leading-none",
          emphasize ? "text-base text-primary" : "text-sm text-foreground"
        )}
      >
        {value}
      </span>
      <span className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

export function PipelineCard({
  pipeline,
  onToggleFavorite,
  onDuplicate,
  onDelete,
  onExport,
}: PipelineCardProps) {
  const { t, i18n } = useTranslation();
  const stats = computePipelineStats(pipeline.steps);
  const preview = buildPipelinePreview(pipeline.steps, 6);
  const isPreset = pipeline.category === "preset";

  const Status = pipeline.lastRunStatus ? statusConfig[pipeline.lastRunStatus] : null;

  return (
    <motion.div className="step-card group flex h-full flex-col" whileHover={{ y: -2 }} layout>
      <div className="mb-3 flex items-start justify-between">
        <div
          className={cn(
            "rounded px-2 py-0.5 text-xs font-medium",
            categoryConfig[pipeline.category].color
          )}
        >
          {t(`pipelines.collection.category.${pipeline.category}`)}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onToggleFavorite}
            className="rounded p-1 transition-colors hover:bg-muted"
            aria-label={pipeline.isFavorite ? t("pipelines.editor.removeFromFavorites") : t("pipelines.editor.addToFavorites")}
            aria-pressed={pipeline.isFavorite}
          >
            {pipeline.isFavorite ? (
              <Star className="h-4 w-4 fill-warning text-warning" />
            ) : (
              <StarOff className="h-4 w-4 text-muted-foreground hover:text-warning" />
            )}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="rounded p-1 transition-colors hover:bg-muted" aria-label={t("pipelines.card.moreActions")}>
                <MoreVertical className="h-4 w-4 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to={`/pipelines/${pipeline.id}`} className="flex items-center">
                  <Play className="mr-2 h-4 w-4" /> {t("pipelines.card.openAndEdit")}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDuplicate}>
                <Copy className="mr-2 h-4 w-4" /> {t("pipelines.card.duplicate")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onExport}>
                <Download className="mr-2 h-4 w-4" /> {t("pipelines.card.exportJson")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {pipeline.category === "user" && (
                <DropdownMenuItem onClick={onDelete} className="text-destructive">
                  <Trash2 className="mr-2 h-4 w-4" /> {t("common.delete")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Link to={`/pipelines/${pipeline.id}`} className="block">
        <h3 className="truncate text-base font-semibold text-foreground transition-colors group-hover:text-primary">
          {pipeline.name}
        </h3>
        {pipeline.taskType && (
          <p className="mt-0.5 text-xs capitalize text-muted-foreground">
            {pipeline.taskType === "regression" || pipeline.taskType === "classification"
              ? t(`pipelines.collection.taskType.${pipeline.taskType}`)
              : pipeline.taskType}
          </p>
        )}
      </Link>

      <div className="mt-3 grid grid-cols-4 gap-2 rounded-md border border-border/40 bg-muted/20 px-3 py-2">
        <StatCell label={t("pipelines.collection.stats.ops")} value={stats.operators} />
        <StatCell label={t("pipelines.collection.stats.models")} value={stats.models} />
        <StatCell label={t("pipelines.collection.stats.branches")} value={stats.branches} />
        <StatCell
          label={t("pipelines.collection.stats.variants")}
          value={stats.hasGenerators ? stats.variants : 1}
          emphasize={stats.hasGenerators}
        />
      </div>

      {isPreset && pipeline.description ? (
        <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">{pipeline.description}</p>
      ) : null}

      {preview.nodes.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs">
          {preview.nodes.map((node) => (
            <li
              key={node.id}
              className="flex items-center gap-2 text-muted-foreground"
              style={{ paddingLeft: `${node.depth * 12}px` }}
            >
              {node.kind === "branch" ? (
                <GitBranch className="h-3 w-3 text-accent" />
              ) : node.kind === "model" ? (
                <Cpu className="h-3 w-3 text-primary" />
              ) : (
                <Boxes className="h-3 w-3 text-muted-foreground/70" />
              )}
              <span className="truncate text-foreground/80">{node.label}</span>
              {node.hasGenerator && (
                <Sparkles className="h-3 w-3 flex-shrink-0 text-amber-500" />
              )}
            </li>
          ))}
          {preview.truncated && (
            <li className="pl-0.5 text-[11px] italic text-muted-foreground/70">
              {t("pipelines.collection.moreSteps", { count: preview.totalSteps - preview.nodes.length })}
            </li>
          )}
        </ul>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/40 pt-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          {Status && <Status.icon className={cn("h-3.5 w-3.5", Status.color)} />}
          {pipeline.runCount && pipeline.runCount > 0
            ? `${t("pipelines.card.runsCount", { count: pipeline.runCount })} · ${formatRelative(
                pipeline.lastRunDate || pipeline.updatedAt,
                t,
                i18n.language
              )}`
            : t("pipelines.card.edited", { when: formatRelative(pipeline.updatedAt, t, i18n.language) })}
        </span>
        {pipeline.tags.length > 0 && (
          <span className="flex items-center gap-1">
            {pipeline.tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="rounded bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                {tag}
              </span>
            ))}
            {pipeline.tags.length > 2 && (
              <span className="text-[10px]">+{pipeline.tags.length - 2}</span>
            )}
          </span>
        )}
      </div>
    </motion.div>
  );
}

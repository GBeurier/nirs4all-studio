/**
 * PipelineRow component for list view
 * Phase 6: Pipelines Library
 */

import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { motion } from "@/lib/motion";
import {
  GitBranch,
  Star,
  StarOff,
  MoreVertical,
  Play,
  Copy,
  Trash2,
  Download,
  Clock,
  Layers,
  CheckCircle2,
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
import { computePipelineStats } from "@/lib/pipelineStats";

interface PipelineRowProps {
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

export function PipelineRow({
  pipeline,
  onToggleFavorite,
  onDuplicate,
  onDelete,
  onExport,
}: PipelineRowProps) {
  const { t, i18n } = useTranslation();
  const stats = computePipelineStats(pipeline.steps);
  const isPreset = pipeline.category === "preset";
  // Format relative date
  const formatRelativeDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return t("pipelines.row.today");
    if (diffDays === 1) return t("pipelines.row.yesterday");
    if (diffDays < 7) return t("pipelines.row.daysAgo", { count: diffDays });
    if (diffDays < 30) return t("pipelines.row.weeksAgo", { count: Math.floor(diffDays / 7) });
    return date.toLocaleDateString(i18n.language);
  };

  return (
    <motion.div
      className="step-card flex items-center gap-4"
      whileHover={{ scale: 1.002 }}
      layout
    >
      {/* Favorite toggle */}
      <button
        type="button"
        onClick={onToggleFavorite}
        className="p-1 shrink-0"
        aria-label={pipeline.isFavorite ? t("pipelines.editor.removeFromFavorites") : t("pipelines.editor.addToFavorites")}
        aria-pressed={pipeline.isFavorite}
      >
        {pipeline.isFavorite ? (
          <Star className="h-4 w-4 text-warning fill-warning" />
        ) : (
          <StarOff className="h-4 w-4 text-muted-foreground hover:text-warning transition-colors" />
        )}
      </button>

      {/* Icon */}
      <div className="p-2 rounded-lg bg-primary/10 shrink-0">
        <GitBranch className="h-5 w-5 text-primary" />
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Link
            to={`/pipelines/${pipeline.id}`}
            className="font-semibold text-foreground hover:text-primary transition-colors truncate"
          >
            {pipeline.name}
          </Link>
          <span
            className={cn(
              "px-2 py-0.5 rounded text-xs font-medium shrink-0",
              categoryConfig[pipeline.category].color
            )}
          >
            {t(`pipelines.collection.category.${pipeline.category}`)}
          </span>
        </div>
        {isPreset && pipeline.description ? (
          <p className="text-sm text-muted-foreground truncate">{pipeline.description}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {[
              t("pipelines.row.opsCount", { count: stats.operators }),
              t("pipelines.row.modelsCount", { count: stats.models }),
              t("pipelines.row.branchesCount", { count: stats.branches }),
              ...(stats.hasGenerators ? [t("pipelines.row.variantsCount", { count: stats.variants })] : []),
            ].join(" · ")}
          </p>
        )}
      </div>

      {/* Stats */}
      <div className="hidden md:flex items-center gap-6 text-sm text-muted-foreground shrink-0">
        <span className="flex items-center gap-1">
          <Layers className="h-4 w-4" /> {t("pipelines.row.opsCount", { count: stats.operators })}
        </span>
        {pipeline.runCount !== undefined && pipeline.runCount > 0 && (
          <span className="flex items-center gap-1 w-20">
            <Play className="h-4 w-4" /> {t("pipelines.row.runsCount", { count: pipeline.runCount })}
          </span>
        )}
        <span className="flex items-center gap-1">
          {pipeline.lastRunStatus ? (
            (() => {
              const Status = statusConfig[pipeline.lastRunStatus];
              return <Status.icon className={cn("h-4 w-4", Status.color)} />;
            })()
          ) : (
            <Clock className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="text-xs">
            {pipeline.lastRunDate
              ? formatRelativeDate(pipeline.lastRunDate)
              : t("pipelines.row.updated", { when: formatRelativeDate(pipeline.updatedAt) })}
          </span>
        </span>
      </div>

      {/* Tags */}
      <div className="flex items-center gap-1 shrink-0">
        {pipeline.tags.slice(0, 2).map((tag) => (
          <span
            key={tag}
            className="text-xs px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground hidden lg:inline"
          >
            {tag}
          </span>
        ))}
      </div>

      {/* Actions */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="p-2 rounded hover:bg-muted transition-colors shrink-0" aria-label={t("pipelines.card.moreActions")}>
            <MoreVertical className="h-4 w-4 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link to={`/pipelines/${pipeline.id}`}>
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
    </motion.div>
  );
}

import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { motion } from "@/lib/motion";
import { Boxes, Cpu, FileEdit, GitBranch, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DraftEntry } from "@/hooks/useDraftPipelines";
import { buildPipelinePreview, computePipelineStats } from "@/lib/pipelineStats";

interface DraftCardProps {
  draft: DraftEntry;
  onDiscard: (id: string) => void;
}

function formatRelative(ts: number, t: TFunction): string {
  if (!ts) return t("pipelines.collection.relative.justNow");
  const diff = Date.now() - ts;
  if (diff < 60_000) return t("pipelines.collection.relative.justNow");
  if (diff < 3_600_000) return t("pipelines.collection.relative.minutesAgo", { n: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t("pipelines.collection.relative.hoursAgo", { n: Math.floor(diff / 3_600_000) });
  return t("pipelines.collection.relative.daysAgo", { n: Math.floor(diff / 86_400_000) });
}

function resolveEditorPath(id: string): string {
  return id === "new" || id.startsWith("draft-") ? `/pipelines/new?draft=${id}` : `/pipelines/${id}`;
}

function StatCell({ label, value, emphasize = false }: { label: string; value: string | number; emphasize?: boolean }) {
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

export function DraftCard({ draft, onDiscard }: DraftCardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const stats = computePipelineStats(draft.state.steps);
  const preview = buildPipelinePreview(draft.state.steps, 6);
  const isBlank = draft.state.steps.length === 0;

  return (
    <motion.div
      className="step-card group flex h-full flex-col border-amber-400/40 bg-amber-50/40 dark:border-amber-500/20 dark:bg-amber-950/10"
      whileHover={{ y: -2 }}
      layout
    >
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-1.5 rounded bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
          <FileEdit className="h-3 w-3" />
          {t("pipelines.drafts.badge")}
        </div>
        <button
          onClick={() => onDiscard(draft.id)}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
          aria-label={t("pipelines.drafts.discard")}
          title={t("pipelines.drafts.discard")}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <button
        type="button"
        onClick={() => navigate(resolveEditorPath(draft.id))}
        className="text-left"
      >
        <h3 className="truncate text-base font-semibold text-foreground transition-colors group-hover:text-primary">
          {draft.state.pipelineName || t("pipelines.drafts.untitled")}
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("pipelines.drafts.lastEdited", { when: formatRelative(draft.state.lastModified, t) })}
        </p>
      </button>

      <div className="mt-3 grid grid-cols-4 gap-2 rounded-md border border-border/40 bg-background/60 px-3 py-2">
        <StatCell label={t("pipelines.collection.stats.ops")} value={stats.operators} />
        <StatCell label={t("pipelines.collection.stats.models")} value={stats.models} />
        <StatCell label={t("pipelines.collection.stats.branches")} value={stats.branches} />
        <StatCell
          label={t("pipelines.collection.stats.variants")}
          value={stats.hasGenerators ? stats.variants : 1}
          emphasize={stats.hasGenerators}
        />
      </div>

      {isBlank ? (
        <p className="mt-3 text-xs italic text-muted-foreground">{t("pipelines.drafts.empty")}</p>
      ) : preview.nodes.length > 0 ? (
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
      ) : null}

      <div className="mt-auto flex items-center justify-between gap-2 pt-3">
        <Button
          size="sm"
          onClick={() => navigate(resolveEditorPath(draft.id))}
          className="flex-1"
        >
          {t("pipelines.drafts.resume")}
        </Button>
      </div>
    </motion.div>
  );
}

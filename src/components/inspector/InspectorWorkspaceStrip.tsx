import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pin } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { InspectorFocusLabelChain, InspectorFocusMode } from "@/lib/inspector/focus";
import { cn } from "@/lib/utils";

function StatCell({
  label,
  value,
  subvalue,
  accent = false,
  warn = false,
}: {
  label: string;
  value: string | number;
  subvalue?: string;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-3">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground select-none">
        {label}
      </span>
      <span
        className={cn(
          "text-sm font-bold tabular-nums leading-tight",
          accent && "text-primary",
          warn && "text-amber-500 dark:text-amber-400",
          !accent && !warn && "text-foreground",
        )}
      >
        {value}
      </span>
      {subvalue && (
        <span className="mt-0.5 truncate text-[11px] leading-none text-muted-foreground" title={subvalue}>
          {subvalue}
        </span>
      )}
    </div>
  );
}

export interface InspectorWorkspaceStripProps {
  bestScoreLabel: string | null;
  bestChainLabel: string | null;
  focusChains: InspectorFocusLabelChain[];
  focusMode: InspectorFocusMode;
  filteredCount: number;
  totalCount: number;
  modelCount: number;
  datasetCount: number;
  activeFilterCount: number;
  pinnedCount: number;
  mixedMetrics: boolean;
  mixedTaskTypes: boolean;
  selectionBar: ReactNode;
}

export function InspectorWorkspaceStrip({
  bestScoreLabel,
  bestChainLabel,
  focusChains,
  focusMode,
  filteredCount,
  totalCount,
  modelCount,
  datasetCount,
  activeFilterCount,
  pinnedCount,
  mixedMetrics,
  mixedTaskTypes,
  selectionBar,
}: InspectorWorkspaceStripProps) {
  const { t } = useTranslation();
  const focusModeLabel = focusMode === "selection"
    ? t("inspector.strip.modes.selection")
    : focusMode === "pinned"
      ? t("inspector.strip.modes.pinned")
      : t("inspector.strip.modes.auto");
  const focusAccent = focusMode !== "top";

  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card/70 shadow-sm">
      <div className="grid grid-cols-5 divide-x divide-border/40">
        <StatCell label={t("inspector.strip.chains")} value={`${filteredCount} / ${totalCount}`} />
        <StatCell label={t("inspector.strip.models")} value={modelCount} />
        <StatCell label={t("inspector.strip.datasets")} value={datasetCount} />
        <StatCell
          label={t("inspector.strip.bestScore")}
          value={bestScoreLabel ?? "\u2014"}
          subvalue={bestChainLabel ?? undefined}
          accent={Boolean(bestScoreLabel)}
        />
        <StatCell label={t("inspector.strip.focusMode")} value={focusModeLabel} accent={focusAccent} />
      </div>

      <div className="flex min-h-9 flex-wrap items-center gap-1.5 border-t border-border/40 bg-muted/10 px-4 py-2">
        <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground select-none">
          {t("inspector.strip.focus")}
        </span>
        {focusChains.length > 0 ? (
          focusChains.map(chain => (
            <Badge key={chain.chain_id} variant="secondary" className="max-w-[200px] truncate text-[11px]">
              {chain.label}
            </Badge>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">{t("inspector.strip.noChains")}</span>
        )}
        {(mixedMetrics || mixedTaskTypes) && (
          <Badge variant="outline" className="ml-2 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">
            {t("inspector.strip.mixedScope")}
          </Badge>
        )}
        {activeFilterCount > 0 && (
          <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
            {t("inspector.strip.filtersActive", { count: activeFilterCount })}
          </Badge>
        )}
        {pinnedCount > 0 && (
          <Badge variant="outline" className="gap-1">
            <Pin className="h-3 w-3" />
            {t("inspector.counts.pinned", { count: pinnedCount })}
          </Badge>
        )}
      </div>

      {selectionBar && (
        <div className="border-t border-border/40 px-4 py-2">
          {selectionBar}
        </div>
      )}
    </div>
  );
}

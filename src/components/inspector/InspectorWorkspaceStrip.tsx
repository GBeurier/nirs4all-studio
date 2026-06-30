import type { ReactNode } from "react";
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
  const focusModeLabel = focusMode === "selection" ? "Selection" : focusMode === "pinned" ? "Pinned" : "Auto";
  const focusAccent = focusMode !== "top";

  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card/70 shadow-sm">
      <div className="grid grid-cols-5 divide-x divide-border/40">
        <StatCell label="Chains" value={`${filteredCount} / ${totalCount}`} />
        <StatCell label="Models" value={modelCount} />
        <StatCell label="Datasets" value={datasetCount} />
        <StatCell
          label="Best Score"
          value={bestScoreLabel ?? "\u2014"}
          subvalue={bestChainLabel ?? undefined}
          accent={Boolean(bestScoreLabel)}
        />
        <StatCell label="Focus Mode" value={focusModeLabel} accent={focusAccent} />
      </div>

      <div className="flex min-h-9 flex-wrap items-center gap-1.5 border-t border-border/40 bg-muted/10 px-4 py-2">
        <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground select-none">
          Focus
        </span>
        {focusChains.length > 0 ? (
          focusChains.map(chain => (
            <Badge key={chain.chain_id} variant="secondary" className="max-w-[200px] truncate text-[11px]">
              {chain.label}
            </Badge>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">No chains in scope.</span>
        )}
        {(mixedMetrics || mixedTaskTypes) && (
          <Badge variant="outline" className="ml-2 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">
            mixed scope
          </Badge>
        )}
        {activeFilterCount > 0 && (
          <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
            {activeFilterCount} filters active
          </Badge>
        )}
        {pinnedCount > 0 && (
          <Badge variant="outline" className="gap-1">
            <Pin className="h-3 w-3" />
            {pinnedCount} pinned
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

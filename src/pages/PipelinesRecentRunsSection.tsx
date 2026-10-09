import { Clock3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { motion } from "@/lib/motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, SearchEmptyState } from "@/components/ui/state-display";
import { cn } from "@/lib/utils";
import type { RecentRunEntry } from "./pipelinesData";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

const RUN_STATUS_KEYS = { completed: true, failed: true, running: true } as const;

export interface RecentRunsSectionProps {
  filteredRecentRuns: RecentRunEntry[];
  normalizedQuery: string;
  onOpenBestChain: (entry: RecentRunEntry) => void | Promise<void>;
  onOpenMyPipelines: () => void;
  onSearchClear: () => void;
  searchQuery: string;
}

export function RecentRunsSection({
  filteredRecentRuns,
  normalizedQuery,
  onOpenBestChain,
  onOpenMyPipelines,
  onSearchClear,
  searchQuery,
}: RecentRunsSectionProps) {
  const { t, i18n } = useTranslation();

  if (!filteredRecentRuns.length) {
    return normalizedQuery ? (
      <SearchEmptyState query={searchQuery} onClear={onSearchClear} />
    ) : (
      <EmptyState
        icon={Clock3}
        title={t("pipelines.recentRuns.emptyTitle")}
        description={t("pipelines.recentRuns.emptyDescription")}
        action={{ label: t("pipelines.library.openMyPipelines"), onClick: onOpenMyPipelines }}
      />
    );
  }

  return (
    <motion.ul
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-2"
    >
      {filteredRecentRuns.map((entry) => (
        <motion.li
          key={entry.listKey}
          variants={itemVariants}
          className="step-card flex flex-wrap items-center justify-between gap-3"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void onOpenBestChain(entry)}
                className="truncate text-sm font-semibold text-foreground hover:text-primary"
              >
                {entry.pipelineName}
              </button>
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] uppercase",
                  entry.status === "completed" && "border-green-500/40 text-green-600 dark:text-green-400",
                  entry.status === "failed" && "border-destructive/40 text-destructive",
                  entry.status === "running" && "border-amber-500/40 text-amber-600 dark:text-amber-400"
                )}
              >
                {entry.status in RUN_STATUS_KEYS
                  ? t(`pipelines.recentRuns.status.${entry.status as keyof typeof RUN_STATUS_KEYS}`)
                  : entry.status}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("pipelines.recentRuns.runLine", {
                dataset: entry.datasetName,
                run: entry.runName,
                date: new Date(entry.createdAt).toLocaleString(i18n.language),
              })}
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            {typeof entry.score === "number" && (
              <span className="tabular-nums text-foreground">
                {entry.scoreMetric ?? t("pipelines.recentRuns.defaultMetric")}: {entry.score.toFixed(3)}
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => void onOpenBestChain(entry)}
            >
              {t("pipelines.recentRuns.openBestChain")}
            </Button>
          </div>
        </motion.li>
      ))}
    </motion.ul>
  );
}

import { Clock3 } from "lucide-react";
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
  if (!filteredRecentRuns.length) {
    return normalizedQuery ? (
      <SearchEmptyState query={searchQuery} onClear={onSearchClear} />
    ) : (
      <EmptyState
        icon={Clock3}
        title="No recent runs"
        description="Launch a run from a pipeline to see its history here."
        action={{ label: "Open My Pipelines", onClick: onOpenMyPipelines }}
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
                {entry.status}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {entry.datasetName} {"\u00b7"} run {entry.runName} {"\u00b7"}{" "}
              {new Date(entry.createdAt).toLocaleString()}
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            {typeof entry.score === "number" && (
              <span className="tabular-nums text-foreground">
                {entry.scoreMetric ?? "score"}: {entry.score.toFixed(3)}
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => void onOpenBestChain(entry)}
            >
              Open best chain
            </Button>
          </div>
        </motion.li>
      ))}
    </motion.ul>
  );
}

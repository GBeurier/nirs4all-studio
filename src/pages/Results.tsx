import { useState, useMemo } from "react";
import { MlLoadingOverlay } from "@/components/layout/MlLoadingOverlay";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { motion } from "@/lib/motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RefreshCw, Database, Box, Search, BarChart3, Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  isBetterScore,
  formatScore,
  formatMetricName,
  getBestCvEntry,
  getBestFinalEntry,
} from "@/lib/scores";
import { NoWorkspaceState, NoResultsState, CardSkeleton } from "@/components/ui/state-display";
import { getWorkspaceResultsSummary } from "@/api/client";
import type { DatasetTopChains } from "@/types/runs";
import { MetricSelector, useMetricSelection } from "@/components/scores/MetricSelector";
import { DatasetResultCard } from "@/components/scores/DatasetResultCard";
import type { EnrichedDatasetRun } from "@/types/enriched-runs";
import { useLinkedWorkspacesQuery } from "@/hooks/useDatasetQueries";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

/** Adapt DatasetTopChains to the EnrichedDatasetRun shape expected by DatasetResultCard. */
function adaptToEnrichedDataset(d: DatasetTopChains): EnrichedDatasetRun {
  const bestFinalChain = getBestFinalEntry(d.top_chains, d.metric);
  const bestCvChain = getBestCvEntry(d.top_chains, d.metric);
  return {
    dataset_name: d.dataset_name,
    best_avg_val_score: bestCvChain?.avg_val_score ?? null,
    best_avg_test_score: bestCvChain?.avg_test_score ?? null,
    best_final_score: bestFinalChain?.final_test_score ?? null,
    metric: d.metric,
    task_type: d.task_type,
    gain_from_previous_best: null,
    pipeline_count: d.top_chains.length,
    top_5: d.top_chains,
  };
}

export default function Results() {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");

  // Detect task type from data for metric selector
  const [selectedMetrics, setSelectedMetrics] = useMetricSelection("results", "regression");

  const { data: workspacesData } = useLinkedWorkspacesQuery();
  const activeWorkspace = workspacesData?.workspaces.find(w => w.is_active) ?? null;

  const { data: summaryData, isLoading, refetch } = useQuery({
    queryKey: ["results-summary", activeWorkspace?.id],
    queryFn: () => getWorkspaceResultsSummary(activeWorkspace!.id),
    enabled: !!activeWorkspace,
    staleTime: 30000,
  });

  const datasets = useMemo<DatasetTopChains[]>(() => summaryData?.datasets || [], [summaryData]);

  // Stats
  const stats = useMemo(() => {
    const totalModels = datasets.reduce((sum, d) => sum + d.top_chains.length, 0);
    let bestFinal: number | null = null;
    let bestFinalMetric: string | null = null;
    let bestFinalModel: string | null = null;
    let bestCV: number | null = null;
    let bestCVMetric: string | null = null;
    for (const d of datasets) {
      for (const chain of d.top_chains) {
        if (chain.final_test_score != null) {
          if (bestFinal == null || isBetterScore(chain.final_test_score, bestFinal, d.metric)) {
            bestFinal = chain.final_test_score;
            bestFinalMetric = d.metric;
            bestFinalModel = chain.model_name;
          }
        }
        if (chain.avg_val_score != null) {
          if (bestCV == null || isBetterScore(chain.avg_val_score, bestCV, d.metric)) {
            bestCV = chain.avg_val_score;
            bestCVMetric = d.metric;
          }
        }
      }
    }
    return { datasetCount: datasets.length, totalModels, bestFinal, bestFinalMetric, bestFinalModel, bestCV, bestCVMetric, hasFinal: bestFinal != null };
  }, [datasets]);

  const filteredDatasets = useMemo(
    () => datasets.filter(d => d.dataset_name.toLowerCase().includes(searchQuery.toLowerCase())),
    [datasets, searchQuery],
  );

  // Loading
  if (isLoading) {
    return (
      <motion.div className="space-y-6" variants={containerVariants} initial="hidden" animate="visible">
        <motion.div variants={itemVariants}>
          <h1 className="text-2xl font-bold tracking-tight">{t("results.title")}</h1>
          <p className="text-muted-foreground">{t("results.loading")}</p>
        </motion.div>
        <div className="grid gap-4 md:grid-cols-3">
          {[...Array(3)].map((_, i) => <Card key={i} className="glass-card"><CardContent className="p-4"><Skeleton className="h-12 w-full" /></CardContent></Card>)}
        </div>
        <CardSkeleton count={3} />
      </motion.div>
    );
  }

  // No workspace
  if (!activeWorkspace) {
    return (
      <motion.div className="space-y-6" variants={containerVariants} initial="hidden" animate="visible">
        <motion.div variants={itemVariants}>
          <h1 className="text-2xl font-bold tracking-tight">{t("results.title")}</h1>
          <p className="text-muted-foreground">{t("results.subtitle")}</p>
        </motion.div>
        <NoWorkspaceState title="No workspace linked" description="Link a nirs4all workspace to view results. Go to Settings to configure." />
      </motion.div>
    );
  }

  return (
    <MlLoadingOverlay>
    <motion.div className="space-y-5" variants={containerVariants} initial="hidden" animate="visible">
      {/* Header */}
      <motion.div variants={itemVariants} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("results.title")}</h1>
          <p className="text-muted-foreground text-sm">Workspace: {activeWorkspace.name}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <MetricSelector taskType={datasets[0]?.task_type || "regression"} selectedMetrics={selectedMetrics} onSelectedMetricsChange={setSelectedMetrics} />
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button variant="outline" size="sm" disabled>
            <Download className="h-4 w-4 mr-1" /> Export
          </Button>
        </div>
      </motion.div>

      {/* Stats */}
      <div className="grid gap-3 md:grid-cols-3">
        <Card className="glass-card">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10"><Database className="h-5 w-5 text-primary" /></div>
            <div>
              <p className="text-xs text-muted-foreground">{t("results.stats.datasets")}</p>
              <p className="text-2xl font-bold">{stats.datasetCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10"><Box className="h-5 w-5 text-primary" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Top Models</p>
              <p className="text-2xl font-bold">{stats.totalModels}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-3 flex items-center gap-3">
            <div className={cn("p-2 rounded-lg", stats.hasFinal ? "bg-emerald-500/10" : "bg-chart-1/10")}>
              <BarChart3 className={cn("h-5 w-5", stats.hasFinal ? "text-emerald-500" : "text-chart-1")} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground">{stats.hasFinal ? "Best Final" : "Best CV"}</p>
              <div className="flex items-baseline gap-1.5">
                <p className={cn("text-2xl font-bold font-mono tabular-nums", stats.hasFinal ? "text-emerald-500" : "text-foreground")}>
                  {formatScore(stats.hasFinal ? stats.bestFinal : stats.bestCV)}
                </p>
                <span className="text-[10px] text-muted-foreground uppercase">
                  {formatMetricName(stats.hasFinal ? stats.bestFinalMetric : stats.bestCVMetric)}
                </span>
              </div>
              {stats.bestFinalModel && stats.hasFinal && (
                <p className="text-[10px] text-muted-foreground font-mono truncate">{stats.bestFinalModel}</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search datasets..." className="pl-9 h-8 text-sm" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
        </div>
      </div>

      {/* Dataset Cards */}
      {filteredDatasets.length === 0 ? (
        <NoResultsState
          title={t("results.noResults", { defaultValue: "No results found" })}
          description="Run experiments to generate results."
        />
      ) : (
        <div className="space-y-3">
          {filteredDatasets.map((dataset, idx) => (
            <motion.div key={dataset.dataset_name} variants={itemVariants}>
              <DatasetResultCard
                dataset={adaptToEnrichedDataset(dataset)}
                selectedMetrics={selectedMetrics}
                workspaceId={activeWorkspace.id}
                defaultExpanded={idx === 0}
              />
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
    </MlLoadingOverlay>
  );
}

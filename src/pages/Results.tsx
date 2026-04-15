import { useState, useMemo } from "react";
import { MlLoadingOverlay } from "@/components/layout/MlLoadingOverlay";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { motion } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  RefreshCw, Search, Download,
} from "lucide-react";
import {
  collectPresentMetricKeys,
  getBestCvEntry,
  getBestFinalEntry,
  getDefaultSelectedMetricsForTaskTypes,
  getDefaultSelectionUpgradeCandidatesForTaskTypes,
  getLegacySelectedMetricsForTaskTypes,
  isClassificationTaskType,
  orderMetricKeys,
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

  const { data: workspacesData } = useLinkedWorkspacesQuery();
  const activeWorkspace = workspacesData?.workspaces.find(w => w.is_active) ?? null;

  const { data: summaryData, isLoading, refetch } = useQuery({
    queryKey: ["results-summary", activeWorkspace?.id],
    queryFn: () => getWorkspaceResultsSummary(activeWorkspace!.id),
    enabled: !!activeWorkspace,
    staleTime: 30000,
  });

  const datasets = useMemo<DatasetTopChains[]>(() => summaryData?.datasets || [], [summaryData]);

  const filteredDatasets = useMemo(
    () => datasets.filter(d => d.dataset_name.toLowerCase().includes(searchQuery.toLowerCase())),
    [datasets, searchQuery],
  );

  const metricSourceDatasets = filteredDatasets.length > 0 ? filteredDatasets : datasets;
  const metricContext = useMemo(() => {
    const taskTypes = new Set<string>();
    const availableMetricKeys = new Set<string>();

    for (const dataset of metricSourceDatasets) {
      if (isClassificationTaskType(dataset.task_type)) {
        taskTypes.add("classification");
      } else if (dataset.task_type) {
        taskTypes.add("regression");
      }

      if (dataset.metric) {
        const hasPrimaryScore = dataset.top_chains.some(chain =>
          chain.avg_val_score != null
          || chain.avg_test_score != null
          || chain.avg_train_score != null
          || chain.final_test_score != null
          || chain.final_train_score != null,
        );
        if (hasPrimaryScore) {
          availableMetricKeys.add(dataset.metric);
        }
      }

      for (const chain of dataset.top_chains) {
        for (const key of collectPresentMetricKeys(
          chain.scores?.val as Record<string, unknown> | undefined,
          chain.scores?.test as Record<string, unknown> | undefined,
          chain.final_scores as Record<string, unknown> | undefined,
          chain.final_agg_scores as Record<string, unknown> | undefined,
        )) {
          availableMetricKeys.add(key);
        }
      }
    }

    return {
      taskType: taskTypes.size === 1 ? [...taskTypes][0] : null,
      taskTypes: [...taskTypes],
      availableMetricKeys: orderMetricKeys([...availableMetricKeys]),
    };
  }, [metricSourceDatasets]);

  const [selectedMetrics, setSelectedMetrics] = useMetricSelection(
    "results",
    metricContext.taskType,
    getDefaultSelectedMetricsForTaskTypes(metricContext.taskTypes),
    getLegacySelectedMetricsForTaskTypes(metricContext.taskTypes),
    "task-aware-defaults-v1",
    metricContext.availableMetricKeys,
    getDefaultSelectionUpgradeCandidatesForTaskTypes(metricContext.taskTypes),
  );

  // Loading
  if (isLoading) {
    return (
      <motion.div className="space-y-6" variants={containerVariants} initial="hidden" animate="visible">
        <motion.div variants={itemVariants}>
          <h1 className="text-2xl font-bold tracking-tight">{t("results.title")}</h1>
          <p className="text-muted-foreground">{t("results.loading")}</p>
        </motion.div>
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
          <MetricSelector
            taskType={metricContext.taskType}
            taskTypes={metricContext.taskTypes}
            selectedMetrics={selectedMetrics}
            onSelectedMetricsChange={setSelectedMetrics}
            availableMetricKeys={metricContext.availableMetricKeys}
          />
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button variant="outline" size="sm" disabled>
            <Download className="h-4 w-4 mr-1" /> Export
          </Button>
        </div>
      </motion.div>

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
          {filteredDatasets.map((dataset) => (
            <motion.div key={dataset.dataset_name} variants={itemVariants}>
              <DatasetResultCard
                dataset={adaptToEnrichedDataset(dataset)}
                selectedMetrics={selectedMetrics}
                workspaceId={activeWorkspace.id}
                defaultExpanded={false}
              />
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
    </MlLoadingOverlay>
  );
}

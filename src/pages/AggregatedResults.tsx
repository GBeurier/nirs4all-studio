/**
 * AggregatedResults page — displays chain-level aggregated predictions
 * from the SQLite store via the /api/aggregated-predictions endpoint.
 *
 * Hierarchy: Run → Pipeline → Chain → Partition predictions.
 * The page shows one row per (chain, metric, dataset) combination with
 * min/avg/max scores across folds. Clicking a row opens ChainDetailSheet.
 */

import { useTranslation } from "react-i18next";
import { motion } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import {
  BarChart3,
  Search,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  NoWorkspaceState,
  ErrorState,
  LoadingState,
  EmptyState,
} from "@/components/ui/state-display";
import { ChainDetailSheet } from "@/components/predictions/ChainDetailSheet";
import {
  AggregatedResultsDeveloperSqlPanel,
  AggregatedResultsFilters,
  AggregatedResultsStatsBar,
  AggregatedResultsTable,
} from "@/components/results";
import { PredictionViewer } from "@/components/predictions/viewer/PredictionViewer";
import { useAggregatedResultsPageState } from "@/hooks/useAggregatedResultsPageState";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
};

export default function AggregatedResults() {
  const { t } = useTranslation();
  const state = useAggregatedResultsPageState();

  // Error state
  if (state.emptyError) {
    if (state.isNoWorkspaceError) {
      return <NoWorkspaceState />;
    }
    return <ErrorState message={state.emptyError} onRetry={state.loadData} />;
  }

  return (
    <motion.div
      className="flex flex-col gap-6 p-6"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Header */}
      <motion.div variants={itemVariants} className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t("aggregatedResults.title", "Aggregated Results")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t("aggregatedResults.subtitle", "Chain-level model performance across folds and partitions")}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={state.loadData} disabled={state.loading}>
          <RefreshCw className={cn("h-4 w-4 mr-1", state.loading && "animate-spin")} />
          {t("common.refresh", "Refresh")}
        </Button>
      </motion.div>

      {/* Stats bar */}
      {!state.loading && state.displayPredictions.length > 0 && (
        <motion.div variants={itemVariants}>
          <AggregatedResultsStatsBar stats={state.stats} />
        </motion.div>
      )}

      {/* Filters */}
      {!state.loading && state.displayPredictions.length > 0 && (
        <motion.div variants={itemVariants}>
          <AggregatedResultsFilters
            search={state.search}
            datasetFilter={state.datasetFilter}
            modelClassFilter={state.modelClassFilter}
            metricFilter={state.metricFilter}
            facets={state.facets}
            hasActiveFilters={state.hasActiveFilters}
            searchPlaceholder={`${t("common.search", "Search")}...`}
            clearLabel={t("common.clear", "Clear")}
            onSearchChange={state.setSearch}
            onDatasetFilterChange={state.setDatasetFilter}
            onModelClassFilterChange={state.setModelClassFilter}
            onMetricFilterChange={state.setMetricFilter}
            onClearFilters={state.clearFilters}
          />
        </motion.div>
      )}

      {/* Loading */}
      {state.loading && <LoadingState message={t("aggregatedResults.loading", "Loading aggregated results...")} />}

      {/* Empty */}
      {!state.loading && state.displayPredictions.length === 0 && !state.error && (
        <EmptyState
          icon={BarChart3}
          title={t("aggregatedResults.empty", "No aggregated results yet")}
          description={t(
            "aggregatedResults.emptyHint",
            "Run a pipeline to generate prediction results that will be aggregated here."
          )}
        />
      )}

      {/* Results table */}
      {!state.loading && state.filtered.length > 0 && (
        <motion.div variants={itemVariants}>
          {state.isDeveloperMode && (
            <AggregatedResultsDeveloperSqlPanel
              sql={state.sql}
              onSqlChange={state.setSql}
              loading={state.sqlLoading}
              error={state.sqlError}
              result={state.sqlResult}
              onRun={state.handleRunSql}
            />
          )}

          <AggregatedResultsTable
            filteredCount={state.filtered.length}
            totalCount={state.displayPredictions.length}
            refitPredictions={state.refitFiltered}
            cvPredictions={state.cvFiltered}
            sortKey={state.sortKey}
            sortAsc={state.sortAsc}
            expandedChainId={state.expandedChainId}
            workspaceId={state.activeWorkspaceId}
            onSort={state.handleSort}
            onExpandedChainChange={state.setExpandedChainId}
            onViewChart={(prediction) => { void state.handleViewChainChart(prediction); }}
            onViewDetails={state.openPredictionDetails}
            onDeleted={() => { void state.loadData(); }}
            onViewPrediction={state.handleViewPrediction}
          />
        </motion.div>
      )}

      {/* No matches after filtering */}
      {!state.loading && state.displayPredictions.length > 0 && state.filtered.length === 0 && (
        <motion.div variants={itemVariants}>
          <EmptyState
            icon={Search}
            title="No matching results"
            description="Try adjusting your filters or search terms."
          />
        </motion.div>
      )}

      {/* Detail sheet */}
      <ChainDetailSheet
        chainId={state.selectedChainId}
        metric={state.selectedMetric}
        metaHint={state.selectedDetailMetaHint}
        focus={state.selectedDetailFocus}
        open={state.sheetOpen}
        onOpenChange={state.setSheetOpen}
        isViewerOpen={state.viewerOpen}
        onOpenViewer={state.openViewer}
      />

      {/* Unified prediction viewer */}
      {state.viewerHeader && (
        <PredictionViewer
          open={state.viewerOpen}
          onOpenChange={state.setViewerOpen}
          header={state.viewerHeader}
          partitions={state.viewerPartitions}
          workspaceId={state.activeWorkspaceId}
          initialKind={state.viewerInitialKind}
        />
      )}
    </motion.div>
  );
}

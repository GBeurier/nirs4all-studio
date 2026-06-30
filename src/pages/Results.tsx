import { MlLoadingOverlay } from "@/components/layout/MlLoadingOverlay";
import { useTranslation } from "react-i18next";
import { motion } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  RefreshCw, Search, Download,
} from "lucide-react";
import { NoWorkspaceState, NoResultsState, CardSkeleton } from "@/components/ui/state-display";
import { MetricSelector } from "@/components/scores/MetricSelector";
import { DatasetResultCard } from "@/components/scores/DatasetResultCard";
import { useResultsPageState } from "@/hooks/useResultsPageState";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

export default function Results() {
  const { t } = useTranslation();
  const state = useResultsPageState();

  // Loading
  if (state.isLoading) {
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

  const activeWorkspace = state.activeWorkspace;

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
	            taskType={state.metricContext.taskType}
	            taskTypes={state.metricContext.taskTypes}
	            selectedMetrics={state.selectedMetrics}
	            onSelectedMetricsChange={state.setSelectedMetrics}
	            availableMetricKeys={state.metricContext.availableMetricKeys}
	          />
	          <Button variant="outline" size="sm" onClick={() => { void state.refetch(); }}>
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
	          <Input
	            placeholder="Search datasets..."
	            className="pl-9 h-8 text-sm"
	            value={state.searchQuery}
	            onChange={event => state.setSearchQuery(event.target.value)}
	          />
	        </div>
	      </div>

	      {/* Dataset Cards */}
	      {state.filteredDatasets.length === 0 ? (
	        <NoResultsState
	          title={t("results.noResults", { defaultValue: "No results found" })}
	          description="Run experiments to generate results."
        />
	      ) : (
	        <div className="space-y-3">
	          {state.adaptedDatasets.map((dataset) => (
	            <motion.div key={dataset.dataset_name} variants={itemVariants}>
	              <DatasetResultCard
	                dataset={dataset}
	                selectedMetrics={state.selectedMetrics}
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

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { motion } from "@/lib/motion";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Database,
  Box,
  Search,
  ExternalLink,
  BarChart3,
  Download,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { isBetterScore, formatScore, formatMetricName } from "@/lib/scores";
import { NoWorkspaceState, NoResultsState, CardSkeleton } from "@/components/ui/state-display";
import {
  getLinkedWorkspaces,
  getWorkspaceResultsSummary,
} from "@/api/client";
import type { DatasetTopChains } from "@/types/runs";
import { TopScoreItem } from "@/components/runs/TopScoreItem";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

export default function Results() {
  const { t } = useTranslation();
  const [expandedDatasets, setExpandedDatasets] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch linked workspaces
  const { data: workspacesData } = useQuery({
    queryKey: ["linked-workspaces"],
    queryFn: getLinkedWorkspaces,
    staleTime: 30000,
  });

  const activeWorkspace = workspacesData?.workspaces.find((w) => w.is_active) ?? null;

  // Fetch results summary from DuckDB
  const {
    data: summaryData,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["results-summary", activeWorkspace?.id],
    queryFn: () => getWorkspaceResultsSummary(activeWorkspace!.id),
    enabled: !!activeWorkspace,
    staleTime: 30000,
  });

  const datasets = useMemo<DatasetTopChains[]>(
    () => summaryData?.datasets || [],
    [summaryData],
  );

  // Auto-expand first dataset on initial load
  useMemo(() => {
    if (datasets.length > 0 && expandedDatasets.size === 0) {
      setExpandedDatasets(new Set([datasets[0].dataset_name]));
    }
  }, [datasets, expandedDatasets.size]);

  const toggleDataset = (name: string) => {
    setExpandedDatasets((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

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
    return {
      datasetCount: datasets.length,
      totalModels,
      bestFinal,
      bestFinalMetric,
      bestFinalModel,
      bestCV,
      bestCVMetric,
      hasFinal: bestFinal != null,
    };
  }, [datasets]);

  // Filter by search
  const filteredDatasets = useMemo(() => {
    return datasets.filter((d) =>
      d.dataset_name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [datasets, searchQuery]);

  // Loading
  if (isLoading) {
    return (
      <motion.div className="space-y-6" variants={containerVariants} initial="hidden" animate="visible">
        <motion.div variants={itemVariants} className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t("results.title")}</h1>
            <p className="text-muted-foreground">{t("results.loading")}</p>
          </div>
        </motion.div>
        <div className="grid gap-4 md:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <Card key={i} className="glass-card">
              <CardContent className="p-4"><Skeleton className="h-12 w-full" /></CardContent>
            </Card>
          ))}
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
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t("results.title")}</h1>
            <p className="text-muted-foreground">{t("results.subtitle")}</p>
          </div>
        </motion.div>
        <motion.div variants={itemVariants}>
          <NoWorkspaceState
            title={t("results.noWorkspace", { defaultValue: "No workspace linked" })}
            description={t("results.noWorkspaceHint", { defaultValue: "Link a nirs4all workspace to view results and training history. Go to Settings to configure your workspace." })}
          />
        </motion.div>
      </motion.div>
    );
  }

  return (
    <motion.div className="space-y-6" variants={containerVariants} initial="hidden" animate="visible">
      {/* Header */}
      <motion.div variants={itemVariants} className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("results.title")}</h1>
          <p className="text-muted-foreground">Workspace: {activeWorkspace.name}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </motion.div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="glass-card">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Database className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("results.stats.datasets")}</p>
              <p className="text-2xl font-bold text-foreground">{stats.datasetCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Box className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Top Models</p>
              <p className="text-2xl font-bold text-foreground">{stats.totalModels}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4 flex items-center gap-3">
            <div className={cn("p-2 rounded-lg", stats.hasFinal ? "bg-emerald-500/10" : "bg-chart-1/10")}>
              <BarChart3 className={cn("h-5 w-5", stats.hasFinal ? "text-emerald-500" : "text-chart-1")} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-muted-foreground">{stats.hasFinal ? "Best Final Score" : "Best CV Score"}</p>
              <div className="flex items-baseline gap-1.5">
                <p className={cn("text-2xl font-bold font-mono tabular-nums", stats.hasFinal ? "text-emerald-500" : "text-foreground")}>
                  {stats.hasFinal
                    ? formatScore(stats.bestFinal)
                    : formatScore(stats.bestCV)}
                </p>
                <span className="text-xs text-muted-foreground uppercase">
                  {formatMetricName(stats.hasFinal ? stats.bestFinalMetric : stats.bestCVMetric)}
                </span>
              </div>
              {stats.bestFinalModel && stats.hasFinal && (
                <p className="text-xs text-muted-foreground font-mono truncate mt-0.5">{stats.bestFinalModel}</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="flex gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("results.filters.searchPlaceholder")}
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Datasets with top models */}
      {filteredDatasets.length === 0 ? (
        <NoResultsState
          title={t("results.noResults", { defaultValue: "No results found" })}
          description={t("results.noResultsHint", { defaultValue: "Run experiments to generate results. Compare model performance, view prediction plots, and analyze residuals." })}
        />
      ) : (
        <div className="space-y-4">
          {filteredDatasets.map((dataset) => {
            const isExpanded = expandedDatasets.has(dataset.dataset_name);
            const finalChain = dataset.top_chains.find(c => c.final_test_score != null);
            const topChain = dataset.top_chains[0];
            const bestFinalScore = finalChain?.final_test_score ?? null;
            const bestCvScore = topChain?.avg_val_score;
            const displayScore = bestFinalScore ?? bestCvScore;

            return (
              <Card key={dataset.dataset_name} className="overflow-hidden">
                <Collapsible open={isExpanded} onOpenChange={() => toggleDataset(dataset.dataset_name)}>
                  <CollapsibleTrigger asChild>
                    <CardHeader className="p-4 cursor-pointer hover:bg-muted/30 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          {isExpanded ? (
                            <ChevronDown className="h-5 w-5 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-5 w-5 text-muted-foreground" />
                          )}
                          <div className="p-2 rounded-lg bg-primary/10">
                            <Database className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <h3 className="font-semibold text-foreground">{dataset.dataset_name}</h3>
                            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Box className="h-3.5 w-3.5" />
                                {dataset.top_chains.length} models
                              </span>
                              {dataset.metric && (
                                <>
                                  <span>•</span>
                                  <span>{dataset.metric.toUpperCase()}</span>
                                </>
                              )}
                              {dataset.task_type && (
                                <>
                                  <span>•</span>
                                  <span className="capitalize">{dataset.task_type}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          {displayScore != null && (
                            <Badge variant="outline" className={cn(
                              "font-mono",
                              bestFinalScore != null
                                ? "text-emerald-500 border-emerald-500/30"
                                : "text-chart-1 border-chart-1/30",
                            )}>
                              {bestFinalScore != null ? "Final" : "CV"}{dataset.metric ? ` ${formatMetricName(dataset.metric)}` : ""} {formatScore(displayScore)}
                            </Badge>
                          )}
                          <Button variant="ghost" size="sm" asChild onClick={(e) => e.stopPropagation()}>
                            <Link to={`/datasets/${encodeURIComponent(dataset.dataset_name)}`}>
                              <ExternalLink className="h-4 w-4 mr-1" />
                              Dataset
                            </Link>
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <CardContent className="px-4 pb-4 pt-0 space-y-1">
                      {dataset.top_chains.length > 0 ? (
                        dataset.top_chains.map((chain, index) => (
                          <TopScoreItem
                            key={chain.chain_id}
                            chain={chain}
                            rank={index + 1}
                            taskType={dataset.task_type}
                            runId={chain.run_id || ""}
                            datasetName={dataset.dataset_name}
                          />
                        ))
                      ) : (
                        <div className="text-sm text-muted-foreground text-center py-4">
                          No scored models available
                        </div>
                      )}
                    </CardContent>
                  </CollapsibleContent>
                </Collapsible>
              </Card>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}

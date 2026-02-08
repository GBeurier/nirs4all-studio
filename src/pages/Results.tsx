import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "@/lib/motion";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Play,
  Clock,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  CircleDashed,
  Eye,
  ChevronDown,
  ChevronRight,
  Database,
  Layers,
  Box,
  Settings2,
  Search,
  FolderOpen,
  ExternalLink,
  ArrowUp,
  ArrowDown,
  Calendar,
  BarChart3,
  Download,
  Trophy,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { PipelineRun, runStatusConfig, RunStatus, Result, RunMetrics } from "@/types/runs";
import { ResultDetailSheet } from "@/components/results/ResultDetailSheet";
import { NoWorkspaceState, ErrorState, NoResultsState, CardSkeleton } from "@/components/ui/state-display";
import {
  getLinkedWorkspaces,
  getN4AWorkspaceResults,
} from "@/api/client";
import type {
  LinkedWorkspace,
} from "@/types/linked-workspaces";

/**
 * A dataset with its associated pipeline results
 * This is the primary display unit on the Results page
 */
interface DatasetWithResults {
  dataset_name: string;
  pipelines: PipelineRun[];
  total_predictions: number;
  created_at: string;
}

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

const statusIcons = {
  queued: Clock,
  running: RefreshCw,
  completed: CheckCircle2,
  failed: AlertCircle,
  paused: Clock,
  partial: CircleDashed,
};

function mapResultToMetrics(result: Result): RunMetrics | undefined {
  if (result.best_score == null) return undefined;
  const metric = result.metric?.toLowerCase() || "";
  if (metric.includes("rmse")) {
    return { r2: 0, rmse: result.best_score };
  }
  if (metric.includes("r2")) {
    return { r2: result.best_score, rmse: 0 };
  }
  return { r2: result.best_score, rmse: 0 };
}

/**
 * Transform workspace results into datasets with their pipelines.
 * Groups results by dataset - pipelines are directly under datasets.
 */
function transformResults(results: Result[]): DatasetWithResults[] {
  const resultsByDataset = results.reduce((acc, result) => {
    const datasetName = result.dataset || "Unknown";
    if (!acc[datasetName]) {
      acc[datasetName] = [];
    }
    acc[datasetName].push(result);
    return acc;
  }, {} as Record<string, Result[]>);

  return Object.entries(resultsByDataset).map(([datasetName, datasetResults]) => {
    const sortedResults = [...datasetResults].sort((a, b) => {
      return (a.pipeline_config || "").localeCompare(b.pipeline_config || "");
    });

    const firstResult = sortedResults[0];

    const pipelines: PipelineRun[] = sortedResults.map((result) => {
      const primaryModel = result.best_model || extractModelFromName(result.pipeline_config);
      return {
        id: result.id,
        pipeline_id: result.pipeline_config_id,
        pipeline_name: result.pipeline_config || result.pipeline_config_id,
        model: primaryModel,
        preprocessing: extractPreprocessingFromName(result.pipeline_config),
        split_strategy: "CV",
        status: "completed" as RunStatus,
        progress: 100,
        metrics: mapResultToMetrics(result),
        score: result.best_score ?? null,
        score_metric: result.metric ?? null,
        val_score: result.val_score ?? result.best_score ?? null,
        test_score: result.test_score ?? null,
        has_refit: result.has_refit ?? false,
        is_final_model: result.has_refit ?? false,
        refit_model_id: result.refit_model_id,
        started_at: result.created_at || undefined,
      };
    });

    const totalPredictions = sortedResults.reduce(
      (sum, r) => sum + (r.predictions_count || 0),
      0
    );

    return {
      dataset_name: datasetName,
      pipelines,
      total_predictions: totalPredictions,
      created_at: firstResult?.created_at || new Date().toISOString(),
    };
  });
}

/**
 * Extract model name from pipeline name
 */
function extractModelFromName(name: string | undefined): string {
  if (!name) return "Unknown";
  const modelPatterns = [
    /\b(PLS|PLSRegression)\b/i,
    /\b(RF|RandomForest)\b/i,
    /\b(SVR|SVM)\b/i,
    /\b(XGB|XGBoost)\b/i,
    /\b(LGBM|LightGBM)\b/i,
    /\b(CNN|CNN1D)\b/i,
    /\b(MLP|NeuralNet)\b/i,
    /\b(Ridge)\b/i,
    /\b(Lasso)\b/i,
    /\b(ElasticNet)\b/i,
  ];

  for (const pattern of modelPatterns) {
    const match = name.match(pattern);
    if (match) return match[1].toUpperCase();
  }

  return "Model";
}

/**
 * Extract preprocessing name from pipeline name
 */
function extractPreprocessingFromName(name: string | undefined): string {
  if (!name) return "None";
  const prepPatterns = [
    /\b(SNV)\b/i,
    /\b(MSC)\b/i,
    /\b(SG|SavitzkyGolay)\b/i,
    /\b(Detrend)\b/i,
    /\b(Normalize)\b/i,
    /\b(StandardScaler)\b/i,
    /\b(MinMaxScaler)\b/i,
  ];

  for (const pattern of prepPatterns) {
    const match = name.match(pattern);
    if (match) return match[1].toUpperCase();
  }

  return "None";
}

type PipelineSortField = "name" | "score" | "date";
type SortOrder = "asc" | "desc";

export default function Results() {
  const { t } = useTranslation();
  const [datasets, setDatasets] = useState<DatasetWithResults[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<LinkedWorkspace | null>(null);
  const [expandedDatasets, setExpandedDatasets] = useState<Set<string>>(new Set());
  const [selectedPipeline, setSelectedPipeline] = useState<{pipeline: PipelineRun; datasetName: string} | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [pipelineSortField, setPipelineSortField] = useState<PipelineSortField>("score");
  const [pipelineSortOrder, setPipelineSortOrder] = useState<SortOrder>("desc");

  // Load workspace and results on mount
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Get active workspace
      const workspacesRes = await getLinkedWorkspaces();
      const active = workspacesRes.workspaces.find((w) => w.is_active);

      if (!active) {
        setActiveWorkspace(null);
        setDatasets([]);
        setIsLoading(false);
        return;
      }

      setActiveWorkspace(active);

      // Load results from workspace
      const resultsRes = await getN4AWorkspaceResults(active.id);
      const transformedDatasets = transformResults(resultsRes.results || []);
      setDatasets(transformedDatasets);

      // Expand first dataset by default
      if (transformedDatasets.length > 0) {
        setExpandedDatasets(new Set([transformedDatasets[0].dataset_name]));
      }
    } catch (err) {
      console.error("[Results] Error loading results:", err);
      setError(err instanceof Error ? err.message : "Failed to load results");
    } finally {
      setIsLoading(false);
    }
  };

  const openResultDetails = (pipeline: PipelineRun, datasetName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedPipeline({ pipeline, datasetName });
    setSheetOpen(true);
  };

  const toggleDataset = (name: string) => {
    setExpandedDatasets((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  // Compute stats from datasets
  const stats = useMemo(() => {
    const allPipelines = datasets.flatMap(d => d.pipelines);
    const completedCount = allPipelines.filter((p) => p.status === "completed").length;
    const failedCount = allPipelines.filter((p) => p.status === "failed").length;
    const totalPipelines = allPipelines.length;
    const bestScore = allPipelines.reduce((best, p) => {
      const candidate = p.score ?? p.metrics?.r2 ?? p.metrics?.rmse ?? 0;
      return Math.max(best, candidate);
    }, 0);
    return { completedCount, failedCount, totalPipelines, datasetCount: datasets.length, bestScore };
  }, [datasets]);

  // Filter datasets by search query
  const filteredDatasets = useMemo(() => {
    return datasets.filter((d) =>
      d.dataset_name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [datasets, searchQuery]);

  const getDatasetStats = (dataset: DatasetWithResults) => {
    const pipelineCount = dataset.pipelines.length;
    const models = new Set(dataset.pipelines.map((p) => p.model));
    const completedCount = dataset.pipelines.filter(p => p.status === "completed").length;
    const bestScore = Math.max(...dataset.pipelines.map(p => p.score ?? p.metrics?.r2 ?? p.metrics?.rmse ?? 0));
    return { pipelineCount, modelCount: models.size, completedCount, bestScore };
  };

  // Sort pipelines based on current sort settings
  const sortPipelines = (pipelines: PipelineRun[]): PipelineRun[] => {
    return [...pipelines].sort((a, b) => {
      let comparison = 0;

      switch (pipelineSortField) {
        case "score":
          comparison = (a.score ?? a.metrics?.r2 ?? a.metrics?.rmse ?? 0) - (b.score ?? b.metrics?.r2 ?? b.metrics?.rmse ?? 0);
          break;
        case "date":
          comparison = (a.started_at || "").localeCompare(b.started_at || "");
          break;
        case "name":
        default:
          comparison = (a.pipeline_name || "").localeCompare(b.pipeline_name || "");
          break;
      }

      return pipelineSortOrder === "desc" ? -comparison : comparison;
    });
  };

  const toggleSort = (field: PipelineSortField) => {
    if (pipelineSortField === field) {
      setPipelineSortOrder(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setPipelineSortField(field);
      setPipelineSortOrder(field === "score" ? "desc" : "asc");
    }
  };

  // Loading skeleton
  if (isLoading) {
    return (
      <motion.div
        className="space-y-6"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={itemVariants} className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t("results.title")}</h1>
            <p className="text-muted-foreground">{t("results.loading")}</p>
          </div>
        </motion.div>
        <div className="grid gap-4 md:grid-cols-5">
          {[...Array(5)].map((_, i) => (
            <Card key={i} className="glass-card">
              <CardContent className="p-4">
                <Skeleton className="h-12 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
        <CardSkeleton count={3} />
      </motion.div>
    );
  }

  // No workspace linked
  if (!activeWorkspace) {
    return (
      <motion.div
        className="space-y-6"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={itemVariants}>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t("results.title")}</h1>
            <p className="text-muted-foreground">
              {t("results.subtitle")}
            </p>
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

  // Error state
  if (error) {
    return (
      <motion.div
        className="space-y-6"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={itemVariants}>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t("results.title")}</h1>
            <p className="text-muted-foreground">
              {t("results.subtitle")}
            </p>
          </div>
        </motion.div>
        <motion.div variants={itemVariants}>
          <ErrorState
            title={t("results.error", { defaultValue: "Failed to load results" })}
            message={error}
            onRetry={loadData}
          />
        </motion.div>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="space-y-6"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Header */}
      <motion.div
        variants={itemVariants}
        className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("results.title")}</h1>
          <p className="text-muted-foreground">
            Workspace: {activeWorkspace.name}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadData}>
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
      <div className="grid gap-4 md:grid-cols-5">
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
              <Layers className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("results.stats.pipelines")}</p>
              <p className="text-2xl font-bold text-foreground">{stats.totalPipelines}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-chart-1/10">
              <CheckCircle2 className="h-5 w-5 text-chart-1" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("results.stats.completed")}</p>
              <p className="text-2xl font-bold text-foreground">{stats.completedCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-destructive/10">
              <AlertCircle className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("results.stats.failed")}</p>
              <p className="text-2xl font-bold text-foreground">{stats.failedCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-chart-1/10">
              <BarChart3 className="h-5 w-5 text-chart-1" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Best Score</p>
              <p className="text-2xl font-bold text-foreground">{stats.bestScore.toFixed(3)}</p>
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

      {/* Datasets with Results List */}
      {filteredDatasets.length === 0 ? (
        <div>
          <NoResultsState
            title={t("results.noResults", { defaultValue: "No results found" })}
            description={t("results.noResultsHint", { defaultValue: "Run experiments to generate results. Compare model performance, view prediction plots, and analyze residuals." })}
          />
        </div>
      ) : (
        <div className="space-y-4">
          {filteredDatasets.map((dataset) => {
            const { pipelineCount, modelCount, completedCount, bestScore } = getDatasetStats(dataset);
            const isExpanded = expandedDatasets.has(dataset.dataset_name);
            const hasFailedPipelines = dataset.pipelines.some(p => p.status === "failed");

            return (
              <Card key={dataset.dataset_name} className="overflow-hidden">
                <Collapsible
                  open={isExpanded}
                  onOpenChange={() => toggleDataset(dataset.dataset_name)}
                >
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
                            <h3 className="font-semibold text-foreground">
                              {dataset.dataset_name}
                            </h3>
                            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Layers className="h-3.5 w-3.5" />
                                {pipelineCount} pipelines
                              </span>
                              <span>•</span>
                              <span className="flex items-center gap-1">
                                <Box className="h-3.5 w-3.5" />
                                {modelCount} models
                              </span>
                              <span>•</span>
                              <span className="flex items-center gap-1">
                                <CheckCircle2 className="h-3.5 w-3.5 text-chart-1" />
                                {completedCount} completed
                              </span>
                              {dataset.total_predictions > 0 && (
                                <>
                                  <span>•</span>
                                  <span>{dataset.total_predictions} predictions</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          {bestScore > 0 && (
                            <Badge variant="outline" className="text-chart-1 border-chart-1/30">
                              Best Score {bestScore.toFixed(3)}
                            </Badge>
                          )}
                          {hasFailedPipelines && (
                            <Badge variant="destructive" className="text-xs">
                              <AlertCircle className="h-3 w-3 mr-1" />
                              Failed
                            </Badge>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            asChild
                            onClick={(e) => e.stopPropagation()}
                          >
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
                    <CardContent className="px-4 pb-4 pt-0 space-y-2">
                      {/* Sort controls for pipelines */}
                      <div className="flex items-center justify-end gap-1 mb-2">
                        <span className="text-xs text-muted-foreground mr-2">Sort by:</span>
                        <Button
                          variant={pipelineSortField === "score" ? "secondary" : "ghost"}
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => toggleSort("score")}
                        >
                          Score
                          {pipelineSortField === "score" && (
                            pipelineSortOrder === "desc" ? <ArrowDown className="h-3 w-3 ml-1" /> : <ArrowUp className="h-3 w-3 ml-1" />
                          )}
                        </Button>
                        <Button
                          variant={pipelineSortField === "date" ? "secondary" : "ghost"}
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => toggleSort("date")}
                        >
                          <Calendar className="h-3 w-3 mr-1" />
                          Date
                          {pipelineSortField === "date" && (
                            pipelineSortOrder === "desc" ? <ArrowDown className="h-3 w-3 ml-1" /> : <ArrowUp className="h-3 w-3 ml-1" />
                          )}
                        </Button>
                        <Button
                          variant={pipelineSortField === "name" ? "secondary" : "ghost"}
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => toggleSort("name")}
                        >
                          Name
                          {pipelineSortField === "name" && (
                            pipelineSortOrder === "desc" ? <ArrowDown className="h-3 w-3 ml-1" /> : <ArrowUp className="h-3 w-3 ml-1" />
                          )}
                        </Button>
                      </div>

                      {/* Pipeline list directly under dataset */}
                      {sortPipelines(dataset.pipelines).map((pipeline) => {
                        const PipelineStatusIcon = statusIcons[pipeline.status];
                        const pipelineConfig = runStatusConfig[pipeline.status];
                        return (
                          <div
                            key={pipeline.id}
                            className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/20 transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <PipelineStatusIcon
                                className={cn(
                                  "h-4 w-4",
                                  pipelineConfig.color,
                                  pipelineConfig.iconClass
                                )}
                              />
                              <span className="text-sm font-medium text-foreground">
                                {pipeline.pipeline_name}
                              </span>
                              <Badge variant="outline" className="text-xs">
                                {pipeline.model === "Unknown" ? t("results.unknown") : pipeline.model === "Model" ? t("results.model") : pipeline.model}
                              </Badge>
                              <Badge variant="secondary" className="text-xs">
                                {pipeline.preprocessing === "None" ? t("results.none") : pipeline.preprocessing}
                              </Badge>
                              {pipeline.has_refit && (
                                <Badge className="text-xs bg-emerald-500/15 text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/20" variant="outline">
                                  <Trophy className="h-3 w-3 mr-1" />
                                  Final Model
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-4">
                              {pipeline.status === "running" && (
                                <div className="flex items-center gap-2 w-32">
                                  <Progress
                                    value={pipeline.progress}
                                    className="h-1.5"
                                  />
                                  <span className="text-xs text-muted-foreground">
                                    {pipeline.progress}%
                                  </span>
                                </div>
                              )}
                              {(pipeline.score != null || pipeline.val_score != null || pipeline.test_score != null || pipeline.metrics?.r2 != null || pipeline.metrics?.rmse != null) && (
                                <div className="flex gap-3 text-xs">
                                  {/* CV Score */}
                                  {pipeline.val_score != null ? (
                                    <span className="text-chart-1 font-semibold" title="Cross-validation score">
                                      CV {pipeline.val_score.toFixed(3)}
                                    </span>
                                  ) : pipeline.score != null ? (
                                    <span className="text-chart-1 font-semibold">
                                      {(pipeline.score_metric || "Score").toUpperCase()} {pipeline.score.toFixed(3)}
                                    </span>
                                  ) : pipeline.metrics?.r2 != null ? (
                                    <span className="text-chart-1 font-semibold">
                                      R² {pipeline.metrics.r2.toFixed(3)}
                                    </span>
                                  ) : null}
                                  {/* Final Score (from refit) */}
                                  {pipeline.test_score != null && (
                                    <span className="text-emerald-500 font-semibold" title="Final model score (refit on full data)">
                                      Final {pipeline.test_score.toFixed(3)}
                                    </span>
                                  )}
                                  {pipeline.metrics?.rmse != null && pipeline.metrics.rmse > 0 && (
                                    <span className="text-muted-foreground">
                                      RMSE {pipeline.metrics.rmse.toFixed(2)}
                                    </span>
                                  )}
                                </div>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => openResultDetails(pipeline, dataset.dataset_name, e)}
                              >
                                <Eye className="h-3.5 w-3.5 mr-1" />
                                Details
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </CardContent>
                  </CollapsibleContent>
                </Collapsible>
              </Card>
            );
          })}
        </div>
      )}

      <ResultDetailSheet
        pipeline={selectedPipeline?.pipeline ?? null}
        datasetName={selectedPipeline?.datasetName ?? ""}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </motion.div>
  );
}

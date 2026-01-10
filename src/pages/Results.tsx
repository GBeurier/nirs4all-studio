import { useState, useEffect, useMemo } from "react";
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
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { PipelineRun, runStatusConfig, RunStatus } from "@/types/runs";
import { ResultDetailSheet } from "@/components/results/ResultDetailSheet";
import {
  getLinkedWorkspaces,
  getN4AWorkspaceRuns,
} from "@/api/client";
import type {
  LinkedWorkspace,
  DiscoveredRun,
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

/**
 * Transform discovered runs from workspace API into datasets with their results
 * Groups results by dataset - pipelines are directly under datasets
 */
function transformDiscoveredRuns(discoveredRuns: DiscoveredRun[]): DatasetWithResults[] {
  // Group runs by dataset
  const runsByDataset = discoveredRuns.reduce((acc, run) => {
    const datasetName = run.dataset;
    if (!acc[datasetName]) {
      acc[datasetName] = [];
    }
    acc[datasetName].push(run);
    return acc;
  }, {} as Record<string, DiscoveredRun[]>);

  // Create a DatasetWithResults for each dataset
  return Object.entries(runsByDataset).map(([datasetName, datasetRuns]) => {
    // Sort runs by name (config_name)
    const sortedRuns = [...datasetRuns].sort((a, b) => {
      return (a.name || "").localeCompare(b.name || "");
    });

    // Use first run info for the parent
    const firstRun = sortedRuns[0];

    // Transform each discovered run into a PipelineRun
    const pipelines: PipelineRun[] = sortedRuns.map((run) => {
      // Get primary model from the models array
      const primaryModel = run.models?.[0] || extractModelFromName(run.name);

      return {
        id: run.id,
        pipeline_id: run.pipeline_id,
        pipeline_name: run.name || run.pipeline_id,
        model: primaryModel,
        preprocessing: extractPreprocessingFromName(run.name),
        split_strategy: "CV",
        status: "completed" as RunStatus,
        progress: 100,
        metrics: run.best_val_score != null || run.best_test_score != null
          ? {
              r2: run.best_val_score ?? 0,
              rmse: 0, // Not available in this view
            }
          : undefined,
        started_at: run.created_at || undefined,
      };
    });

    // Calculate overall stats
    const totalPredictions = sortedRuns.reduce((sum, r) => sum + (r.predictions_count || 0), 0);

    return {
      dataset_name: datasetName,
      pipelines,
      total_predictions: totalPredictions,
      created_at: firstRun.created_at || new Date().toISOString(),
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

      // Load runs from workspace
      const runsRes = await getN4AWorkspaceRuns(active.id);
      const transformedDatasets = transformDiscoveredRuns(runsRes.runs || []);
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
    const bestR2 = allPipelines.reduce((best, p) => Math.max(best, p.metrics?.r2 ?? 0), 0);
    return { completedCount, failedCount, totalPipelines, datasetCount: datasets.length, bestR2 };
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
    const bestR2 = Math.max(...dataset.pipelines.map(p => p.metrics?.r2 ?? 0));
    return { pipelineCount, modelCount: models.size, completedCount, bestR2 };
  };

  // Sort pipelines based on current sort settings
  const sortPipelines = (pipelines: PipelineRun[]): PipelineRun[] => {
    return [...pipelines].sort((a, b) => {
      let comparison = 0;

      switch (pipelineSortField) {
        case "score":
          comparison = (a.metrics?.r2 ?? 0) - (b.metrics?.r2 ?? 0);
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
            <h1 className="text-2xl font-bold tracking-tight">Results</h1>
            <p className="text-muted-foreground">Loading workspace results...</p>
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
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-16 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
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
            <h1 className="text-2xl font-bold tracking-tight">Results</h1>
            <p className="text-muted-foreground">
              View and compare model performance across experiments
            </p>
          </div>
        </motion.div>
        <motion.div variants={itemVariants}>
          <Card>
            <CardContent className="p-12">
              <div className="flex flex-col items-center justify-center text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 mb-4">
                  <FolderOpen className="h-10 w-10 text-primary" />
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-2">
                  No workspace linked
                </h3>
                <p className="text-muted-foreground max-w-md mb-6">
                  Link a nirs4all workspace to view results and training history.
                  Go to Settings to configure your workspace.
                </p>
                <Button asChild>
                  <Link to="/settings">
                    <Settings2 className="mr-2 h-4 w-4" />
                    Go to Settings
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
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
            <h1 className="text-2xl font-bold tracking-tight">Results</h1>
            <p className="text-muted-foreground">
              View and compare model performance across experiments
            </p>
          </div>
        </motion.div>
        <motion.div variants={itemVariants}>
          <Card className="border-destructive/50">
            <CardContent className="p-8">
              <div className="flex flex-col items-center justify-center text-center">
                <AlertCircle className="h-12 w-12 text-destructive mb-4" />
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  Failed to load results
                </h3>
                <p className="text-muted-foreground mb-4">{error}</p>
                <Button onClick={loadData} variant="outline">
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Retry
                </Button>
              </div>
            </CardContent>
          </Card>
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
          <h1 className="text-2xl font-bold tracking-tight">Results</h1>
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
              <p className="text-sm text-muted-foreground">Datasets</p>
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
              <p className="text-sm text-muted-foreground">Pipelines</p>
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
              <p className="text-sm text-muted-foreground">Completed</p>
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
              <p className="text-sm text-muted-foreground">Failed</p>
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
              <p className="text-sm text-muted-foreground">Best R²</p>
              <p className="text-2xl font-bold text-foreground">{stats.bestR2.toFixed(3)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="flex gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search datasets..."
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Datasets with Results List */}
      {filteredDatasets.length === 0 ? (
        <div>
          <Card>
            <CardContent className="p-12">
              <div className="flex flex-col items-center justify-center text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 mb-4">
                  <BarChart3 className="h-10 w-10 text-primary" />
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-2">
                  No results found
                </h3>
                <p className="text-muted-foreground max-w-md mb-6">
                  Run experiments to generate results. Compare model performance,
                  view prediction plots, and analyze residuals.
                </p>
                <Button asChild>
                  <Link to="/runs">
                    <Play className="mr-2 h-4 w-4" />
                    Go to Runs
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredDatasets.map((dataset) => {
            const { pipelineCount, modelCount, completedCount, bestR2 } = getDatasetStats(dataset);
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
                          {bestR2 > 0 && (
                            <Badge variant="outline" className="text-chart-1 border-chart-1/30">
                              Best R² {bestR2.toFixed(3)}
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
                                {pipeline.model}
                              </Badge>
                              <Badge variant="secondary" className="text-xs">
                                {pipeline.preprocessing}
                              </Badge>
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
                              {pipeline.metrics && (
                                <div className="flex gap-3 text-xs">
                                  <span className="text-chart-1 font-semibold">
                                    R² {pipeline.metrics.r2.toFixed(3)}
                                  </span>
                                  {pipeline.metrics.rmse > 0 && (
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

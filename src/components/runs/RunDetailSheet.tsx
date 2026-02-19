import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  CheckCircle2,
  Clock,
  RefreshCw,
  AlertCircle,
  Pause,
  CircleDashed,
  Database,
  Layers,
  Box,
  BarChart3,
  ExternalLink,
  Target,
  Award,
  HardDrive,
  Settings2,
  Trophy,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Check,
} from "lucide-react";
import { PredictDialog } from "./PredictDialog";
import { ScoreHistogram } from "./ScoreHistogram";
import { cn } from "@/lib/utils";
import {
  formatScore, formatMetricName, formatMetricValue,
  isLowerBetter,
  extractFinalMetrics, extractCVMetrics,
  type MetricEntry,
} from "@/lib/scores";
import { RunStatus, runStatusConfig } from "@/types/runs";
import type { EnrichedRun, EnrichedDatasetRun, TopChainResult } from "@/types/enriched-runs";
import type { ChainSummary } from "@/types/aggregated-predictions";
import { getAggregatedPredictions, getScoreDistribution } from "@/api/client";

// ---------------------------------------------------------------------------
// Props & helpers
// ---------------------------------------------------------------------------

interface RunDetailSheetProps {
  run: EnrichedRun | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
}

const statusIcons = {
  queued: Clock,
  running: RefreshCw,
  completed: CheckCircle2,
  failed: AlertCircle,
  paused: Pause,
  partial: CircleDashed,
};

const StatusIcon = ({ status }: { status: RunStatus }) => {
  const Icon = statusIcons[status];
  const config = runStatusConfig[status];
  if (!Icon || !config) return null;
  return <Icon className={cn("h-4 w-4", config.color, config.iconClass)} />;
};

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "-";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatDatetime(iso: string | null): string {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function RunDetailSheet({ run, open, onOpenChange, workspaceId }: RunDetailSheetProps) {
  const [activeTab, setActiveTab] = useState("overview");

  // Predict dialog state
  const [predictDialogOpen, setPredictDialogOpen] = useState(false);
  const [predictChain, setPredictChain] = useState<{ chain: TopChainResult; datasetName: string } | null>(null);

  const handlePredict = (chain: TopChainResult, datasetName: string) => {
    setPredictChain({ chain, datasetName });
    setPredictDialogOpen(true);
  };

  if (!run) return null;

  const status = (run.status || "completed") as RunStatus;
  const config = runStatusConfig[status] || runStatusConfig.completed;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-4xl overflow-hidden flex flex-col">
        {/* ---- Header ---- */}
        <SheetHeader className="flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={cn("p-2 rounded-lg", config.bg)}>
                <StatusIcon status={status} />
              </div>
              <div>
                <SheetTitle className="text-lg">{run.name || run.run_id}</SheetTitle>
                <SheetDescription className="flex items-center gap-2 mt-1 flex-wrap">
                  <span>{formatDatetime(run.created_at)}</span>
                  {run.completed_at && (
                    <>
                      <span>&rarr;</span>
                      <span>{formatDatetime(run.completed_at)}</span>
                    </>
                  )}
                  {run.duration_seconds != null && (
                    <>
                      <span>&bull;</span>
                      <span className="font-medium">{formatDuration(run.duration_seconds)}</span>
                    </>
                  )}
                </SheetDescription>
              </div>
            </div>
            <Badge variant={status === "completed" ? "default" : "secondary"}>
              {config.label}
            </Badge>
          </div>

          {/* Summary stat cards */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-4">
            <StatCard icon={Database} label="Datasets" value={run.datasets_count} />
            <StatCard icon={Layers} label="Pipelines" value={run.pipeline_runs_count} />
            <StatCard icon={Target} label="Final Models" value={run.final_models_count} accent />
            <StatCard icon={Box} label="Trained" value={run.total_models_trained} />
            <StatCard icon={Layers} label="Folds" value={run.total_folds} />
            <StatCard icon={HardDrive} label="Size" value={formatBytes(run.artifact_size_bytes)} />
          </div>
        </SheetHeader>

        <Separator className="my-4" />

        {/* ---- Tabs ---- */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="grid w-full grid-cols-3 flex-shrink-0">
            <TabsTrigger value="overview" className="text-xs">
              <BarChart3 className="h-3.5 w-3.5 mr-1.5" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="leaderboard" className="text-xs">
              <Trophy className="h-3.5 w-3.5 mr-1.5" />
              Leaderboard
            </TabsTrigger>
            <TabsTrigger value="datasets" className="text-xs">
              <Database className="h-3.5 w-3.5 mr-1.5" />
              Datasets
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1 mt-4">
            <TabsContent value="overview" className="m-0">
              <OverviewTab run={run} />
            </TabsContent>
            <TabsContent value="leaderboard" className="m-0">
              <LeaderboardTab run={run} open={open} activeTab={activeTab} onPredict={handlePredict} />
            </TabsContent>
            <TabsContent value="datasets" className="m-0">
              <DatasetsTab run={run} workspaceId={workspaceId} onPredict={handlePredict} />
            </TabsContent>
          </ScrollArea>
        </Tabs>

        {/* Predict Dialog */}
        {predictChain && (
          <PredictDialog
            open={predictDialogOpen}
            onOpenChange={setPredictDialogOpen}
            modelId={predictChain.chain.chain_id}
            modelName={predictChain.chain.model_name}
            pipelineId={predictChain.chain.chain_id}
            pipelineName={`${predictChain.chain.model_name} (${predictChain.chain.preprocessings || "none"})`}
            runId={run.run_id}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

function StatCard({ icon: Icon, label, value, accent }: {
  icon: typeof Database;
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div className={cn("p-2.5 rounded-lg text-center", accent ? "bg-chart-1/10" : "bg-muted/30")}>
      <Icon className={cn("h-3.5 w-3.5 mx-auto mb-0.5", accent ? "text-chart-1" : "text-muted-foreground")} />
      <p className="text-base font-semibold">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 1: Overview
// ---------------------------------------------------------------------------

function OverviewTab({ run }: { run: EnrichedRun }) {
  // Derive unique preprocessings from top chains
  const uniquePreprocessings = useMemo(() => {
    const set = new Set<string>();
    run.datasets.forEach(ds => ds.top_5.forEach(c => {
      if (c.preprocessings) set.add(c.preprocessings);
    }));
    return Array.from(set);
  }, [run.datasets]);

  return (
    <div className="space-y-4">
      {/* Error */}
      {run.error && (
        <div className="p-4 rounded-lg border border-destructive/30 bg-destructive/5">
          <h4 className="font-medium text-sm flex items-center gap-2 text-destructive">
            <AlertCircle className="h-4 w-4" />
            Error
          </h4>
          <p className="text-sm text-muted-foreground mt-2 font-mono whitespace-pre-wrap">{run.error}</p>
        </div>
      )}

      {/* Configuration */}
      {run.config && Object.keys(run.config).length > 0 && (
        <div className="p-4 rounded-lg border bg-card">
          <h4 className="font-medium text-sm flex items-center gap-2 mb-3">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            Configuration
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <ConfigItem label="CV Strategy" value={formatCVStrategy(run.config.cv_strategy)} />
            <ConfigItem label="CV Folds" value={run.config.cv_folds} />
            <ConfigItem label="Metric" value={formatMetricName(run.config.metric)} />
            <ConfigItem label="Random State" value={run.config.random_state} />
          </div>
        </div>
      )}

      {/* Best Results per dataset */}
      {run.datasets.some(ds => ds.best_final_score != null || ds.best_avg_val_score != null) && (
        <div className="p-4 rounded-lg border bg-card">
          <h4 className="font-medium text-sm mb-3 flex items-center gap-2">
            <Award className="h-4 w-4 text-chart-1" />
            Best Results
          </h4>
          <div className="space-y-2">
            {run.datasets
              .filter(ds => ds.best_final_score != null || ds.best_avg_val_score != null)
              .map(ds => {
                const hasFinal = ds.best_final_score != null;
                return (
                  <div key={ds.dataset_name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Database className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm">{ds.dataset_name}</span>
                      {ds.metric && <Badge variant="outline" className="text-[10px]">{formatMetricName(ds.metric)}</Badge>}
                      {ds.gain_from_previous_best != null && ds.gain_from_previous_best !== 0 && (
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px]",
                            ds.gain_from_previous_best > 0 ? "text-emerald-500 border-emerald-500/30" : "text-destructive border-destructive/30",
                          )}
                        >
                          {ds.gain_from_previous_best > 0 ? "+" : ""}{ds.gain_from_previous_best.toFixed(4)}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 font-mono text-sm">
                      {hasFinal ? (
                        <>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger>
                                <span className="text-emerald-500 font-bold">{formatScore(ds.best_final_score)}</span>
                              </TooltipTrigger>
                              <TooltipContent>Best final test score (refit)</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          {ds.best_avg_val_score != null && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger>
                                  <span className="text-muted-foreground text-xs">CV {formatScore(ds.best_avg_val_score)}</span>
                                </TooltipTrigger>
                                <TooltipContent>Best avg CV validation score</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </>
                      ) : (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger>
                              <span className="text-chart-1 font-bold">{formatScore(ds.best_avg_val_score)}</span>
                            </TooltipTrigger>
                            <TooltipContent>Best avg CV validation score</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Datasets summary table */}
      {run.datasets.length > 0 && (
        <div className="rounded-lg border overflow-hidden">
          <h4 className="font-medium text-sm p-3 bg-muted/30 border-b flex items-center gap-2">
            <Database className="h-4 w-4 text-muted-foreground" />
            Datasets
          </h4>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/10">
                <TableHead className="text-xs">Dataset</TableHead>
                <TableHead className="text-xs">Task</TableHead>
                <TableHead className="text-xs text-right">Samples</TableHead>
                <TableHead className="text-xs text-right">Features</TableHead>
                <TableHead className="text-xs text-right">Pipelines</TableHead>
                <TableHead className="text-xs text-right">Best Score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {run.datasets.map(ds => {
                const bestScore = ds.best_final_score ?? ds.best_avg_val_score;
                const hasFinal = ds.best_final_score != null;
                return (
                  <TableRow key={ds.dataset_name}>
                    <TableCell className="text-sm font-medium">{ds.dataset_name}</TableCell>
                    <TableCell>
                      {ds.task_type && <Badge variant="outline" className="text-[10px]">{ds.task_type}</Badge>}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{ds.n_samples ?? "-"}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{ds.n_features ?? "-"}</TableCell>
                    <TableCell className="text-right text-sm">{ds.pipeline_count}</TableCell>
                    <TableCell className={cn(
                      "text-right font-mono text-sm font-bold",
                      hasFinal ? "text-emerald-500" : "text-chart-1",
                    )}>
                      {formatScore(bestScore)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Model types */}
      {run.model_classes && run.model_classes.length > 0 && (
        <div className="p-4 rounded-lg border bg-card">
          <h4 className="font-medium text-sm flex items-center gap-2 mb-3">
            <Box className="h-4 w-4 text-muted-foreground" />
            Model Types
          </h4>
          <div className="flex flex-wrap gap-2">
            {run.model_classes.map(mc => (
              <Badge key={mc.name} variant="secondary" className="text-xs">
                {mc.name}
                <span className="ml-1.5 text-muted-foreground">&times;{mc.count}</span>
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Preprocessing chains */}
      {uniquePreprocessings.length > 0 && (
        <div className="p-4 rounded-lg border bg-card">
          <h4 className="font-medium text-sm flex items-center gap-2 mb-3">
            <Layers className="h-4 w-4 text-muted-foreground" />
            Preprocessing Chains
          </h4>
          <div className="flex flex-wrap gap-2">
            {uniquePreprocessings.map(p => (
              <Badge key={p} variant="outline" className="text-xs font-mono">
                {p}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1" asChild>
          <Link to={`/results?run_id=${encodeURIComponent(run.run_id)}`}>
            <BarChart3 className="h-4 w-4 mr-2" />
            View Full Results
          </Link>
        </Button>
      </div>
    </div>
  );
}

function ConfigItem({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div>
      <p className="text-[10px] uppercase text-muted-foreground font-medium">{label}</p>
      <p className="text-sm font-medium mt-0.5">{value != null && value !== "" ? String(value) : "-"}</p>
    </div>
  );
}

function formatCVStrategy(strategy?: string): string {
  if (!strategy) return "-";
  const map: Record<string, string> = {
    kfold: "K-Fold",
    stratified: "Stratified K-Fold",
    loo: "Leave-One-Out",
    holdout: "Holdout",
    repeated_kfold: "Repeated K-Fold",
  };
  return map[strategy.toLowerCase()] || strategy;
}

// ---------------------------------------------------------------------------
// Tab 2: Leaderboard
// ---------------------------------------------------------------------------

type SortColumn = "cv_val" | "cv_test" | "final" | "folds";
type SortDir = "asc" | "desc";

function LeaderboardTab({ run, open, activeTab, onPredict }: {
  run: EnrichedRun;
  open: boolean;
  activeTab: string;
  onPredict: (chain: TopChainResult, datasetName: string) => void;
}) {
  const [datasetFilter, setDatasetFilter] = useState<string>("__all__");
  const [sortCol, setSortCol] = useState<SortColumn>("cv_val");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Determine default sort direction from metric
  const primaryMetric = run.datasets[0]?.metric;
  const defaultDescending = !isLowerBetter(primaryMetric);

  const { data, isLoading } = useQuery({
    queryKey: ["aggregated-predictions-leaderboard", run.run_id],
    queryFn: () => getAggregatedPredictions({ run_id: run.run_id }),
    enabled: open && activeTab === "leaderboard",
    staleTime: 60000,
  });

  const predictions = useMemo(() => data?.predictions || [], [data]);

  const sortedPredictions = useMemo(() => {
    let filtered = predictions;
    if (datasetFilter !== "__all__") {
      filtered = filtered.filter(p => p.dataset_name === datasetFilter);
    }

    const dir = sortDir === "desc" ? -1 : 1;
    return [...filtered].sort((a, b) => {
      let va: number | null = null;
      let vb: number | null = null;
      if (sortCol === "cv_val") { va = a.cv_val_score; vb = b.cv_val_score; }
      else if (sortCol === "cv_test") { va = a.cv_test_score; vb = b.cv_test_score; }
      else if (sortCol === "final") { va = a.final_test_score; vb = b.final_test_score; }
      else if (sortCol === "folds") { va = a.cv_fold_count; vb = b.cv_fold_count; }
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * dir;
    });
  }, [predictions, datasetFilter, sortCol, sortDir]);

  const toggleSort = (col: SortColumn) => {
    if (sortCol === col) {
      setSortDir(d => d === "desc" ? "asc" : "desc");
    } else {
      setSortCol(col);
      setSortDir(defaultDescending ? "desc" : "asc");
    }
  };

  const SortHeader = ({ col, label, className }: { col: SortColumn; label: string; className?: string }) => (
    <TableHead
      className={cn("text-xs cursor-pointer select-none hover:text-foreground", className)}
      onClick={() => toggleSort(col)}
    >
      <span className="flex items-center gap-1 justify-end">
        {label}
        {sortCol === col && <ArrowUpDown className="h-3 w-3" />}
      </span>
    </TableHead>
  );

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (predictions.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Trophy className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No model results available yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex items-center gap-3">
        <Select value={datasetFilter} onValueChange={setDatasetFilter}>
          <SelectTrigger className="w-[200px] h-8 text-xs">
            <SelectValue placeholder="All datasets" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All datasets</SelectItem>
            {run.datasets.map(ds => (
              <SelectItem key={ds.dataset_name} value={ds.dataset_name}>{ds.dataset_name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {sortedPredictions.length} model{sortedPredictions.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/10">
              <TableHead className="text-xs w-10">#</TableHead>
              <TableHead className="text-xs">Model</TableHead>
              {datasetFilter === "__all__" && <TableHead className="text-xs">Dataset</TableHead>}
              <TableHead className="text-xs">Preprocessing</TableHead>
              <SortHeader col="cv_val" label="CV Val" className="text-right" />
              <SortHeader col="cv_test" label="CV Test" className="text-right" />
              <SortHeader col="final" label="Final" className="text-right" />
              <SortHeader col="folds" label="Folds" className="text-right" />
              <TableHead className="text-xs w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedPredictions.map((pred, i) => {
              const hasFinal = pred.final_test_score != null;
              return (
                <TableRow
                  key={pred.chain_id}
                  className={cn(
                    i === 0 && "bg-chart-1/5",
                    hasFinal && "bg-emerald-500/5",
                  )}
                >
                  <TableCell className="font-mono text-xs text-muted-foreground">{i + 1}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn(
                      "text-xs font-mono",
                      hasFinal && "border-emerald-500/30 text-emerald-600",
                    )}>
                      {pred.model_name ?? pred.model_class}
                    </Badge>
                  </TableCell>
                  {datasetFilter === "__all__" && (
                    <TableCell className="text-xs text-muted-foreground">{pred.dataset_name}</TableCell>
                  )}
                  <TableCell className="text-xs text-muted-foreground truncate max-w-[180px]" title={pred.preprocessings || ""}>
                    {pred.preprocessings || "-"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-chart-1">
                    {formatScore(pred.cv_val_score)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">
                    {formatScore(pred.cv_test_score)}
                  </TableCell>
                  <TableCell className={cn("text-right font-mono text-xs", hasFinal && "text-emerald-500 font-bold")}>
                    {formatScore(pred.final_test_score)}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {pred.cv_fold_count || "-"}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" asChild>
                      <Link to={`/predictions?run_id=${encodeURIComponent(run.run_id)}&dataset=${encodeURIComponent(pred.dataset_name || "")}&model=${encodeURIComponent(pred.model_name || "")}`}>
                        <ExternalLink className="h-3 w-3 text-muted-foreground" />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 3: Datasets
// ---------------------------------------------------------------------------

function DatasetsTab({ run, workspaceId, onPredict }: {
  run: EnrichedRun;
  workspaceId: string;
  onPredict: (chain: TopChainResult, datasetName: string) => void;
}) {
  if (run.datasets.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Database className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No datasets available</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {run.datasets.map(ds => (
        <EnhancedDatasetCard
          key={ds.dataset_name}
          dataset={ds}
          runId={run.run_id}
          workspaceId={workspaceId}
          onPredict={onPredict}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Enhanced dataset card with histogram
// ---------------------------------------------------------------------------

const PARTITION_LABELS: Record<string, string> = {
  val: "Validation",
  test: "Test",
  train: "Train",
  final: "Final",
};

const PARTITION_COLORS: Record<string, string> = {
  val: "bg-chart-1/20 text-chart-1 border-chart-1/30",
  test: "bg-chart-2/20 text-chart-2 border-chart-2/30",
  train: "bg-chart-3/20 text-chart-3 border-chart-3/30",
  final: "bg-chart-4/20 text-chart-4 border-chart-4/30",
};

function EnhancedDatasetCard({ dataset, runId, workspaceId, onPredict }: {
  dataset: EnrichedDatasetRun;
  runId: string;
  workspaceId: string;
  onPredict: (chain: TopChainResult, datasetName: string) => void;
}) {
  const [histogramOpen, setHistogramOpen] = useState(false);
  const [selectedPartitions, setSelectedPartitions] = useState<Set<string>>(new Set(["val", "test"]));

  const { data: distribution } = useQuery({
    queryKey: ["score-distribution", workspaceId, runId, dataset.dataset_name],
    queryFn: () => getScoreDistribution(workspaceId, runId, dataset.dataset_name),
    enabled: histogramOpen && !!workspaceId,
    staleTime: 60000,
  });

  const hasFinal = dataset.best_final_score != null;
  const bestScore = dataset.best_final_score ?? dataset.best_avg_val_score;
  const models = new Set(dataset.top_5.map(c => c.model_name));
  const refitChains = dataset.top_5.filter(c => c.final_test_score != null);

  const togglePartition = (part: string) => {
    setSelectedPartitions(prev => {
      const next = new Set(prev);
      if (next.has(part)) next.delete(part);
      else next.add(part);
      return next;
    });
  };

  return (
    <div className="p-4 rounded-lg border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm">{dataset.dataset_name}</span>
          {dataset.task_type && <Badge variant="outline" className="text-[10px]">{dataset.task_type}</Badge>}
        </div>
        {bestScore != null && (
          <Badge variant="outline" className={cn(
            "font-mono",
            hasFinal ? "text-emerald-500 border-emerald-500/30" : "text-chart-1 border-chart-1/30",
          )}>
            {hasFinal ? "Final" : "CV"} {formatMetricName(dataset.metric)} {formatScore(bestScore)}
          </Badge>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-3 text-center mb-3">
        <div>
          <p className="text-base font-semibold">{dataset.n_samples ?? "-"}</p>
          <p className="text-[10px] text-muted-foreground">Samples</p>
        </div>
        <div>
          <p className="text-base font-semibold">{dataset.n_features ?? "-"}</p>
          <p className="text-[10px] text-muted-foreground">Features</p>
        </div>
        <div>
          <p className="text-base font-semibold">{dataset.pipeline_count}</p>
          <p className="text-[10px] text-muted-foreground">Pipelines</p>
        </div>
        <div>
          <p className="text-base font-semibold">{models.size}</p>
          <p className="text-[10px] text-muted-foreground">Models</p>
        </div>
      </div>

      {/* Top chains */}
      {dataset.top_5.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {dataset.top_5.slice(0, 5).map((chain, i) => {
            const chainHasFinal = chain.final_test_score != null;
            return (
              <div key={chain.chain_id} className={cn(
                "flex items-center justify-between text-xs px-2 py-1.5 rounded",
                chainHasFinal && "bg-emerald-500/5",
              )}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className={cn(
                    "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
                    i === 0
                      ? (chainHasFinal ? "bg-emerald-500/20 text-emerald-500" : "bg-chart-1/20 text-chart-1")
                      : "bg-muted text-muted-foreground",
                  )}>
                    {i + 1}
                  </span>
                  <Badge variant="outline" className={cn(
                    "text-[10px] font-mono",
                    chainHasFinal && "border-emerald-500/30 text-emerald-600",
                  )}>
                    {chain.model_name}
                  </Badge>
                  {chain.preprocessings && (
                    <span className="text-muted-foreground truncate max-w-[200px]" title={chain.preprocessings}>
                      {chain.preprocessings}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="font-mono">
                    {chainHasFinal ? (
                      <>
                        <span className="text-emerald-500 font-bold">{formatScore(chain.final_test_score)}</span>
                        <span className="text-muted-foreground ml-2 text-[10px]">CV {formatScore(chain.avg_val_score)}</span>
                      </>
                    ) : (
                      <span className="text-chart-1">{formatScore(chain.avg_val_score)}</span>
                    )}
                  </div>
                  {chainHasFinal && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 w-5 p-0"
                            onClick={() => onPredict(chain, dataset.dataset_name)}
                          >
                            <Target className="h-3 w-3 text-primary" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Make predictions</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Refit models detail (expanded metrics) */}
      {refitChains.length > 0 && (
        <div className="space-y-2 mb-3">
          {refitChains.map(chain => (
            <RefitMetricsPanel key={chain.chain_id} chain={chain} taskType={dataset.task_type} metric={dataset.metric} />
          ))}
        </div>
      )}

      {/* Model badges */}
      <div className="flex flex-wrap gap-1 mb-3">
        {Array.from(models).map(m => (
          <Badge key={m} variant="secondary" className="text-[10px]">{m}</Badge>
        ))}
      </div>

      {/* Score distribution (collapsible) */}
      <Collapsible open={histogramOpen} onOpenChange={setHistogramOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="w-full text-xs h-7 justify-start gap-1">
            {histogramOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <BarChart3 className="h-3 w-3" />
            Score Distribution
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 space-y-2">
            {/* Partition filter */}
            <div className="flex items-center gap-1.5">
              {(["val", "test", "train", "final"] as const).map(part => {
                const isActive = selectedPartitions.has(part);
                return (
                  <Button
                    key={part}
                    variant={isActive ? "default" : "outline"}
                    size="sm"
                    className={cn("text-[10px] h-6 gap-0.5 px-2", isActive && PARTITION_COLORS[part])}
                    onClick={() => togglePartition(part)}
                  >
                    {isActive && <Check className="h-2.5 w-2.5" />}
                    {PARTITION_LABELS[part]}
                  </Button>
                );
              })}
            </div>
            {/* Histogram */}
            <div className="rounded-lg border p-3">
              <ScoreHistogram
                distribution={distribution ?? null}
                selectedPartitions={selectedPartitions}
              />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Actions */}
      <div className="flex gap-2 mt-2">
        <Button variant="ghost" size="sm" className="flex-1 text-xs" asChild>
          <Link to={`/predictions?run_id=${encodeURIComponent(runId)}&dataset=${encodeURIComponent(dataset.dataset_name)}`}>
            <ExternalLink className="h-3 w-3 mr-1" />
            View Predictions
          </Link>
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Refit metrics panel (for dataset cards)
// ---------------------------------------------------------------------------

function RefitMetricsPanel({ chain, taskType, metric }: { chain: TopChainResult; taskType: string | null; metric: string | null }) {
  const chainWithMetric = { ...chain, metric };
  const finalMetrics = extractFinalMetrics(chainWithMetric, taskType);
  const cvMetrics = extractCVMetrics(chainWithMetric, taskType);

  if (finalMetrics.length === 0) return null;

  return (
    <div className="p-2.5 rounded-lg border bg-emerald-500/5 border-emerald-500/20">
      <div className="flex items-center gap-2 mb-1.5 text-xs">
        <Award className="h-3 w-3 text-emerald-500 shrink-0" />
        <span className="font-medium text-emerald-600">{chain.model_name}</span>
        <Badge variant="secondary" className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/20 ml-auto">Refit</Badge>
      </div>
      <MetricsGrid metrics={finalMetrics} />
      {cvMetrics.length > 0 && (
        <div className="mt-1.5 pt-1.5 border-t border-emerald-500/10">
          <span className="text-[10px] text-muted-foreground font-medium">CV Scores</span>
          <MetricsGrid metrics={cvMetrics} className="opacity-70 mt-0.5" />
        </div>
      )}
    </div>
  );
}

function MetricsGrid({ metrics, className }: { metrics: MetricEntry[]; className?: string }) {
  if (metrics.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-x-2 gap-y-0.5", className)}>
      {metrics.map((m, i) => (
        <div key={`${m.label}-${i}`} className="text-center min-w-0">
          <div className="text-muted-foreground uppercase text-[9px] font-medium leading-tight">{m.label}</div>
          <div className={cn(
            "font-mono text-[11px] leading-tight",
            m.highlight ? "font-bold text-foreground" : "text-foreground/80",
          )}>
            {formatMetricValue(m.value, m.key)}
          </div>
        </div>
      ))}
    </div>
  );
}

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ChevronDown, ChevronRight, Database, Layers, Box, Clock,
  CheckCircle2, AlertCircle, Eye, HardDrive, Timer, RefreshCw,
  Pause, Target, FolderKanban, Award, Settings2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatMetricName,
  formatMetricValue,
  extractFinalMetrics,
  extractCVMetrics,
  extractCVOnlyMetrics,
  isBetterScore,
  isLowerBetter,
  type MetricEntry,
} from "@/lib/scores";
import { runStatusConfig } from "@/types/runs";
import type { EnrichedRun, EnrichedDatasetRun, TopChainResult } from "@/types/enriched-runs";
import { AllModelsPanel } from "./AllModelsPanel";
import { ModelDetailSheet } from "./ModelDetailSheet";
import { filterParasiticDatasets } from "./datasetFilters";

// ============================================================================
// Props
// ============================================================================

interface RunItemProps {
  run: EnrichedRun;
  activeRunProgress?: number;
  isActiveRun?: boolean;
  onViewDetails: (run: EnrichedRun) => void;
  workspaceId: string;
}

// ============================================================================
// Formatting helpers
// ============================================================================

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

const statusIcons: Record<string, typeof Clock> = {
  queued: Clock,
  running: RefreshCw,
  completed: CheckCircle2,
  failed: AlertCircle,
  paused: Pause,
};

// ============================================================================
// MetricsGrid — renders a row of metric values
// ============================================================================

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

// ============================================================================
// BestParamsBadges — compact display of sweep/finetuning params
// ============================================================================

function BestParamsBadges({ params }: { params: Record<string, unknown> | null | undefined }) {
  if (!params || Object.keys(params).length === 0) return null;
  const entries = Object.entries(params);
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <Settings2 className="h-3 w-3 text-muted-foreground shrink-0" />
      {entries.slice(0, 3).map(([k, v]) => (
        <Badge key={k} variant="secondary" className="text-[9px] font-mono px-1 py-0">
          {k}={typeof v === "number" ? (Number.isInteger(v) ? v : (v as number).toPrecision(4)) : String(v)}
        </Badge>
      ))}
      {entries.length > 3 && (
        <Badge variant="secondary" className="text-[9px] px-1 py-0">+{entries.length - 3}</Badge>
      )}
    </div>
  );
}

// ============================================================================
// RefitModelPanel — enhanced with best_params + detail action
// ============================================================================

function RefitModelPanel({ chain, taskType, metric, onViewDetail }: {
  chain: TopChainResult; taskType: string | null; metric: string | null;
  onViewDetail: (chain: TopChainResult) => void;
}) {
  const chainWithMetric = { ...chain, metric };
  const finalMetrics = extractFinalMetrics(chainWithMetric, taskType);
  const cvMetrics = extractCVMetrics(chainWithMetric, taskType);

  return (
    <div className="p-3 rounded-lg border bg-emerald-500/5 border-emerald-500/20">
      <div className="flex items-center gap-2 mb-2 text-xs">
        <Award className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
        <Badge variant="outline" className="text-xs font-mono border-emerald-500/30 text-emerald-600">
          <Box className="h-3 w-3 mr-1" />
          {chain.model_name}
        </Badge>
        {chain.preprocessings && (
          <span className="text-muted-foreground truncate max-w-[200px]" title={chain.preprocessings}>
            {chain.preprocessings}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          <Badge variant="secondary" className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/20">Refit</Badge>
          <Badge variant="outline" className="text-[10px]">{chain.fold_count} folds</Badge>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => onViewDetail(chain)} title="View details">
            <Eye className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {chain.best_params && Object.keys(chain.best_params).length > 0 && (
        <div className="mb-2">
          <BestParamsBadges params={chain.best_params} />
        </div>
      )}

      {finalMetrics.length > 0 ? (
        <MetricsGrid metrics={finalMetrics} />
      ) : (
        <div className="text-xs text-muted-foreground italic">Final metrics not available</div>
      )}

      {cvMetrics.length > 0 && (
        <div className="mt-1.5 pt-1.5 border-t border-emerald-500/10">
          <div className="flex items-center gap-1 mb-0.5">
            <span className="text-[10px] text-muted-foreground font-medium">CV Scores</span>
          </div>
          <MetricsGrid metrics={cvMetrics} className="opacity-70" />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// CVFallbackPanel — enhanced with best_params + detail action
// ============================================================================

function CVFallbackPanel({ chain, taskType, metric, onViewDetail }: {
  chain: TopChainResult; taskType: string | null; metric: string | null;
  onViewDetail: (chain: TopChainResult) => void;
}) {
  const metrics = extractCVOnlyMetrics({ ...chain, metric }, taskType);

  return (
    <div className="p-3 rounded-lg border bg-muted/20 border-border/50">
      <div className="flex items-center gap-2 mb-2 text-xs">
        <Box className="h-3.5 w-3.5 text-chart-1 shrink-0" />
        <span className="text-muted-foreground">Best CV:</span>
        <Badge variant="outline" className="text-xs font-mono">
          {chain.model_name}
        </Badge>
        {chain.preprocessings && (
          <span className="text-muted-foreground truncate max-w-[200px]" title={chain.preprocessings}>
            {chain.preprocessings}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          <Badge variant="outline" className="text-[10px]">{chain.fold_count} folds</Badge>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => onViewDetail(chain)} title="View details">
            <Eye className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {chain.best_params && Object.keys(chain.best_params).length > 0 && (
        <div className="mb-2">
          <BestParamsBadges params={chain.best_params} />
        </div>
      )}

      {metrics.length > 0 ? (
        <MetricsGrid metrics={metrics} />
      ) : (
        <div className="text-xs text-muted-foreground italic">Detailed metrics not available</div>
      )}
    </div>
  );
}

function pickBestChain(
  chains: TopChainResult[],
  metric: string | null,
  scoreAccessor: (chain: TopChainResult) => number | null | undefined,
): TopChainResult | null {
  let best: TopChainResult | null = null;
  let bestScore: number | null = null;
  for (const chain of chains) {
    const score = scoreAccessor(chain);
    if (score == null) continue;
    if (bestScore == null || isBetterScore(score, bestScore, metric)) {
      best = chain;
      bestScore = score;
    }
  }
  return best;
}

function primaryRefitLabel(metric: string | null): string {
  const normalized = (metric || "").toLowerCase();
  if (normalized === "rmse" || normalized === "rmsep") return "RMSEP";
  if (normalized === "r2") return "R²";
  return formatMetricName(metric) || "Final";
}

// ============================================================================
// DatasetScorePanel — redesigned: spotlight + full models table
// ============================================================================

function DatasetScorePanel({ dataset, runId, workspaceId }: {
  dataset: EnrichedDatasetRun; runId: string; workspaceId: string;
}) {
  const [detailChain, setDetailChain] = useState<TopChainResult | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedChainId, setSelectedChainId] = useState<string | null>(null);

  const metric = dataset.metric || "score";
  const refitChains = useMemo(() => dataset.top_5.filter((c) => c.final_test_score != null), [dataset.top_5]);
  const bestRefitChain = useMemo(
    () => pickBestChain(refitChains, metric, (c) => c.final_test_score),
    [refitChains, metric],
  );
  const bestCVChain = useMemo(
    () => pickBestChain(dataset.top_5, metric, (c) => c.avg_val_score),
    [dataset.top_5, metric],
  );

  const orderedTopChains = useMemo(() => {
    const defaultScore = isLowerBetter(metric) ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    return [...dataset.top_5].sort((a, b) => {
      const aScore = a.final_test_score ?? a.avg_val_score ?? defaultScore;
      const bScore = b.final_test_score ?? b.avg_val_score ?? defaultScore;
      return isLowerBetter(metric) ? aScore - bScore : bScore - aScore;
    });
  }, [dataset.top_5, metric]);

  const selectedChain = useMemo(
    () => orderedTopChains.find((chain) => chain.chain_id === selectedChainId) ?? orderedTopChains[0] ?? null,
    [orderedTopChains, selectedChainId],
  );

  const openDetail = (chain: TopChainResult) => {
    setDetailChain(chain);
    setDetailOpen(true);
  };

  if (dataset.top_5.length === 0) {
    return (
      <div className="p-3 rounded-lg bg-muted/20">
        <div className="flex items-center gap-2">
          <Database className="h-3.5 w-3.5 text-primary" />
          <span className="font-medium text-sm">{dataset.dataset_name}</span>
          {dataset.task_type && (
            <Badge variant="secondary" className="text-[10px]">{dataset.task_type}</Badge>
          )}
          <span className="text-xs text-muted-foreground italic">No results yet</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-card via-card to-primary/[0.03] p-3 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Database className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="font-semibold text-sm">{dataset.dataset_name}</span>
          {dataset.task_type && (
            <Badge variant="secondary" className="text-[10px]">{dataset.task_type}</Badge>
          )}
          <Badge variant="outline" className="text-[10px] ml-auto">{dataset.pipeline_count} pipelines</Badge>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {bestRefitChain?.final_test_score != null ? (
            <Badge className="text-[10px] font-mono bg-emerald-500/10 text-emerald-700 border border-emerald-500/30">
              Best Refit {primaryRefitLabel(dataset.metric)} {formatMetricValue(bestRefitChain.final_test_score, metric)}
            </Badge>
          ) : bestCVChain?.avg_val_score != null ? (
            <Badge className="text-[10px] font-mono bg-chart-1/10 text-chart-1 border border-chart-1/30">
              Best CV {formatMetricName(dataset.metric)} {formatMetricValue(bestCVChain.avg_val_score, metric)}
            </Badge>
          ) : null}
          {selectedChain?.avg_val_score != null && (
            <Badge variant="outline" className="text-[10px] font-mono">
              {(metric.toLowerCase() === "rmse" || metric.toLowerCase() === "rmsecv" ? "RMSECV" : `CV ${formatMetricName(metric) || "Score"}`)}{" "}
              {formatMetricValue(selectedChain.avg_val_score, metric)}
            </Badge>
          )}
          {selectedChain?.avg_test_score != null && (
            <Badge variant="outline" className="text-[10px] font-mono">
              Test {formatMetricValue(selectedChain.avg_test_score, metric)}
            </Badge>
          )}
          {selectedChain?.avg_train_score != null && (
            <Badge variant="outline" className="text-[10px] font-mono">
              Train {formatMetricValue(selectedChain.avg_train_score, metric)}
            </Badge>
          )}
        </div>
      </div>

      {selectedChain?.final_test_score != null ? (
        <RefitModelPanel
          chain={selectedChain}
          taskType={dataset.task_type}
          metric={dataset.metric}
          onViewDetail={openDetail}
        />
      ) : selectedChain ? (
        <CVFallbackPanel
          chain={selectedChain}
          taskType={dataset.task_type}
          metric={dataset.metric}
          onViewDetail={openDetail}
        />
      ) : null}

      <AllModelsPanel
        workspaceId={workspaceId}
        runId={runId}
        datasetName={dataset.dataset_name}
        taskType={dataset.task_type}
        totalPipelines={dataset.pipeline_count}
      />

      <ModelDetailSheet
        chain={detailChain}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        taskType={dataset.task_type}
        datasetName={dataset.dataset_name}
      />
    </div>
  );
}

// ============================================================================
// RunItem — main component
// ============================================================================

export function RunItem({ run, onViewDetails, workspaceId }: RunItemProps) {
  const [expanded, setExpanded] = useState(false);
  const status = (run.status || "completed") as keyof typeof runStatusConfig;
  const config = runStatusConfig[status] || runStatusConfig.completed;
  const StatusIcon = statusIcons[status] || CheckCircle2;

  // Filter parasitic datasets
  const datasets = filterParasiticDatasets(run.datasets);

  // Best score summary for collapsed state
  const bestDataset = datasets.reduce<EnrichedDatasetRun | null>((best, ds) => {
    const score = ds.best_final_score ?? ds.best_avg_val_score;
    if (score == null) return best;
    if (!best) return ds;
    const bestScore = best.best_final_score ?? best.best_avg_val_score;
    if (bestScore == null) return ds;
    return isBetterScore(score, bestScore, ds.metric ?? best.metric) ? ds : best;
  }, null);

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <Card className="overflow-hidden" data-testid="run-card">
        {/* Header — always visible, acts as collapse trigger */}
        <CollapsibleTrigger asChild>
          <CardHeader className="p-4 pb-2 cursor-pointer hover:bg-muted/20 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className={cn("p-2 rounded-lg shrink-0 relative", config.bg)}>
                  <StatusIcon className={cn("h-4 w-4", config.color, config.iconClass)} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {expanded
                      ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    }
                    <h3 className="font-semibold text-foreground truncate">{run.name || run.run_id}</h3>
                    {run.project_id && (
                      <Badge variant="outline" className="text-xs shrink-0">
                        <FolderKanban className="h-3 w-3 mr-1" />
                        {run.project_name || "Project"}
                      </Badge>
                    )}
                  </div>
                  {/* Compact stats row */}
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground flex-wrap">
                    <TooltipProvider>
                      <Tooltip><TooltipTrigger asChild>
                        <span className="flex items-center gap-0.5"><Database className="h-3 w-3" />{datasets.length}</span>
                      </TooltipTrigger><TooltipContent>Datasets</TooltipContent></Tooltip>
                    </TooltipProvider>
                    <span className="text-muted-foreground/40">|</span>
                    <TooltipProvider>
                      <Tooltip><TooltipTrigger asChild>
                        <span className="flex items-center gap-0.5"><Layers className="h-3 w-3" />{run.pipeline_runs_count}</span>
                      </TooltipTrigger><TooltipContent>Pipeline runs</TooltipContent></Tooltip>
                    </TooltipProvider>
                    <span className="text-muted-foreground/40">|</span>
                    <TooltipProvider>
                      <Tooltip><TooltipTrigger asChild>
                        <span className="flex items-center gap-0.5"><Target className="h-3 w-3" />{run.final_models_count}</span>
                      </TooltipTrigger><TooltipContent>Final models</TooltipContent></Tooltip>
                    </TooltipProvider>
                    <span className="text-muted-foreground/40">|</span>
                    <TooltipProvider>
                      <Tooltip><TooltipTrigger asChild>
                        <span className="flex items-center gap-0.5"><Box className="h-3 w-3" />{run.total_models_trained}</span>
                      </TooltipTrigger><TooltipContent>Models trained</TooltipContent></Tooltip>
                    </TooltipProvider>
                    <span className="text-muted-foreground/40">|</span>
                    <TooltipProvider>
                      <Tooltip><TooltipTrigger asChild>
                        <span className="flex items-center gap-0.5"><Layers className="h-3 w-3 rotate-90" />{run.total_folds}</span>
                      </TooltipTrigger><TooltipContent>Total folds</TooltipContent></Tooltip>
                    </TooltipProvider>
                    {/* Inline best score when collapsed */}
                    {!expanded && bestDataset && (bestDataset.best_final_score ?? bestDataset.best_avg_val_score) != null && (
                      <>
                        <span className="text-muted-foreground/40">|</span>
                        <span className={cn(
                          "font-mono font-bold",
                          bestDataset.best_final_score != null ? "text-emerald-500" : "text-chart-1",
                        )}>
                          {bestDataset.best_final_score != null
                            ? primaryRefitLabel(bestDataset.metric)
                            : `CV ${formatMetricName(bestDataset.metric) || "Score"}`}{" "}
                          {formatMetricValue(bestDataset.best_final_score ?? bestDataset.best_avg_val_score, bestDataset.metric || "score")}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <div className="hidden md:flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1" title="Duration">
                    <Timer className="h-3 w-3" />
                    {formatDuration(run.duration_seconds)}
                  </span>
                  <span className="flex items-center gap-1" title="Artifact size">
                    <HardDrive className="h-3 w-3" />
                    {formatBytes(run.artifact_size_bytes)}
                  </span>
                </div>
                <div className="hidden lg:block text-right text-xs text-muted-foreground">
                  <div>{formatDatetime(run.created_at)}</div>
                  {run.completed_at && <div className="text-muted-foreground/60">{formatDatetime(run.completed_at)}</div>}
                </div>
                <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onViewDetails(run); }}>
                  <Eye className="h-4 w-4 mr-1" />
                  Details
                </Button>
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>

        {/* Collapsible dataset score panels */}
        <CollapsibleContent>
          <CardContent className="px-4 pb-3 pt-1 space-y-3">
            {/* Error display */}
            {run.error && (
              <div className="p-2 rounded bg-destructive/10 text-destructive text-xs">
                {run.error}
              </div>
            )}

            {/* Per-dataset panels */}
            {datasets.map((ds) => (
              <DatasetScorePanel
                key={ds.dataset_name}
                dataset={ds}
                runId={run.run_id}
                workspaceId={workspaceId}
              />
            ))}

            {datasets.length === 0 && (status === "running" || status === "queued") && (
              <div className="text-sm text-muted-foreground text-center py-3">
                Waiting for results...
              </div>
            )}

            {datasets.length === 0 && status !== "running" && status !== "queued" && !run.error && (
              <div className="text-sm text-muted-foreground text-center py-3">
                No dataset results available
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

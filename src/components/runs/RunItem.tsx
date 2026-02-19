import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ChevronDown, ChevronRight, Database, Layers, Box, Clock,
  CheckCircle2, AlertCircle, Eye, HardDrive, Timer, RefreshCw,
  Pause, Target, FolderKanban, Award,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatMetricValue, extractFinalMetrics, extractCVMetrics,
  extractCVOnlyMetrics, type MetricEntry,
} from "@/lib/scores";
import { runStatusConfig } from "@/types/runs";
import type { EnrichedRun, EnrichedDatasetRun, TopChainResult } from "@/types/enriched-runs";

interface RunItemProps {
  run: EnrichedRun;
  activeRunProgress?: number;
  isActiveRun?: boolean;
  onViewDetails: (run: EnrichedRun) => void;
  workspaceId: string;
}

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

/** Renders a single-line row of metric values. */
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

/** Panel for a single refit model: final scores row + CV scores row. */
function RefitModelPanel({ chain, taskType, metric }: { chain: TopChainResult; taskType: string | null; metric: string | null }) {
  const chainWithMetric = { ...chain, metric };
  const finalMetrics = extractFinalMetrics(chainWithMetric, taskType);
  const cvMetrics = extractCVMetrics(chainWithMetric, taskType);

  return (
    <div className="p-3 rounded-lg border bg-emerald-500/5 border-emerald-500/20">
      {/* Model info */}
      <div className="flex items-center gap-2 mb-2 text-xs">
        <Award className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
        <Badge variant="outline" className="text-xs font-mono border-emerald-500/30 text-emerald-600">
          <Box className="h-3 w-3 mr-1" />
          {chain.model_name}
        </Badge>
        {chain.preprocessings && (
          <span className="text-muted-foreground truncate max-w-[300px]" title={chain.preprocessings}>
            {chain.preprocessings}
          </span>
        )}
        <Badge variant="secondary" className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/20 ml-auto shrink-0">Refit</Badge>
        <Badge variant="outline" className="text-[10px] shrink-0">{chain.fold_count} folds</Badge>
      </div>

      {/* Final scores row */}
      {finalMetrics.length > 0 ? (
        <MetricsGrid metrics={finalMetrics} />
      ) : (
        <div className="text-xs text-muted-foreground italic">Final metrics not available</div>
      )}

      {/* CV scores row (dimmer, smaller) */}
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

/** Fallback panel for best CV model when no refit exists. */
function CVFallbackPanel({ chain, taskType, metric }: { chain: TopChainResult; taskType: string | null; metric: string | null }) {
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
          <span className="text-muted-foreground truncate max-w-[300px]" title={chain.preprocessings}>
            {chain.preprocessings}
          </span>
        )}
        <Badge variant="outline" className="text-[10px] ml-auto shrink-0">{chain.fold_count} folds</Badge>
      </div>

      {metrics.length > 0 ? (
        <MetricsGrid metrics={metrics} />
      ) : (
        <div className="text-xs text-muted-foreground italic">Detailed metrics not available</div>
      )}
    </div>
  );
}

/** Card for a non-refit model in the collapsible list. Same style as refit panels. */
function OtherModelPanel({ chain, taskType, metric }: { chain: TopChainResult; taskType: string | null; metric: string | null }) {
  const metrics = extractCVOnlyMetrics({ ...chain, metric }, taskType);

  return (
    <div className="p-3 rounded-lg border bg-card border-border/50">
      <div className="flex items-center gap-2 mb-2 text-xs">
        <Box className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <Badge variant="outline" className="text-xs font-mono">
          {chain.model_name}
        </Badge>
        {chain.preprocessings && (
          <span className="text-muted-foreground truncate max-w-[300px]" title={chain.preprocessings}>
            {chain.preprocessings}
          </span>
        )}
        <Badge variant="outline" className="text-[10px] ml-auto shrink-0">{chain.fold_count} folds</Badge>
      </div>

      {metrics.length > 0 ? (
        <MetricsGrid metrics={metrics} />
      ) : (
        <div className="text-xs text-muted-foreground italic">Detailed metrics not available</div>
      )}
    </div>
  );
}

/** Per-dataset score panel: refit models prominently + collapsible for other models. */
function DatasetScorePanel({ dataset, runId, datasetName }: { dataset: EnrichedDatasetRun; runId: string; datasetName: string }) {
  const [othersExpanded, setOthersExpanded] = useState(false);

  const refitChains = dataset.top_5.filter(c => c.final_test_score != null);
  const otherChains = dataset.top_5.filter(c => c.final_test_score == null);
  const hasRefit = refitChains.length > 0;

  // If no refit, show best CV model prominently (exclude from collapsible)
  const prominentCVChain = !hasRefit && otherChains.length > 0 ? otherChains[0] : null;
  const collapsibleChains = hasRefit ? otherChains : otherChains.slice(1);

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
    <div className="space-y-1.5">
      {/* Dataset header */}
      <div className="flex items-center gap-2 px-1">
        <Database className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="font-semibold text-sm">{dataset.dataset_name}</span>
        {dataset.task_type && (
          <Badge variant="secondary" className="text-[10px]">{dataset.task_type}</Badge>
        )}
        <Badge variant="outline" className="text-[10px] ml-auto">{dataset.pipeline_count} pipelines</Badge>
      </div>

      {/* Refit models */}
      {refitChains.map((chain) => (
        <RefitModelPanel key={chain.chain_id} chain={chain} taskType={dataset.task_type} metric={dataset.metric} />
      ))}

      {/* CV fallback (only when no refit) */}
      {prominentCVChain && (
        <CVFallbackPanel chain={prominentCVChain} taskType={dataset.task_type} metric={dataset.metric} />
      )}

      {/* Collapsible: other models */}
      {collapsibleChains.length > 0 && (
        <Collapsible open={othersExpanded} onOpenChange={setOthersExpanded}>
          <CollapsibleTrigger asChild>
            <div className="flex items-center gap-1 px-1 py-1 cursor-pointer hover:bg-muted/30 rounded text-xs text-muted-foreground transition-colors">
              {othersExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {collapsibleChains.length} other model{collapsibleChains.length > 1 ? "s" : ""}
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-1.5 mt-1">
              {collapsibleChains.map((chain) => (
                <OtherModelPanel
                  key={chain.chain_id}
                  chain={chain}
                  taskType={dataset.task_type}
                  metric={dataset.metric}
                />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

export function RunItem({ run, onViewDetails, workspaceId }: RunItemProps) {
  const [expanded, setExpanded] = useState(false);
  const status = (run.status || "completed") as keyof typeof runStatusConfig;
  const config = runStatusConfig[status] || runStatusConfig.completed;
  const StatusIcon = statusIcons[status] || CheckCircle2;

  // Best score summary for collapsed state
  const bestDataset = run.datasets.reduce<EnrichedDatasetRun | null>((best, ds) => {
    const score = ds.best_final_score ?? ds.best_avg_val_score;
    if (score == null) return best;
    if (!best) return ds;
    const bestScore = best.best_final_score ?? best.best_avg_val_score;
    return bestScore != null && score > bestScore ? ds : best;
  }, null);

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <Card className="overflow-hidden">
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
                        <span className="flex items-center gap-0.5"><Database className="h-3 w-3" />{run.datasets_count}</span>
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
                          {bestDataset.metric?.toUpperCase()} {(bestDataset.best_final_score ?? bestDataset.best_avg_val_score)?.toFixed(4)}
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
            {run.datasets.map((ds) => (
              <DatasetScorePanel
                key={ds.dataset_name}
                dataset={ds}
                runId={run.run_id}
                datasetName={ds.dataset_name}
              />
            ))}

            {run.datasets.length === 0 && (status === "running" || status === "queued") && (
              <div className="text-sm text-muted-foreground text-center py-3">
                Waiting for results...
              </div>
            )}

            {run.datasets.length === 0 && status !== "running" && status !== "queued" && !run.error && (
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

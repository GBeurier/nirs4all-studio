import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ChevronDown, ChevronRight, Database, Layers, Box, Clock,
  CheckCircle2, AlertCircle, Eye, HardDrive, Timer, RefreshCw,
  Pause, Target, FolderKanban,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatMetricName,
  formatMetricValue,
  isBetterScore,
} from "@/lib/scores";
import { runStatusConfig } from "@/types/runs";
import type { EnrichedRun, EnrichedDatasetRun } from "@/types/enriched-runs";
import { filterParasiticDatasets } from "./datasetFilters";
import { DatasetResultCard } from "@/components/scores/DatasetResultCard";

// ============================================================================
// Props
// ============================================================================

interface RunItemProps {
  run: EnrichedRun;
  activeRunProgress?: number;
  isActiveRun?: boolean;
  onViewDetails: (run: EnrichedRun) => void;
  workspaceId: string;
  selectedMetrics?: string[];
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

function primaryRefitLabel(metric: string | null): string {
  const normalized = (metric || "").toLowerCase();
  if (normalized === "rmse" || normalized === "rmsep") return "RMSEP";
  if (normalized === "r2") return "R²";
  return formatMetricName(metric) || "Final";
}

// ============================================================================
// RunItem — main component
// ============================================================================

export function RunItem({ run, onViewDetails, workspaceId, selectedMetrics = ["rmse", "r2", "sep", "rpd", "bias", "mae"] }: RunItemProps) {
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
                    {/* Model classes trained */}
                    {run.model_classes && run.model_classes.length > 0 && (
                      <>
                        <span className="text-muted-foreground/40">|</span>
                        <TooltipProvider>
                          <Tooltip><TooltipTrigger asChild>
                            <span className="flex items-center gap-1">
                              {run.model_classes.map((mc) => (
                                <Badge key={mc.name} variant="outline" className="text-[10px] bg-teal-500/10 text-teal-600 border-teal-500/30 py-0 h-4">
                                  {mc.name}{mc.count > 1 ? ` ×${mc.count}` : ""}
                                </Badge>
                              ))}
                            </span>
                          </TooltipTrigger><TooltipContent>Trained model classes</TooltipContent></Tooltip>
                        </TooltipProvider>
                      </>
                    )}
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

            {/* Per-dataset cards */}
            {datasets.map((ds, idx) => (
              <DatasetResultCard
                key={ds.dataset_name}
                dataset={ds}
                selectedMetrics={selectedMetrics}
                runId={run.run_id}
                workspaceId={workspaceId}
                defaultExpanded={idx === 0}
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

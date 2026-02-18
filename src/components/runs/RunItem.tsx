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
import { formatMetricValue, extractReportMetrics } from "@/lib/scores";
import { runStatusConfig } from "@/types/runs";
import type { EnrichedRun, EnrichedDatasetRun } from "@/types/enriched-runs";
import { DatasetSubItem } from "./DatasetSubItem";

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

function DatasetScorePanel({ dataset }: { dataset: EnrichedDatasetRun }) {
  const bestChain = dataset.top_5?.[0];

  if (!bestChain) {
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

  const hasFinal = bestChain.final_test_score != null;
  const metrics = extractReportMetrics(bestChain, dataset.task_type);

  return (
    <div className={cn(
      "p-3 rounded-lg border",
      hasFinal ? "bg-emerald-500/5 border-emerald-500/20" : "bg-muted/20 border-border/50",
    )}>
      {/* Header: dataset name + badges */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <Database className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="font-semibold text-sm">{dataset.dataset_name}</span>
          {dataset.task_type && (
            <Badge variant="secondary" className="text-[10px]">{dataset.task_type}</Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {hasFinal && (
            <Badge variant="secondary" className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/20">Refit</Badge>
          )}
          <Badge variant="outline" className="text-[10px]">{bestChain.fold_count} folds</Badge>
          <Badge variant="outline" className="text-[10px]">{dataset.pipeline_count} pipelines</Badge>
        </div>
      </div>

      {/* Best model line */}
      <div className="flex items-center gap-2 mb-2 text-xs">
        <span className="text-muted-foreground">Best:</span>
        <Badge variant="outline" className="text-xs font-mono">
          <Box className="h-3 w-3 mr-1" />
          {bestChain.model_name}
        </Badge>
        {bestChain.preprocessings && (
          <span className="text-muted-foreground truncate max-w-[300px]" title={bestChain.preprocessings}>
            {bestChain.preprocessings}
          </span>
        )}
      </div>

      {/* Metrics grid */}
      {metrics.length > 0 ? (
        <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-8 gap-x-3 gap-y-1">
          {metrics.map((m, i) => (
            <div key={`${m.label}-${i}`} className="text-center">
              <div className="text-muted-foreground uppercase text-[10px] font-medium leading-tight">{m.label}</div>
              <div className={cn(
                "font-mono text-xs leading-tight",
                m.highlight ? "font-bold text-foreground" : "text-foreground/80",
              )}>
                {formatMetricValue(m.value, m.key)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground italic">Detailed metrics not available</div>
      )}
    </div>
  );
}

export function RunItem({ run, onViewDetails, workspaceId }: RunItemProps) {
  const [expanded, setExpanded] = useState(false);
  const status = (run.status || "completed") as keyof typeof runStatusConfig;
  const config = runStatusConfig[status] || runStatusConfig.completed;
  const StatusIcon = statusIcons[status] || CheckCircle2;
  const hasChainData = run.datasets.some(ds => ds.top_5.length > 0);

  return (
    <Card className="overflow-hidden">
      {/* Header */}
      <CardHeader className="p-4 pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className={cn("p-2 rounded-lg shrink-0", config.bg)}>
              <StatusIcon className={cn("h-4 w-4", config.color, config.iconClass)} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
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

      {/* Dataset score panels - always visible */}
      <CardContent className="px-4 pb-3 pt-1 space-y-2">
        {/* Error display */}
        {run.error && (
          <div className="p-2 rounded bg-destructive/10 text-destructive text-xs">
            {run.error}
          </div>
        )}

        {/* Dataset metrics */}
        {run.datasets.map((ds) => (
          <DatasetScorePanel key={ds.dataset_name} dataset={ds} />
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

      {/* Collapsible per-chain breakdown */}
      {hasChainData && (
        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <CollapsibleTrigger asChild>
            <div className="px-4 py-2 border-t cursor-pointer hover:bg-muted/20 transition-colors flex items-center justify-center gap-1 text-xs text-muted-foreground">
              {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {expanded ? "Hide" : "Show"} per-chain breakdown
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-4 pb-4 space-y-2">
              {run.datasets.map((ds) => (
                <DatasetSubItem
                  key={ds.dataset_name}
                  dataset={ds}
                  runId={run.run_id}
                  runName={run.name}
                  workspaceId={workspaceId}
                />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </Card>
  );
}

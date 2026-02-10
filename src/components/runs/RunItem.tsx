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
import { runStatusConfig } from "@/types/runs";
import type { EnrichedRun } from "@/types/enriched-runs";
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

export function RunItem({ run, onViewDetails, workspaceId }: RunItemProps) {
  const [expanded, setExpanded] = useState(false);
  const status = (run.status || "completed") as keyof typeof runStatusConfig;
  const config = runStatusConfig[status] || runStatusConfig.completed;
  const StatusIcon = statusIcons[status] || CheckCircle2;

  return (
    <Card className="overflow-hidden">
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <CollapsibleTrigger asChild>
          <CardHeader className="p-4 cursor-pointer hover:bg-muted/30 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                {expanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
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
                  {/* Icon counts row */}
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                    <TooltipProvider>
                      <Tooltip><TooltipTrigger asChild>
                        <span className="flex items-center gap-1">
                          <Database className="h-3 w-3" />{run.datasets_count}
                        </span>
                      </TooltipTrigger><TooltipContent>Datasets</TooltipContent></Tooltip>
                    </TooltipProvider>
                    <span className="text-muted-foreground/40">|</span>
                    <TooltipProvider>
                      <Tooltip><TooltipTrigger asChild>
                        <span className="flex items-center gap-1">
                          <Layers className="h-3 w-3" />{run.pipeline_runs_count}
                        </span>
                      </TooltipTrigger><TooltipContent>Pipeline runs</TooltipContent></Tooltip>
                    </TooltipProvider>
                    <span className="text-muted-foreground/40">|</span>
                    <TooltipProvider>
                      <Tooltip><TooltipTrigger asChild>
                        <span className="flex items-center gap-1">
                          <Target className="h-3 w-3" />{run.final_models_count}
                        </span>
                      </TooltipTrigger><TooltipContent>Final models</TooltipContent></Tooltip>
                    </TooltipProvider>
                    <span className="text-muted-foreground/40">|</span>
                    <TooltipProvider>
                      <Tooltip><TooltipTrigger asChild>
                        <span className="flex items-center gap-1">
                          <Box className="h-3 w-3" />{run.total_models_trained}
                        </span>
                      </TooltipTrigger><TooltipContent>Models trained</TooltipContent></Tooltip>
                    </TooltipProvider>
                    <span className="text-muted-foreground/40">|</span>
                    <TooltipProvider>
                      <Tooltip><TooltipTrigger asChild>
                        <span className="flex items-center gap-1">
                          <Layers className="h-3 w-3 rotate-90" />{run.total_folds}
                        </span>
                      </TooltipTrigger><TooltipContent>Total folds</TooltipContent></Tooltip>
                    </TooltipProvider>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                {/* Metadata */}
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

        <CollapsibleContent>
          <CardContent className="px-4 pb-4 pt-0 space-y-2">
            {/* Mobile metadata (visible on small screens) */}
            <div className="md:hidden flex items-center gap-3 text-xs text-muted-foreground pb-2 border-b">
              <span className="flex items-center gap-1">
                <Timer className="h-3 w-3" />{formatDuration(run.duration_seconds)}
              </span>
              <span className="flex items-center gap-1">
                <HardDrive className="h-3 w-3" />{formatBytes(run.artifact_size_bytes)}
              </span>
              <span>{formatDatetime(run.created_at)}</span>
            </div>

            {run.datasets.map((ds) => (
              <DatasetSubItem
                key={ds.dataset_name}
                dataset={ds}
                runId={run.run_id}
                runName={run.name}
                workspaceId={workspaceId}
              />
            ))}

            {run.datasets.length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-4">
                No dataset results available yet
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

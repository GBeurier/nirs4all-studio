import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  BarChart3,
  Box,
  CheckCircle2,
  CircleDashed,
  Clock,
  Database,
  ExternalLink,
  HardDrive,
  Layers,
  ListTree,
  Pause,
  Play,
  RefreshCw,
  Terminal,
} from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  getN4AWorkspaceRunDetail,
  getWorkspaceRunPipelineLogs,
  rerunWorkspaceRun,
} from "@/api/client";
import { runStatusConfig } from "@/types/runs";
import type { EnrichedRun } from "@/types/enriched-runs";
import type { RunStatus } from "@/types/runs";
import { DatasetResultCard } from "@/components/scores/DatasetResultCard";
import { AllModelsPanel } from "./AllModelsPanel";
import { filterParasiticDatasets } from "./datasetFilters";
import { RunDetailLogs } from "./RunDetailLogs";
import { RunDetailOverview } from "./RunDetailOverview";
import { RunDetailPipelines } from "./RunDetailPipelines";
import { formatBytes, formatDatetime, formatDuration } from "./runDetailUtils";

interface RunDetailSheetProps {
  run: EnrichedRun | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  runPageId?: string | null;
  selectedMetrics?: string[];
}

const statusIcons = {
  queued: Clock,
  running: RefreshCw,
  completed: CheckCircle2,
  failed: AlertCircle,
  paused: Pause,
  partial: CircleDashed,
};

function StatusIcon({ status }: { status: RunStatus }) {
  const Icon = statusIcons[status];
  const config = runStatusConfig[status];
  if (!Icon || !config) return null;
  return <Icon className={cn("h-4 w-4", config.color, config.iconClass)} />;
}

function StatCard({
  icon: Icon,
  label,
  value,
  accent = false,
}: {
  icon: typeof Database;
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div className={cn("rounded-lg p-2.5 text-center", accent ? "bg-chart-1/10" : "bg-muted/30")}>
      <Icon className={cn("mx-auto mb-0.5 h-3.5 w-3.5", accent ? "text-chart-1" : "text-muted-foreground")} />
      <p className="text-base font-semibold">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

export function RunDetailSheet({
  run,
  open,
  onOpenChange,
  workspaceId,
  runPageId = null,
  selectedMetrics = [],
}: RunDetailSheetProps) {
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const datasets = useMemo(
    () => (run ? filterParasiticDatasets(run.datasets) : []),
    [run],
  );

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ["workspace-run-detail", workspaceId, run?.run_id],
    queryFn: () => getN4AWorkspaceRunDetail(workspaceId, run!.run_id),
    enabled: open && !!workspaceId && !!run,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!open || !detail?.pipelines?.length) {
      setSelectedPipelineId(null);
      return;
    }

    setSelectedPipelineId((current) => (
      current && detail.pipelines.some((pipeline) => pipeline.pipeline_id === current)
        ? current
        : detail.pipelines[0].pipeline_id
    ));
  }, [detail, open]);

  useEffect(() => {
    if (!open) {
      setActiveTab("overview");
    }
  }, [open]);

  const rerunMutation = useMutation({
    mutationFn: () => rerunWorkspaceRun(workspaceId, run!.run_id),
    onSuccess: async (response) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["runs"] }),
        queryClient.invalidateQueries({ queryKey: ["enriched-runs", workspaceId] }),
      ]);
      toast.success("Run relaunched", {
        description: `${response.cloned_pipelines.length} cloned pipeline${response.cloned_pipelines.length === 1 ? "" : "s"} started in a new run.`,
      });
      onOpenChange(false);
      navigate(`/runs/${encodeURIComponent(response.run.id)}`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to relaunch run");
    },
  });

  const { data: logsResponse, isLoading: logsLoading } = useQuery({
    queryKey: ["workspace-run-pipeline-logs", workspaceId, run?.run_id, selectedPipelineId],
    queryFn: () => getWorkspaceRunPipelineLogs(workspaceId, run!.run_id, selectedPipelineId!),
    enabled: open && activeTab === "logs" && !!workspaceId && !!run && !!selectedPipelineId,
    staleTime: 15_000,
  });

  if (!run) return null;

  const status = (run.status || "completed") as RunStatus;
  const config = runStatusConfig[status] || runStatusConfig.completed;

  const handleShowLogs = (pipelineId?: string) => {
    if (pipelineId) {
      setSelectedPipelineId(pipelineId);
    }
    setActiveTab("logs");
  };

  const canRerun = Boolean(
    detail?.rerun_ready
    && status !== "running"
    && status !== "queued"
    && !detailLoading,
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col overflow-hidden sm:max-w-6xl">
        <SheetHeader className="flex-shrink-0">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-center gap-3">
              <div className={cn("rounded-lg p-2", config.bg)}>
                <StatusIcon status={status} />
              </div>
              <div>
                <SheetTitle className="text-lg">{run.name || run.run_id}</SheetTitle>
                <SheetDescription className="mt-1 flex flex-wrap items-center gap-2">
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
            <div className="flex flex-wrap items-center gap-2 self-start sm:justify-end">
              <Button variant="outline" size="sm" asChild>
                <Link to={`/results?run_id=${encodeURIComponent(run.run_id)}`}>
                  <BarChart3 className="mr-2 h-4 w-4" />
                  Results
                </Link>
              </Button>
              {runPageId && (
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/runs/${encodeURIComponent(runPageId)}`}>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open Run Page
                  </Link>
                </Button>
              )}
              <Button
                variant="default"
                size="sm"
                onClick={() => rerunMutation.mutate()}
                disabled={!canRerun || rerunMutation.isPending}
                title={detail?.rerun_ready === false ? "Relink the missing datasets before rerunning this run." : undefined}
              >
                {rerunMutation.isPending ? (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                Rerun As Clone
              </Button>
              <Badge variant={status === "completed" ? "default" : "secondary"}>
                {config.label}
              </Badge>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
            <StatCard icon={Database} label="Datasets" value={datasets.length} />
            <StatCard icon={Layers} label="Pipelines" value={detail?.pipelines.length ?? run.pipeline_runs_count} />
            <StatCard icon={Box} label="Models" value={run.total_models_trained} accent />
            <StatCard icon={BarChart3} label="Results" value={detail?.results_count ?? 0} />
            <StatCard icon={Terminal} label="Logs" value={(detail?.log_summary ?? []).reduce((sum, entry) => sum + (entry.log_count || 0), 0)} />
            <StatCard icon={HardDrive} label="Size" value={formatBytes(run.artifact_size_bytes)} />
          </div>
        </SheetHeader>

        <Separator className="my-4" />

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-1 flex-col overflow-hidden">
          <TabsList className="grid w-full grid-cols-2 gap-1 sm:grid-cols-4 flex-shrink-0">
            <TabsTrigger value="overview" className="text-xs">
              <BarChart3 className="mr-1.5 h-3.5 w-3.5" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="pipelines" className="text-xs">
              <ListTree className="mr-1.5 h-3.5 w-3.5" />
              Pipelines
            </TabsTrigger>
            <TabsTrigger value="logs" className="text-xs">
              <Terminal className="mr-1.5 h-3.5 w-3.5" />
              Logs
            </TabsTrigger>
            <TabsTrigger value="datasets" className="text-xs">
              <Database className="mr-1.5 h-3.5 w-3.5" />
              Datasets
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="mt-4 flex-1">
            <TabsContent value="overview" className="m-0">
              <RunDetailOverview
                run={run}
                datasets={datasets}
                detail={detail ?? null}
                detailLoading={detailLoading}
                onShowLogs={handleShowLogs}
                onShowPipelines={() => setActiveTab("pipelines")}
              />
            </TabsContent>

            <TabsContent value="pipelines" className="m-0">
              <RunDetailPipelines
                detail={detail ?? null}
                detailLoading={detailLoading}
                onShowLogs={handleShowLogs}
              />
            </TabsContent>

            <TabsContent value="logs" className="m-0">
              <RunDetailLogs
                detail={detail ?? null}
                selectedPipelineId={selectedPipelineId}
                onSelectedPipelineIdChange={setSelectedPipelineId}
                logs={logsResponse?.logs ?? []}
                logsLoading={logsLoading}
              />
            </TabsContent>

            <TabsContent value="datasets" className="m-0">
              <div className="space-y-4">
                {datasets.map((dataset) => (
                  <div key={dataset.dataset_name} className="space-y-3 rounded-lg border bg-card p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-medium">{dataset.dataset_name}</h4>
                        <p className="text-xs text-muted-foreground">
                          Folded scores, per-model drill-down, and prediction access for this dataset.
                        </p>
                      </div>
                      <Badge variant="outline">{dataset.pipeline_count} pipelines</Badge>
                    </div>

                    <DatasetResultCard
                      dataset={dataset}
                      selectedMetrics={selectedMetrics}
                      runId={run.run_id}
                      workspaceId={workspaceId}
                      defaultExpanded
                    />

                    <AllModelsPanel
                      workspaceId={workspaceId}
                      runId={run.run_id}
                      datasetName={dataset.dataset_name}
                      taskType={dataset.task_type}
                      totalPipelines={dataset.pipeline_count}
                    />
                  </div>
                ))}

                {datasets.length === 0 && (
                  <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                    {status === "running" || status === "queued"
                      ? "Fold-level dataset results will appear here as pipelines complete."
                      : "No dataset results are available for this run."}
                  </div>
                )}
              </div>
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

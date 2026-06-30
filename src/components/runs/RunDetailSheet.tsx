import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import {
  getN4AWorkspaceRunDetail,
  getWorkspaceRunPipelineLogs,
  rerunWorkspaceRun,
} from "@/api/linkedWorkspaces";
import type { EnrichedRun } from "@/types/enriched-runs";
import { filterParasiticDatasets } from "./datasetFilters";
import {
  DEFAULT_RUN_DETAIL_TAB,
  isBusyRunStatus,
  resolveRunStatus,
  type RunDetailTab,
} from "./RunDetailSheetDisplay";
import { RunDetailSheetHeader } from "./RunDetailSheetHeader";
import { RunDetailSheetTabs } from "./RunDetailSheetTabs";

interface RunDetailSheetProps {
  run: EnrichedRun | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  runPageId?: string | null;
  selectedMetrics?: string[];
}

export function RunDetailSheet({
  run,
  open,
  onOpenChange,
  workspaceId,
  runPageId = null,
  selectedMetrics = [],
}: RunDetailSheetProps) {
  const [activeTab, setActiveTab] = useState<RunDetailTab>(DEFAULT_RUN_DETAIL_TAB);
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
      setActiveTab(DEFAULT_RUN_DETAIL_TAB);
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

  const status = resolveRunStatus(run.status);

  const handleShowLogs = (pipelineId?: string) => {
    if (pipelineId) {
      setSelectedPipelineId(pipelineId);
    }
    setActiveTab("logs");
  };

  const canRerun = Boolean(
    detail?.rerun_ready
    && !isBusyRunStatus(status)
    && !detailLoading,
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col overflow-hidden sm:max-w-6xl">
        <RunDetailSheetHeader
          run={run}
          status={status}
          detail={detail ?? null}
          datasetsCount={datasets.length}
          runPageId={runPageId}
          canRerun={canRerun}
          isRerunning={rerunMutation.isPending}
          onRerun={() => rerunMutation.mutate()}
        />

        <Separator className="my-4" />

        <RunDetailSheetTabs
          activeTab={activeTab}
          onActiveTabChange={setActiveTab}
          run={run}
          datasets={datasets}
          detail={detail ?? null}
          detailLoading={detailLoading}
          onShowLogs={handleShowLogs}
          onShowPipelines={() => setActiveTab("pipelines")}
          selectedPipelineId={selectedPipelineId}
          onSelectedPipelineIdChange={setSelectedPipelineId}
          logs={logsResponse?.logs ?? []}
          logsLoading={logsLoading}
          selectedMetrics={selectedMetrics}
          workspaceId={workspaceId}
          status={status}
        />
      </SheetContent>
    </Sheet>
  );
}

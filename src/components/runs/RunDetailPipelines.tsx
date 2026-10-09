import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Box, Eye, GitBranch, Layers, ListTree, Terminal, Timer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RuntimeDiagnosticsList,
  RuntimeEngineBadge,
  RuntimeStatusBadge,
} from "@/components/runtime";
import { formatMetricValue } from "@/lib/scores";
import type { WorkspaceRunDetail, WorkspaceRunPipelineDetail } from "@/types/enriched-runs";
import { buildStoredPipelinePreview, formatDatetime, formatDurationMs } from "./runDetailUtils";

function PipelineCard({
  pipeline,
  onShowLogs,
}: {
  pipeline: WorkspaceRunPipelineDetail;
  onShowLogs: (pipelineId: string) => void;
}) {
  const { t } = useTranslation();
  const preview = buildStoredPipelinePreview(pipeline.expanded_config);

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold">{pipeline.name || pipeline.pipeline_id}</h4>
            {pipeline.dataset_name && (
              <Badge variant="outline" className="text-[10px]">
                {pipeline.dataset_name}
              </Badge>
            )}
            {pipeline.status && <RuntimeStatusBadge status={pipeline.status} showIcon={false} className="text-[10px]" />}
            <RuntimeEngineBadge source={pipeline} />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Timer className="h-3 w-3" />
              {formatDurationMs(pipeline.duration_ms ?? pipeline.total_duration_ms)}
            </span>
            {pipeline.metric && <span>{pipeline.metric}</span>}
            {pipeline.splitter_class && (
              <span className="flex items-center gap-1">
                <GitBranch className="h-3 w-3" />
                {pipeline.splitter_class}
              </span>
            )}
            {pipeline.log_count != null && (
              <span className="flex items-center gap-1">
                <Terminal className="h-3 w-3" />
                {t("runs.detail.pipelines.logCount", { count: pipeline.log_count })}
              </span>
            )}
            {(pipeline.warning_count ?? 0) > 0 && (
              <Badge variant="outline" className="border-amber-500/30 text-[10px] text-amber-600">
                {t("runs.detail.pipelines.warningCount", { count: pipeline.warning_count })}
              </Badge>
            )}
            {(pipeline.error_count ?? 0) > 0 && (
              <Badge variant="outline" className="border-destructive/30 text-[10px] text-destructive">
                {t("runs.detail.pipelines.errorCount", { count: pipeline.error_count })}
              </Badge>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 self-start">
          <Button variant="outline" size="sm" onClick={() => onShowLogs(pipeline.pipeline_id)}>
            <Terminal className="mr-2 h-4 w-4" />
            {t("runs.detail.tabLogs")}
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to={`/pipelines/new?runPipelineId=${encodeURIComponent(pipeline.pipeline_id)}`}>
              <Eye className="mr-2 h-4 w-4" />
              {t("runs.detail.pipelines.load")}
            </Link>
          </Button>
        </div>
      </div>

      <RuntimeDiagnosticsList source={pipeline} className="border-b px-4 py-3" />

      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("runs.detail.pipelines.stored")}</span>
            <span className="text-xs text-muted-foreground">{t("runs.detail.pipelines.stepCount", { count: preview.totalSteps })}</span>
          </div>
          <div className="rounded-lg border bg-muted/15 p-3">
            {preview.nodes.length > 0 ? (
              <div className="space-y-1">
                {preview.nodes.map((node) => (
                  <div
                    key={node.id}
                    className="flex items-center gap-2 rounded-md px-2 py-1 text-sm"
                    style={{ paddingLeft: `${node.depth * 18 + 8}px` }}
                  >
                    {node.kind === "model" ? (
                      <Box className="h-3.5 w-3.5 shrink-0 text-chart-1" />
                    ) : node.kind === "branch" ? (
                      <GitBranch className="h-3.5 w-3.5 shrink-0 text-chart-2" />
                    ) : (
                      <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 truncate">{node.label}</span>
                    {node.hasGenerator && (
                      <Badge variant="outline" className="text-[9px]">
                        {t("runs.detail.pipelines.generator")}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">{t("runs.detail.pipelines.noSteps")}</div>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-lg border bg-muted/10 p-3">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t("runs.detail.pipelines.scores")}</div>
            <div className="mt-2 grid gap-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{t("runs.detail.pipelines.bestCv")}</span>
                <span className="font-mono">{formatMetricValue(pipeline.best_val, pipeline.metric ?? undefined)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{t("runs.detail.pipelines.bestRefit")}</span>
                <span className="font-mono">{formatMetricValue(pipeline.best_test, pipeline.metric ?? undefined)}</span>
              </div>
            </div>
          </div>
          <div className="rounded-lg border bg-muted/10 p-3">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t("runs.detail.pipelines.timestamps")}</div>
            <div className="mt-2 grid gap-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{t("runs.detail.overview.started")}</span>
                <span className="text-right">{formatDatetime(pipeline.created_at)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{t("runs.detail.overview.completed")}</span>
                <span className="text-right">{formatDatetime(pipeline.completed_at)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {pipeline.error && (
        <div className="border-t border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {pipeline.error}
        </div>
      )}
    </div>
  );
}

export function RunDetailPipelines({
  detail,
  detailLoading,
  onShowLogs,
}: {
  detail: WorkspaceRunDetail | null;
  detailLoading: boolean;
  onShowLogs: (pipelineId: string) => void;
}) {
  const { t } = useTranslation();

  if (detailLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-48 w-full" />
        ))}
      </div>
    );
  }

  if (!detail || detail.pipelines.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        <ListTree className="mx-auto mb-2 h-8 w-8 opacity-50" />
        <p className="text-sm">{t("runs.detail.pipelines.unavailable")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {detail.pipelines.map((pipeline) => (
        <PipelineCard key={pipeline.pipeline_id} pipeline={pipeline} onShowLogs={onShowLogs} />
      ))}
    </div>
  );
}

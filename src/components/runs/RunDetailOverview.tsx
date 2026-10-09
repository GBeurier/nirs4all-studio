import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertCircle, BarChart3, Box, Database, FileWarning, Layers, ListTree, Settings2, Terminal, Timer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import { formatMetricName, formatScore } from "@/lib/scores";
import type { EnrichedDatasetRun, EnrichedRun, WorkspaceRunDetail } from "@/types/enriched-runs";
import { formatBoolean, formatCVStrategy, formatDatetime, formatDuration } from "./runDetailUtils";

function ConfigItem({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium">{value != null && value !== "" ? String(value) : "-"}</p>
    </div>
  );
}

export function RunDetailOverview({
  run,
  datasets,
  detail,
  detailLoading,
  onShowLogs,
  onShowPipelines,
}: {
  run: EnrichedRun;
  datasets: EnrichedDatasetRun[];
  detail: WorkspaceRunDetail | null;
  detailLoading: boolean;
  onShowLogs: (pipelineId?: string) => void;
  onShowPipelines: () => void;
}) {
  const { t } = useTranslation();
  const config = (detail?.config ?? run.config ?? {}) as Record<string, unknown>;
  const uniquePreprocessings = Array.from(new Set(
    datasets.flatMap((dataset) => dataset.top_5.map((chain) => chain.preprocessings).filter(Boolean)),
  ));
  const detailDatasets = (detail?.datasets ?? []).map((dataset) => ({
    ...dataset,
    score: datasets.find((candidate) => candidate.dataset_name === dataset.name),
  }));
  const warningCount = (detail?.log_summary ?? []).reduce((sum, entry) => sum + (entry.warning_count || 0), 0);
  const errorCount = (detail?.log_summary ?? []).reduce((sum, entry) => sum + (entry.error_count || 0), 0);
  const totalLogs = (detail?.log_summary ?? []).reduce((sum, entry) => sum + (entry.log_count || 0), 0);

  if (detailLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-44 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {(run.error || detail?.error) && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <h4 className="flex items-center gap-2 text-sm font-medium text-destructive">
            <AlertCircle className="h-4 w-4" />
            {t("runs.detail.overview.error")}
          </h4>
          <p className="mt-2 whitespace-pre-wrap font-mono text-sm text-muted-foreground">{detail?.error || run.error}</p>
        </div>
      )}

      {detail && detail.rerun_ready === false && (detail.unresolved_dataset_names?.length ?? 0) > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
          <h4 className="flex items-center gap-2 text-sm font-medium text-amber-600">
            <FileWarning className="h-4 w-4" />
            {t("runs.detail.overview.rerunNeedsRelink")}
          </h4>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("runs.detail.overview.unlinkedDatasets", { names: detail.unresolved_dataset_names?.join(", ") })}
          </p>
        </div>
      )}

      <div className="rounded-lg border bg-card p-4">
        <h4 className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Settings2 className="h-4 w-4 text-muted-foreground" />
          {t("runs.detail.overview.executionConfig")}
        </h4>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <ConfigItem label={t("runs.detail.overview.cvStrategy")} value={formatCVStrategy(config.cv_strategy)} />
          <ConfigItem label={t("runs.detail.overview.splitter")} value={typeof config.splitter_class === "string" ? config.splitter_class : null} />
          <ConfigItem label={t("runs.detail.overview.cvFolds")} value={typeof config.cv_folds === "number" ? config.cv_folds : null} />
          <ConfigItem label={t("runs.detail.overview.metric")} value={formatMetricName(typeof config.metric === "string" ? config.metric : datasets[0]?.metric)} />
          <ConfigItem label={t("runs.detail.overview.randomState")} value={typeof config.random_state === "number" ? config.random_state : null} />
          <ConfigItem label={t("runs.detail.overview.shuffle")} value={formatBoolean(config.shuffle)} />
          <ConfigItem label={t("runs.detail.overview.testSize")} value={typeof config.test_size === "number" ? config.test_size : null} />
          <ConfigItem label={t("runs.detail.overview.refit")} value={formatBoolean(config.has_refit)} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-4">
          <h4 className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Timer className="h-4 w-4 text-muted-foreground" />
            {t("runs.detail.overview.timing")}
          </h4>
          <div className="grid gap-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{t("runs.detail.overview.started")}</span>
              <span>{formatDatetime(run.created_at)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{t("runs.detail.overview.completed")}</span>
              <span>{formatDatetime(run.completed_at)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{t("runs.detail.overview.runDuration")}</span>
              <span className="font-medium">{formatDuration(run.duration_seconds)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{t("runs.detail.overview.storedPipelines")}</span>
              <span>{detail?.pipelines.length ?? run.pipeline_runs_count}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{t("runs.detail.overview.resultsRows")}</span>
              <span>{detail?.results_count ?? 0}</span>
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <h4 className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Terminal className="h-4 w-4 text-muted-foreground" />
            {t("runs.detail.tabLogs")}
          </h4>
          <div className="grid gap-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{t("runs.detail.overview.structuredEntries")}</span>
              <span>{totalLogs}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{t("runs.detail.overview.warnings")}</span>
              <span className={cn(warningCount > 0 && "font-medium text-amber-600")}>{warningCount}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{t("runs.detail.overview.errors")}</span>
              <span className={cn(errorCount > 0 && "font-medium text-destructive")}>{errorCount}</span>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={() => onShowLogs(detail?.pipelines[0]?.pipeline_id)}>
              <Terminal className="mr-2 h-4 w-4" />
              {t("runs.detail.overview.openLogs")}
            </Button>
            <Button variant="outline" size="sm" className="flex-1" onClick={onShowPipelines}>
              <ListTree className="mr-2 h-4 w-4" />
              {t("runs.detail.overview.viewPipelines")}
            </Button>
          </div>
        </div>
      </div>

      {detailDatasets.length > 0 && (
        <div className="overflow-hidden rounded-lg border">
          <div className="border-b bg-muted/30 p-3">
            <h4 className="flex items-center gap-2 text-sm font-medium">
              <Database className="h-4 w-4 text-muted-foreground" />
              {t("runs.detail.tabDatasets")}
            </h4>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/10">
                <TableHead className="text-xs">{t("runs.detail.overview.dataset")}</TableHead>
                <TableHead className="text-xs">{t("runs.detail.overview.linkedDataset")}</TableHead>
                <TableHead className="text-xs">{t("runs.detail.overview.sampleGrouping")}</TableHead>
                <TableHead className="text-xs text-right">{t("runs.detail.overview.samples")}</TableHead>
                <TableHead className="text-xs text-right">{t("runs.detail.overview.features")}</TableHead>
                <TableHead className="text-xs text-right">{t("runs.detail.overview.bestScore")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detailDatasets.map((dataset) => (
                <TableRow key={dataset.name}>
                  <TableCell className="font-medium">{dataset.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{dataset.linked_dataset_id || "-"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{dataset.repetition || dataset.aggregate || "-"}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{dataset.score?.n_samples ?? "-"}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{dataset.score?.n_features ?? "-"}</TableCell>
                  <TableCell className="text-right font-mono text-sm font-bold">
                    {formatScore(dataset.score?.best_final_score ?? dataset.score?.best_avg_val_score)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {run.model_classes && run.model_classes.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <h4 className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Box className="h-4 w-4 text-muted-foreground" />
            {t("runs.detail.overview.modelTypes")}
          </h4>
          <div className="flex flex-wrap gap-2">
            {run.model_classes.map((modelClass) => (
              <Badge key={modelClass.name} variant="secondary" className="text-xs">
                {modelClass.name}
                <span className="ml-1.5 text-muted-foreground">&times;{modelClass.count}</span>
              </Badge>
            ))}
          </div>
        </div>
      )}

      {uniquePreprocessings.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <h4 className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Layers className="h-4 w-4 text-muted-foreground" />
            {t("runs.detail.overview.preprocessingChains")}
          </h4>
          <div className="flex flex-wrap gap-2">
            {uniquePreprocessings.map((preprocessing) => (
              <Badge key={preprocessing} variant="outline" className="text-xs font-mono">
                {preprocessing}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <Separator />

      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1" asChild>
          <Link to={`/results?run_id=${encodeURIComponent(run.run_id)}`}>
            <BarChart3 className="mr-2 h-4 w-4" />
            {t("runs.detail.overview.viewFullResults")}
          </Link>
        </Button>
      </div>
    </div>
  );
}

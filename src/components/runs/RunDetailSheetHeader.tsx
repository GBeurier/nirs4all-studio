import { Link } from "react-router-dom";
import {
  BarChart3,
  Box,
  Database,
  ExternalLink,
  HardDrive,
  Layers,
  Play,
  RefreshCw,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  RuntimeEngineBadge,
  RuntimeStatusBadge,
  RuntimeStatusIconFrame,
} from "@/components/runtime";
import { buildRunStorageArtifactMetadata } from "@/lib/runs/pageData";
import { cn } from "@/lib/utils";
import type { EnrichedRun, WorkspaceRunDetail } from "@/types/enriched-runs";
import { formatDatetime, formatDuration } from "./runDetailUtils";
import {
  getRerunDisabledTitle,
  getTotalLogCount,
} from "./RunDetailSheetDisplay";

function StatCard({
  icon: Icon,
  label,
  value,
  title,
  accent = false,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  title?: string;
  accent?: boolean;
}) {
  return (
    <div className={cn("rounded-lg p-2.5 text-center", accent ? "bg-chart-1/10" : "bg-muted/30")} title={title}>
      <Icon className={cn("mx-auto mb-0.5 h-3.5 w-3.5", accent ? "text-chart-1" : "text-muted-foreground")} />
      <p className="text-base font-semibold">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

export function RunDetailSheetHeader({
  run,
  status,
  detail,
  datasetsCount,
  runPageId,
  canRerun,
  isRerunning,
  onRerun,
}: {
  run: EnrichedRun;
  status: string;
  detail: WorkspaceRunDetail | null;
  datasetsCount: number;
  runPageId: string | null;
  canRerun: boolean;
  isRerunning: boolean;
  onRerun: () => void;
}) {
  const storageArtifactMetadata = buildRunStorageArtifactMetadata(run);
  const artifactSizeField = storageArtifactMetadata.fields.find((field) => field.key === "artifact-size");
  const storageArtifactSummary = storageArtifactMetadata.fields
    .map((field) => `${field.label}: ${field.value}`)
    .join("\n");

  return (
    <SheetHeader className="flex-shrink-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <RuntimeStatusIconFrame status={status} />
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
              <RuntimeEngineBadge source={detail ?? run} />
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
            onClick={onRerun}
            disabled={!canRerun || isRerunning}
            title={getRerunDisabledTitle(detail?.rerun_ready)}
          >
            {isRerunning ? (
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            Rerun As Clone
          </Button>
          <RuntimeStatusBadge status={status} showIcon={false} />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
        <StatCard icon={Database} label="Datasets" value={datasetsCount} />
        <StatCard icon={Layers} label="Pipelines" value={detail?.pipelines.length ?? run.pipeline_runs_count} />
        <StatCard icon={Box} label="Models" value={run.total_models_trained} accent />
        <StatCard icon={BarChart3} label="Results" value={detail?.results_count ?? 0} />
        <StatCard icon={Terminal} label="Logs" value={getTotalLogCount(detail)} />
        <StatCard
          icon={HardDrive}
          label={artifactSizeField?.label ?? "Artifact size"}
          value={artifactSizeField?.value ?? storageArtifactMetadata.artifactSizeLabel}
          title={storageArtifactSummary}
        />
      </div>
    </SheetHeader>
  );
}

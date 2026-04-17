import { Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import type { WorkspaceRunDetail, WorkspaceRunPipelineLogEntry } from "@/types/enriched-runs";
import { downloadTextFile, formatLogLine } from "./runDetailUtils";

export function RunDetailLogs({
  detail,
  selectedPipelineId,
  onSelectedPipelineIdChange,
  logs,
  logsLoading,
}: {
  detail: WorkspaceRunDetail | null;
  selectedPipelineId: string | null;
  onSelectedPipelineIdChange: (pipelineId: string) => void;
  logs: WorkspaceRunPipelineLogEntry[];
  logsLoading: boolean;
}) {
  const selectedPipeline = detail?.pipelines.find((pipeline) => pipeline.pipeline_id === selectedPipelineId) ?? null;

  if (!detail || detail.pipelines.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        <Terminal className="mx-auto mb-2 h-8 w-8 opacity-50" />
        <p className="text-sm">No persisted logs are available for this run.</p>
      </div>
    );
  }

  const handleDownload = () => {
    if (!selectedPipeline) return;
    const filename = `${selectedPipeline.name || selectedPipeline.pipeline_id}_logs.txt`;
    downloadTextFile(filename, logs.map(formatLogLine).join("\n"));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pipeline Log Stream</p>
          <Select value={selectedPipelineId ?? undefined} onValueChange={onSelectedPipelineIdChange}>
            <SelectTrigger className="h-9 w-full lg:w-[340px]">
              <SelectValue placeholder="Select a pipeline" />
            </SelectTrigger>
            <SelectContent>
              {detail.pipelines.map((pipeline) => (
                <SelectItem key={pipeline.pipeline_id} value={pipeline.pipeline_id}>
                  {pipeline.name || pipeline.pipeline_id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{logs.length} entries</span>
          <Button variant="outline" size="sm" disabled={logs.length === 0} onClick={handleDownload}>
            <Terminal className="mr-2 h-4 w-4" />
            Download
          </Button>
        </div>
      </div>

      {selectedPipeline && (
        <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <div className="rounded-lg border bg-card p-4">
            <div className="space-y-2 text-sm">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Selected Pipeline</div>
              <div className="font-medium">{selectedPipeline.name || selectedPipeline.pipeline_id}</div>
              {selectedPipeline.dataset_name && <div className="text-muted-foreground">{selectedPipeline.dataset_name}</div>}
              <Separator className="my-3" />
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Status</span>
                <span>{selectedPipeline.status || "-"}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Warnings</span>
                <span>{selectedPipeline.warning_count ?? 0}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Errors</span>
                <span>{selectedPipeline.error_count ?? 0}</span>
              </div>
            </div>
          </div>

          <div className="rounded-lg border bg-muted/20 p-4 font-mono text-xs">
            {logsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, index) => (
                  <Skeleton key={index} className="h-4 w-full" />
                ))}
              </div>
            ) : logs.length > 0 ? (
              <div className="max-h-[34rem] space-y-1 overflow-auto">
                {logs.map((entry) => (
                  <div
                    key={entry.log_id}
                    className={
                      entry.level === "error"
                        ? "whitespace-pre-wrap break-words rounded bg-destructive/10 px-2 py-1 text-destructive"
                        : entry.level === "warning"
                        ? "whitespace-pre-wrap break-words rounded bg-amber-500/10 px-2 py-1 text-amber-700"
                        : "whitespace-pre-wrap break-words rounded px-2 py-1 text-muted-foreground"
                    }
                  >
                    {formatLogLine(entry)}
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-10 text-center text-muted-foreground">
                No structured log rows were stored for this pipeline.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

import { useState } from "react";
import { DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  Check,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileCode,
  FileJson,
  FileText,
  Loader2,
  Pencil,
  Play,
  Square,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  usePipelineExport,
  type Dataset,
  type ExecutionStatus,
  type ExportResult,
} from "@/hooks/usePipelineExecution";
import { cn } from "@/lib/utils";
import type { PipelineExecutionPlanPreview } from "./pipelineExecutionDialogData";

export {
  RuntimeGroupingConflictNotice,
  RuntimeGroupingSection,
  RuntimeGroupingStatusMessage,
} from "./PipelineExecutionRuntimeGrouping";
export { ExecutionFeedback } from "./PipelineExecutionFeedback";

export type PipelineLaunchMode = "execute" | "quick" | "background";

export function ConnectionIndicator({ connected }: { connected: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 text-xs",
        connected ? "text-emerald-500" : "text-amber-500",
      )}
    >
      {connected ? (
        <>
          <Wifi className="h-3 w-3" />
          <span>Connected</span>
        </>
      ) : (
        <>
          <WifiOff className="h-3 w-3" />
          <span>Connecting...</span>
        </>
      )}
    </div>
  );
}

export function StatusBadge({ status }: { status: ExecutionStatus }) {
  const variants: Record<
    ExecutionStatus,
    { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: typeof Play }
  > = {
    idle: { label: "Ready", variant: "secondary", icon: Play },
    starting: { label: "Starting...", variant: "default", icon: Loader2 },
    running: { label: "Running", variant: "default", icon: Loader2 },
    completed: { label: "Completed", variant: "default", icon: Check },
    failed: { label: "Failed", variant: "destructive", icon: X },
    cancelled: { label: "Cancelled", variant: "secondary", icon: Square },
  };

  const config = variants[status];
  const Icon = config.icon;

  return (
    <Badge variant={config.variant} className="gap-1.5">
      <Icon
        className={cn(
          "h-3 w-3",
          (status === "starting" || status === "running") && "animate-spin",
        )}
      />
      {config.label}
    </Badge>
  );
}

export function RunNameField({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium flex items-center gap-2">
        <Pencil className="h-4 w-4" />
        Run Name
      </label>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Enter run name..."
        disabled={disabled}
      />
    </div>
  );
}

function DatasetOptionLabel({ dataset }: { dataset: Dataset }) {
  return (
    <div className="flex items-center gap-2">
      <span>{dataset.name}</span>
      {dataset.numSamples && (
        <span className="text-xs text-muted-foreground">
          ({dataset.numSamples} samples)
        </span>
      )}
    </div>
  );
}

export function DatasetSelector({
  datasets,
  disabled,
  isLoading,
  selectedDataset,
  onDatasetChange,
}: {
  datasets: Dataset[];
  disabled: boolean;
  isLoading: boolean;
  selectedDataset: string;
  onDatasetChange: (datasetId: string) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium flex items-center gap-2">
        <Database className="h-4 w-4" />
        Dataset
      </label>
      <Select
        value={selectedDataset}
        onValueChange={onDatasetChange}
        disabled={disabled}
      >
        <SelectTrigger>
          <SelectValue placeholder="Select a dataset..." />
        </SelectTrigger>
        <SelectContent>
          {isLoading ? (
            <div className="p-2 text-sm text-muted-foreground">
              Loading...
            </div>
          ) : datasets.length === 0 ? (
            <div className="p-2 text-sm text-muted-foreground">
              No datasets available
            </div>
          ) : (
            datasets.map((dataset) => (
              <SelectItem key={dataset.id} value={dataset.id}>
                <DatasetOptionLabel dataset={dataset} />
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
    </div>
  );
}

export function ExecutionPlanPreview({
  preview,
}: {
  preview: PipelineExecutionPlanPreview | null;
}) {
  if (!preview) return null;

  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="bg-background/70 text-[11px]">
          {preview.runCountLabel}
        </Badge>
        <Badge variant="outline" className="bg-background/70 text-[11px]">
          {preview.backendLabel}
        </Badge>
        <Badge variant="outline" className="bg-background/70 text-[11px]">
          {preview.pipelineSourceLabel}
        </Badge>
        <span>{preview.splitGroupByLabel}</span>
      </div>
      <div className="mt-1">
        {preview.inputCardinalityLabel} - {preview.matrixCoverageLabel}
      </div>
    </div>
  );
}

export function ExportPanel({
  pipelineId,
}: {
  pipelineId: string;
}) {
  const { isExporting, exportPipeline, downloadExport, copyToClipboard } =
    usePipelineExport();
  const [lastExport, setLastExport] = useState<ExportResult | null>(null);

  const handleExport = async (format: "python" | "yaml" | "json") => {
    const result = await exportPipeline(pipelineId, { format });
    if (result) {
      setLastExport(result);
      toast.success(`Exported as ${format.toUpperCase()}`);
    }
  };

  const handleDownload = () => {
    if (lastExport) {
      downloadExport(lastExport);
      toast.success("File downloaded");
    }
  };

  const handleCopy = async () => {
    if (lastExport) {
      const success = await copyToClipboard(lastExport);
      if (success) {
        toast.success("Copied to clipboard");
      }
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleExport("python")}
          disabled={isExporting}
        >
          <FileCode className="h-4 w-4 mr-2" />
          Python
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleExport("yaml")}
          disabled={isExporting}
        >
          <FileText className="h-4 w-4 mr-2" />
          YAML
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleExport("json")}
          disabled={isExporting}
        >
          <FileJson className="h-4 w-4 mr-2" />
          JSON
        </Button>
      </div>

      {lastExport && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{lastExport.filename}</span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={handleCopy}>
                <Copy className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={handleDownload}>
                <Download className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <ScrollArea className="h-48 rounded-lg border bg-muted">
            <pre className="p-3 text-xs font-mono">{lastExport.content}</pre>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}

export function ExecutionActions({
  canRun,
  isQuickRunning,
  status,
  onCancel,
  onContinueWorking,
  onDone,
  onLaunch,
  onRunAgain,
  onStopExecution,
}: {
  canRun: boolean;
  isQuickRunning: boolean;
  status: ExecutionStatus;
  onCancel: () => void;
  onContinueWorking: () => void;
  onDone: () => void;
  onLaunch: (mode: PipelineLaunchMode) => void;
  onRunAgain: () => void;
  onStopExecution: () => void;
}) {
  return (
    <DialogFooter className="gap-2 flex-wrap">
      {status === "idle" && !isQuickRunning && (
        <>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => onLaunch("background")}
            disabled={!canRun}
            className="gap-2"
          >
            <Play className="h-4 w-4" />
            Start in Background
          </Button>
          <Button
            variant="outline"
            onClick={() => onLaunch("quick")}
            disabled={!canRun}
            className="gap-2"
          >
            <ExternalLink className="h-4 w-4" />
            Run & Track Progress
          </Button>
          <Button
            onClick={() => onLaunch("execute")}
            disabled={!canRun}
            className="gap-2"
          >
            <Play className="h-4 w-4" />
            Execute Here
          </Button>
        </>
      )}

      {isQuickRunning && (
        <Button disabled className="gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Starting Run...
        </Button>
      )}

      {(status === "starting" || status === "running") && (
        <>
          <Button variant="outline" onClick={onContinueWorking} className="gap-2">
            Continue Working
          </Button>
          <Button variant="destructive" onClick={onStopExecution} className="gap-2">
            <Square className="h-4 w-4" />
            Stop Execution
          </Button>
        </>
      )}

      {(status === "completed" ||
        status === "failed" ||
        status === "cancelled") && (
        <>
          <Button variant="outline" onClick={onRunAgain}>
            Run Again
          </Button>
          <Button onClick={onDone}>Done</Button>
        </>
      )}
    </DialogFooter>
  );
}

import {
  Download,
  FileCode,
  FileJson,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  Trash2,
  Upload,
} from "lucide-react";
import type { PipelineSampleInfo } from "@/api/pipelines";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CanonicalPipelineExportFormat } from "@/lib/pipelineEditorExport";

interface PipelineEditorActionsMenuProps {
  viewMode: "tree" | "code";
  onViewModeChange: (mode: "tree" | "code") => void;
  totalSteps: number;
  onExportJson: () => void;
  onExportCanonical: (format: CanonicalPipelineExportFormat) => void | Promise<void>;
  onImportClick: () => void;
  onLoadSamples: () => void | Promise<void>;
  samples: PipelineSampleInfo[];
  samplesLoading: boolean;
  onLoadSample: (sampleId: string, sampleName: string) => void | Promise<void>;
  onClearPipeline: () => void;
}

export function PipelineEditorActionsMenu({
  viewMode,
  onViewModeChange,
  totalSteps,
  onExportJson,
  onExportCanonical,
  onImportClick,
  onLoadSamples,
  samples,
  samplesLoading,
  onLoadSample,
  onClearPipeline,
}: PipelineEditorActionsMenuProps) {
  const nextViewMode = viewMode === "code" ? "tree" : "code";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-popover">
        <DropdownMenuItem
          onClick={() => onViewModeChange(nextViewMode)}
          disabled={totalSteps === 0}
        >
          <FileCode className="h-4 w-4 mr-2" />
          {viewMode === "code" ? "Switch to Tree View" : "View as Code"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onExportJson}>
          <Download className="h-4 w-4 mr-2" />
          Export as JSON (Editor)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => { void onExportCanonical("json"); }}>
          <FileJson className="h-4 w-4 mr-2" />
          Export as JSON (Canonical)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => { void onExportCanonical("yaml"); }}>
          <FileCode className="h-4 w-4 mr-2" />
          Export as YAML (Canonical)
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onImportClick}>
          <Upload className="h-4 w-4 mr-2" />
          Import JSON or YAML
        </DropdownMenuItem>
        <DropdownMenuSub onOpenChange={(open) => { if (open) void onLoadSamples(); }}>
          <DropdownMenuSubTrigger>
            <FolderOpen className="h-4 w-4 mr-2" />
            Load Sample Pipeline
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="bg-popover max-h-80 overflow-y-auto min-w-[280px]">
            {samplesLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 mr-2 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Loading samples...</span>
              </div>
            ) : samples.length === 0 ? (
              <DropdownMenuItem disabled>
                No samples available
              </DropdownMenuItem>
            ) : (
              samples.map((sample) => (
                <DropdownMenuItem
                  key={sample.id}
                  onClick={() => { void onLoadSample(sample.id, sample.name); }}
                >
                  <FileJson className="h-4 w-4 mr-2 text-muted-foreground" />
                  <div className="flex flex-col">
                    <span>{sample.name}</span>
                    {sample.description && (
                      <span className="text-xs text-muted-foreground truncate max-w-48">
                        {sample.description}
                      </span>
                    )}
                  </div>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={onClearPipeline}
          className="text-destructive focus:text-destructive"
          disabled={totalSteps === 0}
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Clear All Steps
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

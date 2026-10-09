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
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const nextViewMode = viewMode === "code" ? "tree" : "code";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label={t("pipelineEditor.shell.actions.more")}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-popover">
        <DropdownMenuItem
          onClick={() => onViewModeChange(nextViewMode)}
          disabled={totalSteps === 0}
        >
          <FileCode className="h-4 w-4 mr-2" />
          {viewMode === "code" ? t("pipelineEditor.shell.header.switchToTree") : t("pipelineEditor.shell.header.viewAsCode")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onExportJson}>
          <Download className="h-4 w-4 mr-2" />
          {t("pipelineEditor.shell.actions.exportJsonEditor")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => { void onExportCanonical("json"); }}>
          <FileJson className="h-4 w-4 mr-2" />
          {t("pipelineEditor.shell.actions.exportJson")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => { void onExportCanonical("yaml"); }}>
          <FileCode className="h-4 w-4 mr-2" />
          {t("pipelineEditor.shell.actions.exportYaml")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onImportClick}>
          <Upload className="h-4 w-4 mr-2" />
          {t("pipelineEditor.shell.actions.importFile")}
        </DropdownMenuItem>
        <DropdownMenuSub onOpenChange={(open) => { if (open) void onLoadSamples(); }}>
          <DropdownMenuSubTrigger>
            <FolderOpen className="h-4 w-4 mr-2" />
            {t("pipelineEditor.shell.actions.loadSample")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="bg-popover max-h-80 overflow-y-auto min-w-[280px]">
            {samplesLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 mr-2 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{t("pipelines.editor.loadingSamples")}</span>
              </div>
            ) : samples.length === 0 ? (
              <DropdownMenuItem disabled>
                {t("pipelineEditor.shell.actions.noSamples")}
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
          {t("pipelineEditor.shell.actions.clearAll")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

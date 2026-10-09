import {
  ArrowLeft,
  Command,
  FileCode,
  Keyboard,
  Play,
  Plus,
  Redo2,
  Save,
  Star,
  Undo2,
  Workflow,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PipelineSampleInfo } from "@/api/pipelines";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { PipelineConfig } from "@/hooks/usePipelineEditor";
import type { CanonicalPipelineExportFormat } from "@/lib/pipelineEditorExport";
import { PipelineEditorActionsMenu } from "./PipelineEditorActionsMenu";
import { PipelineEditorHeaderBadges } from "./PipelineEditorHeaderBadges";
import { PipelineEditorSettingsPopover } from "./PipelineEditorSettingsPopover";
import type {
  LegacyStepType,
  PipelineStep,
} from "./types";

interface PipelineEditorHeaderProps {
  pipelineName: string;
  onPipelineNameChange: (name: string) => void;
  isNew: boolean;
  isDirty: boolean;
  totalSteps: number;
  stepCounts: Record<LegacyStepType, number>;
  steps: PipelineStep[];
  variantCount: number;
  variantBreakdown: Record<string, { name: string; count: number }>;
  variantWarning?: string;
  isCountingVariants: boolean;
  viewMode: "tree" | "code";
  onViewModeChange: (mode: "tree" | "code") => void;
  pipelineConfig: PipelineConfig;
  onPipelineConfigChange: (config: PipelineConfig) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onBack: () => void;
  onNewPipeline: () => void;
  onOpenShortcuts: () => void;
  onOpenCommandPalette: () => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onExportJson: () => void;
  onExportCanonical: (format: CanonicalPipelineExportFormat) => void | Promise<void>;
  onImportClick: () => void;
  onLoadSamples: () => void | Promise<void>;
  samples: PipelineSampleInfo[];
  samplesLoading: boolean;
  onLoadSample: (sampleId: string, sampleName: string) => void | Promise<void>;
  onClearPipeline: () => void;
  onSave: () => void;
  onUseInExperiment: () => void;
}

export function PipelineEditorHeader({
  pipelineName,
  onPipelineNameChange,
  isNew,
  isDirty,
  totalSteps,
  stepCounts,
  steps,
  variantCount,
  variantBreakdown,
  variantWarning,
  isCountingVariants,
  viewMode,
  onViewModeChange,
  pipelineConfig,
  onPipelineConfigChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onBack,
  onNewPipeline,
  onOpenShortcuts,
  onOpenCommandPalette,
  isFavorite,
  onToggleFavorite,
  onExportJson,
  onExportCanonical,
  onImportClick,
  onLoadSamples,
  samples,
  samplesLoading,
  onLoadSample,
  onClearPipeline,
  onSave,
  onUseInExperiment,
}: PipelineEditorHeaderProps) {
  const { t } = useTranslation();
  const nextViewMode = viewMode === "code" ? "tree" : "code";

  return (
    <header className="border-b border-border bg-card px-4 py-3 flex-shrink-0">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-4">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon" aria-label={t("common.a11y.goBack")}
                onClick={onBack}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("pipelines.editor.backToPipelines")}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={onNewPipeline}
                className="border-primary/30 text-primary hover:bg-primary/10 hover:text-primary"
              >
                <Plus className="mr-1.5 h-4 w-4" />
                {t("pipelineEditor.shell.header.new")}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isNew && isDirty
                ? t("pipelineEditor.shell.header.newTooltipDraft")
                : t("pipelineEditor.shell.header.newTooltip")}
            </TooltipContent>
          </Tooltip>

          <div className="flex min-w-0 flex-col">
            <div className="flex min-w-0 items-center gap-2">
              <Workflow className="h-5 w-5 text-muted-foreground" />
              <Input
                value={pipelineName}
                aria-label={t("pipelineEditor.shell.header.pipelineName")}
                onChange={(e) => onPipelineNameChange(e.target.value)}
                className="text-lg font-semibold bg-transparent px-2 py-1 h-auto border border-transparent hover:border-border/50 focus:border-primary/50 focus-visible:ring-1 focus-visible:ring-primary/30 focus-visible:ring-offset-0 rounded-md transition-colors w-auto"
                style={{ minWidth: "200px" }}
              />
              {isDirty && (
                <span
                  className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"
                  title={t("pipelineEditor.shell.header.unsavedTitle")}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  {t("pipelineEditor.shell.header.unsaved")}
                </span>
              )}
            </div>
            <PipelineEditorHeaderBadges
              totalSteps={totalSteps}
              stepCounts={stepCounts}
              steps={steps}
              variantCount={variantCount}
              variantBreakdown={variantBreakdown}
              variantWarning={variantWarning}
              isCountingVariants={isCountingVariants}
              isDirty={isDirty}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="flex items-center border-r border-border pr-2 mr-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon" aria-label={t("common.a11y.undo")}
                  onClick={onUndo}
                  disabled={!canUndo}
                >
                  <Undo2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("pipelineEditor.shell.header.undoTooltip")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon" aria-label={t("common.a11y.redo")}
                  onClick={onRedo}
                  disabled={!canRedo}
                >
                  <Redo2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("pipelineEditor.shell.header.redoTooltip")}</TooltipContent>
            </Tooltip>
          </div>

          <PipelineEditorSettingsPopover
            pipelineConfig={pipelineConfig}
            onPipelineConfigChange={onPipelineConfigChange}
          />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={viewMode === "code" ? "secondary" : "ghost"}
                size="icon" aria-label={t("common.a11y.toggleCodeView")}
                onClick={() => onViewModeChange(nextViewMode)}
                disabled={totalSteps === 0}
              >
                <FileCode className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {viewMode === "code" ? t("pipelineEditor.shell.header.switchToTree") : t("pipelineEditor.shell.header.viewAsCode")}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon" aria-label={t("common.a11y.keyboardShortcuts")}
                onClick={onOpenShortcuts}
              >
                <Keyboard className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {t("pipelineEditor.shell.header.shortcutsTooltip")}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon" aria-label={t("common.a11y.commandPalette")}
                onClick={onOpenCommandPalette}
              >
                <Command className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {t("pipelineEditor.shell.header.commandPaletteTooltip")}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={onToggleFavorite}
                className={isFavorite ? "text-yellow-500" : ""}
              >
                <Star
                  className={`h-4 w-4 mr-2 ${
                    isFavorite ? "fill-current" : ""
                  }`}
                />
                {isFavorite ? t("pipelines.editor.favorited") : t("pipelines.editor.favorite")}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isFavorite
                ? t("pipelines.editor.removeFromFavorites")
                : t("pipelines.editor.addToFavorites")}
            </TooltipContent>
          </Tooltip>

          <PipelineEditorActionsMenu
            viewMode={viewMode}
            onViewModeChange={onViewModeChange}
            totalSteps={totalSteps}
            onExportJson={onExportJson}
            onExportCanonical={onExportCanonical}
            onImportClick={onImportClick}
            onLoadSamples={onLoadSamples}
            samples={samples}
            samplesLoading={samplesLoading}
            onLoadSample={onLoadSample}
            onClearPipeline={onClearPipeline}
          />

          <Button variant="outline" size="sm" onClick={onSave}>
            <Save className="h-4 w-4 mr-2" />
            {t("common.save")}
          </Button>

          <Button
            size="sm"
            disabled={totalSteps === 0}
            onClick={onUseInExperiment}
          >
            <Play className="h-4 w-4 mr-2" />
            {t("pipelineEditor.shell.header.useInExperiment")}
          </Button>
        </div>
      </div>
    </header>
  );
}

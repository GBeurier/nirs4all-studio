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
  const nextViewMode = viewMode === "code" ? "tree" : "code";

  return (
    <header className="border-b border-border bg-card px-4 py-3 flex-shrink-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onBack}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Back to Pipelines</TooltipContent>
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
                New
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isNew && isDirty
                ? "Stash as draft & start a new pipeline"
                : "Start a new pipeline"}
            </TooltipContent>
          </Tooltip>

          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <Workflow className="h-5 w-5 text-muted-foreground" />
              <Input
                value={pipelineName}
                onChange={(e) => onPipelineNameChange(e.target.value)}
                className="text-lg font-semibold bg-transparent px-2 py-1 h-auto border border-transparent hover:border-border/50 focus:border-primary/50 focus-visible:ring-1 focus-visible:ring-primary/30 focus-visible:ring-offset-0 rounded-md transition-colors w-auto"
                style={{ minWidth: "200px" }}
              />
              {isDirty && (
                <span
                  className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"
                  title="Unsaved changes"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  Unsaved
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

        <div className="flex items-center gap-2">
          <div className="flex items-center border-r border-border pr-2 mr-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onUndo}
                  disabled={!canUndo}
                >
                  <Undo2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Undo (Ctrl+Z)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onRedo}
                  disabled={!canRedo}
                >
                  <Redo2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Redo (Ctrl+Shift+Z)</TooltipContent>
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
                size="icon"
                onClick={() => onViewModeChange(nextViewMode)}
                disabled={totalSteps === 0}
              >
                <FileCode className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {viewMode === "code" ? "Switch to Tree View" : "View as Code"}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onOpenShortcuts}
              >
                <Keyboard className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Keyboard Shortcuts (Ctrl+/)
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onOpenCommandPalette}
              >
                <Command className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Command Palette (Ctrl+K)
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
                {isFavorite ? "Favorited" : "Favorite"}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isFavorite
                ? "Remove from favorites"
                : "Add to favorites"}
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
            Save
          </Button>

          <Button
            size="sm"
            disabled={totalSteps === 0}
            onClick={onUseInExperiment}
          >
            <Play className="h-4 w-4 mr-2" />
            Use in Experiment
          </Button>
        </div>
      </div>
    </header>
  );
}

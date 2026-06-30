import { useState, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "@/lib/motion";
import { TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { hasPersistedPipelineState, usePipelineEditor } from "@/hooks/usePipelineEditor";
import { useDatasetBinding } from "@/hooks/useDatasetBinding";
import { useVariantCount } from "@/hooks/useVariantCount";
import {
  PipelineDndProvider,
  PipelineEditorHeader,
  PipelineEditorRouteOverlays,
  PipelineEditorWorkspace,
  NavigationStatusBar,
} from "@/components/pipeline-editor";
import { useKeyboardNavigation } from "@/hooks/useKeyboardNavigation";
import { usePipelineEditorRouteActions } from "@/hooks/usePipelineEditorRouteActions";
import { usePipelineEditorRouteImports } from "@/hooks/usePipelineEditorRouteImports";
import { usePipelineEditorSamples } from "@/hooks/usePipelineEditorSamples";
import type { DragData, DropIndicator } from "@/components/pipeline-editor/types";

export default function PipelineEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isNew = !id || id === "new";
  const draftId = searchParams.get("draft");

  // Use a stable ID for persistence. Precedence:
  //   1. explicit ?draft=<draft-uuid> on a /pipelines/new URL (resuming a stashed draft)
  //   2. route param (existing pipeline)
  //   3. "new" for a fresh blank editor
  const pipelineId = isNew && draftId ? draftId : id || "new";
  const hasPersistedDraft = !isNew && hasPersistedPipelineState(pipelineId);

  const [showClearDialog, setShowClearDialog] = useState(false);
  const [showShortcutsDialog, setShowShortcutsDialog] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"tree" | "code">("tree");

  // Existing pipelines hydrate from the backend unless a local persisted draft exists.
  const {
    steps,
    pipelineName,
    pipelineConfig,
    selectedStepId,
    isFavorite,
    isDirty,
    canUndo,
    canRedo,
    stepCounts,
    totalSteps,
    setPipelineName,
    setPipelineConfig,
    setSelectedStepId,
    setIsFavorite,
    addStep,
    removeStep,
    duplicateStep,
    moveStep,
    updateStep,
    addBranch,
    removeBranch,
    addChild,
    removeChild,
    handleDrop,
    handleReorder,
    undo,
    redo,
    getSelectedStep,
    clearPipeline,
    loadPipeline,
    exportPipeline,
  } = usePipelineEditor({
    initialSteps: [],
    initialName: isNew ? "New Pipeline" : "Loading Pipeline...",
    pipelineId: pipelineId,
    persistState: true,
    allowPersistedState: isNew || hasPersistedDraft,
  });

  // Dataset binding for shape-aware validation (Phase 4)
  const {
    boundDataset,
    datasets,
    isLoading: isDatasetsLoading,
    bindDataset,
    clearBinding,
    selectTarget,
    refreshDatasets,
  } = useDatasetBinding({
    pipelineId,
    persistBinding: true,
  });

  const { importIntoEditor } = usePipelineEditorRouteImports({
    searchParams,
    pipelineId,
    isNew,
    hasPersistedDraft,
    navigate,
    loadPipeline,
    setIsFavorite,
  });

  const {
    samples,
    samplesLoading,
    loadSamples,
    loadSample,
  } = usePipelineEditorSamples({ importIntoEditor });

  // Keyboard navigation hook
  const {
    focusedPanel,
    setFocusedPanel,
    panelRefs,
    isCommandPaletteOpen: kbCommandPaletteOpen,
    isShortcutsHelpOpen: kbShortcutsHelpOpen,
    openCommandPalette,
    closeCommandPalette,
    openShortcutsHelp,
    closeShortcutsHelp,
  } = useKeyboardNavigation({
    steps,
    selectedStepId,
    onSelectStep: setSelectedStepId,
    onDuplicateStep: duplicateStep,
    onRemoveStep: removeStep,
    onUndo: undo,
    onRedo: redo,
  });

  // Sync keyboard navigation state with local dialogs
  const effectiveCommandPaletteOpen = commandPaletteOpen || kbCommandPaletteOpen;
  const effectiveShortcutsDialogOpen = showShortcutsDialog || kbShortcutsHelpOpen;

  const handleCommandPaletteChange = useCallback((open: boolean) => {
    setCommandPaletteOpen(open);
    if (!open) closeCommandPalette();
  }, [closeCommandPalette]);

  const handleShortcutsDialogChange = useCallback((open: boolean) => {
    setShowShortcutsDialog(open);
    if (!open) closeShortcutsHelp();
  }, [closeShortcutsHelp]);

  // Handle drop from DnD context
  const onDrop = useCallback((data: DragData, indicator: DropIndicator) => {
    handleDrop(data, indicator);
    if (data.type === "palette-item" && data.option) {
      toast.success(`${data.option.name} added to pipeline`);
    }
  }, [handleDrop]);

  // Handle reorder from DnD context
  const onReorder = useCallback((activeId: string, overId: string, data: DragData) => {
    handleReorder(activeId, overId, data);
  }, [handleReorder]);

  const {
    fileInputRef,
    handleSave,
    handleNewPipeline,
    handleToggleFavorite,
    handleExportJson,
    handleExportCanonical,
    handleImportClick,
    handleFileImport,
    handleClearPipeline,
    handleUseInExperiment,
  } = usePipelineEditorRouteActions({
    pipelineId,
    isNew,
    isDirty,
    pipelineName,
    isFavorite,
    steps,
    navigate,
    setIsFavorite,
    clearPipeline,
    exportPipeline,
    importIntoEditor,
    closeClearDialog: () => setShowClearDialog(false),
  });

  const selectedStep = getSelectedStep();

  const {
    count: variantCount,
    breakdown: variantBreakdown,
    warning: variantWarning,
    isLoading: isCountingVariants,
  } = useVariantCount(steps);

  return (
    // The editor itself is mostly local-state + JSON-registry driven, so keep
    // it usable while the backend is still warming ML dependencies.
    <TooltipProvider>
      <PipelineDndProvider onDrop={onDrop} onReorder={onReorder}>
        <motion.div
          className="h-full flex flex-col"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          <PipelineEditorHeader
            pipelineName={pipelineName}
            onPipelineNameChange={setPipelineName}
            isNew={isNew}
            isDirty={isDirty}
            totalSteps={totalSteps}
            stepCounts={stepCounts}
            steps={steps}
            variantCount={variantCount}
            variantBreakdown={variantBreakdown}
            variantWarning={variantWarning}
            isCountingVariants={isCountingVariants}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            pipelineConfig={pipelineConfig}
            onPipelineConfigChange={setPipelineConfig}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={undo}
            onRedo={redo}
            onBack={() => navigate("/pipelines")}
            onNewPipeline={handleNewPipeline}
            onOpenShortcuts={() => setShowShortcutsDialog(true)}
            onOpenCommandPalette={() => setCommandPaletteOpen(true)}
            isFavorite={isFavorite}
            onToggleFavorite={handleToggleFavorite}
            onExportJson={handleExportJson}
            onExportCanonical={handleExportCanonical}
            onImportClick={handleImportClick}
            onLoadSamples={loadSamples}
            samples={samples}
            samplesLoading={samplesLoading}
            onLoadSample={loadSample}
            onClearPipeline={() => setShowClearDialog(true)}
            onSave={handleSave}
            onUseInExperiment={handleUseInExperiment}
          />

          <PipelineEditorWorkspace
            steps={steps}
            pipelineName={pipelineName}
            pipelineConfig={pipelineConfig}
            selectedStepId={selectedStepId}
            selectedStep={selectedStep}
            viewMode={viewMode}
            focusedPanel={focusedPanel}
            panelRefs={panelRefs}
            onFocusPanel={setFocusedPanel}
            onAddStep={addStep}
            onSelectStep={setSelectedStepId}
            onRemoveStep={removeStep}
            onDuplicateStep={duplicateStep}
            onAddBranch={addBranch}
            onRemoveBranch={removeBranch}
            onAddChild={addChild}
            onRemoveChild={removeChild}
            onUpdateStep={updateStep}
            datasetBinding={{
              boundDataset,
              datasets,
              isLoading: isDatasetsLoading,
              bindDataset,
              clearBinding,
              selectTarget,
              refreshDatasets,
            }}
          />

          {/* Navigation Status Bar */}
          <footer className="border-t border-border bg-card/50 px-4 py-2 flex-shrink-0">
            <NavigationStatusBar
              focusedPanel={focusedPanel}
              selectedStepName={selectedStep?.name}
            />
          </footer>
        </motion.div>
      </PipelineDndProvider>

      <PipelineEditorRouteOverlays
        commandPaletteOpen={effectiveCommandPaletteOpen}
        onCommandPaletteOpenChange={handleCommandPaletteChange}
        shortcutsDialogOpen={effectiveShortcutsDialogOpen}
        onShortcutsDialogOpenChange={handleShortcutsDialogChange}
        clearDialogOpen={showClearDialog}
        onClearDialogOpenChange={setShowClearDialog}
        totalSteps={totalSteps}
        selectedStepId={selectedStepId}
        steps={steps}
        onSelectStep={setSelectedStepId}
        onAddStep={addStep}
        onRemoveStep={removeStep}
        onDuplicateStep={duplicateStep}
        onSave={handleSave}
        onExportJson={handleExportJson}
        onToggleFavorite={handleToggleFavorite}
        onUndo={undo}
        onRedo={redo}
        onOpenShortcutsHelp={() => setShowShortcutsDialog(true)}
        onClearPipeline={handleClearPipeline}
        fileInputRef={fileInputRef}
        onFileImport={handleFileImport}
      />
    </TooltipProvider>
  );
}

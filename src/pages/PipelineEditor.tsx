import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Link, useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Save,
  Star,
  Play,
  Plus,
  Undo2,
  Redo2,
  Keyboard,
  Trash2,
  Download,
  Upload,
  MoreHorizontal,
  Repeat,
  AlertTriangle,
  ChevronDown,
  Info,
  Loader2,
  Command,
  FileCode,
  FileJson,
  FolderOpen,
  Settings,
  Workflow,
} from "lucide-react";
import {
  savePipeline,
  getPipeline,
  getChainPipelineSteps,
  previewPipelineImport,
  renderCanonicalPipeline,
} from "@/api/client";
import { motion } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "sonner";
import { clearPersistedState, hasPersistedPipelineState, migrateDraftKey, usePipelineEditor } from "@/hooks/usePipelineEditor";
import { useDatasetBinding } from "@/hooks/useDatasetBinding";
import { listPipelineSamples, getPipelineSample } from "@/api/client";
import type { PipelineSampleInfo } from "@/api/client";
import {
  useVariantCount,
  formatVariantCount,
  getVariantCountColor,
  getVariantCountSeverity,
} from "@/hooks/useVariantCount";
import {
  StepPalette,
  PipelineTree,
  StepConfigPanel,
  PipelineDndProvider,
  CommandPalette,
  KeyboardShortcutsDialog,
  ExecutionPreviewCompact,
  FocusPanelRing,
  NavigationStatusBar,
  DatasetBinding,
  PipelineYAMLView,
} from "@/components/pipeline-editor";
import { DatasetBindingProvider, NodeRegistryProvider, PipelineEditorPreferencesProvider } from "@/components/pipeline-editor/contexts";
import { useKeyboardNavigation, KEYBOARD_SHORTCUTS, formatShortcut } from "@/hooks/useKeyboardNavigation";
import type { DragData, DropIndicator } from "@/components/pipeline-editor/types";
import type { PipelineStep as EditorPipelineStep } from "@/components/pipeline-editor/types";

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

  // File input ref for importing
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Pipeline samples state
  const [samples, setSamples] = useState<PipelineSampleInfo[]>([]);
  const [samplesLoading, setSamplesLoading] = useState(false);

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

  useEffect(() => {
    if (isNew || hasPersistedDraft) return;

    let cancelled = false;

    (async () => {
      try {
        const pipeline = await getPipeline(pipelineId);
        if (cancelled) return;

        loadPipeline(pipeline.steps as EditorPipelineStep[], pipeline.name);
        setIsFavorite(!!pipeline.is_favorite);
      } catch (error) {
        if (cancelled) return;
        console.error("Failed to load pipeline:", error);
        toast.error(
          `Failed to load pipeline: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasPersistedDraft, isNew, loadPipeline, pipelineId, setIsFavorite]);

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

  // Calculate dimension warnings from bound dataset
  const dimensionWarnings = useMemo(() => {
    if (!boundDataset) return [];

    const warnings: string[] = [];
    const maxFeatures = boundDataset.shape.features;
    const maxSamples = boundDataset.shape.samples;

    // Check all steps for n_components > features
    const checkStep = (step: EditorPipelineStep) => {
      const nComponents = step.params?.n_components as number | undefined;
      if (nComponents && nComponents > maxFeatures) {
        warnings.push(`${step.name}: n_components (${nComponents}) exceeds features (${maxFeatures})`);
      }
      const nSplits = step.params?.n_splits as number | undefined;
      if (nSplits && nSplits > maxSamples) {
        warnings.push(`${step.name}: n_splits (${nSplits}) exceeds samples (${maxSamples})`);
      }
      // Check branches
      step.branches?.forEach(branch => branch.forEach(checkStep));
      // Check children
      step.children?.forEach(checkStep);
    };

    steps.forEach(checkStep);
    return warnings;
  }, [boundDataset, steps]);

  const importIntoEditor = useCallback(
    async ({
      content,
      payload,
      format,
      fallbackName,
    }: {
      content?: string;
      payload?: unknown;
      format?: "json" | "yaml" | "yml";
      fallbackName?: string;
    }) => {
      const result = await previewPipelineImport({
        content,
        payload,
        format,
      });
      const importedName = result.name || fallbackName || "Imported Pipeline";
      loadPipeline(result.steps as EditorPipelineStep[], importedName);
      return {
        ...result,
        name: importedName,
      };
    },
    [loadPipeline]
  );

  // Handle import from Playground via sessionStorage
  useEffect(() => {
    const source = searchParams.get('source');
    if (source !== 'playground') return;

    const PLAYGROUND_EXPORT_KEY = 'playground-pipeline-export';

    (async () => {
      try {
        const exportData = sessionStorage.getItem(PLAYGROUND_EXPORT_KEY);
        if (exportData) {
          const parsed = JSON.parse(exportData);
          if (parsed.steps && Array.isArray(parsed.steps)) {
            const canonicalPipeline = parsed.steps.map(
              (step: { type: string; name: string; params: Record<string, unknown> }) => ({
                [step.type === 'splitting' ? 'split' : 'preprocessing']: step.name,
                ...step.params,
              })
            );

            const imported = await importIntoEditor({
              payload: {
                name: parsed.name || 'Imported from Playground',
                pipeline: canonicalPipeline,
              },
              fallbackName: parsed.name || 'Imported from Playground',
            });

            toast.success('Pipeline imported from Playground', {
              description: `${imported.steps.length} steps loaded`,
            });

            sessionStorage.removeItem(PLAYGROUND_EXPORT_KEY);
          }
        }
      } catch (e) {
        console.error('Failed to import from Playground:', e);
        toast.error('Failed to import pipeline from Playground');
      }

      navigate(`/pipelines/${pipelineId}`, { replace: true });
    })();
  }, [searchParams, importIntoEditor, navigate, pipelineId]);

  // Handle import from chain (edit pipeline from predictions)
  useEffect(() => {
    const chainId = searchParams.get('chainId');
    if (!chainId) return;

    (async () => {
      try {
        const result = await getChainPipelineSteps(chainId);
        if (result.pipeline && Array.isArray(result.pipeline)) {
          const imported = await importIntoEditor({
            payload: {
              name: result.name,
              pipeline: result.pipeline,
            },
            fallbackName: result.name || 'Chain Pipeline',
          });

          toast.success('Pipeline loaded from chain', {
            description: `${imported.steps.length} steps loaded`,
          });
        }
      } catch (e) {
        console.error('Failed to load chain pipeline:', e);
        toast.error('Failed to load pipeline from chain');
      }

      // Clean up URL params
      navigate(`/pipelines/${pipelineId}`, { replace: true });
    })();
  }, [searchParams, importIntoEditor, navigate, pipelineId]);

  // Load samples on first dropdown open
  const handleLoadSamples = useCallback(async () => {
    if (samples.length > 0) return; // Already loaded
    setSamplesLoading(true);
    try {
      const result = await listPipelineSamples();
      setSamples(result.samples);
    } catch (err) {
      console.error("Failed to load samples:", err);
      toast.error("Failed to load pipeline samples");
    } finally {
      setSamplesLoading(false);
    }
  }, [samples.length]);

  const handleLoadSample = useCallback(async (sampleId: string, sampleName: string) => {
    try {
      const result = await getPipelineSample(sampleId, true);
      const imported = await importIntoEditor({
        payload: result,
        fallbackName: result.name || sampleName,
      });
      toast.success(`Loaded sample: ${imported.name}`);
    } catch (err) {
      console.error("Failed to load sample:", err);
      toast.error(`Failed to load sample: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }, [importIntoEditor]);

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

  // Query client for cache invalidation
  const queryClient = useQueryClient();

  // Save pipeline mutation
  const savePipelineMutation = useMutation({
    mutationFn: async () => {
      const pipelineData = exportPipeline();
      // Save steps with all fields (including branches, generatorKind, generatorOptions, etc.)
      // This is critical for generators and branching to work correctly
      return savePipeline({
        id: isNew ? undefined : pipelineId,
        name: pipelineName,
        description: "",
        steps: pipelineData.steps,
        is_favorite: isFavorite,
      });
    },
    onSuccess: (result) => {
      toast.success(`"${pipelineName}" saved`);
      // Invalidate pipelines cache
      queryClient.invalidateQueries({ queryKey: ["pipelines"] });
      // If it was a new pipeline (blank or resumed draft), drop the draft entry and navigate to the real id.
      if (isNew && result?.pipeline?.id) {
        clearPersistedState(pipelineId);
        navigate(`/pipelines/${result.pipeline.id}`, { replace: true });
      }
    },
    onError: (error) => {
      toast.error(`Failed to save: ${error instanceof Error ? error.message : "Unknown error"}`);
    },
  });

  // Actions
  const handleSave = () => {
    savePipelineMutation.mutate();
  };

  // New-in-editor: auto-stash current /pipelines/new work as an addressable draft
  // so opening another blank editor doesn't collide or lose the WIP.
  const handleNewPipeline = useCallback(() => {
    if (isNew && isDirty) {
      const stashId = `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      migrateDraftKey(pipelineId, stashId);
      toast.success("Current draft stashed", {
        description: "Find it under Drafts on the Pipelines page.",
      });
    }
    navigate("/pipelines/new");
  }, [isDirty, isNew, navigate, pipelineId]);

  const handleToggleFavorite = () => {
    setIsFavorite(!isFavorite);
    toast.success(
      isFavorite
        ? `"${pipelineName}" removed from favorites`
        : `"${pipelineName}" added to favorites`
    );
  };

  const handleExportJson = () => {
    const pipeline = exportPipeline();
    const json = JSON.stringify(pipeline, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${pipelineName.replace(/\s+/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Pipeline exported as JSON");
  };

  const handleExportCanonical = useCallback(
    async (format: "json" | "yaml") => {
      try {
        const rendered = await renderCanonicalPipeline({
          steps,
          name: pipelineName,
        });
        const content = format === "yaml" ? rendered.yaml : rendered.json;
        const mimeType = format === "yaml" ? "text/yaml" : "application/json";
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${pipelineName.replace(/\s+/g, "_")}_nirs4all.${format}`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success(`Pipeline exported as canonical ${format.toUpperCase()}`);
      } catch (error) {
        console.error("Canonical export error:", error);
        toast.error(
          `Failed to export canonical ${format.toUpperCase()}: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
    },
    [pipelineName, steps]
  );

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const content = e.target?.result as string;
        const format = file.name.endsWith(".yaml") || file.name.endsWith(".yml")
          ? "yaml"
          : "json";
        const imported = await importIntoEditor({
          content,
          format,
          fallbackName: file.name.replace(/\.[^/.]+$/, ""),
        });
        toast.success(`Pipeline "${imported.name}" imported successfully`);
      } catch (err) {
        console.error("Import error:", err);
        toast.error(
          `Failed to import: ${err instanceof Error ? err.message : "Invalid file"}`
        );
      }
    };
    reader.readAsText(file);

    // Reset the input so the same file can be imported again
    event.target.value = '';
  };

  const handleClearPipeline = () => {
    clearPipeline();
    setShowClearDialog(false);
    toast.success("Pipeline cleared");
  };

  const selectedStep = getSelectedStep();

  const {
    count: variantCount,
    breakdown: variantBreakdown,
    warning: variantWarning,
    isLoading: isCountingVariants,
  } = useVariantCount(steps);

  const variantSeverity = getVariantCountSeverity(variantCount);

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
          {/* Header Toolbar */}
          <header className="border-b border-border bg-card px-4 py-3 flex-shrink-0">
            <div className="flex items-center justify-between">
              {/* Left side: Back button, Name, Badges */}
              <div className="flex items-center gap-4">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => navigate("/pipelines")}
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
                      onClick={handleNewPipeline}
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
                      onChange={(e) => setPipelineName(e.target.value)}
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
                  <div className="flex items-center gap-2 mt-1">
                    {/* Aggregated step summary */}
                    {totalSteps > 0 && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Badge
                            variant="outline"
                            className="text-xs cursor-pointer transition-colors hover:bg-accent border-muted-foreground/30 text-muted-foreground"
                          >
                            {totalSteps} step{totalSteps !== 1 ? "s" : ""}
                            {stepCounts.model > 0 && <span className="text-primary ml-1">({stepCounts.model} model{stepCounts.model !== 1 ? "s" : ""})</span>}
                          </Badge>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-64 bg-popover">
                          <div className="space-y-2">
                            <h4 className="text-sm font-medium">Step Breakdown</h4>
                            <div className="space-y-1">
                              {stepCounts.preprocessing > 0 && (
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-blue-500">Preprocessing</span>
                                  <span className="font-mono">{stepCounts.preprocessing}</span>
                                </div>
                              )}
                              {stepCounts.y_processing > 0 && (
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-amber-500">Y-Processing</span>
                                  <span className="font-mono">{stepCounts.y_processing}</span>
                                </div>
                              )}
                              {stepCounts.filter > 0 && (
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-rose-500">Filters</span>
                                  <span className="font-mono">{stepCounts.filter}</span>
                                </div>
                              )}
                              {stepCounts.augmentation > 0 && (
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-indigo-500">Augmentation</span>
                                  <span className="font-mono">{stepCounts.augmentation}</span>
                                </div>
                              )}
                              {stepCounts.splitting > 0 && (
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-purple-500">Splitting</span>
                                  <span className="font-mono">{stepCounts.splitting}</span>
                                </div>
                              )}
                              {stepCounts.model > 0 && (
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-primary">Models</span>
                                  <span className="font-mono">{stepCounts.model}</span>
                                </div>
                              )}
                              {stepCounts.branch > 0 && (
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-slate-500">Branches</span>
                                  <span className="font-mono">{stepCounts.branch}</span>
                                </div>
                              )}
                              {stepCounts.merge > 0 && (
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-slate-500">Merges</span>
                                  <span className="font-mono">{stepCounts.merge}</span>
                                </div>
                              )}
                              {stepCounts.generator > 0 && (
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-orange-500">Generators</span>
                                  <span className="font-mono">{stepCounts.generator}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
                    {/* Variant Count Display */}
                    {totalSteps > 0 && variantCount > 1 && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Badge
                            variant="outline"
                            className={`text-xs cursor-pointer transition-colors hover:bg-accent ${
                              variantSeverity === "low"
                                ? "border-emerald-500/30 text-emerald-500"
                                : variantSeverity === "medium"
                                ? "border-amber-500/30 text-amber-500"
                                : variantSeverity === "high"
                                ? "border-orange-500/30 text-orange-500"
                                : "border-red-500/30 text-red-500"
                            }`}
                          >
                            {isCountingVariants ? (
                              <Loader2 className="h-3 w-3 animate-spin mr-1" />
                            ) : (
                              <Repeat className="h-3 w-3 mr-1" />
                            )}
                            {formatVariantCount(variantCount)} variant{variantCount !== 1 ? "s" : ""}
                          </Badge>
                        </PopoverTrigger>
                        <PopoverContent
                          align="start"
                          className="w-72 bg-popover"
                        >
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <h4 className="text-sm font-medium">
                                Pipeline Variants
                              </h4>
                              <span
                                className={`text-lg font-bold ${getVariantCountColor(
                                  variantCount
                                )}`}
                              >
                                {variantCount.toLocaleString()}
                              </span>
                            </div>
                            {variantWarning && (
                              <div className="flex items-start gap-2 p-2 rounded bg-amber-500/10 text-amber-500 text-xs">
                                <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                                <span>{variantWarning}</span>
                              </div>
                            )}
                            {Object.keys(variantBreakdown).length > 0 && (
                              <div className="space-y-1.5">
                                <p className="text-xs text-muted-foreground">
                                  Breakdown by step:
                                </p>
                                {Object.entries(variantBreakdown).map(
                                  ([stepId, info]) => (
                                    <div
                                      key={stepId}
                                      className="flex items-center justify-between text-xs"
                                    >
                                      <span className="text-muted-foreground truncate max-w-[180px]">
                                        {info.name}
                                      </span>
                                      <span className="font-mono">
                                        {info.count.toLocaleString()}
                                      </span>
                                    </div>
                                  )
                                )}
                              </div>
                            )}
                            <div className="pt-2 border-t border-border">
                              <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                                <Info className="h-3 w-3 flex-shrink-0 mt-0.5" />
                                <span>
                                  Total pipelines that will be trained when you
                                  run this configuration.
                                </span>
                              </p>
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
                    {/* Execution Preview — models trained + fits */}
                    {totalSteps > 0 && (
                      <ExecutionPreviewCompact
                        steps={steps}
                        variantCount={variantCount}
                      />
                    )}
                    {/* Dataset Binding for shape-aware validation (Phase 4) — hidden */}
                    {false && (
                      <DatasetBinding
                        boundDataset={boundDataset}
                        datasets={datasets}
                        isLoading={isDatasetsLoading}
                        onBind={bindDataset}
                        onClear={clearBinding}
                        onSelectTarget={selectTarget}
                        onRefresh={refreshDatasets}
                        hasWarnings={dimensionWarnings.length > 0}
                        warningMessage={dimensionWarnings.length > 0
                          ? `${dimensionWarnings.length} step${dimensionWarnings.length > 1 ? 's' : ''} may exceed dataset dimensions`
                          : undefined
                        }
                      />
                    )}
                    {isDirty && (
                      <Badge variant="secondary" className="text-xs">
                        Unsaved
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              {/* Right side: Actions */}
              <div className="flex items-center gap-2">
                {/* Undo/Redo */}
                <div className="flex items-center border-r border-border pr-2 mr-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={undo}
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
                        onClick={redo}
                        disabled={!canRedo}
                      >
                        <Redo2 className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Redo (Ctrl+Shift+Z)</TooltipContent>
                  </Tooltip>
                </div>

                {/* Pipeline Settings */}
                <Popover>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <PopoverTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={pipelineConfig.seed !== undefined ? "text-primary" : ""}
                        >
                          <Settings className="h-4 w-4" />
                        </Button>
                      </PopoverTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Pipeline Settings</TooltipContent>
                  </Tooltip>
                  <PopoverContent align="end" className="w-72 bg-popover">
                    <div className="space-y-4">
                      <h4 className="text-sm font-medium">Pipeline Settings</h4>
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="global-seed" className="text-xs text-muted-foreground">
                            Global Seed
                          </Label>
                          <div className="flex gap-2">
                            <Input
                              id="global-seed"
                              type="number"
                              placeholder="Random"
                              value={pipelineConfig.seed ?? ""}
                              onChange={(e) => {
                                const value = e.target.value;
                                setPipelineConfig({
                                  ...pipelineConfig,
                                  seed: value === "" ? undefined : parseInt(value, 10),
                                });
                              }}
                              className="h-8 text-sm"
                            />
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setPipelineConfig({
                                  ...pipelineConfig,
                                  seed: Math.floor(Math.random() * 10000),
                                });
                              }}
                              className="h-8 px-2"
                            >
                              Generate
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Set a seed for reproducible results across all splits and operations.
                          </p>
                        </div>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>

                {/* Code view toggle */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={viewMode === "code" ? "secondary" : "ghost"}
                      size="icon"
                      onClick={() => setViewMode(viewMode === "code" ? "tree" : "code")}
                      disabled={totalSteps === 0}
                    >
                      <FileCode className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {viewMode === "code" ? "Switch to Tree View" : "View as Code"}
                  </TooltipContent>
                </Tooltip>

                {/* Keyboard shortcuts button */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowShortcutsDialog(true)}
                    >
                      <Keyboard className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    Keyboard Shortcuts (Ctrl+/)
                  </TooltipContent>
                </Tooltip>

                {/* Command palette button */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setCommandPaletteOpen(true)}
                    >
                      <Command className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    Command Palette (Ctrl+K)
                  </TooltipContent>
                </Tooltip>

                {/* Favorite */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleToggleFavorite}
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

                {/* More actions */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="bg-popover">
                    <DropdownMenuItem
                      onClick={() => setViewMode(viewMode === "code" ? "tree" : "code")}
                      disabled={totalSteps === 0}
                    >
                      <FileCode className="h-4 w-4 mr-2" />
                      {viewMode === "code" ? "Switch to Tree View" : "View as Code"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleExportJson}>
                      <Download className="h-4 w-4 mr-2" />
                      Export as JSON (Editor)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { void handleExportCanonical("json"); }}>
                      <FileJson className="h-4 w-4 mr-2" />
                      Export as JSON (Canonical)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { void handleExportCanonical("yaml"); }}>
                      <FileCode className="h-4 w-4 mr-2" />
                      Export as YAML (Canonical)
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleImportClick}>
                      <Upload className="h-4 w-4 mr-2" />
                      Import JSON or YAML
                    </DropdownMenuItem>
                    <DropdownMenuSub onOpenChange={(open) => { if (open) handleLoadSamples(); }}>
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
                              onClick={() => handleLoadSample(sample.id, sample.name)}
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
                      onClick={() => setShowClearDialog(true)}
                      className="text-destructive focus:text-destructive"
                      disabled={totalSteps === 0}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Clear All Steps
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Save */}
                <Button variant="outline" size="sm" onClick={handleSave}>
                  <Save className="h-4 w-4 mr-2" />
                  Save
                </Button>

                {/* Use in Experiment */}
                <Button
                  size="sm"
                  disabled={totalSteps === 0}
                  onClick={() => {
                    // Store current pipeline state in sessionStorage for "current edited pipeline" option
                    const pipelineData = exportPipeline();
                    const currentPipelineExport = {
                      id: isNew ? undefined : pipelineId,
                      name: pipelineName,
                      steps: pipelineData.steps,
                      isDirty,
                      timestamp: Date.now(),
                    };
                    sessionStorage.setItem('current-edited-pipeline', JSON.stringify(currentPipelineExport));

                    // Navigate with pipeline ID if saved, or with flag for current edited
                    if (!isNew && !isDirty) {
                      navigate(`/editor?pipeline=${pipelineId}`);
                    } else {
                      navigate('/editor?source=editor');
                    }
                  }}
                >
                  <Play className="h-4 w-4 mr-2" />
                  Use in Experiment
                </Button>
              </div>
            </div>
          </header>

          {/* Main Content: 3-Panel Layout */}
          <PipelineEditorPreferencesProvider>
            <NodeRegistryProvider useJsonRegistry>
              <DatasetBindingProvider
                steps={steps}
                boundDataset={boundDataset}
                datasets={datasets}
                isLoading={isDatasetsLoading}
                onBind={bindDataset}
                onClear={clearBinding}
                onSelectTarget={selectTarget}
                onRefresh={refreshDatasets}
              >
                <div className="flex-1 flex z-0 min-h-0">
                {/* Left Panel: Step Palette */}
                <div
                  ref={panelRefs.palette}
                  className="w-72 flex-shrink-0 relative z-10 overflow-hidden"
                  onClick={() => setFocusedPanel("palette")}
                >
                  <FocusPanelRing isFocused={focusedPanel === "palette"} color="blue" />
                  <StepPalette onAddStep={addStep} />
                </div>

                {/* Center: Pipeline Tree or Code View */}
                <div
                  ref={panelRefs.tree}
                  className="flex-1 min-w-0 min-h-0 flex flex-col relative overflow-hidden"
                  onClick={() => setFocusedPanel("tree")}
                >
                  <FocusPanelRing isFocused={focusedPanel === "tree"} color="emerald" />
                  {viewMode === "code" ? (
                    <PipelineYAMLView
                      steps={steps}
                      pipelineName={pipelineName}
                      randomState={pipelineConfig.seed}
                      className="h-full"
                    />
                  ) : (
                    <PipelineTree
                      steps={steps}
                      selectedStepId={selectedStepId}
                      onSelectStep={setSelectedStepId}
                      onRemoveStep={removeStep}
                      onDuplicateStep={duplicateStep}
                      onAddBranch={addBranch}
                      onRemoveBranch={removeBranch}
                      onAddChild={addChild}
                      onRemoveChild={removeChild}
                    />
                  )}
                </div>

                {/* Right Panel: Configuration */}
                <div
                  ref={panelRefs.config}
                  className="w-80 flex-shrink-0 border-l border-border relative overflow-hidden"
                  onClick={() => setFocusedPanel("config")}
                >
                  <FocusPanelRing isFocused={focusedPanel === "config"} color="purple" />
                  <StepConfigPanel
                    step={selectedStep}
                    onUpdate={updateStep}
                    onRemove={removeStep}
                    onDuplicate={duplicateStep}
                    onSelectStep={setSelectedStepId}
                    onAddChild={addChild}
                    onRemoveChild={removeChild}
                  />
                </div>
                </div>
              </DatasetBindingProvider>
            </NodeRegistryProvider>
          </PipelineEditorPreferencesProvider>

          {/* Navigation Status Bar */}
          <footer className="border-t border-border bg-card/50 px-4 py-2 flex-shrink-0">
            <NavigationStatusBar
              focusedPanel={focusedPanel}
              selectedStepName={selectedStep?.name}
            />
          </footer>
        </motion.div>
      </PipelineDndProvider>

      {/* Command Palette */}
      <CommandPalette
        open={effectiveCommandPaletteOpen}
        onOpenChange={handleCommandPaletteChange}
        selectedStepId={selectedStepId}
        steps={steps}
        onSelectStep={(id) => setSelectedStepId(id)}
        onAddStep={addStep}
        onRemoveStep={removeStep}
        onDuplicateStep={duplicateStep}
        onSave={handleSave}
        onExport={handleExportJson}
        onToggleFavorite={handleToggleFavorite}
        onUndo={undo}
        onRedo={redo}
        onOpenShortcutsHelp={() => setShowShortcutsDialog(true)}
      />

      {/* Keyboard Shortcuts Dialog */}
      <KeyboardShortcutsDialog
        open={effectiveShortcutsDialogOpen}
        onOpenChange={handleShortcutsDialogChange}
      />

      {/* Clear Confirmation Dialog */}
      <AlertDialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <AlertDialogContent className="bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle>Clear Pipeline?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove all {totalSteps} steps from your pipeline. This
              action can be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClearPipeline}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Clear All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Hidden file input for importing */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.yaml,.yml"
        onChange={handleFileImport}
        className="hidden"
      />
    </TooltipProvider>
  );
}

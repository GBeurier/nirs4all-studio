import { useState, useCallback, useMemo, useRef } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Save,
  Star,
  Play,
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
  FileJson,
  FolderOpen,
  Settings,
  Workflow,
} from "lucide-react";
import { motion } from "framer-motion";
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
import { usePipelineEditor } from "@/hooks/usePipelineEditor";
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
} from "@/components/pipeline-editor";
import { useKeyboardNavigation, KEYBOARD_SHORTCUTS, formatShortcut } from "@/hooks/useKeyboardNavigation";
import type { DragData, DropIndicator } from "@/components/pipeline-editor/types";
import type { PipelineStep } from "@/types/pipelines";
import type { PipelineStep as EditorPipelineStep } from "@/components/pipeline-editor/types";

// Demo pipeline for testing
const demoPipeline: EditorPipelineStep[] = [
  { id: "1", type: "preprocessing", name: "SNV", params: {} },
  {
    id: "2",
    type: "preprocessing",
    name: "SavitzkyGolay",
    params: { window_length: 11, polyorder: 2, deriv: 1 },
  },
  {
    id: "3",
    type: "splitting",
    name: "KennardStone",
    params: { test_size: 0.2, metric: "euclidean" },
  },
  {
    id: "4",
    type: "model",
    name: "PLSRegression",
    params: { n_components: 10, max_iter: 500 },
  },
];

export default function PipelineEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id || id === "new";

  // Use a stable ID for persistence: either the route param or "new" for new pipelines
  const pipelineId = id || "new";

  const [showClearDialog, setShowClearDialog] = useState(false);
  const [showShortcutsDialog, setShowShortcutsDialog] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // File input ref for importing
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Pipeline samples state
  const [samples, setSamples] = useState<PipelineSampleInfo[]>([]);
  const [samplesLoading, setSamplesLoading] = useState(false);

  // Initialize with demo pipeline if editing, empty if new
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
    exportPipeline,
    loadFromNirs4all,
    exportToNirs4all,
  } = usePipelineEditor({
    initialSteps: isNew ? [] : demoPipeline,
    initialName: isNew ? "New Pipeline" : "SNV + SG → PLS",
    pipelineId: pipelineId,
    persistState: true,
  });

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
      loadFromNirs4all(result);
      setPipelineName(result.name || sampleName);
      toast.success(`Loaded sample: ${result.name || sampleName}`);
    } catch (err) {
      console.error("Failed to load sample:", err);
      toast.error(`Failed to load sample: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }, [loadFromNirs4all, setPipelineName]);

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

  // Actions
  const handleSave = () => {
    const pipeline = exportPipeline();
    console.log("Saving pipeline:", pipeline);
    toast.success(`"${pipelineName}" saved to library`);
  };

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

  const handleExportNirs4all = () => {
    const nirs4allSteps = exportToNirs4all();
    const pipeline: Record<string, unknown> = {
      name: pipelineName,
      description: "",
      pipeline: nirs4allSteps,
    };
    // Include seed if set
    if (pipelineConfig.seed !== undefined) {
      pipeline.seed = pipelineConfig.seed;
    }
    const json = JSON.stringify(pipeline, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${pipelineName.replace(/\s+/g, "_")}_nirs4all.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Pipeline exported in nirs4all format");
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        let data: unknown;

        // Try to parse as JSON
        if (file.name.endsWith('.json')) {
          data = JSON.parse(content);
        } else if (file.name.endsWith('.yaml') || file.name.endsWith('.yml')) {
          // For YAML, we'll need to use the backend
          toast.error("YAML import requires the backend API. Please use JSON format or load from samples.");
          return;
        } else {
          // Try JSON anyway
          data = JSON.parse(content);
        }

        // Check if it's nirs4all format (has 'pipeline' key with array or is an array)
        const pipeline = data as Record<string, unknown>;
        if (Array.isArray(pipeline) || (pipeline.pipeline && Array.isArray(pipeline.pipeline))) {
          loadFromNirs4all(pipeline);
          const name = typeof pipeline.name === 'string' ? pipeline.name : file.name.replace(/\.[^/.]+$/, "");
          setPipelineName(name);
          toast.success(`Pipeline "${name}" imported successfully`);
        } else if (pipeline.steps && Array.isArray(pipeline.steps)) {
          // It's editor format
          // We need to use loadPipeline for editor format
          toast.info("Detected editor format - please use nirs4all format for import");
        } else {
          toast.error("Invalid pipeline format. Expected nirs4all format with 'pipeline' array.");
        }
      } catch (err) {
        console.error("Import error:", err);
        toast.error(`Failed to import: ${err instanceof Error ? err.message : 'Invalid file'}`);
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

  // Get variant count from nirs4all backend
  // Convert editor steps to the format expected by the API with full generator info
  const apiSteps = useMemo(() => {
    const convertStep = (step: EditorPipelineStep): PipelineStep => {
      // Build generator object from stepGenerator or paramSweeps
      let generator: PipelineStep["generator"] = undefined;

      // Check for step-level generator (nirs4all format)
      if (step.stepGenerator) {
        generator = {
          _or_: step.stepGenerator.type === "_or_" ? step.stepGenerator.values : undefined,
          _range_: step.stepGenerator.type === "_range_" ? step.stepGenerator.values as [number, number, number] : undefined,
          _log_range_: step.stepGenerator.type === "_log_range_" ? step.stepGenerator.values as [number, number, number] : undefined,
          pick: Array.isArray(step.generatorOptions?.pick) ? step.generatorOptions.pick[1] : step.generatorOptions?.pick,
          count: step.generatorOptions?.count,
        };
      }
      // Check for paramSweeps (UI sweep format) and convert to generator format
      else if (step.paramSweeps && Object.keys(step.paramSweeps).length > 0) {
        // Convert paramSweeps to nirs4all generator format
        // For API counting, we send step-level info
        for (const [paramName, sweep] of Object.entries(step.paramSweeps)) {
          if (sweep.type === "range" && sweep.from !== undefined && sweep.to !== undefined) {
            generator = {
              _range_: [sweep.from, sweep.to, sweep.step ?? 1],
              param: paramName,
            };
            break; // Only handle first sweep for now (main source of variants)
          } else if (sweep.type === "log_range" && sweep.from !== undefined && sweep.to !== undefined) {
            generator = {
              _log_range_: [sweep.from, sweep.to, sweep.count ?? 5],
              param: paramName,
            };
            break;
          } else if (sweep.type === "or" && sweep.choices) {
            generator = {
              _or_: sweep.choices,
              param: paramName,
            };
            break;
          }
        }
      }

      return {
        id: step.id,
        // Map editor step types to API step types (generator -> branch for API compatibility)
        type: step.type === "generator" ? "branch" : step.type as PipelineStep["type"],
        name: step.name,
        params: step.params || {},
        // Include generator configuration for variant counting
        generator,
        // Convert branches recursively for branch/generator steps
        children: step.branches?.flat().map((child) => convertStep(child)),
      };
    };
    return steps.map(convertStep) as PipelineStep[];
  }, [steps]);

  const {
    count: variantCount,
    breakdown: variantBreakdown,
    warning: variantWarning,
    isLoading: isCountingVariants,
  } = useVariantCount(apiSteps);

  const variantSeverity = getVariantCountSeverity(variantCount);

  return (
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

                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <Workflow className="h-5 w-5 text-muted-foreground" />
                    <Input
                      value={pipelineName}
                      onChange={(e) => setPipelineName(e.target.value)}
                      className="text-lg font-semibold bg-transparent px-2 py-1 h-auto border border-transparent hover:border-border/50 focus:border-primary/50 focus-visible:ring-1 focus-visible:ring-primary/30 focus-visible:ring-offset-0 rounded-md transition-colors w-auto"
                      style={{ minWidth: "200px" }}
                    />
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    {stepCounts.preprocessing > 0 && (
                      <Badge
                        variant="outline"
                        className="text-xs border-blue-500/30 text-blue-500"
                      >
                        {stepCounts.preprocessing} preprocessing
                      </Badge>
                    )}
                    {stepCounts.splitting > 0 && (
                      <Badge
                        variant="outline"
                        className="text-xs border-purple-500/30 text-purple-500"
                      >
                        {stepCounts.splitting} splitting
                      </Badge>
                    )}
                    {stepCounts.model > 0 && (
                      <Badge
                        variant="outline"
                        className="text-xs border-primary/30 text-primary"
                      >
                        {stepCounts.model} model
                      </Badge>
                    )}
                    {stepCounts.augmentation > 0 && (
                      <Badge
                        variant="outline"
                        className="text-xs border-indigo-500/30 text-indigo-500"
                      >
                        {stepCounts.augmentation} augmentation
                      </Badge>
                    )}
                    {stepCounts.branch > 0 && (
                      <Badge
                        variant="outline"
                        className="text-xs border-slate-500/30 text-slate-500"
                      >
                        {stepCounts.branch} branches
                      </Badge>
                    )}
                    {stepCounts.merge > 0 && (
                      <Badge
                        variant="outline"
                        className="text-xs border-slate-500/30 text-slate-500"
                      >
                        {stepCounts.merge} merges
                      </Badge>
                    )}
                    {/* Variant Count Display */}
                    {totalSteps > 0 && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Badge
                            variant="outline"
                            className={`text-xs cursor-pointer transition-colors ${
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
                    {/* Execution Preview - compact inline */}
                    {totalSteps > 0 && (
                      <ExecutionPreviewCompact
                        steps={steps}
                        variantCount={variantCount}
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
                    <DropdownMenuItem onClick={handleExportJson}>
                      <Download className="h-4 w-4 mr-2" />
                      Export as JSON (Editor)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleExportNirs4all}>
                      <FileJson className="h-4 w-4 mr-2" />
                      Export as JSON (nirs4all)
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleImportClick}>
                      <Upload className="h-4 w-4 mr-2" />
                      Import from JSON
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
                <Link to="/runs">
                  <Button size="sm" disabled={totalSteps === 0}>
                    <Play className="h-4 w-4 mr-2" />
                    Use in Experiment
                  </Button>
                </Link>
              </div>
            </div>
          </header>

          {/* Main Content: 3-Panel Layout */}
          <div className="flex-1 flex overflow-hidden">
            {/* Left Panel: Step Palette */}
            <div
              ref={panelRefs.palette}
              className="w-72 flex-shrink-0 relative"
              onClick={() => setFocusedPanel("palette")}
            >
              <FocusPanelRing isFocused={focusedPanel === "palette"} color="blue" />
              <StepPalette onAddStep={addStep} />
            </div>

            {/* Center: Pipeline Tree */}
            <div
              ref={panelRefs.tree}
              className="flex-1 min-w-0 min-h-0 flex flex-col relative overflow-hidden"
              onClick={() => setFocusedPanel("tree")}
            >
              <FocusPanelRing isFocused={focusedPanel === "tree"} color="emerald" />
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
            </div>

            {/* Right Panel: Configuration */}
            <div
              ref={panelRefs.config}
              className="w-80 flex-shrink-0 border-l border-border relative"
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

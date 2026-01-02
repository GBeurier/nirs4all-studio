import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
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
} from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { toast } from "sonner";
import { usePipelineEditor } from "@/hooks/usePipelineEditor";
import {
  StepPalette,
  PipelineCanvas,
  StepConfigPanel,
} from "@/components/pipeline-editor";
import type { StepType, StepOption } from "@/components/pipeline-editor/types";

// Demo pipeline for testing
const demoPipeline = [
  { id: "1", type: "preprocessing" as const, name: "SNV", params: {} },
  {
    id: "2",
    type: "preprocessing" as const,
    name: "SavitzkyGolay",
    params: { window: 11, polyorder: 2, deriv: 1 },
  },
  {
    id: "3",
    type: "splitting" as const,
    name: "KennardStone",
    params: { test_size: 0.2 },
  },
  {
    id: "4",
    type: "model" as const,
    name: "PLSRegression",
    params: { n_components: 10, max_iter: 500 },
  },
  { id: "5", type: "metrics" as const, name: "RMSE", params: {} },
  { id: "6", type: "metrics" as const, name: "R2", params: {} },
];

export default function PipelineEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id || id === "new";

  const [showClearDialog, setShowClearDialog] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Initialize with demo pipeline if editing, empty if new
  const {
    steps,
    pipelineName,
    selectedStepId,
    isFavorite,
    isDirty,
    canUndo,
    canRedo,
    stepCounts,
    totalSteps,
    setPipelineName,
    setSelectedStepId,
    setIsFavorite,
    addStep,
    removeStep,
    duplicateStep,
    moveStep,
    reorderSteps,
    updateStep,
    undo,
    redo,
    getSelectedStep,
    clearPipeline,
    exportPipeline,
  } = usePipelineEditor({
    initialSteps: isNew ? [] : demoPipeline,
    initialName: isNew ? "New Pipeline" : "SNV + SG → PLS",
  });

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Drag handlers
  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    // Handle dropping from palette
    if (active.data.current?.type === "palette-item") {
      const { stepType, option } = active.data.current as {
        stepType: StepType;
        option: StepOption;
      };
      addStep(stepType, option);
      toast.success(`${option.name} added to pipeline`);
      return;
    }

    // Handle reordering
    if (active.id !== over.id) {
      reorderSteps(active.id as string, over.id as string);
    }
  };

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

  const handleClearPipeline = () => {
    clearPipeline();
    setShowClearDialog(false);
    toast.success("Pipeline cleared");
  };

  const selectedStep = getSelectedStep();

  return (
    <TooltipProvider>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
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

                <div>
                  <Input
                    value={pipelineName}
                    onChange={(e) => setPipelineName(e.target.value)}
                    className="text-lg font-semibold border-none bg-transparent p-0 h-auto focus-visible:ring-0 focus-visible:ring-offset-0 w-auto"
                    style={{ minWidth: "200px" }}
                  />
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
                    {stepCounts.metrics > 0 && (
                      <Badge
                        variant="outline"
                        className="text-xs border-orange-500/30 text-orange-500"
                      >
                        {stepCounts.metrics} metrics
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

                {/* Keyboard shortcuts hint */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon">
                      <Keyboard className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="bottom"
                    align="end"
                    className="max-w-xs"
                  >
                    <div className="space-y-1 text-xs">
                      <p>
                        <kbd className="px-1 bg-muted rounded">Ctrl+Z</kbd> Undo
                      </p>
                      <p>
                        <kbd className="px-1 bg-muted rounded">Ctrl+Shift+Z</kbd>{" "}
                        Redo
                      </p>
                      <p>
                        <kbd className="px-1 bg-muted rounded">Ctrl+D</kbd>{" "}
                        Duplicate
                      </p>
                      <p>
                        <kbd className="px-1 bg-muted rounded">Del</kbd> Delete
                        selected
                      </p>
                      <p>
                        <kbd className="px-1 bg-muted rounded">Esc</kbd>{" "}
                        Deselect
                      </p>
                    </div>
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
                      Export as JSON
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled>
                      <Upload className="h-4 w-4 mr-2" />
                      Import from JSON
                    </DropdownMenuItem>
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
            <div className="w-72 flex-shrink-0">
              <StepPalette onAddStep={addStep} />
            </div>

            {/* Center: Pipeline Canvas */}
            <PipelineCanvas
              steps={steps}
              selectedStepId={selectedStepId}
              onSelectStep={setSelectedStepId}
              onRemoveStep={removeStep}
              onDuplicateStep={duplicateStep}
              onMoveStep={moveStep}
            />

            {/* Right Panel: Configuration */}
            <div className="w-80 flex-shrink-0 border-l border-border">
              <StepConfigPanel
                step={selectedStep}
                onUpdate={updateStep}
                onRemove={removeStep}
                onDuplicate={duplicateStep}
              />
            </div>
          </div>
        </motion.div>

        {/* Drag Overlay */}
        <DragOverlay>
          {activeId && activeId.startsWith("palette-") ? (
            <div className="p-4 rounded-lg border-2 border-primary bg-card shadow-2xl opacity-90">
              <span className="font-medium text-foreground">
                Drop to add step
              </span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

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
    </TooltipProvider>
  );
}

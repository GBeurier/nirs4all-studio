/**
 * SpectraSynthesis - Synthetic NIRS Dataset Builder Page
 *
 * A comprehensive tool for generating synthetic NIRS datasets using
 * the nirs4all SyntheticDatasetBuilder API.
 *
 * Layout:
 * - Left panel: Step palette (available builder steps)
 * - Center panel: Builder chain visualization
 * - Right panel: Step configuration
 * - Bottom panel: Preview visualization (collapsible)
 */

import { useState, useCallback } from "react";
import { motion } from "@/lib/motion";
import {
  Sparkles,
  Download,
  Upload,
  Undo2,
  Redo2,
  RotateCcw,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertCircle,
  BarChart3,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
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

import {
  SynthesisBuilderProvider,
  useSynthesisBuilder,
  SynthesisPreviewProvider,
  useSynthesisPreview,
} from "@/components/spectra-synthesis/contexts";
import { SynthesisPalette } from "@/components/spectra-synthesis/SynthesisPalette";
import { SynthesisBuilder } from "@/components/spectra-synthesis/SynthesisBuilder";
import { SynthesisConfigPanel } from "@/components/spectra-synthesis/SynthesisConfigPanel";
import { SynthesisPreviewChart } from "@/components/spectra-synthesis/SynthesisPreviewChart";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0 },
};

export default function SpectraSynthesis() {
  return (
    <SynthesisBuilderProvider>
      <SynthesisPreviewProvider>
        <SpectraSynthesisContent />
      </SynthesisPreviewProvider>
    </SynthesisBuilderProvider>
  );
}

function SpectraSynthesisContent() {
  const {
    state,
    undo,
    redo,
    canUndo,
    canRedo,
    reset,
    exportConfig,
    loadConfig,
  } = useSynthesisBuilder();

  const {
    state: previewState,
    generatePreview,
    canGenerate,
  } = useSynthesisPreview();

  const [showPreview, setShowPreview] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);

  // Handle generate preview
  const handleGenerate = useCallback(async () => {
    if (state.errors.length > 0) {
      toast.error("Please fix validation errors before generating");
      return;
    }

    if (!canGenerate) {
      toast.error("Add at least one step to generate a preview");
      return;
    }

    setShowPreview(true);

    try {
      await generatePreview();
      toast.success("Preview generated successfully");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to generate preview"
      );
    }
  }, [state.errors, canGenerate, generatePreview]);

  // Handle export config
  const handleExportConfig = useCallback(() => {
    const config = exportConfig();
    const blob = new Blob([JSON.stringify(config, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${config.name}_synthesis_config.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Configuration exported");
  }, [exportConfig]);

  // Handle import config
  const handleImportConfig = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const config = JSON.parse(text);
        loadConfig(config);
        toast.success("Configuration imported");
      } catch {
        toast.error("Failed to import configuration");
      }
    };
    input.click();
  }, [loadConfig]);

  // Handle reset
  const handleReset = useCallback(() => {
    reset();
    setShowResetDialog(false);
    toast.success("Builder reset to defaults");
  }, [reset]);

  return (
    <motion.div
      className="flex flex-col h-full"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Header */}
      <motion.div
        className="shrink-0 border-b px-4 py-3"
        variants={itemVariants}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">Spectra Synthesis</h1>
              <p className="text-sm text-muted-foreground">
                Generate synthetic NIRS datasets
              </p>
            </div>
            {state.isDirty && (
              <Badge variant="secondary" className="ml-2">
                Unsaved changes
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Undo/Redo */}
            <div className="flex items-center border rounded-md">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={undo}
                    disabled={!canUndo}
                  >
                    <Undo2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Undo</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={redo}
                    disabled={!canRedo}
                  >
                    <Redo2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Redo</TooltipContent>
              </Tooltip>
            </div>

            {/* Import/Export */}
            <div className="flex items-center border rounded-md">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={handleImportConfig}
                  >
                    <Upload className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Import configuration</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={handleExportConfig}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Export configuration</TooltipContent>
              </Tooltip>
            </div>

            {/* Reset */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setShowResetDialog(true)}
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reset to defaults</TooltipContent>
            </Tooltip>

            {/* Preview toggle */}
            <Button
              variant={showPreview ? "default" : "outline"}
              size="sm"
              onClick={() => setShowPreview(!showPreview)}
            >
              {showPreview ? (
                <>
                  <EyeOff className="h-4 w-4 mr-2" />
                  Hide Preview
                </>
              ) : (
                <>
                  <Eye className="h-4 w-4 mr-2" />
                  Show Preview
                </>
              )}
            </Button>
          </div>
        </div>
      </motion.div>

      {/* Main content */}
      <motion.div className="flex-1 min-h-0" variants={itemVariants}>
        <ResizablePanelGroup direction="horizontal" className="h-full">
          {/* Left panel - Palette */}
          <ResizablePanel defaultSize={20} minSize={15} maxSize={30}>
            <SynthesisPalette className="h-full border-r" />
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Center panel - Builder */}
          <ResizablePanel defaultSize={45} minSize={30}>
            <div className="h-full flex flex-col">
              <SynthesisBuilder
                className="flex-1"
                onGenerate={handleGenerate}
                isGenerating={previewState.isLoading}
              />
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Right panel - Config */}
          <ResizablePanel defaultSize={35} minSize={25} maxSize={50}>
            <SynthesisConfigPanel className="h-full border-l" />
          </ResizablePanel>
        </ResizablePanelGroup>
      </motion.div>

      {/* Preview panel (collapsible) */}
      {showPreview && (
        <motion.div
          className="shrink-0 border-t bg-muted/30"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
        >
          <PreviewPanel onClose={() => setShowPreview(false)} />
        </motion.div>
      )}

      {/* Reset confirmation dialog */}
      <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset Builder</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to reset the builder to defaults? This will
              remove all steps and configurations. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleReset}>
              Reset Builder
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}

// Preview panel component
interface PreviewPanelProps {
  onClose: () => void;
}

function PreviewPanel({ onClose }: PreviewPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const { state: previewState, generatePreview, canGenerate } = useSynthesisPreview();

  const { data, isLoading, error } = previewState;

  return (
    <div>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2 border-b cursor-pointer hover:bg-muted/50"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Preview</span>
          {isLoading && (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          )}
          {data && (
            <Badge variant="outline" className="ml-2">
              {data.spectra.length} samples
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Statistics badges */}
          {data?.statistics && (
            <div className="hidden md:flex items-center gap-2 mr-4">
              <Badge variant="secondary" className="text-xs">
                <BarChart3 className="h-3 w-3 mr-1" />
                {data.wavelengths.length} wavelengths
              </Badge>
              <Badge variant="secondary" className="text-xs">
                <Clock className="h-3 w-3 mr-1" />
                {data.execution_time_ms.toFixed(0)}ms
              </Badge>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="h-[350px]">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  Generating preview...
                </p>
              </div>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center max-w-md">
                <AlertCircle className="h-10 w-10 text-destructive mx-auto mb-3" />
                <p className="text-sm font-medium text-destructive mb-1">
                  Preview Generation Failed
                </p>
                <p className="text-xs text-muted-foreground mb-4">{error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={generatePreview}
                  disabled={!canGenerate}
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Retry
                </Button>
              </div>
            </div>
          ) : data ? (
            <div className="h-full flex">
              {/* Chart */}
              <div className="flex-1 p-4">
                <SynthesisPreviewChart data={data} className="h-full" />
              </div>

              {/* Statistics sidebar */}
              {data.statistics && (
                <div className="w-64 border-l p-4 overflow-auto">
                  <h4 className="text-sm font-medium mb-3">Statistics</h4>

                  <div className="space-y-4">
                    {/* Spectra stats */}
                    <div>
                      <h5 className="text-xs font-medium text-muted-foreground mb-2">
                        Spectra
                      </h5>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">Mean:</span>
                          <span className="ml-1 font-mono">
                            {data.statistics.spectra_mean.toFixed(4)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Std:</span>
                          <span className="ml-1 font-mono">
                            {data.statistics.spectra_std.toFixed(4)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Min:</span>
                          <span className="ml-1 font-mono">
                            {data.statistics.spectra_min.toFixed(4)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Max:</span>
                          <span className="ml-1 font-mono">
                            {data.statistics.spectra_max.toFixed(4)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Target stats */}
                    <div>
                      <h5 className="text-xs font-medium text-muted-foreground mb-2">
                        Targets ({data.target_type})
                      </h5>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">Mean:</span>
                          <span className="ml-1 font-mono">
                            {data.statistics.targets_mean.toFixed(4)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Std:</span>
                          <span className="ml-1 font-mono">
                            {data.statistics.targets_std.toFixed(4)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Min:</span>
                          <span className="ml-1 font-mono">
                            {data.statistics.targets_min.toFixed(4)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Max:</span>
                          <span className="ml-1 font-mono">
                            {data.statistics.targets_max.toFixed(4)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Class distribution for classification */}
                    {data.statistics.class_distribution && (
                      <div>
                        <h5 className="text-xs font-medium text-muted-foreground mb-2">
                          Class Distribution
                        </h5>
                        <div className="space-y-1 text-xs">
                          {Object.entries(data.statistics.class_distribution).map(
                            ([cls, count]) => (
                              <div
                                key={cls}
                                className="flex justify-between items-center"
                              >
                                <span>Class {cls}</span>
                                <Badge variant="secondary" className="text-xs">
                                  {count}
                                </Badge>
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    )}

                    {/* Full dataset info */}
                    <div className="pt-2 border-t">
                      <p className="text-xs text-muted-foreground">
                        Full dataset: {data.actual_samples.toLocaleString()}{" "}
                        samples
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-center">
              <div>
                <Sparkles className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
                <p className="text-sm text-muted-foreground">
                  Click "Generate Preview" to see synthetic spectra
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  The preview will show a sample of 100 spectra
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

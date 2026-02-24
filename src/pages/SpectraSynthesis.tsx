/**
 * SpectraSynthesis - Synthetic NIRS Dataset Builder Page
 *
 * A comprehensive tool for generating synthetic NIRS datasets using
 * the nirs4all SyntheticDatasetBuilder API.
 *
 * New Layout (Chart-Centric):
 * - Left panel (60%): Chart visualization with histogram and metadata
 * - Right panel (40%): Unified configuration (core + steps + inline config)
 */

import { useCallback } from "react";
import { MlLoadingOverlay } from "@/components/layout/MlLoadingOverlay";
import { motion } from "@/lib/motion";
import {
  Sparkles,
  Download,
  Upload,
  Undo2,
  Redo2,
  RotateCcw,
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
import { useState } from "react";

import {
  SynthesisBuilderProvider,
  useSynthesisBuilder,
  SynthesisPreviewProvider,
} from "@/components/spectra-synthesis/contexts";
import { ChartPanel } from "@/components/spectra-synthesis/chart";
import { ConfigurationPanel } from "@/components/spectra-synthesis/configuration";

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
    <MlLoadingOverlay>
    <SynthesisBuilderProvider>
      <SynthesisPreviewProvider>
        <SpectraSynthesisContent />
      </SynthesisPreviewProvider>
    </SynthesisBuilderProvider>
    </MlLoadingOverlay>
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

  const [showResetDialog, setShowResetDialog] = useState(false);

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
      {/* Compact Header */}
      <motion.div
        className="shrink-0 border-b px-4 py-2"
        variants={itemVariants}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h1 className="text-base font-semibold leading-tight">
                Spectra Synthesis
              </h1>
              <p className="text-xs text-muted-foreground">
                Generate synthetic NIRS datasets
              </p>
            </div>
            {state.isDirty && (
              <Badge variant="secondary" className="text-xs">
                Unsaved
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-1">
            {/* Undo/Redo */}
            <div className="flex items-center border rounded-md">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={undo}
                    disabled={!canUndo}
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Undo</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={redo}
                    disabled={!canRedo}
                  >
                    <Redo2 className="h-3.5 w-3.5" />
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
                    className="h-7 w-7"
                    onClick={handleImportConfig}
                  >
                    <Upload className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Import configuration</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={handleExportConfig}
                  >
                    <Download className="h-3.5 w-3.5" />
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
                  className="h-7 w-7"
                  onClick={() => setShowResetDialog(true)}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reset to defaults</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </motion.div>

      {/* Main content - Split layout */}
      <motion.div className="flex-1 min-h-0" variants={itemVariants}>
        <ResizablePanelGroup direction="horizontal" className="h-full">
          {/* Left panel - Chart (60%) */}
          <ResizablePanel defaultSize={60} minSize={45} maxSize={75}>
            <ChartPanel />
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Right panel - Configuration (40%) */}
          <ResizablePanel defaultSize={40} minSize={25} maxSize={55} className="overflow-hidden">
            <ConfigurationPanel />
          </ResizablePanel>
        </ResizablePanelGroup>
      </motion.div>

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

import type { ChangeEvent, RefObject } from "react";
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
import { CommandPalette } from "./CommandPalette";
import { KeyboardShortcutsDialog } from "./KeyboardShortcutsDialog";
import type {
  PipelineStep,
  StepOption,
  StepType,
} from "./types";

interface PipelineEditorRouteOverlaysProps {
  commandPaletteOpen: boolean;
  onCommandPaletteOpenChange: (open: boolean) => void;
  shortcutsDialogOpen: boolean;
  onShortcutsDialogOpenChange: (open: boolean) => void;
  clearDialogOpen: boolean;
  onClearDialogOpenChange: (open: boolean) => void;
  totalSteps: number;
  selectedStepId: string | null;
  steps: PipelineStep[];
  onSelectStep: (id: string) => void;
  onAddStep: (type: StepType, option: StepOption) => void;
  onRemoveStep: (id: string) => void;
  onDuplicateStep: (id: string) => void;
  onSave: () => void;
  onExportJson: () => void;
  onToggleFavorite: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onOpenShortcutsHelp: () => void;
  onClearPipeline: () => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileImport: (event: ChangeEvent<HTMLInputElement>) => void;
}

export function PipelineEditorRouteOverlays({
  commandPaletteOpen,
  onCommandPaletteOpenChange,
  shortcutsDialogOpen,
  onShortcutsDialogOpenChange,
  clearDialogOpen,
  onClearDialogOpenChange,
  totalSteps,
  selectedStepId,
  steps,
  onSelectStep,
  onAddStep,
  onRemoveStep,
  onDuplicateStep,
  onSave,
  onExportJson,
  onToggleFavorite,
  onUndo,
  onRedo,
  onOpenShortcutsHelp,
  onClearPipeline,
  fileInputRef,
  onFileImport,
}: PipelineEditorRouteOverlaysProps) {
  return (
    <>
      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={onCommandPaletteOpenChange}
        selectedStepId={selectedStepId}
        steps={steps}
        onSelectStep={onSelectStep}
        onAddStep={onAddStep}
        onRemoveStep={onRemoveStep}
        onDuplicateStep={onDuplicateStep}
        onSave={onSave}
        onExport={onExportJson}
        onToggleFavorite={onToggleFavorite}
        onUndo={onUndo}
        onRedo={onRedo}
        onOpenShortcutsHelp={onOpenShortcutsHelp}
      />

      <KeyboardShortcutsDialog
        open={shortcutsDialogOpen}
        onOpenChange={onShortcutsDialogOpenChange}
      />

      <AlertDialog open={clearDialogOpen} onOpenChange={onClearDialogOpenChange}>
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
              onClick={onClearPipeline}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Clear All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.yaml,.yml"
        onChange={onFileImport}
        className="hidden"
      />
    </>
  );
}

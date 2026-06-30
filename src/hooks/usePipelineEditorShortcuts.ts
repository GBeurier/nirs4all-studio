import { useEffect } from "react";

interface UsePipelineEditorShortcutsOptions {
  selectedStepId: string | null;
  undo: () => void;
  redo: () => void;
  removeStep: (id: string) => void;
  duplicateStep: (id: string) => void;
  setSelectedStepId: (id: string | null) => void;
}

function isTextInput(element: Element | null): boolean {
  return element?.tagName === "INPUT" || element?.tagName === "TEXTAREA";
}

export function usePipelineEditorShortcuts({
  selectedStepId,
  undo,
  redo,
  removeStep,
  duplicateStep,
  setSelectedStepId,
}: UsePipelineEditorShortcutsOptions): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTextInput(document.activeElement)) {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }

      if (
        (e.metaKey || e.ctrlKey) &&
        (e.key === "y" || (e.key === "z" && e.shiftKey))
      ) {
        e.preventDefault();
        redo();
      }

      if ((e.key === "Delete" || e.key === "Backspace") && selectedStepId) {
        e.preventDefault();
        removeStep(selectedStepId);
      }

      if (e.key === "Escape") {
        setSelectedStepId(null);
      }

      if (e.key === "d" && (e.metaKey || e.ctrlKey) && selectedStepId) {
        e.preventDefault();
        duplicateStep(selectedStepId);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [duplicateStep, redo, removeStep, selectedStepId, setSelectedStepId, undo]);
}

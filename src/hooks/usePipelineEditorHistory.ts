import { useCallback, useState } from "react";

import type { PipelineStep } from "@/components/pipeline-editor/types";
import {
  pushPipelineGraphHistory,
  redoPipelineGraphHistory,
  undoPipelineGraphHistory,
} from "@/lib/pipelineGraphReducer";

interface UsePipelineEditorHistoryOptions {
  initialSteps: PipelineStep[];
  maxHistorySize: number;
  setSteps: (steps: PipelineStep[]) => void;
  setIsDirty: (isDirty: boolean) => void;
}

interface UsePipelineEditorHistoryReturn {
  canUndo: boolean;
  canRedo: boolean;
  pushToHistory: (steps: PipelineStep[]) => void;
  resetHistory: (steps: PipelineStep[]) => void;
  undo: () => void;
  redo: () => void;
}

export function usePipelineEditorHistory({
  initialSteps,
  maxHistorySize,
  setSteps,
  setIsDirty,
}: UsePipelineEditorHistoryOptions): UsePipelineEditorHistoryReturn {
  const [history, setHistory] = useState<PipelineStep[][]>(() => [initialSteps]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  const pushToHistory = useCallback(
    (nextSteps: PipelineStep[]) => {
      const nextHistory = pushPipelineGraphHistory({
        history,
        historyIndex,
        nextSteps,
        maxHistorySize,
      });
      setHistory(nextHistory.history);
      setHistoryIndex(nextHistory.historyIndex);
      setIsDirty(true);
    },
    [history, historyIndex, maxHistorySize, setIsDirty]
  );

  const resetHistory = useCallback((nextSteps: PipelineStep[]) => {
    setHistory([nextSteps]);
    setHistoryIndex(0);
  }, []);

  const undo = useCallback(() => {
    const nextHistory = undoPipelineGraphHistory({ history, historyIndex });
    if (!nextHistory) return;
    setHistoryIndex(nextHistory.historyIndex);
    setSteps(nextHistory.steps);
  }, [history, historyIndex, setSteps]);

  const redo = useCallback(() => {
    const nextHistory = redoPipelineGraphHistory({ history, historyIndex });
    if (!nextHistory) return;
    setHistoryIndex(nextHistory.historyIndex);
    setSteps(nextHistory.steps);
  }, [history, historyIndex, setSteps]);

  return {
    canUndo,
    canRedo,
    pushToHistory,
    resetHistory,
    undo,
    redo,
  };
}

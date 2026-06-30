import { useCallback } from "react";
import { arrayMove } from "@dnd-kit/sortable";

import type {
  DragData,
  DropIndicator,
  PipelineStep,
  StepOption,
  StepType,
} from "@/components/pipeline-editor/types";
import {
  cloneStep,
  createStepFromOption,
} from "@/components/pipeline-editor/types";
import { getAdjustedInsertIndex } from "@/components/pipeline-editor/dnd-utils";
import {
  findPipelineStepById,
  getPipelineStepsAtPath,
  removePipelineStepById,
  updatePipelineStepsAtPath,
} from "@/lib/pipelineGraphReducer";

interface UsePipelineEditorStepOperationsOptions {
  steps: PipelineStep[];
  selectedStepId: string | null;
  setSteps: (steps: PipelineStep[]) => void;
  setSelectedStepId: (id: string | null) => void;
  pushToHistory: (steps: PipelineStep[]) => void;
}

export interface UsePipelineEditorStepOperationsReturn {
  addStep: (type: StepType, option: StepOption) => void;
  addStepAtPath: (type: StepType, option: StepOption, path: string[], index: number) => void;
  removeStep: (id: string, path?: string[]) => void;
  duplicateStep: (id: string, path?: string[]) => void;
  moveStep: (id: string, direction: "up" | "down", path?: string[]) => void;
  reorderSteps: (activeId: string, overId: string) => void;
  updateStep: (id: string, updates: Partial<PipelineStep>) => void;
  addBranch: (stepId: string, path?: string[]) => void;
  removeBranch: (stepId: string, branchIndex: number, path?: string[]) => void;
  addChild: (stepId: string, path?: string[]) => void;
  removeChild: (stepId: string, childId: string, path?: string[]) => void;
  updateChild: (stepId: string, childId: string, updates: Partial<PipelineStep>, path?: string[]) => void;
  handleDrop: (data: DragData, indicator: DropIndicator) => void;
  handleReorder: (activeId: string, overId: string, data: DragData) => void;
}

export function usePipelineEditorStepOperations({
  steps,
  selectedStepId,
  setSteps,
  setSelectedStepId,
  pushToHistory,
}: UsePipelineEditorStepOperationsOptions): UsePipelineEditorStepOperationsReturn {
  const addStep = useCallback(
    (type: StepType, option: StepOption) => {
      const newStep = createStepFromOption(type, option);
      const newSteps = [...steps, newStep];
      setSteps(newSteps);
      pushToHistory(newSteps);
      setSelectedStepId(newStep.id);
    },
    [steps, pushToHistory, setSelectedStepId, setSteps]
  );

  const addStepAtPath = useCallback(
    (type: StepType, option: StepOption, path: string[], index: number) => {
      const newStep = createStepFromOption(type, option);

      const newSteps = updatePipelineStepsAtPath(steps, path, (targetSteps) => {
        const result = [...targetSteps];
        result.splice(index, 0, newStep);
        return result;
      });

      setSteps(newSteps);
      pushToHistory(newSteps);
      setSelectedStepId(newStep.id);
    },
    [steps, pushToHistory, setSelectedStepId, setSteps]
  );

  const removeStep = useCallback(
    (id: string, path?: string[]) => {
      let newSteps: PipelineStep[];

      if (path && path.length > 0) {
        newSteps = updatePipelineStepsAtPath(steps, path, (targetSteps) =>
          targetSteps.filter((step) => step.id !== id)
        );
      } else {
        newSteps = removePipelineStepById(steps, id);
      }

      setSteps(newSteps);
      pushToHistory(newSteps);
      if (selectedStepId === id) {
        setSelectedStepId(null);
      }
    },
    [steps, selectedStepId, pushToHistory, setSelectedStepId, setSteps]
  );

  const duplicateStep = useCallback(
    (id: string, path?: string[]) => {
      const step = findPipelineStepById(steps, id);
      if (!step) return;

      const newStep = cloneStep(step);

      if (path && path.length > 0) {
        const newSteps = updatePipelineStepsAtPath(steps, path, (targetSteps) => {
          const index = targetSteps.findIndex((targetStep) => targetStep.id === id);
          if (index === -1) return targetSteps;
          const result = [...targetSteps];
          result.splice(index + 1, 0, newStep);
          return result;
        });
        setSteps(newSteps);
        pushToHistory(newSteps);
      } else {
        const stepIndex = steps.findIndex((targetStep) => targetStep.id === id);
        if (stepIndex === -1) return;

        const newSteps = [
          ...steps.slice(0, stepIndex + 1),
          newStep,
          ...steps.slice(stepIndex + 1),
        ];
        setSteps(newSteps);
        pushToHistory(newSteps);
      }

      setSelectedStepId(newStep.id);
    },
    [steps, pushToHistory, setSelectedStepId, setSteps]
  );

  const moveStep = useCallback(
    (id: string, direction: "up" | "down", path?: string[]) => {
      if (path && path.length > 0) {
        const newSteps = updatePipelineStepsAtPath(steps, path, (targetSteps) => {
          const oldIndex = targetSteps.findIndex((targetStep) => targetStep.id === id);
          if (oldIndex === -1) return targetSteps;

          const newIndex = direction === "up" ? oldIndex - 1 : oldIndex + 1;
          if (newIndex < 0 || newIndex >= targetSteps.length) return targetSteps;

          return arrayMove(targetSteps, oldIndex, newIndex);
        });
        setSteps(newSteps);
        pushToHistory(newSteps);
      } else {
        const oldIndex = steps.findIndex((targetStep) => targetStep.id === id);
        if (oldIndex === -1) return;

        const newIndex = direction === "up" ? oldIndex - 1 : oldIndex + 1;
        if (newIndex < 0 || newIndex >= steps.length) return;

        const newSteps = arrayMove(steps, oldIndex, newIndex);
        setSteps(newSteps);
        pushToHistory(newSteps);
      }
    },
    [steps, pushToHistory, setSteps]
  );

  const reorderSteps = useCallback(
    (activeId: string, overId: string) => {
      if (activeId === overId) return;

      const oldIndex = steps.findIndex((step) => step.id === activeId);
      const newIndex = steps.findIndex((step) => step.id === overId);

      if (oldIndex !== -1 && newIndex !== -1) {
        const newSteps = arrayMove(steps, oldIndex, newIndex);
        setSteps(newSteps);
        pushToHistory(newSteps);
      }
    },
    [steps, pushToHistory, setSteps]
  );

  const updateStep = useCallback(
    (id: string, updates: Partial<PipelineStep>) => {
      const updateRecursive = (stepsArray: PipelineStep[]): PipelineStep[] =>
        stepsArray.map((step) => {
          if (step.id === id) {
            return { ...step, ...updates };
          }
          let updated = step;
          if (step.branches) {
            updated = {
              ...updated,
              branches: step.branches.map((branch) => updateRecursive(branch)),
            };
          }
          if (step.children) {
            updated = {
              ...updated,
              children: updateRecursive(step.children),
            };
          }
          return updated;
        });

      const newSteps = updateRecursive(steps);
      setSteps(newSteps);
      pushToHistory(newSteps);
    },
    [steps, pushToHistory, setSteps]
  );

  const addBranch = useCallback(
    (stepId: string, path?: string[]) => {
      const newSteps = updatePipelineStepsAtPath(steps, path || [], (targetSteps) =>
        targetSteps.map((step) => {
          if (step.id === stepId && (step.subType === "branch" || step.subType === "generator") && step.branches) {
            return {
              ...step,
              branches: [...step.branches, []],
              branchMetadata: [...(step.branchMetadata || []), {}],
            };
          }
          return step;
        })
      );
      setSteps(newSteps);
      pushToHistory(newSteps);
    },
    [steps, pushToHistory, setSteps]
  );

  const removeBranch = useCallback(
    (stepId: string, branchIndex: number, path?: string[]) => {
      const newSteps = updatePipelineStepsAtPath(steps, path || [], (targetSteps) =>
        targetSteps.map((step) => {
          if (
            step.id === stepId &&
            (step.subType === "branch" || step.subType === "generator") &&
            step.branches &&
            step.branches.length > 1
          ) {
            return {
              ...step,
              branches: step.branches.filter((_, index) => index !== branchIndex),
              branchMetadata: step.branchMetadata?.filter((_, index) => index !== branchIndex),
            };
          }
          return step;
        })
      );
      setSteps(newSteps);
      pushToHistory(newSteps);
    },
    [steps, pushToHistory, setSteps]
  );

  const addChild = useCallback(
    (stepId: string, path?: string[]) => {
      const newSteps = updatePipelineStepsAtPath(steps, path || [], (targetSteps) =>
        targetSteps.map((step) => {
          if (step.id === stepId) {
            const childType = step.subType === "sample_filter" ? "filter" : "preprocessing";
            const newChild: PipelineStep = {
              id: `child-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              type: childType,
              name: childType === "filter" ? "ThresholdFilter" : "SNV",
              params: {},
            };
            return {
              ...step,
              children: [...(step.children || []), newChild],
            };
          }
          return step;
        })
      );
      setSteps(newSteps);
      pushToHistory(newSteps);
    },
    [steps, pushToHistory, setSteps]
  );

  const removeChild = useCallback(
    (stepId: string, childId: string, path?: string[]) => {
      const newSteps = updatePipelineStepsAtPath(steps, path || [], (targetSteps) =>
        targetSteps.map((step) => {
          if (step.id === stepId && step.children) {
            return {
              ...step,
              children: step.children.filter((child) => child.id !== childId),
            };
          }
          return step;
        })
      );
      setSteps(newSteps);
      pushToHistory(newSteps);
    },
    [steps, pushToHistory, setSteps]
  );

  const updateChild = useCallback(
    (stepId: string, childId: string, updates: Partial<PipelineStep>, path?: string[]) => {
      const newSteps = updatePipelineStepsAtPath(steps, path || [], (targetSteps) =>
        targetSteps.map((step) => {
          if (step.id === stepId && step.children) {
            return {
              ...step,
              children: step.children.map((child) =>
                child.id === childId ? { ...child, ...updates } : child
              ),
            };
          }
          return step;
        })
      );
      setSteps(newSteps);
      pushToHistory(newSteps);
    },
    [steps, pushToHistory, setSteps]
  );

  const handleDrop = useCallback(
    (data: DragData, indicator: DropIndicator) => {
      if (data.type === "palette-item" && data.stepType && data.option) {
        addStepAtPath(data.stepType, data.option, indicator.path, indicator.index);
      } else if (data.type === "pipeline-step" && data.stepId && data.step) {
        const stepId = data.stepId;
        const draggedStep = data.step;

        if (indicator.path.includes(stepId)) {
          return;
        }

        const sourcePath = data.sourcePath ?? [];
        const sourceIndex = getPipelineStepsAtPath(steps, sourcePath).findIndex((step) => step.id === stepId);
        const insertIndex = getAdjustedInsertIndex(sourcePath, sourceIndex, indicator.path, indicator.index);
        let newSteps = removePipelineStepById(steps, stepId);

        newSteps = updatePipelineStepsAtPath(newSteps, indicator.path, (targetSteps) => {
          const result = [...targetSteps];
          result.splice(insertIndex, 0, { ...draggedStep, id: stepId });
          return result;
        });

        setSteps(newSteps);
        pushToHistory(newSteps);
      }
    },
    [steps, pushToHistory, addStepAtPath, setSteps]
  );

  const handleReorder = useCallback(
    (activeId: string, overId: string) => {
      if (activeId === overId) return;

      const oldIndex = steps.findIndex((step) => step.id === activeId);
      const newIndex = steps.findIndex((step) => step.id === overId);

      if (oldIndex !== -1 && newIndex !== -1) {
        const newSteps = arrayMove(steps, oldIndex, newIndex);
        setSteps(newSteps);
        pushToHistory(newSteps);
      }
    },
    [steps, pushToHistory, setSteps]
  );

  return {
    addStep,
    addStepAtPath,
    removeStep,
    duplicateStep,
    moveStep,
    reorderSteps,
    updateStep,
    addBranch,
    removeBranch,
    addChild,
    removeChild,
    updateChild,
    handleDrop,
    handleReorder,
  };
}

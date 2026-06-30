import type {
  LegacyStepType,
  PipelineStep,
} from "@/components/pipeline-editor/types";

export const PIPELINE_CHILDREN_CONTAINER_TYPES: LegacyStepType[] = [
  "sample_augmentation",
  "feature_augmentation",
  "sample_filter",
  "concat_transform",
  "sequential",
];

export interface PipelineGraphHistoryState {
  history: PipelineStep[][];
  historyIndex: number;
}

function isPipelineChildrenContainerStep(step: PipelineStep): boolean {
  return PIPELINE_CHILDREN_CONTAINER_TYPES.includes((step.subType ?? step.type) as LegacyStepType);
}

export function getPipelineStepsAtPath(
  steps: readonly PipelineStep[],
  path: readonly string[],
): PipelineStep[] {
  if (path.length === 0) return [...steps];

  const [stepId, type, ...rest] = path;
  const step = steps.find((entry) => entry.id === stepId);
  if (!step) return [];

  if (type === "branch" && step.branches) {
    const [indexStr, ...branchRest] = rest;
    const branchIndex = parseInt(indexStr, 10);
    if (branchIndex >= 0 && branchIndex < step.branches.length) {
      return getPipelineStepsAtPath(step.branches[branchIndex] ?? [], branchRest);
    }
  }

  if (type === "children" && step.children) {
    return getPipelineStepsAtPath(step.children, rest);
  }

  return [];
}

export function updatePipelineStepsAtPath(
  steps: readonly PipelineStep[],
  path: readonly string[],
  updater: (steps: PipelineStep[]) => PipelineStep[],
): PipelineStep[] {
  if (path.length === 0) {
    return updater([...steps]);
  }

  const [stepId, type, ...rest] = path;

  return steps.map((step) => {
    if (step.id !== stepId) return step;

    if (type === "branch" && step.branches) {
      const [indexStr, ...branchRest] = rest;
      const branchIndex = parseInt(indexStr, 10);
      return {
        ...step,
        branches: step.branches.map((branch, index) => (
          index === branchIndex
            ? updatePipelineStepsAtPath(branch, branchRest, updater)
            : branch
        )),
      };
    }

    if (type === "children") {
      const currentChildren = step.children ?? (isPipelineChildrenContainerStep(step) ? [] : undefined);
      if (currentChildren !== undefined) {
        return {
          ...step,
          children: updatePipelineStepsAtPath(currentChildren, rest, updater),
        };
      }
    }

    return step;
  });
}

export function countPipelineStepsRecursive(
  steps: readonly PipelineStep[],
): Record<LegacyStepType, number> {
  const counts: Record<LegacyStepType, number> = {
    preprocessing: 0,
    y_processing: 0,
    splitting: 0,
    model: 0,
    flow: 0,
    utility: 0,
    generator: 0,
    branch: 0,
    merge: 0,
    filter: 0,
    augmentation: 0,
    sample_augmentation: 0,
    feature_augmentation: 0,
    sample_filter: 0,
    concat_transform: 0,
    sequential: 0,
    chart: 0,
    comment: 0,
  };

  for (const step of steps) {
    const countKey = (step.subType ?? step.type) as LegacyStepType;
    if (counts[countKey] !== undefined) {
      counts[countKey]++;
    }
    if (step.branches) {
      for (const branch of step.branches) {
        const branchCounts = countPipelineStepsRecursive(branch);
        for (const type of Object.keys(branchCounts) as LegacyStepType[]) {
          counts[type] += branchCounts[type];
        }
      }
    }
    if (step.children) {
      const childCounts = countPipelineStepsRecursive(step.children);
      for (const type of Object.keys(childCounts) as LegacyStepType[]) {
        counts[type] += childCounts[type];
      }
    }
  }

  return counts;
}

export function findPipelineStepById(
  steps: readonly PipelineStep[],
  id: string,
): PipelineStep | null {
  for (const step of steps) {
    if (step.id === id) return step;
    if (step.branches) {
      for (const branch of step.branches) {
        const found = findPipelineStepById(branch, id);
        if (found) return found;
      }
    }
    if (step.children) {
      const found = findPipelineStepById(step.children, id);
      if (found) return found;
    }
  }
  return null;
}

export function removePipelineStepById(
  steps: readonly PipelineStep[],
  id: string,
): PipelineStep[] {
  return steps
    .filter((step) => step.id !== id)
    .map((step) => ({
      ...step,
      branches: step.branches?.map((branch) => removePipelineStepById(branch, id)),
      children: step.children ? removePipelineStepById(step.children, id) : undefined,
    }));
}

export function pushPipelineGraphHistory({
  history,
  historyIndex,
  nextSteps,
  maxHistorySize,
}: PipelineGraphHistoryState & {
  nextSteps: PipelineStep[];
  maxHistorySize: number;
}): PipelineGraphHistoryState {
  const nextHistory = history.slice(0, historyIndex + 1);
  nextHistory.push(nextSteps);
  if (nextHistory.length > maxHistorySize) {
    nextHistory.shift();
  }

  return {
    history: nextHistory,
    historyIndex: Math.min(historyIndex + 1, maxHistorySize - 1),
  };
}

export function undoPipelineGraphHistory(
  state: PipelineGraphHistoryState,
): (PipelineGraphHistoryState & { steps: PipelineStep[] }) | null {
  if (state.historyIndex <= 0) return null;
  const historyIndex = state.historyIndex - 1;
  return {
    history: state.history,
    historyIndex,
    steps: state.history[historyIndex] ?? [],
  };
}

export function redoPipelineGraphHistory(
  state: PipelineGraphHistoryState,
): (PipelineGraphHistoryState & { steps: PipelineStep[] }) | null {
  if (state.historyIndex >= state.history.length - 1) return null;
  const historyIndex = state.historyIndex + 1;
  return {
    history: state.history,
    historyIndex,
    steps: state.history[historyIndex] ?? [],
  };
}

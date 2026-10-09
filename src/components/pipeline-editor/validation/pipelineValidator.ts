/**
 * Pipeline Validator
 *
 * Validates pipeline structure and composition.
 * Checks for model presence, splitter placement, step ordering, etc.
 *
 * @see docs/_internals/implementation_roadmap.md Task 4.3
 */

import i18n from "i18next";
import type { PipelineStep, StepType } from "../types";
import type {
  ValidationIssue,
  ValidationLocation,
  ValidationErrorCode,
  ValidationSeverity,
  ValidationContext,
} from "./types";
import { generateIssueId } from "./types";

// ============================================================================
// Pipeline Validation
// ============================================================================

/**
 * Create a pipeline-level validation issue.
 */
export function createPipelineIssue(
  code: ValidationErrorCode,
  severity: ValidationSeverity,
  message: string,
  location: Partial<ValidationLocation> = {},
  options?: {
    details?: string;
    suggestion?: string;
    quickFix?: string;
  }
): ValidationIssue {
  return {
    id: generateIssueId(),
    code,
    severity,
    category: "pipeline",
    message,
    location: location as ValidationLocation,
    details: options?.details,
    suggestion: options?.suggestion,
    quickFix: options?.quickFix,
  };
}

/**
 * Validate entire pipeline structure.
 */
export function validatePipeline(context: ValidationContext): ValidationIssue[] {
  const { steps } = context;
  const issues: ValidationIssue[] = [];

  // Empty pipeline check
  if (steps.length === 0) {
    issues.push(
      createPipelineIssue(
        "PIPELINE_EMPTY",
        "info",
        i18n.t("pipelineEditor.validation.pipeline.empty"),
        {},
        { suggestion: i18n.t("pipelineEditor.validation.pipeline.emptySuggestion") }
      )
    );
    return issues;
  }

  // Filter out disabled steps for structural validation
  const enabledSteps = steps.filter((s) => s.enabled !== false);
  if (enabledSteps.length === 0) {
    issues.push(
      createPipelineIssue(
        "PIPELINE_EMPTY",
        "warning",
        i18n.t("pipelineEditor.validation.pipeline.allDisabled"),
        {},
        { suggestion: i18n.t("pipelineEditor.validation.pipeline.allDisabledSuggestion") }
      )
    );
    return issues;
  }

  // Check for model presence
  issues.push(...validateModelPresence(enabledSteps));

  // Check for splitter before model
  issues.push(...validateSplitterPlacement(enabledSteps));

  // Check for merge without branch
  issues.push(...validateMergeBranchPairing(enabledSteps));

  // Check step ordering
  issues.push(...validateStepOrdering(enabledSteps));

  // Check for multiple models (warning, not error)
  issues.push(...validateMultipleModels(enabledSteps));

  return issues;
}

/**
 * Check that at least one model step exists.
 */
function validateModelPresence(steps: PipelineStep[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const hasModel = findStepsByType(steps, "model").length > 0;

  if (!hasModel) {
    issues.push(
      createPipelineIssue(
        "PIPELINE_NO_MODEL",
        "warning",
        i18n.t("pipelineEditor.validation.pipeline.noModel"),
        {},
        {
          details: i18n.t("pipelineEditor.validation.pipeline.noModelDetails"),
          suggestion: i18n.t("pipelineEditor.validation.pipeline.noModelSuggestion"),
          quickFix: "add_model",
        }
      )
    );
  }

  return issues;
}

/**
 * Check that splitter appears before model (if both exist).
 */
function validateSplitterPlacement(steps: PipelineStep[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const modelSteps = findStepsByTypeWithIndex(steps, "model");
  const splitterSteps = findStepsByTypeWithIndex(steps, "splitting");

  if (modelSteps.length === 0) {
    // No model, skip splitter validation
    return issues;
  }

  if (splitterSteps.length === 0) {
    // No splitter - this is informational, not an error
    issues.push(
      createPipelineIssue(
        "PIPELINE_NO_SPLITTER",
        "info",
        i18n.t("pipelineEditor.validation.pipeline.noSplitter"),
        {},
        {
          details: i18n.t("pipelineEditor.validation.pipeline.noSplitterDetails"),
          suggestion: i18n.t("pipelineEditor.validation.pipeline.noSplitterSuggestion"),
        }
      )
    );
    return issues;
  }

  // Check if any model appears before any splitter
  const firstModelIndex = modelSteps[0].index;
  const firstSplitterIndex = splitterSteps[0].index;

  if (firstModelIndex < firstSplitterIndex) {
    const modelStep = modelSteps[0].step;
    issues.push(
      createPipelineIssue(
        "PIPELINE_MODEL_BEFORE_SPLITTER",
        "warning",
        i18n.t("pipelineEditor.validation.pipeline.modelBeforeSplitter"),
        {
          stepId: modelStep.id,
          stepName: modelStep.name,
          stepType: modelStep.type,
          stepIndex: firstModelIndex,
        },
        {
          details: i18n.t("pipelineEditor.validation.pipeline.modelBeforeSplitterDetails"),
          suggestion: i18n.t("pipelineEditor.validation.pipeline.modelBeforeSplitterSuggestion"),
          quickFix: "reorder_steps",
        }
      )
    );
  }

  return issues;
}

/**
 * Check that merge steps have corresponding branch steps.
 */
function validateMergeBranchPairing(steps: PipelineStep[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  let branchDepth = 0;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    if (step.subType === "branch" || step.subType === "generator") {
      branchDepth++;
    } else if (step.subType === "merge") {
      if (branchDepth === 0) {
        issues.push(
          createPipelineIssue(
            "PIPELINE_MERGE_WITHOUT_BRANCH",
            "error",
            i18n.t("pipelineEditor.validation.pipeline.mergeNoBranch", { name: step.name }),
            {
              stepId: step.id,
              stepName: step.name,
              stepType: step.type,
              stepIndex: i,
            },
            {
              details: i18n.t("pipelineEditor.validation.pipeline.mergeNoBranchDetails"),
              suggestion: i18n.t("pipelineEditor.validation.pipeline.mergeNoBranchSuggestion"),
            }
          )
        );
      } else {
        branchDepth--;
      }
    }
  }

  // Check for unmatched branches (optional - branches don't require merge)
  // This is informational only
  if (branchDepth > 0) {
    issues.push(
      createPipelineIssue(
        "PIPELINE_MERGE_WITHOUT_BRANCH",
        "info",
        i18n.t("pipelineEditor.validation.pipeline.branchesNoMerge", { count: branchDepth }),
        {},
        {
          details: i18n.t("pipelineEditor.validation.pipeline.branchesNoMergeDetails"),
          suggestion: i18n.t("pipelineEditor.validation.pipeline.branchesNoMergeSuggestion"),
        }
      )
    );
  }

  return issues;
}

/**
 * Check for suspicious step ordering.
 */
function validateStepOrdering(steps: PipelineStep[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Define expected step type order (rough guidance)
  // Note: flow/utility types are intentionally omitted as their placement
  // depends on subType (branch, merge, etc.) and is validated separately.
  const expectedOrder: StepType[] = [
    "preprocessing",
    "y_processing",
    "filter",
    "augmentation",
    "splitting",
    "model",
    "flow",
    "utility",
  ];

  // Check for preprocessing after model (suspicious)
  const modelIndices = findStepsByTypeWithIndex(steps, "model").map((s) => s.index);
  const preprocessingAfterModel = findStepsByTypeWithIndex(steps, "preprocessing").filter(
    ({ index }) => modelIndices.some((modelIdx) => index > modelIdx)
  );

  for (const { step, index } of preprocessingAfterModel) {
    issues.push(
      createPipelineIssue(
        "DEP_INVALID_ORDER",
        "warning",
        i18n.t("pipelineEditor.validation.pipeline.preprocessingAfterModel", { name: step.name }),
        {
          stepId: step.id,
          stepName: step.name,
          stepType: step.type,
          stepIndex: index,
        },
        {
          details: i18n.t("pipelineEditor.validation.pipeline.preprocessingAfterModelDetails"),
          suggestion: i18n.t("pipelineEditor.validation.pipeline.preprocessingAfterModelSuggestion"),
        }
      )
    );
  }

  // Check for splitting after model
  const splittingAfterModel = findStepsByTypeWithIndex(steps, "splitting").filter(
    ({ index }) => modelIndices.some((modelIdx) => index > modelIdx)
  );

  for (const { step, index } of splittingAfterModel) {
    issues.push(
      createPipelineIssue(
        "DEP_INVALID_ORDER",
        "warning",
        i18n.t("pipelineEditor.validation.pipeline.splittingAfterModel", { name: step.name }),
        {
          stepId: step.id,
          stepName: step.name,
          stepType: step.type,
          stepIndex: index,
        },
        {
          details: i18n.t("pipelineEditor.validation.pipeline.splittingAfterModelDetails"),
          suggestion: i18n.t("pipelineEditor.validation.pipeline.splittingAfterModelSuggestion"),
        }
      )
    );
  }

  return issues;
}

/**
 * Check for multiple model steps (warning).
 */
function validateMultipleModels(steps: PipelineStep[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const modelSteps = findStepsByType(steps, "model");

  // Multiple models at root level without generator/branch is unusual
  if (modelSteps.length > 1) {
    // Check if they're inside a generator or branch
    const rootModels = modelSteps.filter((step) => {
      // This is a simplified check - actual logic would need to traverse tree
      return steps.includes(step);
    });

    if (rootModels.length > 1) {
      issues.push(
        createPipelineIssue(
          "PIPELINE_MULTIPLE_MODELS",
          "info",
          i18n.t("pipelineEditor.validation.pipeline.multipleModels", { count: rootModels.length }),
          {},
          {
            details: i18n.t("pipelineEditor.validation.pipeline.multipleModelsDetails"),
            suggestion: i18n.t("pipelineEditor.validation.pipeline.multipleModelsSuggestion"),
          }
        )
      );
    }
  }

  return issues;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Find all steps of a given type (recursive through branches).
 */
function findStepsByType(steps: PipelineStep[], type: StepType): PipelineStep[] {
  const found: PipelineStep[] = [];

  function search(stepsToSearch: PipelineStep[]): void {
    for (const step of stepsToSearch) {
      if (step.type === type && step.enabled !== false) {
        found.push(step);
      }

      if (step.branches) {
        for (const branch of step.branches) {
          search(branch);
        }
      }

      if (step.children) {
        search(step.children);
      }
    }
  }

  search(steps);
  return found;
}

/**
 * Find all steps of a given type with their index (non-recursive, root level only).
 */
function findStepsByTypeWithIndex(
  steps: PipelineStep[],
  type: StepType
): { step: PipelineStep; index: number }[] {
  return steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => step.type === type && step.enabled !== false);
}

/**
 * Count total steps in pipeline (including nested).
 */
export function countTotalSteps(steps: PipelineStep[]): number {
  let count = 0;

  function traverse(stepsToCount: PipelineStep[]): void {
    for (const step of stepsToCount) {
      count++;

      if (step.branches) {
        for (const branch of step.branches) {
          traverse(branch);
        }
      }

      if (step.children) {
        traverse(step.children);
      }
    }
  }

  traverse(steps);
  return count;
}

/**
 * Get pipeline summary for validation context.
 */
export function getPipelineSummary(steps: PipelineStep[]): {
  totalSteps: number;
  enabledSteps: number;
  hasModel: boolean;
  hasSplitter: boolean;
  hasBranch: boolean;
  stepTypes: Set<StepType>;
} {
  let enabledCount = 0;
  const stepTypes = new Set<StepType>();
  let hasModel = false;
  let hasSplitter = false;
  let hasBranch = false;

  function traverse(stepsToCount: PipelineStep[]): void {
    for (const step of stepsToCount) {
      if (step.enabled !== false) {
        enabledCount++;
        stepTypes.add(step.type);

        if (step.type === "model") hasModel = true;
        if (step.type === "splitting") hasSplitter = true;
        if (step.subType === "branch" || step.subType === "generator") hasBranch = true;
      }

      if (step.branches) {
        for (const branch of step.branches) {
          traverse(branch);
        }
      }

      if (step.children) {
        traverse(step.children);
      }
    }
  }

  traverse(steps);

  return {
    totalSteps: countTotalSteps(steps),
    enabledSteps: enabledCount,
    hasModel,
    hasSplitter,
    hasBranch,
    stepTypes,
  };
}

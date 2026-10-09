/**
 * Step Validator
 *
 * Validates individual pipeline steps for structural correctness.
 * Checks container integrity, branch validity, and step-specific rules.
 *
 * @see docs/_internals/implementation_roadmap.md Task 4.3
 */

import i18n from "i18next";
import type { PipelineStep, StepType, StepSubType, FlowStepSubType } from "../types";
import { CONTAINER_CHILDREN_SUBTYPES, CONTAINER_BRANCH_SUBTYPES } from "../types";
import type {
  ValidationIssue,
  ValidationLocation,
  ValidationErrorCode,
  ValidationSeverity,
  ValidationContext,
} from "./types";
import { generateIssueId } from "./types";

// ============================================================================
// Step Validation
// ============================================================================

/**
 * Create a step validation issue.
 */
export function createStepIssue(
  code: ValidationErrorCode,
  severity: ValidationSeverity,
  message: string,
  location: ValidationLocation,
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
    category: "step",
    message,
    location,
    details: options?.details,
    suggestion: options?.suggestion,
    quickFix: options?.quickFix,
  };
}

/**
 * Validate a single step for structural correctness.
 */
export function validateStep(
  step: PipelineStep,
  context: ValidationContext,
  stepIndex?: number
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const location: ValidationLocation = {
    stepId: step.id,
    stepName: step.name,
    stepType: step.type,
    stepIndex,
  };

  // Check for empty/invalid step ID
  if (!step.id) {
    issues.push(
      createStepIssue(
        "STEP_DUPLICATE_ID",
        "error",
        i18n.t("pipelineEditor.validation.step.noId"),
        { ...location, stepId: "unknown" }
      )
    );
  }

  // Check for valid step name
  if (!step.name || step.name.trim() === "") {
    issues.push(
      createStepIssue(
        "STEP_INVALID_NAME",
        "error",
        i18n.t("pipelineEditor.validation.step.noName"),
        location,
        { suggestion: i18n.t("pipelineEditor.validation.step.noNameSuggestion") }
      )
    );
  }

  // Validate container steps have content (using subType)
  if (step.subType && CONTAINER_CHILDREN_SUBTYPES.includes(step.subType as FlowStepSubType)) {
    issues.push(...validateContainerWithChildren(step, location));
  }

  if (step.subType && CONTAINER_BRANCH_SUBTYPES.includes(step.subType as FlowStepSubType)) {
    issues.push(...validateContainerWithBranches(step, location, context));
  }

  // Validate generator steps (subType-based)
  if (step.subType === "generator") {
    issues.push(...validateGeneratorStep(step, location));
  }

  // Validate merge steps (subType-based)
  if (step.subType === "merge") {
    issues.push(...validateMergeStep(step, location, context));
  }

  // Validate model steps
  if (step.type === "model") {
    issues.push(...validateModelStep(step, location));
  }

  // Check for disabled step warning
  if (step.enabled === false) {
    issues.push(
      createStepIssue(
        "STEP_UNKNOWN_TYPE",
        "info",
        i18n.t("pipelineEditor.validation.step.disabled", { name: step.name }),
        location
      )
    );
  }

  return issues;
}

/**
 * Validate container steps that use children array.
 */
function validateContainerWithChildren(
  step: PipelineStep,
  location: ValidationLocation
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!step.children || step.children.length === 0) {
    const typeLabel = getStepTypeLabel(step.type, step.subType);
    issues.push(
      createStepIssue(
        "STEP_EMPTY_CONTAINER",
        "warning",
        i18n.t("pipelineEditor.validation.step.emptyContainer", { type: typeLabel }),
        location,
        {
          details: i18n.t("pipelineEditor.validation.step.emptyContainerDetails", { name: step.name }),
          suggestion: i18n.t("pipelineEditor.validation.step.emptyContainerSuggestion", { name: step.name }),
          quickFix: "add_child",
        }
      )
    );
  }

  return issues;
}

/**
 * Validate container steps that use branches array.
 */
function validateContainerWithBranches(
  step: PipelineStep,
  location: ValidationLocation,
  context: ValidationContext
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!step.branches || step.branches.length === 0) {
    issues.push(
      createStepIssue(
        "STEP_EMPTY_BRANCHES",
        "error",
        i18n.t("pipelineEditor.validation.step.noBranches", { name: step.name }),
        location,
        { suggestion: i18n.t("pipelineEditor.validation.step.noBranchesSuggestion") }
      )
    );
    return issues;
  }

  // Check for empty branches
  const emptyBranches = step.branches
    .map((branch, index) => ({ branch, index }))
    .filter(({ branch }) => branch.length === 0);

  if (emptyBranches.length > 0) {
    const severity = step.subType === "generator" ? "error" : "warning";
    for (const { index } of emptyBranches) {
      issues.push(
        createStepIssue(
          "STEP_EMPTY_BRANCHES",
          severity,
          i18n.t("pipelineEditor.validation.step.emptyBranch", { index: index + 1, name: step.name }),
          { ...location, branchIndex: index },
          {
            suggestion: i18n.t("pipelineEditor.validation.step.emptyBranchSuggestion"),
            quickFix: "remove_branch",
          }
        )
      );
    }
  }

  // Recursively validate nested steps
  for (let branchIndex = 0; branchIndex < step.branches.length; branchIndex++) {
    const branch = step.branches[branchIndex];
    for (let stepIndex = 0; stepIndex < branch.length; stepIndex++) {
      const nestedStep = branch[stepIndex];
      const nestedIssues = validateStep(nestedStep, context, stepIndex);
      // Update location to include branch path
      issues.push(
        ...nestedIssues.map((issue) => ({
          ...issue,
          location: {
            ...issue.location,
            path: [...(issue.location.path || []), `branch-${branchIndex}`],
          },
        }))
      );
    }
  }

  return issues;
}

/**
 * Validate generator step configuration.
 */
function validateGeneratorStep(
  step: PipelineStep,
  location: ValidationLocation
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Check generator kind is set
  if (!step.generatorKind) {
    issues.push(
      createStepIssue(
        "STEP_UNKNOWN_TYPE",
        "warning",
        i18n.t("pipelineEditor.validation.step.generatorNoKind", { name: step.name }),
        location,
        { suggestion: i18n.t("pipelineEditor.validation.step.generatorNoKindSuggestion") }
      )
    );
  }

  // For OR generators, check that branches represent alternatives
  if (step.generatorKind === "or" && step.branches) {
    if (step.branches.length < 2) {
      issues.push(
        createStepIssue(
          "STEP_EMPTY_BRANCHES",
          "warning",
          i18n.t("pipelineEditor.validation.step.orFewAlternatives"),
          location,
          { suggestion: i18n.t("pipelineEditor.validation.step.orFewAlternativesSuggestion") }
        )
      );
    }
  }

  // For Cartesian generators, check stages are set up
  if (step.generatorKind === "cartesian" && step.branches) {
    if (step.branches.length < 2) {
      issues.push(
        createStepIssue(
          "STEP_EMPTY_BRANCHES",
          "warning",
          i18n.t("pipelineEditor.validation.step.cartesianFewStages"),
          location,
          { suggestion: i18n.t("pipelineEditor.validation.step.cartesianFewStagesSuggestion") }
        )
      );
    }
  }

  // Grid generators need at least 1 param dimension
  if (step.generatorKind === "grid" && step.branches) {
    if (step.branches.length < 1) {
      issues.push(
        createStepIssue(
          "STEP_EMPTY_BRANCHES",
          "warning",
          i18n.t("pipelineEditor.validation.step.gridNoDimension"),
          location,
          { suggestion: i18n.t("pipelineEditor.validation.step.gridNoDimensionSuggestion") }
        )
      );
    }
  }

  // Zip generators need at least 2 param lists
  if (step.generatorKind === "zip" && step.branches) {
    if (step.branches.length < 2) {
      issues.push(
        createStepIssue(
          "STEP_EMPTY_BRANCHES",
          "warning",
          i18n.t("pipelineEditor.validation.step.zipFewLists"),
          location,
          { suggestion: i18n.t("pipelineEditor.validation.step.zipFewListsSuggestion") }
        )
      );
    }
  }

  return issues;
}

/**
 * Validate merge step configuration.
 */
function validateMergeStep(
  step: PipelineStep,
  location: ValidationLocation,
  context: ValidationContext
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Check if there's a preceding branch step
  // This is a pipeline-level check but we flag it at step level too
  const stepIndex = context.steps.findIndex((s) => s.id === step.id);
  if (stepIndex === 0) {
    issues.push(
      createStepIssue(
        "STEP_UNKNOWN_TYPE",
        "error",
        i18n.t("pipelineEditor.validation.step.mergeNeedsBranch"),
        location,
        { suggestion: i18n.t("pipelineEditor.validation.step.mergeNeedsBranchSuggestion") }
      )
    );
    return issues;
  }

  // Look for a branch step before this merge
  let foundBranch = false;
  for (let i = stepIndex - 1; i >= 0; i--) {
    const prevStep = context.steps[i];
    if (prevStep.subType === "branch" || prevStep.subType === "generator") {
      foundBranch = true;
      break;
    }
    // If we hit another merge first without a branch, that's fine
    // (nested merges are allowed)
    if (prevStep.subType === "merge") {
      break;
    }
  }

  if (!foundBranch) {
    issues.push(
      createStepIssue(
        "PIPELINE_MERGE_WITHOUT_BRANCH",
        "warning",
        i18n.t("pipelineEditor.validation.step.mergeWithoutBranch"),
        location,
        {
          details: i18n.t("pipelineEditor.validation.step.mergeWithoutBranchDetails"),
          suggestion: i18n.t("pipelineEditor.validation.step.mergeWithoutBranchSuggestion"),
        }
      )
    );
  }

  return issues;
}

/**
 * Validate model step configuration.
 */
function validateModelStep(
  step: PipelineStep,
  location: ValidationLocation
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Check for deprecated models
  const deprecatedModels = ["OldModel", "LegacyPLS"];
  if (deprecatedModels.includes(step.name)) {
    issues.push(
      createStepIssue(
        "COMPAT_DEPRECATED",
        "warning",
        i18n.t("pipelineEditor.validation.step.deprecatedModel", { name: step.name }),
        location,
        { suggestion: i18n.t("pipelineEditor.validation.step.deprecatedModelSuggestion") }
      )
    );
  }

  // Validate finetune configuration if present
  if (step.finetuneConfig?.enabled) {
    if (!step.finetuneConfig.model_params?.length) {
      issues.push(
        createStepIssue(
          "STEP_INVALID_NAME",
          "warning",
          i18n.t("pipelineEditor.validation.step.finetuneNoParams"),
          location,
          { suggestion: i18n.t("pipelineEditor.validation.step.finetuneNoParamsSuggestion") }
        )
      );
    }
  }

  return issues;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get human-readable label for step type.
 */
function getStepTypeLabel(type: StepType, subType?: StepSubType): string {
  // Check subType labels first for finer distinction
  if (subType && i18n.exists(`pipelineEditor.validation.stepType.${subType}`)) {
    return i18n.t(`pipelineEditor.validation.stepType.${subType}`);
  }
  return i18n.exists(`pipelineEditor.validation.stepType.${type}`) ? i18n.t(`pipelineEditor.validation.stepType.${type}`) : type;
}

/**
 * Check all steps for duplicate IDs.
 */
export function findDuplicateStepIds(steps: PipelineStep[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seenIds = new Map<string, number>();

  function collectIds(stepsToCheck: PipelineStep[], path: string[] = []): void {
    for (let i = 0; i < stepsToCheck.length; i++) {
      const step = stepsToCheck[i];

      if (seenIds.has(step.id)) {
        issues.push(
          createStepIssue(
            "STEP_DUPLICATE_ID",
            "error",
            i18n.t("pipelineEditor.validation.step.duplicateId", { id: step.id }),
            {
              stepId: step.id,
              stepName: step.name,
              stepType: step.type,
              stepIndex: i,
              path,
            },
            { details: i18n.t("pipelineEditor.validation.step.duplicateIdDetails") }
          )
        );
      } else {
        seenIds.set(step.id, i);
      }

      // Check branches
      if (step.branches) {
        for (let branchIdx = 0; branchIdx < step.branches.length; branchIdx++) {
          collectIds(step.branches[branchIdx], [...path, `branch-${branchIdx}`]);
        }
      }

      // Check children
      if (step.children) {
        collectIds(step.children, [...path, "children"]);
      }
    }
  }

  collectIds(steps);
  return issues;
}

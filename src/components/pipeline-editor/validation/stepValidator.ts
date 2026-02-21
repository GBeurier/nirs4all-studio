/**
 * Step Validator
 *
 * Validates individual pipeline steps for structural correctness.
 * Checks container integrity, branch validity, and step-specific rules.
 *
 * @see docs/_internals/implementation_roadmap.md Task 4.3
 */

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
        "Step has no ID",
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
        "Step has no name",
        location,
        { suggestion: "Add a name to the step" }
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
        `Step "${step.name}" is disabled and will be skipped`,
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
        `${typeLabel} has no child steps`,
        location,
        {
          details: `Add operators to the ${step.name} container`,
          suggestion: `Drag operators into the ${step.name} container`,
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
        `${step.name} has no branches defined`,
        location,
        { suggestion: "Add at least one branch to the step" }
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
          `Branch ${index + 1} in "${step.name}" is empty`,
          { ...location, branchIndex: index },
          {
            suggestion: "Add steps to the branch or remove it",
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
        `Generator "${step.name}" has no kind specified`,
        location,
        { suggestion: 'Set generator kind to "or" or "cartesian"' }
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
          "OR generator should have at least 2 alternatives",
          location,
          { suggestion: "Add more branches to compare alternatives" }
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
          "Cartesian generator should have at least 2 stages",
          location,
          { suggestion: "Add more stages to generate combinations" }
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
        "Merge step requires a preceding branch step",
        location,
        { suggestion: "Add a Branch step before the Merge step" }
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
        "Merge step has no preceding branch step",
        location,
        {
          details: "Merge steps typically follow Branch or Generator steps",
          suggestion: "Add a Branch step before the Merge",
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
        `Model "${step.name}" is deprecated`,
        location,
        { suggestion: "Consider using a newer model variant" }
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
          "Finetuning is enabled but no parameters are configured",
          location,
          { suggestion: "Add parameters to optimize via finetuning" }
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
  if (subType) {
    const subTypeLabels: Record<string, string> = {
      branch: "Branch",
      merge: "Merge",
      generator: "Generator",
      sample_augmentation: "Sample Augmentation",
      feature_augmentation: "Feature Augmentation",
      sample_filter: "Sample Filter",
      concat_transform: "Concat Transform",
      sequential: "Sequential",
      chart: "Chart",
      comment: "Comment",
    };
    if (subType in subTypeLabels) return subTypeLabels[subType];
  }
  const labels: Record<StepType, string> = {
    preprocessing: "Preprocessing",
    y_processing: "Target Processing",
    splitting: "Splitting",
    model: "Model",
    filter: "Filter",
    augmentation: "Augmentation",
    flow: "Flow Control",
    utility: "Utility",
  };
  return labels[type] || type;
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
            `Duplicate step ID: ${step.id}`,
            {
              stepId: step.id,
              stepName: step.name,
              stepType: step.type,
              stepIndex: i,
              path,
            },
            { details: "Each step must have a unique ID" }
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

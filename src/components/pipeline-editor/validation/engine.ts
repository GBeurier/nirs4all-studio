/**
 * Validation Engine
 *
 * Core validation engine that orchestrates all validators.
 * Produces a unified validation result with all issues.
 *
 * @see docs/_internals/implementation_roadmap.md Phase 4
 */

import type { PipelineStep } from "../types";
import type {
  ValidationContext,
  ValidationIssue,
  PipelineValidationResult,
  StepValidationResult,
  ValidationErrorCode,
} from "./types";
import { createEmptyValidationResult, generateIssueId } from "./types";
import { validateStep, findDuplicateStepIds } from "./stepValidator";
import { validatePipeline } from "./pipelineValidator";
import { validateStepParameters } from "./parameterValidator";
import { getEffectiveSeverity } from "./rules";

// ============================================================================
// Validation Engine
// ============================================================================

/**
 * Validate entire pipeline and produce unified result.
 */
export function validate(
  steps: PipelineStep[],
  options: {
    strictMode?: boolean;
    disabledRules?: ValidationErrorCode[];
    selectedStepId?: string;
  } = {}
): PipelineValidationResult {
  const context: ValidationContext = {
    steps,
    selectedStepId: options.selectedStepId,
    strictMode: options.strictMode ?? false,
    disabledRules: options.disabledRules ?? [],
  };

  const allIssues: ValidationIssue[] = [];

  // Step 1: Check for duplicate IDs
  allIssues.push(...findDuplicateStepIds(steps));

  // Step 2: Validate each step
  const stepIssues = validateAllSteps(steps, context);
  allIssues.push(...stepIssues);

  // Step 3: Validate pipeline structure
  const pipelineIssues = validatePipeline(context);
  allIssues.push(...pipelineIssues);

  // Step 4: Filter out disabled rules
  const filteredIssues = allIssues.filter(
    (issue) => !context.disabledRules?.includes(issue.code)
  );

  // Step 5: Build result
  return createValidationResult(filteredIssues, steps);
}

/**
 * Validate all steps recursively.
 */
function validateAllSteps(
  steps: PipelineStep[],
  context: ValidationContext,
  path: string[] = []
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    // Validate step structure
    const stepIssues = validateStep(step, context, i);

    // Add path context
    const contextualizedIssues = stepIssues.map((issue) => ({
      ...issue,
      location: {
        ...issue.location,
        path: path.length > 0 ? [...path] : undefined,
      },
    }));
    issues.push(...contextualizedIssues);

    // Validate parameters if we have node registry access
    // For now, we'll do basic type checking based on step params
    const paramIssues = validateStepParametersBasic(step);
    issues.push(...paramIssues);

    // Recurse into branches
    if (step.branches) {
      for (let branchIdx = 0; branchIdx < step.branches.length; branchIdx++) {
        const branch = step.branches[branchIdx];
        const branchPath = [...path, `branch-${branchIdx}`];
        const branchIssues = validateAllSteps(branch, context, branchPath);
        issues.push(...branchIssues);
      }
    }

    // Recurse into children
    if (step.children) {
      const childPath = [...path, "children"];
      const childIssues = validateAllSteps(step.children, context, childPath);
      issues.push(...childIssues);
    }
  }

  return issues;
}

/**
 * Basic parameter validation without registry.
 * Used when node registry is not available.
 */
function validateStepParametersBasic(step: PipelineStep): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Guard against null/undefined params
  if (!step.params || typeof step.params !== "object") {
    return issues;
  }

  // Check for NaN values
  for (const [key, value] of Object.entries(step.params)) {
    if (typeof value === "number" && Number.isNaN(value)) {
      issues.push({
        id: generateIssueId(),
        code: "PARAM_INVALID_VALUE",
        severity: "error",
        category: "parameter",
        message: `Parameter "${key}" has invalid value: NaN`,
        location: {
          stepId: step.id,
          stepName: step.name,
          stepType: step.type,
          paramName: key,
        },
        suggestion: "Enter a valid numeric value",
      });
    }

    // Check for Infinity
    if (typeof value === "number" && !Number.isFinite(value)) {
      issues.push({
        id: generateIssueId(),
        code: "PARAM_OUT_OF_RANGE",
        severity: "error",
        category: "parameter",
        message: `Parameter "${key}" has invalid value: Infinity`,
        location: {
          stepId: step.id,
          stepName: step.name,
          stepType: step.type,
          paramName: key,
        },
        suggestion: "Enter a finite numeric value",
      });
    }
  }

  // Model-specific validation
  if (step.type === "model") {
    // Check n_components for PLS-like models
    const nComponents = step.params.n_components;
    if (typeof nComponents === "number") {
      if (nComponents < 1) {
        issues.push({
          id: generateIssueId(),
          code: "PARAM_OUT_OF_RANGE",
          severity: "error",
          category: "parameter",
          message: "n_components must be at least 1",
          location: {
            stepId: step.id,
            stepName: step.name,
            stepType: step.type,
            paramName: "n_components",
          },
        });
      }
      if (nComponents > 100) {
        issues.push({
          id: generateIssueId(),
          code: "PARAM_OUT_OF_RANGE",
          severity: "warning",
          category: "parameter",
          message: "n_components is unusually high (>100)",
          location: {
            stepId: step.id,
            stepName: step.name,
            stepType: step.type,
            paramName: "n_components",
          },
          suggestion: "Consider using fewer components to avoid overfitting",
        });
      }
    }
  }

  // Splitting validation
  if (step.type === "splitting") {
    const testSize = step.params.test_size;
    if (typeof testSize === "number") {
      if (testSize <= 0 || testSize >= 1) {
        issues.push({
          id: generateIssueId(),
          code: "PARAM_OUT_OF_RANGE",
          severity: "error",
          category: "parameter",
          message: "test_size must be between 0 and 1 (exclusive)",
          location: {
            stepId: step.id,
            stepName: step.name,
            stepType: step.type,
            paramName: "test_size",
          },
        });
      }
    }

    const nSplits = step.params.n_splits;
    if (typeof nSplits === "number" && nSplits < 2) {
      issues.push({
        id: generateIssueId(),
        code: "PARAM_OUT_OF_RANGE",
        severity: "error",
        category: "parameter",
        message: "n_splits must be at least 2",
        location: {
          stepId: step.id,
          stepName: step.name,
          stepType: step.type,
          paramName: "n_splits",
        },
      });
    }
  }

  // Preprocessing validation (example: SavitzkyGolay)
  if (step.name === "SavitzkyGolay") {
    const windowLength = step.params.window_length;
    const polyorder = step.params.polyorder;

    if (typeof windowLength === "number" && windowLength < 3) {
      issues.push({
        id: generateIssueId(),
        code: "PARAM_OUT_OF_RANGE",
        severity: "error",
        category: "parameter",
        message: "window_length must be at least 3",
        location: {
          stepId: step.id,
          stepName: step.name,
          stepType: step.type,
          paramName: "window_length",
        },
      });
    }

    if (typeof windowLength === "number" && windowLength % 2 === 0) {
      issues.push({
        id: generateIssueId(),
        code: "PARAM_INVALID_VALUE",
        severity: "error",
        category: "parameter",
        message: "window_length must be odd",
        location: {
          stepId: step.id,
          stepName: step.name,
          stepType: step.type,
          paramName: "window_length",
        },
        suggestion: `Use ${(windowLength as number) + 1} instead`,
      });
    }

    if (
      typeof polyorder === "number" &&
      typeof windowLength === "number" &&
      polyorder >= windowLength
    ) {
      issues.push({
        id: generateIssueId(),
        code: "PARAM_INVALID_VALUE",
        severity: "error",
        category: "parameter",
        message: "polyorder must be less than window_length",
        location: {
          stepId: step.id,
          stepName: step.name,
          stepType: step.type,
          paramName: "polyorder",
        },
      });
    }
  }

  return issues;
}

/**
 * Create a validation result from a list of issues.
 */
export function createValidationResult(
  issues: ValidationIssue[],
  steps: PipelineStep[]
): PipelineValidationResult {
  // Separate by severity
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const infos = issues.filter((i) => i.severity === "info");

  // Build per-step results
  const stepResults = new Map<string, StepValidationResult>();

  // Initialize with all steps
  function initStepResults(stepsToInit: PipelineStep[]): void {
    for (const step of stepsToInit) {
      stepResults.set(step.id, {
        stepId: step.id,
        stepName: step.name,
        stepType: step.type,
        isValid: true,
        errors: [],
        warnings: [],
        infos: [],
      });

      if (step.branches) {
        for (const branch of step.branches) {
          initStepResults(branch);
        }
      }

      if (step.children) {
        initStepResults(step.children);
      }
    }
  }

  initStepResults(steps);

  // Assign issues to steps
  for (const issue of issues) {
    const stepId = issue.location.stepId;
    if (stepId) {
      const stepResult = stepResults.get(stepId);
      if (stepResult) {
        switch (issue.severity) {
          case "error":
            stepResult.errors.push(issue);
            stepResult.isValid = false;
            break;
          case "warning":
            stepResult.warnings.push(issue);
            break;
          case "info":
            stepResult.infos.push(issue);
            break;
        }
      }
    }
  }

  // Calculate summary
  let stepsWithErrors = 0;
  let stepsWithWarnings = 0;
  for (const result of stepResults.values()) {
    if (result.errors.length > 0) stepsWithErrors++;
    if (result.warnings.length > 0) stepsWithWarnings++;
  }

  return {
    isValid: errors.length === 0,
    timestamp: Date.now(),
    issues,
    errors,
    warnings,
    infos,
    stepResults,
    summary: {
      errorCount: errors.length,
      warningCount: warnings.length,
      infoCount: infos.length,
      stepsWithErrors,
      stepsWithWarnings,
      totalSteps: stepResults.size,
    },
  };
}

// ============================================================================
// Quick Validation
// ============================================================================

/**
 * Quick check if pipeline is valid (no errors).
 */
export function isValid(steps: PipelineStep[]): boolean {
  const result = validate(steps);
  return result.isValid;
}

/**
 * Get error count without full validation.
 */
export function getErrorCount(steps: PipelineStep[]): number {
  const result = validate(steps);
  return result.summary.errorCount;
}

/**
 * Get quick summary of pipeline validity.
 */
export function getQuickSummary(steps: PipelineStep[]): {
  isValid: boolean;
  errors: number;
  warnings: number;
} {
  const result = validate(steps);
  return {
    isValid: result.isValid,
    errors: result.summary.errorCount,
    warnings: result.summary.warningCount,
  };
}

/**
 * Parameter Schema Validator
 *
 * Validates parameter values against node definitions.
 * Handles type checking, range validation, required fields, and patterns.
 *
 * @see docs/_internals/implementation_roadmap.md Task 4.2
 */

import i18n from "i18next";
import type { ParameterDefinition } from "@/data/nodes/types";
import type { PipelineStep } from "../types";
import type {
  ValidationIssue,
  ValidationLocation,
  ValidationErrorCode,
  ValidationSeverity,
} from "./types";
import { generateIssueId } from "./types";

// ============================================================================
// Parameter Validation
// ============================================================================

/**
 * Create a parameter validation issue.
 */
export function createParameterIssue(
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
    category: "parameter",
    message,
    location,
    details: options?.details,
    suggestion: options?.suggestion,
    quickFix: options?.quickFix,
  };
}

/**
 * Validate a single parameter value against its definition.
 */
export function validateParameter(
  paramName: string,
  value: unknown,
  definition: ParameterDefinition,
  step: PipelineStep
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const location: ValidationLocation = {
    stepId: step.id,
    stepName: step.name,
    stepType: step.type,
    paramName,
  };

  // Check required
  if (definition.required) {
    if (value === undefined || value === null || value === "") {
      issues.push(
        createParameterIssue(
          "PARAM_REQUIRED",
          "error",
          i18n.t("pipelineEditor.validation.param.required", { label: getParamLabel(definition) }),
          location,
          {
            suggestion: i18n.t("pipelineEditor.validation.param.requiredSuggestion", { label: getParamLabel(definition) }),
          }
        )
      );
      // Skip further validation if required value is missing
      return issues;
    }
  }

  // Skip validation for undefined/null non-required params
  if (value === undefined || value === null) {
    return issues;
  }

  // Type validation
  const typeIssues = validateParameterType(value, definition, location);
  issues.push(...typeIssues);

  // If type is wrong, skip further validation
  if (typeIssues.some((i) => i.code === "PARAM_TYPE_MISMATCH")) {
    return issues;
  }

  // Range validation for numeric types
  if (definition.type === "int" || definition.type === "float") {
    issues.push(...validateNumericRange(value as number, definition, location));
  }

  // Length validation for strings and arrays
  if (definition.type === "string") {
    issues.push(...validateStringConstraints(value as string, definition, location));
  }

  if (definition.type === "array") {
    issues.push(...validateArrayConstraints(value as unknown[], definition, location));
  }

  // Select validation
  if (definition.type === "select") {
    issues.push(...validateSelectValue(value, definition, location));
  }

  return issues;
}

/**
 * Validate parameter type matches definition.
 */
function validateParameterType(
  value: unknown,
  definition: ParameterDefinition,
  location: ValidationLocation
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const expectedType = definition.type;
  const actualType = typeof value;

  switch (expectedType) {
    case "int":
      if (typeof value !== "number" || !Number.isInteger(value)) {
        issues.push(
          createParameterIssue(
            "PARAM_TYPE_MISMATCH",
            "error",
            i18n.t("pipelineEditor.validation.param.expectedInt", { actual: actualType }),
            location,
            {
              details: i18n.t("pipelineEditor.validation.param.expectedIntDetails", { value: String(value) }),
              suggestion: i18n.t("pipelineEditor.validation.param.expectedIntSuggestion"),
            }
          )
        );
      }
      break;

    case "float":
      if (typeof value !== "number" || Number.isNaN(value)) {
        issues.push(
          createParameterIssue(
            "PARAM_TYPE_MISMATCH",
            "error",
            i18n.t("pipelineEditor.validation.param.expectedNumber", { actual: actualType }),
            location,
            {
              details: i18n.t("pipelineEditor.validation.param.expectedNumberDetails", { value: String(value) }),
              suggestion: i18n.t("pipelineEditor.validation.param.expectedNumberSuggestion"),
            }
          )
        );
      }
      break;

    case "bool":
      if (typeof value !== "boolean") {
        issues.push(
          createParameterIssue(
            "PARAM_TYPE_MISMATCH",
            "error",
            i18n.t("pipelineEditor.validation.param.expectedBoolean", { actual: actualType }),
            location
          )
        );
      }
      break;

    case "string":
      if (typeof value !== "string") {
        issues.push(
          createParameterIssue(
            "PARAM_TYPE_MISMATCH",
            "error",
            i18n.t("pipelineEditor.validation.param.expectedString", { actual: actualType }),
            location
          )
        );
      }
      break;

    case "array":
      if (!Array.isArray(value)) {
        issues.push(
          createParameterIssue(
            "PARAM_TYPE_MISMATCH",
            "error",
            i18n.t("pipelineEditor.validation.param.expectedArray", { actual: actualType }),
            location
          )
        );
      }
      break;

    case "object":
      if (typeof value !== "object" || Array.isArray(value) || value === null) {
        issues.push(
          createParameterIssue(
            "PARAM_TYPE_MISMATCH",
            "error",
            i18n.t("pipelineEditor.validation.param.expectedObject", { actual: actualType }),
            location
          )
        );
      }
      break;

    case "select":
      // Select accepts various types, validation is done in validateSelectValue
      break;
  }

  return issues;
}

/**
 * Validate numeric value is within range.
 */
function validateNumericRange(
  value: number,
  definition: ParameterDefinition,
  location: ValidationLocation
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const paramLabel = getParamLabel(definition);

  if (definition.min !== undefined && value < definition.min) {
    issues.push(
      createParameterIssue(
        "PARAM_OUT_OF_RANGE",
        "error",
        i18n.t("pipelineEditor.validation.param.min", { label: paramLabel, min: definition.min }),
        location,
        {
          details: i18n.t("pipelineEditor.validation.param.minDetails", { value, min: definition.min }),
          suggestion: i18n.t("pipelineEditor.validation.param.minSuggestion", { min: definition.min }),
          quickFix: "set_min",
        }
      )
    );
  }

  if (definition.max !== undefined && value > definition.max) {
    issues.push(
      createParameterIssue(
        "PARAM_OUT_OF_RANGE",
        "error",
        i18n.t("pipelineEditor.validation.param.max", { label: paramLabel, max: definition.max }),
        location,
        {
          details: i18n.t("pipelineEditor.validation.param.maxDetails", { value, max: definition.max }),
          suggestion: i18n.t("pipelineEditor.validation.param.maxSuggestion", { max: definition.max }),
          quickFix: "set_max",
        }
      )
    );
  }

  // Validate step constraint (for UI enforcement)
  if (definition.type === "int" && definition.step !== undefined) {
    const remainder = value % definition.step;
    if (remainder !== 0) {
      issues.push(
        createParameterIssue(
          "PARAM_INVALID_VALUE",
          "warning",
          i18n.t("pipelineEditor.validation.param.multiple", { label: paramLabel, step: definition.step }),
          location,
          {
            details: i18n.t("pipelineEditor.validation.param.multipleDetails", { value }),
            suggestion: i18n.t("pipelineEditor.validation.param.multipleSuggestion", { value: Math.round(value / definition.step) * definition.step }),
          }
        )
      );
    }
  }

  return issues;
}

/**
 * Validate string constraints.
 */
function validateStringConstraints(
  value: string,
  definition: ParameterDefinition,
  location: ValidationLocation
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const paramLabel = getParamLabel(definition);

  if (definition.minLength !== undefined && value.length < definition.minLength) {
    issues.push(
      createParameterIssue(
        "PARAM_LENGTH_EXCEEDED",
        "error",
        i18n.t("pipelineEditor.validation.param.stringMinLength", { label: paramLabel, count: definition.minLength }),
        location,
        {
          details: i18n.t("pipelineEditor.validation.param.currentLength", { length: value.length }),
        }
      )
    );
  }

  if (definition.maxLength !== undefined && value.length > definition.maxLength) {
    issues.push(
      createParameterIssue(
        "PARAM_LENGTH_EXCEEDED",
        "error",
        i18n.t("pipelineEditor.validation.param.stringMaxLength", { label: paramLabel, count: definition.maxLength }),
        location,
        {
          details: i18n.t("pipelineEditor.validation.param.currentLength", { length: value.length }),
        }
      )
    );
  }

  if (definition.pattern) {
    const regex = new RegExp(definition.pattern);
    if (!regex.test(value)) {
      issues.push(
        createParameterIssue(
          "PARAM_PATTERN_MISMATCH",
          "error",
          i18n.t("pipelineEditor.validation.param.patternMismatch", { label: paramLabel }),
          location,
          {
            details: i18n.t("pipelineEditor.validation.param.patternMismatchDetails", { value, pattern: definition.pattern }),
          }
        )
      );
    }
  }

  return issues;
}

/**
 * Validate array constraints.
 */
function validateArrayConstraints(
  value: unknown[],
  definition: ParameterDefinition,
  location: ValidationLocation
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const paramLabel = getParamLabel(definition);

  if (definition.minLength !== undefined && value.length < definition.minLength) {
    issues.push(
      createParameterIssue(
        "PARAM_LENGTH_EXCEEDED",
        "error",
        i18n.t("pipelineEditor.validation.param.arrayMinLength", { label: paramLabel, count: definition.minLength }),
        location,
        {
          details: i18n.t("pipelineEditor.validation.param.currentCount", { length: value.length }),
        }
      )
    );
  }

  if (definition.maxLength !== undefined && value.length > definition.maxLength) {
    issues.push(
      createParameterIssue(
        "PARAM_LENGTH_EXCEEDED",
        "error",
        i18n.t("pipelineEditor.validation.param.arrayMaxLength", { label: paramLabel, count: definition.maxLength }),
        location,
        {
          details: i18n.t("pipelineEditor.validation.param.currentCount", { length: value.length }),
        }
      )
    );
  }

  return issues;
}

/**
 * Validate select value is in options.
 */
function validateSelectValue(
  value: unknown,
  definition: ParameterDefinition,
  location: ValidationLocation
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Skip if no options defined or allowCustom is true
  if (!definition.options || definition.allowCustom) {
    return issues;
  }

  const validValues = definition.options.map((opt) => opt.value);
  if (!validValues.includes(value as string | number | boolean)) {
    const paramLabel = getParamLabel(definition);
    issues.push(
      createParameterIssue(
        "PARAM_INVALID_VALUE",
        "error",
        i18n.t("pipelineEditor.validation.param.invalidOption", { value: String(value), label: paramLabel }),
        location,
        {
          details: i18n.t("pipelineEditor.validation.param.validOptions", { options: validValues.join(", ") }),
          suggestion: i18n.t("pipelineEditor.validation.param.chooseFrom", { options: definition.options.map((o) => o.label).join(", ") }),
        }
      )
    );
  }

  return issues;
}

// ============================================================================
// Batch Validation
// ============================================================================

/**
 * Validate all parameters of a step against their definitions.
 */
export function validateStepParameters(
  step: PipelineStep,
  parameterDefs: ParameterDefinition[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const def of parameterDefs) {
    // Skip hidden parameters
    if (def.isHidden) {
      continue;
    }

    // Check for conditional visibility
    if (def.dependsOn) {
      const dependentValue = step.params[def.dependsOn];
      if (def.dependsOnValue !== undefined) {
        const matches = Array.isArray(def.dependsOnValue)
          ? (def.dependsOnValue as unknown[]).includes(dependentValue)
          : dependentValue === def.dependsOnValue;
        if (!matches) {
          // This parameter is conditionally hidden, skip validation
          continue;
        }
      }
    }

    const value = step.params[def.name];
    const paramIssues = validateParameter(def.name, value, def, step);
    issues.push(...paramIssues);
  }

  return issues;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get the display label for a parameter.
 */
function getParamLabel(definition: ParameterDefinition): string {
  if (definition.label) {
    return definition.label;
  }
  // Humanize the name: snake_case -> Title Case
  return definition.name
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Quick validation check for a parameter (returns true if valid).
 */
export function isParameterValid(
  paramName: string,
  value: unknown,
  definition: ParameterDefinition,
  step: PipelineStep
): boolean {
  const issues = validateParameter(paramName, value, definition, step);
  return issues.filter((i) => i.severity === "error").length === 0;
}

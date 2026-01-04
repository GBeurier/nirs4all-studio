/**
 * Validation Rules Configuration
 *
 * Defines all validation rules with metadata for UI display and configuration.
 * Rules can be enabled/disabled and their severity can be customized.
 *
 * @see docs/_internals/implementation_roadmap.md Task 4.4
 */

import type {
  ValidationRule,
  ValidationErrorCode,
  ValidationSeverity,
  ValidationCategory,
} from "./types";

// ============================================================================
// Validation Rules Registry
// ============================================================================

/**
 * All validation rules organized by category.
 */
export const VALIDATION_RULES: readonly ValidationRule[] = [
  // -------------------------------------------------------------------------
  // Parameter Validation Rules
  // -------------------------------------------------------------------------
  {
    code: "PARAM_REQUIRED",
    severity: "error",
    category: "parameter",
    name: "Required Parameter",
    description: "Validates that required parameters have a value",
    canDisable: false,
    defaultEnabled: true,
  },
  {
    code: "PARAM_TYPE_MISMATCH",
    severity: "error",
    category: "parameter",
    name: "Type Mismatch",
    description: "Validates that parameter values match their expected type",
    canDisable: false,
    defaultEnabled: true,
  },
  {
    code: "PARAM_OUT_OF_RANGE",
    severity: "error",
    category: "parameter",
    name: "Out of Range",
    description: "Validates that numeric values are within min/max bounds",
    canDisable: false,
    defaultEnabled: true,
  },
  {
    code: "PARAM_INVALID_VALUE",
    severity: "error",
    category: "parameter",
    name: "Invalid Value",
    description: "Validates that values are valid for the parameter",
    canDisable: true,
    defaultEnabled: true,
  },
  {
    code: "PARAM_PATTERN_MISMATCH",
    severity: "error",
    category: "parameter",
    name: "Pattern Mismatch",
    description: "Validates that string values match the expected pattern",
    canDisable: true,
    defaultEnabled: true,
  },
  {
    code: "PARAM_LENGTH_EXCEEDED",
    severity: "error",
    category: "parameter",
    name: "Length Exceeded",
    description: "Validates that string/array values are within length constraints",
    canDisable: true,
    defaultEnabled: true,
  },

  // -------------------------------------------------------------------------
  // Step Validation Rules
  // -------------------------------------------------------------------------
  {
    code: "STEP_UNKNOWN_TYPE",
    severity: "warning",
    category: "step",
    name: "Unknown Step Type",
    description: "Flags steps with unrecognized types",
    canDisable: true,
    defaultEnabled: true,
  },
  {
    code: "STEP_INVALID_NAME",
    severity: "error",
    category: "step",
    name: "Invalid Step Name",
    description: "Validates that steps have valid names",
    canDisable: false,
    defaultEnabled: true,
  },
  {
    code: "STEP_DUPLICATE_ID",
    severity: "error",
    category: "step",
    name: "Duplicate Step ID",
    description: "Checks for steps with the same ID",
    canDisable: false,
    defaultEnabled: true,
  },
  {
    code: "STEP_EMPTY_CONTAINER",
    severity: "warning",
    category: "step",
    name: "Empty Container",
    description: "Flags container steps without children",
    canDisable: true,
    defaultEnabled: true,
  },
  {
    code: "STEP_EMPTY_BRANCHES",
    severity: "warning",
    category: "step",
    name: "Empty Branches",
    description: "Flags branch/generator steps with empty branches",
    canDisable: true,
    defaultEnabled: true,
  },

  // -------------------------------------------------------------------------
  // Pipeline Structure Rules
  // -------------------------------------------------------------------------
  {
    code: "PIPELINE_NO_MODEL",
    severity: "warning",
    category: "pipeline",
    name: "No Model",
    description: "Flags pipelines without a model step",
    canDisable: true,
    defaultEnabled: true,
  },
  {
    code: "PIPELINE_NO_SPLITTER",
    severity: "info",
    category: "pipeline",
    name: "No Splitter",
    description: "Flags pipelines without a cross-validation splitter",
    canDisable: true,
    defaultEnabled: true,
  },
  {
    code: "PIPELINE_EMPTY",
    severity: "info",
    category: "pipeline",
    name: "Empty Pipeline",
    description: "Flags pipelines with no steps",
    canDisable: true,
    defaultEnabled: true,
  },
  {
    code: "PIPELINE_MODEL_BEFORE_SPLITTER",
    severity: "warning",
    category: "pipeline",
    name: "Model Before Splitter",
    description: "Flags when model appears before the splitter step",
    canDisable: true,
    defaultEnabled: true,
  },
  {
    code: "PIPELINE_MERGE_WITHOUT_BRANCH",
    severity: "error",
    category: "pipeline",
    name: "Merge Without Branch",
    description: "Flags merge steps without a corresponding branch",
    canDisable: false,
    defaultEnabled: true,
  },
  {
    code: "PIPELINE_MULTIPLE_MODELS",
    severity: "info",
    category: "pipeline",
    name: "Multiple Models",
    description: "Notes when multiple models are present at root level",
    canDisable: true,
    defaultEnabled: true,
  },

  // -------------------------------------------------------------------------
  // Dependency Rules
  // -------------------------------------------------------------------------
  {
    code: "DEP_INVALID_ORDER",
    severity: "warning",
    category: "dependency",
    name: "Invalid Step Order",
    description: "Flags suspicious step ordering (e.g., preprocessing after model)",
    canDisable: true,
    defaultEnabled: true,
  },
  {
    code: "DEP_MISSING_PREREQUISITE",
    severity: "error",
    category: "dependency",
    name: "Missing Prerequisite",
    description: "Flags steps that require a prerequisite that is missing",
    canDisable: false,
    defaultEnabled: true,
  },
  {
    code: "DEP_CIRCULAR_REFERENCE",
    severity: "error",
    category: "dependency",
    name: "Circular Reference",
    description: "Flags circular dependencies between steps",
    canDisable: false,
    defaultEnabled: true,
  },

  // -------------------------------------------------------------------------
  // Compatibility Rules
  // -------------------------------------------------------------------------
  {
    code: "COMPAT_DEPRECATED",
    severity: "warning",
    category: "compatibility",
    name: "Deprecated Operator",
    description: "Flags operators that are deprecated",
    canDisable: true,
    defaultEnabled: true,
  },
  {
    code: "COMPAT_VERSION_MISMATCH",
    severity: "warning",
    category: "compatibility",
    name: "Version Mismatch",
    description: "Flags operators that require a different nirs4all version",
    canDisable: true,
    defaultEnabled: true,
  },
  {
    code: "COMPAT_UNKNOWN_CLASS",
    severity: "warning",
    category: "compatibility",
    name: "Unknown Class",
    description: "Flags operators with unknown class paths",
    canDisable: true,
    defaultEnabled: true,
  },
] as const;

// ============================================================================
// Rule Lookup Functions
// ============================================================================

/**
 * Get a rule by its error code.
 */
export function getRuleByCode(code: ValidationErrorCode): ValidationRule | undefined {
  return VALIDATION_RULES.find((rule) => rule.code === code);
}

/**
 * Get all rules in a category.
 */
export function getRulesByCategory(category: ValidationCategory): ValidationRule[] {
  return VALIDATION_RULES.filter((rule) => rule.category === category);
}

/**
 * Get all rules that can be disabled.
 */
export function getDisableableRules(): ValidationRule[] {
  return VALIDATION_RULES.filter((rule) => rule.canDisable);
}

/**
 * Get all rules that are enabled by default.
 */
export function getDefaultEnabledRules(): ValidationRule[] {
  return VALIDATION_RULES.filter((rule) => rule.defaultEnabled);
}

/**
 * Get all rules with a specific severity.
 */
export function getRulesBySeverity(severity: ValidationSeverity): ValidationRule[] {
  return VALIDATION_RULES.filter((rule) => rule.severity === severity);
}

// ============================================================================
// Rule Severity Customization
// ============================================================================

/**
 * Default severity overrides (can be configured by user).
 */
export const DEFAULT_SEVERITY_OVERRIDES: Partial<Record<ValidationErrorCode, ValidationSeverity>> = {
  // Example: treat info as warning
  // PIPELINE_NO_SPLITTER: "warning",
};

/**
 * Apply severity overrides to get effective severity.
 */
export function getEffectiveSeverity(
  code: ValidationErrorCode,
  overrides: Partial<Record<ValidationErrorCode, ValidationSeverity>> = {}
): ValidationSeverity {
  const override = overrides[code] ?? DEFAULT_SEVERITY_OVERRIDES[code];
  if (override) {
    return override;
  }
  const rule = getRuleByCode(code);
  return rule?.severity ?? "info";
}

// ============================================================================
// Rule Categories Metadata
// ============================================================================

/**
 * Category metadata for UI display.
 */
export const CATEGORY_METADATA: Record<
  ValidationCategory,
  {
    label: string;
    description: string;
    icon: string;
    order: number;
  }
> = {
  parameter: {
    label: "Parameter",
    description: "Parameter value validation",
    icon: "Settings",
    order: 1,
  },
  step: {
    label: "Step",
    description: "Individual step validation",
    icon: "Layers",
    order: 2,
  },
  pipeline: {
    label: "Pipeline",
    description: "Pipeline structure validation",
    icon: "GitBranch",
    order: 3,
  },
  dependency: {
    label: "Dependencies",
    description: "Step dependencies and ordering",
    icon: "Link",
    order: 4,
  },
  compatibility: {
    label: "Compatibility",
    description: "nirs4all compatibility checks",
    icon: "Shield",
    order: 5,
  },
};

// ============================================================================
// Severity Metadata
// ============================================================================

/**
 * Severity metadata for UI display.
 */
export const SEVERITY_METADATA: Record<
  ValidationSeverity,
  {
    label: string;
    description: string;
    icon: string;
    color: string;
    bgColor: string;
    borderColor: string;
  }
> = {
  error: {
    label: "Error",
    description: "Must be fixed before running pipeline",
    icon: "AlertCircle",
    color: "text-destructive",
    bgColor: "bg-destructive/10",
    borderColor: "border-destructive/30",
  },
  warning: {
    label: "Warning",
    description: "May cause issues, should be reviewed",
    icon: "AlertTriangle",
    color: "text-orange-500",
    bgColor: "bg-orange-500/10",
    borderColor: "border-orange-500/30",
  },
  info: {
    label: "Info",
    description: "Informational, optional improvement",
    icon: "Info",
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
  },
};

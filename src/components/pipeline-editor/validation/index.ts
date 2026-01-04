/**
 * Validation System
 *
 * Multi-level validation for pipeline editor with clear error reporting.
 * Provides parameter, step, and pipeline-level validation.
 *
 * @see docs/_internals/implementation_roadmap.md Phase 4
 *
 * @example
 * ```tsx
 * import { useValidation, ValidationPanel, ValidationStatusButton } from './validation';
 *
 * function PipelineEditor() {
 *   const { result, isValid, validateNow, isValidating } = useValidation(steps);
 *
 *   return (
 *     <>
 *       <ValidationStatusButton result={result} isValidating={isValidating} />
 *       <ValidationPanel result={result} onNavigate={handleNavigate} />
 *     </>
 *   );
 * }
 * ```
 */

// Types
export type {
  ValidationSeverity,
  ValidationCategory,
  ValidationErrorCode,
  ValidationLocation,
  ValidationIssue,
  ValidationContext as ValidationContextType,  // Renamed to avoid conflict with React context
  StepValidationResult,
  PipelineValidationResult,
  Validator,
  ParameterValidator,
  StepValidator,
  PipelineValidator,
  ValidationRule,
  QuickFix,
  ValidationState,
} from "./types";

export {
  initialValidationState,
  generateIssueId,
  createEmptyValidationResult,
  hasSeverity,
  getStepIssues,
  getParameterIssues,
} from "./types";

// Validators
export { validateParameter, createParameterIssue, validateStepParameters, isParameterValid } from "./parameterValidator";
export { validateStep, createStepIssue, findDuplicateStepIds } from "./stepValidator";
export { validatePipeline, createPipelineIssue, countTotalSteps, getPipelineSummary } from "./pipelineValidator";

// Validation Rules
export {
  VALIDATION_RULES,
  getRuleByCode,
  getRulesByCategory,
  getDisableableRules,
  getDefaultEnabledRules,
  getRulesBySeverity,
  getEffectiveSeverity,
  CATEGORY_METADATA,
  SEVERITY_METADATA,
} from "./rules";

// Core validation engine
export { validate, createValidationResult, isValid, getErrorCount, getQuickSummary } from "./engine";

// React integration
export { useValidation, useParameterValidation, useStepValidation } from "./useValidation";
export type { UseValidationOptions, UseValidationReturn } from "./useValidation";
export {
  useInlineValidation,
  useStepInlineValidation,
  useParameterMessages,
} from "./useInlineValidation";
export type {
  InlineValidationResult,
  StepValidationResult as StepInlineValidationResult,
} from "./useInlineValidation";
export {
  ValidationContext,
  useValidationContext,
  useOptionalValidationContext,
  ValidationProvider,
} from "./ValidationContext";
export type { ValidationContextValue, ValidationProviderProps } from "./ValidationContext";

// UI Components
export { ValidationPanel } from "./ValidationPanel";
export type { ValidationPanelProps } from "./ValidationPanel";
export { ValidationStatusButton, ValidationStatusIndicator } from "./ValidationStatusButton";
export type { ValidationStatusButtonProps, ValidationStatusIndicatorProps } from "./ValidationStatusButton";
export { ValidationSummaryDialog, useValidationBeforeExport } from "./ValidationSummaryDialog";
export type { ValidationSummaryDialogProps, UseValidationBeforeExportOptions } from "./ValidationSummaryDialog";
export { ValidatePipelineButton, ValidatePipelineIconButton } from "./ValidatePipelineButton";
export type { ValidatePipelineButtonProps } from "./ValidatePipelineButton";
export {
  ValidationOverlay,
  ValidationBadge,
  ValidationIndicator,
  ValidationDot,
} from "./ValidationOverlay";
export type {
  ValidationOverlayProps,
  ValidationBadgeProps,
  ValidationIndicatorProps,
  ValidationDotProps,
} from "./ValidationOverlay";

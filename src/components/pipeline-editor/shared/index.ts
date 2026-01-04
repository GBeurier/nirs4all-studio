/**
 * Pipeline Editor Shared Components Library
 *
 * This module exports reusable UI patterns extracted from the pipeline editor
 * to improve maintainability, reduce duplication, and enable easier testing.
 *
 * Phase 1 Implementation - Foundation
 * @see docs/_internals/implementation_roadmap.md
 */

// Parameter input components
export { ParameterInput } from "./ParameterInput";
export type { ParameterInputProps, ParameterValue } from "./ParameterInput";

export { ParameterSelect } from "./ParameterSelect";
export type { ParameterSelectProps, SelectOptionDef, SelectOption, SelectOptionValue } from "./ParameterSelect";

export { ParameterSwitch } from "./ParameterSwitch";
export type { ParameterSwitchProps } from "./ParameterSwitch";

// UI patterns
export { CollapsibleSection } from "./CollapsibleSection";
export type { CollapsibleSectionProps } from "./CollapsibleSection";

export { InfoTooltip } from "./InfoTooltip";
export type { InfoTooltipProps } from "./InfoTooltip";

export { ValidationMessage, InlineValidationMessage } from "./ValidationMessage";
export type { ValidationMessageProps, InlineValidationMessageProps, ValidationSeverity } from "./ValidationMessage";

// Hooks
export { useParamInput, parameterInfo } from "./useParamInput";

// Utilities
export { formatParamLabel } from "./ParameterInput";

// Demo component for visual testing (not for production use)
export { SharedComponentsDemo } from "./demo";


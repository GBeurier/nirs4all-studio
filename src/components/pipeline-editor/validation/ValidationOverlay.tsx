/**
 * ValidationOverlay - Visual validation indicators for step cards
 *
 * Provides overlay components that show error/warning badges directly
 * on step cards in the pipeline tree, making validation issues
 * immediately visible without opening panels.
 *
 * Features:
 * - Compact badge showing error/warning counts
 * - Hover tooltip with issue summary
 * - Click to navigate/expand
 * - Severity-based coloring (red for errors, orange for warnings)
 *
 * @example
 * ```tsx
 * // On a step card:
 * <div className="relative">
 *   <StepCard step={step} />
 *   <ValidationOverlay stepId={step.id} />
 * </div>
 *
 * // Or use the badge inline:
 * <StepCard step={step}>
 *   <ValidationBadge stepId={step.id} />
 * </StepCard>
 * ```
 */

import React from "react";
import { AlertCircle, AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useStepValidation } from "./useValidation";
import { useOptionalValidationContext } from "./ValidationContext";
import type { PipelineValidationResult, ValidationIssue } from "./types";

// ============================================================================
// Types
// ============================================================================

export interface ValidationOverlayProps {
  /** Step ID to show validation for */
  stepId: string;
  /** Position of the overlay badge */
  position?: "top-right" | "top-left" | "bottom-right" | "bottom-left";
  /** Whether to show when there are no issues */
  showWhenValid?: boolean;
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Callback when clicked */
  onClick?: (stepId: string, issues: ValidationIssue[]) => void;
  /** Additional class name */
  className?: string;
}

export interface ValidationBadgeProps {
  /** Step ID to show validation for */
  stepId: string;
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Whether to show labels */
  showLabel?: boolean;
  /** Callback when clicked */
  onClick?: (stepId: string, issues: ValidationIssue[]) => void;
  /** Additional class name */
  className?: string;
}

export interface ValidationIndicatorProps {
  /** Error count */
  errorCount: number;
  /** Warning count */
  warningCount: number;
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Additional class name */
  className?: string;
}

// ============================================================================
// Size configurations
// ============================================================================

const sizeConfig = {
  sm: {
    badge: "h-4 min-w-4 px-1 text-[10px]",
    icon: "h-3 w-3",
    dot: "h-2 w-2",
  },
  md: {
    badge: "h-5 min-w-5 px-1.5 text-xs",
    icon: "h-3.5 w-3.5",
    dot: "h-2.5 w-2.5",
  },
  lg: {
    badge: "h-6 min-w-6 px-2 text-sm",
    icon: "h-4 w-4",
    dot: "h-3 w-3",
  },
};

const positionConfig = {
  "top-right": "-top-1 -right-1",
  "top-left": "-top-1 -left-1",
  "bottom-right": "-bottom-1 -right-1",
  "bottom-left": "-bottom-1 -left-1",
};

// ============================================================================
// ValidationOverlay Component
// ============================================================================

/**
 * Absolute-positioned overlay badge for step cards.
 * Shows error/warning count with tooltip.
 */
export function ValidationOverlay({
  stepId,
  position = "top-right",
  showWhenValid = false,
  size = "sm",
  onClick,
  className,
}: ValidationOverlayProps): React.ReactElement | null {
  const validationContext = useOptionalValidationContext();

  // Return nothing if no validation context
  if (!validationContext) {
    return null;
  }

  return (
    <ValidationOverlayInner
      stepId={stepId}
      position={position}
      showWhenValid={showWhenValid}
      size={size}
      onClick={onClick}
      result={validationContext.result}
      className={className}
    />
  );
}

interface ValidationOverlayInnerProps extends ValidationOverlayProps {
  result: PipelineValidationResult;
}

function ValidationOverlayInner({
  stepId,
  position = "top-right",
  showWhenValid = false,
  size = "sm",
  onClick,
  result,
  className,
}: ValidationOverlayInnerProps): React.ReactElement | null {
  const { issues, hasError, hasWarning, errorCount, warningCount } =
    useStepValidation(stepId, result);

  // Hide if no issues and not showing valid state
  if (!hasError && !hasWarning && !showWhenValid) {
    return null;
  }

  const config = sizeConfig[size];
  const posClass = positionConfig[position];

  const handleClick = () => {
    onClick?.(stepId, issues);
  };

  // Valid state (green checkmark)
  if (!hasError && !hasWarning) {
    return (
      <div
        className={cn(
          "absolute z-10",
          posClass,
          className
        )}
      >
        <div
          className={cn(
            "flex items-center justify-center rounded-full",
            "bg-emerald-500/20 border border-emerald-500/30",
            config.badge
          )}
        >
          <CheckCircle2
            className={cn(config.icon, "text-emerald-500")}
          />
        </div>
      </div>
    );
  }

  // Error/warning state
  const primaryColor = hasError ? "destructive" : "orange-500";
  const Icon = hasError ? AlertCircle : AlertTriangle;
  const count = hasError ? errorCount : warningCount;

  const tooltipContent = (
    <div className="text-xs space-y-1 max-w-64">
      {hasError && (
        <div className="flex items-center gap-1 text-destructive">
          <AlertCircle className="h-3 w-3" />
          <span>{errorCount} error{errorCount !== 1 && "s"}</span>
        </div>
      )}
      {hasWarning && (
        <div className="flex items-center gap-1 text-orange-500">
          <AlertTriangle className="h-3 w-3" />
          <span>{warningCount} warning{warningCount !== 1 && "s"}</span>
        </div>
      )}
      <div className="text-muted-foreground pt-1 border-t">
        Click to see details
      </div>
    </div>
  );

  return (
    <div
      className={cn(
        "absolute z-10",
        posClass,
        className
      )}
    >
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleClick}
              className={cn(
                "flex items-center justify-center rounded-full font-medium",
                "transition-transform hover:scale-110",
                hasError
                  ? "bg-destructive text-destructive-foreground"
                  : "bg-orange-500 text-white",
                config.badge
              )}
            >
              {count > 99 ? "99+" : count}
            </button>
          </TooltipTrigger>
          <TooltipContent side="left" align="start">
            {tooltipContent}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

// ============================================================================
// ValidationBadge Component
// ============================================================================

/**
 * Inline badge showing validation status.
 * Use when you need a non-absolute-positioned indicator.
 */
export function ValidationBadge({
  stepId,
  size = "sm",
  showLabel = false,
  onClick,
  className,
}: ValidationBadgeProps): React.ReactElement | null {
  const validationContext = useOptionalValidationContext();

  if (!validationContext) {
    return null;
  }

  const { issues, hasError, hasWarning, errorCount, warningCount } =
    useStepValidation(stepId, validationContext.result);

  if (!hasError && !hasWarning) {
    return null;
  }

  const config = sizeConfig[size];
  const Icon = hasError ? AlertCircle : AlertTriangle;
  const count = hasError ? errorCount : warningCount;
  const colorClass = hasError ? "text-destructive" : "text-orange-500";
  const bgClass = hasError ? "bg-destructive/10" : "bg-orange-500/10";

  const handleClick = () => {
    onClick?.(stepId, issues);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full",
        bgClass,
        config.badge,
        onClick && "cursor-pointer hover:opacity-80",
        className
      )}
    >
      <Icon className={cn(config.icon, colorClass)} />
      {showLabel && (
        <span className={colorClass}>
          {count} {hasError ? "error" : "warning"}{count !== 1 && "s"}
        </span>
      )}
      {!showLabel && <span className={colorClass}>{count}</span>}
    </button>
  );
}

// ============================================================================
// ValidationIndicator Component
// ============================================================================

/**
 * Simple validation indicator without context dependency.
 * Use when you already have counts from elsewhere.
 */
export function ValidationIndicator({
  errorCount,
  warningCount,
  size = "sm",
  className,
}: ValidationIndicatorProps): React.ReactElement | null {
  if (errorCount === 0 && warningCount === 0) {
    return null;
  }

  const config = sizeConfig[size];
  const hasError = errorCount > 0;
  const Icon = hasError ? AlertCircle : AlertTriangle;
  const colorClass = hasError ? "text-destructive" : "text-orange-500";

  return (
    <div className={cn("inline-flex items-center gap-0.5", className)}>
      <Icon className={cn(config.icon, colorClass)} />
      {errorCount > 0 && (
        <span className={cn("text-destructive", config.badge)}>
          {errorCount}
        </span>
      )}
      {warningCount > 0 && errorCount > 0 && (
        <span className="text-muted-foreground">/</span>
      )}
      {warningCount > 0 && (
        <span className={cn("text-orange-500", config.badge)}>
          {warningCount}
        </span>
      )}
    </div>
  );
}

// ============================================================================
// ValidationDot Component
// ============================================================================

export interface ValidationDotProps {
  /** Step ID to show validation for */
  stepId: string;
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Additional class name */
  className?: string;
}

/**
 * Minimal dot indicator for tight spaces.
 * Shows red for errors, orange for warnings.
 */
export function ValidationDot({
  stepId,
  size = "sm",
  className,
}: ValidationDotProps): React.ReactElement | null {
  const validationContext = useOptionalValidationContext();

  if (!validationContext) {
    return null;
  }

  const { hasError, hasWarning } =
    useStepValidation(stepId, validationContext.result);

  if (!hasError && !hasWarning) {
    return null;
  }

  const config = sizeConfig[size];
  const colorClass = hasError ? "bg-destructive" : "bg-orange-500";

  return (
    <span
      className={cn(
        "inline-block rounded-full",
        config.dot,
        colorClass,
        className
      )}
    />
  );
}

export default ValidationOverlay;

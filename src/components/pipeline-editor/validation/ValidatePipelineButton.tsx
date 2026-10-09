/**
 * ValidatePipelineButton - Manual validation trigger button
 *
 * A button that allows users to manually trigger pipeline validation.
 * Provides visual feedback during validation and displays results.
 *
 * Features:
 * - One-click validation trigger
 * - Loading state during validation
 * - Success/error feedback
 * - Integration with validation context
 *
 * @example
 * ```tsx
 * <ValidatePipelineButton />
 *
 * // Or with custom styling
 * <ValidatePipelineButton
 *   variant="outline"
 *   size="sm"
 *   showLabel={false}
 * />
 * ```
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  PlayCircle,
} from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useValidationContext } from "./useValidationContext";

export interface ValidatePipelineButtonProps
  extends Omit<ButtonProps, "onClick"> {
  /** Whether to show the label text (default: true) */
  showLabel?: boolean;
  /** Label text (default: localized "Validate") */
  label?: string;
  /** Callback after validation completes */
  onValidationComplete?: (isValid: boolean, errorCount: number) => void;
}

export function ValidatePipelineButton({
  showLabel = true,
  label,
  onValidationComplete,
  variant = "outline",
  size = "sm",
  className,
  disabled,
  ...props
}: ValidatePipelineButtonProps) {
  const { t } = useTranslation();
  const { validateNow, isValidating, result, errorCount, warningCount } = useValidationContext();
  const [recentResult, setRecentResult] = useState<
    "success" | "error" | null
  >(null);

  const handleClick = useCallback(() => {
    validateNow();
  }, [validateNow]);

  // Update recent result when validation completes
  const prevIsValidatingRef = useRef(isValidating);
  useEffect(() => {
    // Detect when validation just finished
    if (prevIsValidatingRef.current && !isValidating) {
      const hasErrors = errorCount > 0;
      setRecentResult(hasErrors ? "error" : "success");

      // Clear feedback after 2 seconds
      const timer = setTimeout(() => setRecentResult(null), 2000);

      onValidationComplete?.(!hasErrors, errorCount);

      return () => clearTimeout(timer);
    }
    prevIsValidatingRef.current = isValidating;
  }, [isValidating, errorCount, onValidationComplete]);

  // Determine current state
  const hasErrors = errorCount > 0;
  const hasWarnings = warningCount > 0;

  // Icon based on state
  let Icon = PlayCircle;
  let iconClassName = "";

  if (isValidating) {
    Icon = RefreshCw;
    iconClassName = "animate-spin";
  } else if (recentResult === "success") {
    Icon = CheckCircle2;
    iconClassName = "text-green-500";
  } else if (recentResult === "error" || hasErrors) {
    Icon = AlertCircle;
    iconClassName = "text-destructive";
  } else if (hasWarnings) {
    Icon = AlertCircle;
    iconClassName = "text-orange-500";
  }

  // Tooltip content
  const tooltipContent = isValidating
    ? t("pipelineEditor.validation.ui.validatingPipeline")
    : hasErrors
      ? t("pipelineEditor.validation.ui.errorsFound", { count: errorCount })
      : hasWarnings
        ? t("pipelineEditor.validation.ui.warningCount", { count: warningCount })
        : t("pipelineEditor.validation.ui.validatePipeline");

  const button = (
    <Button
      variant={variant}
      size={size}
      onClick={handleClick}
      disabled={disabled || isValidating}
      aria-label={showLabel ? undefined : tooltipContent}
      className={cn(
        "gap-2",
        recentResult === "success" && "border-green-500/50",
        recentResult === "error" && "border-destructive/50",
        className
      )}
      {...props}
    >
      <Icon className={cn("h-4 w-4", iconClassName)} />
      {showLabel && <span>{isValidating ? t("pipelineEditor.validation.ui.validating") : label ?? t("pipelineEditor.validation.ui.validate")}</span>}
    </Button>
  );

  if (!showLabel) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="bottom">{tooltipContent}</TooltipContent>
      </Tooltip>
    );
  }

  return button;
}

/**
 * Compact validation trigger for toolbars
 *
 * Icon-only button with tooltip, suitable for dense toolbar layouts.
 */
export function ValidatePipelineIconButton(
  props: Omit<ValidatePipelineButtonProps, "showLabel">
) {
  return (
    <ValidatePipelineButton {...props} showLabel={false} size="icon" />
  );
}

export default ValidatePipelineButton;

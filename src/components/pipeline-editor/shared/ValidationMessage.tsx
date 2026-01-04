/**
 * ValidationMessage - Reusable validation message display component
 *
 * Provides consistent styling for error, warning, info, and success
 * messages throughout the pipeline editor.
 *
 * @example
 * <ValidationMessage severity="error" message="Invalid parameter value" />
 * <ValidationMessage severity="warning" message="This may affect performance" />
 */

import { AlertTriangle, AlertCircle, Info, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type ValidationSeverity = "error" | "warning" | "info" | "success";

export interface ValidationMessageProps {
  /** The validation message to display */
  message: React.ReactNode;
  /** Severity level determining icon and color */
  severity: ValidationSeverity;
  /** Optional title/heading for the message */
  title?: string;
  /** Additional classes for the container */
  className?: string;
  /** Whether to show the icon (default: true) */
  showIcon?: boolean;
  /** Size variant */
  size?: "sm" | "md";
  /** Optional action button/link */
  action?: React.ReactNode;
}

const severityConfig = {
  error: {
    icon: AlertCircle,
    containerClass: "bg-destructive/10 border-destructive/30 text-destructive",
    iconClass: "text-destructive",
  },
  warning: {
    icon: AlertTriangle,
    containerClass: "bg-orange-500/10 border-orange-500/30 text-orange-600 dark:text-orange-400",
    iconClass: "text-orange-500",
  },
  info: {
    icon: Info,
    containerClass: "bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400",
    iconClass: "text-blue-500",
  },
  success: {
    icon: CheckCircle,
    containerClass: "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400",
    iconClass: "text-emerald-500",
  },
};

const sizeConfig = {
  sm: {
    container: "p-2 text-xs",
    icon: "h-3.5 w-3.5",
    title: "text-xs font-medium",
  },
  md: {
    container: "p-3 text-sm",
    icon: "h-4 w-4",
    title: "text-sm font-medium",
  },
};

export function ValidationMessage({
  message,
  severity,
  title,
  className,
  showIcon = true,
  size = "md",
  action,
}: ValidationMessageProps) {
  const config = severityConfig[severity];
  const sizes = sizeConfig[size];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border",
        config.containerClass,
        sizes.container,
        className
      )}
      role={severity === "error" ? "alert" : "status"}
      aria-live={severity === "error" ? "assertive" : "polite"}
    >
      {showIcon && (
        <Icon
          className={cn(sizes.icon, config.iconClass, "flex-shrink-0 mt-0.5")}
          aria-hidden="true"
        />
      )}
      <div className="flex-1 min-w-0">
        {title && (
          <p className={cn(sizes.title, "mb-0.5")}>{title}</p>
        )}
        <div className="text-inherit">{message}</div>
      </div>
      {action && (
        <div className="flex-shrink-0">{action}</div>
      )}
    </div>
  );
}

/**
 * InlineValidationMessage - Compact inline validation indicator
 *
 * For use next to form inputs when space is limited.
 */
export interface InlineValidationMessageProps {
  message: string;
  severity: ValidationSeverity;
  className?: string;
}

export function InlineValidationMessage({
  message,
  severity,
  className,
}: InlineValidationMessageProps) {
  const config = severityConfig[severity];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        "flex items-center gap-1 text-xs",
        config.iconClass,
        className
      )}
      role={severity === "error" ? "alert" : "status"}
    >
      <Icon className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

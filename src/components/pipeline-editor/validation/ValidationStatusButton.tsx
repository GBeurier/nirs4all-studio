/**
 * ValidationStatusButton Component
 *
 * Compact button showing validation status for the toolbar.
 * Shows error/warning counts with color indicators.
 *
 * @see docs/_internals/implementation_roadmap.md Task 4.8
 */

import React from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import type { PipelineValidationResult } from "./types";
import { ValidationPanel } from "./ValidationPanel";

// ============================================================================
// Component Types
// ============================================================================

export interface ValidationStatusButtonProps {
  /** Validation result */
  result: PipelineValidationResult;
  /** Whether validation is in progress */
  isValidating?: boolean;
  /** Callback to refresh validation */
  onRefresh?: () => void;
  /** Callback when navigating to an issue */
  onNavigate?: (issue: { location: { stepId?: string } }) => void;
  /** Button variant */
  variant?: "default" | "compact" | "icon";
  /** Additional class name */
  className?: string;
}

// ============================================================================
// ValidationStatusButton Component
// ============================================================================

export function ValidationStatusButton({
  result,
  isValidating = false,
  onRefresh,
  onNavigate,
  variant = "default",
  className,
}: ValidationStatusButtonProps): React.ReactElement {
  const { errorCount, warningCount, infoCount } = result.summary;
  const hasIssues = errorCount > 0 || warningCount > 0;

  // Determine status
  const status: "valid" | "error" | "warning" | "loading" = isValidating
    ? "loading"
    : errorCount > 0
    ? "error"
    : warningCount > 0
    ? "warning"
    : "valid";

  // Get icon and color based on status
  const statusConfig = {
    loading: {
      icon: Loader2,
      color: "text-muted-foreground",
      bgColor: "bg-muted/50",
      label: "Validating...",
    },
    error: {
      icon: AlertCircle,
      color: "text-destructive",
      bgColor: "bg-destructive/10",
      label: `${errorCount} error${errorCount !== 1 ? "s" : ""}`,
    },
    warning: {
      icon: AlertTriangle,
      color: "text-orange-500",
      bgColor: "bg-orange-500/10",
      label: `${warningCount} warning${warningCount !== 1 ? "s" : ""}`,
    },
    valid: {
      icon: CheckCircle2,
      color: "text-emerald-500",
      bgColor: "bg-emerald-500/10",
      label: "Pipeline valid",
    },
  };

  const config = statusConfig[status];
  const Icon = config.icon;

  // Render based on variant
  if (variant === "icon") {
    return (
      <TooltipProvider>
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-8 w-8 relative", className)}
                  disabled={isValidating}
                >
                  <Icon
                    className={cn(
                      "h-4 w-4",
                      config.color,
                      isValidating && "animate-spin"
                    )}
                  />
                  {hasIssues && !isValidating && (
                    <span
                      className={cn(
                        "absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full",
                        errorCount > 0 ? "bg-destructive" : "bg-orange-500"
                      )}
                    />
                  )}
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{config.label}</p>
            </TooltipContent>
          </Tooltip>
          <PopoverContent className="w-96 p-0" align="end">
            <ValidationPanel
              result={result}
              isValidating={isValidating}
              onRefresh={onRefresh}
              onNavigate={onNavigate}
              maxHeight={350}
            />
          </PopoverContent>
        </Popover>
      </TooltipProvider>
    );
  }

  if (variant === "compact") {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-7 gap-1.5 px-2",
              config.bgColor,
              className
            )}
            disabled={isValidating}
          >
            <Icon
              className={cn(
                "h-3.5 w-3.5",
                config.color,
                isValidating && "animate-spin"
              )}
            />
            {!isValidating && (
              <span className="text-xs font-medium">
                {errorCount > 0 && <span className="text-destructive">{errorCount}</span>}
                {errorCount > 0 && warningCount > 0 && <span className="text-muted-foreground">/</span>}
                {warningCount > 0 && <span className="text-orange-500">{warningCount}</span>}
                {!hasIssues && <span className={config.color}>✓</span>}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-96 p-0" align="end">
          <ValidationPanel
            result={result}
            isValidating={isValidating}
            onRefresh={onRefresh}
            onNavigate={onNavigate}
            maxHeight={350}
          />
        </PopoverContent>
      </Popover>
    );
  }

  // Default variant
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "gap-2 h-8",
            hasIssues && "border-destructive/50",
            className
          )}
          disabled={isValidating}
        >
          <Icon
            className={cn(
              "h-4 w-4",
              config.color,
              isValidating && "animate-spin"
            )}
          />
          {!isValidating && (
            <>
              {errorCount > 0 && (
                <Badge variant="destructive" className="h-5 px-1.5 text-xs">
                  {errorCount}
                </Badge>
              )}
              {warningCount > 0 && (
                <Badge
                  variant="outline"
                  className="h-5 px-1.5 text-xs border-orange-500/50 text-orange-500"
                >
                  {warningCount}
                </Badge>
              )}
              {!hasIssues && (
                <span className="text-xs text-emerald-500">Valid</span>
              )}
            </>
          )}
          {isValidating && (
            <span className="text-xs text-muted-foreground">Validating</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end">
        <ValidationPanel
          result={result}
          isValidating={isValidating}
          onRefresh={onRefresh}
          onNavigate={onNavigate}
          maxHeight={400}
        />
      </PopoverContent>
    </Popover>
  );
}

// ============================================================================
// ValidationStatusIndicator (Simpler, no popover)
// ============================================================================

export interface ValidationStatusIndicatorProps {
  result: PipelineValidationResult;
  isValidating?: boolean;
  className?: string;
}

/**
 * Simple status indicator without popover.
 * Use when you just need to show status in a compact space.
 */
export function ValidationStatusIndicator({
  result,
  isValidating = false,
  className,
}: ValidationStatusIndicatorProps): React.ReactElement {
  const { errorCount, warningCount } = result.summary;

  if (isValidating) {
    return (
      <div className={cn("flex items-center gap-1", className)}>
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (errorCount > 0) {
    return (
      <div className={cn("flex items-center gap-1", className)}>
        <AlertCircle className="h-3.5 w-3.5 text-destructive" />
        <span className="text-xs text-destructive">{errorCount}</span>
      </div>
    );
  }

  if (warningCount > 0) {
    return (
      <div className={cn("flex items-center gap-1", className)}>
        <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />
        <span className="text-xs text-orange-500">{warningCount}</span>
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
    </div>
  );
}

/**
 * ValidationSummaryDialog Component
 *
 * Modal dialog showing validation summary before export.
 * Blocks export on errors, allows proceeding with warnings.
 *
 * @see docs/_internals/implementation_roadmap.md Task 4.10
 */

import React from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  Download,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { PipelineValidationResult, ValidationIssue } from "./types";
import { SEVERITY_METADATA } from "./rules";

// ============================================================================
// Component Types
// ============================================================================

export interface ValidationSummaryDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback to close the dialog */
  onOpenChange: (open: boolean) => void;
  /** Validation result */
  result: PipelineValidationResult;
  /** Callback when export is confirmed */
  onExport: () => void;
  /** Callback when navigating to an issue */
  onNavigate?: (issue: ValidationIssue) => void;
  /** Export action label */
  exportLabel?: string;
  /** Title override */
  title?: string;
}

// ============================================================================
// ValidationSummaryDialog Component
// ============================================================================

export function ValidationSummaryDialog({
  open,
  onOpenChange,
  result,
  onExport,
  onNavigate,
  exportLabel = "Export Pipeline",
  title = "Validation Summary",
}: ValidationSummaryDialogProps): React.ReactElement {
  const { errorCount, warningCount, infoCount } = result.summary;
  const hasErrors = errorCount > 0;
  const hasWarnings = warningCount > 0;
  const canExport = !hasErrors;

  const handleExport = () => {
    if (canExport) {
      onExport();
      onOpenChange(false);
    }
  };

  const handleNavigateAndClose = (issue: ValidationIssue) => {
    onNavigate?.(issue);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {hasErrors ? (
              <>
                <AlertCircle className="h-5 w-5 text-destructive" />
                <span>Cannot Export</span>
              </>
            ) : hasWarnings ? (
              <>
                <AlertTriangle className="h-5 w-5 text-orange-500" />
                <span>{title}</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                <span>Ready to Export</span>
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {hasErrors
              ? "Please fix the following errors before exporting."
              : hasWarnings
              ? "Your pipeline has warnings. Review them before proceeding."
              : "Your pipeline is valid and ready to export."}
          </DialogDescription>
        </DialogHeader>

        {/* Summary badges */}
        <div className="flex items-center gap-2 py-2">
          {errorCount > 0 && (
            <Badge variant="destructive" className="gap-1">
              <AlertCircle className="h-3 w-3" />
              {errorCount} Error{errorCount !== 1 && "s"}
            </Badge>
          )}
          {warningCount > 0 && (
            <Badge
              variant="outline"
              className="gap-1 border-orange-500/50 text-orange-500"
            >
              <AlertTriangle className="h-3 w-3" />
              {warningCount} Warning{warningCount !== 1 && "s"}
            </Badge>
          )}
          {infoCount > 0 && (
            <Badge
              variant="outline"
              className="gap-1 border-blue-500/50 text-blue-500"
            >
              <Info className="h-3 w-3" />
              {infoCount} Info
            </Badge>
          )}
        </div>

        {/* Issue list */}
        {(hasErrors || hasWarnings) && (
          <ScrollArea className="max-h-64 border rounded-lg">
            <div className="p-2 space-y-2">
              {/* Errors */}
              {result.errors.map((issue) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  onNavigate={onNavigate ? handleNavigateAndClose : undefined}
                />
              ))}
              {/* Warnings */}
              {result.warnings.map((issue) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  onNavigate={onNavigate ? handleNavigateAndClose : undefined}
                />
              ))}
            </div>
          </ScrollArea>
        )}

        {/* Valid message */}
        {!hasErrors && !hasWarnings && (
          <div className="flex flex-col items-center gap-2 py-6">
            <CheckCircle2 className="h-12 w-12 text-emerald-500" />
            <p className="text-sm text-muted-foreground">
              All validation checks passed
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleExport}
            disabled={!canExport}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            {canExport ? exportLabel : "Fix Errors First"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// IssueRow Component
// ============================================================================

interface IssueRowProps {
  issue: ValidationIssue;
  onNavigate?: (issue: ValidationIssue) => void;
}

function IssueRow({ issue, onNavigate }: IssueRowProps): React.ReactElement {
  const severityMeta = SEVERITY_METADATA[issue.severity];
  const Icon = issue.severity === "error" ? AlertCircle :
               issue.severity === "warning" ? AlertTriangle : Info;

  return (
    <div
      className={cn(
        "flex items-start gap-2 p-2 rounded text-sm",
        severityMeta.bgColor,
        severityMeta.borderColor,
        "border",
        onNavigate && "cursor-pointer hover:opacity-80 transition-opacity"
      )}
      onClick={() => onNavigate?.(issue)}
    >
      <Icon className={cn("h-4 w-4 flex-shrink-0 mt-0.5", severityMeta.color)} />
      <div className="flex-1 min-w-0">
        <p className="text-foreground">{issue.message}</p>
        {issue.location.stepName && (
          <p className="text-xs text-muted-foreground mt-0.5">
            {issue.location.stepName}
            {issue.location.paramName && ` → ${issue.location.paramName}`}
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// useValidationBeforeExport Hook
// ============================================================================

export interface UseValidationBeforeExportOptions {
  /** Validate function */
  validateNow: () => void;
  /** Get current result */
  result: PipelineValidationResult;
  /** Callback when export is allowed */
  onExport: () => void;
}

/**
 * Hook to handle validation before export workflow.
 */
export function useValidationBeforeExport({
  validateNow,
  result,
  onExport,
}: UseValidationBeforeExportOptions) {
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const triggerExport = React.useCallback(() => {
    // First validate
    validateNow();
    // Then show dialog
    setDialogOpen(true);
  }, [validateNow]);

  const handleExport = React.useCallback(() => {
    if (result.isValid) {
      onExport();
    }
  }, [result.isValid, onExport]);

  return {
    dialogOpen,
    setDialogOpen,
    triggerExport,
    handleExport,
    canExport: result.isValid,
  };
}

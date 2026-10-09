/**
 * ValidationSummaryDialog Component
 *
 * Modal dialog showing validation summary before export.
 * Blocks export on errors, allows proceeding with warnings.
 *
 * @see docs/_internals/implementation_roadmap.md Task 4.10
 */

import React from "react";
import { useTranslation } from "react-i18next";
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
  exportLabel,
  title,
}: ValidationSummaryDialogProps): React.ReactElement {
  const { t } = useTranslation();
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
                <span>{t("pipelineEditor.validation.summary.cannotExport")}</span>
              </>
            ) : hasWarnings ? (
              <>
                <AlertTriangle className="h-5 w-5 text-orange-500" />
                <span>{title ?? t("pipelineEditor.validation.summary.title")}</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                <span>{t("pipelineEditor.validation.summary.readyToExport")}</span>
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {hasErrors
              ? t("pipelineEditor.validation.summary.fixErrors")
              : hasWarnings
              ? t("pipelineEditor.validation.summary.hasWarnings")
              : t("pipelineEditor.validation.summary.isValid")}
          </DialogDescription>
        </DialogHeader>

        {/* Summary badges */}
        <div className="flex items-center gap-2 py-2">
          {errorCount > 0 && (
            <Badge variant="destructive" className="gap-1">
              <AlertCircle className="h-3 w-3" />
              {t("pipelineEditor.validation.ui.errorCount", { count: errorCount })}
            </Badge>
          )}
          {warningCount > 0 && (
            <Badge
              variant="outline"
              className="gap-1 border-orange-500/50 text-orange-500"
            >
              <AlertTriangle className="h-3 w-3" />
              {t("pipelineEditor.validation.ui.warningCount", { count: warningCount })}
            </Badge>
          )}
          {infoCount > 0 && (
            <Badge
              variant="outline"
              className="gap-1 border-blue-500/50 text-blue-500"
            >
              <Info className="h-3 w-3" />
              {t("pipelineEditor.validation.ui.infoCount", { count: infoCount })}
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
              {t("pipelineEditor.validation.summary.allPassed")}
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleExport}
            disabled={!canExport}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            {canExport ? exportLabel ?? t("pipelineEditor.validation.summary.exportLabel") : t("pipelineEditor.validation.summary.fixErrorsFirst")}
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

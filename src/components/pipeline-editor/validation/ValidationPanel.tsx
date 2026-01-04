/**
 * ValidationPanel Component
 *
 * Displays all validation issues in a collapsible panel.
 * Supports filtering, grouping, and navigation to issues.
 *
 * @see docs/_internals/implementation_roadmap.md Task 4.7
 */

import React, { useState, useMemo, useCallback } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Info,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  RefreshCw,
  Filter,
  X,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import type {
  PipelineValidationResult,
  ValidationIssue,
  ValidationSeverity,
  ValidationCategory,
} from "./types";
import { SEVERITY_METADATA, CATEGORY_METADATA } from "./rules";

// ============================================================================
// Component Types
// ============================================================================

export interface ValidationPanelProps {
  /** Validation result to display */
  result: PipelineValidationResult;
  /** Whether validation is in progress */
  isValidating?: boolean;
  /** Whether to show the refresh button */
  showRefresh?: boolean;
  /** Callback to refresh validation */
  onRefresh?: () => void;
  /** Callback when navigating to an issue */
  onNavigate?: (issue: ValidationIssue) => void;
  /** Maximum height of the panel */
  maxHeight?: string | number;
  /** Whether the panel is initially collapsed */
  defaultCollapsed?: boolean;
  /** Additional class name */
  className?: string;
}

type GroupBy = "severity" | "category" | "step" | "none";

// ============================================================================
// ValidationPanel Component
// ============================================================================

export function ValidationPanel({
  result,
  isValidating = false,
  showRefresh = true,
  onRefresh,
  onNavigate,
  maxHeight = 400,
  defaultCollapsed = false,
  className,
}: ValidationPanelProps): React.ReactElement {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const [groupBy, setGroupBy] = useState<GroupBy>("severity");
  const [showErrors, setShowErrors] = useState(true);
  const [showWarnings, setShowWarnings] = useState(true);
  const [showInfos, setShowInfos] = useState(false);

  // Filter issues based on visibility settings
  const visibleIssues = useMemo(() => {
    return result.issues.filter((issue) => {
      if (issue.severity === "error" && !showErrors) return false;
      if (issue.severity === "warning" && !showWarnings) return false;
      if (issue.severity === "info" && !showInfos) return false;
      return true;
    });
  }, [result.issues, showErrors, showWarnings, showInfos]);

  // Group issues
  const groupedIssues = useMemo(() => {
    if (groupBy === "none") {
      return { all: visibleIssues };
    }

    const groups: Record<string, ValidationIssue[]> = {};

    for (const issue of visibleIssues) {
      let key: string;
      switch (groupBy) {
        case "severity":
          key = issue.severity;
          break;
        case "category":
          key = issue.category;
          break;
        case "step":
          key = issue.location.stepName || "Pipeline";
          break;
        default:
          key = "all";
      }

      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(issue);
    }

    return groups;
  }, [visibleIssues, groupBy]);

  // Calculate counts
  const { errorCount, warningCount, infoCount } = result.summary;

  return (
    <div
      className={cn(
        "border rounded-lg bg-card text-card-foreground",
        className
      )}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b cursor-pointer select-none"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div className="flex items-center gap-2">
          {isCollapsed ? (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="font-medium text-sm">Validation</span>

          {/* Summary badges */}
          <div className="flex items-center gap-1">
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
            {infoCount > 0 && showInfos && (
              <Badge
                variant="outline"
                className="h-5 px-1.5 text-xs border-blue-500/50 text-blue-500"
              >
                {infoCount}
              </Badge>
            )}
          </div>

          {result.isValid && errorCount === 0 && (
            <div className="flex items-center gap-1 text-emerald-500">
              <CheckCircle2 className="h-4 w-4" />
              <span className="text-xs">Valid</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {/* Filter dropdown */}
          <FilterDropdown
            showErrors={showErrors}
            showWarnings={showWarnings}
            showInfos={showInfos}
            onShowErrorsChange={setShowErrors}
            onShowWarningsChange={setShowWarnings}
            onShowInfosChange={setShowInfos}
            groupBy={groupBy}
            onGroupByChange={setGroupBy}
          />

          {/* Refresh button */}
          {showRefresh && onRefresh && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={onRefresh}
                    disabled={isValidating}
                  >
                    <RefreshCw
                      className={cn(
                        "h-4 w-4",
                        isValidating && "animate-spin"
                      )}
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Refresh validation</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>

      {/* Content */}
      {!isCollapsed && (
        <ScrollArea
          style={{ maxHeight: typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight }}
        >
          <div className="p-2">
            {visibleIssues.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                {result.issues.length === 0 ? (
                  <div className="flex flex-col items-center gap-2">
                    <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                    <p>No validation issues</p>
                  </div>
                ) : (
                  <p>No visible issues (adjust filters)</p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {Object.entries(groupedIssues).map(([group, issues]) => (
                  <IssueGroup
                    key={group}
                    title={formatGroupTitle(group, groupBy)}
                    issues={issues}
                    groupBy={groupBy}
                    onNavigate={onNavigate}
                  />
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

// ============================================================================
// FilterDropdown Component
// ============================================================================

interface FilterDropdownProps {
  showErrors: boolean;
  showWarnings: boolean;
  showInfos: boolean;
  onShowErrorsChange: (value: boolean) => void;
  onShowWarningsChange: (value: boolean) => void;
  onShowInfosChange: (value: boolean) => void;
  groupBy: GroupBy;
  onGroupByChange: (value: GroupBy) => void;
}

function FilterDropdown({
  showErrors,
  showWarnings,
  showInfos,
  onShowErrorsChange,
  onShowWarningsChange,
  onShowInfosChange,
  groupBy,
  onGroupByChange,
}: FilterDropdownProps): React.ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <Filter className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Show</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={showErrors}
          onCheckedChange={onShowErrorsChange}
        >
          <AlertCircle className="h-4 w-4 mr-2 text-destructive" />
          Errors
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={showWarnings}
          onCheckedChange={onShowWarningsChange}
        >
          <AlertTriangle className="h-4 w-4 mr-2 text-orange-500" />
          Warnings
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={showInfos}
          onCheckedChange={onShowInfosChange}
        >
          <Info className="h-4 w-4 mr-2 text-blue-500" />
          Info
        </DropdownMenuCheckboxItem>

        <DropdownMenuSeparator />

        <DropdownMenuLabel>Group by</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={groupBy === "severity"}
          onCheckedChange={() => onGroupByChange("severity")}
        >
          Severity
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={groupBy === "category"}
          onCheckedChange={() => onGroupByChange("category")}
        >
          Category
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={groupBy === "step"}
          onCheckedChange={() => onGroupByChange("step")}
        >
          Step
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={groupBy === "none"}
          onCheckedChange={() => onGroupByChange("none")}
        >
          None
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ============================================================================
// IssueGroup Component
// ============================================================================

interface IssueGroupProps {
  title: string;
  issues: ValidationIssue[];
  groupBy: GroupBy;
  onNavigate?: (issue: ValidationIssue) => void;
}

function IssueGroup({
  title,
  issues,
  groupBy,
  onNavigate,
}: IssueGroupProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <div
          className={cn(
            "flex items-center justify-between px-2 py-1.5 rounded cursor-pointer",
            "hover:bg-muted/50"
          )}
        >
          <div className="flex items-center gap-2">
            {isOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span className="text-sm font-medium">{title}</span>
          </div>
          <Badge variant="secondary" className="h-5 px-1.5 text-xs">
            {issues.length}
          </Badge>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-4 space-y-1 mt-1">
          {issues.map((issue) => (
            <IssueItem
              key={issue.id}
              issue={issue}
              showStep={groupBy !== "step"}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ============================================================================
// IssueItem Component
// ============================================================================

interface IssueItemProps {
  issue: ValidationIssue;
  showStep?: boolean;
  onNavigate?: (issue: ValidationIssue) => void;
}

function IssueItem({
  issue,
  showStep = true,
  onNavigate,
}: IssueItemProps): React.ReactElement {
  const severityMeta = SEVERITY_METADATA[issue.severity];
  const Icon = issue.severity === "error" ? AlertCircle :
               issue.severity === "warning" ? AlertTriangle : Info;

  const handleClick = useCallback(() => {
    onNavigate?.(issue);
  }, [issue, onNavigate]);

  return (
    <div
      className={cn(
        "flex items-start gap-2 p-2 rounded text-sm",
        "hover:bg-muted/30 transition-colors",
        onNavigate && "cursor-pointer"
      )}
      onClick={handleClick}
    >
      <Icon className={cn("h-4 w-4 flex-shrink-0 mt-0.5", severityMeta.color)} />
      <div className="flex-1 min-w-0">
        <p className="text-foreground">{issue.message}</p>
        {showStep && issue.location.stepName && (
          <p className="text-xs text-muted-foreground mt-0.5">
            in {issue.location.stepName}
            {issue.location.paramName && ` → ${issue.location.paramName}`}
          </p>
        )}
        {issue.suggestion && (
          <p className="text-xs text-muted-foreground mt-1 italic">
            💡 {issue.suggestion}
          </p>
        )}
      </div>
      {onNavigate && issue.location.stepId && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 flex-shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  handleClick();
                }}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Go to step</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}

// ============================================================================
// Utilities
// ============================================================================

function formatGroupTitle(group: string, groupBy: GroupBy): string {
  switch (groupBy) {
    case "severity":
      return SEVERITY_METADATA[group as ValidationSeverity]?.label || group;
    case "category":
      return CATEGORY_METADATA[group as ValidationCategory]?.label || group;
    case "step":
      return group;
    default:
      return "All Issues";
  }
}

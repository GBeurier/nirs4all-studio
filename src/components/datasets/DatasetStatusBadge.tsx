/**
 * DatasetStatusBadge - Phase 2: Versioning & Integrity
 *
 * Displays the version status of a dataset with appropriate styling and tooltip.
 */

import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { DatasetVersionStatus } from "@/types/datasets";

interface DatasetStatusBadgeProps {
  status: DatasetVersionStatus;
  lastVerified?: string;
  hash?: string;
  showLabel?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const statusConfig: Record<
  DatasetVersionStatus,
  {
    icon: typeof CheckCircle2;
    label: string;
    description: string;
    variant: "default" | "secondary" | "destructive" | "outline";
    colorClass: string;
  }
> = {
  current: {
    icon: CheckCircle2,
    label: "Current",
    description: "Dataset is up to date. Hash matches stored value.",
    variant: "secondary",
    colorClass: "text-green-600 dark:text-green-400",
  },
  modified: {
    icon: AlertTriangle,
    label: "Modified",
    description: "Dataset has changed since last verification. Consider refreshing.",
    variant: "outline",
    colorClass: "text-amber-600 dark:text-amber-400",
  },
  missing: {
    icon: XCircle,
    label: "Missing",
    description: "Dataset path is not accessible. Relink to restore.",
    variant: "destructive",
    colorClass: "text-destructive",
  },
  unchecked: {
    icon: HelpCircle,
    label: "Unchecked",
    description: "Dataset has not been verified yet.",
    variant: "outline",
    colorClass: "text-muted-foreground",
  },
};

const sizeClasses = {
  sm: "h-3 w-3",
  md: "h-4 w-4",
  lg: "h-5 w-5",
};

function formatLastVerified(dateString?: string): string {
  if (!dateString) return "Never verified";

  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
  return date.toLocaleDateString();
}

export function DatasetStatusBadge({
  status,
  lastVerified,
  hash,
  showLabel = false,
  size = "md",
  className,
}: DatasetStatusBadgeProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {showLabel ? (
            <Badge
              variant={config.variant}
              className={cn("gap-1 cursor-default", className)}
            >
              <Icon className={cn(sizeClasses[size], config.colorClass)} />
              {config.label}
            </Badge>
          ) : (
            <span className={cn("cursor-default inline-flex", className)}>
              <Icon className={cn(sizeClasses[size], config.colorClass)} />
            </span>
          )}
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="space-y-1">
            <p className="font-medium">{config.label}</p>
            <p className="text-xs text-muted-foreground">{config.description}</p>
            <div className="text-xs text-muted-foreground border-t pt-1 mt-1">
              <p>Verified: {formatLastVerified(lastVerified)}</p>
              {hash && <p className="font-mono">Hash: {hash}</p>}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Animated version status indicator for loading states
 */
export function DatasetStatusLoading({
  size = "md",
  className,
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <span className={cn("inline-flex", className)}>
      <RefreshCw
        className={cn(sizeClasses[size], "text-primary animate-spin")}
      />
    </span>
  );
}

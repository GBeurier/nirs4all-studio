/**
 * DatasetStatusBadge - Phase 2: Versioning & Integrity
 *
 * Displays the version status of a dataset with appropriate styling and tooltip.
 */

import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
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
import { getActiveLocale } from "@/lib/activeLocale";

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
    labelKey: string;
    descriptionKey: string;
    variant: "default" | "secondary" | "destructive" | "outline";
    colorClass: string;
  }
> = {
  current: {
    icon: CheckCircle2,
    labelKey: "datasets.status.current.label",
    descriptionKey: "datasets.status.current.description",
    variant: "secondary",
    colorClass: "text-green-600 dark:text-green-400",
  },
  modified: {
    icon: AlertTriangle,
    labelKey: "datasets.status.modified.label",
    descriptionKey: "datasets.status.modified.description",
    variant: "outline",
    colorClass: "text-amber-600 dark:text-amber-400",
  },
  missing: {
    icon: XCircle,
    labelKey: "datasets.status.missing.label",
    descriptionKey: "datasets.status.missing.description",
    variant: "destructive",
    colorClass: "text-destructive",
  },
  unchecked: {
    icon: HelpCircle,
    labelKey: "datasets.status.unchecked.label",
    descriptionKey: "datasets.status.unchecked.description",
    variant: "outline",
    colorClass: "text-muted-foreground",
  },
};

const sizeClasses = {
  sm: "h-3 w-3",
  md: "h-4 w-4",
  lg: "h-5 w-5",
};

function formatLastVerified(t: TFunction, dateString?: string): string {
  if (!dateString) return t("datasets.status.neverVerified");

  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return t("datasets.status.justNow");
  if (diffMins < 60) return t("datasets.status.minutesAgo", { count: diffMins });
  if (diffHours < 24) return t("datasets.status.hoursAgo", { count: diffHours });
  if (diffDays < 7) return t("datasets.status.daysAgo", { count: diffDays });
  return date.toLocaleDateString(getActiveLocale());
}

export function DatasetStatusBadge({
  status,
  lastVerified,
  hash,
  showLabel = false,
  size = "md",
  className,
}: DatasetStatusBadgeProps) {
  const { t } = useTranslation();
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
              {t(config.labelKey)}
            </Badge>
          ) : (
            <span className={cn("cursor-default inline-flex", className)}>
              <Icon className={cn(sizeClasses[size], config.colorClass)} />
            </span>
          )}
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="space-y-1">
            <p className="font-medium">{t(config.labelKey)}</p>
            <p className="text-xs text-muted-foreground">{t(config.descriptionKey)}</p>
            <div className="text-xs text-muted-foreground border-t pt-1 mt-1">
              <p>{t("datasets.status.verified", { when: formatLastVerified(t, lastVerified) })}</p>
              {hash && <p className="font-mono">{t("datasets.status.hash", { hash })}</p>}
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

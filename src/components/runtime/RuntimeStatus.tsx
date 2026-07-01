import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  Clock,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  buildRuntimeResultStatusView,
  getRuntimeResultStatusDisplay,
  type RuntimeResultBadgeVariant,
  type RuntimeResultStatusIcon,
} from "@/ui/runtime";

const runtimeStatusIcons: Record<RuntimeResultStatusIcon, LucideIcon> = {
  clock: Clock,
  refresh: RefreshCw,
  check: CheckCircle2,
  alert: AlertCircle,
  partial: CircleDashed,
};

export function RuntimeStatusIcon({
  status,
  className,
}: {
  status: string | null | undefined;
  className?: string;
}) {
  const display = getRuntimeResultStatusDisplay(status);
  const Icon = runtimeStatusIcons[display.icon];

  return (
    <Icon className={cn("h-4 w-4", display.colorClass, display.iconClass, className)} />
  );
}

export function RuntimeStatusIconFrame({
  status,
  className,
  iconClassName,
}: {
  status: string | null | undefined;
  className?: string;
  iconClassName?: string;
}) {
  const display = getRuntimeResultStatusDisplay(status);

  return (
    <div className={cn("rounded-lg p-2", display.bgClass, className)}>
      <RuntimeStatusIcon status={status} className={iconClassName} />
    </div>
  );
}

export function RuntimeStatusBadge({
  status,
  className,
  iconClassName,
  showIcon = true,
  variant,
}: {
  status: string | null | undefined;
  className?: string;
  iconClassName?: string;
  showIcon?: boolean;
  variant?: RuntimeResultBadgeVariant;
}) {
  const display = getRuntimeResultStatusDisplay(status);

  return (
    <Badge variant={variant ?? display.badgeVariant} className={cn("gap-1.5", display.bgClass, className)}>
      {showIcon && (
        <RuntimeStatusIcon status={status} className={cn("h-3.5 w-3.5", iconClassName)} />
      )}
      {display.label}
    </Badge>
  );
}

export function RuntimeRunStatePresentation({
  status,
  progress,
  label = "Progress",
  className,
}: {
  status: string | null | undefined;
  progress?: number | null;
  label?: string;
  className?: string;
}) {
  const view = buildRuntimeResultStatusView(status, progress);
  if (view.progress == null) return null;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{view.progress}%</span>
      </div>
      <Progress value={view.progress} className="h-2" />
    </div>
  );
}

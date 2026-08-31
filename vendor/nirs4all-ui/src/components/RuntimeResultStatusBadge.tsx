import type { ReactNode } from "react";

import {
  buildRuntimeResultStatusView,
  type RuntimeResultStatusIcon,
  type RuntimeResultStatusView,
} from "../runtime/index.js";

export interface RuntimeResultStatusBadgeProps {
  status?: string | null;
  progress?: number | null;
  view?: RuntimeResultStatusView | null;
  label?: string | null;
  icon?: ReactNode;
  icons?: Partial<Record<RuntimeResultStatusIcon, ReactNode>>;
  className?: string;
  iconClassName?: string;
  labelClassName?: string;
  progressClassName?: string;
  title?: string;
  showProgress?: boolean;
  formatProgress?: (progress: number) => ReactNode;
}

export function RuntimeResultStatusBadge({
  status,
  progress,
  view,
  label,
  icon,
  icons,
  className,
  iconClassName,
  labelClassName,
  progressClassName,
  title,
  showProgress = true,
  formatProgress,
}: RuntimeResultStatusBadgeProps) {
  const statusView = view ?? buildRuntimeResultStatusView(status, progress);
  const resolvedIcon = icon ?? icons?.[statusView.icon] ?? null;
  const progressNode = showProgress && statusView.progress != null
    ? formatProgress?.(statusView.progress) ?? `${statusView.progress}%`
    : null;

  return (
    <span className={className} title={title}>
      {resolvedIcon ? <span className={iconClassName}>{resolvedIcon}</span> : null}
      <span className={labelClassName}>{label ?? statusView.label}</span>
      {progressNode ? <span className={progressClassName}>{progressNode}</span> : null}
    </span>
  );
}

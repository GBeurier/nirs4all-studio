import type { ReactNode } from "react";

import {
  buildRuntimeEngineStatus,
  formatRuntimeEngineTitle,
  runtimeEngineLabel,
  type RuntimeEngineLineage,
  type RuntimeEngineStatusView,
} from "../runtime/index.js";

export interface RuntimeEngineBadgeProps {
  lineage?: RuntimeEngineLineage | null;
  source?: unknown;
  status?: RuntimeEngineStatusView | null;
  label?: string | null;
  icon?: ReactNode;
  defaultIcon?: ReactNode;
  fallbackIcon?: ReactNode;
  className?: string;
  title?: string;
}

export function RuntimeEngineBadge({
  lineage,
  source,
  status,
  label,
  icon,
  defaultIcon,
  fallbackIcon,
  className,
  title,
}: RuntimeEngineBadgeProps) {
  const engineStatus = status ?? buildRuntimeEngineStatus(source);
  const text = label ?? engineStatus?.badgeLabel ?? runtimeEngineLabel(lineage);
  if (!text) return null;
  const resolvedIcon = icon ?? (engineStatus?.isFallback ? fallbackIcon : defaultIcon);
  const resolvedTitle = title ?? formatRuntimeEngineTitle(engineStatus) ?? undefined;

  return (
    <span className={className} title={resolvedTitle}>
      {resolvedIcon}
      {text}
    </span>
  );
}

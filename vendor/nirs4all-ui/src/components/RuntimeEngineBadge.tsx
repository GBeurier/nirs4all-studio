import type { ReactNode } from "react";

import { runtimeEngineLabel, type RuntimeEngineLineage } from "../runtime/index.js";

export interface RuntimeEngineBadgeProps {
  lineage?: RuntimeEngineLineage | null;
  label?: string | null;
  icon?: ReactNode;
  className?: string;
  title?: string;
}

export function RuntimeEngineBadge({
  lineage,
  label,
  icon,
  className,
  title,
}: RuntimeEngineBadgeProps) {
  const text = label ?? runtimeEngineLabel(lineage);
  if (!text) return null;

  return (
    <span className={className} title={title}>
      {icon}
      {text}
    </span>
  );
}

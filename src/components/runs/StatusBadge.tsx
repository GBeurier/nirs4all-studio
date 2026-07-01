import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getRuntimeResultStatusDisplay } from "@/ui/runtime";
import type { RunStatus } from "@/types/runs";

import { statusIcons } from "./statusIcons";

export function StatusBadge({ status }: { status: RunStatus }) {
  const Icon = statusIcons[status];
  const statusDisplay = getRuntimeResultStatusDisplay(status);
  return (
    <Badge variant="secondary" className={cn("gap-1.5", statusDisplay.bgClass)}>
      <Icon className={cn("h-3.5 w-3.5", statusDisplay.colorClass, statusDisplay.iconClass)} />
      {statusDisplay.label}
    </Badge>
  );
}

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { RunStatus } from "@/types/runs";
import { runStatusConfig } from "@/types/runs";

import { statusIcons } from "./statusIcons";

export function StatusBadge({ status }: { status: RunStatus }) {
  const Icon = statusIcons[status];
  const config = runStatusConfig[status];
  return (
    <Badge variant="secondary" className={cn("gap-1.5", config.bg)}>
      <Icon className={cn("h-3.5 w-3.5", config.color, config.iconClass)} />
      {config.label}
    </Badge>
  );
}

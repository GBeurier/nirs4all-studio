/**
 * ChainConnector - Visual connector between builder steps
 *
 * Shows the fluent builder chain pattern (.with_features().with_targets()...)
 */

import { cn } from "@/lib/utils";

interface ChainConnectorProps {
  label?: string;
  className?: string;
}

export function ChainConnector({ label = ".", className }: ChainConnectorProps) {
  return (
    <div className={cn("flex items-center justify-center py-1", className)}>
      <div className="flex items-center gap-1 text-muted-foreground">
        <div className="h-4 w-px bg-border" />
        <span className="text-xs font-mono">{label}</span>
        <div className="h-4 w-px bg-border" />
      </div>
    </div>
  );
}

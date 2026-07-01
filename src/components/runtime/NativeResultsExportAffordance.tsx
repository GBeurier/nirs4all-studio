import { Archive, Download } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  buildRuntimeNativeResultsAffordance,
  type RuntimeNativeResultsAffordanceInput,
} from "@/ui/runtime";

export function NativeResultsExportAffordance({
  className,
  ...input
}: RuntimeNativeResultsAffordanceInput & {
  className?: string;
}) {
  const view = buildRuntimeNativeResultsAffordance(input);

  return (
    <div className={cn("rounded-lg border p-3", className)}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Archive className="h-3.5 w-3.5" />
          Native results
        </div>
        <Badge
          variant={view.hasNativeResults ? "secondary" : "outline"}
          className="text-[10px]"
        >
          {view.nativeResultsLabel}
        </Badge>
      </div>

      <Button variant="outline" size="sm" className="w-full" disabled={view.disabled}>
        <Download className="mr-1.5 h-3.5 w-3.5" />
        {view.exportLabel}
      </Button>

      {(view.disabledReason || view.exportDescription) && (
        <p className="mt-2 text-center text-xs text-muted-foreground">
          {view.disabledReason ?? view.exportDescription}
        </p>
      )}
    </div>
  );
}

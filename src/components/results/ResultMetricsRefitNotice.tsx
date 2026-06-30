import { Trophy } from "lucide-react";

export function ResultMetricsRefitNotice() {
  return (
    <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
      <Trophy className="h-4 w-4 text-emerald-500 flex-shrink-0" />
      <div className="flex-1">
        <p className="text-sm font-medium text-foreground">Final Model (Refit)</p>
        <p className="text-xs text-muted-foreground">
          This model was retrained on the full training set and is the deployment-ready model.
        </p>
      </div>
    </div>
  );
}

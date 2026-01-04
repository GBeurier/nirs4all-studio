/**
 * FinetuneEnableToggle - Master on/off with visual indicator
 */

import { Sparkles } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface FinetuneEnableToggleProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  paramCount: number;
}

export function FinetuneEnableToggle({
  enabled,
  onToggle,
  paramCount,
}: FinetuneEnableToggleProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between p-4 rounded-lg border-2 transition-all",
        enabled
          ? "border-purple-500 bg-purple-500/5"
          : "border-border hover:border-purple-500/30"
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "p-2 rounded-lg transition-colors",
            enabled ? "bg-purple-500/20" : "bg-muted"
          )}
        >
          <Sparkles
            className={cn(
              "h-5 w-5 transition-colors",
              enabled ? "text-purple-500" : "text-muted-foreground"
            )}
          />
        </div>
        <div>
          <h4 className="font-medium">Optuna Finetuning</h4>
          <p className="text-sm text-muted-foreground">
            {enabled
              ? `Optimizing ${paramCount} parameter${paramCount !== 1 ? "s" : ""}`
              : "Enable intelligent hyperparameter search"}
          </p>
        </div>
      </div>

      <Switch
        checked={enabled}
        onCheckedChange={onToggle}
        className="data-[state=checked]:bg-purple-500"
      />
    </div>
  );
}

import { Cpu } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const DEFAULT_RUNTIME_BACKEND = "__default__";

export interface RuntimeBackendSelectorProps {
  runtimeEngine: string | null;
  allowFallback: boolean;
  disabled?: boolean;
  className?: string;
  compact?: boolean;
  onRuntimeEngineChange: (value: string | null) => void;
  onAllowFallbackChange: (value: boolean) => void;
}

export function RuntimeBackendSelector({
  runtimeEngine,
  allowFallback,
  disabled = false,
  className,
  compact = false,
  onRuntimeEngineChange,
  onAllowFallbackChange,
}: RuntimeBackendSelectorProps) {
  const selectedValue = runtimeEngine?.trim() || DEFAULT_RUNTIME_BACKEND;
  const canFallback = selectedValue === "dag-ml";

  return (
    <div className={cn("rounded-lg border bg-muted/20 p-3", compact ? "space-y-3" : "space-y-4", className)}>
      <div className="flex items-center gap-2">
        <Cpu className="h-4 w-4 text-muted-foreground" />
        <Label className="text-sm font-medium">Runtime Backend</Label>
      </div>
      <div className={cn("grid gap-3", compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto]")}>
        <Select
          value={selectedValue}
          disabled={disabled}
          onValueChange={(value) => {
            const nextEngine = value === DEFAULT_RUNTIME_BACKEND ? null : value;
            onRuntimeEngineChange(nextEngine);
            if (nextEngine !== "dag-ml") {
              onAllowFallbackChange(false);
            }
          }}
        >
          <SelectTrigger aria-label="Runtime backend">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT_RUNTIME_BACKEND}>Library default</SelectItem>
            <SelectItem value="legacy">Legacy</SelectItem>
            <SelectItem value="dag-ml">DAG-ML</SelectItem>
          </SelectContent>
        </Select>

        <label
          className={cn(
            "flex min-h-10 items-center gap-2 rounded-md border bg-background px-3 text-sm",
            (!canFallback || disabled) && "opacity-60",
          )}
        >
          <Checkbox
            checked={allowFallback}
            disabled={disabled || !canFallback}
            onCheckedChange={(checked) => onAllowFallbackChange(checked === true)}
          />
          <span>Fallback to legacy</span>
        </label>
      </div>
    </div>
  );
}

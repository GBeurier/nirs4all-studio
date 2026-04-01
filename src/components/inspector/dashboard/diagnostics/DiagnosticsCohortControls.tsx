import { Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type DiagnosticsCohortMode = "selected" | "top" | "worst" | "cohort" | "all";

export interface DiagnosticsCohortOption {
  value: DiagnosticsCohortMode;
  label: string;
}

export interface DiagnosticsCohortControlsProps {
  mode: DiagnosticsCohortMode;
  size: number;
  summary: string;
  options: DiagnosticsCohortOption[];
  onModeChange: (mode: DiagnosticsCohortMode) => void;
  onSizeChange: (size: number) => void;
  minSize?: number;
  maxSize?: number;
  className?: string;
}

export function DiagnosticsCohortControls({
  mode,
  size,
  summary,
  options,
  onModeChange,
  onSizeChange,
  minSize = 1,
  maxSize = 1000,
  className,
}: DiagnosticsCohortControlsProps) {
  const updateSize = (next: number) => {
    const clamped = Math.max(minSize, Math.min(maxSize, next));
    onSizeChange(clamped);
  };

  return (
    <Card className={cn("border-border/70 bg-card/80 shadow-sm", className)}>
      <CardHeader className="space-y-2 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-sm font-semibold tracking-tight">
              Diagnostic cohort
            </CardTitle>
            <CardDescription className="text-xs">
              Choose which chains are compared in the diagnostic panels.
            </CardDescription>
          </div>
          <Badge variant="secondary" className="shrink-0">
            {summary}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {options.map(option => (
            <Button
              key={option.value}
              type="button"
              variant={option.value === mode ? "default" : "outline"}
              size="sm"
              className="h-8 px-3 text-xs"
              onClick={() => onModeChange(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => updateSize(size - 1)}
            disabled={size <= minSize}
            aria-label="Decrease cohort size"
          >
            <Minus className="h-4 w-4" />
          </Button>

          <div className="flex-1 min-w-0">
            <label className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Cohort size
            </label>
            <input
              type="number"
              min={minSize}
              max={maxSize}
              value={size}
              onChange={event => updateSize(Number(event.target.value))}
              className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition-colors focus:ring-1 focus:ring-ring"
            />
          </div>

          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => updateSize(size + 1)}
            disabled={size >= maxSize}
            aria-label="Increase cohort size"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

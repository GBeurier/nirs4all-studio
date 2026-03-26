import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { X, Plus, SlidersHorizontal } from "lucide-react";
import {
  getAvailableMetrics,
  getPresetsForTaskType,
  getDefaultSelectedMetrics,
  type MetricDefinition,
} from "@/lib/scores";

interface MetricSelectorProps {
  taskType: string | null;
  selectedMetrics: string[];
  onSelectedMetricsChange: (metrics: string[]) => void;
}

export function MetricSelector({ taskType, selectedMetrics, onSelectedMetricsChange }: MetricSelectorProps) {
  const [open, setOpen] = useState(false);
  const available = getAvailableMetrics(taskType);
  const presets = getPresetsForTaskType(taskType);

  const toggleMetric = useCallback((key: string) => {
    if (selectedMetrics.includes(key)) {
      onSelectedMetricsChange(selectedMetrics.filter(m => m !== key));
    } else {
      onSelectedMetricsChange([...selectedMetrics, key]);
    }
  }, [selectedMetrics, onSelectedMetricsChange]);

  const removeMetric = useCallback((key: string) => {
    onSelectedMetricsChange(selectedMetrics.filter(m => m !== key));
  }, [selectedMetrics, onSelectedMetricsChange]);

  const applyPreset = useCallback((keys: string[]) => {
    onSelectedMetricsChange(keys);
    setOpen(false);
  }, [onSelectedMetricsChange]);

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <SlidersHorizontal className="h-4 w-4 text-muted-foreground shrink-0" />
      {selectedMetrics.map(key => {
        const def = available.find(m => m.key === key);
        return (
          <Badge key={key} variant="secondary" className="text-xs gap-1 pr-1">
            {def?.abbreviation ?? key.toUpperCase()}
            <button onClick={() => removeMetric(key)} className="ml-0.5 hover:text-destructive">
              <X className="h-3 w-3" />
            </button>
          </Badge>
        );
      })}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-6 px-2 text-xs gap-1">
            <Plus className="h-3 w-3" /> Metrics
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-3">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1">
              {presets.map(preset => (
                <Button key={preset.id} variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => applyPreset(preset.keys)}>
                  {preset.label}
                </Button>
              ))}
            </div>
            <div className="border-t pt-2 space-y-1 max-h-48 overflow-y-auto">
              {available.map(metric => (
                <label key={metric.key} className="flex items-center gap-2 text-xs py-0.5 cursor-pointer hover:bg-muted/50 px-1 rounded">
                  <Checkbox
                    checked={selectedMetrics.includes(metric.key)}
                    onCheckedChange={() => toggleMetric(metric.key)}
                    className="h-3.5 w-3.5"
                  />
                  <span className="font-mono text-[10px] text-muted-foreground w-10">{metric.abbreviation}</span>
                  <span>{metric.label}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">{metric.direction === "higher" ? "↑" : metric.direction === "lower" ? "↓" : "~0"}</span>
                </label>
              ))}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** Hook to persist metric selection per page in localStorage. */
export function useMetricSelection(storageKey: string, taskType: string | null) {
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(`metrics-${storageKey}`);
      if (stored) return JSON.parse(stored);
    } catch { /* ignore */ }
    return getDefaultSelectedMetrics(taskType);
  });

  // Update defaults when task type changes and nothing stored
  useEffect(() => {
    try {
      const stored = localStorage.getItem(`metrics-${storageKey}`);
      if (!stored) setSelectedMetrics(getDefaultSelectedMetrics(taskType));
    } catch { /* ignore */ }
  }, [taskType, storageKey]);

  const setMetrics = useCallback((metrics: string[]) => {
    setSelectedMetrics(metrics);
    try {
      localStorage.setItem(`metrics-${storageKey}`, JSON.stringify(metrics));
    } catch { /* ignore */ }
  }, [storageKey]);

  return [selectedMetrics, setMetrics] as const;
}

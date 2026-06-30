import { useState, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, SlidersHorizontal } from "lucide-react";
import {
  buildMetricSelectorData,
  getMetricDirectionSymbol,
  toggleMetricSelection,
} from "@/lib/metricSelectorData";

interface MetricSelectorProps {
  taskType: string | null;
  taskTypes?: readonly string[];
  selectedMetrics: string[];
  onSelectedMetricsChange: (metrics: string[]) => void;
  availableMetricKeys?: readonly string[];
}

export function MetricSelector({
  taskType,
  taskTypes,
  selectedMetrics,
  onSelectedMetricsChange,
  availableMetricKeys,
}: MetricSelectorProps) {
  const [open, setOpen] = useState(false);
  const selectorData = useMemo(() => buildMetricSelectorData({
    taskType,
    taskTypes,
    selectedMetrics,
    availableMetricKeys,
  }), [taskType, taskTypes, selectedMetrics, availableMetricKeys]);

  const toggleMetric = useCallback((key: string) => {
    onSelectedMetricsChange(toggleMetricSelection(selectedMetrics, key));
  }, [selectedMetrics, onSelectedMetricsChange]);

  const applyPreset = useCallback((keys: string[]) => {
    onSelectedMetricsChange(keys);
    setOpen(false);
  }, [onSelectedMetricsChange]);

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <SlidersHorizontal className="h-4 w-4 text-muted-foreground shrink-0" />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-6 px-2 text-xs gap-1">
            <Plus className="h-3 w-3" /> Metrics ({selectorData.selectedCount})
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-3">
          <div className="space-y-3">
            <div className="text-[11px] text-muted-foreground">
              {selectorData.selectedCount} selected
            </div>
            {selectorData.presets.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {selectorData.presets.map(preset => (
                  <Button key={preset.id} variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => applyPreset(preset.keys)}>
                    {preset.label}
                  </Button>
                ))}
              </div>
            )}
            <div className="border-t pt-2 space-y-2 max-h-64 overflow-y-auto">
              {selectorData.availableSections.map(section => (
                <div key={section.group} className="space-y-1">
                  <div className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
                    {section.label}
                  </div>
                  {section.metrics.map(metric => (
                    <label key={metric.key} className="flex items-center gap-2 text-xs py-0.5 cursor-pointer hover:bg-muted/50 px-1 rounded">
                      <Checkbox
                        checked={selectedMetrics.includes(metric.key)}
                        onCheckedChange={() => toggleMetric(metric.key)}
                        className="h-3.5 w-3.5"
                      />
                      <span className="font-mono text-[10px] text-muted-foreground w-10">{metric.abbreviation}</span>
                      <span>{metric.label}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground">{getMetricDirectionSymbol(metric.direction)}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

import { Download, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { MetricSelector } from "@/components/scores/MetricSelector";
import type { MetricTaskFilter } from "@/lib/predictions/rows";

interface PredictionsHeaderProps {
  title: string;
  totalScored: number;
  workspaceName: string;
  predictionsLoading: boolean;
  metricTaskFilter: MetricTaskFilter;
  onMetricTaskFilterChange: (value: MetricTaskFilter) => void;
  metricTaskType: string;
  selectedMetrics: string[];
  onSelectedMetricsChange: (metrics: string[]) => void;
  availableMetricKeys: string[];
  onRefresh: () => void;
  onExport: () => void;
  exportDisabled: boolean;
}

export function PredictionsHeader({
  title,
  totalScored,
  workspaceName,
  predictionsLoading,
  metricTaskFilter,
  onMetricTaskFilterChange,
  metricTaskType,
  selectedMetrics,
  onSelectedMetricsChange,
  availableMetricKeys,
  onRefresh,
  onExport,
  exportDisabled,
}: PredictionsHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{title}</h1>
        <p className="mt-1 text-muted-foreground">
          {totalScored.toLocaleString()} scored models · {workspaceName}
          {predictionsLoading && <Loader2 className="ml-2 h-3 w-3 animate-spin inline" />}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <ToggleGroup
          type="single"
          value={metricTaskFilter}
          onValueChange={value => { if (value) onMetricTaskFilterChange(value as MetricTaskFilter); }}
          variant="outline"
          size="sm"
          className="h-9 rounded-md border border-primary/40 bg-primary/5 p-0.5"
        >
          <ToggleGroupItem
            value="regression"
            className="h-8 px-4 text-xs font-semibold border-0 rounded-sm data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:shadow-sm"
          >
            Regression
          </ToggleGroupItem>
          <ToggleGroupItem
            value="classification"
            className="h-8 px-4 text-xs font-semibold border-0 rounded-sm data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:shadow-sm"
          >
            Classification
          </ToggleGroupItem>
        </ToggleGroup>
        <MetricSelector
          taskType={metricTaskType}
          selectedMetrics={selectedMetrics}
          onSelectedMetricsChange={onSelectedMetricsChange}
          availableMetricKeys={availableMetricKeys}
        />
        <Button variant="outline" onClick={onRefresh} size="sm">
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
        <Button variant="outline" size="sm" onClick={onExport} disabled={exportDisabled}>
          <Download className="h-4 w-4 mr-1" /> Export
        </Button>
      </div>
    </div>
  );
}

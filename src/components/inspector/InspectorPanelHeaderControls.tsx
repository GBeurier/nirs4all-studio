import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  INSPECTOR_HEATMAP_AXIS_OPTIONS,
  type InspectorChainField,
  type InspectorHeatmapAxes,
  type InspectorHeatmapAxisField,
} from "@/lib/inspector/chartInputs";
import {
  getInspectorPanelFieldLabel,
  INSPECTOR_BIAS_VARIANCE_GROUP_OPTIONS,
} from "@/lib/inspector/panelHeaderControls";
import type {
  ResultAnalysisViewModelSummaryCounter,
  ResultAnalysisViewModelSummaryCounterSource,
} from "@/lib/inspector/resultAnalysisViewModels";
import type { ResultAnalysisMetadataFacetCounter } from "@/lib/inspector/resultAnalysisMetadataFacets";
import type { InspectorFocusMode } from "@/lib/inspector/focus";

interface InspectorRowsBadgeProps {
  rowCount: number;
}

interface InspectorFieldBadgeProps {
  field: InspectorChainField;
}

interface InspectorPipelineBadgeProps {
  pipelineId: string | null;
}

interface InspectorFocusModeBadgeProps {
  mode: InspectorFocusMode;
}

interface InspectorPartitionBadgeProps {
  partition: string;
  mode: InspectorFocusMode;
}

interface InspectorHeatmapAxisControlsProps {
  axes: InspectorHeatmapAxes;
  onXAxisChange: (value: InspectorHeatmapAxisField) => void;
  onYAxisChange: (value: InspectorHeatmapAxisField) => void;
}

interface InspectorHyperparameterSelectProps {
  availableHyperParams: string[];
  activeHyperParam: string;
  onChange: (value: string) => void;
}

interface InspectorBiasVarianceGroupSelectProps {
  value: string;
  onChange: (value: string) => void;
}

interface InspectorViewModelSummaryCountersProps {
  counters: readonly ResultAnalysisViewModelSummaryCounter[];
  source?: ResultAnalysisViewModelSummaryCounterSource;
  maxItems?: number;
}

interface InspectorMetadataFacetCountersProps {
  counters: readonly ResultAnalysisMetadataFacetCounter[];
  maxItems?: number;
}

export function InspectorRowsBadge({ rowCount }: InspectorRowsBadgeProps) {
  return <Badge variant="outline">{rowCount} rows</Badge>;
}

export function InspectorViewModelSummaryCounters({
  counters,
  source,
  maxItems = 3,
}: InspectorViewModelSummaryCountersProps) {
  const visibleCounters = counters
    .filter(counter => !source || counter.source === source)
    .slice(0, maxItems);

  if (visibleCounters.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {visibleCounters.map(counter => (
        <Badge key={counter.id} variant="outline" className="text-[10px]">
          {counter.label}: {counter.formattedValue}
        </Badge>
      ))}
    </div>
  );
}

export function InspectorMetadataFacetCounters({
  counters,
  maxItems = 6,
}: InspectorMetadataFacetCountersProps) {
  const visibleCounters = counters.slice(0, maxItems);

  if (visibleCounters.length === 0) return null;

  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
      <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground select-none">
        Metadata
      </span>
      {visibleCounters.map(counter => (
        <Badge
          key={counter.id}
          variant={counter.source === "summary" ? "secondary" : "outline"}
          className="text-[10px]"
        >
          {counter.label}: {counter.formattedValue}
        </Badge>
      ))}
    </div>
  );
}

export function InspectorFieldBadge({ field }: InspectorFieldBadgeProps) {
  return <Badge variant="outline">{getInspectorPanelFieldLabel(field)}</Badge>;
}

export function InspectorPipelineBadge({ pipelineId }: InspectorPipelineBadgeProps) {
  return pipelineId ? (
    <Badge variant="outline" className="max-w-[220px] truncate">{pipelineId}</Badge>
  ) : null;
}

export function InspectorFocusModeBadge({ mode }: InspectorFocusModeBadgeProps) {
  return <Badge variant={mode === "top" ? "outline" : "secondary"}>{mode}</Badge>;
}

export function InspectorPartitionBadge({ partition, mode }: InspectorPartitionBadgeProps) {
  return <Badge variant={mode === "top" ? "outline" : "secondary"}>{partition}</Badge>;
}

export function InspectorHeatmapAxisControls({
  axes,
  onXAxisChange,
  onYAxisChange,
}: InspectorHeatmapAxisControlsProps) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">X</span>
      <Select
        value={axes.xVariable}
        onValueChange={(val) => onXAxisChange(val as InspectorHeatmapAxisField)}
      >
        <SelectTrigger className="h-7 w-[130px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {INSPECTOR_HEATMAP_AXIS_OPTIONS.map(opt => (
            <SelectItem key={opt} value={opt}>{getInspectorPanelFieldLabel(opt)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-[10px] text-muted-foreground">&times;</span>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Y</span>
      <Select
        value={axes.yVariable}
        onValueChange={(val) => onYAxisChange(val as InspectorHeatmapAxisField)}
      >
        <SelectTrigger className="h-7 w-[130px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {INSPECTOR_HEATMAP_AXIS_OPTIONS.map(opt => (
            <SelectItem key={opt} value={opt}>{getInspectorPanelFieldLabel(opt)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function InspectorHyperparameterSelect({
  availableHyperParams,
  activeHyperParam,
  onChange,
}: InspectorHyperparameterSelectProps) {
  if (availableHyperParams.length === 0) return null;

  return (
    <Select value={activeHyperParam} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-[190px] text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {availableHyperParams.map(param => (
          <SelectItem key={param} value={param}>
            {param}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function InspectorBiasVarianceGroupSelect({
  value,
  onChange,
}: InspectorBiasVarianceGroupSelectProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-[170px] text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {INSPECTOR_BIAS_VARIANCE_GROUP_OPTIONS.map(option => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

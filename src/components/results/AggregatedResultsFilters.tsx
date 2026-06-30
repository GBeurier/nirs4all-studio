import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AggregatedResultsFacets } from "@/lib/aggregatedResultsData";

interface AggregatedResultsFiltersProps {
  search: string;
  datasetFilter: string;
  modelClassFilter: string;
  metricFilter: string;
  facets: AggregatedResultsFacets;
  hasActiveFilters: boolean;
  searchPlaceholder: string;
  clearLabel: string;
  onSearchChange: (value: string) => void;
  onDatasetFilterChange: (value: string) => void;
  onModelClassFilterChange: (value: string) => void;
  onMetricFilterChange: (value: string) => void;
  onClearFilters: () => void;
}

export function AggregatedResultsFilters({
  search,
  datasetFilter,
  modelClassFilter,
  metricFilter,
  facets,
  hasActiveFilters,
  searchPlaceholder,
  clearLabel,
  onSearchChange,
  onDatasetFilterChange,
  onModelClassFilterChange,
  onMetricFilterChange,
  onClearFilters,
}: AggregatedResultsFiltersProps) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="relative flex-1 min-w-[200px] max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={searchPlaceholder}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          className="pl-9 h-9"
        />
      </div>

      <Select value={datasetFilter} onValueChange={onDatasetFilterChange}>
        <SelectTrigger className="w-[160px] h-9 text-sm">
          <SelectValue placeholder="Dataset" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Datasets</SelectItem>
          {facets.datasets.map((dataset) => (
            <SelectItem key={dataset} value={dataset}>{dataset}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={modelClassFilter} onValueChange={onModelClassFilterChange}>
        <SelectTrigger className="w-[160px] h-9 text-sm">
          <SelectValue placeholder="Model" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Models</SelectItem>
          {facets.modelClasses.map((modelClass) => (
            <SelectItem key={modelClass} value={modelClass}>{modelClass}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={metricFilter} onValueChange={onMetricFilterChange}>
        <SelectTrigger className="w-[140px] h-9 text-sm">
          <SelectValue placeholder="Metric" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Metrics</SelectItem>
          {facets.metrics.map((metric) => (
            <SelectItem key={metric} value={metric}>{metric}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={onClearFilters}>
          {clearLabel}
        </Button>
      )}
    </div>
  );
}

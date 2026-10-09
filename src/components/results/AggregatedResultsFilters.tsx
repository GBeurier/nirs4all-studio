import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="relative flex-1 min-w-[200px] max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          className="pl-9 h-9"
        />
      </div>

      <Select value={datasetFilter} onValueChange={onDatasetFilterChange}>
        <SelectTrigger className="w-[160px] h-9 text-sm" aria-label={t("aggregatedResults.filters.dataset")}>
          <SelectValue placeholder={t("aggregatedResults.filters.dataset")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("aggregatedResults.filters.allDatasets")}</SelectItem>
          {facets.datasets.map((dataset) => (
            <SelectItem key={dataset} value={dataset}>{dataset}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={modelClassFilter} onValueChange={onModelClassFilterChange}>
        <SelectTrigger className="w-[160px] h-9 text-sm" aria-label={t("aggregatedResults.filters.model")}>
          <SelectValue placeholder={t("aggregatedResults.filters.model")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("aggregatedResults.filters.allModels")}</SelectItem>
          {facets.modelClasses.map((modelClass) => (
            <SelectItem key={modelClass} value={modelClass}>{modelClass}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={metricFilter} onValueChange={onMetricFilterChange}>
        <SelectTrigger className="w-[140px] h-9 text-sm" aria-label={t("aggregatedResults.filters.metric")}>
          <SelectValue placeholder={t("aggregatedResults.filters.metric")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("aggregatedResults.filters.allMetrics")}</SelectItem>
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

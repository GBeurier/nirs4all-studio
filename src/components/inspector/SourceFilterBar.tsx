/**
 * SourceFilterBar — Horizontal multi-select filter bar for Inspector.
 *
 * Replaces the old SourceSelector with multi-value faceted filters:
 * Runs, Datasets, Models, Preprocessing (multi-select), Task Type, Metric (single-select).
 */

import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useInspectorData } from '@/context/useInspectorDataContext';
import {
  buildInspectorSourceFilterBarModel,
  patchInspectorSourceArrayFilter,
  patchInspectorSourceValueFilter,
} from '@/lib/inspector/sourceFilterBar';
import { InspectorSourceFacetFilter } from './InspectorSourceFacetFilter';

// ============= Main Component =============

export function SourceFilterBar() {
  const { t } = useTranslation();
  const {
    filters,
    setFilters,
    availableRuns,
    availableDatasets,
    availableModels,
    availablePreprocessings,
    availableMetrics,
    totalChains,
    isLoading,
  } = useInspectorData();

  const filterBar = buildInspectorSourceFilterBarModel({
    filters,
    availableRuns,
    availableDatasets,
    availableModels,
    availablePreprocessings,
    availableMetrics,
    totalChains,
    isLoading,
  });

  const clearAll = () => setFilters({});

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-card/50 shrink-0 overflow-x-auto">
      {filterBar.facets.map(facet => (
        <InspectorSourceFacetFilter
          key={facet.id}
          label={t(facet.labelKey, facet.defaultLabel)}
          values={facet.values}
          selected={facet.selected}
          onChange={(values) => setFilters(patchInspectorSourceArrayFilter(filters, facet.id, values))}
        />
      ))}

      {/* Single-select: Task Type */}
      <Select
        value={filterBar.taskType.value}
        onValueChange={(value) => setFilters(patchInspectorSourceValueFilter(filters, filterBar.taskType.id, value))}
      >
        <SelectTrigger className="h-7 w-auto min-w-[100px] text-xs shrink-0">
          <SelectValue placeholder={filterBar.taskType.placeholder} />
        </SelectTrigger>
        <SelectContent>
          {filterBar.taskType.options.map(option => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Single-select: Metric */}
      {filterBar.metric && (
        <Select
          value={filterBar.metric.value}
          onValueChange={(value) => setFilters(patchInspectorSourceValueFilter(filters, filterBar.metric!.id, value))}
        >
          <SelectTrigger className="h-7 w-auto min-w-[100px] text-xs shrink-0">
            <SelectValue placeholder={filterBar.metric.placeholder} />
          </SelectTrigger>
          <SelectContent>
            {filterBar.metric.options.map(option => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Separator + chain count */}
      <div className="h-5 w-px bg-border shrink-0 mx-1" />
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        {filterBar.chainCountLabel}
      </span>

      {/* Clear all */}
      {filterBar.hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[10px] text-muted-foreground shrink-0"
          onClick={clearAll}
        >
          <X className="w-3 h-3 mr-0.5" />
          Clear
        </Button>
      )}
    </div>
  );
}

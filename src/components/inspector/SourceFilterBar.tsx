/**
 * SourceFilterBar — Horizontal multi-select filter bar for Inspector.
 *
 * Replaces the old SourceSelector with multi-value faceted filters:
 * Runs, Datasets, Models, Preprocessing (multi-select), Task Type, Metric (single-select).
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useInspectorData } from '@/context/InspectorDataContext';
import type { InspectorDataFilters } from '@/types/inspector';

// ============= Multi-Select Facet =============

interface FacetFilterProps {
  label: string;
  values: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

function FacetFilter({ label, values, selected, onChange }: FacetFilterProps) {
  const [open, setOpen] = useState(false);

  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter(v => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const selectAll = () => onChange([...values]);
  const clearAll = () => onChange([]);

  const count = selected.length;
  const total = values.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={count > 0 ? 'secondary' : 'outline'}
          size="sm"
          className="h-7 px-2.5 text-xs gap-1.5 shrink-0"
        >
          <span>{label}</span>
          {count > 0 && (
            <Badge variant="default" className="h-4 px-1 text-[10px] rounded-full min-w-4 justify-center">
              {count}/{total}
            </Badge>
          )}
          <ChevronsUpDown className="w-3 h-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder={`Search ${label.toLowerCase()}...`} className="h-8 text-xs" />
          <div className="flex items-center gap-1 px-2 py-1.5 border-b">
            <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" onClick={selectAll}>
              All
            </Button>
            <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" onClick={clearAll}>
              None
            </Button>
          </div>
          <CommandList>
            <CommandEmpty className="py-3 text-xs">No results.</CommandEmpty>
            <CommandGroup>
              {values.map(value => {
                const isSelected = selected.includes(value);
                return (
                  <CommandItem
                    key={value}
                    value={value}
                    onSelect={() => toggle(value)}
                    className="text-xs gap-2 cursor-pointer"
                  >
                    <Checkbox
                      checked={isSelected}
                      className="h-3.5 w-3.5"
                      tabIndex={-1}
                    />
                    <span className="truncate flex-1">{value}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

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

  const updateFilter = (patch: Partial<InspectorDataFilters>) => {
    setFilters({ ...filters, ...patch });
  };

  const hasFilters = !!(
    filters.run_ids?.length ||
    filters.dataset_names?.length ||
    filters.model_classes?.length ||
    filters.preprocessings?.length ||
    filters.task_type ||
    filters.metric
  );

  const clearAll = () => setFilters({});

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-card/50 shrink-0 overflow-x-auto">
      {/* Multi-select facets */}
      <FacetFilter
        label={t('inspector.filter.runs', 'Runs')}
        values={availableRuns}
        selected={filters.run_ids ?? []}
        onChange={(run_ids) => updateFilter({ run_ids: run_ids.length ? run_ids : undefined })}
      />
      <FacetFilter
        label={t('inspector.filter.datasets', 'Datasets')}
        values={availableDatasets}
        selected={filters.dataset_names ?? []}
        onChange={(dataset_names) => updateFilter({ dataset_names: dataset_names.length ? dataset_names : undefined })}
      />
      <FacetFilter
        label={t('inspector.filter.models', 'Models')}
        values={availableModels}
        selected={filters.model_classes ?? []}
        onChange={(model_classes) => updateFilter({ model_classes: model_classes.length ? model_classes : undefined })}
      />
      <FacetFilter
        label={t('inspector.filter.preprocessing', 'Preprocessing')}
        values={availablePreprocessings}
        selected={filters.preprocessings ?? []}
        onChange={(preprocessings) => updateFilter({ preprocessings: preprocessings.length ? preprocessings : undefined })}
      />

      {/* Single-select: Task Type */}
      <Select
        value={filters.task_type ?? '__all__'}
        onValueChange={(val) => updateFilter({ task_type: val === '__all__' ? undefined : val })}
      >
        <SelectTrigger className="h-7 w-auto min-w-[100px] text-xs shrink-0">
          <SelectValue placeholder="Type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All Types</SelectItem>
          <SelectItem value="regression">Regression</SelectItem>
          <SelectItem value="classification">Classification</SelectItem>
        </SelectContent>
      </Select>

      {/* Single-select: Metric */}
      {availableMetrics.length > 0 && (
        <Select
          value={filters.metric ?? '__all__'}
          onValueChange={(val) => updateFilter({ metric: val === '__all__' ? undefined : val })}
        >
          <SelectTrigger className="h-7 w-auto min-w-[100px] text-xs shrink-0">
            <SelectValue placeholder="Metric" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Metrics</SelectItem>
            {availableMetrics.map(m => (
              <SelectItem key={m} value={m}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Separator + chain count */}
      <div className="h-5 w-px bg-border shrink-0 mx-1" />
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        {isLoading ? '...' : `${totalChains} chains`}
      </span>

      {/* Clear all */}
      {hasFilters && (
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

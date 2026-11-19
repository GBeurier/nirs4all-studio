import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { fetchMetadataColumns, type MetadataColumnInfo } from '@/api/playground';
import {
  normalizeShapPartition,
  SHAP_PARTITION_OPTIONS,
  type ShapSubsetOptions,
} from '@/lib/shapVariableImportanceFormData';
import type { ShapSubset, ShapSubsetFilter } from '@/types/shap';

interface ShapSubsetsPanelProps {
  datasetId: string | null;
  subsets: ShapSubsetOptions;
  onChange: (subsets: ShapSubsetOptions) => void;
}

type FilterValue = ShapSubsetFilter['values'][number];

function FilterEditor({ filter, columns, onChange, onRemove }: {
  filter: ShapSubsetFilter;
  columns: MetadataColumnInfo[];
  onChange: (filter: ShapSubsetFilter) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const info = columns.find((column) => column.name === filter.column);
  const toggle = (value: FilterValue) => onChange({
    ...filter,
    values: filter.values.includes(value) ? filter.values.filter((current) => current !== value) : [...filter.values, value],
  });
  return (
    <div className="space-y-1 rounded border border-border p-2">
      <div className="flex items-center gap-1">
        <Select value={filter.column || undefined} onValueChange={(column) => onChange({ column, values: [] })}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder={t('shap.subsets.selectColumn')} />
          </SelectTrigger>
          <SelectContent>
            {columns.map((column) => (
              <SelectItem key={column.name} value={column.name}>{column.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onRemove} aria-label={t('shap.subsets.removeFilter')}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      {info && (
        <div className="max-h-32 overflow-y-auto space-y-1">
          {info.unique_values.map((value) => (
            <label key={String(value)} className="flex items-center gap-2 cursor-pointer text-xs hover:bg-accent/50 rounded px-1 py-0.5">
              <Checkbox checked={filter.values.includes(value)} onCheckedChange={() => toggle(value)} className="h-3.5 w-3.5" />
              <span className="truncate">{String(value ?? 'null')}</span>
            </label>
          ))}
          {info.n_unique > info.unique_values.length && (
            <p className="text-[10px] text-muted-foreground px-1">
              {t('shap.subsets.truncated', { shown: info.unique_values.length, total: info.n_unique })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SubsetEditor({ title, help, subset, columns, onChange }: {
  title: string;
  help: string;
  subset: ShapSubset;
  columns: MetadataColumnInfo[];
  onChange: (subset: ShapSubset) => void;
}) {
  const { t } = useTranslation();
  const setFilter = (index: number, filter: ShapSubsetFilter) =>
    onChange({ ...subset, filters: subset.filters.map((current, position) => (position === index ? filter : current)) });
  return (
    <div className="space-y-2">
      <div>
        <Label className="text-sm font-medium">{title}</Label>
        <p className="text-xs text-muted-foreground">{help}</p>
      </div>
      <Select value={subset.partition} onValueChange={(value) => onChange({ ...subset, partition: normalizeShapPartition(value) })}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SHAP_PARTITION_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>{t(option.labelKey)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {subset.filters.map((filter, index) => (
        <FilterEditor
          key={index}
          filter={filter}
          columns={columns}
          onChange={(next) => setFilter(index, next)}
          onRemove={() => onChange({ ...subset, filters: subset.filters.filter((_, position) => position !== index) })}
        />
      ))}
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs gap-1"
        disabled={columns.length === 0}
        onClick={() => onChange({ ...subset, filters: [...subset.filters, { column: '', values: [] }] })}
      >
        <Plus className="h-3 w-3" /> {t('shap.subsets.addFilter')}
      </Button>
    </div>
  );
}

/**
 * Advanced, collapsed by default: metadata subsets for the background
 * candidates and the explained samples. Inactive unless checked; the classic
 * partition applies otherwise.
 */
export function ShapSubsetsPanel({ datasetId, subsets, onChange }: ShapSubsetsPanelProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(subsets.enabled);
  const { data, isError } = useQuery({
    queryKey: ['metadata-columns', datasetId, 'all'],
    queryFn: ({ signal }) => fetchMetadataColumns(datasetId!, signal, 'all'),
    enabled: open && Boolean(datasetId),
    staleTime: 60_000,
  });
  const columns = data?.columns ?? [];

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-md border border-border">
      <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium">
        <span>
          {t('shap.subsets.title')}
          {subsets.enabled && <span className="ml-2 text-xs text-emerald-600">{t('shap.subsets.active')}</span>}
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 px-3 pb-3">
        <label className="flex items-start gap-2 cursor-pointer text-sm">
          <Checkbox
            checked={subsets.enabled}
            onCheckedChange={(checked) => onChange({ ...subsets, enabled: checked === true })}
            className="mt-0.5"
          />
          <span>
            {t('shap.subsets.enable')}
            <span className="block text-xs text-muted-foreground">{t('shap.subsets.enableHelp')}</span>
          </span>
        </label>
        {!datasetId && <p className="text-xs text-muted-foreground">{t('shap.subsets.selectModelFirst')}</p>}
        {isError && <p className="text-xs text-destructive">{t('shap.subsets.metadataUnavailable')}</p>}
        {datasetId && !isError && data && columns.length === 0 && (
          <p className="text-xs text-muted-foreground">{t('shap.subsets.noMetadata')}</p>
        )}
        <fieldset disabled={!subsets.enabled} className="space-y-4 disabled:opacity-50">
          <SubsetEditor
            title={t('shap.subsets.background')}
            help={t('shap.subsets.backgroundHelp')}
            subset={subsets.background}
            columns={columns}
            onChange={(background) => onChange({ ...subsets, background })}
          />
          <SubsetEditor
            title={t('shap.subsets.explained')}
            help={t('shap.subsets.explainedHelp')}
            subset={subsets.explained}
            columns={columns}
            onChange={(explained) => onChange({ ...subsets, explained })}
          />
        </fieldset>
      </CollapsibleContent>
    </Collapsible>
  );
}

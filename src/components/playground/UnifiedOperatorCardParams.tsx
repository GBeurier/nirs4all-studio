import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { fetchMetadataColumns, type MetadataColumnInfo } from '@/api/playground';
import { cn } from '@/lib/utils';
import { useSliderWithCommit, useCommittedInput } from '@/lib/playground/debounce';
import {
  getRuntimeGroupingSummary,
  RUNTIME_GROUPING_COPY,
} from '@/lib/runtimeSplitGrouping';
import { supportsRuntimeGroupBy } from '@/lib/playground/unifiedOperatorCardData';
import type { OperatorParamInfo } from '@/types/playground';

import type { SplitRuntimeMetadata } from './UnifiedOperatorCardTypes';
import {
  coerceWindowLengthValue,
  formatNumericParamDisplayValue,
  formatParamDisplayName,
  getNumericParamConfig,
  getVisibleParamEntries,
  normalizeNumericParamValue,
} from './UnifiedOperatorCardParamsData';

interface DynamicParamRendererProps {
  params: Record<string, unknown>;
  paramDefs: Record<string, OperatorParamInfo>;
  datasetId?: string;
  splitMetadata?: SplitRuntimeMetadata;
  localMetadataColumns?: MetadataColumnInfo[];
  onUpdate: (key: string, value: unknown) => void;
}

export function DynamicParamRenderer({
  params,
  paramDefs,
  datasetId,
  splitMetadata,
  localMetadataColumns = [],
  onUpdate,
}: DynamicParamRendererProps) {
  const visibleParams = getVisibleParamEntries(paramDefs);
  const showsGroupBy = supportsRuntimeGroupBy(splitMetadata);

  if (visibleParams.length === 0 && !showsGroupBy) {
    return <p className="text-xs text-muted-foreground">No parameters</p>;
  }

  return (
    <>
      {showsGroupBy && (
        <GroupByParamInput
          value={typeof params.group_by === 'string' ? params.group_by : null}
          datasetId={datasetId}
          localColumns={localMetadataColumns}
          groupRequired={splitMetadata?.groupRequired ?? false}
          onUpdate={onUpdate}
        />
      )}
      {visibleParams.map(([key, info]) => (
        <ParamInput
          key={key}
          paramKey={key}
          paramInfo={info}
          value={params[key] ?? info.default}
          datasetId={datasetId}
          localMetadataColumns={localMetadataColumns}
          allParams={params}
          onUpdate={onUpdate}
        />
      ))}
    </>
  );
}

interface ParamInputProps {
  paramKey: string;
  paramInfo: OperatorParamInfo;
  value: unknown;
  datasetId?: string;
  localMetadataColumns?: MetadataColumnInfo[];
  allParams?: Record<string, unknown>;
  onUpdate: (key: string, value: unknown) => void;
}

function ParamInput({
  paramKey,
  paramInfo,
  value,
  datasetId,
  localMetadataColumns = [],
  allParams,
  onUpdate,
}: ParamInputProps) {
  const displayName = formatParamDisplayName(paramKey);

  if (paramInfo.type === 'metadata_column') {
    return (
      <MetadataColumnSelect
        paramKey={paramKey}
        displayName={displayName}
        value={String(value ?? '')}
        datasetId={datasetId}
        localColumns={localMetadataColumns}
        onUpdate={onUpdate}
      />
    );
  }

  if (paramInfo.type === 'array' && paramInfo.dynamicSource === 'metadata_values') {
    return (
      <MetadataValueSelect
        paramKey={paramKey}
        displayName={displayName}
        value={value as (string | number | boolean | null)[] | null}
        datasetId={datasetId}
        localColumns={localMetadataColumns}
        column={String(allParams?.column ?? '')}
        onUpdate={onUpdate}
      />
    );
  }

  if (paramInfo.type === 'bool' || typeof value === 'boolean') {
    return (
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">{displayName}</Label>
        <Switch
          checked={value as boolean}
          onCheckedChange={(checked) => onUpdate(paramKey, checked)}
        />
      </div>
    );
  }

  if (paramInfo.type === 'select' && paramInfo.options) {
    return (
      <div>
        <Label className="text-xs text-muted-foreground">{displayName}</Label>
        <Select
          value={String(value ?? paramInfo.default ?? '')}
          onValueChange={(selectedValue) => {
            const originalOption = paramInfo.options!.find(
              (option) => String(option.value) === selectedValue
            );
            onUpdate(paramKey, originalOption?.value ?? selectedValue);
          }}
        >
          <SelectTrigger className="h-8 text-xs mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {paramInfo.options.map((option) => (
              <SelectItem key={String(option.value)} value={String(option.value)} className="text-xs">
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (paramInfo.type === 'int' || paramInfo.type === 'float') {
    return (
      <NumericParamInput
        paramKey={paramKey}
        displayName={displayName}
        value={value}
        paramInfo={paramInfo}
        onUpdate={onUpdate}
      />
    );
  }

  return (
    <TextParamInput
      paramKey={paramKey}
      displayName={displayName}
      value={String(value ?? '')}
      onUpdate={onUpdate}
    />
  );
}

function GroupByParamInput({
  value,
  datasetId,
  localColumns,
  groupRequired,
  onUpdate,
}: {
  value: string | null;
  datasetId?: string;
  localColumns: MetadataColumnInfo[];
  groupRequired: boolean;
  onUpdate: (key: string, value: unknown) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['metadata-columns', datasetId],
    queryFn: ({ signal }) => fetchMetadataColumns(datasetId!, signal),
    enabled: !!datasetId,
    staleTime: 60_000,
  });

  const availableColumns = useMemo(() => {
    const byName = new Map<string, MetadataColumnInfo>();
    for (const column of data?.columns ?? []) {
      byName.set(column.name, column);
    }
    for (const column of localColumns) {
      if (!byName.has(column.name)) {
        byName.set(column.name, column);
      }
    }

    if (value && !byName.has(value)) {
      byName.set(value, {
        name: value,
        dtype: 'unknown',
        unique_values: [],
        n_unique: 0,
      });
    }

    return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [data?.columns, localColumns, value]);

  const repetitionColumn = data?.repetition_column ?? null;
  const isRequired = groupRequired && !repetitionColumn;
  const hasValue = typeof value === 'string' && value.length > 0;

  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-muted/20 p-2.5">
      <div className="flex items-center gap-2">
        <Label className="text-xs text-muted-foreground">
          Group By
          {isRequired && <span className="ml-1 text-destructive">*</span>}
        </Label>
        {groupRequired && (
          <Badge
            variant="outline"
            className={cn(
              'h-4 px-1.5 text-[10px]',
              isRequired ? 'border-destructive/40 text-destructive' : 'border-amber-500/40 text-amber-700 dark:text-amber-400'
            )}
          >
            {isRequired ? 'Required' : 'Optional with repetition'}
          </Badge>
        )}
      </div>

      <Select
        value={value ?? '__none__'}
        onValueChange={(selected) => onUpdate('group_by', selected === '__none__' ? null : selected)}
      >
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder={isLoading ? 'Loading metadata columns...' : 'Select metadata column'} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__" className="text-xs">
            No additional group
          </SelectItem>
          {availableColumns.length === 0 && !isLoading && (
            <SelectItem value="__empty__" disabled className="text-xs text-muted-foreground">
              No metadata columns available
            </SelectItem>
          )}
          {availableColumns.map((column) => (
            <SelectItem key={column.name} value={column.name} className="text-xs">
              {column.name}
              {column.n_unique > 0 ? ` (${column.n_unique} values)` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {RUNTIME_GROUPING_COPY.additiveDescription}
      </p>

      {repetitionColumn && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
            Dataset repetition
          </Badge>
          <span className="font-mono">{repetitionColumn}</span>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {RUNTIME_GROUPING_COPY.legacyGroupDeprecation}
      </p>

      {hasValue && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {getRuntimeGroupingSummary(repetitionColumn, value)}
        </p>
      )}

      {groupRequired && !hasValue && repetitionColumn && (
        <p className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
          No additional group_by selected. This split will use only the configured dataset repetition.
        </p>
      )}

      {groupRequired && !hasValue && !repetitionColumn && (
        <p className="text-[11px] leading-relaxed text-destructive">
          This splitter requires an effective group. Select a metadata column.
        </p>
      )}
    </div>
  );
}

interface TextParamInputProps {
  paramKey: string;
  displayName: string;
  value: string;
  onUpdate: (key: string, value: unknown) => void;
}

function TextParamInput({ paramKey, displayName, value, onUpdate }: TextParamInputProps) {
  const commitHandler = useCallback((committedValue: string) => {
    onUpdate(paramKey, committedValue);
  }, [paramKey, onUpdate]);

  const {
    value: localValue,
    onChange,
    onBlur,
    onKeyDown,
    isDirty,
  } = useCommittedInput(value, commitHandler);

  return (
    <div>
      <Label className="text-xs text-muted-foreground">
        {displayName}
        {isDirty && <span className="text-primary ml-1">*</span>}
      </Label>
      <Input
        value={localValue}
        onChange={onChange}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        className={cn(
          'h-8 text-xs mt-1',
          isDirty && 'border-primary/50 ring-1 ring-primary/20'
        )}
        placeholder="Press Enter to apply"
      />
    </div>
  );
}

interface NumericParamInputProps {
  paramKey: string;
  displayName: string;
  value: unknown;
  paramInfo: OperatorParamInfo;
  onUpdate: (key: string, value: unknown) => void;
}

function NumericParamInput({
  paramKey,
  displayName,
  value,
  paramInfo,
  onUpdate,
}: NumericParamInputProps) {
  const isInt = paramInfo.type === 'int';
  const { min, max, step } = getNumericParamConfig(paramKey, paramInfo, isInt);
  const safeValue = normalizeNumericParamValue(value, isInt, min);

  const commitHandler = useCallback((committedValue: number) => {
    onUpdate(paramKey, committedValue);
  }, [paramKey, onUpdate]);

  const {
    value: localValue,
    onChange: onLocalChange,
    onValueCommit,
  } = useSliderWithCommit(safeValue, commitHandler);

  const handleSliderChange = ([changedValue]: number[]) => {
    onLocalChange(coerceWindowLengthValue(paramKey, changedValue));
  };

  const handleCommit = ([committedValue]: number[]) => {
    onValueCommit(coerceWindowLengthValue(paramKey, committedValue));
  };

  return (
    <div>
      <Label className="text-xs text-muted-foreground">
        {displayName}: {formatNumericParamDisplayValue(localValue, isInt)}
      </Label>
      <Slider
        value={[localValue ?? safeValue]}
        onValueChange={handleSliderChange}
        onValueCommit={handleCommit}
        min={min}
        max={max}
        step={step}
        className="mt-2"
      />
    </div>
  );
}

function MetadataColumnSelect({
  paramKey,
  displayName,
  value,
  datasetId,
  localColumns,
  onUpdate,
}: {
  paramKey: string;
  displayName: string;
  value: string;
  datasetId?: string;
  localColumns?: MetadataColumnInfo[];
  onUpdate: (key: string, value: unknown) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['metadata-columns', datasetId],
    queryFn: ({ signal }) => fetchMetadataColumns(datasetId!, signal),
    enabled: !!datasetId,
    staleTime: 60_000,
  });

  const columns = (localColumns && localColumns.length > 0) ? localColumns : (data?.columns ?? []);

  if (!datasetId && columns.length === 0) {
    return (
      <div>
        <Label className="text-xs text-muted-foreground">{displayName}</Label>
        <p className="text-xs text-muted-foreground mt-1">Load a dataset to see available columns</p>
      </div>
    );
  }

  return (
    <div>
      <Label className="text-xs text-muted-foreground">{displayName}</Label>
      <Select
        value={value || undefined}
        onValueChange={(selectedValue) => onUpdate(paramKey, selectedValue)}
      >
        <SelectTrigger className="h-8 text-xs mt-1">
          <SelectValue placeholder={isLoading ? 'Loading...' : 'Select column'} />
        </SelectTrigger>
        <SelectContent>
          {columns.length === 0 && !isLoading && (
            <SelectItem value="__none__" disabled className="text-xs text-muted-foreground">
              No metadata columns available
            </SelectItem>
          )}
          {columns.map((column) => (
            <SelectItem key={column.name} value={column.name} className="text-xs">
              {column.name} ({column.n_unique} values)
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function MetadataValueSelect({
  paramKey,
  displayName,
  value,
  datasetId,
  localColumns,
  column,
  onUpdate,
}: {
  paramKey: string;
  displayName: string;
  value: (string | number | boolean | null)[] | null;
  datasetId?: string;
  localColumns?: MetadataColumnInfo[];
  column: string;
  onUpdate: (key: string, value: unknown) => void;
}) {
  const { data } = useQuery({
    queryKey: ['metadata-columns', datasetId],
    queryFn: ({ signal }) => fetchMetadataColumns(datasetId!, signal),
    enabled: !!datasetId,
    staleTime: 60_000,
  });

  const columnInfo = useMemo(
    () => {
      const columns = (localColumns && localColumns.length > 0) ? localColumns : (data?.columns ?? []);
      return columns.find((candidate) => candidate.name === column);
    },
    [data?.columns, localColumns, column]
  );

  const uniqueValues = columnInfo?.unique_values ?? [];
  const selectedValues = value ?? [];

  if (!column) {
    return (
      <div>
        <Label className="text-xs text-muted-foreground">{displayName}</Label>
        <p className="text-xs text-muted-foreground mt-1">Select a column first</p>
      </div>
    );
  }

  if (uniqueValues.length === 0) {
    return (
      <div>
        <Label className="text-xs text-muted-foreground">{displayName}</Label>
        <p className="text-xs text-muted-foreground mt-1">No values found</p>
      </div>
    );
  }

  const toggleValue = (selectedValue: string | number | boolean | null) => {
    const isSelected = selectedValues.includes(selectedValue);
    const newValues = isSelected
      ? selectedValues.filter((currentValue) => currentValue !== selectedValue)
      : [...selectedValues, selectedValue];
    onUpdate(paramKey, newValues.length > 0 ? newValues : null);
  };

  return (
    <div>
      <Label className="text-xs text-muted-foreground">
        {displayName} {selectedValues.length > 0 && `(${selectedValues.length})`}
      </Label>
      <div className="mt-1 max-h-32 overflow-y-auto space-y-1 rounded border border-border p-1.5">
        {uniqueValues.map((uniqueValue) => {
          const stringValue = String(uniqueValue ?? 'null');
          return (
            <label key={stringValue} className="flex items-center gap-2 cursor-pointer text-xs hover:bg-accent/50 rounded px-1 py-0.5">
              <Checkbox
                checked={selectedValues.includes(uniqueValue)}
                onCheckedChange={() => toggleValue(uniqueValue)}
                className="h-3.5 w-3.5"
              />
              <span className="truncate">{stringValue}</span>
            </label>
          );
        })}
        {columnInfo && columnInfo.n_unique > uniqueValues.length && (
          <p className="text-[10px] text-muted-foreground px-1">
            Showing {uniqueValues.length} of {columnInfo.n_unique} values
          </p>
        )}
      </div>
    </div>
  );
}

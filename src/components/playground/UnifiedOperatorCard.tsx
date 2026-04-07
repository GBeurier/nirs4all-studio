/**
 * UnifiedOperatorCard - Operator card for unified format
 *
 * Supports both preprocessing and splitting operators.
 * Uses dynamic parameter rendering based on operator definition.
 * Shows filter statistics ("N samples removed") for filter operators.
 */

import { useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GripVertical, X, ChevronDown, ChevronUp, Eye, EyeOff, Grid3X3, HelpCircle, Trash2, Filter, AlertCircle, AlertTriangle, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useSliderWithCommit, useCommittedInput } from '@/lib/playground/debounce';
import { Checkbox } from '@/components/ui/checkbox';
import type { UnifiedOperator, OperatorParamInfo, FilterResult } from '@/types/playground';
import { fetchMetadataColumns, type MetadataColumnInfo } from '@/api/playground';

interface UnifiedOperatorCardProps {
  operator: UnifiedOperator;
  index: number;
  paramDefs?: Record<string, OperatorParamInfo>;
  description?: string;
  /** Filter statistics from execution result - name is optional since we key by operator name externally */
  filterStats?: { removed_count: number; reason?: string; mode?: 'remove' | 'tag' };
  /** Error message if this operator failed during execution */
  errorMessage?: string;
  /** Current dataset ID for dynamic parameter fetching (e.g., MetadataFilter) */
  datasetId?: string;
  onUpdate: (id: string, updates: Partial<UnifiedOperator>) => void;
  onUpdateParams: (id: string, params: Record<string, unknown>) => void;
  onRemove: (id: string) => void;
  onToggle: (id: string) => void;
  onDragStart: (e: React.DragEvent, index: number) => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDragEnd: () => void;
  isDragging: boolean;
}

export function UnifiedOperatorCard({
  operator,
  index,
  paramDefs,
  description,
  filterStats,
  errorMessage,
  datasetId,
  onUpdate,
  onUpdateParams,
  onRemove,
  onToggle,
  onDragStart,
  onDragOver,
  onDragEnd,
  isDragging,
}: UnifiedOperatorCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showErrorDialog, setShowErrorDialog] = useState(false);

  const isSplitter = operator.type === 'splitting';
  const isFilter = operator.type === 'filter';
  const isAugmentation = operator.type === 'augmentation';
  const hasParams = paramDefs && Object.keys(paramDefs).length > 0;
  const hasError = !!errorMessage;

  // Filter statistics display
  const hasFilterStats = isFilter && filterStats && filterStats.removed_count > 0;

  // Get display name (convert CamelCase to readable)
  const displayName = operator.name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim();

  // Get border color based on type (failed operators take precedence)
  const getBorderColor = () => {
    if (hasError) return 'border-destructive/70';
    if (isFilter) return 'border-red-500/50';
    if (isSplitter) return 'border-orange-500/50';
    if (isAugmentation) return 'border-blue-500/50';
    return 'border-border';
  };

  const handleCopyError = useCallback(() => {
    if (!errorMessage) return;
    navigator.clipboard.writeText(errorMessage).then(
      () => toast.success('Error copied to clipboard'),
      () => toast.error('Failed to copy error')
    );
  }, [errorMessage]);

  return (
    <TooltipProvider>
      <div
        draggable
        onDragStart={(e) => onDragStart(e, index)}
        onDragOver={(e) => onDragOver(e, index)}
        onDragEnd={onDragEnd}
        className={cn(
          'bg-muted rounded-lg border transition-all duration-200',
          isDragging && 'opacity-50 scale-95',
          !operator.enabled && 'opacity-60',
          getBorderColor()
        )}
      >
        <div className="flex items-center gap-1 p-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="cursor-grab hover:text-primary">
                <GripVertical className="w-4 h-4 text-muted-foreground" />
              </div>
            </TooltipTrigger>
            <TooltipContent side="left">Drag to reorder</TooltipContent>
          </Tooltip>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-mono text-muted-foreground">{index + 1}</span>
              {isFilter && (
                <Filter className="w-3 h-3 text-red-500" />
              )}
              {isSplitter && (
                <Grid3X3 className="w-3 h-3 text-orange-500" />
              )}
              <span className="text-xs font-medium text-foreground truncate">
                {displayName}
              </span>
              {description && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="w-3 h-3 text-muted-foreground hover:text-primary cursor-help flex-shrink-0" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs">
                    <p className="text-xs">{description}</p>
                  </TooltipContent>
                </Tooltip>
              )}
              {/* Failure badge - opens dialog with full error log */}
              {hasError && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowErrorDialog(true);
                      }}
                      className="inline-flex items-center gap-0.5 h-4 px-1.5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-medium leading-none hover:bg-destructive/90 focus:outline-none focus:ring-1 focus:ring-destructive/40 cursor-pointer flex-shrink-0"
                    >
                      <AlertTriangle className="w-2.5 h-2.5 flex-shrink-0" />
                      <span>Failed</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs">
                    <p className="text-xs">Click to view error log</p>
                  </TooltipContent>
                </Tooltip>
              )}
              {/* Filter statistics badge */}
              {hasFilterStats && filterStats.mode === 'tag' ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="outline"
                      className="h-4 px-1.5 text-[10px] font-medium gap-0.5 cursor-help border-amber-500/50 text-amber-600 dark:text-amber-400"
                    >
                      <AlertCircle className="w-2.5 h-2.5" />
                      {filterStats.removed_count} tagged
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs">
                    <p className="text-xs">
                      {filterStats.removed_count} sample{filterStats.removed_count !== 1 ? 's' : ''} tagged as outliers (visible in charts)
                      {filterStats.reason && `: ${filterStats.reason}`}
                    </p>
                  </TooltipContent>
                </Tooltip>
              ) : hasFilterStats ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="destructive"
                      className="h-4 px-1.5 text-[10px] font-medium gap-0.5 cursor-help"
                    >
                      <AlertCircle className="w-2.5 h-2.5" />
                      {filterStats.removed_count} removed
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs">
                    <p className="text-xs">
                      {filterStats.removed_count} sample{filterStats.removed_count !== 1 ? 's' : ''} filtered out
                      {filterStats.reason && `: ${filterStats.reason}`}
                    </p>
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-0.5 flex-shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={() => onToggle(operator.id)}
                >
                  {operator.enabled ? (
                    <Eye className="w-3.5 h-3.5" />
                  ) : (
                    <EyeOff className="w-3.5 h-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {operator.enabled ? 'Disable step' : 'Enable step'}
              </TooltipContent>
            </Tooltip>

            {hasParams && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={() => setIsExpanded(!isExpanded)}
                  >
                    {isExpanded ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {isExpanded ? 'Hide parameters' : 'Show parameters'}
                </TooltipContent>
              </Tooltip>
            )}

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  onClick={() => onRemove(operator.id)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Remove step</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {isExpanded && hasParams && paramDefs && (
          <div className="px-3 pb-3 pt-1 border-t border-border mt-1 space-y-3">
            <DynamicParamRenderer
              params={operator.params}
              paramDefs={paramDefs}
              operatorName={operator.name}
              datasetId={datasetId}
              onUpdate={(key, value) => onUpdateParams(operator.id, { [key]: value })}
            />
          </div>
        )}
      </div>

      {/* Error log dialog */}
      <Dialog open={showErrorDialog} onOpenChange={setShowErrorDialog}>
        <DialogContent className="max-w-2xl bg-card border-border shadow-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" />
              {displayName} failed
            </DialogTitle>
            <DialogDescription>
              The operator threw an error during pipeline execution. Copy the log
              below when filing an issue.
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-[50vh] overflow-auto rounded border border-destructive/30 bg-destructive/5 p-3 text-[11px] leading-relaxed font-mono text-destructive whitespace-pre-wrap break-words">
            {errorMessage}
          </pre>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyError}
              className="gap-2"
            >
              <Copy className="w-3.5 h-3.5" />
              Copy error
            </Button>
            <Button
              size="sm"
              onClick={() => setShowErrorDialog(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}

// Dynamic parameter renderer
interface DynamicParamRendererProps {
  params: Record<string, unknown>;
  paramDefs: Record<string, OperatorParamInfo>;
  operatorName?: string;
  datasetId?: string;
  onUpdate: (key: string, value: unknown) => void;
}

function DynamicParamRenderer({ params, paramDefs, operatorName, datasetId, onUpdate }: DynamicParamRendererProps) {
  // Filter out internal and advanced params, render user-facing ones
  const visibleParams = Object.entries(paramDefs).filter(([key, info]) => {
    if (key.startsWith('_')) return false;
    if (info.isAdvanced) return false;
    return true;
  });

  if (visibleParams.length === 0) {
    return <p className="text-xs text-muted-foreground">No parameters</p>;
  }

  return (
    <>
      {visibleParams.map(([key, info]) => (
        <ParamInput
          key={key}
          paramKey={key}
          paramInfo={info}
          value={params[key] ?? info.default}
          operatorName={operatorName}
          datasetId={datasetId}
          allParams={params}
          onUpdate={onUpdate}
        />
      ))}
    </>
  );
}

// Single parameter input
interface ParamInputProps {
  paramKey: string;
  paramInfo: OperatorParamInfo;
  value: unknown;
  operatorName?: string;
  datasetId?: string;
  allParams?: Record<string, unknown>;
  onUpdate: (key: string, value: unknown) => void;
}

function ParamInput({ paramKey, paramInfo, value, operatorName, datasetId, allParams, onUpdate }: ParamInputProps) {
  const displayName = paramKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  // Metadata column selector (for MetadataFilter)
  if (paramInfo.type === 'metadata_column') {
    return (
      <MetadataColumnSelect
        paramKey={paramKey}
        displayName={displayName}
        value={String(value ?? '')}
        datasetId={datasetId}
        onUpdate={onUpdate}
      />
    );
  }

  // Dynamic array with metadata values (for MetadataFilter values_to_exclude/values_to_keep)
  if (paramInfo.type === 'array' && paramInfo.dynamicSource === 'metadata_values') {
    return (
      <MetadataValueSelect
        paramKey={paramKey}
        displayName={displayName}
        value={value as (string | number | boolean | null)[] | null}
        datasetId={datasetId}
        column={String(allParams?.column ?? '')}
        onUpdate={onUpdate}
      />
    );
  }

  // Determine input type
  if (paramInfo.type === 'bool' || typeof value === 'boolean') {
    return (
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">{displayName}</Label>
        <Switch
          checked={value as boolean}
          onCheckedChange={(v) => onUpdate(paramKey, v)}
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
          onValueChange={(v) => onUpdate(paramKey, v)}
        >
          <SelectTrigger className="h-8 text-xs mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {paramInfo.options.map((opt) => (
              <SelectItem key={String(opt.value)} value={String(opt.value)} className="text-xs">
                {opt.label}
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
        value={value as number}
        paramInfo={paramInfo}
        onUpdate={onUpdate}
      />
    );
  }

  // Default: text input with commit-on-blur/enter
  return (
    <TextParamInput
      paramKey={paramKey}
      displayName={displayName}
      value={String(value ?? '')}
      onUpdate={onUpdate}
    />
  );
}

// Text parameter input with commit-on-blur/enter behavior
interface TextParamInputProps {
  paramKey: string;
  displayName: string;
  value: string;
  onUpdate: (key: string, value: unknown) => void;
}

function TextParamInput({ paramKey, displayName, value, onUpdate }: TextParamInputProps) {
  const commitHandler = useCallback((v: string) => {
    onUpdate(paramKey, v);
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
          "h-8 text-xs mt-1",
          isDirty && "border-primary/50 ring-1 ring-primary/20"
        )}
        placeholder="Press Enter to apply"
      />
    </div>
  );
}

// Numeric parameter input with slider
interface NumericParamInputProps {
  paramKey: string;
  displayName: string;
  value: number;
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

  // Fallback ranges for known parameter names (used when definition lacks min/max)
  const fallbackRanges: Record<string, [number, number, number]> = {
    n_splits: [2, 20, 1],
    window_length: [3, 51, 2],
    polyorder: [1, 5, 1],
    deriv: [0, 2, 1],
    test_size: [0.1, 0.5, 0.05],
    random_state: [0, 100, 1],
  };

  // Prefer definition-provided min/max/step, fall back to known ranges, then type defaults
  const fallback = fallbackRanges[paramKey] || (isInt ? [1, 100, 1] : [0, 1, 0.1]);
  const min = paramInfo.min ?? fallback[0];
  const max = paramInfo.max ?? fallback[1];
  const step = paramInfo.step ?? fallback[2];

  const commitHandler = useCallback((v: number) => {
    onUpdate(paramKey, v);
  }, [paramKey, onUpdate]);

  // Ensure we handle null/undefined values gracefully
  const safeValue = typeof value === 'number' ? value : (isInt ? min : 0);

  const {
    value: localValue,
    onChange: onLocalChange,
    onValueCommit,
  } = useSliderWithCommit(safeValue, commitHandler);

  // Special handling for window_length (must be odd)
  const handleSliderChange = ([v]: number[]) => {
    let newValue = v;
    if (paramKey === 'window_length' && v % 2 === 0) {
      newValue = v + 1;
    }
    onLocalChange(newValue);
  };

  const handleCommit = ([v]: number[]) => {
    let newValue = v;
    if (paramKey === 'window_length' && v % 2 === 0) {
      newValue = v + 1;
    }
    onValueCommit(newValue);
  };

  // Safe display value function
  const getDisplayValue = () => {
    if (localValue == null) return '-';
    return isInt ? Math.round(localValue) : localValue.toFixed(2);
  };

  return (
    <div>
      <Label className="text-xs text-muted-foreground">
        {displayName}: {getDisplayValue()}
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

// MetadataFilter: dynamic column selector
function MetadataColumnSelect({
  paramKey,
  displayName,
  value,
  datasetId,
  onUpdate,
}: {
  paramKey: string;
  displayName: string;
  value: string;
  datasetId?: string;
  onUpdate: (key: string, value: unknown) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['metadata-columns', datasetId],
    queryFn: ({ signal }) => fetchMetadataColumns(datasetId!, signal),
    enabled: !!datasetId,
    staleTime: 60_000,
  });

  const columns = data?.columns ?? [];

  if (!datasetId) {
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
        onValueChange={(v) => onUpdate(paramKey, v)}
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
          {columns.map((col) => (
            <SelectItem key={col.name} value={col.name} className="text-xs">
              {col.name} ({col.n_unique} values)
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// MetadataFilter: dynamic value multi-select
function MetadataValueSelect({
  paramKey,
  displayName,
  value,
  datasetId,
  column,
  onUpdate,
}: {
  paramKey: string;
  displayName: string;
  value: (string | number | boolean | null)[] | null;
  datasetId?: string;
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
    () => data?.columns?.find((c) => c.name === column),
    [data?.columns, column]
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

  const toggleValue = (val: string | number | boolean | null) => {
    const isSelected = selectedValues.includes(val);
    const newValues = isSelected
      ? selectedValues.filter((v) => v !== val)
      : [...selectedValues, val];
    onUpdate(paramKey, newValues.length > 0 ? newValues : null);
  };

  return (
    <div>
      <Label className="text-xs text-muted-foreground">
        {displayName} {selectedValues.length > 0 && `(${selectedValues.length})`}
      </Label>
      <div className="mt-1 max-h-32 overflow-y-auto space-y-1 rounded border border-border p-1.5">
        {uniqueValues.map((val) => {
          const strVal = String(val ?? 'null');
          return (
            <label key={strVal} className="flex items-center gap-2 cursor-pointer text-xs hover:bg-accent/50 rounded px-1 py-0.5">
              <Checkbox
                checked={selectedValues.includes(val)}
                onCheckedChange={() => toggleValue(val)}
                className="h-3.5 w-3.5"
              />
              <span className="truncate">{strVal}</span>
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

export default UnifiedOperatorCard;

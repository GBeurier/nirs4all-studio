/**
 * UnifiedOperatorCard - Operator card for unified format
 *
 * Supports both preprocessing and splitting operators.
 * Uses dynamic parameter rendering based on operator definition.
 * Shows filter statistics ("N samples removed") for filter operators.
 */

import { useState, useCallback } from 'react';
import { GripVertical, X, ChevronDown, ChevronUp, Eye, EyeOff, Grid3X3, HelpCircle, Trash2, Filter, AlertCircle } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import { useSliderWithCommit } from '@/lib/playground/debounce';
import type { UnifiedOperator, OperatorParamInfo, FilterResult } from '@/types/playground';

interface UnifiedOperatorCardProps {
  operator: UnifiedOperator;
  index: number;
  paramDefs?: Record<string, OperatorParamInfo>;
  description?: string;
  /** Filter statistics from execution result - name is optional since we key by operator name externally */
  filterStats?: { removed_count: number; reason?: string };
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

  const isSplitter = operator.type === 'splitting';
  const isFilter = operator.type === 'filter';
  const isAugmentation = operator.type === 'augmentation';
  const hasParams = paramDefs && Object.keys(paramDefs).length > 0;

  // Filter statistics display
  const hasFilterStats = isFilter && filterStats && filterStats.removed_count > 0;

  // Get display name (convert CamelCase to readable)
  const displayName = operator.name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim();

  // Get border color based on type
  const getBorderColor = () => {
    if (isFilter) return 'border-red-500/50';
    if (isSplitter) return 'border-orange-500/50';
    if (isAugmentation) return 'border-blue-500/50';
    return 'border-border';
  };

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
              {/* Filter statistics badge */}
              {hasFilterStats && (
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
              )}
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
              onUpdate={(key, value) => onUpdateParams(operator.id, { [key]: value })}
            />
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

// Dynamic parameter renderer
interface DynamicParamRendererProps {
  params: Record<string, unknown>;
  paramDefs: Record<string, OperatorParamInfo>;
  onUpdate: (key: string, value: unknown) => void;
}

function DynamicParamRenderer({ params, paramDefs, onUpdate }: DynamicParamRendererProps) {
  // Filter out internal params and render user-facing ones
  const visibleParams = Object.entries(paramDefs).filter(([key]) => {
    // Skip internal params
    if (key.startsWith('_')) return false;
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
  onUpdate: (key: string, value: unknown) => void;
}

function ParamInput({ paramKey, paramInfo, value, onUpdate }: ParamInputProps) {
  const displayName = paramKey
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());

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

  // Default: text input
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{displayName}</Label>
      <Input
        value={String(value ?? '')}
        onChange={(e) => onUpdate(paramKey, e.target.value)}
        className="h-8 text-xs mt-1"
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

  // Common parameter ranges
  const ranges: Record<string, [number, number, number]> = {
    n_splits: [2, 20, 1],
    window_length: [3, 51, 2],
    polyorder: [1, 5, 1],
    deriv: [0, 2, 1],
    test_size: [0.1, 0.5, 0.05],
    random_state: [0, 100, 1],
  };

  const [min, max, step] = ranges[paramKey] || (isInt ? [1, 100, 1] : [0, 1, 0.1]);

  const commitHandler = useCallback((v: number) => {
    onUpdate(paramKey, v);
  }, [paramKey, onUpdate]);

  const {
    value: localValue,
    onChange: onLocalChange,
    onValueCommit,
  } = useSliderWithCommit(value, commitHandler);

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

  return (
    <div>
      <Label className="text-xs text-muted-foreground">
        {displayName}: {isInt ? Math.round(localValue) : localValue.toFixed(2)}
      </Label>
      <Slider
        value={[localValue]}
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

export default UnifiedOperatorCard;

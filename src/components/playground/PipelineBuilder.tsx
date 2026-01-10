/**
 * PipelineBuilder - Pipeline builder for unified operators
 *
 * Features:
 * - Unified operator format (preprocessing + splitting)
 * - Dynamic parameter definitions from backend
 * - Visual distinction for splitters
 * - Loading and error states
 */

import { useState, useMemo } from 'react';
import { Layers, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { UnifiedOperatorCard } from './UnifiedOperatorCard';
import { useNodeRegistryOptional, type NodeDefinition } from '@/components/pipeline-editor/contexts';
import type { UnifiedOperator, StepError, FilterInfo, OperatorParamInfo } from '@/types/playground';

interface PipelineBuilderProps {
  operators: UnifiedOperator[];
  isProcessing?: boolean;
  stepErrors?: StepError[];
  /** Filter statistics from execution result */
  filterInfo?: FilterInfo;
  onUpdate: (id: string, updates: Partial<UnifiedOperator>) => void;
  onUpdateParams: (id: string, params: Record<string, unknown>) => void;
  onRemove: (id: string) => void;
  onToggle: (id: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onClear: () => void;
}

// Map playground operator type to NodeRegistry type
type PlaygroundType = 'preprocessing' | 'augmentation' | 'splitting' | 'filter';
const TYPE_TO_NODE_TYPES: Record<PlaygroundType, string[]> = {
  preprocessing: ['preprocessing'],
  augmentation: ['augmentation', 'sample_augmentation', 'feature_augmentation'],
  splitting: ['splitting'],
  filter: ['filter', 'sample_filter'],
};

/**
 * Convert NodeDefinition parameters to OperatorParamInfo format
 */
function nodeParamsToOperatorParams(node: NodeDefinition | undefined): Record<string, OperatorParamInfo> | undefined {
  if (!node?.parameters) return undefined;

  const result: Record<string, OperatorParamInfo> = {};
  for (const param of node.parameters) {
    result[param.name] = {
      required: param.required ?? false,
      default: param.default,
      type: param.type,
      default_is_callable: false,
    };
  }
  return result;
}

export function PipelineBuilder({
  operators,
  isProcessing = false,
  stepErrors = [],
  filterInfo,
  onUpdate,
  onUpdateParams,
  onRemove,
  onToggle,
  onReorder,
  onClear,
}: PipelineBuilderProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  // Get operator definitions from NodeRegistry
  const registryContext = useNodeRegistryOptional();

  // Helper to find operator definition by name and type
  const getOperatorDefinition = useMemo(() => {
    if (!registryContext) return () => undefined;

    return (name: string, type: PlaygroundType): NodeDefinition | undefined => {
      const nodeTypes = TYPE_TO_NODE_TYPES[type] ?? [type];
      for (const nodeType of nodeTypes) {
        const nodes = registryContext.getNodesByType(nodeType as NodeDefinition['type']);
        const found = nodes.find(n => n.name === name);
        if (found) return found;
      }
      return undefined;
    };
  }, [registryContext]);

  // Build error map for quick lookup
  const errorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const err of stepErrors) {
      map.set(err.step, err.error);
    }
    return map;
  }, [stepErrors]);

  // Build filter stats map by operator name
  const filterStatsMap = useMemo(() => {
    const map = new Map<string, { removed_count: number; reason?: string }>();
    if (filterInfo?.filters_applied) {
      for (const filter of filterInfo.filters_applied) {
        map.set(filter.name, {
          removed_count: filter.removed_count,
          reason: filter.reason,
        });
      }
    }
    return map;
  }, [filterInfo]);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex !== null && dragIndex !== index) {
      setDropIndex(index);
    }
  };

  const handleDragEnd = () => {
    if (dragIndex !== null && dropIndex !== null && dragIndex !== dropIndex) {
      onReorder(dragIndex, dropIndex);
    }
    setDragIndex(null);
    setDropIndex(null);
  };

  // Count operator types
  const preprocessingCount = operators.filter(op => op.type === 'preprocessing').length;
  const augmentationCount = operators.filter(op => op.type === 'augmentation').length;
  const filterCount = operators.filter(op => op.type === 'filter').length;
  const splittingCount = operators.filter(op => op.type === 'splitting').length;

  if (operators.length === 0) {
    return (
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Pipeline
          </h3>
        </div>
        <div className="text-center py-8 text-muted-foreground">
          <Layers className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No operators added</p>
          <p className="text-xs mt-1">Click an operator above to add it</p>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="p-2">
        <div className="flex items-center justify-between mb-2 px-1">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Layers className="w-4 h-4" />
              Pipeline
            </h3>
            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              {preprocessingCount} prep
            </span>
            {augmentationCount > 0 && (
              <span className="text-[10px] text-blue-500 bg-blue-500/10 px-1.5 py-0.5 rounded">
                {augmentationCount} aug
              </span>
            )}
            {filterCount > 0 && (
              <span className="text-[10px] text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded">
                {filterCount} filter
              </span>
            )}
            {splittingCount > 0 && (
              <span className="text-[10px] text-orange-500 bg-orange-500/10 px-1.5 py-0.5 rounded">
                {splittingCount} split
              </span>
            )}
            {isProcessing && (
              <Loader2 className="w-3 h-3 text-primary animate-spin" />
            )}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                onClick={onClear}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              <div className="flex items-center gap-2">
                <span>Clear pipeline</span>
                <kbd className="text-[10px] bg-muted px-1.5 py-0.5 rounded">Ctrl+Backspace</kbd>
              </div>
            </TooltipContent>
          </Tooltip>
        </div>

      {/* Step errors alert */}
      {stepErrors.length > 0 && (
        <Alert variant="destructive" className="mb-3 py-2">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            {stepErrors.length} step{stepErrors.length > 1 ? 's' : ''} failed
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        {operators.map((operator, index) => {
          const nodeDef = getOperatorDefinition(operator.name, operator.type as PlaygroundType);
          const paramDefs = nodeParamsToOperatorParams(nodeDef);
          const hasError = errorMap.has(operator.id);
          const filterStats = operator.type === 'filter'
            ? filterStatsMap.get(operator.name)
            : undefined;

          return (
            <div key={operator.id} className="relative">
              {hasError && (
                <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-1 h-4 bg-destructive rounded-full" />
              )}
              <UnifiedOperatorCard
                operator={operator}
                index={index}
                paramDefs={paramDefs}
                description={nodeDef?.description}
                filterStats={filterStats}
                onUpdate={onUpdate}
                onUpdateParams={onUpdateParams}
                onRemove={onRemove}
                onToggle={onToggle}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
                isDragging={dragIndex === index}
              />
            </div>
          );
        })}
      </div>
    </div>
    </TooltipProvider>
  );
}

export default PipelineBuilder;

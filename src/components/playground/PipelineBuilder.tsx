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
import { useOperatorRegistry } from '@/hooks/useOperatorRegistry';
import type { UnifiedOperator, StepError } from '@/types/playground';

interface PipelineBuilderProps {
  operators: UnifiedOperator[];
  isProcessing?: boolean;
  stepErrors?: StepError[];
  onUpdate: (id: string, updates: Partial<UnifiedOperator>) => void;
  onUpdateParams: (id: string, params: Record<string, unknown>) => void;
  onRemove: (id: string) => void;
  onToggle: (id: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onClear: () => void;
}

export function PipelineBuilder({
  operators,
  isProcessing = false,
  stepErrors = [],
  onUpdate,
  onUpdateParams,
  onRemove,
  onToggle,
  onReorder,
  onClear,
}: PipelineBuilderProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  // Get operator definitions for parameter info
  const { getOperator } = useOperatorRegistry();

  // Build error map for quick lookup
  const errorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const err of stepErrors) {
      map.set(err.step, err.error);
    }
    return map;
  }, [stepErrors]);

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
          const definition = getOperator(operator.name);
          const hasError = errorMap.has(operator.id);

          return (
            <div key={operator.id} className="relative">
              {hasError && (
                <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-1 h-4 bg-destructive rounded-full" />
              )}
              <UnifiedOperatorCard
                operator={operator}
                index={index}
                paramDefs={definition?.params}
                description={definition?.description}
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

/**
 * @deprecated This component is deprecated. Use UnifiedOperatorCard instead.
 *
 * MIGRATION GUIDE:
 * - Import { UnifiedOperatorCard } from '@/components/playground'
 * - UnifiedOperatorCard uses the unified operator format
 * - UnifiedOperatorCard renders parameters dynamically from backend definitions
 */

import { useState } from 'react';
import { GripVertical, X, ChevronDown, ChevronUp, Eye, EyeOff } from 'lucide-react';
import { PipelineOperator, OperatorParams, OperatorTarget } from '@/types/spectral';
import { operatorDefinitions } from '@/lib/preprocessing/operators';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface OperatorCardProps {
  operator: PipelineOperator;
  index: number;
  onUpdate: (id: string, updates: Partial<PipelineOperator>) => void;
  onRemove: (id: string) => void;
  onToggle: (id: string) => void;
  onDragStart: (e: React.DragEvent, index: number) => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDragEnd: () => void;
  isDragging: boolean;
}

export function OperatorCard({
  operator,
  index,
  onUpdate,
  onRemove,
  onToggle,
  onDragStart,
  onDragOver,
  onDragEnd,
  isDragging,
}: OperatorCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const updateParams = (key: string, value: unknown) => {
    onUpdate(operator.id, {
      params: { ...operator.params, [key]: value } as OperatorParams[typeof operator.type],
    });
  };

  const renderParams = () => {
    switch (operator.type) {
      case 'msc':
        return (
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Reference Type</Label>
            <Select
              value={(operator.params as OperatorParams['msc']).referenceType}
              onValueChange={(v) => updateParams('referenceType', v)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mean">Mean</SelectItem>
                <SelectItem value="median">Median</SelectItem>
              </SelectContent>
            </Select>
          </div>
        );

      case 'savgol':
      case 'derivative1':
      case 'derivative2':
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">
                Window Size: {(operator.params as OperatorParams['savgol']).windowSize}
              </Label>
              <Slider
                value={[(operator.params as OperatorParams['savgol']).windowSize]}
                onValueChange={([v]: number[]) => updateParams('windowSize', v % 2 === 0 ? v + 1 : v)}
                min={3}
                max={31}
                step={2}
                className="mt-2"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">
                Polynomial Order: {(operator.params as OperatorParams['savgol']).polyOrder}
              </Label>
              <Slider
                value={[(operator.params as OperatorParams['savgol']).polyOrder]}
                onValueChange={([v]: number[]) => updateParams('polyOrder', v)}
                min={1}
                max={5}
                step={1}
                className="mt-2"
              />
            </div>
          </div>
        );

      case 'smoothing':
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">Method</Label>
              <Select
                value={(operator.params as OperatorParams['smoothing']).method}
                onValueChange={(v) => updateParams('method', v)}
              >
                <SelectTrigger className="h-8 text-xs mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="movingAverage">Moving Average</SelectItem>
                  <SelectItem value="gaussian">Gaussian</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">
                Window Size: {(operator.params as OperatorParams['smoothing']).windowSize}
              </Label>
              <Slider
                value={[(operator.params as OperatorParams['smoothing']).windowSize]}
                onValueChange={([v]: number[]) => updateParams('windowSize', v % 2 === 0 ? v + 1 : v)}
                min={3}
                max={31}
                step={2}
                className="mt-2"
              />
            </div>
          </div>
        );

      case 'normalize':
        return (
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Method</Label>
            <Select
              value={(operator.params as OperatorParams['normalize']).method}
              onValueChange={(v) => updateParams('method', v)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vector">Vector (L2)</SelectItem>
                <SelectItem value="minmax">Min-Max</SelectItem>
                <SelectItem value="area">Area</SelectItem>
                <SelectItem value="max">Max</SelectItem>
              </SelectContent>
            </Select>
          </div>
        );

      case 'baseline':
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">Method</Label>
              <Select
                value={(operator.params as OperatorParams['baseline']).method}
                onValueChange={(v) => updateParams('method', v)}
              >
                <SelectTrigger className="h-8 text-xs mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="linear">Linear</SelectItem>
                  <SelectItem value="polynomial">Polynomial</SelectItem>
                  <SelectItem value="als">ALS</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(operator.params as OperatorParams['baseline']).method === 'polynomial' && (
              <div>
                <Label className="text-xs text-muted-foreground">
                  Polynomial Order: {(operator.params as OperatorParams['baseline']).polyOrder || 2}
                </Label>
                <Slider
                  value={[(operator.params as OperatorParams['baseline']).polyOrder || 2]}
                  onValueChange={([v]: number[]) => updateParams('polyOrder', v)}
                  min={1}
                  max={5}
                  step={1}
                  className="mt-2"
                />
              </div>
            )}
          </div>
        );

      case 'detrend':
        return (
          <div>
            <Label className="text-xs text-muted-foreground">
              Order: {(operator.params as OperatorParams['detrend']).order}
            </Label>
            <Slider
              value={[(operator.params as OperatorParams['detrend']).order]}
              onValueChange={([v]: number[]) => updateParams('order', v)}
              min={1}
              max={3}
              step={1}
              className="mt-2"
            />
          </div>
        );

      default:
        return null;
    }
  };

  const hasParams = !['snv', 'meanCenter', 'wavelengthSelect'].includes(operator.type);
  const definition = operatorDefinitions.find(d => d.type === operator.type);
  const allowedTargets = definition?.allowedTargets || ['X'];

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDragEnd={onDragEnd}
      className={cn(
        'bg-muted rounded-lg border border-border transition-all duration-200',
        isDragging && 'opacity-50 scale-95',
        !operator.enabled && 'opacity-60'
      )}
    >
      <div className="flex items-center gap-2 p-2">
        <div className="cursor-grab hover:text-primary">
          <GripVertical className="w-4 h-4 text-muted-foreground" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono text-muted-foreground">{index + 1}</span>
            <span className="text-xs font-medium text-foreground truncate">
              {operator.name}
            </span>
            {allowedTargets.length > 1 && (
              <Select
                value={operator.target}
                onValueChange={(v) => onUpdate(operator.id, { target: v as OperatorTarget })}
              >
                <SelectTrigger className="h-5 w-10 text-[10px] px-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allowedTargets.map(t => (
                    <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

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

        {hasParams && (
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
        )}

        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-destructive"
          onClick={() => onRemove(operator.id)}
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      {isExpanded && hasParams && (
        <div className="px-3 pb-3 pt-1 border-t border-border mt-1">
          {renderParams()}
        </div>
      )}
    </div>
  );
}

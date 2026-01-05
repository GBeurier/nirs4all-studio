/**
 * StepComparisonSlider - Step-by-step pipeline comparison mode
 *
 * Allows users to step through the pipeline one operator at a time
 * to visualize the effect of each transformation.
 *
 * Accessibility:
 * - ARIA labels for slider and controls
 * - Keyboard navigation with ←/→ arrows, Home/End
 * - Live region for step change announcements
 */

import { useState, useCallback, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { UnifiedOperator } from '@/types/playground';

interface StepComparisonSliderProps {
  /** All pipeline operators */
  operators: UnifiedOperator[];
  /** Current step (0 = original, n = after n operators) */
  currentStep: number;
  /** Callback when step changes */
  onStepChange: (step: number) => void;
  /** Whether comparison mode is enabled */
  enabled: boolean;
  /** Callback when enabled state changes */
  onEnabledChange: (enabled: boolean) => void;
  /** Notify parent that user started an interaction (for optimistic spinners) */
  onInteractionStart?: () => void;
  /** Whether we're currently loading */
  isLoading?: boolean;
  /** Compact mode for smaller spaces */
  compact?: boolean;
}

export function StepComparisonSlider({
  operators,
  currentStep,
  onStepChange,
  enabled,
  onEnabledChange,
  onInteractionStart,
  isLoading = false,
  compact = false,
}: StepComparisonSliderProps) {
  // Filter to only enabled operators
  const enabledOperators = useMemo(
    () => operators.filter(op => op.enabled),
    [operators]
  );

  const maxStep = enabledOperators.length;

  // Get label for current step
  const stepLabel = useMemo(() => {
    if (currentStep === 0) return 'Original';
    if (currentStep > enabledOperators.length) return 'Final';
    return enabledOperators[currentStep - 1]?.name ?? `Step ${currentStep}`;
  }, [currentStep, enabledOperators]);

  const handleEnabledChange = useCallback((value: boolean) => {
    onInteractionStart?.();
    onEnabledChange(value);
  }, [onEnabledChange, onInteractionStart]);

  // Step navigation
  const goToStart = useCallback(() => {
    onInteractionStart?.();
    onStepChange(0);
  }, [onInteractionStart, onStepChange]);

  const goToEnd = useCallback(() => {
    onInteractionStart?.();
    onStepChange(maxStep);
  }, [onInteractionStart, onStepChange, maxStep]);

  const goToPrev = useCallback(() => {
    onInteractionStart?.();
    onStepChange(Math.max(0, currentStep - 1));
  }, [onInteractionStart, onStepChange, currentStep]);

  const goToNext = useCallback(() => {
    onInteractionStart?.();
    onStepChange(Math.min(maxStep, currentStep + 1));
  }, [onInteractionStart, onStepChange, currentStep, maxStep]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      goToPrev();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      goToNext();
    } else if (e.key === 'Home') {
      e.preventDefault();
      goToStart();
    } else if (e.key === 'End') {
      e.preventDefault();
      goToEnd();
    }
  }, [goToPrev, goToNext, goToStart, goToEnd]);

  if (operators.length === 0) {
    return null;
  }

  if (compact) {
    return (
      <TooltipProvider>
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5">
                <Switch
                  id="step-mode"
                  checked={enabled}
                  onCheckedChange={handleEnabledChange}
                  onMouseDown={onInteractionStart}
                  className="scale-75"
                />
                <Label htmlFor="step-mode" className="text-[10px] cursor-pointer">
                  Step
                </Label>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              Step through pipeline one operator at a time
            </TooltipContent>
          </Tooltip>

          {enabled && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={goToPrev}
                onMouseDown={onInteractionStart}
                disabled={currentStep === 0 || isLoading}
              >
                <ChevronLeft className="w-3 h-3" />
              </Button>
              <span className="text-[10px] min-w-[60px] text-center truncate">
                {stepLabel}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={goToNext}
                onMouseDown={onInteractionStart}
                disabled={currentStep >= maxStep || isLoading}
              >
                <ChevronRight className="w-3 h-3" />
              </Button>
            </>
          )}
        </div>
      </TooltipProvider>
    );
  }

  return (
    <div
      className={cn(
        'p-3 bg-card border rounded-lg',
        !enabled && 'opacity-50'
      )}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="slider"
      aria-label="Pipeline step selector"
      aria-valuemin={0}
      aria-valuemax={maxStep}
      aria-valuenow={currentStep}
      aria-valuetext={stepLabel}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Switch
            id="step-comparison"
            checked={enabled}
            onCheckedChange={handleEnabledChange}
            onMouseDown={onInteractionStart}
          />
          <Label
            htmlFor="step-comparison"
            className="text-xs font-medium cursor-pointer"
          >
            Step-by-step comparison
          </Label>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {currentStep}/{maxStep}
        </span>
      </div>

      {enabled && (
        <>
          {/* Slider */}
          <div className="mb-2">
            <Slider
              value={[currentStep]}
              onValueChange={([val]) => onStepChange(val)}
              onPointerDown={onInteractionStart}
              min={0}
              max={maxStep}
              step={1}
              disabled={isLoading}
              className="py-1"
            />
          </div>

          {/* Current step label */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {currentStep === 0 ? 'Original data' : `After: ${stepLabel}`}
            </span>
          </div>

          {/* Navigation buttons */}
          <div className="flex items-center justify-center gap-1 mt-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={goToStart}
              onMouseDown={onInteractionStart}
              disabled={currentStep === 0 || isLoading}
              title="Go to original (Home)"
            >
              <SkipBack className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={goToPrev}
              onMouseDown={onInteractionStart}
              disabled={currentStep === 0 || isLoading}
              title="Previous step (←)"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={goToNext}
              onMouseDown={onInteractionStart}
              disabled={currentStep >= maxStep || isLoading}
              title="Next step (→)"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={goToEnd}
              onMouseDown={onInteractionStart}
              disabled={currentStep >= maxStep || isLoading}
              title="Go to final (End)"
            >
              <SkipForward className="w-3.5 h-3.5" />
            </Button>
          </div>

          {/* Step labels */}
          <div className="flex justify-between mt-2 px-1">
            {['Orig', ...enabledOperators.slice(0, 5).map(op => op.name.slice(0, 4))].map((label, i) => (
              <button
                key={i}
                onClick={() => onStepChange(i)}
                onMouseDown={onInteractionStart}
                className={cn(
                  'text-[9px] px-1 py-0.5 rounded transition-colors',
                  currentStep === i
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                )}
              >
                {label}
              </button>
            ))}
            {enabledOperators.length > 5 && (
              <span className="text-[9px] text-muted-foreground px-1">
                +{enabledOperators.length - 5}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default StepComparisonSlider;

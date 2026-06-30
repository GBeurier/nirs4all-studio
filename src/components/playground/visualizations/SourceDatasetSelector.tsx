/**
 * SourceDatasetSelector - Phase 2, Task 3.2.6
 *
 * Select source step/dataset for comparison in the playground.
 * Allows users to compare processed data against:
 * - Original input data
 * - Output from any previous pipeline step
 *
 * Features:
 * - Dropdown showing available source points
 * - Icons indicating step types (preprocessor, splitter, model)
 * - Badge showing step position in pipeline
 */

import { useCallback, useMemo } from 'react';
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { PlaygroundStep } from '@/types/playground';
import { buildSourceOptions, type SourceOption } from './sourceDatasetOptions';
import {
  SourceOptionGroups,
  SourceOptionIcon,
} from './SourceDatasetSelectorOptions';
import { groupSourceOptions } from './SourceDatasetSelectorGroups';

// ============= Types =============

export interface SourceDatasetSelectorProps {
  /** Currently selected source ID */
  value: string;
  /** Callback when source is changed */
  onChange: (sourceId: string) => void;
  /** Available source options */
  options: SourceOption[];
  /** Optional pipeline steps for building options automatically */
  pipelineSteps?: PlaygroundStep[];
  /** Current step index in pipeline */
  currentStepIndex?: number;
  /** Whether the selector is disabled */
  disabled?: boolean;
  /** Compact mode */
  compact?: boolean;
  /** Callback when interaction starts */
  onInteractionStart?: () => void;
  /** Additional class name */
  className?: string;
}

// ============= Main Component =============

export function SourceDatasetSelector({
  value,
  onChange,
  options,
  pipelineSteps,
  currentStepIndex,
  disabled = false,
  compact = false,
  onInteractionStart,
  className,
}: SourceDatasetSelectorProps) {
  // Build options from pipeline if not provided
  const resolvedOptions = useMemo(() => {
    if (options.length > 0) return options;
    if (pipelineSteps && currentStepIndex !== undefined) {
      return buildSourceOptions(pipelineSteps, currentStepIndex);
    }
    // Default: just original
    return [
      {
        id: 'original',
        label: 'Original Input',
        type: 'original' as const,
        position: 0,
        available: true,
      },
    ];
  }, [options, pipelineSteps, currentStepIndex]);

  // Find current selection
  const selectedOption = resolvedOptions.find(o => o.id === value) ?? resolvedOptions[0];

  // Handle change
  const handleChange = useCallback((newValue: string) => {
    onInteractionStart?.();
    onChange(newValue);
  }, [onChange, onInteractionStart]);

  const groupedOptions = useMemo(() => {
    return groupSourceOptions(resolvedOptions);
  }, [resolvedOptions]);

  // Don't show if only original is available
  if (resolvedOptions.length <= 1) {
    return null;
  }

  return (
    <Select
      value={value}
      onValueChange={handleChange}
      disabled={disabled}
    >
      <SelectTrigger
        className={cn(
          'h-7 text-xs gap-1.5',
          compact ? 'w-[120px]' : 'w-[180px]',
          className
        )}
        title="Compare against source dataset"
      >
        <span className="flex items-center gap-1.5 truncate">
          <SourceOptionIcon type={selectedOption?.type ?? 'original'} />
          <SelectValue placeholder="Source" />
        </span>
      </SelectTrigger>

      <SelectContent>
        <SourceOptionGroups groups={groupedOptions} />
      </SelectContent>
    </Select>
  );
}

export default SourceDatasetSelector;

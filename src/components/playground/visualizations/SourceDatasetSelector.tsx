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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  Layers,
  GitBranch,
  SplitSquareHorizontal,
  Brain,
  Database,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PlaygroundStep } from '@/types/playground';

// ============= Types =============

export interface SourceOption {
  /** Unique identifier for this source */
  id: string;
  /** Display label */
  label: string;
  /** Description of the source */
  description?: string;
  /** Type of source (for icon) */
  type: 'original' | 'preprocessor' | 'splitter' | 'model' | 'branch';
  /** Position in pipeline (0 = original input) */
  position: number;
  /** Whether this source is currently available */
  available: boolean;
}

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

// ============= Helper Functions =============

/**
 * Get icon for source type
 */
function getSourceIcon(type: SourceOption['type'], className?: string) {
  const iconClass = cn('w-3.5 h-3.5', className);

  switch (type) {
    case 'original':
      return <Database className={iconClass} />;
    case 'preprocessor':
      return <Layers className={iconClass} />;
    case 'splitter':
      return <SplitSquareHorizontal className={iconClass} />;
    case 'model':
      return <Brain className={iconClass} />;
    case 'branch':
      return <GitBranch className={iconClass} />;
    default:
      return <Layers className={iconClass} />;
  }
}

/**
 * Infer source type from pipeline step
 */
function inferSourceType(step: PlaygroundStep): SourceOption['type'] {
  const name = step.name?.toLowerCase() ?? '';
  const type = step.type?.toLowerCase() ?? '';

  if (type.includes('split') || name.includes('split') || name.includes('kfold')) {
    return 'splitter';
  }
  if (type.includes('model') || name.includes('pls') || name.includes('regress')) {
    return 'model';
  }
  if (name.includes('branch')) {
    return 'branch';
  }
  return 'preprocessor';
}

/**
 * Build source options from pipeline steps
 */
export function buildSourceOptions(
  pipelineSteps: PlaygroundStep[],
  currentStepIndex: number
): SourceOption[] {
  const options: SourceOption[] = [
    {
      id: 'original',
      label: 'Original Input',
      description: 'Raw input data before any processing',
      type: 'original',
      position: 0,
      available: true,
    },
  ];

  // Add each step up to (but not including) current as a source option
  pipelineSteps.forEach((step, idx) => {
    if (idx < currentStepIndex) {
      options.push({
        id: `step_${idx}`,
        label: step.name ?? `Step ${idx + 1}`,
        description: step.type ?? undefined,
        type: inferSourceType(step),
        position: idx + 1,
        available: true, // Could check if step output exists
      });
    }
  });

  return options;
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

  // Group options by type
  const groupedOptions = useMemo(() => {
    const groups: Record<string, SourceOption[]> = {
      input: [],
      preprocessing: [],
      other: [],
    };

    resolvedOptions.forEach(opt => {
      if (opt.type === 'original') {
        groups.input.push(opt);
      } else if (opt.type === 'preprocessor' || opt.type === 'splitter') {
        groups.preprocessing.push(opt);
      } else {
        groups.other.push(opt);
      }
    });

    return groups;
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
          {getSourceIcon(selectedOption?.type ?? 'original')}
          <SelectValue placeholder="Source" />
        </span>
      </SelectTrigger>

      <SelectContent>
        {/* Input group */}
        {groupedOptions.input.length > 0 && (
          <SelectGroup>
            <SelectLabel className="text-[10px] text-muted-foreground">
              Input
            </SelectLabel>
            {groupedOptions.input.map(opt => (
              <SelectItem
                key={opt.id}
                value={opt.id}
                disabled={!opt.available}
              >
                <span className="flex items-center gap-2">
                  {getSourceIcon(opt.type)}
                  <span className="flex-1">{opt.label}</span>
                  <Badge variant="outline" className="text-[9px] px-1 h-4">
                    {opt.position}
                  </Badge>
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        )}

        {/* Preprocessing group */}
        {groupedOptions.preprocessing.length > 0 && (
          <SelectGroup>
            <SelectLabel className="text-[10px] text-muted-foreground">
              Preprocessing Steps
            </SelectLabel>
            {groupedOptions.preprocessing.map(opt => (
              <SelectItem
                key={opt.id}
                value={opt.id}
                disabled={!opt.available}
              >
                <span className="flex items-center gap-2">
                  {getSourceIcon(opt.type)}
                  <span className="flex-1 truncate">{opt.label}</span>
                  <Badge variant="outline" className="text-[9px] px-1 h-4">
                    {opt.position}
                  </Badge>
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        )}

        {/* Other group */}
        {groupedOptions.other.length > 0 && (
          <SelectGroup>
            <SelectLabel className="text-[10px] text-muted-foreground">
              Other
            </SelectLabel>
            {groupedOptions.other.map(opt => (
              <SelectItem
                key={opt.id}
                value={opt.id}
                disabled={!opt.available}
              >
                <span className="flex items-center gap-2">
                  {getSourceIcon(opt.type)}
                  <span className="flex-1 truncate">{opt.label}</span>
                  <Badge variant="outline" className="text-[9px] px-1 h-4">
                    {opt.position}
                  </Badge>
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}

export default SourceDatasetSelector;

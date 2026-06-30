/**
 * PartitionSelector - Global partition filtering for Playground (Phase 3)
 *
 * Provides toolbar-level partition filtering that applies to all charts simultaneously.
 * This allows users to quickly view only train, test, or specific fold samples.
 *
 * Features:
 * - Partition options: All, Train, Test, Train/Test, Folds Only
 * - Badge showing sample count per selection
 * - Integration with fold information from backend
 * - Visual feedback for current selection
 * - Optional individual fold selection
 */

import { useMemo, useCallback } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
  SelectSeparator,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { buildPartitionSelectorData } from '@/lib/playground/partitionSelectorData';
import type { PartitionFilter } from '@/lib/playground/partitionFilters';
import type { FoldsInfo } from '@/types/playground';

// ============= Types =============

export interface PartitionSelectorProps {
  /** Current partition filter */
  value: PartitionFilter;
  /** Callback when partition changes */
  onChange: (partition: PartitionFilter) => void;
  /** Fold information from backend */
  folds: FoldsInfo | null;
  /** Total number of samples (for "all" count) */
  totalSamples: number;
  /** Compact mode for smaller containers */
  compact?: boolean;
  /** Disabled state */
  disabled?: boolean;
  /** Additional CSS classes */
  className?: string;
}

// ============= Component =============

export function PartitionSelector({
  value,
  onChange,
  folds,
  totalSamples,
  compact = false,
  disabled = false,
  className,
}: PartitionSelectorProps) {
  const selectorData = useMemo(
    () => buildPartitionSelectorData({
      value,
      folds,
      totalSamples,
      compact,
    }),
    [value, folds, totalSamples, compact]
  );

  // Handle value change
  const handleChange = useCallback((newValue: string) => {
    onChange(newValue as PartitionFilter);
  }, [onChange]);

  // If no folds, show disabled state or simplified selector
  if (!selectorData.hasFolds) {
    return (
      <div className={cn('flex items-center gap-1', className)}>
        <Layers className="w-3 h-3 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">
          {selectorData.emptyLabel}
        </span>
        <Badge variant="secondary" className="h-4 px-1 text-[9px]">
          {selectorData.counts.all}
        </Badge>
      </div>
    );
  }

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      {!compact && (
        <Layers className="w-3 h-3 text-muted-foreground" />
      )}

      <Select
        value={value}
        onValueChange={handleChange}
        disabled={disabled}
      >
        <SelectTrigger
          className={cn(
            'text-xs border-none shadow-none bg-transparent hover:bg-muted/50 focus:ring-0',
            compact ? 'h-6 w-16 px-1' : 'h-7 w-24 px-2'
          )}
        >
          <SelectValue placeholder="Select partition">
            {selectorData.triggerLabel}
          </SelectValue>
        </SelectTrigger>

        <SelectContent align="start">
          {/* Basic partitions */}
          {selectorData.basicOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <div className="flex items-center justify-between w-full gap-4">
                <span>{option.label}</span>
                <Badge variant="outline" className="h-4 px-1 text-[9px]">
                  {option.count}
                </Badge>
              </div>
            </SelectItem>
          ))}

          {/* K-fold specific options */}
          {selectorData.isKFold && (
            <>
              <SelectSeparator />

              {selectorData.oofOption && (
                <SelectItem value={selectorData.oofOption.value}>
                  <div className="flex items-center justify-between w-full gap-4">
                    <span>{selectorData.oofOption.label}</span>
                    <Badge variant="outline" className="h-4 px-1 text-[9px]">
                      {selectorData.oofOption.count}
                    </Badge>
                  </div>
                </SelectItem>
              )}

              <SelectSeparator />

              <SelectGroup>
                <SelectLabel className="text-[10px]">Individual Folds</SelectLabel>
                {selectorData.foldOptions.map((fold) => (
                  <SelectItem key={fold.foldIndex} value={fold.value}>
                    <div className="flex items-center justify-between w-full gap-4">
                      <span>{fold.label}</span>
                      <div className="flex items-center gap-1">
                        <Badge variant="outline" className="h-4 px-1 text-[9px]" style={{ backgroundColor: 'hsla(217, 70%, 50%, 0.1)' }}>
                          {fold.trainCount}
                        </Badge>
                        <span className="text-[9px] text-muted-foreground">/</span>
                        <Badge variant="outline" className="h-4 px-1 text-[9px]" style={{ backgroundColor: 'hsla(38, 92%, 50%, 0.1)' }}>
                          {fold.testCount}
                        </Badge>
                      </div>
                    </div>
                  </SelectItem>
                ))}
              </SelectGroup>
            </>
          )}
        </SelectContent>
      </Select>

      {/* Sample count badge */}
      {selectorData.showCurrentCount && (
        <Badge variant="secondary" className="h-4 px-1 text-[9px]">
          {selectorData.currentCount}
        </Badge>
      )}
    </div>
  );
}

export default PartitionSelector;

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
import { Layers, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FoldsInfo, FoldData } from '@/types/playground';

// ============= Types =============

export type PartitionFilter =
  | 'all'
  | 'train'
  | 'test'
  | 'train-test'  // Both train and test, but not OOF
  | 'oof'         // Out-of-fold only
  | `fold-${number}`;  // Specific fold (0-indexed)

export interface PartitionCounts {
  all: number;
  train: number;
  test: number;
  oof: number;
  folds: Record<number, { train: number; test: number; total: number }>;
}

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

// ============= Helper Functions =============

/**
 * Calculate sample counts for each partition option
 */
function calculatePartitionCounts(
  folds: FoldsInfo | null,
  totalSamples: number
): PartitionCounts {
  const counts: PartitionCounts = {
    all: totalSamples,
    train: 0,
    test: 0,
    oof: 0,
    folds: {},
  };

  if (!folds || !folds.folds || folds.folds.length === 0) {
    return counts;
  }

  // For cross-validation, each sample appears in test once
  // The "train" count is cumulative across folds (may double-count)
  // But for display purposes, we show the per-fold or total unique counts

  // Collect unique train and test indices across all folds
  const allTrainIndices = new Set<number>();
  const allTestIndices = new Set<number>();

  folds.folds.forEach((fold) => {
    // Per-fold counts
    counts.folds[fold.fold_index] = {
      train: fold.train_count,
      test: fold.test_count,
      total: fold.train_count + fold.test_count,
    };

    // Aggregate unique indices
    fold.train_indices.forEach(i => allTrainIndices.add(i));
    fold.test_indices.forEach(i => allTestIndices.add(i));
  });

  // For simple train/test split (1 fold), use direct counts
  if (folds.n_folds === 1) {
    counts.train = folds.folds[0].train_count;
    counts.test = folds.folds[0].test_count;
  } else {
    // For k-fold CV, "train" samples are all samples that appear in any train set
    // and "test" (OOF) samples are all samples that appear in any test set
    // In k-fold, every sample appears exactly once in test
    counts.train = allTrainIndices.size;
    counts.test = allTestIndices.size;
    counts.oof = allTestIndices.size;
  }

  return counts;
}

/**
 * Get indices for a specific partition
 */
export function getPartitionIndices(
  partition: PartitionFilter,
  folds: FoldsInfo | null,
  totalSamples: number
): number[] {
  // If no folds info, return all indices
  if (!folds || !folds.folds || folds.folds.length === 0) {
    return Array.from({ length: totalSamples }, (_, i) => i);
  }

  switch (partition) {
    case 'all':
      return Array.from({ length: totalSamples }, (_, i) => i);

    case 'train': {
      const trainIndices = new Set<number>();
      folds.folds.forEach(fold => {
        fold.train_indices.forEach(i => trainIndices.add(i));
      });
      return Array.from(trainIndices).sort((a, b) => a - b);
    }

    case 'test': {
      const testIndices = new Set<number>();
      folds.folds.forEach(fold => {
        fold.test_indices.forEach(i => testIndices.add(i));
      });
      return Array.from(testIndices).sort((a, b) => a - b);
    }

    case 'train-test': {
      // All samples that are in either train or test
      const indices = new Set<number>();
      folds.folds.forEach(fold => {
        fold.train_indices.forEach(i => indices.add(i));
        fold.test_indices.forEach(i => indices.add(i));
      });
      return Array.from(indices).sort((a, b) => a - b);
    }

    case 'oof': {
      // OOF = samples that appear in test sets (same as 'test' for k-fold)
      const oofIndices = new Set<number>();
      folds.folds.forEach(fold => {
        fold.test_indices.forEach(i => oofIndices.add(i));
      });
      return Array.from(oofIndices).sort((a, b) => a - b);
    }

    default: {
      // Handle fold-specific selection (e.g., "fold-0", "fold-1")
      const match = partition.match(/^fold-(\d+)$/);
      if (match) {
        const foldIndex = parseInt(match[1], 10);
        const fold = folds.folds.find(f => f.fold_index === foldIndex);
        if (fold) {
          // Return both train and test indices for this fold
          const indices = new Set<number>([...fold.train_indices, ...fold.test_indices]);
          return Array.from(indices).sort((a, b) => a - b);
        }
      }
      // Fallback to all
      return Array.from({ length: totalSamples }, (_, i) => i);
    }
  }
}

/**
 * Get display label for partition
 */
function getPartitionLabel(partition: PartitionFilter): string {
  switch (partition) {
    case 'all':
      return 'All';
    case 'train':
      return 'Train';
    case 'test':
      return 'Test';
    case 'train-test':
      return 'Train/Test';
    case 'oof':
      return 'OOF';
    default: {
      const match = partition.match(/^fold-(\d+)$/);
      if (match) {
        return `Fold ${parseInt(match[1], 10) + 1}`;
      }
      return 'All';
    }
  }
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
  // Calculate counts
  const counts = useMemo(
    () => calculatePartitionCounts(folds, totalSamples),
    [folds, totalSamples]
  );

  // Check if we have folds
  const hasFolds = folds && folds.n_folds > 0;
  const isKFold = hasFolds && folds.n_folds > 1;

  // Get current count for display
  const currentCount = useMemo(() => {
    switch (value) {
      case 'all':
        return counts.all;
      case 'train':
        return counts.train;
      case 'test':
        return counts.test;
      case 'train-test':
        return counts.train; // Approximate
      case 'oof':
        return counts.oof;
      default: {
        const match = value.match(/^fold-(\d+)$/);
        if (match) {
          const foldIndex = parseInt(match[1], 10);
          return counts.folds[foldIndex]?.total ?? 0;
        }
        return counts.all;
      }
    }
  }, [value, counts]);

  // Handle value change
  const handleChange = useCallback((newValue: string) => {
    onChange(newValue as PartitionFilter);
  }, [onChange]);

  // If no folds, show disabled state or simplified selector
  if (!hasFolds) {
    return (
      <div className={cn('flex items-center gap-1', className)}>
        <Layers className="w-3 h-3 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">
          {compact ? 'All' : 'All Samples'}
        </span>
        <Badge variant="secondary" className="h-4 px-1 text-[9px]">
          {totalSamples}
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
            {getPartitionLabel(value)}
          </SelectValue>
        </SelectTrigger>

        <SelectContent align="start">
          {/* Basic partitions */}
          <SelectItem value="all">
            <div className="flex items-center justify-between w-full gap-4">
              <span>All Samples</span>
              <Badge variant="outline" className="h-4 px-1 text-[9px]">
                {counts.all}
              </Badge>
            </div>
          </SelectItem>

          <SelectItem value="train">
            <div className="flex items-center justify-between w-full gap-4">
              <span>Train</span>
              <Badge variant="outline" className="h-4 px-1 text-[9px]">
                {counts.train}
              </Badge>
            </div>
          </SelectItem>

          <SelectItem value="test">
            <div className="flex items-center justify-between w-full gap-4">
              <span>Test</span>
              <Badge variant="outline" className="h-4 px-1 text-[9px]">
                {counts.test}
              </Badge>
            </div>
          </SelectItem>

          {/* K-fold specific options */}
          {isKFold && (
            <>
              <SelectSeparator />

              <SelectItem value="oof">
                <div className="flex items-center justify-between w-full gap-4">
                  <span>OOF (All Test)</span>
                  <Badge variant="outline" className="h-4 px-1 text-[9px]">
                    {counts.oof}
                  </Badge>
                </div>
              </SelectItem>

              <SelectSeparator />

              <SelectGroup>
                <SelectLabel className="text-[10px]">Individual Folds</SelectLabel>
                {folds.folds.map((fold) => (
                  <SelectItem key={fold.fold_index} value={`fold-${fold.fold_index}`}>
                    <div className="flex items-center justify-between w-full gap-4">
                      <span>Fold {fold.fold_index + 1}</span>
                      <div className="flex items-center gap-1">
                        <Badge variant="outline" className="h-4 px-1 text-[9px]" style={{ backgroundColor: 'hsla(217, 70%, 50%, 0.1)' }}>
                          {fold.train_count}
                        </Badge>
                        <span className="text-[9px] text-muted-foreground">/</span>
                        <Badge variant="outline" className="h-4 px-1 text-[9px]" style={{ backgroundColor: 'hsla(38, 92%, 50%, 0.1)' }}>
                          {fold.test_count}
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
      {!compact && value !== 'all' && (
        <Badge variant="secondary" className="h-4 px-1 text-[9px]">
          {currentCount}
        </Badge>
      )}
    </div>
  );
}

export default PartitionSelector;

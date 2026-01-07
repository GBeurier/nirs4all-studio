/**
 * SelectionFilters - Filter-based selection tools
 *
 * Features:
 * - Select samples by fold/partition
 * - Select samples by metadata column values
 * - Integration with SelectionContext
 *
 * Phase 2 Implementation - Selection System Enhancement
 */

import { useMemo, useCallback, useState } from 'react';
import {
  Filter,
  Layers,
  ChevronDown,
  Check,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useSelection } from '@/context/SelectionContext';
import type { FoldsInfo, FoldData } from '@/types/playground';
import { cn } from '@/lib/utils';

// ============= Types =============

interface SelectionFiltersProps {
  /** Fold information for fold-based selection */
  folds?: FoldsInfo | null;
  /** Metadata columns for metadata-based selection */
  metadata?: Record<string, unknown[]>;
  /** Sample IDs for reference */
  sampleIds?: string[];
  /** Total sample count */
  totalSamples: number;
  /** Whether to show compact mode */
  compact?: boolean;
  /** Additional class name */
  className?: string;
}

// ============= Component =============

export function SelectionFilters({
  folds,
  metadata,
  sampleIds,
  totalSamples,
  compact = false,
  className,
}: SelectionFiltersProps) {
  const { select, selectedSamples, clear } = useSelection();
  const [activeFilters, setActiveFilters] = useState<string[]>([]);

  // Get unique fold indices
  const uniqueFolds = useMemo(() => {
    if (!folds?.fold_labels) return [];
    return [...new Set(folds.fold_labels.filter(f => f >= 0))].sort((a, b) => a - b);
  }, [folds]);

  // Get metadata column names and their unique values
  const metadataColumns = useMemo(() => {
    if (!metadata) return [];
    return Object.entries(metadata).map(([key, values]) => {
      // Get unique values (limit to first 100 for performance)
      const uniqueValues = [...new Set(values.map(v => String(v)))].slice(0, 100);
      return { key, uniqueValues, totalValues: [...new Set(values)].length };
    }).filter(col => col.uniqueValues.length > 1 && col.uniqueValues.length <= 50); // Only show columns with 2-50 unique values
  }, [metadata]);

  // Get current fold's train/test indices
  const currentFoldData = useMemo<FoldData | null>(() => {
    if (!folds?.folds || folds.folds.length === 0) return null;
    const foldIdx = folds.split_index ?? 0;
    return folds.folds[foldIdx] ?? folds.folds[0] ?? null;
  }, [folds]);

  // Check if we have fold-based selections available
  const hasFoldSelection = uniqueFolds.length > 0 || !!currentFoldData;

  // Select samples by fold
  const handleSelectByFold = useCallback((foldIdx: number, mode: 'replace' | 'add' = 'replace') => {
    if (!folds?.fold_labels) return;

    const samples = folds.fold_labels
      .map((f, idx) => f === foldIdx ? idx : -1)
      .filter(idx => idx >= 0);

    if (samples.length > 0) {
      select(samples, mode);
      setActiveFilters(prev =>
        mode === 'add'
          ? [...new Set([...prev, `fold:${foldIdx}`])]
          : [`fold:${foldIdx}`]
      );
    }
  }, [folds, select]);

  // Select samples by partition (train/test)
  const handleSelectByPartition = useCallback((partition: 'train' | 'test', mode: 'replace' | 'add' = 'replace') => {
    if (!currentFoldData) return;

    const samples = partition === 'train' ? currentFoldData.train_indices : currentFoldData.test_indices;
    if (samples && samples.length > 0) {
      select(samples, mode);
      setActiveFilters(prev =>
        mode === 'add'
          ? [...new Set([...prev, `partition:${partition}`])]
          : [`partition:${partition}`]
      );
    }
  }, [currentFoldData, select]);

  // Select samples by metadata value
  const handleSelectByMetadata = useCallback((column: string, value: string, mode: 'replace' | 'add' = 'replace') => {
    if (!metadata?.[column]) return;

    const samples = metadata[column]
      .map((v, idx) => String(v) === value ? idx : -1)
      .filter(idx => idx >= 0);

    if (samples.length > 0) {
      select(samples, mode);
      setActiveFilters(prev =>
        mode === 'add'
          ? [...new Set([...prev, `${column}:${value}`])]
          : [`${column}:${value}`]
      );
    }
  }, [metadata, select]);

  // Clear filters and selection
  const handleClearFilters = useCallback(() => {
    clear();
    setActiveFilters([]);
  }, [clear]);

  // Count samples per filter
  const getFilterCount = useCallback((type: string, value: string | number): number => {
    if (type === 'fold' && folds?.fold_labels) {
      return folds.fold_labels.filter(f => f === value).length;
    }
    if (type === 'partition' && currentFoldData) {
      return value === 'train' ? (currentFoldData.train_indices?.length ?? 0) : (currentFoldData.test_indices?.length ?? 0);
    }
    if (metadata?.[type]) {
      return metadata[type].filter(v => String(v) === String(value)).length;
    }
    return 0;
  }, [folds, currentFoldData, metadata]);

  // Don't render if no selection options available
  if (!hasFoldSelection && metadataColumns.length === 0) {
    return null;
  }

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant={activeFilters.length > 0 ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 px-2 gap-1"
          >
            <Filter className="w-3 h-3" />
            {!compact && <span className="text-xs">Select by</span>}
            {activeFilters.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                {activeFilters.length}
              </Badge>
            )}
            <ChevronDown className="w-3 h-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0" align="start">
          <div className="p-2 border-b">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Select Samples By</span>
              {activeFilters.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={handleClearFilters}
                >
                  Clear
                </Button>
              )}
            </div>
            {activeFilters.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {activeFilters.map(filter => (
                  <Badge key={filter} variant="outline" className="text-[10px] h-5 gap-1">
                    {filter}
                    <X
                      className="w-2.5 h-2.5 cursor-pointer hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveFilters(prev => prev.filter(f => f !== filter));
                      }}
                    />
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <ScrollArea className="max-h-80">
            {/* Partition selection (Train/Test) */}
            {currentFoldData && (
              <div className="p-2 border-b">
                <div className="text-xs font-medium text-muted-foreground mb-1">Partition</div>
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 flex-1 text-xs justify-between"
                    onClick={(e) => handleSelectByPartition('train', e.shiftKey ? 'add' : 'replace')}
                  >
                    <span>Train</span>
                    <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                      {currentFoldData.train_indices.length}
                    </Badge>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 flex-1 text-xs justify-between"
                    onClick={(e) => handleSelectByPartition('test', e.shiftKey ? 'add' : 'replace')}
                  >
                    <span>Test</span>
                    <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                      {currentFoldData.test_indices.length}
                    </Badge>
                  </Button>
                </div>
              </div>
            )}

            {/* Fold selection */}
            {uniqueFolds.length > 0 && (
              <div className="p-2 border-b">
                <div className="text-xs font-medium text-muted-foreground mb-1">
                  Fold ({uniqueFolds.length} folds)
                </div>
                <div className="flex flex-wrap gap-1">
                  {uniqueFolds.map(foldIdx => (
                    <Button
                      key={foldIdx}
                      variant="outline"
                      size="sm"
                      className={cn(
                        "h-6 px-2 text-xs",
                        activeFilters.includes(`fold:${foldIdx}`) && "bg-primary/10 border-primary"
                      )}
                      onClick={(e) => handleSelectByFold(foldIdx, e.shiftKey ? 'add' : 'replace')}
                    >
                      F{foldIdx + 1}
                      <span className="ml-1 text-muted-foreground">
                        ({getFilterCount('fold', foldIdx)})
                      </span>
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Metadata columns */}
            {metadataColumns.map(({ key, uniqueValues, totalValues }) => (
              <div key={key} className="p-2 border-b last:border-b-0">
                <div className="text-xs font-medium text-muted-foreground mb-1 flex items-center justify-between">
                  <span className="truncate max-w-[150px]" title={key}>{key}</span>
                  <span className="text-[10px]">{totalValues} values</span>
                </div>
                <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                  {uniqueValues.slice(0, 20).map(value => (
                    <Button
                      key={value}
                      variant="outline"
                      size="sm"
                      className={cn(
                        "h-6 px-2 text-xs max-w-full",
                        activeFilters.includes(`${key}:${value}`) && "bg-primary/10 border-primary"
                      )}
                      onClick={(e) => handleSelectByMetadata(key, value, e.shiftKey ? 'add' : 'replace')}
                    >
                      <span className="truncate max-w-[100px]" title={value}>{value}</span>
                      <span className="ml-1 text-muted-foreground shrink-0">
                        ({getFilterCount(key, value)})
                      </span>
                    </Button>
                  ))}
                  {uniqueValues.length > 20 && (
                    <span className="text-[10px] text-muted-foreground px-2 py-1">
                      +{uniqueValues.length - 20} more
                    </span>
                  )}
                </div>
              </div>
            ))}
          </ScrollArea>

          <div className="p-2 border-t bg-muted/30">
            <p className="text-[10px] text-muted-foreground">
              Hold <kbd className="px-1 py-0.5 bg-muted rounded text-[9px]">Shift</kbd> to add to selection
            </p>
          </div>
        </PopoverContent>
      </Popover>

      {/* Quick selection count indicator */}
      {selectedSamples.size > 0 && (
        <Badge variant="secondary" className="h-6 text-xs">
          {selectedSamples.size}/{totalSamples}
        </Badge>
      )}
    </div>
  );
}

export default SelectionFilters;

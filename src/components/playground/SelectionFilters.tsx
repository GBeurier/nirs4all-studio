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
import { Trans, useTranslation } from 'react-i18next';
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
import { useSelection } from '@/context/useSelection';
import type { FoldsInfo } from '@/types/playground';
import { cn } from '@/lib/utils';
import {
  buildSelectionFilterData,
  getSamplesByFold,
  getSamplesByMetadata,
  getSamplesByPartition,
  getSelectionFilterCount,
} from '@/lib/playground/selectionFilterData';

// ============= Types =============

interface SelectionFiltersProps {
  /** Fold information for fold-based selection */
  folds?: FoldsInfo | null;
  /** Metadata columns for metadata-based selection */
  metadata?: Record<string, unknown[]>;
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
  totalSamples,
  compact = false,
  className,
}: SelectionFiltersProps) {
  const { t } = useTranslation();
  const { select, selectedSamples, clear } = useSelection();
  const [activeFilters, setActiveFilters] = useState<string[]>([]);

  const {
    uniqueFolds,
    metadataColumns,
    currentFoldData,
    hasSelectionOptions,
  } = useMemo(() => buildSelectionFilterData({ folds, metadata }), [folds, metadata]);

  // Select samples by fold
  const handleSelectByFold = useCallback((foldIdx: number, mode: 'replace' | 'add' = 'replace') => {
    const samples = getSamplesByFold(folds, foldIdx);

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
    const samples = getSamplesByPartition(currentFoldData, partition);
    if (samples.length > 0) {
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
    const samples = getSamplesByMetadata(metadata, column, value);

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
    return getSelectionFilterCount({
      type,
      value,
      folds,
      currentFoldData,
      metadata,
    });
  }, [folds, currentFoldData, metadata]);

  // Don't render if no selection options available
  if (!hasSelectionOptions) {
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
            {!compact && <span className="text-xs">{t('playground.selection.filters.selectBy')}</span>}
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
              <span className="text-sm font-medium">{t('playground.selection.filters.selectSamplesBy')}</span>
              {activeFilters.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={handleClearFilters}
                >
                  {t('playground.selection.filters.clear')}
                </Button>
              )}
            </div>
            {activeFilters.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {activeFilters.map(filter => (
                  <Badge key={filter} variant="outline" className="text-[10px] h-5 gap-1">
                    {filter}
                    <X
                      role="button"
                      tabIndex={0}
                      aria-label={t('playground.selection.filters.removeFilter', { filter })}
                      className="w-2.5 h-2.5 cursor-pointer hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveFilters(prev => prev.filter(f => f !== filter));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          setActiveFilters(prev => prev.filter(f => f !== filter));
                        }
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
                <div className="text-xs font-medium text-muted-foreground mb-1">{t('playground.selection.filters.partition')}</div>
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 flex-1 text-xs justify-between"
                    onClick={(e) => handleSelectByPartition('train', e.shiftKey ? 'add' : 'replace')}
                  >
                    <span>{t('playground.selection.filters.train')}</span>
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
                    <span>{t('playground.selection.filters.test')}</span>
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
                  {t('playground.selection.filters.foldHeading', { count: uniqueFolds.length })}
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
                      {t('playground.selection.filters.foldShort', { n: foldIdx + 1 })}
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
                  <span className="text-[10px]">{t('playground.selection.filters.valuesCount', { count: totalValues })}</span>
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
                      {t('playground.selection.filters.more', { count: uniqueValues.length - 20 })}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </ScrollArea>

          <div className="p-2 border-t bg-muted/30">
            <p className="text-[10px] text-muted-foreground">
              <Trans
                i18nKey="playground.selection.filters.shiftHint"
                components={{ kbd: <kbd className="px-1 py-0.5 bg-muted rounded text-[9px]" /> }}
              />
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

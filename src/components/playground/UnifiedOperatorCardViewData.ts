import type { UnifiedOperatorFilterStats } from './UnifiedOperatorCardTypes';

export interface FilterStatsBadgeViewModel {
  variant: 'outline' | 'destructive';
  className: string;
  label: string;
  tooltip: string;
}

export function getFilterStatsBadgeViewModel({
  isFilter,
  filterStats,
}: {
  isFilter: boolean;
  filterStats?: UnifiedOperatorFilterStats;
}): FilterStatsBadgeViewModel | null {
  if (!isFilter || !filterStats || !(filterStats.removed_count > 0)) {
    return null;
  }

  const count = filterStats.removed_count;
  const sampleLabel = `${count} sample${count !== 1 ? 's' : ''}`;
  const reasonSuffix = filterStats.reason ? `: ${filterStats.reason}` : '';

  if (filterStats.mode === 'tag') {
    return {
      variant: 'outline',
      className: 'h-4 px-1.5 text-[10px] font-medium gap-0.5 cursor-help border-amber-500/50 text-amber-600 dark:text-amber-400',
      label: `${count} tagged`,
      tooltip: `${sampleLabel} tagged as outliers (visible in charts)${reasonSuffix}`,
    };
  }

  return {
    variant: 'destructive',
    className: 'h-4 px-1.5 text-[10px] font-medium gap-0.5 cursor-help',
    label: `${count} removed`,
    tooltip: `${sampleLabel} filtered out${reasonSuffix}`,
  };
}

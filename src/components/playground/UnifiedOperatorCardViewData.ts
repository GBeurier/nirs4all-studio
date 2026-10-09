import type { TFunction } from 'i18next';
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
  t,
}: {
  isFilter: boolean;
  filterStats?: UnifiedOperatorFilterStats;
  t: TFunction;
}): FilterStatsBadgeViewModel | null {
  if (!isFilter || !filterStats || !(filterStats.removed_count > 0)) {
    return null;
  }

  const count = filterStats.removed_count;
  const withReason = (text: string) => (filterStats.reason ? t('playground.operators.filterStats.withReason', { text, reason: filterStats.reason }) : text);

  if (filterStats.mode === 'tag') {
    return {
      variant: 'outline',
      className: 'h-4 px-1.5 text-[10px] font-medium gap-0.5 cursor-help border-amber-500/50 text-amber-600 dark:text-amber-400',
      label: t('playground.operators.filterStats.tagged', { count }),
      tooltip: withReason(t('playground.operators.filterStats.taggedTooltip', { count })),
    };
  }

  return {
    variant: 'destructive',
    className: 'h-4 px-1.5 text-[10px] font-medium gap-0.5 cursor-help',
    label: t('playground.operators.filterStats.removed', { count }),
    tooltip: withReason(t('playground.operators.filterStats.removedTooltip', { count })),
  };
}

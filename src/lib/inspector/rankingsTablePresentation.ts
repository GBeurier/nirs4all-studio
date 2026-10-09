import type { TFunction } from 'i18next';
import type { RankingRow } from '@/types/inspector';
import type { RankingSortField } from '@/lib/inspector/rankingsTableData';

export interface RankingTableColumn {
  field: RankingSortField;
  labelKey: string;
  align?: 'left' | 'right';
  width?: string;
}

export const RANKINGS_TABLE_COLUMNS: RankingTableColumn[] = [
  { field: 'rank', labelKey: 'inspector.rankings.columns.rank', align: 'right', width: 'w-10' },
  { field: 'model_class', labelKey: 'inspector.rankings.columns.model' },
  { field: 'preprocessings', labelKey: 'inspector.rankings.columns.preprocessing' },
  { field: 'cv_val_score', labelKey: 'inspector.rankings.columns.valScore', align: 'right' },
  { field: 'cv_test_score', labelKey: 'inspector.rankings.columns.testScore', align: 'right' },
  { field: 'final_test_score', labelKey: 'inspector.rankings.columns.finalTest', align: 'right' },
  { field: 'cv_fold_count', labelKey: 'inspector.rankings.columns.folds', align: 'right', width: 'w-14' },
  { field: 'dataset_name', labelKey: 'inspector.rankings.columns.dataset' },
];

export function getRankingsTableEmptyMessage(t: TFunction): string {
  return t('inspector.charts.empty.rankings');
}

export function formatRankingScore(value: number | null | undefined): string {
  return value == null ? '—' : value.toFixed(4);
}

export function formatRankingModelLabel(row: Pick<RankingRow, 'model_name' | 'model_class'>): string {
  return row.model_name ?? row.model_class;
}

export function formatRankingOptionalText(value: string | null | undefined): string {
  return value ?? '—';
}

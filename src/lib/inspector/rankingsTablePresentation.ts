import type { RankingRow } from '@/types/inspector';
import type { RankingSortField } from '@/lib/inspector/rankingsTableData';

export interface RankingTableColumn {
  field: RankingSortField;
  label: string;
  align?: 'left' | 'right';
  width?: string;
}

export const RANKINGS_TABLE_EMPTY_MESSAGE = 'No ranking data available.';

export const RANKINGS_TABLE_COLUMNS: RankingTableColumn[] = [
  { field: 'rank', label: '#', align: 'right', width: 'w-10' },
  { field: 'model_class', label: 'Model' },
  { field: 'preprocessings', label: 'Preprocessing' },
  { field: 'cv_val_score', label: 'Val Score', align: 'right' },
  { field: 'cv_test_score', label: 'Test Score', align: 'right' },
  { field: 'final_test_score', label: 'Final Test', align: 'right' },
  { field: 'cv_fold_count', label: 'Folds', align: 'right', width: 'w-14' },
  { field: 'dataset_name', label: 'Dataset' },
];

export function getRankingsTableEmptyMessage(): string {
  return RANKINGS_TABLE_EMPTY_MESSAGE;
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

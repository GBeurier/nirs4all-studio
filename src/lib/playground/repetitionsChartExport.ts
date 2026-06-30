import type { RepetitionResult } from '@/types/playground';
import type { ComputedRepetitionDistances } from '@/lib/playground/repetitionsChartDistances';

export interface RepetitionExportRow {
  bio_sample: string;
  rep_index: number;
  sample_id: string;
  sample_index: number;
  distance: number;
  y: number | '';
  y_mean: number | '';
}

export function buildRepetitionExportRows(
  repetitionData: RepetitionResult | null | undefined,
  computedDistances?: ComputedRepetitionDistances | null
): RepetitionExportRow[] {
  if (!repetitionData?.data) return [];

  return repetitionData.data.map((point, index) => ({
    bio_sample: point.bio_sample,
    rep_index: point.rep_index,
    sample_id: point.sample_id,
    sample_index: point.sample_index,
    distance: computedDistances?.distances[index] ?? point.distance,
    y: point.y ?? '',
    y_mean: point.y_mean ?? '',
  }));
}

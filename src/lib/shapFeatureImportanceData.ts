import type { TFunction } from 'i18next';
import type { BinnedImportanceData } from '@/types/shap';
import { getShapAxisDisplay } from '@/lib/shapAxisDisplay';

export interface ShapFeatureImportanceRow {
  label: string;
  center: number;
  importance: number;
  normalized: number;
  rank: number;
}

export interface ShapFeatureImportanceExportRow {
  wavelengthStart: number;
  wavelengthEnd: number;
  center: number;
  importance: number;
}

/** Rank by magnitude so signed aggregations (sum/mean SHAP) keep strong negative regions. */
function byMagnitude(left: { importance: number }, right: { importance: number }): number {
  return Math.abs(right.importance) - Math.abs(left.importance);
}

export function buildShapFeatureImportanceRows(
  binnedImportance: BinnedImportanceData,
  limit = 15,
): ShapFeatureImportanceRow[] {
  const maxMagnitude = Math.max(0, ...binnedImportance.bin_values.map((value) => Math.abs(value)));

  return binnedImportance.bin_centers
    .map((center, index) => ({
      label: `${binnedImportance.bin_ranges[index][0].toFixed(0)}-${binnedImportance.bin_ranges[index][1].toFixed(0)}`,
      center,
      importance: binnedImportance.bin_values[index],
      normalized: maxMagnitude === 0 ? 0 : Math.abs(binnedImportance.bin_values[index]) / maxMagnitude,
      rank: 0,
    }))
    .sort(byMagnitude)
    .slice(0, limit)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

export function buildShapFeatureImportanceExportRows(
  binnedImportance: BinnedImportanceData,
): ShapFeatureImportanceExportRow[] {
  return binnedImportance.bin_centers
    .map((center, index) => ({
      wavelengthStart: binnedImportance.bin_ranges[index][0],
      wavelengthEnd: binnedImportance.bin_ranges[index][1],
      center,
      importance: binnedImportance.bin_values[index],
    }))
    .sort(byMagnitude);
}

export function buildShapFeatureImportanceCsv(binnedImportance: BinnedImportanceData, axisUnit: string | null | undefined, t: TFunction): string {
  const headers = [
    t('results.variableImportance.ranking.rank'),
    t('results.variableImportance.axis.range', { axis: getShapAxisDisplay(axisUnit, t).label }),
    t('results.variableImportance.ranking.center'),
    t('results.variableImportance.ranking.importance'),
  ];
  const rows = buildShapFeatureImportanceExportRows(binnedImportance);

  return [
    headers.join(','),
    ...rows.map((row, index) => [
      index + 1,
      `${row.wavelengthStart.toFixed(1)}-${row.wavelengthEnd.toFixed(1)}`,
      row.center.toFixed(1),
      row.importance.toFixed(6),
    ].join(',')),
  ].join('\n');
}

import type { BinnedImportanceData } from '@/types/shap';

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

export function buildShapFeatureImportanceRows(
  binnedImportance: BinnedImportanceData,
  limit = 15,
): ShapFeatureImportanceRow[] {
  const maxImportance = Math.max(...binnedImportance.bin_values);

  return binnedImportance.bin_centers
    .map((center, index) => ({
      label: `${binnedImportance.bin_ranges[index][0].toFixed(0)}-${binnedImportance.bin_ranges[index][1].toFixed(0)}`,
      center,
      importance: binnedImportance.bin_values[index],
      normalized: maxImportance === 0 ? 0 : binnedImportance.bin_values[index] / maxImportance,
      rank: 0,
    }))
    .sort((left, right) => right.importance - left.importance)
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
    .sort((left, right) => right.importance - left.importance);
}

export function buildShapFeatureImportanceCsv(binnedImportance: BinnedImportanceData): string {
  const headers = ['Rank', 'Wavelength Range (cm⁻¹)', 'Center', 'Importance'];
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

export function getShapFeatureImportanceFill(normalizedImportance: number): string {
  return `rgba(13, 148, 136, ${0.4 + 0.6 * normalizedImportance})`;
}

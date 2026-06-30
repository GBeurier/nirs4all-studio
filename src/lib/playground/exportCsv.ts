import type { DataExportContent } from '@/lib/playground/export';

export type CsvBuildResult =
  | { success: true; csv: string }
  | { success: false; error: string };

function buildOutlierSet(outlierIndices: DataExportContent['outlierIndices']): Set<number> | null {
  if (!outlierIndices) {
    return null;
  }
  return outlierIndices instanceof Set ? outlierIndices : new Set(outlierIndices);
}

export function buildSpectraCsv(content: DataExportContent): CsvBuildResult {
  const { spectra, wavelengths, y, sampleIds, outlierIndices } = content;

  if (!spectra || !wavelengths) {
    return {
      success: false,
      error: 'No spectra data to export',
    };
  }

  const outlierSet = buildOutlierSet(outlierIndices);
  const hasOutliers = Boolean(outlierSet?.size);
  const hasSampleIds = sampleIds && sampleIds.length === spectra.length;
  const hasY = y && y.length === spectra.length;

  const headers: string[] = [];
  if (hasSampleIds) headers.push('sample_id');
  headers.push(...wavelengths.map((wavelength) => String(wavelength)));
  if (hasY) headers.push('target');
  if (hasOutliers) headers.push('is_outlier');

  const rows = spectra.map((spectrum, idx) => {
    const row: (string | number)[] = [];
    if (hasSampleIds) row.push(sampleIds[idx]);
    row.push(...spectrum.map((value) => value.toFixed(6)));
    if (hasY) row.push(y[idx]);
    if (hasOutliers) row.push(outlierSet!.has(idx) ? 1 : 0);
    return row.join(',');
  });

  return {
    success: true,
    csv: [headers.join(','), ...rows].join('\n'),
  };
}

export function buildPcaCsv(content: DataExportContent): CsvBuildResult {
  const { pca, y, sampleIds, explainedVariance } = content;

  if (!pca || pca.length === 0) {
    return {
      success: false,
      error: 'No PCA data to export',
    };
  }

  const nComponents = pca[0].length;
  const hasSampleIds = sampleIds && sampleIds.length === pca.length;
  const hasY = y && y.length === pca.length;

  const headers: string[] = [];
  if (hasSampleIds) headers.push('sample_id');
  for (let i = 0; i < nComponents; i++) {
    if (explainedVariance && explainedVariance[i] !== undefined) {
      headers.push(`PC${i + 1}_${(explainedVariance[i] * 100).toFixed(1)}%`);
    } else {
      headers.push(`PC${i + 1}`);
    }
  }
  if (hasY) headers.push('target');

  const rows = pca.map((coords, idx) => {
    const row: (string | number)[] = [];
    if (hasSampleIds) row.push(sampleIds[idx]);
    row.push(...coords.map((value) => value.toFixed(6)));
    if (hasY) row.push(y[idx]);
    return row.join(',');
  });

  return {
    success: true,
    csv: [headers.join(','), ...rows].join('\n'),
  };
}

export function buildTargetsCsv(content: DataExportContent): CsvBuildResult {
  const { y, sampleIds, metadata } = content;

  if (!y || y.length === 0) {
    return {
      success: false,
      error: 'No target data to export',
    };
  }

  const hasSampleIds = sampleIds && sampleIds.length === y.length;
  const metadataKeys = metadata ? Object.keys(metadata) : [];

  const headers: string[] = [];
  if (hasSampleIds) headers.push('sample_id');
  headers.push('target', ...metadataKeys);

  const rows = y.map((targetValue, idx) => {
    const row: (string | number)[] = [];
    if (hasSampleIds) row.push(sampleIds[idx]);
    row.push(targetValue);
    for (const key of metadataKeys) {
      const value = metadata![key][idx];
      row.push(value !== undefined && value !== null ? String(value) : '');
    }
    return row.join(',');
  });

  return {
    success: true,
    csv: [headers.join(','), ...rows].join('\n'),
  };
}
